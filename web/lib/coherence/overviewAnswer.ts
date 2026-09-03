import "server-only";

import { chat, llmConfigured } from "@/lib/llm/client";
import { enableOverviewSynthesis, resolveOverviewModel } from "@/lib/llm/answer-config";
import { sanitizeSignpostingText } from "@/lib/guardrails/validator";
import {
  clearWikiAnswerCacheForTests,
  generateWikiAnswer,
  generateWikiAnswerFromHits,
  retrieveWikiHitsForQuery,
} from "@/lib/wiki/generate-answer";
import { getWikiPageById, searchWikiPages } from "@/lib/wiki/search";
import {
  isSharedHousingQuery,
  rerankSharedHousingHits,
  rerankFamilyBelongingsHits,
  stableSortWikiHits,
  filterOffTopicPropertyPurchaseHits,
} from "@/lib/wiki/rerank-hits";
import {
  isFamilyBelongingsPropertyClaim,
  isPropertyPurchaseMisrepresentationQuery,
} from "@/lib/legal/query-signals";
import { pickRecommendedFirms } from "@/lib/wiki/firm-recommendations";
import { applyDworkinBoostToWikiHits } from "@/lib/wiki/dworkin-tags";
import { retrieveDworkinSnippetsForOverview } from "@/lib/coherence/overviewDworkinPack";
import { KnowledgeRetriever, matterEvidenceToWikiHits } from "@/lib/matter/retrieve";
import { titleAllowedOnGraph } from "@/lib/matter/issueGraphHits";
import type { MatterFrame } from "@/lib/matter/types";
import {
  defaultAnswerFollowUps,
  type AnswerPackage,
} from "@/lib/coherence/answerPackage";
import {
  HARD_SEARCH_GUARDRAILS,
  normalizeSearchMode,
  searchModePolicy,
} from "@/lib/coherence/searchMode";
import { formatCaseBrief, buildCaseLedOverview } from "@/lib/coherence/caseBuilder";
import type { ResearchBundle } from "@/lib/coherence/researchBundle";
import {
  coverageSlotsFrom,
  isOfficialAuthoritySource,
  rankByCoverage,
  slotRetryQueries,
  titleCoversGraph,
} from "@/lib/matter/coverageSlots";
import {
  filterAdmissibleTitles,
  freeHelpAdmissibleOnGeometry,
  isNeighbourAttractorTitle,
} from "@/lib/matter/graphAdmissibility";

const OVERVIEW_SYSTEM = `You are Legal Shaman's Overview agent — a research agent that builds the client's case from the CASE FILE, WIKI CONTEXT (library), and optional Third Eye notes.

Write a practical UK signposting recommendation that helps the client decide what to do next. Do not merely list search results.

Rules:
1. Treat the CASE FILE as frozen. Cover every primary and secondary issue on the graph. Never switch the matter to an excluded topic (e.g. discrimination, child arrangements) just because a neighbouring wiki page ranked.
2. Treat WIKI CONTEXT and DWORKIN AUTHORITY as the curated foundation. A supplemental Third Eye / Penumbra bundle is unverified lead material: use it to fill gaps, name uncertainty, and never treat an unsupported external claim as established law. Do not invent statutes, outcomes, or firm endorsements.
3. Open with one short line: the client was recommended by LegalShaman.com (signposting only — not a paid referral, not legal advice).
4. Structure the answer as a case, in this order:
   - The matter (what is actually live on these facts)
   - Area of law (primary, then secondary strands such as withheld wages)
   - What is live now vs later (e.g. homelessness tonight vs ACAS pay)
   - Next steps in time order, grounded in the sources
   - Facts that would change the route
5. Answer the client's actual questions. If they were already forced out, do not write as if they still have a quiet week before a notice date.
6. Prefer concrete next steps grounded in the pages. Prefer rule-tagged sources for what to do, principle-tagged sources for fairness questions, and treat policy-tagged sources as background.
7. Do NOT predict win/lose. Do NOT say "you should definitely".
8. Keep it concise: about 280–520 words. Short section headings allowed (plain lines, not markdown #).
9. End with one sentence: this is Legal Shaman signposting from curated and clearly labelled supplemental sources — get a Citizens Advice or solicitor check before filing if wording is uncertain.
10. If the library titles do not cover the client's live questions, say the library is thin and cite only admitted pages. Never complete the page with housing, garden, right of way, tenancy deposit, package holiday, smart meter, motoring/PCN, consumer-scam, or “item hasn't arrived” guidance unless that issue is on the frozen graph.
11. When the asker owns seized work kit (employer / company laptop), do not write as if they are the arrested person. Criminal defence is for the arrested person only; recovering employer property is a separate route.
12. Only cite titles that appear in WIKI CONTEXT or admitted Third Eye notes. Do not invent pages to fill the list.
13. If Master Critic feedback is provided, fix every listed failure before answering.
14. Give at least two realistic options where the sources support more than one route.
15. Takeaways and next steps must be short practical actions. Never paste the client's questions, "Your live questions:", or a string with two or more question marks.
16. Return JSON only:
{
  "answer": "full recommendation text",
  "wikiPageTitles": ["exact titles used from context"],
  "takeaways": ["up to 5 short practical takeaways"],
  "recommendations": ["up to 4 concrete next steps"],
  "options": [{"title": "short route name", "description": "what this route involves and when it may fit"}],
  "missingFacts": ["facts that could materially change the guidance"],
  "followUpPrompts": ["up to 3 useful clarification or refinement prompts"]
}`;

export function collectOverviewHits(query: string) {
  if (isPropertyPurchaseMisrepresentationQuery(query)) {
    const extras = [
      "property misrepresentation claims",
      "buying and selling a home",
      "types of misrepresentation explained",
      "what to do if your house sale falls through",
    ];
    const byId = new Map<string, ReturnType<typeof searchWikiPages>[number]>();
    for (const hit of retrieveWikiHitsForQuery(query, 12)) {
      byId.set(hit.id, hit);
    }
    for (const phrase of extras) {
      for (const hit of searchWikiPages(phrase, 4)) {
        const existing = byId.get(hit.id);
        if (!existing || hit.score > existing.score) byId.set(hit.id, hit);
      }
    }
    let hits = filterOffTopicPropertyPurchaseHits(query, [...byId.values()]);
    hits = hits.filter((h) => {
      const t = h.title.toLowerCase();
      if (/travel agent|business agent|used car|consumer contracts.*regulations/i.test(t)) return false;
      return true;
    });
    const pin = [
      /property misrepresentation/i,
      /buying and selling a home/i,
      /misrepresentation/i,
      /house sale falls through/i,
    ];
    const pinned: typeof hits = [];
    const rest = [...hits];
    for (const re of pin) {
      const idx = rest.findIndex((h) => re.test(h.title));
      if (idx >= 0) pinned.push(...rest.splice(idx, 1));
    }
    return applyDworkinBoostToWikiHits([...pinned, ...rest]).slice(0, 8);
  }
  if (isFamilyBelongingsPropertyClaim(query)) {
    const extras = [
      "deciding whether to make a small claim",
      "small claims court and letter before action",
      "letter before action small claims",
      "money claim online",
      "household items and personal belongings after separation",
      "property damage compensation small claims",
    ];
    const byId = new Map<string, ReturnType<typeof searchWikiPages>[number]>();
    for (const hit of retrieveWikiHitsForQuery(query, 12)) {
      byId.set(hit.id, hit);
    }
    for (const phrase of extras) {
      for (const hit of searchWikiPages(phrase, 5)) {
        const existing = byId.get(hit.id);
        if (!existing || hit.score > existing.score) byId.set(hit.id, hit);
      }
    }
    let hits = rerankFamilyBelongingsHits(query, [...byId.values()]);
    hits = hits.filter((h) => {
      const t = h.title.toLowerCase();
      if (/types of court orders in family|child arrangements and custody|contact order|care order/i.test(t)) {
        return false;
      }
      if (/divorce financial|ancillary relief|prenup|living together and marriage/i.test(t)) return false;
      if (
        /tenant|tenancy|section\s*21|section\s*8|eviction|landlord|leasehold|enfranchisement|inheritance tax|10-?year charge|disinherit|mesher order|parent of a child who lives|indefinite leave/i.test(
          t,
        )
      ) {
        return false;
      }
      return true;
    });
    const pin = [
      /deciding whether to make a small claim/i,
      /letter before action/i,
      /small claims court/i,
      /money claim/i,
      /personal belongings|household items/i,
      /property damage|compensation/i,
    ];
    const pinned: typeof hits = [];
    const rest = [...hits];
    for (const re of pin) {
      const idx = rest.findIndex((h) => re.test(h.title));
      if (idx >= 0) pinned.push(...rest.splice(idx, 1));
    }
    return applyDworkinBoostToWikiHits([...pinned, ...rest]).slice(0, 8);
  }
  if (!isSharedHousingQuery(query)) {
    return retrieveWikiHitsForQuery(query, 8)
  }
  let hits = searchWikiPages(query, 16)
  if (isSharedHousingQuery(query)) {
    const extras = [
      "check your rights if you share accommodation",
      "dispute a mobile phone internet or tv bill",
      "check if you have to pay a debt",
      "if someone has harassed you in housing",
      "check what you can do about harassment",
      "home cctv systems",
      "can my neighbour record me on cctv",
      "letter before action small claims",
    ]
    const byId = new Map(hits.map((h) => [h.id, h]))
    for (const phrase of extras) {
      for (const hit of searchWikiPages(phrase, 5)) {
        const existing = byId.get(hit.id)
        if (!existing || hit.score > existing.score) byId.set(hit.id, hit)
      }
    }
    hits = rerankSharedHousingHits(query, [...byId.values()])
    hits = hits.filter((h) => {
      const t = h.title.toLowerCase()
      if (/section 13|rent increase|rent-to-own|shared ownership|share of freehold/.test(t)) return false
      if (/transferring property ownership|water supply|party wall|boundary|bamboo|hedge/.test(t)) return false
      if (/\bndas?\b|non-disclosure|lasting power|wills and/.test(t)) return false
      if (/landlord is taking me to court|breathing space|tenant abandonment/.test(t)) return false
      if (/sponsoring family|visa|immigration|indefinite leave/.test(t)) return false
      return true
    })
    // Pin the most useful pages to the front when present
    const pin = [
      /share accommodation/i,
      /dispute a mobile|internet or tv bill/i,
      /harassed you in housing|check what you can do about harassment/i,
      /cctv|record me/i,
      /letter before action/i,
      /check if you have to pay a debt/i,
    ]
    const pinned: typeof hits = []
    const rest = [...hits]
    for (const re of pin) {
      const idx = rest.findIndex((h) => re.test(h.title))
      if (idx >= 0) pinned.push(...rest.splice(idx, 1))
    }
    hits = [...pinned, ...rest]
    return applyDworkinBoostToWikiHits(hits).slice(0, 8)
  }
  return applyDworkinBoostToWikiHits(stableSortWikiHits(hits)).slice(0, 8)
}

function buildContext(
  hits: ReturnType<typeof searchWikiPages>,
  dworkin: ReturnType<typeof retrieveDworkinSnippetsForOverview>,
): string {
  const wikiBlock = hits
    .map((hit, i) => {
      const page = getWikiPageById(hit.id);
      const keys = (hit.keyInformation || []).slice(0, 5).join(" · ");
      const guide = (hit.practicalGuidance || []).slice(0, 4).join(" · ");
      const excerpt = (page?.content || hit.summary || "").replace(/\s+/g, " ").trim().slice(0, 1400);
      const kind = hit.dworkinKind ? `Dworkin: ${hit.dworkinKind} (${hit.dworkinSource || "inferred"})` : "";
      return [
        `### ${i + 1}. ${hit.title}`,
        kind,
        hit.category ? `Category: ${hit.category}` : "",
        hit.summary ? `Summary: ${hit.summary}` : "",
        keys ? `Key: ${keys}` : "",
        guide ? `Guidance: ${guide}` : "",
        excerpt ? `Excerpt: ${excerpt}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  if (!dworkin.length) return wikiBlock;

  const authority = dworkin
    .map((s, i) =>
      [
        `### D${i + 1}. [${s.dworkinKind}] ${s.title}`,
        `Layer: ${s.layer} · Authority: ${s.authority}`,
        s.url ? `URL: ${s.url}` : "",
        s.snippet ? `Snippet: ${s.snippet}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n---\n\n");

  return `${wikiBlock}\n\n==== DWORKIN AUTHORITY (same taxonomy — rule > principle > policy) ====\n\n${authority}`;
}

function formatResearchBundle(bundle: ResearchBundle): string {
  return [
    "==== THE SHAMAN RESEARCH NOTES (supplemental; verify against WIKI CONTEXT) ====",
    `Status: ${bundle.status}`,
    bundle.questions.length ? `Questions still open: ${bundle.questions.join(" · ")}` : "",
    bundle.matching
      ? `Matching lens: ${bundle.matching.matterType} / ${bundle.matching.topicId} (${bundle.matching.confidence}) — ${bundle.matching.rationale}`
      : "",
    bundle.sources
      .map(
        (source) =>
          `[${source.id}] ${source.title} (${source.origin === "external" ? "external/unverified" : "curated"}; ${source.tier})\n${source.excerpt}`,
      )
      .join("\n\n"),
    "Claims:",
    bundle.claims
      .map(
        (claim) =>
          `- ${claim.claim} [${claim.confidence}; sources: ${claim.sourceIds.join(", ")}]`,
      )
      .join("\n"),
    bundle.conflicts.length ? `Conflicts: ${bundle.conflicts.join(" · ")}` : "",
    bundle.missingFacts.length ? `Missing facts: ${bundle.missingFacts.join(" · ")}` : "",
    bundle.nextActions.length ? `Research next actions: ${bundle.nextActions.join(" · ")}` : "",
    bundle.freeResources.length
      ? `Free-resource leads (pending review; do not treat as verified):\n${bundle.freeResources
          .map((resource) => `- ${resource.title} (${resource.resourceType}) — ${resource.url}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function attachResearchBundle(pack: AnswerPackage, bundle?: ResearchBundle): AnswerPackage {
  return bundle ? { ...pack, researchBundle: bundle } : pack
}

function admitResearchBundle(
  bundle: ResearchBundle | undefined,
  frame: MatterFrame | null | undefined,
  story: string,
): ResearchBundle | undefined {
  if (!bundle || !frame) return bundle;
  const slots = coverageSlotsFrom(frame, story);
  const sources = bundle.sources.filter((source) => {
    const hay = `${source.title} ${source.url} ${source.excerpt || ""}`;
    if (isNeighbourAttractorTitle(source.title, frame, story)) return false;
    if (slots.length && !titleCoversGraph(hay, slots, story)) return false;
    return true;
  });
  const kept = new Set(sources.map((source) => source.id));
  sources.sort((a, b) => {
    const ao = isOfficialAuthoritySource(a.title, a.url, a.excerpt) ? 1 : 0;
    const bo = isOfficialAuthoritySource(b.title, b.url, b.excerpt) ? 1 : 0;
    return bo - ao;
  });
  return {
    ...bundle,
    sources,
    claims: bundle.claims.filter((claim) => claim.sourceIds.some((id) => kept.has(id))),
    freeResources: bundle.freeResources.filter((resource) =>
      freeHelpAdmissibleOnGeometry(resource.title, resource.description, story),
    ),
  };
}

type ParsedOverview = {
  answer?: string;
  wikiPageTitles?: string[];
  takeaways?: string[];
  recommendations?: string[];
  options?: Array<{ title?: string; description?: string } | string>;
  missingFacts?: string[];
  followUpPrompts?: string[];
};

function parseJson(raw: string): ParsedOverview | null {
  try {
    return JSON.parse(raw) as ParsedOverview;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as ParsedOverview;
    } catch {
      return null;
    }
  }
}

function cleanList(value: unknown, limit: number, minLength = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
    .filter((item) => item.length >= minLength)
    .slice(0, limit);
}

function looksLikeQuestionDump(text: string): boolean {
  const s = String(text || "");
  if (/your live questions:|cover the client's live questions/i.test(s)) return true;
  return (s.match(/\?/g) || []).length >= 2;
}

function practicalLines(value: unknown, limit: number): string[] {
  return cleanList(value, limit).filter((item) => !looksLikeQuestionDump(item));
}

function toPackage(
  answer: string,
  hits: ReturnType<typeof searchWikiPages>,
  takeaways: string[],
  origin: "retrieve-llm" | "retrieve-deterministic",
  query = "",
  dworkin: ReturnType<typeof retrieveDworkinSnippetsForOverview> = [],
  guidance?: {
    recommendations?: string[];
    options?: AnswerPackage['options'];
    missingFacts?: string[];
    followUpPrompts?: string[];
  },
): AnswerPackage {
  const firms = pickRecommendedFirms(query || hits.map((h) => h.title).join(" "), hits).slice(
    0,
    3,
  );

  const sources: AnswerPackage["sources"] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const page = getWikiPageById(hit.id);
    for (const raw of page?.sources ?? []) {
      const title = raw
        .replace(/\*\*/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      sources.push({ title: title.slice(0, 160), url: "", kind: "wiki-source" });
      if (sources.length >= 8) break;
    }
    if (sources.length >= 8) break;
  }
  for (const snippet of dworkin) {
    const title = snippet.title.trim();
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    sources.push({
      title: title.slice(0, 160),
      url: snippet.url || "",
      kind: `dworkin-${snippet.dworkinKind}`,
    });
    if (sources.length >= 10) break;
  }

  const parsedRecommendations = practicalLines(guidance?.recommendations, 4);
  const recs = practicalLines(takeaways, 5);
  const recommendations = parsedRecommendations.length ? parsedRecommendations : recs.slice(0, 4);
  const parsedOptions = (guidance?.options || [])
    .map((item) =>
      typeof item === 'string'
        ? { title: item, description: '' }
        : {
            title: String(item.title || '').replace(/\s+/g, ' ').trim(),
            description: String(item.description || '').replace(/\s+/g, ' ').trim(),
          },
    )
    .filter((item) => item.title.length >= 4)
    .slice(0, 4);
  const options = parsedOptions.length
    ? parsedOptions
    : [
        {
          title: 'Follow the recommended next steps',
          description: 'Use the cited guidance and evidence checklist to progress the matter yourself.',
        },
        {
          title: 'Get independent help',
          description: 'Ask Citizens Advice or a solicitor to review the facts if the route or wording is uncertain.',
        },
      ];
  const parsedMissingFacts = cleanList(guidance?.missingFacts, 5);
  const missingFacts = parsedMissingFacts.length
    ? parsedMissingFacts
    : ['Exact dates, documents, contract or notice wording, and the outcome you want.'];
  const followUpPrompts = cleanList(guidance?.followUpPrompts, 3);

  return {
    answerOverview: answer,
    bullets: recs.slice(0, 5).map((t) => ({
      text: t,
      sourceTitle: hits[0]?.title || "Legal Shaman wiki",
      sourceUrl: "https://www.citizensadvice.org.uk/",
      tier: "areas",
    })),
    recommendations,
    options,
    missingFacts,
    followUps: defaultAnswerFollowUps(missingFacts).map((item, index) => ({
      ...item,
      prompt: followUpPrompts[index] || item.prompt,
    })),
    wikiPages: (() => {
      const seen = new Set<string>();
      const pages: { title: string; path: string; tier: "areas" }[] = [];
      for (const h of hits) {
        const key = h.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        pages.push({ title: h.title, path: h.id, tier: "areas" });
        if (pages.length >= 7) break;
      }
      return pages;
    })(),
    freeHelp: [
      {
        title: "Citizens Advice",
        url: "https://www.citizensadvice.org.uk/get-advice/",
        blurb: "Free guidance — start here before paid advice.",
      },
    ],
    recommendedFirms: firms.map((f) => ({
      name: f.firm,
      directoryUrl: f.directory_url,
      note: `${f.practiceArea} · ${f.article_count}+ articles`,
    })),
    sources,
    matchedTopicId: "vault-synthesized",
    policyNote:
      "Signposting from the Legal Shaman wiki — not legal advice. Free help first.",
    citation: { ok: true, issues: [] },
    ...( { origin } as object ),
  } as unknown as AnswerPackage & { origin: string };
}

/**
 * Coherence Overview answer: retrieve Legal Shaman wiki → synthesise practical recommendation.
 */
export async function buildOverviewAnswer(opts: {
  latestText: string;
  understanding?: string;
  clientQuestion?: string;
  critique?: string | null;
  taxonomySlug?: string | null;
  matterFrame?: MatterFrame | null;
  searchMode?: 'umbra' | 'penumbra';
  researchBundle?: ResearchBundle;
  followUp?: {
    kind: 'clarify' | 'add_detail' | 'refine';
    text: string;
    priorAnswer?: string;
  };
}): Promise<{ answerPackage: AnswerPackage; meta: Record<string, unknown> }> {
  const latestText = opts.latestText.trim();
  const policy = searchModePolicy(normalizeSearchMode(opts.searchMode));
  const searchBlob = [opts.clientQuestion, opts.understanding, latestText]
    .filter(Boolean)
    .join("\n\n");

  const taxonomySlug =
    opts.taxonomySlug ||
    opts.matterFrame?.primaryIssues[0]?.slug ||
    null;

  let hits;
  let retrievalMeta: Record<string, unknown> = {};

  if (opts.matterFrame) {
    const evidence = KnowledgeRetriever.forMatter({
      matterFrame: opts.matterFrame,
      submission: latestText,
      limit: policy.retrievalBreadth === 'broad' ? 14 : 8,
    });
    hits = matterEvidenceToWikiHits(evidence.hits);
    const slots = coverageSlotsFrom(opts.matterFrame, latestText);
    hits = rankByCoverage(hits, slots, { story: latestText, limit: hits.length || 8 });
    hits = filterAdmissibleTitles(hits, opts.matterFrame, latestText, { requireCoverage: true });
    retrievalMeta = {
      retrievalMode: evidence.mode,
      retrievalIntents: evidence.intents,
      matterId: opts.matterFrame.matterId,
    };
    // Belongings / shared-housing: merge legacy curated collect so live matches local special cases
    if (isFamilyBelongingsPropertyClaim(searchBlob) || isSharedHousingQuery(searchBlob)) {
      const curated = collectOverviewHits(searchBlob);
      const byId = new Map(hits.map((h) => [h.id, h]));
      for (const hit of curated) {
        const existing = byId.get(hit.id);
        if (!existing || hit.score > existing.score) byId.set(hit.id, hit);
      }
      hits = isFamilyBelongingsPropertyClaim(searchBlob)
        ? rerankFamilyBelongingsHits(searchBlob, [...byId.values()]).slice(0, 8)
        : rerankSharedHousingHits(searchBlob, [...byId.values()]).slice(0, 8);
      retrievalMeta = {
        ...retrievalMeta,
        retrievalMode: `${evidence.mode}+collectOverviewHits`,
      };
    } else {
      const slots = coverageSlotsFrom(opts.matterFrame, latestText);
      const byId = new Map(hits.map((h) => [h.id, h]));
      for (const { query } of slotRetryQueries(
        slots,
        hits.map((h) => h.title),
        latestText,
      )) {
        for (const hit of filterAdmissibleTitles(
          collectOverviewHits(query),
          opts.matterFrame,
          latestText,
          { requireCoverage: true },
        )) {
          const existing = byId.get(hit.id);
          if (!existing || hit.score > existing.score) byId.set(hit.id, hit);
        }
      }
      if (hits.length < 2) {
        for (const hit of filterAdmissibleTitles(
          collectOverviewHits(searchBlob),
          opts.matterFrame,
          latestText,
          { requireCoverage: true },
        )) {
          const existing = byId.get(hit.id);
          if (!existing || hit.score > existing.score) byId.set(hit.id, hit);
        }
      }
      hits = rankByCoverage([...byId.values()], slots, { story: latestText, limit: 8 });
      retrievalMeta = {
        ...retrievalMeta,
        retrievalMode: `${evidence.mode}+slot-retry`,
      };
    }
  } else {
    hits = collectOverviewHits(searchBlob);
    if (policy.retrievalBreadth === 'broad') {
      const broadHits = retrieveWikiHitsForQuery(searchBlob, 14);
      const byId = new Map(hits.map((hit) => [hit.id, hit]));
      for (const hit of broadHits) {
        const existing = byId.get(hit.id);
        if (!existing || hit.score > existing.score) byId.set(hit.id, hit);
      }
      hits = stableSortWikiHits([...byId.values()]).slice(0, 14);
    }
    retrievalMeta = { retrievalMode: "legacy-collectOverviewHits" };
  }
  const dworkin = retrieveDworkinSnippetsForOverview({
    query: searchBlob,
    taxonomySlug,
    excludeTitles: hits.map((h) => h.title),
    limit: policy.retrievalBreadth === 'broad' ? 8 : 4,
  }).filter((s) => {
    if (opts.matterFrame && !titleAllowedOnGraph(s.title, opts.matterFrame)) return false;
    if (!opts.matterFrame) return true;
    const slots = coverageSlotsFrom(opts.matterFrame, latestText);
    return titleCoversGraph(s.title, slots, latestText) || slots.length === 0;
  });
  const packMeta = {
    taxonomySlug,
    searchMode: policy.mode,
    searchBreadth: policy.retrievalBreadth,
    ...retrievalMeta,
    dworkinKinds: [
      ...hits.map((h) => h.dworkinKind).filter(Boolean),
      ...dworkin.map((s) => s.dworkinKind),
    ],
    dworkinTitles: dworkin.map((s) => s.title),
  };
  const searchMode = normalizeSearchMode(opts.searchMode);

  const storyBlock = [
    opts.matterFrame ? formatCaseBrief(opts.matterFrame, latestText, opts.clientQuestion) : "",
    opts.understanding ? `Brief understanding: ${opts.understanding}` : "",
    opts.clientQuestion ? `Client questions: ${opts.clientQuestion}` : "",
    `Situation:\n${latestText}`,
    `Search mode: ${policy.label}\n${policy.promptInstruction}\n${HARD_SEARCH_GUARDRAILS}`,
    opts.critique
      ? `Master Critic feedback (fix these failures):\n${opts.critique}`
      : "",
    opts.followUp
      ? `Client follow-up (${opts.followUp.kind}) — incorporate this into the revised guidance:\n${opts.followUp.text}`
      : "",
    opts.followUp?.priorAnswer
      ? `Prior overview focus (revise it; do not blindly repeat it):\n${opts.followUp.priorAnswer.slice(0, 1800)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const admittedBundle = admitResearchBundle(opts.researchBundle, opts.matterFrame, latestText);
  const wikiContext =
    hits.length > 0
      ? buildContext(hits, dworkin)
      : "No admitted Legal Shaman wiki pages cover the live questions. Say the library is thin. Use only admitted Third Eye notes below, if any.";
  if (llmConfigured() && enableOverviewSynthesis() && (opts.matterFrame || hits.length >= 2)) {
    const supplementalResearch = admittedBundle
      ? `\n\n${formatResearchBundle(admittedBundle)}`
      : "";
    try {
      const raw = await chat(
        [
          { role: "system", content: OVERVIEW_SYSTEM },
          {
            role: "user",
            content: `${storyBlock}\n\nWIKI CONTEXT:\n${wikiContext}${supplementalResearch}\n\nRespond with JSON only.`,
          },
        ],
        {
          jsonMode: true,
          temperature: 0.2,
          maxTokens: 1800,
          model: resolveOverviewModel(),
          purpose: "final_synthesis",
          caller: "overviewAnswer",
        },
      );
      const parsed = parseJson(raw);
      let answer = sanitizeSignpostingText((parsed?.answer || "").trim());
      if (answer.length >= 160) {
        // Keep wiki page order preferred; optionally reorder by titles LLM used
        const preferredTitles = new Set(
          (parsed?.wikiPageTitles || []).map((t) => t.toLowerCase()),
        );
        const ordered =
          preferredTitles.size > 0
            ? [
                ...hits.filter((h) => preferredTitles.has(h.title.toLowerCase())),
                ...hits.filter((h) => !preferredTitles.has(h.title.toLowerCase())),
              ]
            : hits;
        const takeaways = practicalLines(parsed?.takeaways, 5);
        const options = Array.isArray(parsed?.options)
          ? parsed.options
              .map((item) =>
                typeof item === 'string'
                  ? { title: item, description: '' }
                  : {
                      title: String(item?.title || ''),
                      description: String(item?.description || ''),
                    },
              )
              .filter((item) => item.title.trim().length >= 4)
              .slice(0, 4)
          : [];
        return {
          answerPackage: attachResearchBundle(
            toPackage(answer, ordered, takeaways, "retrieve-llm", latestText, dworkin, {
              recommendations: practicalLines(parsed?.recommendations, 4),
              options,
              missingFacts: cleanList(parsed?.missingFacts, 5),
              followUpPrompts: cleanList(parsed?.followUpPrompts, 3),
            }),
            admittedBundle,
          ),
          meta: {
            mode: "synthesis",
            retrievalScore: ordered[0]?.score ?? 0,
            pageTitles: ordered.slice(0, 6).map((h) => h.title),
            used: "coherence-overview-llm",
            arambPilot: Boolean(admittedBundle),
            ...packMeta,
          },
        };
      }
    } catch (err) {
      console.warn(
        "[coherence-overview] LLM synthesis failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Deterministic practical fallback for shared housing (avoid cancel-contract boilerplate)
  if (
    isSharedHousingQuery(latestText) &&
    hits.length >= 2 &&
    !/illegal evict|door.{0,24}removed|no front door|forced .{0,30}(?:leave|vacate)|homeless/i.test(latestText)
  ) {
    const primary = hits.find((h) => /share accommodation/i.test(h.title)) || hits[0];
    const bill = hits.find((h) => /dispute a mobile|internet or tv bill/i.test(h.title));
    const harass = hits.find((h) => /harass/i.test(h.title));
    const camera = hits.find((h) => /cctv|camera|record/i.test(h.title));
    const lba = hits.find((h) => /letter before/i.test(h.title));
    const parts = [
      "This client was recommended by LegalShaman.com (signposting only — not a paid referral, not legal advice).",
      "",
      "Shared accommodation / joint tenancy",
      primary?.summary
        ? `${primary.title}: ${primary.summary.slice(0, 320)}`
        : "Shared housing arrangements vary (joint tenancy vs exclusive room). Check the matched page on sharing accommodation for how liability is usually framed.",
      "",
      "Broadband / WiFi",
      bill?.summary
        ? `${bill.title}: ${bill.summary.slice(0, 280)}`
        : "Where a phone/internet account is in one name, guidance commonly treats the named account holder as the person the provider pursues — household contribution agreements are usually pursued separately.",
      "Sources do not usually treat changing a WiFi password on a sole-name broadband account the same as cutting essential metered utilities. Keep safety and evidence in mind if threats are live.",
      "",
      "Cameras / threats",
      camera?.summary
        ? `${camera.title}: ${camera.summary.slice(0, 260)}`
        : "Camera / recording guidance often turns on whether shared or other people’s spaces (and audio) are captured — ICO-style home CCTV pages are the usual starting point.",
      harass?.summary
        ? `${harass.title}: ${harass.summary.slice(0, 260)}`
        : "If threats or harassment are involved, keep a dated evidence trail and use police (999 if in danger / 101 otherwise) alongside civil options where relevant.",
      "",
      "Letter before action / money claim",
      lba?.summary
        ? `${lba.title}: ${lba.summary.slice(0, 280)}`
        : "For unpaid contributions you can evidence, a letter before action usually sets out what is owed, the evidence, a deadline, and that court may follow — claim what has fallen due and can be shown.",
      "",
      "This is curated signposting from indexed sources — get a Citizens Advice or solicitor check before filing if wording is uncertain.",
    ];
    const takeaways = [
      "Start from how the tenancy is set up (joint vs sole room) — see shared accommodation guidance.",
      "Sole-name broadband is usually pursued by the provider against the named holder; recover agreed shares separately if evidenced.",
      "Treat threats as a safety issue first; keep messages, dates, and notes.",
      "For an LBA, claim amounts already due that you can evidence; add later periods if they become unpaid.",
      "Use Citizens Advice before paid solicitors.",
    ];
    return {
      answerPackage: attachResearchBundle(
        toPackage(
          parts.join("\n"),
          hits,
          takeaways,
          "retrieve-deterministic",
          latestText,
          dworkin,
        ),
        admittedBundle,
      ),
      meta: {
        mode: "retrieval_only",
        retrievalScore: hits[0]?.score ?? 0,
        pageTitles: hits.slice(0, 6).map((h) => h.title),
        used: "shared-housing-deterministic",
        arambPilot: Boolean(admittedBundle),
        ...packMeta,
      },
    };
  }

  // Case-shaped fallback: MatterFrame + admitted wiki hits (weak graph → honest short case).
  if (opts.matterFrame) {
    const slots = coverageSlotsFrom(opts.matterFrame, latestText);
    const supplemental = (admittedBundle?.sources || [])
      .filter((s) => s.origin === "external" && s.url)
      .filter((s) => titleCoversGraph(`${s.title} ${s.url} ${s.excerpt || ""}`, slots, latestText))
      .filter((s) => !isNeighbourAttractorTitle(s.title, opts.matterFrame!, latestText))
      .slice(0, 10)
      .map((s) => ({ title: s.title, url: s.url }));
    const cased = buildCaseLedOverview({
      story: latestText,
      frame: opts.matterFrame,
      clientQuestion: opts.clientQuestion,
      hitTitles: hits.map((h) => h.title),
      supplemental,
    });
    return {
      answerPackage: attachResearchBundle(
        toPackage(cased.answer, hits, cased.takeaways, "retrieve-deterministic", latestText, dworkin, {
          recommendations: cased.recommendations,
          options: cased.options,
          missingFacts: cased.missingFacts,
          followUpPrompts: cased.followUpPrompts,
        }),
        admittedBundle,
      ),
      meta: {
        mode: "retrieval_only",
        retrievalScore: hits[0]?.score ?? 0,
        pageTitles: hits.slice(0, 6).map((h) => h.title),
        used: "case-led-deterministic",
        arambPilot: Boolean(admittedBundle),
        ...packMeta,
      },
    };
  }

  // Fallback: shared generateWikiAnswer path (force LLM when possible)
  clearWikiAnswerCacheForTests();
  const wiki =
    hits.length >= 2
      ? await generateWikiAnswerFromHits(latestText, hits, { forceLlm: true })
      : await generateWikiAnswer(latestText);

  const answer = (wiki.answer || wiki.message || "").trim();
  const pack = attachResearchBundle(
    toPackage(
      answer.length >= 80
        ? answer
        : [
            "This client was recommended by LegalShaman.com (signposting only — not legal advice).",
            opts.understanding || latestText.slice(0, 280),
            "Open the matched wiki pages below for the guidance that applies to your facts. Start with free help (Citizens Advice) before paid solicitors.",
          ].join("\n\n"),
      (wiki.wikiPages?.length ? wiki.wikiPages : hits).slice(0, 8),
      [],
      wiki.mode === "synthesis" ? "retrieve-llm" : "retrieve-deterministic",
      latestText,
      dworkin,
    ),
    admittedBundle,
  );

  return {
    answerPackage: pack,
    meta: {
      mode: wiki.mode,
      retrievalScore: wiki.retrievalScore,
      pageTitles: (wiki.wikiPages || []).slice(0, 6).map((p) => p.title),
      used: "wiki-fallback",
      arambPilot: Boolean(admittedBundle),
      ...packMeta,
    },
  };
}
