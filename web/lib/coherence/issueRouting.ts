import type { MatterFrame } from '@/lib/matter/types'
import type { MatterType, SessionState } from './types'
import type { MatchingGuidance, ResearchSource } from './researchBundle'
import type { SessionMatterFrame } from './matterFrame'

/** Map a taxonomy / matter-engine slug onto the session matterType used by help packs. */
export function matterTypeFromSlug(slug?: string | null): MatterType {
  const s = String(slug || '').toLowerCase()
  if (!s) return 'unknown'
  if (s.startsWith('employment') || s === 'discrimination_equality') return 'employment'
  if (s.startsWith('housing') || s === 'neighbour_dispute') return 'housing'
  if (s.startsWith('consumer') || s === 'parking_pcn') return 'consumer'
  if (s.startsWith('family') || s === 'wills_probate') return 'family'
  if (s.startsWith('immigration')) return 'immigration'
  if (s.startsWith('debt') || s === 'welfare_benefits') return 'debt'
  if (s.startsWith('conveyancing')) return 'conveyancing'
  if (s.startsWith('crime') || s === 'criminal_defence' || s === 'motoring_disqualification') return 'crime'
  if (s === 'personal_injury') return 'personal_injury'
  return 'other'
}

export function topicIdFromSlug(slug?: string | null): string {
  const s = String(slug || '')
  if (s === 'parking_pcn') return 'consumer-parking'
  if (s === 'consumer_vehicle_repair') return 'consumer-car'
  if (s === 'conveyancing') return 'conveyancing-purchase'
  if (s === 'housing') return 'housing-tenancy'
  if (s === 'neighbour_dispute') return 'housing-access'
  if (s.startsWith('employment')) return 'employment'
  if (s.startsWith('family')) return 'family'
  if (s.startsWith('immigration')) return 'immigration'
  return s || 'general'
}

export function issueSlugsFromFrame(
  frame: Pick<MatterFrame, 'primaryIssues' | 'secondaryIssues'> | SessionMatterFrame | null | undefined,
): string[] {
  if (!frame) return []
  return [...frame.primaryIssues, ...frame.secondaryIssues].map((i) => i.slug)
}

export function allowedMatterTypesFromFrame(
  frame: Pick<MatterFrame, 'primaryIssues' | 'secondaryIssues'> | SessionMatterFrame | null | undefined,
): Set<MatterType> {
  const types = new Set<MatterType>()
  for (const slug of issueSlugsFromFrame(frame)) {
    const t = matterTypeFromSlug(slug)
    if (t !== 'unknown') types.add(t)
  }
  return types
}

export function matchingGuidanceFromFrame(
  frame: MatterFrame | SessionMatterFrame | null | undefined,
  sources: Array<Pick<ResearchSource, 'id'>> = [],
): MatchingGuidance | undefined {
  const slug = frame?.primaryIssues[0]?.slug
  if (!slug) return undefined
  const matterType = matterTypeFromSlug(slug)
  const secondary = (frame?.secondaryIssues || []).map((i) => i.slug).filter(Boolean)
  const confidence =
    (frame?.overallConfidence || 0) >= 0.75 ? 'high' : (frame?.overallConfidence || 0) >= 0.5 ? 'medium' : 'low'
  return {
    matterType,
    topicId: topicIdFromSlug(slug),
    taxonomySlug: slug,
    confidence,
    rationale: secondary.length
      ? `Matter frame primary ${slug}; also in play: ${secondary.slice(0, 3).join(', ')}.`
      : `Matter frame primary issue: ${slug}.`,
    sourceIds: sources.slice(0, 3).map((s) => s.id),
  }
}

/**
 * Research / Exa matching may not elect a legal world the frame excluded
 * or a matterType the frame does not support.
 */
export function preferFrameMatching(
  curated: MatchingGuidance | undefined,
  research: MatchingGuidance | undefined,
  frame: MatterFrame | SessionMatterFrame | null | undefined,
): MatchingGuidance | undefined {
  const allowed = allowedMatterTypesFromFrame(frame)
  const issueSlugs = new Set(issueSlugsFromFrame(frame))
  const researchLooksExcluded =
    Boolean(research) &&
    /discriminat|harass|bully|equality act/i.test(`${research?.topicId || ''} ${research?.rationale || ''}`) &&
    !issueSlugs.has('discrimination_equality')

  if (!research || researchLooksExcluded) return curated || research
  if (allowed.size && !allowed.has(research.matterType)) return curated || research

  const slug = frame?.primaryIssues[0]?.slug
  return {
    ...research,
    taxonomySlug: slug || research.taxonomySlug,
    topicId: /discriminat/i.test(research.topicId) ? topicIdFromSlug(slug) : research.topicId,
  }
}

export function applyFrameRoutingToSession(session: SessionState): SessionState {
  const frame = session.matterFrame
  const slug = frame?.primaryIssues[0]?.slug
  if (!slug) return session
  return {
    ...session,
    matterType: matterTypeFromSlug(slug),
    topicId: topicIdFromSlug(slug),
    taxonomySlug: slug,
  }
}
