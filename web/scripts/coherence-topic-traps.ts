/**
 * Coherence topic-trap regression suite.
 * Fails the process if known bleed / forgetting bugs return.
 *
 * Run: npm run test:coherence-traps
 *
 * Includes LexRAG / MAP-Law inspired multi-turn traps — see
 * docs/product-decisions/coherence-turn-state.md
 */
import { createInitialSession, senseDetails, looksNeighbourDispute } from '../lib/coherence/sense'
import { proposeCoherentFrames } from '../lib/coherence/frames'
import { buildAnswerPackage, enrichAnswerPackageWithOslaw } from '../lib/coherence/answerPackage'
import { buildQuestionForGap, openCausationGaps } from '../lib/coherence/causation'
import { resolveTopicLock, packConflictsWithLock, applyTopicLockToSession } from '../lib/coherence/topicLock'
import { deriveTurnState, mustScopeRetrieval } from '../lib/coherence/turnState'
import { nextPrompt } from '../lib/coherence/questions'
import { applyPackClassification, heuristicSuggestPack, packClarifyPrompt } from '../lib/coherence/packClassifier'
import { applyMasterToSession } from '../lib/coherence/masterAgent'
import { buildConceptRetrievalPlan } from '../lib/matter/conceptRetrievalPlan'
import { buildRetrievalPlan } from '../lib/matter/retrieval-plan'
import type { MatterFrame } from '../lib/matter/types'
import type { SessionState } from '../lib/coherence/types'
import { normalizeSearchMode, searchModePolicy } from '../lib/coherence/searchMode'
import { canonicalizeResearchBundle, emptyResearchBundle, parseResearchBundle, researchBundlePrompt } from '../lib/coherence/researchBundle'
import { matchingSessionForHelp } from '../lib/coherence/services'
import { matchFreeServices } from '../lib/coherence/matchFreeServices'
import {
  buildPenumbraCacheKey,
  clearPenumbraResearchMemoryCacheForTests,
  getPenumbraResearchCache,
  normalizePenumbraCacheQuery,
  putPenumbraResearchCache,
} from '../lib/penumbra/researchCache'
import { mergeExaSearchHits, searchOfflineExaIndexForPenumbra } from '../lib/penumbra/offlineExaIndex'

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
    id: 'matching-help-prefers-employment-over-stray-criminal-label',
    run: () => {
      const s = {
        ...createInitialSession(),
        matterType: 'crime' as const,
        rawInputs: ['My employer dismissed me after I raised a grievance', 'Criminal'],
        whatHappened: 'My employer dismissed me after I raised a grievance',
        clientQuestion: 'What are my employment rights?',
      }
      const matched = matchingSessionForHelp(s)
      const contractor = matchingSessionForHelp({
        ...createInitialSession(),
        rawInputs: ['I hired a painter and scaffolder under a contract; the work is dangerous and damaged my property.'],
        whatHappened: 'The contractor caused damage and refuses to put the work right.',
      })
      return (
        assert(matched.matterType === 'employment', `matter=${matched.matterType}`) ||
        assert(matched.topicId === 'employment', `topic=${matched.topicId}`) ||
        assert(matched.taxonomySlug === 'employment', `taxonomy=${matched.taxonomySlug}`) ||
        assert(contractor.matterType === 'consumer', `contractor matter=${contractor.matterType}`) ||
        assert(contractor.taxonomySlug === 'consumer_services', `contractor taxonomy=${contractor.taxonomySlug}`)
      )
    },
  },
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
    id: 'overview-has-conversational-guidance',
    run: () => {
      const s = intake([
        'My landlord will not fix the mould in the bathroom',
        'England',
      ])
      const pack = buildAnswerPackage(s, proposeCoherentFrames(s, 3))
      return (
        assert(pack.recommendations.length >= 2, 'missing recommendations') ||
        assert(pack.options.length >= 2, 'missing options') ||
        assert(pack.followUps.length >= 3, 'missing follow-up actions') ||
        assert(pack.followUps.some((f) => f.kind === 'clarify'), 'missing clarify action') ||
        assert(pack.followUps.some((f) => f.kind === 'add_detail'), 'missing add-detail action') ||
        assert(pack.followUps.some((f) => f.kind === 'refine'), 'missing refine action')
      )
    },
  },
  {
    id: 'follow-up-history-survives-master-merge',
    run: () => {
      const original = intake(['My landlord has not fixed mould in the bathroom'])
      const withFeedback: SessionState = {
        ...original,
        feedbackHistory: [{ kind: 'clarify', text: 'Does the repair deadline matter?', at: '2026-01-01T00:00:00.000Z' }],
        answerRevisionHistory: [
          { kind: 'clarify', answerOverview: 'The prior grounded overview.', at: '2026-01-01T00:00:00.000Z' },
        ],
      }
      const merged = applyMasterToSession(
        withFeedback,
        {
          brief: { freshBrief: true, understanding: 'Housing repair issue', whatHappened: original.whatHappened },
          classify: { matterType: 'housing', topicId: 'housing-disrepair' },
        },
        'The landlord has now offered an inspection date.',
      )
      return (
        assert(merged.feedbackHistory?.length === 1, 'feedback history was dropped') ||
        assert(merged.answerRevisionHistory?.length === 1, 'answer revision history was dropped') ||
        assert(merged.rawInputs.includes('The landlord has now offered an inspection date.'), 'new feedback was not merged')
      )
    },
  },
  {
    id: 'penumbra-policy-and-bundle-guards',
    run: () => {
      const umbra = searchModePolicy('umbra')
      const penumbra = searchModePolicy('penumbra')
      const bundle = parseResearchBundle(
        JSON.stringify({
          sources: [{ id: 's1', title: 'Official source', tier: 'official', excerpt: 'A grounded excerpt.' }],
          claims: [
            { claim: 'Supported claim', sourceIds: ['s1'], confidence: 'high' },
            { claim: 'Unlinked claim', sourceIds: ['missing'], confidence: 'high' },
          ],
          matching: {
            matterType: 'employment',
            topicId: 'employment',
            confidence: 'high',
            rationale: 'Employer and workplace facts are the primary routing evidence.',
            sourceIds: ['s1'],
          },
          freeResources: [{
            id: 'web-cab',
            title: 'External free advice',
            description: 'Free guidance for employment disputes.',
            url: 'https://example.org/free-help',
            resourceType: 'charity',
            matterType: 'employment',
            topicId: 'employment',
            sourceIds: ['s1'],
          }],
          missingFacts: ['The exact date'],
        }),
        'penumbra',
      )
      const external = parseResearchBundle(
        JSON.stringify({
          sources: [
            { id: 'web-uk-guidance', title: 'External guidance', url: 'https://example.org/guidance', tier: 'trusted-guidance', excerpt: 'External excerpt.' },
            { id: 'web-insecure', title: 'Insecure source', url: 'http://example.org', tier: 'official', excerpt: 'Should be rejected.' },
          ],
          claims: [{ claim: 'External claim', sourceIds: ['web-uk-guidance'], confidence: 'low' }],
        }),
        'penumbra',
        new Set(['s1']),
      )
      const prompt = researchBundlePrompt({ mode: 'penumbra', query: 'question', context: 'curated context' })
      return (
        assert(umbra.retrievalBreadth === 'focused', 'Umbra should be focused') ||
        assert(penumbra.retrievalBreadth === 'broad', 'Penumbra should be broad') ||
        assert(penumbra.maxSecondarySources > umbra.maxSecondarySources, 'Penumbra should allow broader material') ||
        assert(normalizeSearchMode('umbra') === 'penumbra', 'legacy Umbra mode was not normalized') ||
        assert(bundle?.mode === 'penumbra', 'bundle mode was not retained') ||
        assert(bundle?.claims.length === 1, 'unlinked claim was not rejected') ||
        assert(bundle?.matching?.matterType === 'employment', 'matching lens was not retained') ||
        assert(bundle?.freeResources.length === 1 && bundle.freeResources[0].reviewStatus === 'pending_review', 'free resource candidate was not retained') ||
        assert(external?.sources.length === 1 && external.sources[0].origin === 'external' && !external.sources[0].verified, 'external provenance was not enforced') ||
        assert(prompt.indexOf('curated Legal Shaman sources') < prompt.indexOf('enabled web'), 'curated-first prompt order was lost')
      )
    },
  },
  {
    id: 'contextual-answer-suggestions-fit-story',
    run: () => {
      const s = intake(['My university is charging the rest of my tuition after withdrawing me from my course'])
      const classification = heuristicSuggestPack(s.whatHappened)
      const prompt = packClarifyPrompt({ ...s, packClassification: { ...classification, confidence: 0.4 } })
      return (
        assert(classification.packId === 'education-general', `pack=${classification.packId}`) ||
        assert(prompt.options?.some((option) => /education/i.test(option.label)), 'missing education option') ||
        assert(!prompt.options?.some((option) => /neighbour|driveway|used car/i.test(option.label)), 'unrelated options shown')
      )
    },
  },
  {
    id: 'aramb-free-resources-are-source-linked-pending-candidates',
    run: () => {
      const bundle = parseResearchBundle(
        JSON.stringify({
          sources: [{ id: 'web-cab', title: 'External advice', url: 'https://example.org', tier: 'trusted-guidance', excerpt: 'Free guidance.' }],
          freeResources: [{
            title: 'Free employment clinic',
            description: 'Initial advice for workplace disputes.',
            url: 'https://example.org/clinic',
            resourceType: 'clinic',
            matterType: 'employment',
            topicId: 'employment',
            sourceIds: ['web-cab'],
          }],
        }),
        'penumbra',
      )
      return assert(
        bundle?.freeResources.length === 1 && bundle.freeResources[0]?.reviewStatus === 'pending_review',
        'free resource was not retained as a pending source-linked candidate',
      )
    },
  },
  {
    id: 'interactive-penumbra-child-session-isolated',
    run: () => {
      const s = intake(['My university is charging the rest of my tuition after withdrawing me from my course'])
      const parsed = parseResearchBundle(
        JSON.stringify({
          status: 'needs_input',
          questions: ['What did the withdrawal email say?'],
          sources: [
            { id: 'wiki-course-fees', title: 'Fake title', url: 'https://untrusted.example', tier: 'secondary', excerpt: 'Candidate text.' },
            { id: 'unknown', title: 'Invented source', url: 'https://bad.example', tier: 'official', excerpt: 'Should be dropped.' },
          ],
          claims: [{ claim: 'Candidate claim', sourceIds: ['wiki-course-fees'], confidence: 'medium' }],
        }),
        'penumbra',
        new Set(['wiki-course-fees']),
      )
      const canonical = parsed
        ? canonicalizeResearchBundle(parsed, [{
            id: 'wiki-course-fees',
            title: 'Canonical Legal Shaman page',
            url: '',
            tier: 'wiki',
            excerpt: 'Canonical excerpt.',
            origin: 'curated',
            verified: true,
          }])
        : null
      const child = {
        status: 'awaiting_input' as const,
        caseKey: 'case-test-123456789',
        conversationId: 'conv-test',
        questions: canonical?.questions || [],
        bundle: canonical || undefined,
        updatedAt: new Date().toISOString(),
      }
      const withChild = { ...s, penumbraResearch: child }
      return (
        assert(withChild.searchMode === 'penumbra', 'legacy parent research mode was not normalized') ||
        assert(withChild.penumbraResearch?.conversationId === 'conv-test', 'conversation ID was not retained') ||
        assert(withChild.penumbraResearch?.status === 'awaiting_input', 'needs_input status was not retained') ||
        assert(withChild.penumbraResearch?.bundle?.sources[0]?.title === 'Canonical Legal Shaman page', 'source was not canonicalized') ||
        assert(withChild.penumbraResearch?.bundle?.sources[0]?.url === '', 'untrusted source URL survived mapping') ||
        assert(withChild.penumbraResearch?.bundle?.claims[0]?.sourceIds[0] === 'wiki-course-fees', 'claim link was lost')
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
  {
    id: 'imm-need-family-visa-not-refusal-track',
    run: () => {
      const s = intake(['I need a family visa'])
      const frames = proposeCoherentFrames(s, 3)
      const gaps = openCausationGaps(s)
      const asks: string[] = []
      let cur = s
      for (let i = 0; i < 6; i++) {
        const p = nextPrompt(cur)
        asks.push(p.id)
        if (p.id === 'complete') break
        cur = {
          ...cur,
          answeredPromptIds: [...cur.answeredPromptIds, p.id],
          rawInputs: [...cur.rawInputs, p.id === 'constraint_jurisdiction' || p.id === 'gap_where' ? 'England' : 'My spouse lives in the UK'],
        }
        cur = senseDetails(cur.rawInputs[cur.rawInputs.length - 1]!, cur)
        cur = applyTopicLockToSession(cur, proposeCoherentFrames(cur, 3))
      }
      return (
        assert(s.matterType === 'immigration', `matter=${s.matterType}`) ||
        assert(frames.some((f) => f.id === 'imm-family'), `frames=${frames.map((f) => f.id)}`) ||
        assert(!frames.some((f) => f.id === 'imm-challenge'), `challenge frame on apply-first: ${frames.map((f) => f.id)}`) ||
        assert(!gaps.some((g) => g.id === 'gap_refusal_reason'), `refusal gap still open: ${gaps.map((g) => g.id)}`) ||
        assert(!asks.includes('gap_refusal_reason'), `asked refusal: ${asks}`) ||
        assert(!asks.includes('constraint_decision_letter'), `asked decision letter: ${asks}`) ||
        assert(
          asks.every((id) => !/refusal|decision letter/i.test(id)),
          `refusal-ish ask ids: ${asks}`,
        )
      )
    },
  },
  {
    id: 'imm-refused-visa-still-asks-refusal-reason',
    run: () => {
      const s = intake(['My spouse visa was refused by the Home Office last month'])
      const gaps = openCausationGaps(s)
      const frames = proposeCoherentFrames(s, 3)
      return (
        assert(frames.some((f) => f.id === 'imm-challenge'), `expected challenge, got ${frames.map((f) => f.id)}`) ||
        assert(
          gaps.some((g) => g.id === 'gap_refusal_reason'),
          `refusal gap should stay open: ${gaps.map((g) => g.id)}`,
        )
      )
    },
  },
  {
    id: 'wash-car-driveway-not-neighbour-access',
    run: () => {
      const s = intake(['can i wash my car on my driveway'])
      const frames = proposeCoherentFrames(s, 3)
      const lock = resolveTopicLock(s, frames)
      const p = nextPrompt(s)
      const blob = `${p.id} ${p.text}`
      return (
        assert(!looksNeighbourDispute('can i wash my car on my driveway'), 'detector should be false') ||
        assert(!frames.some((f) => f.id === 'hous-neighbour'), `neighbour frame: ${frames.map((f) => f.id)}`) ||
        assert(lock?.packId !== 'neighbour-access-dispute', `lock=${lock?.packId}`) ||
        assert(s.topicId !== 'housing-access', `topicId=${s.topicId}`) ||
        assert(!/neighbour blocking|neighbour-access/i.test(blob), `bleed ask: ${blob.slice(0, 120)}`)
      )
    },
  },
  {
    id: 'pack-classifier-wash-car-own-property',
    run: () => {
      const h = heuristicSuggestPack('can i wash my car on my driveway')
      let s = intake(['can i wash my car on my driveway'])
      s = applyPackClassification(s, h)
      const frames = proposeCoherentFrames(s, 3)
      const lock = resolveTopicLock(s, frames)
      const p = nextPrompt(s)
      return (
        assert(h.packId === 'own-property-use', `heuristic pack=${h.packId}`) ||
        assert(s.topicId === 'own-property-use', `topicId=${s.topicId}`) ||
        assert(s.mode === 'info', `mode=${s.mode}`) ||
        assert(lock === null, `unexpected lock ${lock?.packId}`) ||
        assert(!frames.some((f) => f.id === 'hous-neighbour'), `frames=${frames.map((f) => f.id)}`) ||
        assert(p.id !== 'gap_evidence' || !/neighbour blocking/i.test(p.text), `ask=${p.id} ${p.text.slice(0, 80)}`)
      )
    },
  },
  {
    id: 'pack-classifier-neighbour-still-locks',
    run: () => {
      const h = heuristicSuggestPack('My neighbour keeps parking on my driveway')
      let s = intake(['My neighbour keeps parking on my driveway'])
      s = applyPackClassification(s, h)
      const lock = resolveTopicLock(s, proposeCoherentFrames(s, 3))
      return (
        assert(h.packId === 'neighbour-access-dispute', `pack=${h.packId}`) ||
        assert(lock?.packId === 'neighbour-access-dispute', `lock=${lock?.packId}`)
      )
    },
  },
  {
    id: 'neighbour-parking-driveway-still-neighbour',
    run: () => {
      const s = intake(['My neighbour keeps parking on my driveway'])
      const frames = proposeCoherentFrames(s, 3)
      const lock = resolveTopicLock(s, frames)
      return (
        assert(looksNeighbourDispute('My neighbour keeps parking on my driveway'), 'detector should be true') ||
        assert(frames.some((f) => f.id === 'hous-neighbour'), `frames=${frames.map((f) => f.id)}`) ||
        assert(lock?.packId === 'neighbour-access-dispute', `lock=${lock?.packId}`)
      )
    },
  },
  {
    id: 'bradford-disability-absence-not-dismissal',
    run: () => {
      const story = [
        'I work in retail and have several long-term, fluctuating health conditions including chronic migraine and epilepsy, which can cause occasional short periods of sickness absence.',
        'My employer uses the Bradford Factor, so separate short absences can make my score increase very quickly. I already have reasonable adjustments at work, but disability-related sickness is still counted normally within my Bradford score.',
        'I understand that completely disregarding disability-related absence isn’t the only option. I’ve seen examples of higher trigger points, percentage reductions, some absences being disregarded, disability absence being recorded separately, etc.',
        'I’m mainly looking for real-life UK examples — what adjustments does your employer make to sickness absence procedures for disabled employees?',
      ].join('\n\n')
      const s = intake([story, 'England'])
      const frames = proposeCoherentFrames(s, 4)
      return (
        assert(s.matterType !== 'consumer', `matter=${s.matterType} (workplace disability must not be consumer access)`) ||
        assert(s.matterType === 'employment', `matter=${s.matterType}`) ||
        assert(frames.some((f) => f.id === 'emp-disability-ra'), `expected emp-disability-ra, got ${frames.map((f) => f.id).join(',')}`) ||
        assert(!frames.some((f) => f.id === 'emp-unfair'), 'unfair dismissal frame on Bradford/RA story') ||
        assert(!frames.some((f) => f.id === 'emp-tribunal'), 'tribunal frame auto-added without dismissal language')
      )
    },
  },
  {
    id: 'concept-plan-bradford-not-dismissal-intents',
    run: () => {
      const story =
        'I work in retail with epilepsy. Employer Bradford Factor counts disability-related sickness. Looking for reasonable adjustments to absence procedures.'
      const frame: MatterFrame = {
        matterId: 'trap',
        primaryIssues: [{ slug: 'employment', confidence: 0.9, reason: 'trap' }],
        secondaryIssues: [],
        parties: [],
        capacities: [],
        relationships: [],
        events: [],
        objectives: [],
        concepts: [],
        exclusions: [],
        ambiguities: [],
        overallConfidence: 0.9,
        resolutionStatus: 'resolved',
        provenance: {},
        retrievalScope: ['employment'],
      }
      const plan = buildConceptRetrievalPlan(frame, story)
      const { intents } = buildRetrievalPlan(frame, story)
      const joined = intents.join(' | ')
      return (
        assert(
          plan.clusterIds.includes('disability_absence_adjustments'),
          `clusters=${plan.clusterIds.join(',')}`,
        ) ||
        assert(/reasonable adjustment|bradford|disability/i.test(joined), `intents=${joined}`) ||
        assert(!/unfair dismissal employment tribunal/i.test(joined), `dismissal intent leaked: ${joined}`)
      )
    },
  },
  {
    id: 'concept-clusters-cover-known-packs',
    run: () => {
      const cases: Array<{ story: string; cluster: string; mustNot?: string }> = [
        {
          story: 'Neighbour blocked my driveway with a car port',
          cluster: 'neighbour_access',
          mustNot: 'used_car_reject',
        },
        {
          story: 'Can I wash my car on my own driveway?',
          cluster: 'own_property_use',
          mustNot: 'neighbour_access',
        },
        {
          story: 'Bought a used car from a dealer that keeps breaking — want to reject under CRA',
          cluster: 'used_car_reject',
        },
        {
          story: 'Got a private parking charge PCN and want to appeal to POPLA',
          cluster: 'private_parking_pcn',
        },
        {
          story: 'My landlord will not fix the mould and damp in my flat',
          cluster: 'landlord_disrepair',
        },
        {
          story: 'Landlord served a section 21 notice to evict me',
          cluster: 'landlord_eviction_section21',
        },
        {
          story: 'I want to apply for a spouse visa for my partner — not refused yet',
          cluster: 'family_visa_apply',
          mustNot: 'visa_refusal_challenge',
        },
        {
          story: 'Home Office refused my visa and I want to appeal the refusal',
          cluster: 'visa_refusal_challenge',
        },
        {
          story: 'My ex threw out my belongings and broke my Switch — can I claim for replacement?',
          cluster: 'family_belongings_claim',
          mustNot: 'family_children_arrangements',
        },
        {
          story: 'Garage did a poor repair on my van and charged me — workmanship is awful',
          cluster: 'garage_vehicle_repair',
        },
        {
          story: 'I was sacked by my employer last week and think it is unfair dismissal',
          cluster: 'employment_unfair_dismissal',
          mustNot: 'disability_absence_adjustments',
        },
        {
          story: 'Bailiffs visited about a CCJ debt — what can they take?',
          cluster: 'debt_bailiff_enforcement',
        },
        {
          story: 'I am homeless and need temporary accommodation from the council',
          cluster: 'housing_homelessness',
        },
        {
          story:
            'r/askuk says DIY adjust the fire door latches in my apartment — shared property rules, would I get kicked out and go homeless?',
          cluster: 'leasehold_fire_safety_alterations',
          mustNot: 'housing_homelessness',
        },
        {
          story:
            'Mum on PIP and Universal Credit wants to help pay my direct debits — could that be deprivation of capital and affect UC eligibility?',
          cluster: 'benefits_pip_uc_appeal',
          mustNot: 'equality_goods_services',
        },
        {
          story:
            'Sexual harassment phone calls — No caller ID man masturbating; she is scared and wants to report it',
          cluster: 'communications_harassment_victim',
          mustNot: 'equality_goods_services',
        },
        {
          story: 'I need to make a will and lasting power of attorney',
          cluster: 'wills_making',
        },
        {
          story: 'I need a clean break financial order after our divorce',
          cluster: 'family_agreements',
        },
        {
          story: 'I need to draft a commercial contract for my retail business',
          cluster: 'commercial_business_contracts',
        },
        {
          story: 'Where can I get a statutory declaration certified and witnessed?',
          cluster: 'legal_documents_certification',
        },
        {
          story: "How does inheritance tax affect my late father's bank account?",
          cluster: 'tax_estate_banking',
        },
        {
          story: 'Home Office refused my asylum claim',
          cluster: 'asylum_refugees',
        },
        {
          story: 'Package holiday cancelled — want ATOL refund and flight delay compensation',
          cluster: 'consumer_travel_holidays',
        },
        {
          story: 'School permanently excluded my child and we need an EHCP appeal',
          cluster: 'education_exclusion_ehcp',
        },
        {
          story: 'I was arrested and taken to the police station — need duty solicitor rights',
          cluster: 'police_station_arrest',
        },
        {
          story: 'Gym refused me entry because of my disability — Equality Act goods and services',
          cluster: 'equality_goods_services',
          mustNot: 'workplace_harassment_bullying',
        },
        {
          story: 'PIP refused after assessment — mandatory reconsideration and tribunal appeal',
          cluster: 'benefits_pip_uc_appeal',
        },
        {
          story: 'Clinical negligence after surgery at NHS hospital — AvMA help',
          cluster: 'clinical_negligence',
        },
      ]
      const emptyFrame: MatterFrame = {
        matterId: 'trap',
        primaryIssues: [{ slug: 'unknown', confidence: 0.5, reason: 'trap' }],
        secondaryIssues: [],
        parties: [],
        capacities: [],
        relationships: [],
        events: [],
        objectives: [],
        concepts: [],
        exclusions: [],
        ambiguities: [],
        overallConfidence: 0.5,
        resolutionStatus: 'partially_resolved',
        provenance: {},
        retrievalScope: [],
      }
      for (const c of cases) {
        const plan = buildConceptRetrievalPlan(emptyFrame, c.story)
        if (!plan.clusterIds.includes(c.cluster)) {
          return assert(false, `${c.cluster} missing for “${c.story.slice(0, 48)}…” got ${plan.clusterIds.join(',')}`)
        }
        if (c.mustNot && plan.clusterIds.includes(c.mustNot)) {
          return assert(false, `${c.mustNot} wrongly matched for “${c.story.slice(0, 48)}…”`)
        }
      }
      return null
    },
  },
  {
    id: 'area-intent-defaults-cover-wiki-areas',
    run: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { listWikiAreas, SLUG_INTENT_DEFAULTS } = require('../lib/matter/areaIntentDefaults') as {
        listWikiAreas: () => string[]
        SLUG_INTENT_DEFAULTS: Record<string, string[]>
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { intentsForIssueSlug } = require('../lib/matter/scopes') as {
        intentsForIssueSlug: (slug: string) => string[]
      }
      const areas = listWikiAreas()
      if (areas.length < 14) return assert(false, `expected ≥14 wiki areas, got ${areas.length}`)
      for (const slug of [
        'wills_probate',
        'welfare_benefits',
        'personal_injury',
        'education',
        'commercial',
        'criminal_defence',
      ]) {
        if (!intentsForIssueSlug(slug).length) return assert(false, `no default intents for ${slug}`)
      }
      if (!SLUG_INTENT_DEFAULTS.wills_probate?.length) {
        return assert(false, 'wills_probate missing from area defaults')
      }
      return null
    },
  },
  {
    id: 'agent-concepts-merge-into-retrieval-plan',
    run: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolveMatterFrame } = require('../lib/matter/resolve') as {
        resolveMatterFrame: (input: {
          submission: string
          agentConcepts?: string[]
        }) => { frame: MatterFrame }
      }
      const result = resolveMatterFrame({
        submission:
          'Unusual dispute about a timeshare cancellation cooling-off period after a sales presentation',
        agentConcepts: ['timeshare cancellation', 'cooling off period', 'consumer holiday club'],
      })
      if (!result.frame.concepts.some((c) => /timeshare|cooling/i.test(c))) {
        return assert(false, `concepts missing agent terms: ${result.frame.concepts.join(',')}`)
      }
      const plan = buildConceptRetrievalPlan(result.frame, result.frame.concepts.join(' '))
      const joined = plan.intents.join(' | ')
      return assert(
        /timeshare|cooling/i.test(joined),
        `agent concepts did not become intents: ${joined}`,
      )
    },
  },
  {
    id: 'mot-no-insurance-not-car-reject-pack',
    run: () => {
      const q =
        'Drove past police with No insurance, MOT or tax on car in England — what happens next?'
      const s = intake([q])
      const frames = proposeCoherentFrames(s, 3)
      const pack = buildAnswerPackage(s, frames)
      return assert(
        pack.matchedTopicId !== 'car-reject-failed-repair',
        `wrong pack ${pack.matchedTopicId}`,
      )
    },
  },
  {
    id: 'lease-garage-dispute-not-car-reject-pack',
    run: () => {
      const q =
        'Looking for solicitor for property dispute involving long lease garages in England on my freehold driveway'
      const s = intake([q])
      const frames = proposeCoherentFrames(s, 3)
      const pack = buildAnswerPackage(s, frames)
      return assert(
        pack.matchedTopicId !== 'car-reject-failed-repair',
        `wrong pack ${pack.matchedTopicId}`,
      )
    },
  },
  {
    id: 'fallback-recommendation-has-bullets-from-ca',
    run: () => {
      const q = 'Voluntary police interview under caution but I am on holiday abroad — England'
      const s = intake([q])
      const frames = proposeCoherentFrames(s, 3)
      const pack = buildAnswerPackage(s, frames)
      const enriched = enrichAnswerPackageWithOslaw(pack, null, s)
      return assert(
        enriched.bullets.length >= 1 && enriched.citation.ok,
        `bullets=${enriched.bullets.length} cite=${enriched.citation.ok}`,
      )
    },
  },
  {
    id: 'reddit-miss-fire-door-not-homelessness',
    run: () => {
      const q =
        "(England) r/askuk is advising me to DIY adjust the fire door latches in my apartment so they slam more slowly. I keep saying i'm pretty sure this would be against the rules of my shared property and would count as tampering with fire doors, am I correct?. Everyone in that thread is telling me to do it, and I'm telling them that if i did I would end up at risk of going literally homeless after I get kicked out."
      const s = intake([q])
      const frames = proposeCoherentFrames(s, 4)
      const ids = frames.map((f) => f.id)
      const plan = buildConceptRetrievalPlan(
        {
          matterId: 'trap',
          primaryIssues: [{ slug: 'housing', confidence: 0.8, reason: 'trap' }],
          secondaryIssues: [],
          parties: [],
          capacities: [],
          relationships: [],
          events: [],
          objectives: [],
          concepts: [],
          exclusions: [],
          ambiguities: [],
          overallConfidence: 0.8,
          resolutionStatus: 'partially_resolved',
          provenance: {},
          retrievalScope: [],
        },
        q,
      )
      return (
        assert(ids.includes('hous-lease-fire'), `frames=${ids.join(',')}`) ||
        assert(!ids.includes('hous-homeless'), `homeless frame leaked: ${ids.join(',')}`) ||
        assert(
          plan.clusterIds.includes('leasehold_fire_safety_alterations'),
          `clusters=${plan.clusterIds.join(',')}`,
        ) ||
        assert(
          !plan.clusterIds.includes('housing_homelessness'),
          `homelessness cluster leaked: ${plan.clusterIds.join(',')}`,
        )
      )
    },
  },
  {
    id: 'reddit-miss-mum-pip-benefits-not-consumer-access',
    run: () => {
      const q =
        "Can my mum help me with some of my direct debits in England?. My mum and dad are on universal credit due to my mum’s disability. She also receives PIP. She has full mental capacity. She said that she could help me pay some of my direct debits. Could this affect their Universal Credit eligibility? Can this legally be seen as deprivation of capital?"
      const s = intake([q])
      const frames = proposeCoherentFrames(s, 4)
      const ids = frames.map((f) => f.id)
      return (
        assert(s.matterType === 'debt', `matter=${s.matterType}`) ||
        assert(ids.includes('debt-benefits'), `frames=${ids.join(',')}`) ||
        assert(!ids.includes('cons-access'), `cons-access leaked: ${ids.join(',')}`)
      )
    },
  },
  {
    id: 'reddit-miss-harassing-calls-victim-not-equality-goods',
    run: () => {
      const q =
        "(Wales) Sexual Harassment? phone calls. I'm posting this for a friend - about a month ago she started receiving calls (on No caller ID) where it sounded like a man was on the other end of the phone just masturbating. Today he spoke to her and mentioned her mum is black so he knows her. She is scared."
      const s = intake([q])
      const frames = proposeCoherentFrames(s, 4)
      const ids = frames.map((f) => f.id)
      const plan = buildConceptRetrievalPlan(
        {
          matterId: 'trap',
          primaryIssues: [{ slug: 'criminal_defence', confidence: 0.8, reason: 'trap' }],
          secondaryIssues: [],
          parties: [],
          capacities: [],
          relationships: [],
          events: [],
          objectives: [],
          concepts: ['discrimination', 'protected characteristic', 'goods and services'],
          exclusions: [],
          ambiguities: [],
          overallConfidence: 0.8,
          resolutionStatus: 'partially_resolved',
          provenance: {},
          retrievalScope: [],
        },
        q,
      )
      return (
        assert(s.matterType === 'crime', `matter=${s.matterType}`) ||
        assert(ids.includes('crime-victim-harassment'), `frames=${ids.join(',')}`) ||
        assert(
          plan.clusterIds.includes('communications_harassment_victim'),
          `clusters=${plan.clusterIds.join(',')}`,
        ) ||
        assert(
          !plan.clusterIds.includes('equality_goods_services'),
          `equality goods leaked: ${plan.clusterIds.join(',')}`,
        )
      )
    },
  },
  {
    id: 'tenancy-assignment-not-commercial-contract',
    run: () => {
      const story = `I am due to move into a new rental flat in England. The letting agent provided a deed of assignment to sign. The replacement tenant and outgoing tenant have settled deterioration since the inventory. The inventory is five years old and I worry about deposit liability for pre-existing damage.`
      const s = intake([story, 'Are there established rules for this?'])
      const frames = proposeCoherentFrames(s, 3)
      const pack = buildAnswerPackage(s, frames)
      return (
        assert(s.matterType === 'housing', `matter=${s.matterType}`) ||
        assert(pack.matchedTopicId !== 'commercial-business-contracts', `pack=${pack.matchedTopicId}`) ||
        assert(!/business contract recommendation/i.test(pack.answerOverview), 'commercial overview leaked') ||
        assert(/housing|tenancy|deposit|inventory|assignment/i.test(pack.answerOverview), `overview=${pack.answerOverview.slice(0, 80)}`)
      )
    },
  },
  {
    id: 'research-bundle-wins-over-curated-regex',
    run: () => {
      const story =
        'Letting agent deed of assignment for rental flat — worried about five year old inventory and deposit.'
      const s = intake([story])
      const frames = proposeCoherentFrames(s, 3)
      const parsed = parseResearchBundle(
        JSON.stringify({
          status: 'complete',
          sources: [
            {
              id: 'web-cab-deposit',
              title: 'Check your deposit is protected',
              url: 'https://www.citizensadvice.org.uk/housing/deposits/check-your-landlord-has-protected-your-deposit/',
              tier: 'trusted-guidance',
              excerpt: 'Your deposit must be protected in a government scheme within 30 days.',
            },
          ],
          claims: [
            {
              claim: 'On assignment, check deposit scheme records and request an updated inventory before paying your share.',
              sourceIds: ['web-cab-deposit'],
              confidence: 'medium',
            },
          ],
          nextActions: ['Request a new check-in inventory with photos before signing the deed.'],
          missingFacts: ['Move-in date and deposit amount.'],
          answerDraft:
            'Before signing a deed of assignment, confirm deposit protection, the check-in record, and whether you accept liability only from your move-in date.',
        }),
        'penumbra',
      )
      const bundle = parsed || emptyResearchBundle('penumbra')
      const pack = buildAnswerPackage(s, frames, { researchBundle: bundle })
      return (
        assert(pack.matchedTopicId === 'research-led', `pack=${pack.matchedTopicId}`) ||
        assert(/deposit|inventory|assignment/i.test(pack.answerOverview), 'research overview missing housing terms') ||
        assert(pack.bullets.some((b) => /deposit|inventory/i.test(b.text)), 'missing research bullets')
      )
    },
  },
  {
    id: 'housing-free-help-pins-shelter',
    run: () => {
      const story =
        'I am moving into a rental flat in England. The letting agent sent a deed of assignment. The inventory is five years old and I worry about deposit liability for wear and tear.'
      const s = intake([story])
      const helpSession = matchingSessionForHelp(s)
      const free = matchFreeServices(helpSession, 6)
      return (
        assert(
          helpSession.matterType === 'housing' || /\b(deposit|tenant|landlord|rental)\b/i.test(story),
          `matter=${helpSession.matterType}`,
        ) ||
        assert(
          free.some((f) => /shelter housing advice/i.test(f.title)),
          `missing Shelter: ${free.map((f) => f.title).join(' | ')}`,
        ) ||
        assert(
          free[0] && /shelter housing advice/i.test(free[0].title),
          `Shelter not first: ${free.map((f) => f.title).join(' | ')}`,
        ) ||
        assert(
          !free.some((f) => /contact us - shelter england/i.test(f.title)),
          'weak Shelter Exa duplicate still present',
        )
      )
    },
  },
  {
    id: 'penumbra-cache-key-stable-and-memory-roundtrip',
    run: () => {
      clearPenumbraResearchMemoryCacheForTests()
      const q = '  Deed of ASSIGNMENT — deposit and inventory in England  '
      const norm = normalizePenumbraCacheQuery(q)
      const k1 = buildPenumbraCacheKey(q, 'housing')
      const k2 = buildPenumbraCacheKey(q, 'housing')
      const k3 = buildPenumbraCacheKey(q, 'employment')
      if (k1 !== k2) return 'cache key not stable'
      if (k1 === k3) return 'matter slug should change cache key'
      if (!norm.includes('deed of assignment')) return `norm=${norm}`
      return null
    },
  },
  {
    id: 'penumbra-cache-memory-hit',
    run: () => {
      clearPenumbraResearchMemoryCacheForTests()
      const key = buildPenumbraCacheKey('tenant deposit wear and tear', 'housing')
      const bundle = emptyResearchBundle('penumbra')
      bundle.status = 'complete'
      bundle.sources = [
        {
          id: 'web-test',
          title: 'Test',
          url: 'https://www.citizensadvice.org.uk/housing/deposits/',
          tier: 'trusted-guidance',
          excerpt: 'Deposit protection guidance.',
          origin: 'external',
          verified: false,
        },
      ]
      bundle.claims = [
        { claim: 'Check deposit scheme records before signing.', sourceIds: ['web-test'], confidence: 'medium' },
      ]
      return (async () => {
        await putPenumbraResearchCache({ cacheKey: key, query: 'tenant deposit', matterSlug: 'housing', bundle })
        const hit = await getPenumbraResearchCache(key)
        return (
          assert(Boolean(hit), 'cache miss') ||
          assert(hit!.bundle.sources.length === 1, 'bundle not stored') ||
          assert(hit!.bundle.claims.length === 1, 'claims not stored')
        )
      })()
    },
  },
  {
    id: 'penumbra-offline-exa-housing-deposit',
    run: () => {
      const result = searchOfflineExaIndexForPenumbra(
        'deed of assignment rental flat deposit inventory wear and tear England landlord tenant',
        { matterSlug: 'housing', limit: 6 },
      )
      return (
        assert(result.hits.length >= 4, `hits=${result.hits.length}`) ||
        assert(
          result.hits.some((h) => /deposit|tenancy|landlord/i.test(`${h.title} ${h.url}`)),
          'no housing deposit sources',
        ) ||
        assert(result.matterTopicKey === 'area-housing-landlord-tenant', `topic=${result.matterTopicKey}`) ||
        assert(result.hits.every((h) => h.id.startsWith('web-')), 'offline hits need web- ids') ||
        assert(Array.isArray(result.matchedTopicKeys), 'missing matchedTopicKeys')
      )
    },
  },
  {
    id: 'penumbra-offline-exa-merge-dedupes-urls',
    run: () => {
      const hit = {
        id: 'web-example',
        url: 'https://www.gov.uk/tenancy-deposit-protection',
        title: 'Deposit protection',
        excerpt: 'Official deposit scheme guidance.',
      }
      const merged = mergeExaSearchHits([hit], [hit], 4)
      return assert(merged.length === 1, `expected 1 merged hit, got ${merged.length}`)
    },
  },
]

async function main() {
  const results: TrapResult[] = []
  for (const trap of traps) {
    try {
      const fail = await Promise.resolve(trap.run())
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

void main()
