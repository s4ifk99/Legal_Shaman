/**
 * Coherence topic-trap regression suite.
 * Fails the process if known bleed / forgetting bugs return.
 *
 * Run: npm run test:coherence-traps
 */
import { createInitialSession, senseDetails } from '../lib/coherence/sense'
import { proposeCoherentFrames } from '../lib/coherence/frames'
import { buildAnswerPackage } from '../lib/coherence/answerPackage'
import { buildQuestionForGap, openCausationGaps } from '../lib/coherence/causation'
import { resolveTopicLock, packConflictsWithLock } from '../lib/coherence/topicLock'
import { applyTopicLockToSession } from '../lib/coherence/topicLock'
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
      // Force breach question even if gap auto-filled
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
