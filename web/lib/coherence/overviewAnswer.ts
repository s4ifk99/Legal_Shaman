import "server-only";

import { chat, llmConfigured } from "@/lib/llm/client";
import { enableLlmAnswer, resolveSynthesisModel } from "@/lib/llm/answer-config";
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
import type { MatterFrame } from "@/lib/matter/types";
import type { AnswerPackage } from "@/lib/coherence/answerPackage";

const OVERVIEW_SYSTEM = `You are Legal Shaman's Overview agent — imitating Cursor working inside the legal_shaman Obsidian vault (AGENTS.md).

Write a practical UK signposting recommendation for the client's live situation.

Rules:
1. Use ONLY the WIKI CONTEXT and DWORKIN AUTHORITY snippets. Do not invent statutes, outcomes, or firm endorsements.
2. Open with one short line: the client was recommended by LegalShaman.com (signposting only — not a paid referral, not legal advice).
3. Answer the client's actual questions in clear prose. Cover each distinct issue they raised (e.g. sole-name broadband / WiFi password, joint rent shortfall, cameras/CCTV, threats/harassment, letter before action / money claim, council PCNs / permit-road appeals, estate agent / flat misrepresentation / demolition, damaged belongings / small claims between parents) when the context supports it. If they only mentioned work as the setting (“someone at my work”) but the dispute is parking tickets, a garage, or a landlord, do not write employment-law guidance. If the dispute is a broken gift or belongings and whether they can sue, do not write child custody / child arrangements guidance unless they also asked about that.
4. Make useful distinctions the sources support (e.g. sole-name provider contract vs household contribution agreement; joint and several rent liability; cameras on shared space vs private space; harassment vs pure CCTV complaints).
5. Prefer concrete next steps grounded in the pages. Prefer rule-tagged sources for what to do, principle-tagged sources for fairness questions, and treat policy-tagged sources as background.
6. Do NOT predict win/lose. Do NOT say "you should definitely".
7. Keep it concise: about 250–450 words. Short section headings allowed (plain lines, not markdown #).
8. End with one sentence: this is curated signposting from indexed sources — get a Citizens Advice or solicitor check before filing if wording is uncertain.
9. If Master Critic feedback is provided, fix every listed failure before answering.
10. Return JSON only:
{
  "answer": "full recommendation text",
  "wikiPageTitles": ["exact titles used from context"],
  "takeaways": ["up to 5 short practical takeaways"]
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
      const excerpt = (page?.content || hit.summary || "").replace(/\s+/g, " ").trim().slice(0, 900);
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

function parseJson(raw: string): { answer?: string; wikiPageTitles?: string[]; takeaways?: string[] } | null {
  try {
    return JSON.parse(raw) as { answer?: string; wikiPageTitles?: string[]; takeaways?: string[] };
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as { answer?: string; wikiPageTitles?: string[]; takeaways?: string[] };
    } catch {
      return null;
    }
  }
}

function toPackage(
  answer: string,
  hits: ReturnType<typeof searchWikiPages>,
  takeaways: string[],
  origin: "retrieve-llm" | "retrieve-deterministic",
  query = "",
  dworkin: ReturnType<typeof retrieveDworkinSnippetsForOverview> = [],
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

  return {
    answerOverview: answer,
    bullets: takeaways.slice(0, 5).map((t) => ({
      text: t,
      sourceTitle: hits[0]?.title || "Legal Shaman wiki",
      sourceUrl: "https://www.citizensadvice.org.uk/",
      tier: "areas",
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
}): Promise<{ answerPackage: AnswerPackage; meta: Record<string, unknown> }> {
  const latestText = opts.latestText.trim();
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
    });
    hits = matterEvidenceToWikiHits(evidence.hits);
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
    } else if (hits.length < 2) {
      // Weak matter intents → fall back to vault collect (same as unscoped path)
      hits = collectOverviewHits(searchBlob);
      retrievalMeta = {
        ...retrievalMeta,
        retrievalMode: `${evidence.mode}+legacy-fallback`,
      };
    }
  } else {
    hits = collectOverviewHits(searchBlob);
    retrievalMeta = { retrievalMode: "legacy-collectOverviewHits" };
  }
  const dworkin = retrieveDworkinSnippetsForOverview({
    query: searchBlob,
    taxonomySlug,
    excludeTitles: hits.map((h) => h.title),
    limit: 4,
  });
  const packMeta = {
    taxonomySlug,
    ...retrievalMeta,
    dworkinKinds: [
      ...hits.map((h) => h.dworkinKind).filter(Boolean),
      ...dworkin.map((s) => s.dworkinKind),
    ],
    dworkinTitles: dworkin.map((s) => s.title),
  };

  const storyBlock = [
    opts.understanding ? `Brief understanding: ${opts.understanding}` : "",
    opts.clientQuestion ? `Client questions: ${opts.clientQuestion}` : "",
    `Situation:\n${latestText}`,
    opts.critique
      ? `Master Critic feedback (fix these failures):\n${opts.critique}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (hits.length >= 2 && llmConfigured() && enableLlmAnswer()) {
    const context = buildContext(hits, dworkin);
    try {
      const raw = await chat(
        [
          { role: "system", content: OVERVIEW_SYSTEM },
          {
            role: "user",
            content: `${storyBlock}\n\nWIKI CONTEXT:\n${context}\n\nRespond with JSON only.`,
          },
        ],
        {
          jsonMode: true,
          temperature: 0.2,
          maxTokens: 1400,
          model: resolveSynthesisModel(),
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
        const takeaways = (parsed?.takeaways || [])
          .map((t) => String(t).trim())
          .filter((t) => t.length >= 12)
          .slice(0, 5);
        return {
          answerPackage: toPackage(answer, ordered, takeaways, "retrieve-llm", latestText, dworkin),
          meta: {
            mode: "synthesis",
            retrievalScore: ordered[0]?.score ?? 0,
            pageTitles: ordered.slice(0, 6).map((h) => h.title),
            used: "coherence-overview-llm",
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
  if (isSharedHousingQuery(latestText) && hits.length >= 2) {
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
      answerPackage: toPackage(
        parts.join("\n"),
        hits,
        takeaways,
        "retrieve-deterministic",
        latestText,
        dworkin,
      ),
      meta: {
        mode: "retrieval_only",
        retrievalScore: hits[0]?.score ?? 0,
        pageTitles: hits.slice(0, 6).map((h) => h.title),
        used: "shared-housing-deterministic",
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
  const pack = toPackage(
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
  );

  return {
    answerPackage: pack,
    meta: {
      mode: wiki.mode,
      retrievalScore: wiki.retrievalScore,
      pageTitles: (wiki.wikiPages || []).slice(0, 6).map((p) => p.title),
      used: "wiki-fallback",
      ...packMeta,
    },
  };
}
