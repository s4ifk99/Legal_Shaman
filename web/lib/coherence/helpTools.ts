/**
 * Search is a tool, not a vibe.
 * The model may propose; the frozen graph decides eligibility.
 * People and services before SRA firms. Signposting only — not legal advice.
 * This is not a legal AGI: no advice, no outcome training from chat, no rewriting the issue graph each turn.
 */
import { freeHelpAdmissibleOnGeometry, sraOrganisationAdmissible } from '@/lib/matter/graphAdmissibility'
import { freezeIssueGraph } from './freezeIssueGraph'
import {
  admitHitSync,
  crawlQueriesFromFrozenSession,
  queryLeaksClientStory,
  type AdmitResult,
  type CrawlHit,
} from '@/lib/graph-ingest/admitCompiler'
import { matchAuthorityHelp, type AuthorityHelpHit } from './matchAuthorityHelp'
import { matchFreeServices, type FreeServiceHit } from './matchFreeServices'
import { matchLegalAid, type LegalAidHit } from './legalAid'
import {
  classifyHelpDoorKind,
  rankPeopleFirst,
  type HelpDoor,
  type HelpToolName,
} from './peopleFirst'
import { matchSignposting, type SignpostHit } from './signposting'
import { matchSraFirms, type SraFirmHit } from './sraLive'
import { matchingSessionForHelp } from './services'
import { buildRetrievalText } from './retrievalText'
// Server/Node resolves the disk cache; browser bundles get the null stub (package.json "imports").
import { lookupWhoHelpsFreeHelpCache } from '#who-helps-cache'
import type { SessionState } from './types'

export type { HelpDoor, HelpDoorKind, HelpToolName } from './peopleFirst'
export { classifyHelpDoorKind, rankPeopleFirst } from './peopleFirst'

function storyOf(session: SessionState): string {
  return buildRetrievalText(session)
}

function graphOk(title: string, blurb: string, session: SessionState): boolean {
  return freeHelpAdmissibleOnGeometry(title, blurb, storyOf(session))
}

export function match_free_help(session: SessionState, limit = 10): FreeServiceHit[] {
  const routed = matchingSessionForHelp(session)
  return matchFreeServices(routed, limit).filter((h) => graphOk(h.title, h.blurb, routed))
}

export type ResolveFreeHelpResult = {
  freeHelp: FreeServiceHit[]
  source: 'who-helps-cache' | 'match_free_help'
  cacheWikiId?: string
}

/**
 * Prefer durable who-helps freeHelp cache (warmed on wiki publish), else offline matcher.
 * No LLM / Exa. Used by Matching Help and matter-led packs.
 */
export function resolveFreeHelp(session: SessionState, limit = 8): ResolveFreeHelpResult {
  const candidates = [
    session.clientQuestion,
    session.confirmedSearchQuery,
    session.whatHappened,
    storyOf(session),
  ].filter((s): s is string => Boolean(s && s.trim()))

  for (const q of candidates) {
    const hit = lookupWhoHelpsFreeHelpCache(q)
    if (hit?.freeHelp?.length) {
      return {
        freeHelp: hit.freeHelp.slice(0, limit),
        source: 'who-helps-cache',
        cacheWikiId: hit.wikiId,
      }
    }
  }

  return {
    freeHelp: match_free_help(session, limit),
    source: 'match_free_help',
  }
}

export async function match_legal_aid(session: SessionState, limit = 5): Promise<LegalAidHit[]> {
  const routed = matchingSessionForHelp(session)
  const hits = await matchLegalAid(routed, limit)
  return hits.filter((h) => graphOk(h.title, h.blurb, routed))
}

export async function signpost_category(session: SessionState, limit = 6): Promise<SignpostHit[]> {
  const routed = matchingSessionForHelp(session)
  const hits = await matchSignposting(routed, limit)
  return hits.filter((h) => graphOk(h.title, h.blurb, routed))
}

export async function search_sra(session: SessionState, limit = 5): Promise<SraFirmHit[]> {
  const routed = matchingSessionForHelp(session)
  const { firms } = await matchSraFirms(routed, limit)
  return firms.filter((h) => sraOrganisationAdmissible(h.title) && graphOk(h.title, h.blurb, routed))
}

export type HelpToolsResult = {
  session: SessionState
  doors: HelpDoor[]
  freeHelp: FreeServiceHit[]
  legalAid: LegalAidHit[]
  signpost: SignpostHit[]
  sraFirms: SraFirmHit[]
  authority: { official: AuthorityHelpHit[]; firms: AuthorityHelpHit[] }
}

function toDoors(
  free: FreeServiceHit[],
  legalAid: LegalAidHit[],
  signpost: SignpostHit[],
  sra: SraFirmHit[],
): HelpDoor[] {
  const doors: HelpDoor[] = []
  for (const h of free) {
    doors.push({
      id: h.id,
      title: h.title,
      kind: classifyHelpDoorKind(h.title, h.type, 'match_free_help'),
      blurb: h.blurb,
      url: h.url,
      phone: h.phone,
      tool: 'match_free_help',
    })
  }
  for (const h of legalAid) {
    doors.push({
      id: h.id,
      title: h.title,
      kind: classifyHelpDoorKind(h.title, h.type, 'match_legal_aid'),
      blurb: h.blurb,
      url: h.url,
      phone: h.phone,
      tool: 'match_legal_aid',
    })
  }
  for (const h of signpost) {
    doors.push({
      id: h.id,
      title: h.title,
      kind: classifyHelpDoorKind(h.title, h.type, 'signpost_category'),
      blurb: h.blurb,
      url: h.url,
      phone: h.phone,
      tool: 'signpost_category',
    })
  }
  for (const h of sra) {
    doors.push({
      id: h.id,
      title: h.title,
      kind: 'firm',
      blurb: h.blurb,
      url: h.url,
      phone: h.phone,
      tool: 'search_sra',
    })
  }
  return rankPeopleFirst(doors)
}

/**
 * Plan web ingest queries from the frozen graph only.
 * Hits must still pass Admit before anyone sees them.
 */
export function plan_graph_ingest(session: SessionState) {
  const frozen = freezeIssueGraph(session)
  const plan = crawlQueriesFromFrozenSession(frozen)
  if (!plan.ok) return plan
  const leaked = plan.queries.some((q) => queryLeaksClientStory(q.query, frozen))
  if (leaked) {
    return { ok: false as const, reason: 'refused_client_story_in_query', queries: [] }
  }
  return { ...plan, session: frozen }
}

/** Admit crawl hits. AI critic is opt-in (batch jobs). Live matching never uses raw hits. */
export function admit_discovered_hits(hits: CrawlHit[], aiByUrl?: Map<string, AdmitResult['ai']>): AdmitResult[] {
  return hits.map((hit) => admitHitSync(hit, aiByUrl?.get(hit.url) ?? null))
}

/**
 * Freeze the issue graph, then run the four search tools.
 * SRA is last and optional so offline evals do not need Typesense.
 */
export async function runHelpTools(
  session: SessionState,
  opts?: { includeSra?: boolean },
): Promise<HelpToolsResult> {
  const frozen = freezeIssueGraph(session)
  const routed = matchingSessionForHelp(frozen)
  const includeSra = opts?.includeSra !== false
  const [legalAid, signpost, sraFirms] = await Promise.all([
    match_legal_aid(frozen, 5),
    signpost_category(frozen, 6),
    includeSra ? search_sra(frozen, 5) : Promise.resolve([] as SraFirmHit[]),
  ])
  const resolved = resolveFreeHelp(frozen, 10)
  const freeHelp = resolved.freeHelp
  const authority = matchAuthorityHelp(routed, 8)
  return {
    session: frozen,
    doors: toDoors(freeHelp, legalAid, signpost, sraFirms),
    freeHelp,
    legalAid,
    signpost,
    sraFirms,
    authority,
  }
}

export type HelpOutcomeResult = 'got_appointment' | 'reached_adviser' | 'instructed' | 'no_help'

/**
 * Consented outcomes would later weight help-graph edges.
 * Nothing is persisted here — refuse without explicit consent.
 */
export function recordHelpOutcome(
  session: SessionState,
  input: { consent: boolean; result?: HelpOutcomeResult },
): SessionState {
  if (!input.consent) {
    return {
      ...session,
      helpOutcome: { consentToRecord: false },
    }
  }
  if (!input.result) {
    return {
      ...session,
      helpOutcome: { consentToRecord: true },
    }
  }
  return {
    ...session,
    helpOutcome: {
      consentToRecord: true,
      result: input.result,
      recordedAt: new Date().toISOString(),
    },
  }
}
