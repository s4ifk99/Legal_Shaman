import "server-only";

import { loadWiki, type WikiDomainId } from "@/lib/coherence/wiki";
import type { DisputeKind } from "@/lib/cases/dispute-context";
import {
  formatOptionsMessages,
  getProcessGuide,
  type ExplainedOption,
  type OptionExtraNote,
} from "@/lib/cases/process-guides";
import {
  penumbraLiveExaEnabled,
  penumbraOfflineExaEnabled,
  searchOfflineExaIndexForPenumbra,
} from "@/lib/penumbra/offlineExaIndex";
import { searchExaForPenumbra, exaPenumbraConfigured } from "@/lib/penumbra/exaSearch";
import {
  buildExaHitsCacheKey,
  getPenumbraExaHitsCache,
  putPenumbraExaHitsCache,
} from "@/lib/penumbra/researchCache";
import {
  isSolicitorComplaintStory,
  solicitorComplaintSearchQuery,
} from "@/lib/cases/solicitor-complaint";

function wikiDomainFor(kind: DisputeKind): WikiDomainId {
  switch (kind) {
    case "divorce":
      return "family";
    case "housing":
      return "housing";
    case "employment":
      return "employment";
    case "debt":
      return "debt";
    case "consumer":
      return "consumer";
    case "benefits":
      return "debt";
    default:
      return "family";
  }
}

function wikiQueryFor(kind: DisputeKind, story: string): string {
  switch (kind) {
    case "divorce":
      return "divorce separation children money property";
    case "housing":
      return "housing tenancy deposit eviction repairs";
    case "employment":
      return "employment dismissal wages tribunal acas";
    case "debt":
      return "debt advice repayment priority debts";
    case "consumer":
      return "consumer refund faulty goods services";
    case "neighbour":
      return "neighbour dispute noise boundary";
    case "benefits":
      return "universal credit benefits appeal mandatory reconsideration sanction";
    default:
      return story.slice(0, 120);
  }
}

function stripUrls(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function wikiExtras(kind: DisputeKind, story: string): Promise<OptionExtraNote[]> {
  try {
    const catalogue = await loadWiki(wikiDomainFor(kind));
    const q = `${story} ${wikiQueryFor(kind, story)}`.toLowerCase();
    const scored = catalogue.pages
      .map((page) => {
        const hay = `${page.title} ${page.snippet} ${(page.keywords || []).join(" ")}`.toLowerCase();
        let score = 0;
        for (const token of q.split(/\s+/).filter((t) => t.length > 3)) {
          if (hay.includes(token)) score += 1;
        }
        if (kind === "divorce" && /divorce|separat/.test(hay)) score += 5;
        if (kind === "neighbour" && /neighbour|noise|antisocial/.test(hay)) score += 5;
        return { page, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const extras: OptionExtraNote[] = [];
    const seen = new Set<string>();
    for (const { page } of scored) {
      const pageUrl =
        page.primaryUrl ||
        page.sourceUrls?.[0] ||
        page.oslawSteps?.[0]?.sourceUrl ||
        page.toolMeta?.url ||
        undefined;
      const step = page.oslawSteps?.[0];
      if (step) {
        const detail = stripUrls(`${step.label}: ${step.detail}`);
        if (detail.length > 20 && !seen.has(detail)) {
          seen.add(detail);
          extras.push({ text: detail, url: step.sourceUrl || pageUrl });
        }
      } else {
        const snip = stripUrls(page.snippet || "");
        if (snip.length > 40 && !/^\d+\s+sources/i.test(snip) && !seen.has(page.title)) {
          seen.add(page.title);
          extras.push({
            text: `${page.title}: ${snip.slice(0, 160)}`,
            url: pageUrl,
          });
        }
      }
    }
    return extras.slice(0, 3);
  } catch {
    return [];
  }
}

async function exaFillGaps(
  kind: DisputeKind,
  story: string,
): Promise<{ extras: string[]; source: "offline" | "live" | "cache" | "none" }> {
  const solicitor = isSolicitorComplaintStory(story);
  const query = solicitor
    ? solicitorComplaintSearchQuery(story)
    : `${wikiQueryFor(kind, story)} England Wales options process`;
  const matterSlug = solicitor ? "solicitor_complaint" : kind === "divorce" ? "family" : kind;
  const cacheKey = buildExaHitsCacheKey(query, matterSlug);

  const cached = await getPenumbraExaHitsCache(cacheKey);
  if (cached?.hits?.length) {
    return {
      source: "cache",
      extras: cached.hits
        .slice(0, 4)
        .map((h) => stripUrls(`${h.title}: ${h.excerpt}`))
        .filter((t) => t.length > 30),
    };
  }

  if (penumbraOfflineExaEnabled()) {
    const offline = searchOfflineExaIndexForPenumbra(query, {
      matterSlug,
      limit: 6,
      story,
    });
    if (offline.hits.length >= 2) {
      await putPenumbraExaHitsCache({
        cacheKey,
        query,
        matterSlug,
        hits: offline.hits,
      });
      return {
        source: "offline",
        extras: offline.hits
          .slice(0, 4)
          .map((h) => stripUrls(`${h.title}: ${h.excerpt}`))
          .filter((t) => t.length > 30),
      };
    }
  }

  // Production default: no live Exa (use cache/offline). Local/dev: live when key set.
  if (!exaPenumbraConfigured() || !penumbraLiveExaEnabled()) {
    return { extras: [], source: "none" };
  }

  try {
    const live = await searchExaForPenumbra(query, {
      numResults: solicitor ? 8 : 6,
      scope: solicitor ? "open" : "allowlist",
    });
    if (live.hits.length) {
      await putPenumbraExaHitsCache({
        cacheKey,
        query,
        matterSlug,
        hits: live.hits,
      });
      return {
        source: "live",
        extras: live.hits
          .slice(0, 4)
          .map((h) => stripUrls(`${h.title}: ${h.excerpt}`))
          .filter((t) => t.length > 30),
      };
    }
  } catch (error) {
    console.warn(
      "[cases/explain] Exa fill failed:",
      error instanceof Error ? error.message : error,
    );
  }

  return { extras: [], source: "none" };
}

export type ExplainOptionsResult = {
  kind: DisputeKind;
  /** Short separate chat turns — prefer this over explanationText. */
  explanationMessages: string[];
  explanationText: string;
  options: ExplainedOption[];
  financingNotes: ExplainedOption[];
  gapFillSource: "wiki" | "offline" | "live" | "cache" | "guide_only";
};

export async function explainDisputeOptions(input: {
  kind: DisputeKind;
  story: string;
  disputeAnswers?: Record<string, string>;
}): Promise<ExplainOptionsResult> {
  const guide = getProcessGuide(input.kind);
  const fromWiki = await wikiExtras(input.kind, input.story);
  let extras: OptionExtraNote[] = fromWiki;
  let gapFillSource: ExplainOptionsResult["gapFillSource"] =
    fromWiki.length >= 2 ? "wiki" : "guide_only";

  // Always Exa-fill solicitor complaints — wiki packs rarely cover LeO/SRA paths.
  if (fromWiki.length < 2 || isSolicitorComplaintStory(input.story)) {
    const filled = await exaFillGaps(input.kind, input.story);
    if (filled.extras.length) {
      extras = [
        ...fromWiki,
        ...filled.extras.map((text) => ({ text })),
      ];
      gapFillSource =
        filled.source === "none" ? "guide_only" : (filled.source as ExplainOptionsResult["gapFillSource"]);
    }
  }

  // Personalise lightly from dispute answers without inventing advice
  const personal: OptionExtraNote[] = [];
  const da = input.disputeAnswers || {};
  if (input.kind === "divorce") {
    const app = (da.divorce_application || "").toLowerCase();
    if (/sole|one[- ]?sid|don'?t agree|does not agree|disagree/.test(app)) {
      personal.push({
        text: "From what you said, a sole application may fit better than a joint one if they won’t cooperate.",
        url: "https://www.gov.uk/divorce/before-you-apply",
      });
    } else if (/joint|mutual|both agree|we agree/.test(app)) {
      personal.push({
        text: "From what you said, a joint application may be possible if you both agree and you feel safe.",
        url: "https://www.gov.uk/divorce/before-you-apply",
      });
    }
    if (/\b(yes|child|kid|son|daughter)\b/i.test(da.divorce_children || "")) {
      personal.push({
        text: "You’ll want a clear plan for the children separately from the divorce form itself.",
        url: "https://www.gov.uk/looking-after-children-divorce",
      });
    }
    if (/\b(home|house|pension|saving|market|complex|yes)\b/i.test(da.divorce_assets || "")) {
      personal.push({
        text: "With a home or pensions involved, sorting money carefully (and often a consent order) matters before you finalise.",
        url: "https://www.gov.uk/money-property-when-relationship-ends",
      });
    }
  }

  const explanationMessages = formatOptionsMessages(guide, {
    extras: [...personal, ...extras].slice(0, 4),
  });

  return {
    kind: input.kind,
    explanationMessages,
    explanationText: explanationMessages.join("\n\n"),
    options: guide.options,
    financingNotes: guide.financingNotes,
    gapFillSource,
  };
}
