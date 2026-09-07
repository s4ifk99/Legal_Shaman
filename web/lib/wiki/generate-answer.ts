import "server-only";

import { enableLlmAnswer, resolveSynthesisModel } from "@/lib/llm/answer-config";
import { preferGroundedSynthesis, useCursorStyleAnswers, wikiSystemPrompt } from "@/lib/llm/grounded-synthesis";
import { chat, llmConfigured } from "@/lib/llm/client";
import { sanitizeAdviceText, sanitizeSignpostingText } from "@/lib/guardrails/validator";
import { isPcnAppealQuery, isPropertyPurchaseMisrepresentationQuery, isRecordingLawQuery, isVehicleRepairQuery } from "@/lib/legal/query-signals";
import { resolveLegalIssueFromQuery } from "@/lib/legal/taxonomy";
import { processSearchQuery } from "@/lib/legal-search/query-limits";
import {
  pickRecommendedFirms,
  resolvePracticeAreasForWikiQuery,
} from "./firm-recommendations";
import {
  WIKI_ANSWER_DISCLAIMER,
  type WikiAnswerFirm,
  type WikiAnswerPayload,
  type WikiAnswerSource,
} from "./answer-types";
import { getWikiPageById, searchWikiPages } from "./search";
import {
  filterOffTopicPcnHits,
  filterOffTopicPropertyPurchaseHits,
  filterOffTopicVehicleHits,
  isHousingRepairQuery,
  isSharedHousingQuery,
  rerankSharedHousingHits,
  rerankWikiHitsForQuery,
  shouldRerankWikiHits,
  stableSortWikiHits,
  wikiAnchorsForQuery,
} from "./rerank-hits";
import { applyDworkinBoostToWikiHits } from "./dworkin-tags";
import type { WikiPageIndex } from "./types";

const MIN_RETRIEVAL_SCORE = 4;
const RETRIEVAL_LIMIT = 8;
const CONTEXT_CHARS_PER_PAGE = useCursorStyleAnswers() ? 950 : 700;

function sanitizeWikiAnswer(text: string): string {
  return useCursorStyleAnswers() ? sanitizeSignpostingText(text) : sanitizeAdviceText(text);
}

function isQuarantinedPage(page: WikiPageIndex): boolean {
  const path = page.relativePath.toLowerCase();
  return path.includes("_quarantine") || path.includes("/firms/_quarantine/");
}

/** Pull in topical pages that long Reddit posts can miss in a single keyword pass. */
function mergeSupplementalWikiHits(
  query: string,
  hits: ReturnType<typeof searchWikiPages>,
): ReturnType<typeof searchWikiPages> {
  const byId = new Map(hits.map((h) => [h.id, h]));
  const phrases: string[] = [];

  if (/\b(neighbour|extension|building regs?)\b/i.test(query)) {
    phrases.push("party wall extension building regulations neighbour dispute");
  }
  if (isRecordingLawQuery(query) && !isVehicleRepairQuery(query)) {
    phrases.push("record someone without consent filming privacy");
  }
  if (isPcnAppealQuery(query)) {
    phrases.push(
      "appealing a parking ticket",
      "when to appeal a parking ticket",
      "stop being chased for a parking ticket",
      "parking tickets penalty charge notice",
    );
  }
  if (isVehicleRepairQuery(query)) {
    phrases.push(
      "problem with a car repair",
      "buying or repairing a car",
      "if you're unhappy about poor service",
      "poor workmanship rights",
      "letter to complain about the poor standard of a service",
      "problems with services or traders",
      "something's gone wrong with a purchase",
      "faulty goods consumer rights",
    );
  }
  if (isPropertyPurchaseMisrepresentationQuery(query)) {
    phrases.push(
      "property misrepresentation claims",
      "buying and selling a home",
      "types of misrepresentation explained",
      "what to do if your house sale falls through",
      "complaining about estate agent",
    );
  }
  if (/\b(customs|import|bringing .{0,40} into (the )?uk)\b/i.test(query)) {
    phrases.push("customs import prohibited restricted items UK");
  }
  if (/\b(cancel|cancelled|cancellation|tradesman|trader)\b/i.test(query)) {
    phrases.push("cancelling a service trader cancellation rights");
  }
  if (
    /\b(flatmate|housemate|lodger|subtenant|excluded occupier|share[d]?\s+accommodation|joint tenancy|notice to quit|wifi|wi-?fi|broadband|ring camera|cctv)\b/i.test(
      query,
    )
  ) {
    phrases.push(
      "check your rights if you share accommodation",
      "lodgers excluded occupier renting with other people",
      "dispute a mobile phone internet or tv bill",
      "check if you have to pay a debt joint rent",
      "check what you can do about harassment",
      "if someone has harassed you in housing",
      "home cctv systems ico",
      "small claims court letter before action",
      "joint tenancy rent contribution",
    );
  }
  if (
    /\b(temu|amazon|ebay|aliexpress|marketplace|seller|unsafe product|dangerous product|trading standards|consumer service|report this|lead test|lead contamination|tap[s]?\b|water fitting)\b/i.test(
      query,
    )
  ) {
    phrases.push(
      "reporting to trading standards unsafe product consumer service",
      "something's gone wrong with a purchase faulty goods",
      "claim compensation if an item or product causes damage",
    );
  }

  for (const phrase of phrases) {
    for (const hit of searchWikiPages(phrase, 6)) {
      const page = getWikiPageById(hit.id);
      if (!page || isQuarantinedPage(page)) continue;
      const existing = byId.get(hit.id);
      if (!existing || hit.score > existing.score) byId.set(hit.id, hit);
    }
  }

  return stableSortWikiHits([...byId.values()]);
}

export function retrieveWikiHitsForQuery(query: string, limit = RETRIEVAL_LIMIT) {
  return filterHits(query, limit);
}

function filterHits(query: string, limit: number) {
  const searchQ = condenseWikiRetrievalQuery(query);
  const cancelish = /\b(cancel|cancelled|cancellation|owe|booking fee)\b/i.test(query);
  let hits = searchWikiPages(searchQ, limit * 2).filter((hit) => {
    const page = getWikiPageById(hit.id);
    return page ? !isQuarantinedPage(page) : true;
  });

  hits = mergeSupplementalWikiHits(query, hits);
  hits = filterOffTopicVehicleHits(query, hits);
  hits = filterOffTopicPcnHits(query, hits);
  hits = filterOffTopicPropertyPurchaseHits(query, hits);

  // Flatmate / shared housing — do not let repair or neighbour rerank steal the match
  if (isSharedHousingQuery(query)) {
    hits = rerankSharedHousingHits(query, hits);
  } else if (isHousingRepairQuery(query) || shouldRerankWikiHits(query)) {
    hits = rerankWikiHitsForQuery(query, hits);
  }

  if (cancelish) {
    hits.sort((a, b) => {
      const aBoost = /\bcancel/i.test(a.title) ? 50 : 0;
      const bBoost = /\bcancel/i.test(b.title) ? 50 : 0;
      return b.score + bBoost - (a.score + aBoost);
    });
  }

  // Taxonomy (and detectors) have already aimed the list — Dworkin is a second sort.
  hits = applyDworkinBoostToWikiHits(stableSortWikiHits(hits));
  return orderHitsWithPrimary(hits.slice(0, limit), query);
}

function orderHitsWithPrimary(
  hits: ReturnType<typeof searchWikiPages>,
  query: string,
): ReturnType<typeof searchWikiPages> {
  const primary = pickPrimaryHit(hits, query);
  if (!primary) return hits;
  return [primary, ...hits.filter((h) => h.id !== primary.id)];
}

/** Long Reddit-style posts dilute keyword search — keep topical anchors. */
function condenseWikiRetrievalQuery(query: string): string {
  const trimmed = query.replace(/\s+/g, " ").trim();
  const anchors = wikiAnchorsForQuery(trimmed);

  if (anchors.length) {
    const head = trimmed.length > 180 ? trimmed.slice(0, 180) : trimmed;
    return [...new Set([...anchors, head])].join(" ").slice(0, 320);
  }
  if (trimmed.length < 320) return trimmed;
  return trimmed.slice(0, 320);
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 3)}...`;
}

function cleanSnippet(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*[-*]\s*/gm, "")
    .replace(/^\s*#+\s*/g, "")
    .replace(/\bSource:\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUnsafeProductReportingQuery(query: string): boolean {
  return /\b(temu|amazon|ebay|aliexpress|marketplace|seller|unsafe product|dangerous product|trading standards|consumer service|report this|lead test|lead contamination|tap[s]?\b|water fitting)\b/i.test(
    query,
  );
}

function deterministicUnsafeProductAnswer(
  query: string,
  hits: ReturnType<typeof searchWikiPages>,
): string {
  const blocks: string[] = [];

  if (useCursorStyleAnswers()) {
    blocks.push(
      "What the sources say",
      "Unsafe or non-compliant consumer products bought online can be reported as product-safety issues. Trading Standards is the main enforcement route, usually via the Citizens Advice consumer service.",
      "Practical route",
      "Stop using the taps for drinking water if they may contaminate supply. Keep the product, packaging, order details, listing screenshots, and your lead test results. Report through Citizens Advice consumer service and to the marketplace as an unsafe product.",
    );
    if (/\b(water fitting|water supply|drinking water|contamination|tap[s]?)\b/i.test(query)) {
      blocks.push(
        "Who to report to",
        "Because this involves a domestic water fitting, you can also contact your local water company or water undertaker’s water regulations team. They may ask for photos or samples.",
      );
    }
    blocks.push(
      "Limits / missing facts",
      "A home lead test is useful evidence but may not be treated as final lab proof. This is general signposting only — not legal advice.",
    );
    return sanitizeWikiAnswer(blocks.join("\n\n"));
  }

  const paragraphs: string[] = [
    "The main reporting route described by the matching guidance is Trading Standards via the Citizens Advice consumer service. The relevant pages explain that unsafe or dangerous consumer products, misleading listings, and sellers who disappear or relist can be reported through that route.",
    "The same guidance also points to keeping the product, order details, screenshots of the listing and seller, and any photos or test results as evidence. Related consumer pages cover faulty goods, purchases that have gone wrong, and compensation where a product causes damage.",
  ];

  if (/\b(water fitting|water supply|drinking water|contamination|tap[s]?)\b/i.test(query)) {
    paragraphs.push(
      "Because the issue described is a domestic water fitting that may contaminate drinking water, the report can also be raised with the local water company or water undertaker’s water regulations team so they can decide whether they want photos, samples, or further testing.",
    );
  }

  const reportingPage = hits.find((h) => /\breporting to trading standards\b/i.test(h.title));
  if (reportingPage?.summary) {
    paragraphs.push(`Matching page “${reportingPage.title}”: ${truncate(cleanSnippet(reportingPage.summary), 220)}`);
  }

  paragraphs.push(
    "This is general signposting from the Legal Shaman wiki — not legal advice. Check the cited pages or Citizens Advice for personalised help.",
  );
  return sanitizeWikiAnswer(paragraphs.join("\n\n"));
}

function buildWikiContext(hits: ReturnType<typeof searchWikiPages>): string {
  return hits
    .map((hit, i) => {
      const page = getWikiPageById(hit.id);
      const contentSnippet = page?.content ? truncate(page.content, CONTEXT_CHARS_PER_PAGE) : "";
      const sources = page?.sources?.slice(0, 4).join("; ") ?? "";
      return [
        `### Page ${i + 1}: ${hit.title} (category: ${hit.category}${
          hit.dworkinKind ? `; dworkin: ${hit.dworkinKind}` : ""
        })`,
        hit.summary ? `Summary: ${hit.summary}` : "",
        hit.keyInformation.length
          ? `Key information:\n- ${hit.keyInformation.join("\n- ")}`
          : "",
        hit.practicalGuidance.length
          ? `Practical guidance:\n- ${hit.practicalGuidance.join("\n- ")}`
          : "",
        sources ? `Sources: ${sources}` : "",
        contentSnippet ? `Excerpt: ${contentSnippet}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function collectSources(hits: ReturnType<typeof searchWikiPages>): WikiAnswerSource[] {
  const seen = new Set<string>();
  const sources: WikiAnswerSource[] = [];

  for (const hit of hits) {
    const page = getWikiPageById(hit.id);
    for (const raw of page?.sources ?? []) {
      const name = raw
        .replace(/\*\*/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`[^`]+`/g, "")
        .trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      sources.push({ name: truncate(name, 180) });
      if (sources.length >= 8) return sources;
    }
  }

  return sources;
}

function mapFirms(
  firms: ReturnType<typeof pickRecommendedFirms>,
): WikiAnswerFirm[] {
  return firms.map((row) => ({
    firm: row.firm,
    practiceArea: row.practiceArea,
    articleCount: row.article_count,
    directoryUrl: row.directory_url,
    entityId: row.sra_id ? `sra:${row.sra_id}` : undefined,
    resultSource: row.sra_id ? ("sra" as const) : undefined,
  }));
}

type LlmAnswerJson = {
  answer?: string;
  wikiPageTitles?: string[];
  sourcePublishers?: string[];
};

function parseLlmJson(raw: string): LlmAnswerJson | null {
  try {
    return JSON.parse(raw) as LlmAnswerJson;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as LlmAnswerJson;
    } catch {
      return null;
    }
  }
}

function isJunkAnswer(text: string): boolean {
  const t = text.trim();
  if (t.length < 60) return true;
  if (/^["'}{\\]/.test(t)) return true;
  if (/answer in json format|as specified in the rules|\/\/\s*legal shaman|<\/?answer>/i.test(t)) {
    return true;
  }
  if ((t.match(/[{}`]/g) ?? []).length >= 4) return true;
  // Mostly meta / instruction echo rather than guidance prose
  const letters = (t.match(/[a-zA-Z]/g) ?? []).length;
  if (letters < 40) return true;
  return false;
}

/** Pick the most topical primary page after reranking (stable across environments). */
function pickPrimaryHit(
  hits: ReturnType<typeof searchWikiPages>,
  query: string,
): (typeof hits)[number] | undefined {
  if (!hits.length) return undefined;

  const q = query.toLowerCase();
  const resolution = resolveLegalIssueFromQuery(query);
  const titleMatches = (pattern: RegExp) =>
    hits.find((h) => pattern.test(h.title.toLowerCase()));

  if (isPcnAppealQuery(query)) {
    return (
      titleMatches(/^appealing a parking ticket$/i) ??
      titleMatches(/when to appeal a parking ticket/i) ??
      titleMatches(/appealing a parking ticket/i) ??
      titleMatches(/stop being chased for a parking ticket/i) ??
      titleMatches(/parking tickets/i) ??
      hits[0]
    );
  }
  if (isVehicleRepairQuery(query)) {
    return (
      titleMatches(/problem with a car repair/i) ??
      titleMatches(/buying or repairing a car/i) ??
      titleMatches(/poor workmanship/i) ??
      titleMatches(/unhappy about poor service/i) ??
      titleMatches(/poor standard of a service/i) ??
      titleMatches(/problems with services or traders/i) ??
      titleMatches(/faulty goods/i) ??
      hits[0]
    );
  }
  if (isPropertyPurchaseMisrepresentationQuery(query)) {
    return (
      titleMatches(/property misrepresentation/i) ??
      titleMatches(/buying and selling a home/i) ??
      titleMatches(/types of misrepresentation/i) ??
      titleMatches(/house sale falls through/i) ??
      titleMatches(/misrepresentation/i) ??
      hits.find(
        (h) =>
          h.category === "Home and Housing" &&
          /buy|sell|property|misrepresent|flat|house/i.test(h.title),
      ) ??
      hits[0]
    );
  }
  if (isRecordingLawQuery(query)) {
    return (
      titleMatches(/\brecord.*consent\b/i) ??
      titleMatches(/\bfilming\b/i) ??
      hits[0]
    );
  }
  // Shared housing / flatmate — never lead with cancel-contract or boundary pages
  if (
    /\b(flatmate|housemate|lodger|share[d]?\s+accommodation|joint tenancy|notice to quit)\b/i.test(q)
  ) {
    return (
      titleMatches(/share accommodation/i) ??
      titleMatches(/renting with other/i) ??
      titleMatches(/excluded occupier/i) ??
      titleMatches(/dispute a mobile|internet or tv bill/i) ??
      titleMatches(/harass/i) ??
      hits.find((h) => !/cancell|boundary|party wall|abandonment|rent-to-own/i.test(h.title)) ??
      hits[0]
    );
  }
  if (/\b(customs|import|bringing .{0,30} into (the )?uk)\b/i.test(q)) {
    return titleMatches(/\b(customs|import|prohibited)\b/i) ?? hits[0];
  }
  if (/\b(neighbour|extension|building regs?)\b/i.test(q)) {
    return (
      titleMatches(/\bparty wall\b/i) ??
      titleMatches(/\b(extension|building regs?|planning permission)\b/i) ??
      titleMatches(/\bneighbour dispute\b/i) ??
      titleMatches(/\bboundary\b/i) ??
      hits[0]
    );
  }
  if (/\b(pension|auto enrolment)\b/i.test(q)) {
    return titleMatches(/\bpension\b/i) ?? hits[0];
  }
  if (/\b(stop and search|police)\b/i.test(q)) {
    return titleMatches(/\b(stop and search|police)\b/i) ?? hits[0];
  }
  if (
    /\b(temu|amazon|ebay|aliexpress|marketplace|seller|unsafe product|dangerous product|trading standards|consumer service|report this|lead test|lead contamination|tap[s]?\b|water fitting)\b/i.test(
      q,
    )
  ) {
    return (
      titleMatches(/\breporting to trading standards\b/i) ??
      titleMatches(/\bproduct causes damage\b/i) ??
      titleMatches(/\bpurchase\b/i) ??
      titleMatches(/\bfaulty goods\b/i) ??
      hits[0]
    );
  }

  if (resolution) {
    for (const term of [
      resolution.canonicalName,
      ...resolution.searchBoostTerms.slice(0, 8),
    ]) {
      const t = term.toLowerCase();
      if (t.length < 4) continue;
      const match = hits.find((h) => h.title.toLowerCase().includes(t));
      if (match) return match;
    }
  }

  return hits[0];
}

/** Stable prose from wiki hits — used when LLM is off or returns junk. */
function deterministicAnswerFromHits(
  hits: ReturnType<typeof searchWikiPages>,
  query: string,
): string {
  if (isUnsafeProductReportingQuery(query)) {
    return deterministicUnsafeProductAnswer(query, hits);
  }

  const primary = pickPrimaryHit(hits, query);
  const secondary = hits.find((h) => h.id !== primary?.id);

  if (useCursorStyleAnswers()) {
    const blocks: string[] = ["What the sources say"];
    if (primary?.summary?.trim()) {
      blocks.push(
        `The matching guidance on “${primary.title}” explains that ${truncate(cleanSnippet(primary.summary), 360)}`,
      );
    } else if (primary) {
      blocks.push(`Matching wiki guidance includes “${primary.title}”.`);
    }

    const steps = (primary?.practicalGuidance ?? []).slice(0, 3);
    const keys = (primary?.keyInformation ?? []).slice(0, 2);
    if (steps.length || keys.length) {
      blocks.push("Practical route");
      if (keys.length) {
        blocks.push(keys.map((k) => cleanSnippet(k)).filter(Boolean).join(" "));
      }
      if (steps.length) {
        blocks.push(steps.map((s) => cleanSnippet(s)).filter(Boolean).join(" "));
      }
    }

    if (secondary?.summary?.trim()) {
      blocks.push(
        `Related page “${secondary.title}”: ${truncate(cleanSnippet(secondary.summary), 240)}`,
      );
    }

    blocks.push(
      "Limits / missing facts",
      "This is general signposting from the Legal Shaman wiki — not legal advice. Check the cited pages or Citizens Advice for personalised help.",
    );
    return sanitizeWikiAnswer(blocks.filter(Boolean).join("\n\n"));
  }

  const paragraphs: string[] = [];

  if (primary?.summary?.trim()) {
    paragraphs.push(
      `According to “${primary.title}”: ${truncate(cleanSnippet(primary.summary), 420)}`,
    );
  } else if (primary) {
    paragraphs.push(`Matching wiki guidance includes “${primary.title}”.`);
  }

  const keys = (primary?.keyInformation ?? []).slice(0, 2);
  if (keys.length) {
    paragraphs.push(`Key points from that page: ${keys.map((k) => cleanSnippet(k)).filter(Boolean).join(" ")}`);
  }

  const steps = (primary?.practicalGuidance ?? []).slice(0, 2);
  if (steps.length) {
    paragraphs.push(
      `Practical guidance noted there includes: ${steps.map((s) => cleanSnippet(s)).filter(Boolean).join(" ")}`,
    );
  }

  if (secondary?.summary?.trim()) {
    paragraphs.push(
      `Related page “${secondary.title}”: ${truncate(cleanSnippet(secondary.summary), 280)}`,
    );
  }

  paragraphs.push(
    "This is general signposting from the Legal Shaman wiki — not legal advice. Check the cited pages or Citizens Advice for personalised help.",
  );

  return sanitizeWikiAnswer(paragraphs.filter((p) => p.length >= 40).join("\n\n"));
}

const INSUFFICIENT_MESSAGE =
  "We could not find enough matching material in the Legal Shaman wiki for this question. Try rephrasing (e.g. add a topic like housing, employment, or neighbour dispute), browse the categories below, or contact Citizens Advice for free guidance.";

const EXTERNAL_SIGNPOST =
  "Free starting points: [Citizens Advice](https://www.citizensadvice.org.uk/) and [Advicenow](https://www.advicenow.org.uk/). For private solicitors, use [Find a Lawyer](/search).";

/** Short-lived cache so Ask the Shaman and `/api/ask/answer` return identical text for the same query. */
const answerCache = new Map<string, Promise<WikiAnswerPayload>>();
const ANSWER_CACHE_TTL_MS = 90_000;

/**
 * Single synthesis from preselected wiki hits (satnav arbiter path).
 * Skips retrieval — caller supplies the ordered hit list.
 */
export async function generateWikiAnswerFromHits(
  query: string,
  hits: ReturnType<typeof searchWikiPages>,
  options?: { forceLlm?: boolean },
): Promise<WikiAnswerPayload> {
  const started = Date.now();
  const trimmed = processSearchQuery(query);
  const ordered = orderHitsWithPrimary(stableSortWikiHits(hits).slice(0, RETRIEVAL_LIMIT), trimmed);
  const retrievalScore = ordered[0]?.score ?? 0;
  const sources = collectSources(ordered);
  const recommendedFirms = mapFirms(pickRecommendedFirms(trimmed, ordered));
  const practiceAreas = resolvePracticeAreasForWikiQuery(trimmed, ordered);

  const base: WikiAnswerPayload = {
    query: trimmed,
    mode: "retrieval_only",
    answer: null,
    wikiPages: ordered,
    sources,
    recommendedFirms,
    disclaimer: WIKI_ANSWER_DISCLAIMER,
    retrievalScore,
    latencyMs: 0,
  };

  if (ordered.length === 0 || retrievalScore < MIN_RETRIEVAL_SCORE) {
    return {
      ...base,
      mode: "insufficient",
      message: `${INSUFFICIENT_MESSAGE}\n\n${EXTERNAL_SIGNPOST}`,
      latencyMs: Date.now() - started,
    };
  }

  const firmTail =
    recommendedFirms.length > 0
      ? `\n\nFor private help, firms with indexed commentary on this topic are listed below — signposting only, not endorsements.`
      : "";

  const finishSynthesis = (answer: string): WikiAnswerPayload => ({
    ...base,
    mode: "synthesis",
    answer: `${answer}${firmTail && !/find a lawyer|directory|private/i.test(answer) ? firmTail : ""}`,
    sources,
    latencyMs: Date.now() - started,
  });

  const forceLlmEnv = process.env.WIKI_FORCE_LLM === "1" || process.env.WIKI_FORCE_LLM === "true";
  const deterministic = deterministicAnswerFromHits(ordered, trimmed);
  const canSynthesize = llmConfigured() && enableLlmAnswer();
  const forceLlm = options?.forceLlm === true;
  const tryLlmFirst = canSynthesize && (forceLlm || forceLlmEnv || preferGroundedSynthesis());

  const withSynthesisMeta = (
    payload: WikiAnswerPayload,
    meta: NonNullable<WikiAnswerPayload["synthesisMeta"]>,
  ): WikiAnswerPayload => ({ ...payload, synthesisMeta: meta });

  if (!tryLlmFirst) {
    if (deterministic.length >= 80) {
      return withSynthesisMeta(finishSynthesis(deterministic), {
        used: "deterministic",
        deterministicAnswer: deterministic,
      });
    }
    if (!canSynthesize) {
      return {
        ...base,
        mode: "retrieval_only",
        message:
          "Wiki pages matched your question. Set LLM_API_KEY and LLM_BASE_URL in web/.env.local (OpenRouter) to enable synthesised answers.",
        latencyMs: Date.now() - started,
        synthesisMeta: { used: "none", deterministicAnswer: deterministic || undefined },
      };
    }
  }

  const taxonomy = resolveLegalIssueFromQuery(trimmed);
  const wikiContext = buildWikiContext(ordered);
  const firmContext =
    recommendedFirms.length > 0
      ? recommendedFirms
          .map(
            (f) =>
              `- ${f.firm} (${f.practiceArea}, ${f.articleCount} indexed articles) — directory: ${f.directoryUrl}`,
          )
          .join("\n")
      : "None matched for this query.";

  const userPrompt = `USER QUESTION:\n${trimmed}

LIKELY PRACTICE AREAS: ${practiceAreas.join(", ") || "unknown"}
TAXONOMY HINT: ${taxonomy?.canonicalName ?? "none"}

RECOMMENDED FIRMS (signposting only — mention only if relevant to the question):
${firmContext}

WIKI CONTEXT:
${wikiContext}

Respond with JSON only. The "answer" field must be practical plain-English signposting grounded in the wiki context.`;

  try {
    const raw = await chat(
      [
        { role: "system", content: wikiSystemPrompt() },
        { role: "user", content: userPrompt },
      ],
      {
        jsonMode: true,
        temperature: useCursorStyleAnswers() ? 0.15 : 0,
        maxTokens: process.env.VERCEL === "1" ? 850 : 1100,
        model: resolveSynthesisModel(),
      },
    );

    const parsed = parseLlmJson(raw);
    let answer = sanitizeWikiAnswer(parsed?.answer?.trim() ?? "");
    if (!answer) {
      const plain = raw.trim();
      if (plain && !plain.startsWith("{")) {
        answer = sanitizeWikiAnswer(plain);
      }
    }

    if (!answer || isJunkAnswer(answer)) {
      if (deterministic.length >= 80) {
        return withSynthesisMeta(finishSynthesis(deterministic), {
          used: "deterministic",
          deterministicAnswer: deterministic,
          llmAnswer: answer || undefined,
          llmError: "junk_or_empty_llm_output",
        });
      }
      return {
        ...base,
        mode: "retrieval_only",
        message: "Could not generate a summary. Browse the matching wiki pages below.",
        latencyMs: Date.now() - started,
        synthesisMeta: {
          used: "none",
          deterministicAnswer: deterministic || undefined,
          llmAnswer: answer || undefined,
          llmError: "junk_or_empty_llm_output",
        },
      };
    }

    const publisherSources = (parsed?.sourcePublishers ?? [])
      .map((name) => sanitizeWikiAnswer(name.trim()))
      .filter(Boolean)
      .map((name) => ({ name }));

    const mergedSources = [...sources];
    for (const row of publisherSources) {
      if (!mergedSources.some((s) => s.name.toLowerCase() === row.name.toLowerCase())) {
        mergedSources.push(row);
      }
    }

    const synthesised = finishSynthesis(answer);
    return withSynthesisMeta(
      { ...synthesised, sources: mergedSources.slice(0, 10) },
      {
        used: "llm",
        deterministicAnswer: deterministic,
        llmAnswer: answer,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[wiki.generate-answer] LLM failed:", message);
    if (deterministic.length >= 80) {
      return withSynthesisMeta(finishSynthesis(deterministic), {
        used: "deterministic",
        deterministicAnswer: deterministic,
        llmError: message.slice(0, 300),
      });
    }
    return {
      ...base,
      mode: "retrieval_only",
      message: `Synthesised answer unavailable (${message}). Browse the wiki results below.`,
      latencyMs: Date.now() - started,
      synthesisMeta: {
        used: "none",
        deterministicAnswer: deterministic || undefined,
        llmError: message.slice(0, 300),
      },
    };
  }
}

async function generateWikiAnswerUncached(query: string): Promise<WikiAnswerPayload> {
  const trimmed = processSearchQuery(query);
  const hits = filterHits(trimmed, RETRIEVAL_LIMIT);
  return generateWikiAnswerFromHits(trimmed, hits);
}

export async function generateWikiAnswer(query: string): Promise<WikiAnswerPayload> {
  const key = processSearchQuery(query).toLowerCase();
  const existing = answerCache.get(key);
  if (existing) return existing;

  const pending = generateWikiAnswerUncached(query).finally(() => {
    setTimeout(() => {
      if (answerCache.get(key) === pending) answerCache.delete(key);
    }, ANSWER_CACHE_TTL_MS);
  });
  answerCache.set(key, pending);
  return pending;
}

/** Test helper — clears the short-lived answer cache. */
export function clearWikiAnswerCacheForTests(): void {
  answerCache.clear();
}
