import type { MatterType, ServiceCard, SessionState } from './types'
import { maximiseLocalCoherence, wikiHitsToCandidates } from './coherence'
import { matchDirectories, matchProbono, type DirectoryHit, type ProbonoHit } from './directories'
import type { LegalFrame } from './frames'
import { proposeLegalFrames } from './frames'
import type { KnowledgeHit } from './knowledgeTypes'
import { matchLegalAid, type LegalAidHit } from './legalAid'
import { matchAuthorityHelp, type AuthorityHelpHit } from './matchAuthorityHelp'
import { matchFreeServices, type FreeServiceHit } from './matchFreeServices'
import { matchSignposting, type SignpostHit } from './signposting'
import { matchSraFirms, sraStatus, type SraFirmHit, type SraSearchMeta } from './sraLive'
import {
  activeDomains,
  matchWikiForFrames,
  wikiInfo,
  wikiInfoForSession,
  type WikiHit,
} from './wiki'
import { matchV1Wiki, v1WikiInfo, type V1WikiHit } from './v1Wiki'

export type { KnowledgeHit, WikiHit }
export { matchImmigrationWiki, sourcesByFrame, wikiHitsToBriefSources, wikiHitsToSignposts } from './wiki'
export type { DirectoryHit, LegalAidHit, ProbonoHit, SignpostHit, SraFirmHit, V1WikiHit, AuthorityHelpHit, FreeServiceHit }

export interface HelpPack {
  phase2Wiki: KnowledgeHit[]
  v1Wiki: V1WikiHit[]
  signposts: SignpostHit[]
  /** Dialable charities / helplines from freeServicesIndex (offline, incl. Exa fill) */
  freeServices: FreeServiceHit[]
  /** Offline authority index — official / trusted free resources */
  authorityOfficial: AuthorityHelpHit[]
  /** Offline firm commentary pages (signposting, not SRA cards) */
  authorityFirms: AuthorityHelpHit[]
  legalAid: LegalAidHit[]
  sraFirms: SraFirmHit[]
  probono: ProbonoHit[]
  directories: DirectoryHit[]
  meta: {
    phase2?: { name: string; articleCount: number; pageCount?: number; pattern?: string }
    v1?: Awaited<ReturnType<typeof v1WikiInfo>>
    sra?: SraSearchMeta
  }
}

const FALLBACK: ServiceCard[] = [
  {
    id: 'find-adviser',
    title: 'Find an immigration adviser',
    type: 'solicitor / adviser',
    blurb: 'GOV.UK directory of regulated immigration advisers.',
    matterTypes: ['immigration'],
  },
  {
    id: 'cab',
    title: 'Citizens Advice',
    type: 'info / clinic',
    blurb: 'Free guidance and local referral pathways.',
    matterTypes: ['immigration', 'housing', 'employment', 'family', 'debt', 'consumer', 'crime', 'other', 'unknown'],
  },
  {
    id: 'sra-find',
    title: 'Find a solicitor (SRA / Law Society)',
    type: 'directory',
    blurb: 'Official directories for regulated solicitors.',
    matterTypes: [
      'other',
      'family',
      'unknown',
      'personal_injury',
      'immigration',
      'housing',
      'employment',
      'debt',
      'consumer',
    ],
  },
]

export function isImmigrationSession(session: SessionState): boolean {
  return (
    session.matterType === 'immigration' ||
    /\bilr\b|visa|home office|deport|asylum/i.test(session.rawInputs.join(' '))
  )
}

export function hasWikiDomainSession(session: SessionState): boolean {
  return activeDomains(session).length > 0
}

/**
 * Phase 2+3: probe wiki → local fit re-rank → retrieve again from ranked frames.
 * Call after each answer so search tracks understanding.
 */
export async function retrieveWithCoherence(
  session: SessionState,
  frames: LegalFrame[] = [],
  limit = 6,
): Promise<{ frames: LegalFrame[]; hits: WikiHit[] }> {
  const proposed =
    frames.length > 0 ? frames : proposeLegalFrames(session, 5)
  const probe = await matchWikiForFrames(session, proposed, Math.max(limit, 8))
  const pass = maximiseLocalCoherence(session, proposed, wikiHitsToCandidates(probe), 3)
  const ranked = pass.frames.length ? pass.frames : proposed.slice(0, 3)
  const hits = await matchWikiForFrames(session, ranked, limit)
  return { frames: ranked, hits }
}

/**
 * Phase 2: wiki-backed match (per frame). Pass frames when available for better packs.
 * Re-ranks via Phase 3 before final retrieve so packs follow local fit.
 */
export async function matchImmigrationKnowledge(
  session: SessionState,
  limit = 6,
  frames: LegalFrame[] = [],
): Promise<KnowledgeHit[]> {
  const { hits } = await retrieveWithCoherence(session, frames, limit)
  return hits.map((h) => ({
    id: h.id,
    title: h.title,
    topic: h.topic,
    description: h.description,
    sourceUrl: h.sourceUrl,
    score: h.score,
  }))
}

/** Alias for multi-domain wiki match. */
export const matchDomainKnowledge = matchImmigrationKnowledge

/**
 * Full help pack: Phase 2 legal wiki + V1 knowledge, signposting, legal aid, pro bono, directories.
 */
export async function buildHelpPack(
  session: SessionState,
  frames: LegalFrame[] = [],
): Promise<HelpPack> {
  const isImm = isImmigrationSession(session)
  const useWiki = hasWikiDomainSession(session) || frames.length > 0
  const authority = matchAuthorityHelp(session, 10)
  const freeServices = matchFreeServices(session, 10)

  const [
    phase2Wiki,
    v1Wiki,
    signposts,
    legalAid,
    sraFirms,
    probono,
    directories,
    phase2Info,
    v1Meta,
    sraMeta,
  ] = await Promise.all([
    useWiki ? matchDomainKnowledge(session, 6, frames) : Promise.resolve([] as KnowledgeHit[]),
    matchV1Wiki(session, isImm ? 4 : 2),
    matchSignposting(session, 6),
    isImm || session.matterType === 'immigration'
      ? matchLegalAid(session, 5)
      : Promise.resolve([] as LegalAidHit[]),
    matchSraFirms(session, 5, frames),
    matchProbono(session, 3),
    matchDirectories(session),
    useWiki ? wikiInfoForSession(session, frames) : Promise.resolve(null),
    v1WikiInfo(),
    sraStatus(),
  ])

  return {
    phase2Wiki,
    v1Wiki,
    signposts,
    freeServices,
    authorityOfficial: authority.official,
    authorityFirms: authority.firms,
    legalAid,
    sraFirms,
    probono,
    directories,
    meta: {
      phase2: phase2Info
        ? {
            name: phase2Info.name,
            articleCount: phase2Info.articleCount,
            pageCount: phase2Info.pageCount,
            pattern: phase2Info.pattern,
          }
        : undefined,
      v1: v1Meta,
      sra: sraMeta,
    },
  }
}

export function matchServices(session: SessionState): ServiceCard[] {
  if (isImmigrationSession(session)) {
    const adviser = FALLBACK.find((f) => f.id === 'find-adviser')
    return adviser
      ? [
          {
            ...adviser,
            id: 'find-an-immigration-adviser',
            blurb: 'Search regulated advisers on GOV.UK. Wiki signposts load on this screen.',
          },
        ]
      : FALLBACK.filter((f) => f.matterTypes.includes('immigration'))
  }

  const matter: MatterType = session.matterType
  const matched = FALLBACK.filter(
    (s) => s.matterTypes.includes(matter) || (matter === 'unknown' && s.id === 'sra-find'),
  )
  if (matched.length === 0) return FALLBACK.filter((s) => s.id === 'cab' || s.id === 'sra-find')
  return matched
}

export async function serviceUrl(id: string): Promise<string | undefined> {
  if (id === 'find-an-immigration-adviser' || id === 'find-adviser') {
    return 'https://www.gov.uk/find-an-immigration-adviser'
  }
  if (id === 'cab') return 'https://www.citizensadvice.org.uk/get-advice/'
  if (id === 'sra-find') return 'https://solicitors.lawsociety.org.uk/'

  const { default: dirs } = await import('@/data/coherence/v1Directories.json')
  const dir = (
    dirs as { entries: { id: string; url: string }[] }
  ).entries.find((e) => e.id === id)
  if (dir) return dir.url

  const { default: wiki } = await import('@/data/coherence/immigrationWiki.json')
  const page = (wiki as { pages: { id: string; primaryUrl: string; sourceIds: string[] }[] }).pages.find(
    (p) => p.id === id || p.sourceIds?.includes(id),
  )
  return page?.primaryUrl
}

export function matterLabel(m: MatterType): string {
  const map: Record<MatterType, string> = {
    immigration: 'Immigration',
    personal_injury: 'Personal injury',
    housing: 'Housing',
    conveyancing: 'Conveyancing',
    employment: 'Employment',
    family: 'Family',
    debt: 'Debt / money',
    consumer: 'Consumer',
    crime: 'Crime / police',
    other: 'General legal help',
    unknown: 'To be confirmed',
  }
  return map[m]
}

export async function trialDomainInfo() {
  const info = await wikiInfo('immigration')
  return {
    name: info.name,
    articleCount: info.articleCount,
    pageCount: info.pageCount,
    sourceRoot: 'wiki/domains/immigration (from LS R&D/05 Legal Knowledge)',
    compiledAt: info.compiledAt,
    pattern: info.pattern,
  }
}
