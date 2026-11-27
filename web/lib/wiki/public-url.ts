/** Wiki page id from a markdown relative path (no .md suffix). */
export function wikiPageSlugFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "");
}

/**
 * In-app path for a wiki article (matches sitemap and wiki/[slug] route).
 * Encode each segment only. Slashes stay slashes so the URL is not a second
 * copy with %2F in place of the folder path.
 */
export function wikiPagePublicPath(slug: string): string {
  const id = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  const encoded = id
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/ask-the-shaman/wiki/${encoded}`;
}

export function wikiPagePublicUrl(
  slug: string,
  base = "https://legalshaman.com",
): string {
  return `${base.replace(/\/$/, "")}${wikiPagePublicPath(slug)}`;
}

const WIKI_HREF =
  /^(https?:\/\/(?:www\.)?legalshaman\.com)?\/ask-the-shaman\/wiki\/([^?#]+)([?#].*)?$/i;

/**
 * Rewrite a wiki link written with %2F in place of folder slashes
 * (old encodeURIComponent(fullId) links) to the canonical slash form.
 * Other URLs are returned unchanged.
 */
export function normalizeWikiHref(href: string): string {
  const m = href.match(WIKI_HREF);
  if (!m || !/%2F/i.test(m[2] ?? "")) return href;
  let id: string;
  try {
    id = decodeURIComponent(m[2]!);
  } catch {
    return href;
  }
  const origin = m[1] ? "https://www.legalshaman.com" : "";
  return `${origin}${wikiPagePublicPath(id)}${m[3] ?? ""}`;
}

/** Replace every %2F wiki link inside a block of markdown or text. */
export function normalizeWikiLinksInText(text: string): string {
  return text.replace(
    /(?:https?:\/\/(?:www\.)?legalshaman\.com)?\/ask-the-shaman\/wiki\/[^\s)\]"'<>]+/gi,
    (url) => normalizeWikiHref(url),
  );
}

/**
 * Rewrite legacy stored wiki URLs (`/wiki/...` or `legalshaman.com/wiki/...`)
 * to the current Ask the Shaman wiki route.
 */
export function normalizeLegalSourceUrl(url: string | null | undefined): string {
  if (!url?.trim()) return "";
  const trimmed = url.trim();

  const legacyAbsolute = trimmed.match(
    /^https?:\/\/(?:www\.)?legalshaman\.com\/wiki\/(.+)$/i,
  );
  if (legacyAbsolute) {
    return wikiPagePublicPath(decodeURIComponent(legacyAbsolute[1]!));
  }

  const legacyRelative = trimmed.match(/^\/wiki\/(.+)$/i);
  if (legacyRelative) {
    return wikiPagePublicPath(decodeURIComponent(legacyRelative[1]!));
  }

  return trimmed;
}
