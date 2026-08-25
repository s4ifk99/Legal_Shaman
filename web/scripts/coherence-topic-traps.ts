/**
 * Coherence topic-trap regression suite.
 * Fails the process if known bleed / forgetting bugs return.
 *
 * Run: npm run test:coherence-traps
 *
 * Includes LexRAG / MAP-Law inspired multi-turn traps — see
 * docs/product-decisions/coherence-turn-state.md
 */
import { createInitialSession, senseDetails } from '../lib/coherence/sense'
import { proposeCoherentFrames } from '../lib/coherence/frames'
import { buildAnswerPackage } from '../lib/coherence/answerPackage'
import { buildQuestionForGap, openCausationGaps } from '../lib/coherence/causation'
import { resolveTopicLock, packConflictsWithLock, applyTopicLockToSession } from '../lib/coherence/topicLock'
import { deriveTurnState, mustScopeRetrieval } from '../lib/coherence/turnState'
import { nextPrompt } from '../lib/coherence/questions'
import type { SessionState } from '../lib/coherence/types'

type TrapResult = { id: string; ok: boolean; detail: string }

function intake(lines: string[]): SessionState {
  let s = createInitialSession()
  for (const line of lines) {
    s = senseDetails(line, s)
    s = applyTopicLockToSession(s, proposeCoherentFrames(s, 3))
  }
  return s
}

function assert(cond: boolean, detail: string): string | null {
  return cond ? null : detail
}

const traps: Array<{ id: string; run: () => string | null }> = [
  {
    id: 'neighbour-carport-not-used-car',
    run: () => {
      const s = intake([
        'Neighbour blocked my driveway',
        'They are constructing a car port directly in front of the driveway',
        'England',
      ])
      const frames = proposeCoherentFrames(s, 3)
      const lock = resolveTopicLock(s, frames)
      const pack = buildAnswerPackage(s, frames)
      return (
        assert(frames.some((f) => f.id === 'hous-neighbour'), `expected hous-neighbour, got ${frames.map((f) => f.id).join(',')}`) ||
        assert(lock?.packId === 'neighbour-access-dispute', `lock=${lock?.packId}`) ||
        assert(pack.matchedTopicId === 'neighbour-access-dispute', `pack=${pack.matchedTopicId}`) ||
        assert(!/Consumer Rights Act|used car bought from a trader/i.test(pack.answerOverview), 'CRA used-car overview leaked') ||
        assert(!pack.bullets.some((b) => /used car|CRA s\./i.test(b.text)), 'CRA bullets on neighbour story')
      )
    },
  },
  {
    id: 'neighbour-no-landlord-evidence-chips',
    run: () => {
      const s = intake(['Stop neighbour parking on my driveway', 'England'])
      const frames = proposeCoherentFrames(s, 3)
      const gaps = openCausationGaps(s)
      const evidence =
        gaps.find((g) => g.id === 'gap_evidence') ||
        ({ id: 'gap_evidence', label: 'e', priority: 40, kind: 'closed' as const, reason: 'x', filled: false })
      const q = buildQuestionForGap(s, evidence)
      return (
        assert(frames.some((f) => f.id === 'hous-neighbour'), 'missing hous-neighbour') ||
        assert(!/Find lawful routes/i.test(q.text), `cited internal goal: ${q.text}`) ||
        assert(!/tenancy/i.test(q.options.map((o) => o.label).join(' ')), 'tenancy chip on neighbour evidence') ||
        assert(/photo|message|evidence/i.test(q.text), `unexpected evidence Q: ${q.text}`)
      )
    },
  },
  {
    id: 'neighbour-no-landlord-breach-chips',
    run: () => {
      const s = intake(['My neighbour keeps parking on my driveway and will not move'])
      const q = buildQuestionForGap(s, {
        id: 'gap_breach',
        label: 'breach',
        priority: 85,
        kind: 'open',
        reason: 'x',
        filled: false,
      })
      const labels = q.options.map((o) => o.label).join(' | ')
      return (
        assert(/neighbour/i.test(q.text), `expected neighbour actor, got: ${q.text}`) ||
        assert(!/Failed to repair|Unlawful lockout/i.test(labels), `landlord chips: ${labels}`)
      )
    },
  },
  {
    id: 'england-not-cited-over-story',
    run: () => {
      const s = intake([
        'This is mainly about housing or a neighbour dispute',
        'Stop neighbour parking on my driveway',
        'England',
      ])
      const q = buildQuestionForGap(s, {
        id: 'gap_when',
        label: 'when',
        priority: 60,
        kind: 'closed',
        reason: 'x',
        filled: false,
      })
      return assert(
        !/"England"/i.test(q.text) && /driveway|neighbour|parking/i.test(q.text),
        `cite drifted: ${q.text}`,
      )
    },
  },
  {
    id: 'landlord-mould-still-housing',
    run: () => {
      const s = intake(['My landlord will not fix the mould in the bathroom', 'England'])
      const frames = proposeCoherentFrames(s, 3)
      const pack = buildAnswerPackage(s, frames)
      return (
        assert(!frames.some((f) => f.id === 'hous-neighbour'), `unexpected neighbour frame: ${frames.map((f) => f.id)}`) ||
        assert(pack.matchedTopicId !== 'neighbour-access-dispute', `neighbour pack on landlord mould`) ||
        assert(pack.matchedTopicId !== 'car-reject-failed-repair', 'used-car pack on mould')
      )
    },
  },
  {
    id: 'used-car-still-cra',
    run: () => {
      const s = intake([
        'I bought a used car from a dealer last month and it broke down',
        'They will not refund or repair it',
      ])
      s.matterType = 'consumer'
      const frames = proposeCoherentFrames(s, 3)
      const pack = buildAnswerPackage(s, frames)
      return (
        assert(pack.matchedTopicId === 'car-reject-failed-repair', `pack=${pack.matchedTopicId}`) ||
        assert(/Consumer Rights Act|used car/i.test(pack.answerOverview), 'missing CRA overview')
      )
    },
  },
  {
    id: 'topic-lock-forbids-car-on-neighbour',
    run: () => {
      const s = intake(['Neighbour blocked my driveway with a car port'])
      const frames = proposeCoherentFrames(s, 3)
      const lock = resolveTopicLock(s, frames)
      return (
        assert(!!lock, 'no lock') ||
        assert(packConflictsWithLock(lock, 'car-reject-failed-repair'), 'car pack should be forbidden') ||
        assert(s.topicId === 'housing-access', `topicId=${s.topicId}`)
      )
    },
  },
  {
    id: 'family-belongings-not-custody-pack',
    run: () => {
      const story =
        'My ex threw my 7 year old son’s Switch and broke it. I want to sue for the cost of replacing it.'
      const s = intake([story])
      const frames = proposeCoherentFrames(s, 3)
      const pack = buildAnswerPackage(s, frames)
      const blob = `${pack.answerOverview} ${pack.bullets.map((b) => b.text).join(' ')}`
      return (
        assert(pack.matchedTopicId !== 'car-reject-failed-repair', 'used-car on belongings') ||
        assert(!/child arrangement|custody|indefinite leave|10-?year charge/i.test(blob), `wrong family bleed: ${blob.slice(0, 120)}`)
      )
    },
  },

  // --- LexRAG / MAP-Law inspired multi-turn traps ---

  {
    id: 'lexrag-mid-dialogue-england-keeps-neighbour-lock',
    run: () => {
      const s = intake([
        'Getting Help',
        'This is mainly about housing or a neighbour dispute',
        'Neighbour blocked my driveway and is building a car port',
        'I have photos of the blocked access',
        'England',
      ])
      const frames = proposeCoherentFrames(s, 3)
      const lock = resolveTopicLock(s, frames)
      const pack = buildAnswerPackage(s, frames)
      const state = deriveTurnState(s, frames, lock)
      return (
        assert(lock?.packId === 'neighbour-access-dispute', `lock=${lock?.packId}`) ||
        assert(pack.matchedTopicId === 'neighbour-access-dispute', `pack=${pack.matchedTopicId}`) ||
        assert(state.covered.includes('access_harm'), `missing access_harm: ${state.covered}`) ||
        assert(state.covered.includes('counterparty_neighbour'), `missing neighbour: ${state.covered}`) ||
        assert(
          mustScopeRetrieval(state) || state.nextAction === 'clarify' || state.nextAction === 'stop_overview',
          `bad action ${state.nextAction}`,
        ) ||
        assert(state.nextAction !== 'reformulate', 'should not reformulate a clear neighbour story')
      )
    },
  },
  {
    id: 'maplaw-neighbour-coverage-core-before-overview',
    run: () => {
      const thin = intake(['neighbour problem'])
      const thinState = deriveTurnState(thin, proposeCoherentFrames(thin, 3))
      const rich = intake([
        'My neighbour parks across my driveway every day',
        'England',
        'I want them to stop blocking access',
      ])
      const richFrames = proposeCoherentFrames(rich, 3)
      const richState = deriveTurnState(rich, richFrames)
      return (
        assert(
          thinState.nextAction === 'clarify' || thinState.missing.includes('access_harm'),
          `thin should clarify, got ${thinState.nextAction} missing=${thinState.missing}`,
        ) ||
        assert(richState.covered.includes('access_harm'), `rich missing access: ${richState.covered}`) ||
        assert(richState.packId === 'neighbour-access-dispute', `rich pack ${richState.packId}`) ||
        assert(
          ['retrieve_scoped', 'stop_overview', 'clarify'].includes(richState.nextAction),
          `unexpected action ${richState.nextAction}`,
        )
      )
    },
  },
  {
    id: 'maplaw-used-car-not-neighbour-after-clarifiers',
    run: () => {
      const s = intake([
        'I bought a used car from a garage',
        'It broke down within a week',
        'I want a refund or to reject it',
        'England',
      ])
      s.matterType = 'consumer'
      const frames = proposeCoherentFrames(s, 3)
      const state = deriveTurnState(s, frames)
      const pack = buildAnswerPackage(s, frames)
      return (
        assert(state.packId === 'car-reject-failed-repair', `state pack=${state.packId}`) ||
        assert(state.covered.includes('purchase') && state.covered.includes('fault'), `covered=${state.covered}`) ||
        assert(pack.matchedTopicId === 'car-reject-failed-repair', `pack=${pack.matchedTopicId}`) ||
        assert(packConflictsWithLock(state.lock, 'neighbour-access-dispute'), 'neighbour must stay forbidden')
      )
    },
  },
  {
    id: 'lexrag-brief-goal-must-not-become-cite',
    run: () => {
      const s = intake(['Stop neighbour parking on my driveway'])
      s.goal = 'Find lawful routes to challenge neighbour blocking driveway / car port (information only)'
      const q = buildQuestionForGap(s, {
        id: 'gap_evidence',
        label: 'e',
        priority: 40,
        kind: 'closed',
        reason: 'x',
        filled: false,
      })
      return (
        assert(!/Find lawful routes/i.test(q.text), `goal leaked into Q: ${q.text}`) ||
        assert(/photo|message|evidence|driveway|car port|parking/i.test(q.text), `odd Q: ${q.text}`)
      )
    },
  },
  {
    id: 'salsa-scoped-retrieval-flag-when-locked',
    run: () => {
      const s = intake([
        'Neighbour constructing a car port that blocks my driveway',
        'England',
        'I have messages asking them to stop',
        'I want lawful options to restore access',
      ])
      const frames = proposeCoherentFrames(s, 3)
      const state = deriveTurnState(s, frames)
      return (
        assert(Boolean(state.lock), 'expected lock') ||
        assert(
          mustScopeRetrieval(state) || state.nextAction === 'clarify',
          `must scope or clarify, got ${state.nextAction}`,
        ) ||
        assert(state.packId === 'neighbour-access-dispute', `pack=${state.packId}`)
      )
    },
  },
  {
    id: 'phase2-nextprompt-neighbour-asks-evidence',
    run: () => {
      const s = intake(['Stop neighbour parking on my driveway', 'England'])
      const p = nextPrompt(s)
      return (
        assert(s.matterType === 'housing', `matter=${s.matterType}`) ||
        assert(p.id === 'gap_evidence', `expected gap_evidence, got ${p.id}: ${p.text}`) ||
        assert(/photo|message|evidence/i.test(p.text), `odd evidence Q: ${p.text}`) ||
        assert(!/tenancy|landlord|section\s*21/i.test(p.text), `landlord bleed in Q: ${p.text}`)
      )
    },
  },
  {
    id: 'phase2-nextprompt-skips-housing-notice-on-neighbour',
    run: () => {
      const s = intake([
        'My neighbour is building a car port that blocks my driveway',
        'England',
        'I have photos of the blocked access',
      ])
      // Goal still open — turn state should ask goal, never tenancy notice.
      const p = nextPrompt(s)
      return (
        assert(p.id !== 'constraint_housing_notice', `housing notice leaked: ${p.id}`) ||
        assert(
          p.id === 'gap_goal' || p.id === 'gap_evidence' || p.id === 'complete',
          `unexpected ask ${p.id}: ${p.text.slice(0, 80)}`,
        ) ||
        assert(!/section\s*21|notice to quit|tenancy/i.test(p.text), `tenancy text: ${p.text}`)
      )
    },
  },
]

function main() {
  const results: TrapResult[] = []
  for (const trap of traps) {
    try {
      const fail = trap.run()
      results.push({ id: trap.id, ok: !fail, detail: fail || 'ok' })
    } catch (err) {
      results.push({
        id: trap.id,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const failed = results.filter((r) => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.ok ? '' : ` — ${r.detail}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    process.exitCode = 1
  }
}

main()
