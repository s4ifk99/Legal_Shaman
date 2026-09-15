/**
 * Search is a tool, not a vibe.
 * The model may propose; the frozen graph decides eligibility.
 * People and services before SRA firms. Signposting only — not legal advice.
 * This is not a legal AGI: no advice, no outcome training from chat, no rewriting the issue graph each turn.
 */
import { freeHelpAdmissibleOnGeometry, sraOrganisationAdmissible } from '@/lib/matter/graphAdmissibility'
import { freezeIssueGraph } from './freezeIssueGraph'
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
  const freeHelp = match_free_help(frozen, 10)
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
