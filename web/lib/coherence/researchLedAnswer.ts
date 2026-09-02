/**
 * Compose Overview / Recommendation from Third Eye (Penumbra) research output
 * instead of adding a new curated topic pack per scenario.
 */
import type { ResearchBundle, ResearchSource } from './researchBundle'
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import type { AnswerPackage, AnswerBullet } from './answerPackage'
import { defaultAnswerFollowUps } from './answerPackage'
import { checkAnswerCitations } from './citationCheck'
import { matchFreeServices } from './matchFreeServices'
import { matchingSessionForHelp } from './services'
import type { MatterType } from './types'

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

function buildOverview(session: SessionState, bundle: ResearchBundle, matter: MatterType): string {
  const draft = bundle.answerDraft?.trim()
  if (draft && draft.length >= 80) {
    return draft.length > 1200 ? `${draft.slice(0, 1197)}…` : draft
  }

  const question = session.clientQuestion?.trim()
  const claimBits = bundle.claims
    .slice(0, 3)
    .map((c) => c.claim)
    .join(' ')
  const matterLead =
    matter === 'housing'
      ? 'For a private tenancy in England, open guidance usually starts with the tenancy agreement, deposit protection, and the condition record at check-in.'
      : matter !== 'unknown'
        ? `For ${matter.replace(/_/g, ' ')} matters, start with the governing documents and official UK guidance before you sign or commit.`
        : 'Start with the governing documents and official UK guidance before you sign or commit.'

  const parts = [matterLead]
  if (question) parts.push(`Your question: ${question}`)
  if (claimBits) parts.push(claimBits)
  parts.push('This is signposting from researched sources — not legal advice on your specific outcome.')

  return parts.join(' ')
}

function buildBullets(bundle: ResearchBundle): AnswerBullet[] {
  const lookup = sourceById(bundle)
  const bullets: AnswerBullet[] = []
  const seen = new Set<string>()

  for (const claim of bundle.claims) {
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
  const bullets = buildBullets(bundle)
  const freeHelp = buildFreeHelp(session, bundle)
  const recommendations =
    bundle.nextActions.length > 0
      ? bundle.nextActions.slice(0, 4)
      : bullets.map((b) => b.text).slice(0, 3)

  const missingFacts =
    bundle.missingFacts.length > 0
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
      {
        title: 'Independent review',
        description: 'Ask Citizens Advice, Shelter (housing), or a solicitor to review the wording if liability or deposits are unclear.',
      },
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
