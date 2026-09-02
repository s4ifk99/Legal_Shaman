/**
 * Compose Overview / Recommendation as coverage over the frozen MatterFrame
 * (issues + exclusions + client questions), not a ranked wiki dump.
 */
import type { ResearchBundle, ResearchClaim, ResearchSource } from './researchBundle'
import type { MatterType, SessionState } from './types'
import type { LegalFrame } from './frames'
import type { AnswerPackage, AnswerBullet } from './answerPackage'
import { defaultAnswerFollowUps } from './answerPackage'
import { checkAnswerCitations } from './citationCheck'
import { matchFreeServices } from './matchFreeServices'
import { matchingSessionForHelp } from './services'
import { extractClientQuestions } from './applyMatterFrame'
import { issueSlugsFromFrame, matterTypeFromSlug } from './issueRouting'
import { titleAllowedOnGraph } from '@/lib/matter/issueGraphHits'
import { isNeighbourAttractorTitle } from '@/lib/matter/graphAdmissibility'

function sourceTier(tier: ResearchSource['tier']): AnswerBullet['tier'] {
  if (tier === 'primary-law') return 'primary-law'
  if (tier === 'official') return 'trusted-guidance'
  if (tier === 'wiki') return 'areas'
  return 'trusted-guidance'
}

function sourceById(bundle: ResearchBundle): Map<string, ResearchSource> {
  return new Map(bundle.sources.map((s) => [s.id, s]))
}

export function researchBundleIsUsable(bundle: ResearchBundle | null | undefined): boolean {
  if (!bundle || bundle.status !== 'complete') return false
  return (
    Boolean(bundle.answerDraft?.trim()) ||
    bundle.claims.length > 0 ||
    bundle.sources.length > 0 ||
    bundle.nextActions.length > 0
  )
}

function resolveMatterType(session: SessionState, bundle: ResearchBundle): MatterType {
  const fromFrame = matterTypeFromSlug(session.matterFrame?.primaryIssues[0]?.slug)
  if (fromFrame !== 'unknown') return fromFrame
  if (bundle.matching?.matterType && bundle.matching.matterType !== 'unknown') {
    return bundle.matching.matterType
  }
  const helped = matchingSessionForHelp({
    ...session,
    penumbraResearch: {
      status: 'complete',
      caseKey: session.penumbraResearch?.caseKey || '',
      conversationId: session.penumbraResearch?.conversationId || '',
      questions: [],
      bundle,
      fallback: session.penumbraResearch?.fallback ?? false,
      updatedAt: session.penumbraResearch?.updatedAt || new Date().toISOString(),
    },
  })
  if (helped.matterType && helped.matterType !== 'unknown') return helped.matterType
  if (session.matterType && session.matterType !== 'unknown') return session.matterType
  return 'unknown'
}

function claimsAllowedByFrame(session: SessionState, claims: ResearchClaim[]): ResearchClaim[] {
  const frame = session.matterFrame
  let out = claims
  if (frame) {
    out = claims.filter((c) => titleAllowedOnGraph(c.claim, frame) && !isNeighbourAttractorTitle(c.claim, frame, `${session.whatHappened || ''} ${session.clientQuestion || ''}`))
  }
  const exclusions = new Set((frame?.exclusions || []).map((e) => e.toLowerCase()))
  if (!exclusions.has('discrimination_equality') && !exclusions.has('workplace_discrimination')) {
    return out
  }
  return out.filter(
    (c) => !/\b(discriminat|harass|bullied|bullying|equality act|protected characteristic)\b/i.test(c.claim),
  )
}

function uncoveredQuestions(session: SessionState, claims: ResearchClaim[], draft: string): string[] {
  const questions = extractClientQuestions(`${session.clientQuestion || ''}\n${session.whatHappened || ''}`)
  if (!questions.length) return []
  const hay = `${draft} ${claims.map((c) => c.claim).join(' ')}`.toLowerCase()
  const aliases: Array<{ re: RegExp; tokens: string[] }> = [
    { re: /locked out|forced to leave|court order|door/, tokens: ['illegal', 'evict', 'lock'] },
    { re: /emergency housing|tonight|homeless/, tokens: ['homeless'] },
    { re: /written tenancy|right to stay/, tokens: ['tenancy', 'occupier', 'tenant', 'landlord'] },
    { re: /wages|holiday pay/, tokens: ['wage', 'holiday', 'acas'] },
    { re: /next to stay safe|next step/, tokens: ['illegal', 'homeless', 'shelter'] },
  ]
  return questions.filter((q) => {
    const alias = aliases.find((a) => a.re.test(q))
    if (alias && alias.tokens.some((tok) => hay.includes(tok))) return false
    const keys = q
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 5)
      .slice(0, 6)
    return keys.filter((w) => hay.includes(w)).length < Math.min(2, keys.length)
  })
}

function independentReviewCopy(session: SessionState): { title: string; description: string } {
  const slugs = issueSlugsFromFrame(session.matterFrame)
  const housing = slugs.some((s) => s.startsWith('housing'))
  const family = slugs.some((s) => s.startsWith('family'))
  const employment = slugs.some((s) => s.startsWith('employment'))
  const employer = session.confirmedUserRole === 'employer'
  const blob = `${session.whatHappened || ''} ${session.goal || ''}`
  if (housing && /door|lock|vacat|homeless|no tenancy|forced.{0,24}leave|illegal evict/i.test(blob)) {
    return {
      title: 'Independent review',
      description:
        'Contact Shelter (including out-of-hours if you are homeless tonight), the council homelessness team, and Citizens Advice. A lock-out or being forced out without a court order is a housing emergency — not a tenancy-deposit dispute.',
    }
  }
  if (housing) {
    return {
      title: 'Independent review',
      description:
        'Ask Citizens Advice, Shelter (housing), or a solicitor to review occupancy status, notices, and next steps before you sign or leave.',
    }
  }
  if (employment && family) {
    return {
      title: 'Independent review',
      description:
        employer
          ? 'Speak to an employment solicitor (employer-side process) and ask them to coordinate with your family solicitor before you act.'
          : 'Speak to an employment solicitor and ask them to coordinate with a family solicitor if relationship breakdown is also in play.',
    }
  }
  if (employment) {
    return {
      title: 'Independent review',
      description: 'Ask Acas or an employment solicitor to review process, documents, and next steps before you act.',
    }
  }
  return {
    title: 'Independent review',
    description: 'Ask Citizens Advice or a solicitor to review the documents and official guidance against your facts.',
  }
}

function buildOverview(session: SessionState, bundle: ResearchBundle, matter: MatterType): string {
  const claims = claimsAllowedByFrame(session, bundle.claims)
  const questions = extractClientQuestions(`${session.clientQuestion || ''}\n${session.whatHappened || ''}`)
  const uncovered = uncoveredQuestions(session, claims, claims.map((c) => c.claim).join(' '))
  const slugs = issueSlugsFromFrame(session.matterFrame)
  const issueLead = slugs.length
    ? `Legal issues in play: ${slugs.slice(0, 4).map((s) => s.replace(/_/g, ' ')).join('; ')}.`
    : matter !== 'unknown'
      ? `For ${matter.replace(/_/g, ' ')} matters, start with the governing documents and official UK guidance before you sign or commit.`
      : 'Start with the governing documents and official UK guidance before you sign or commit.'

  const covered = claims
    .slice(0, 4)
    .map((c) => c.claim.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const parts = [issueLead]
  if (questions.length) parts.push(`Your questions: ${questions.join(' ')}`)
  if (covered.length) parts.push(`What the sources cover: ${covered.join('; ')}.`)
  if (uncovered.length) parts.push(`Not yet covered from your questions: ${uncovered.join(' ')}`)
  parts.push('This is signposting from researched sources — not legal advice on your specific outcome.')
  return parts.join(' ')
}

function buildBullets(session: SessionState, bundle: ResearchBundle): AnswerBullet[] {
  const lookup = sourceById(bundle)
  const bullets: AnswerBullet[] = []
  const seen = new Set<string>()

  for (const claim of claimsAllowedByFrame(session, bundle.claims)) {
    const source = claim.sourceIds.map((id) => lookup.get(id)).find(Boolean)
    if (!source?.url || seen.has(source.url)) continue
    seen.add(source.url)
    bullets.push({
      text: `${claim.claim}${claim.confidence === 'low' ? ' (verify against the cited source before relying on this).' : ''}`,
      sourceTitle: source.title,
      sourceUrl: source.url,
      tier: sourceTier(source.tier),
    })
    if (bullets.length >= 4) break
  }

  if (bullets.length < 2) {
    for (const source of bundle.sources) {
      if (!source.url || seen.has(source.url)) continue
      seen.add(source.url)
      bullets.push({
        text: source.excerpt.replace(/\s+/g, ' ').trim().slice(0, 280),
        sourceTitle: source.title,
        sourceUrl: source.url,
        tier: sourceTier(source.tier),
      })
      if (bullets.length >= 4) break
    }
  }

  return bullets
}

function buildFreeHelp(session: SessionState, bundle: ResearchBundle) {
  const freeHelp: AnswerPackage['freeHelp'] = []
  const seen = new Set<string>()

  const push = (title: string, url: string, blurb: string) => {
    if (!url || seen.has(url)) return
    seen.add(url)
    freeHelp.push({ title, url, blurb })
  }

  for (const resource of bundle.freeResources) {
    push(resource.title, resource.url, resource.description.slice(0, 160))
    if (freeHelp.length >= 6) break
  }

  const matched = matchingSessionForHelp(session)
  for (const service of matchFreeServices(matched, 6)) {
    push(service.title, service.url, service.blurb?.slice(0, 160) || service.description?.slice(0, 160) || '')
    if (freeHelp.length >= 8) break
  }

  if (freeHelp.length === 0) {
    push(
      'Citizens Advice — get advice',
      'https://www.citizensadvice.org.uk/get-advice/',
      'Free guidance and local referral pathways.',
    )
  }

  return freeHelp
}

export function buildResearchLedAnswerPackage(
  session: SessionState,
  bundle: ResearchBundle,
  _frames: LegalFrame[] = [],
): AnswerPackage {
  const matter = resolveMatterType(session, bundle)
  const bullets = buildBullets(session, bundle)
  const freeHelp = buildFreeHelp(session, bundle)
  const uncovered = uncoveredQuestions(
    session,
    claimsAllowedByFrame(session, bundle.claims),
    bundle.answerDraft || '',
  )
  const recommendations =
    uncovered.length > 0
      ? [
          ...uncovered.slice(0, 3).map((q) => `Still needs sources: ${q}`),
          ...bundle.nextActions.slice(0, 2),
        ]
      : bundle.nextActions.length > 0
        ? bundle.nextActions.slice(0, 4)
        : bullets.map((b) => b.text).slice(0, 3)

  const missingFacts =
    uncovered.length > 0
      ? uncovered.slice(0, 6)
      : bundle.missingFacts.length > 0
        ? bundle.missingFacts.slice(0, 6)
        : ['Exact dates, documents, contract wording, and the outcome you want.']

  const pack: AnswerPackage = {
    answerOverview: buildOverview(session, bundle, matter),
    bullets,
    recommendations,
    options: [
      {
        title: 'Self-help using official guidance',
        description: 'Work through the cited sources and gather documents before signing or paying.',
      },
      independentReviewCopy(session),
    ],
    missingFacts,
    followUps: defaultAnswerFollowUps(missingFacts),
    wikiPages: [],
    freeHelp,
    recommendedFirms: [],
    sources: bullets.map((b) => ({
      title: b.sourceTitle,
      url: b.sourceUrl,
      kind: b.tier,
    })),
    researchBundle: bundle,
    citation: { ok: true, issues: [] },
    matchedTopicId: 'research-led',
    policyNote:
      'Composed from Third Eye research sources and claims. External leads are unverified until checked against official guidance — signposting only, not legal advice.',
  }

  pack.citation = checkAnswerCitations(pack)
  return pack
}
