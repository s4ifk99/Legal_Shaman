import "server-only";

import type { DisputeKind } from "@/lib/cases/dispute-context";
import {
  freeServicesForKind,
  mergeFreeServiceLeads,
  type FreeServiceLead,
} from "@/lib/cases/free-services";
import {
  isSolicitorComplaintStory,
  solicitorComplaintSearchQuery,
} from "@/lib/cases/solicitor-complaint";
import { matchFreeServices } from "@/lib/coherence/matchFreeServices";
import type { MatterType, SessionState } from "@/lib/coherence/types";
import { exaPenumbraConfigured, searchExaForPenumbra, type ExaSearchHit } from "@/lib/penumbra/exaSearch";
import {
  penumbraLiveExaEnabled,
  penumbraOfflineExaEnabled,
  searchOfflineExaIndexForPenumbra,
} from "@/lib/penumbra/offlineExaIndex";
import {
  buildExaHitsCacheKey,
  getPenumbraExaHitsCache,
  putPenumbraExaHitsCache,
} from "@/lib/penumbra/researchCache";

function matterFromKind(kind: DisputeKind | null): MatterType {
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
    default:
      return "other";
  }
}

/** Shared cache archetype — many users with the same problem type reuse one Exa fill. */
export function servicesArchetype(kind: DisputeKind | null, story: string): string {
  if (isSolicitorComplaintStory(story)) return "solicitor_complaint";
  return kind || "general";
}

function sessionFromStory(kind: DisputeKind | null, story: string): SessionState {
  const solicitor = isSolicitorComplaintStory(story);
  return {
    rawInputs: [story],
    events: [],
    whatHappened: story,
    howCaused: "",
    goal: story.slice(0, 120),
    parties: [],
    documents: [],
    matterType: matterFromKind(kind),
    jurisdiction: "england_wales",
    locationHint: "",
    mode: "pathfinder",
    searchMode: "focused",
    penumbraAcknowledged: false,
    softFlags: solicitor ? ["solicitor_complaint"] : [],
    safetyRisk: false,
    answeredPromptIds: [],
    taxonomySlug: solicitor ? "solicitor_complaint" : null,
    authorityAnswers: solicitor ? ["topic:sra_legal_ombudsman"] : [],
  } as SessionState;
}

function hitToLead(hit: {
  id: string;
  title: string;
  blurb: string;
  url?: string;
  phone?: string;
}): FreeServiceLead {
  return {
    id: hit.id,
    name: hit.title,
    blurb: hit.blurb.replace(/\s+/g, " ").trim().slice(0, 280),
    url: hit.url,
    phone: hit.phone,
  };
}

function exaHitToLead(hit: ExaSearchHit): FreeServiceLead | null {
  const title = hit.title.trim();
  const url = hit.url.trim();
  if (!title || !url.startsWith("https://")) return null;
  const host = url.toLowerCase();
  const useful =
    /legalombudsman\.org\.uk|sra\.org\.uk|gov\.uk|lawsociety\.org\.uk|citizensadvice\.org\.uk|lawcentres\.org\.uk|advicenow\.org\.uk|shelter\.org\.uk|acas\.org\.uk|stepchange\.org|nationaldebtline\.org/.test(
      host,
    );
  if (!useful) return null;
  return {
    id: hit.id,
    name: title.slice(0, 120),
    blurb: hit.excerpt.replace(/\s+/g, " ").trim().slice(0, 280),
    url,
  };
}

function searchQueryFor(kind: DisputeKind | null, story: string): string {
  if (isSolicitorComplaintStory(story)) return solicitorComplaintSearchQuery(story);
  const kindBit =
    kind && kind !== "general" ? `${kind} dispute` : "civil legal problem";
  return `${kindBit} England Wales free advice helpline who can help Legal Ombudsman law centre ${story.slice(0, 160)}`;
}

export type RecommendServicesResult = {
  services: FreeServiceLead[];
  source:
    | "curated"
    | "curated+index"
    | "curated+index+offline"
    | "curated+index+cache"
    | "curated+index+exa";
  archetype: string;
  liveExa: boolean;
};

export async function recommendServicesForMatter(input: {
  kind: DisputeKind | null;
  story: string;
}): Promise<RecommendServicesResult> {
  const story = input.story.trim();
  const kind = input.kind;
  const archetype = servicesArchetype(kind, story);
  const curated = freeServicesForKind(kind, story); // includes Pro Bono Week guide doors by nation

  let indexed: FreeServiceLead[] = [];
  try {
    indexed = matchFreeServices(sessionFromStory(kind, story), 8).map(hitToLead);
  } catch (err) {
    console.warn(
      "[recommend-services] index match failed:",
      err instanceof Error ? err.message : err,
    );
  }

  const query = searchQueryFor(kind, story);
  const matterSlug = archetype;
  const cacheKey = buildExaHitsCacheKey(`case-recommend-v1|${archetype}|${query.slice(0, 240)}`, matterSlug);

  let offlineHits: ExaSearchHit[] = [];
  if (penumbraOfflineExaEnabled() && story) {
    try {
      offlineHits = searchOfflineExaIndexForPenumbra(query, {
        matterSlug: kind === "divorce" ? "family" : kind || "other",
        limit: 8,
        story,
      }).hits;
    } catch (err) {
      console.warn(
        "[recommend-services] offline Exa index failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  let cachedHits: ExaSearchHit[] = [];
  try {
    const cached = await getPenumbraExaHitsCache(cacheKey);
    if (cached?.hits?.length) cachedHits = cached.hits;
  } catch {
    /* cache optional */
  }

  // Also try archetype-only key so one solicitor fill serves many wordings.
  if (!cachedHits.length) {
    try {
      const archetypeKey = buildExaHitsCacheKey(`case-recommend-v1|archetype|${archetype}`, matterSlug);
      const cached = await getPenumbraExaHitsCache(archetypeKey);
      if (cached?.hits?.length) cachedHits = cached.hits;
    } catch {
      /* ignore */
    }
  }

  let liveHits: ExaSearchHit[] = [];
  const liveAllowed = exaPenumbraConfigured() && penumbraLiveExaEnabled();
  if (liveAllowed && story && !cachedHits.length) {
    try {
      const live = await searchExaForPenumbra(query, {
        numResults: 8,
        scope: isSolicitorComplaintStory(story) ? "open" : "allowlist",
        timeoutMs: 20_000,
      });
      liveHits = live.hits;
      if (liveHits.length) {
        await putPenumbraExaHitsCache({
          cacheKey,
          query,
          matterSlug,
          hits: liveHits,
        });
        // Shared archetype bucket — next users skip live Exa.
        await putPenumbraExaHitsCache({
          cacheKey: buildExaHitsCacheKey(`case-recommend-v1|archetype|${archetype}`, matterSlug),
          query: `archetype:${archetype}`,
          matterSlug,
          hits: liveHits,
        });
      }
      console.info(
        "[recommend-services]",
        JSON.stringify({
          event: "exa_live",
          archetype,
          hitCount: liveHits.length,
          nodeEnv: process.env.NODE_ENV,
        }),
      );
    } catch (err) {
      console.warn(
        "[recommend-services] Exa search failed:",
        err instanceof Error ? err.message : err,
      );
    }
  } else if (cachedHits.length) {
    console.info(
      "[recommend-services]",
      JSON.stringify({
        event: "exa_cache_hit",
        archetype,
        hitCount: cachedHits.length,
      }),
    );
  }

  const fromExaLayer = [...cachedHits, ...offlineHits, ...liveHits]
    .map(exaHitToLead)
    .filter((x): x is FreeServiceLead => Boolean(x));

  const services = mergeFreeServiceLeads(curated, [...indexed, ...fromExaLayer], 8);

  let source: RecommendServicesResult["source"] = "curated";
  if (liveHits.length) source = "curated+index+exa";
  else if (cachedHits.length) source = "curated+index+cache";
  else if (offlineHits.length) source = "curated+index+offline";
  else if (indexed.length) source = "curated+index";

  return {
    services,
    source,
    archetype,
    liveExa: liveHits.length > 0,
  };
}
