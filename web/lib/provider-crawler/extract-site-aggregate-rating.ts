/**
 * Parse schema.org AggregateRating from firm-site HTML (JSON-LD + microdata).
 * Does not scrape Google Maps or Trustpilot pages.
 */

export type SiteReviewPublisher =
  | "google"
  | "trustpilot"
  | "reviewsolicitors"
  | "unknown";

export type SiteAggregateRating = {
  rating: number;
  reviewCount: number;
  publisher: SiteReviewPublisher;
  publisherLabel: string;
};

const PUBLISHER_LABEL: Record<SiteReviewPublisher, string> = {
  google: "Google Maps",
  trustpilot: "Trustpilot",
  reviewsolicitors: "ReviewSolicitors",
  unknown: "Firm website",
};

function detectPublisher(text: string): SiteReviewPublisher {
  const t = text.toLowerCase();
  if (/trustpilot/.test(t)) return "trustpilot";
  if (/review\s*solicitors|reviewsolicitors/.test(t)) return "reviewsolicitors";
  if (/google\s*maps|google\.com\/maps|maps\.google|google reviews?/.test(t)) {
    return "google";
  }
  return "unknown";
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function typeList(node: Record<string, unknown>): string[] {
  const raw = node["@type"];
  if (typeof raw === "string") return [raw.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase());
  }
  return [];
}

function numField(node: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = node[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const n = Number(raw.replace(/,/g, "").trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parseAggregateNode(
  node: Record<string, unknown>,
  contextText: string,
): SiteAggregateRating | null {
  const types = typeList(node);
  const looksLike =
    types.includes("aggregaterating") ||
    node.ratingValue != null ||
    node.ratingvalue != null;
  if (!looksLike) return null;

  const rating = numField(node, ["ratingValue", "ratingvalue", "value"]);
  const count = numField(node, [
    "reviewCount",
    "ratingCount",
    "reviewcount",
    "ratingcount",
  ]);
  if (rating == null || count == null) return null;
  if (rating <= 0 || rating > 5 || count <= 0) return null;

  const publisher = detectPublisher(
    [contextText, String(node.name ?? ""), String(node.author ?? "")].join(" "),
  );
  return {
    rating,
    reviewCount: Math.round(count),
    publisher,
    publisherLabel: PUBLISHER_LABEL[publisher],
  };
}

function walkJsonLd(
  node: unknown,
  contextText: string,
  out: SiteAggregateRating[],
): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const child of node) walkJsonLd(child, contextText, out);
    return;
  }
  const obj = asObject(node);
  if (!obj) return;

  const types = typeList(obj);
  const localContext = [
    contextText,
    types.join(" "),
    String(obj.name ?? ""),
    String(obj.url ?? ""),
  ].join(" ");

  const nested = obj.aggregateRating ?? obj.aggregaterating;
  if (nested) {
    const aggObj = asObject(nested);
    if (aggObj) {
      const parsed = parseAggregateNode(aggObj, localContext);
      if (parsed) out.push(parsed);
    }
  }

  const self = parseAggregateNode(obj, localContext);
  if (self) out.push(self);

  for (const [key, value] of Object.entries(obj)) {
    if (key === "@context") continue;
    if (typeof value === "object") walkJsonLd(value, localContext, out);
  }
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Some pages concatenate multiple JSON objects; try wrapping as array.
      try {
        blocks.push(JSON.parse(`[${raw.replace(/}\s*{/g, "},{")}]`));
      } catch {
        /* ignore malformed ld+json */
      }
    }
  }
  return blocks;
}

function extractMicrodata(html: string): SiteAggregateRating | null {
  const chunk = html.slice(0, 500_000);
  const ratingMatch =
    chunk.match(
      /itemprop=["']ratingValue["'][^>]*content=["']([^"']+)["']/i,
    ) ||
    chunk.match(
      /itemprop=["']ratingValue["'][^>]*>(\s*[\d.]+)\s*</i,
    ) ||
    chunk.match(
      /content=["']([^"']+)["'][^>]*itemprop=["']ratingValue["']/i,
    );
  const countMatch =
    chunk.match(
      /itemprop=["'](?:reviewCount|ratingCount)["'][^>]*content=["']([^"']+)["']/i,
    ) ||
    chunk.match(
      /itemprop=["'](?:reviewCount|ratingCount)["'][^>]*>(\s*[\d,]+)\s*</i,
    ) ||
    chunk.match(
      /content=["']([^"']+)["'][^>]*itemprop=["'](?:reviewCount|ratingCount)["']/i,
    );
  if (!ratingMatch || !countMatch) return null;
  const rating = Number(String(ratingMatch[1]).trim());
  const count = Number(String(countMatch[1]).replace(/,/g, "").trim());
  if (!Number.isFinite(rating) || rating <= 0 || rating > 5) return null;
  if (!Number.isFinite(count) || count <= 0) return null;
  const windowStart = Math.max(0, (ratingMatch.index ?? 0) - 400);
  const context = chunk.slice(windowStart, windowStart + 900);
  const publisher = detectPublisher(context);
  return {
    rating,
    reviewCount: Math.round(count),
    publisher,
    publisherLabel: PUBLISHER_LABEL[publisher],
  };
}

/**
 * Prefer the highest-confidence structured aggregate on the page.
 * When multiple exist, prefer named publishers over unknown, then higher count.
 */
export function extractSiteAggregateRating(html: string): SiteAggregateRating | null {
  if (!html?.trim()) return null;

  const found: SiteAggregateRating[] = [];
  for (const block of extractJsonLdBlocks(html)) {
    walkJsonLd(block, "", found);
  }

  const micro = extractMicrodata(html);
  if (micro) found.push(micro);

  if (!found.length) return null;

  const rank = (p: SiteReviewPublisher): number => {
    if (p === "google") return 3;
    if (p === "trustpilot") return 2;
    if (p === "reviewsolicitors") return 2;
    return 1;
  };

  found.sort((a, b) => {
    const pr = rank(b.publisher) - rank(a.publisher);
    if (pr !== 0) return pr;
    return b.reviewCount - a.reviewCount;
  });

  return found[0] ?? null;
}

export function sitePublisherLabel(publisher: SiteReviewPublisher): string {
  return PUBLISHER_LABEL[publisher];
}
