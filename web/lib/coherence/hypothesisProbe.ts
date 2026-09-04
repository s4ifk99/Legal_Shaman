/**
 * Hypothesis-probe loop: rank competing matters, ask discriminating questions,
 * optionally attach light local wiki evidence, then commit one MatterFrame.
 * Penumbra / Overview stay freeze-scoped after commit.
 */
import type { MatterFrame, MatterIssue, MatterResolveResult } from '@/lib/matter/types'
import type { Prompt, SessionState } from './types'

export const HYPOTHESIS_PROBE_MAX_TURNS = 3

export type HypothesisEvidence = {
  title: string
  support: 'support' | 'contradict' | 'neutral'
}

export type MatterHypothesis = {
  slug: string
  score: number
  why: string[]
  evidence: HypothesisEvidence[]
}

export type HypothesisSet = {
  hypotheses: MatterHypothesis[]
  turns: number
  askedProbeIds: string[]
  selectedSlug?: string
}

export type HypothesisProbeState = {
  set: HypothesisSet
  status: 'probing' | 'committed'
  turns: number
}

const SLUG_LABEL: Record<string, string> = {
  employment: 'employment / workplace rules',
  family: 'family / children',
  housing: 'housing / tenancy',
  crime: 'crime / police',
  debt: 'debt / money owed',
  consumer: 'consumer / goods',
  immigration: 'immigration',
  personal_injury: 'injury',
  conveyancing: 'buying or selling a home',
}

function labelForSlug(slug: string): string {
  if (SLUG_LABEL[slug]) return SLUG_LABEL[slug]
  if (slug.startsWith('employment')) return 'employment / workplace rules'
  if (slug.startsWith('family')) return 'family / children'
  if (slug.startsWith('housing') || slug.includes('rro') || slug.includes('rent')) {
    return 'housing / tenancy'
  }
  return slug.replace(/_/g, ' ')
}

function normalizeSlug(slug: string): string {
  if (slug.startsWith('employment') || slug === 'wages_contract' || slug === 'unfair_dismissal') {
    return 'employment'
  }
  if (slug.startsWith('family') || slug.includes('child')) return 'family'
  if (slug.startsWith('housing') || slug.includes('landlord') || slug.includes('tenant')) {
    return 'housing'
  }
  if (slug.startsWith('crime') || slug.includes('criminal')) return 'crime'
  if (slug.startsWith('debt')) return 'debt'
  if (slug.startsWith('consumer')) return 'consumer'
  return slug
}

/** Workplace leave / staff-rules cues (shared with resolve). */
export function storyLooksWorkplaceLeaveOrStaffRules(story: string): boolean {
  const t = story.toLowerCase()
  const job =
    /\b(job|employer|employee|staff|cleaner|workplace|at work|my (?:job|work)|started (?:another |a )?job)\b/i.test(
      t,
    )
  const leave =
    /\b(not allowed holidays?|holiday(?:s)? during (?:school )?term|term[- ]time.{0,40}holiday|annual leave|holiday (?:pay|hours|entitlement|ban)|school breaks?.{0,40}holiday|holiday.{0,40}school (?:term|breaks?))\b/i.test(
      t,
    )
  const staffRules =
    /\b(no phones?|earphones?|headphones?|staff (?:rules?|handbook)|workplace rules?)\b/i.test(t)
  return job && (leave || staffRules)
}

export function storyLooksWorkplaceNeurodiversityAdjustments(story: string): boolean {
  const t = story.toLowerCase()
  const neuro =
    /\b(autism|autistic|adhd|severe anxiety|anxiety|neurodivers(?:e|ity)|reasonable adjustments?)\b/i.test(
      t,
    )
  const workplace =
    /\b(job|staff|employer|employee|at work|workplace|earphones?|headphones?|phones?|cleaner)\b/i.test(
      t,
    )
  return neuro && workplace
}

function boostFromStory(story: string, slug: string): { score: number; why: string[] } {
  const why: string[] = []
  let score = 0
  if (slug === 'employment') {
    if (storyLooksWorkplaceLeaveOrStaffRules(story)) {
      score += 28
      why.push('job + holiday ban or staff rules')
    }
    if (storyLooksWorkplaceNeurodiversityAdjustments(story)) {
      score += 18
      why.push('workplace neurodiversity / adjustments cues')
    }
    if (/\b(acas|employment tribunal|grievance|holiday pay|annual leave)\b/i.test(story)) {
      score += 12
      why.push('employment rights language')
    }
  }
  if (slug === 'family') {
    if (
      /\b(divorce|custody|child arrangement|care order|domestic abuse|ex[- ]?(?:partner|wife|husband))\b/i.test(
        story,
      )
    ) {
      score += 30
      why.push('explicit family-law language')
    } else if (
      /\bcontact\b/i.test(story) &&
      !/\b(team|staff|colleague|radios?|phones?)\b/i.test(story)
    ) {
      score += 8
      why.push('contact language')
    } else if (/\b(school|teachers?)\b/i.test(story) && storyLooksWorkplaceLeaveOrStaffRules(story)) {
      score -= 12
      why.push('school/teacher backdrop on workplace story')
    }
  }
  return { score, why }
}

function mergeHypothesis(
  map: Map<string, MatterHypothesis>,
  slug: string,
  score: number,
  why: string,
): void {
  const key = normalizeSlug(slug)
  const prev = map.get(key)
  if (!prev) {
    map.set(key, { slug: key, score, why: why ? [why] : [], evidence: [] })
    return
  }
  prev.score = Math.max(prev.score, score) + Math.min(8, score * 0.15)
  if (why && !prev.why.includes(why)) prev.why.push(why)
}

export function buildHypothesisSet(
  resolveResult: MatterResolveResult,
  session: SessionState,
  story: string,
): HypothesisSet {
  const map = new Map<string, MatterHypothesis>()
  const frame = resolveResult.frame
  const candidates =
    (frame.provenance?.taxonomyAgent?.candidates as Array<{ slug: string; score: number }> | undefined) ||
    []

  for (const c of candidates.slice(0, 6)) {
    mergeHypothesis(map, c.slug, Number(c.score) || 0, 'taxonomy candidate')
  }
  for (const issue of [...frame.primaryIssues, ...frame.secondaryIssues]) {
    mergeHypothesis(
      map,
      issue.slug,
      Math.round((issue.confidence || 0.4) * 40),
      issue.reason || 'frame issue',
    )
  }

  // Sense-driven competitors even when taxonomy missed them
  if (storyLooksWorkplaceLeaveOrStaffRules(story) || storyLooksWorkplaceNeurodiversityAdjustments(story)) {
    mergeHypothesis(map, 'employment', 22, 'workplace leave / staff-rules detector')
  }
  if (session.matterType && session.matterType !== 'unknown') {
    mergeHypothesis(map, session.matterType, 10, `sense matterType=${session.matterType}`)
  }

  for (const [slug, hyp] of map) {
    const boost = boostFromStory(story, slug)
    hyp.score += boost.score
    for (const w of boost.why) {
      if (!hyp.why.includes(w)) hyp.why.push(w)
    }
  }

  const hypotheses = [...map.values()].sort((a, b) => b.score - a.score).slice(0, 3)
  return { hypotheses, turns: 0, askedProbeIds: [] }
}

export function shouldCommitHypothesisSet(set: HypothesisSet, turns = set.turns): boolean {
  if (set.selectedSlug) return true
  if (turns >= HYPOTHESIS_PROBE_MAX_TURNS) return true
  const top = set.hypotheses[0]
  const second = set.hypotheses[1]
  if (!top) return true
  if (!second) return top.score >= 24
  const ratio = second.score / Math.max(top.score, 1)
  // Clear winner and not a family-only lock on a workplace story
  if (ratio < 0.72 && top.score >= 28) return true
  return false
}

function probePair(set: HypothesisSet): [MatterHypothesis, MatterHypothesis] | null {
  const a = set.hypotheses[0]
  const b = set.hypotheses[1]
  if (!a || !b) return null
  return [a, b]
}

export function nextHypothesisProbe(set: HypothesisSet, _session: SessionState): Prompt | null {
  if (shouldCommitHypothesisSet(set)) return null
  const pair = probePair(set)
  const turn = set.turns

  if (pair) {
    const [a, b] = pair
    const id = `hyp_probe_${a.slug}_vs_${b.slug}_${turn}`
    if (!set.askedProbeIds.includes(id)) {
      return {
        id,
        kind: 'closed',
        text: `Is this mainly about ${labelForSlug(a.slug)}, or ${labelForSlug(b.slug)}?`,
        reason:
          'Competing legal areas — pick the live dispute so research stays on the right geometry.',
        options: [
          {
            id: `hyp-${a.slug}`,
            label: `Mainly ${labelForSlug(a.slug)}`,
            value: `This is mainly about ${a.slug}`,
          },
          {
            id: `hyp-${b.slug}`,
            label: `Mainly ${labelForSlug(b.slug)}`,
            value: `This is mainly about ${b.slug}`,
          },
          {
            id: 'hyp-unsure',
            label: 'Not sure — ask another question',
            value: 'Not sure which area — ask another discriminating question.',
          },
        ],
      }
    }
  }

  // Discriminating follow-ups when still close
  const top = set.hypotheses[0]
  if (top?.slug === 'employment' || set.hypotheses.some((h) => h.slug === 'employment')) {
    const id = `hyp_probe_emp_detail_${turn}`
    if (!set.askedProbeIds.includes(id)) {
      return {
        id,
        kind: 'closed',
        text: 'What is the live workplace problem you want help with first?',
        reason: 'Splits holiday entitlement vs staff phone/adjustment rules vs something else.',
        options: [
          {
            id: 'emp-leave',
            label: 'Term-time holiday / leave ban',
            value: 'The live problem is the ban on holidays during school term.',
          },
          {
            id: 'emp-phone',
            label: 'Phone / earphones / staff contact rules',
            value: 'The live problem is phone, earphones or how staff contact each other at work.',
          },
          {
            id: 'emp-both',
            label: 'Both leave and phone/adjustment rules',
            value: 'Both the holiday ban and the phone/earphones rules matter.',
          },
          {
            id: 'emp-not',
            label: 'Not a workplace problem',
            value: 'This is not mainly a workplace or employment problem.',
          },
        ],
      }
    }
  }

  if (top?.slug === 'family' || set.hypotheses.some((h) => h.slug === 'family')) {
    const id = `hyp_probe_fam_detail_${turn}`
    if (!set.askedProbeIds.includes(id)) {
      return {
        id,
        kind: 'closed',
        text: 'Is this about your own family/children case, or about rules at a school workplace?',
        reason: 'Stops school/staff “contact” language from locking child arrangements.',
        options: [
          {
            id: 'fam-yes',
            label: 'My family / children case',
            value: 'This is about my family, children, divorce or domestic arrangements.',
          },
          {
            id: 'fam-work',
            label: 'Rules at my school job',
            value: 'This is about rules at my school workplace job, not a family court matter.',
          },
        ],
      }
    }
  }

  // Fallback: force a pick among remaining hypotheses
  const id = `hyp_probe_force_${turn}`
  return {
    id,
    kind: 'closed',
    text: 'Which legal area should we research first?',
    reason: 'Probe budget nearly spent — commit a geometry before Third Eye.',
    options: set.hypotheses.slice(0, 3).map((h) => ({
      id: `hyp-${h.slug}`,
      label: `Mainly ${labelForSlug(h.slug)}`,
      value: `This is mainly about ${h.slug}`,
    })),
  }
}

function bumpSlug(set: HypothesisSet, slug: string, amount: number, why: string): HypothesisSet {
  const key = normalizeSlug(slug)
  const hypotheses = set.hypotheses.map((h) => {
    if (h.slug !== key) return { ...h, score: h.score * 0.92 }
    return {
      ...h,
      score: h.score + amount,
      why: h.why.includes(why) ? h.why : [...h.why, why],
    }
  })
  if (!hypotheses.some((h) => h.slug === key)) {
    hypotheses.push({ slug: key, score: amount, why: [why], evidence: [] })
  }
  hypotheses.sort((a, b) => b.score - a.score)
  return { ...set, hypotheses: hypotheses.slice(0, 3) }
}

export function applyHypothesisProbeAnswer(
  set: HypothesisSet,
  promptId: string,
  value: string,
): HypothesisSet {
  const v = value.toLowerCase()
  let next: HypothesisSet = {
    ...set,
    turns: set.turns + 1,
    askedProbeIds: [...set.askedProbeIds, promptId],
  }

  const mainly = v.match(/mainly about ([a-z0-9_ /]+)/i)
  if (mainly?.[1]) {
    const slug = normalizeSlug(mainly[1].trim().replace(/\s+/g, '_').split('/')[0] || '')
    if (slug) {
      next = bumpSlug(next, slug, 40, 'user selected hypothesis')
      next = { ...next, selectedSlug: slug }
      return next
    }
  }

  if (/not a workplace|not mainly a workplace|family court|my family|children|divorce|domestic/i.test(v)) {
    if (/family court|my family|children|divorce|domestic/i.test(v)) {
      next = bumpSlug(next, 'family', 36, 'user confirmed family')
      next = { ...next, selectedSlug: 'family' }
    } else {
      next = bumpSlug(next, 'family', -20, 'user rejected workplace?')
      // "not workplace" without family confirm — demote employment
      next = bumpSlug(next, 'employment', -30, 'user said not workplace')
    }
    return next
  }

  if (/rules at my school workplace|school workplace job|not a family/i.test(v)) {
    next = bumpSlug(next, 'employment', 42, 'user confirmed school workplace')
    next = bumpSlug(next, 'family', -25, 'user rejected family court')
    next = { ...next, selectedSlug: 'employment' }
    return next
  }

  if (/holiday|leave ban|term-time/i.test(v)) {
    next = bumpSlug(next, 'employment', 30, 'user: holiday/leave live problem')
  }
  if (/phone|earphone|staff contact|adjustment/i.test(v)) {
    next = bumpSlug(next, 'employment', 28, 'user: phone/adjustment live problem')
  }
  if (/both the holiday ban and the phone/i.test(v)) {
    next = bumpSlug(next, 'employment', 35, 'user: leave + phone')
    next = { ...next, selectedSlug: 'employment' }
  }
  if (/not sure which area|ask another/i.test(v)) {
    // keep probing; slight entropy reduction on leader
    return next
  }

  return next
}

/** Merge precomputed wiki evidence onto hypotheses (from server research helper). */
export function mergeHypothesisEvidence(
  set: HypothesisSet,
  evidenceBySlug: Record<string, HypothesisEvidence[]>,
): HypothesisSet {
  const hypotheses = set.hypotheses.map((h) => {
    const evidence = evidenceBySlug[h.slug] || []
    if (!evidence.length) return h
    let score = h.score
    for (const e of evidence) {
      if (e.support === 'support') score += 4
      if (e.support === 'contradict') score -= 3
    }
    return {
      ...h,
      score,
      evidence: [...h.evidence, ...evidence].slice(0, 6),
      why:
        evidence.some((e) => e.support === 'support')
          ? h.why.includes('local wiki support')
            ? h.why
            : [...h.why, 'local wiki support']
          : h.why,
    }
  })
  hypotheses.sort((a, b) => b.score - a.score)
  return { ...set, hypotheses }
}

export function commitHypothesisToIssues(set: HypothesisSet): {
  primary: MatterIssue
  secondary: MatterIssue[]
  keepEquality: boolean
} {
  const ranked = [...set.hypotheses].sort((a, b) => b.score - a.score)
  const selected = set.selectedSlug
    ? ranked.find((h) => h.slug === set.selectedSlug) || ranked[0]
    : ranked[0]
  const primarySlug = selected?.slug || 'other'
  const primary: MatterIssue = {
    slug: primarySlug === 'employment' ? 'employment' : primarySlug,
    confidence: Math.min(0.92, 0.55 + (selected?.score || 0) / 100),
    reason: selected?.why.join('; ') || 'hypothesis commit',
  }
  const secondary: MatterIssue[] = ranked
    .filter((h) => h.slug !== primary.slug)
    .slice(0, 3)
    .map((h) => ({
      slug: h.slug,
      confidence: Math.min(0.7, 0.35 + h.score / 120),
      reason: h.why[0] || 'hypothesis secondary',
    }))
  const keepEquality =
    primary.slug === 'employment' &&
    (Boolean(selected?.why.some((w) => /neurodiversity|adjustment|disability/i.test(w))) ||
      ranked.some((h) => h.slug === 'employment' && h.why.some((w) => /neurodiversity|adjustment/i.test(w))))
  return { primary, secondary, keepEquality }
}

export function applyCommittedHypothesisToFrame(
  frame: MatterFrame,
  set: HypothesisSet,
): MatterFrame {
  const { primary, secondary, keepEquality } = commitHypothesisToIssues(set)
  const exclusions = keepEquality
    ? frame.exclusions.filter((e) => e !== 'discrimination_equality')
    : frame.exclusions.includes('discrimination_equality')
      ? frame.exclusions
      : primary.slug === 'employment'
        ? frame.exclusions
        : [...frame.exclusions, 'discrimination_equality']

  // If employment committed with workplace disability cues, drop equality exclusion
  let nextExclusions = [...exclusions]
  if (keepEquality) {
    nextExclusions = nextExclusions.filter((e) => e !== 'discrimination_equality')
  }

  return {
    ...frame,
    primaryIssues: [primary],
    secondaryIssues: secondary,
    exclusions: nextExclusions,
    overallConfidence: primary.confidence,
    resolutionStatus: 'resolved',
    ambiguities: frame.ambiguities.map((a) => ({ ...a, blocking: false })),
    retrievalScope: [
      primary.slug,
      ...secondary.slice(0, 2).map((s) => s.slug),
      ...(frame.retrievalScope || []),
    ]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 8),
  }
}

export function isHypothesisProbePromptId(id: string): boolean {
  return id === 'matter_gate' || id === 'hyp_probe_gate' || id.startsWith('hyp_probe_')
}
