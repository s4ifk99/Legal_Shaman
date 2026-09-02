/**
 * Matter-type signposting when no curated pack or Third Eye bundle matched.
 * One overview per matter area — not per sub-topic.
 */
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import type { MatterType } from './types'
import type { AnswerPackage } from './answerPackage'
import { defaultAnswerFollowUps } from './answerPackage'
import { checkAnswerCitations } from './citationCheck'
import { matchFreeServices } from './matchFreeServices'

const MATTER_SIGNPOST: Partial<
  Record<
    MatterType,
    { overview: string; policy: string; missingFacts: string[] }
  >
> = {
  housing: {
    overview:
      'Housing questions usually turn on the tenancy type, the written agreement, deposit protection, check-in condition, and who is responsible for repairs. Gather the tenancy agreement, inventory, deposit certificate, and dated communications before signing anything that shifts liability.',
    policy: 'Housing signposting pack: verify tenancy documents and deposit scheme position before acting. Not legal advice.',
    missingFacts: [
      'Tenancy type, start date, and whether this is a new tenancy or an assignment.',
      'Deposit amount, scheme, and any inventory or schedule of condition.',
      'The exact clause wording and outcome you want.',
    ],
  },
  employment: {
    overview:
      'Employment disputes usually turn on your contract, length of service, the employer’s stated reason, and whether internal grievance or appeal steps were followed. Keep payslips, correspondence, and any dismissal or disciplinary letters.',
    policy: 'Employment signposting pack: ACAS and Citizens Advice before tribunal routes. Not legal advice.',
    missingFacts: ['Employment start date, dismissal or dispute date, and whether ACAS early conciliation has started.'],
  },
  consumer: {
    overview:
      'Consumer disputes usually turn on who you contracted with, what was promised, payment records, and the trader’s complaint process. Keep contracts, receipts, photos, and dated messages.',
    policy: 'Consumer signposting pack: trader complaint process before court. Not legal advice.',
    missingFacts: ['Purchase date, trader status, and the remedy you are seeking.'],
  },
  family: {
    overview:
      'Family matters usually turn on the relationship status, children involved, and whether you need a court order or a negotiated agreement. Keep financial documents and any existing orders.',
    policy: 'Family signposting pack: mediation where safe; court orders need formal process. Not legal advice.',
    missingFacts: ['Marriage or civil partnership status, children, and any existing court orders.'],
  },
  debt: {
    overview:
      'Debt problems usually turn on who the creditor is, whether the debt is enforceable, and your income and essential spending. Keep letters, statements, and any court or enforcement notices.',
    policy: 'Debt signposting pack: free debt advice before paying enforcement agents. Not legal advice.',
    missingFacts: ['Creditor name, amount, and whether court or bailiff action has started.'],
  },
  immigration: {
    overview:
      'Immigration questions usually turn on your current status, application history, and Home Office correspondence. Keep decision letters, biometric appointment records, and any refusal reasons.',
    policy: 'Immigration signposting pack: check official routes and deadlines. Not legal advice.',
    missingFacts: ['Current immigration status and key Home Office dates or refusals.'],
  },
}

export function buildMatterLedAnswerPackage(
  session: SessionState,
  frames: LegalFrame[] = [],
): AnswerPackage | null {
  const matter = session.matterType
  if (!matter || matter === 'unknown' || matter === 'other') return null

  const signpost = MATTER_SIGNPOST[matter]
  if (!signpost) return null

  const officialHits = (session.authorityHits || []).filter(
    (h) => h.kind !== 'law_firm' && h.tier !== 'firm' && h.url,
  )
  const bullets = officialHits.slice(0, 4).map((h) => ({
    text: `Official / trusted guidance: ${h.title.replace(/\s*\|\s*.*$/, '')}. Check how it applies to your facts.`,
    sourceTitle: h.title,
    sourceUrl: h.url,
    tier: 'trusted-guidance' as const,
  }))

  const freeHelp = matchFreeServices(session, 6).map((s) => ({
    title: s.title,
    url: s.url,
    blurb: s.blurb?.slice(0, 160) || s.description?.slice(0, 160) || '',
  }))

  if (freeHelp.length === 0) {
    freeHelp.push({
      title: 'Citizens Advice — get advice',
      url: 'https://www.citizensadvice.org.uk/get-advice/',
      blurb: 'Free guidance and local referral pathways.',
    })
  }

  const pack: AnswerPackage = {
    answerOverview: signpost.overview,
    bullets,
    recommendations: [
      'Gather the key documents and dates before signing or paying.',
      'Use the official guidance listed below to compare your situation.',
      'Ask Citizens Advice or a solicitor to review wording if liability is unclear.',
    ],
    options: [
      {
        title: 'Self-help using official guidance',
        description: 'Follow cited sources and keep a dated record of condition and communications.',
      },
      {
        title: 'Independent review',
        description: 'Get a document check if deposits, assignment, or liability clauses are unclear.',
      },
    ],
    missingFacts: signpost.missingFacts,
    followUps: defaultAnswerFollowUps(signpost.missingFacts),
    wikiPages: [],
    freeHelp,
    recommendedFirms: [],
    sources: bullets.map((b) => ({ title: b.sourceTitle, url: b.sourceUrl, kind: b.tier })),
    citation: { ok: true, issues: [] },
    matchedTopicId: `matter-${matter}`,
    policyNote: signpost.policy,
  }

  pack.citation = checkAnswerCitations(pack)
  return pack
}
