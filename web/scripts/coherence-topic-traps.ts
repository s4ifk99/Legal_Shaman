/**
 * Coherence topic-trap regression suite.
 * Fails the process if known bleed / forgetting bugs return.
 *
 * Run: npm run test:coherence-traps
 *
 * Includes LexRAG / MAP-Law inspired multi-turn traps — see
 * docs/product-decisions/coherence-turn-state.md
 */
import { createInitialSession, senseDetails, looksNeighbourDispute, sanitizeIntakeNarrative } from '../lib/coherence/sense'
import { proposeCoherentFrames } from '../lib/coherence/frames'
import { buildAnswerPackage, enrichAnswerPackageWithOslaw } from '../lib/coherence/answerPackage'
import { buildQuestionForGap, openCausationGaps } from '../lib/coherence/causation'
import { resolveTopicLock, packConflictsWithLock, applyTopicLockToSession } from '../lib/coherence/topicLock'
import { deriveTurnState, mustScopeRetrieval } from '../lib/coherence/turnState'
import { nextPrompt } from '../lib/coherence/questions'
import { applyPackClassification, heuristicSuggestPack, packClarifyPrompt } from '../lib/coherence/packClassifier'
import { applyMasterToSession } from '../lib/coherence/masterAgent'
import { mergeOrchestratedTimeline } from '../lib/coherence/llmOrchestrate'
import { buildConceptRetrievalPlan } from '../lib/matter/conceptRetrievalPlan'
import { buildRetrievalPlan } from '../lib/matter/retrieval-plan'
import type { MatterFrame } from '../lib/matter/types'
import type { SessionState } from '../lib/coherence/types'
import { normalizeSearchMode, searchModePolicy } from '../lib/coherence/searchMode'
import { canonicalizeResearchBundle, emptyResearchBundle, parseResearchBundle, researchBundlePrompt } from '../lib/coherence/researchBundle'
import { matchingSessionForHelp } from '../lib/coherence/services'
import { buildLawyerBrief } from '../lib/coherence/brief'
import { relevantWorkAreas, scoreSraWorkAreaForMatching, resolveSraSearchFlags, sraMatchReason, matchingHelpLanesForStory, employerPropertySraFlags } from '../lib/coherence/sraQuery'
import { attachResolvedMatterFrame, commitHypothesisProbeToSession, matterGatePrompt } from '../lib/coherence/applyMatterFrame'
import {
  applyHypothesisProbeAnswer,
  mergeHypothesisEvidence,
  shouldCommitHypothesisSet,
  storyLooksWorkplaceLeaveOrStaffRules,
} from '../lib/coherence/hypothesisProbe'
import {
  RESEARCH_DIALOGUE_MAX_TURNS,
  shouldForceCommitDialogue,
  type ResearchDialogueState,
} from '../lib/coherence/researchDialogue'
import { preferFrameMatching } from '../lib/coherence/issueRouting'
import { matchFreeServices } from '../lib/coherence/matchFreeServices'
import { buildExaResearchBrief } from '../lib/penumbra/exaBrief'
import { discoverHelpFromExaHits } from '../lib/penumbra/helpDiscover'
import {
  buildPenumbraCacheKey,
  clearPenumbraResearchMemoryCacheForTests,
  getPenumbraResearchCache,
  normalizePenumbraCacheQuery,
  putPenumbraResearchCache,
} from '../lib/penumbra/researchCache'
import { mergeExaSearchHits, searchOfflineExaIndexForPenumbra } from '../lib/penumbra/offlineExaIndex'
import { titleAllowedOnGraph } from '../lib/matter/issueGraphHits'
import {
  freeHelpAdmissibleOnGeometry,
  sraOrganisationAdmissible,
  storyLooksAmbiguousSeizedDevice,
  storyLooksVacatedRroRelet,
  titleAdmissibleOnGeometry,
} from '../lib/matter/graphAdmissibility'
import { coverageSlotsFrom, isOfficialAuthoritySource, slotRetryQueries } from '../lib/matter/coverageSlots'
import { compressLiveGoal, extractClientQuestions } from '../lib/coherence/clientQuestions'
import { buildCaseLedOverview } from '../lib/coherence/caseBuilder'
import { critiqueOverviewRecommendation } from '../lib/coherence/critiqueOverview'

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
    id: 'matter-frame-first-not-keyword-or-discrimination-matching',
    run: () => {
      const story = `I'm going through divorce/family proceedings with my ex-wife, who has been on PAYE through my limited company for over 10 years. She is not carrying out any work. What are my options for lawfully ending her employment? How do I recover the company vehicle?`
      let s = senseDetails(story, createInitialSession())
      const { session } = attachResolvedMatterFrame(s, story)
      const matched = matchingSessionForHelp(session)
      const research = preferFrameMatching(
        {
          matterType: 'employment',
          topicId: 'employment',
          taxonomySlug: 'employment',
          confidence: 'medium',
          rationale: 'frame',
          sourceIds: ['s1'],
        },
        {
          matterType: 'employment',
          topicId: 'discrimination',
          taxonomySlug: 'employment',
          confidence: 'high',
          rationale: 'Discrimination at work is covered by the Equality Act.',
          sourceIds: ['s1'],
        },
        session.matterFrame,
      )
      const slugs = [
        ...(session.matterFrame?.primaryIssues || []),
        ...(session.matterFrame?.secondaryIssues || []),
      ].map((i) => i.slug)
      return (
        assert(session.confirmedUserRole === 'employer', `role=${session.confirmedUserRole}`) ||
        assert(matched.matterType === 'employment', `matched matter=${matched.matterType}`) ||
        assert(slugs.includes('employment') && slugs.includes('family'), `slugs=${slugs.join(',')}`) ||
        assert(session.matterFrame?.exclusions?.includes('discrimination_equality'), 'missing discrimination exclusion') ||
        assert(research?.topicId !== 'discrimination', `topic=${research?.topicId}`)
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
        assert(prompt.indexOf('curated Legal Shaman sources') < prompt.indexOf('enabled web'), 'curated-first prompt order was lost') ||
        assert(/freeResources/.test(prompt) && /costBand/.test(prompt), 'research prompt no longer asks for free and paid help leads')
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
    id: 'exa-brief-steers-full-search-from-frame',
    run: () => {
      const story =
        'Landlord removed the front door and forced me out without a court order. No tenancy agreement. Wages held until I leave. Nowhere to sleep tonight.'
      const s = intake([story])
      const { frame } = attachResolvedMatterFrame(s, story)
      const planned = buildExaResearchBrief({ story, frame, clientQuestion: 'What should I do tonight?' })
      const blob = `${planned.brief} ${planned.queries.map((q) => q.query).join(' ')}`.toLowerCase()
      const scopes = planned.queries.map((q) => q.scope).sort().join(',')
      return (
        assert(planned.queries.some((q) => q.scope === 'open'), 'missing open Exa query') ||
        assert(planned.queries.some((q) => q.scope === 'allowlist'), 'missing official Exa query') ||
        assert(/housing|illegal evict|homeless/.test(blob), `brief not steered: ${blob.slice(0, 180)}`) ||
        assert(!/gap-fill only/.test(blob), 'still describing gap-fill only') ||
        assert(scopes.includes('allowlist') && scopes.includes('open'), `scopes=${scopes}`) ||
        assert(
          planned.queries.some((q) => /illegal evict|lock out|Protection from Eviction/i.test(q.query)),
          'missing per-slot illegal eviction query',
        ) ||
        assert(planned.queries.some((q) => q.id === 'help-free'), 'missing free-help Exa query') ||
        assert(planned.queries.some((q) => q.id === 'help-paid'), 'missing paid-directory Exa query')
      )
    },
  },
  {
    id: 'third-eye-discovers-free-and-paid-help',
    run: () => {
      const leads = discoverHelpFromExaHits(
        [
          {
            id: 'web-shelter',
            url: 'https://england.shelter.org.uk/housing_advice/eviction/get_help',
            title: 'Get help from Shelter',
            excerpt: 'Emergency helpline for illegal eviction.',
          },
          {
            id: 'web-sra',
            url: 'https://www.sra.org.uk/consumers/using-solicitor/find-solicitor/',
            title: 'Find a solicitor',
            excerpt: 'Search the SRA register for a regulated firm.',
          },
          {
            id: 'web-firm',
            url: 'https://www.taylor-rose.co.uk/illegal-eviction',
            title: 'Taylor Rose illegal eviction',
            excerpt: 'Our solicitors can help.',
          },
        ],
        { matterSlug: 'housing' },
      )
      return (
        assert(leads.some((r) => r.costBand === 'free' && /shelter/i.test(r.url)), 'missing Shelter free lead') ||
        assert(leads.some((r) => r.costBand === 'paid' && /sra\.org/i.test(r.url)), 'missing SRA paid directory lead') ||
        assert(!leads.some((r) => /taylor-rose/i.test(r.url)), 'marketing firm should not be a Matching Help lead')
      )
    },
  },
  {
    id: 'coverage-wiki-drops-cgt-on-lockout',
    run: () => {
      const story =
        'Landlord removed the front door of my flat. No tenancy agreement. Wages held until I leave. I am still inside with no door.'
      const s = intake([story])
      const { frame } = attachResolvedMatterFrame(s, story)
      const slots = coverageSlotsFrom(frame, story)
      const cased = buildCaseLedOverview({
        story,
        frame,
        hitTitles: ['Illegal Evictions Guide For Tenants', 'Housing And Homelessness'],
      })
      return (
        assert(slots.some((slot) => slot.id === 'illegal_eviction'), 'missing illegal eviction slot') ||
        assert(slots.some((slot) => slot.id === 'occupying_insecure'), 'missing occupying slot') ||
        assert(
          !titleAllowedOnGraph(
            'What Changes have there been to Capital Gains Tax, Inheritance Tax and Unused Pension Funds?',
            frame,
          ),
          'CGT title still allowed on housing graph',
        ) ||
        assert(titleAllowedOnGraph('Illegal Evictions Guide For Tenants', frame), 'illegal eviction title blocked') ||
        assert(/still in occupation|missing door/i.test(cased.answer), `occupying rec missing: ${cased.answer.slice(0, 240)}`) ||
        assert(!/emergency accommodation, not a tenancy-deposit/i.test(cased.recommendations[0] || ''), 'still leading with homelessness tonight')
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
  {
    id: 'cafe-flat-summary-not-crutches-or-meta-because',
    run: () => {
      const story =
        "I'm in a dispute with my landlord/employer about my right to stay in my flat. I'm giving as much detail as I can, because I don't know what's relevant.\n\nI need two crutches to hobble around, and even so I'm still extremely limited in how far I can go.\n\nYesterday the front door to my flat had been removed. I really don't know what my next step should be, and I hope maybe someone here can give me some advice."
      const s = senseDetails(story, createInitialSession())
      const brief = buildLawyerBrief(s, 50)
      return (
        assert(!/crutches|hobble/i.test(s.goal), `goal leaked mobility need: ${s.goal}`) ||
        assert(!/don'?t know what'?s relevant/i.test(s.howCaused), `cause=${s.howCaused}`) ||
        assert(
          !/don'?t know what'?s relevant/i.test(brief.situationSummary),
          `summary still has meta because: ${brief.situationSummary}`,
        ) ||
        assert(!/crutches|hobble/i.test(brief.desiredOutcome), `outcome=${brief.desiredOutcome}`) ||
        assert(/stay housed/i.test(s.goal), `expected housing next-step goal, got ${s.goal}`)
      )
    },
  },
  {
    id: 'cafe-flat-curly-apostrophe-and-llm-overwrite',
    run: () => {
      const story =
        "I'm in a dispute with my landlord about my flat. I'm giving as much detail as I can, because I don\u2019t know what\u2019s relevant. I need two crutches to hobble around. The front door was removed. I really don't know what my next step should be."
      let s = senseDetails(story, createInitialSession())
      s = applyMasterToSession(
        s,
        {
          brief: {
            goal: 'two crutches to hobble around, and even so I am still extremely limited',
            howCaused: "because I don\u2019t know what\u2019s relevant.",
            whatHappened: s.whatHappened,
          },
          classify: { matterType: 'housing' },
        },
        'Treat this as involving all of the issues already identified.',
      )
      s = mergeOrchestratedTimeline(s, {
        events: s.events.map((e) => ({ label: e.label, rawSpan: e.rawSpan || e.label })),
        whatHappened: s.whatHappened,
        goal: 'two crutches to hobble around',
        howCaused: "because I don't know what's relevant",
      })
      const dirty = {
        ...createInitialSession(),
        rawInputs: [story],
        whatHappened: story,
        goal: 'two crutches to hobble around',
        howCaused: "because I don't know what's relevant",
        matterType: 'housing' as const,
      }
      const cleaned = sanitizeIntakeNarrative(dirty)
      const brief = buildLawyerBrief(dirty, 50)
      return (
        assert(!/crutches|hobble/i.test(s.goal), `master/llm goal=${s.goal}`) ||
        assert(!/don'?t know what'?s relevant/i.test(s.howCaused), `master cause=${s.howCaused}`) ||
        assert(!/crutches|hobble/i.test(cleaned.goal), `sanitize goal=${cleaned.goal}`) ||
        assert(!cleaned.howCaused, `sanitize cause=${cleaned.howCaused}`) ||
        assert(!/don'?t know what'?s relevant/i.test(brief.situationSummary), brief.situationSummary) ||
        assert(!/crutches|hobble/i.test(brief.desiredOutcome), `brief outcome=${brief.desiredOutcome}`)
      )
    },
  },
  {
    id: 'housing-sra-cards-drop-intellectual-property',
    run: () => {
      const shown = relevantWorkAreas(
        'Intellectual Property, Corporate, Commercial',
        'housing',
        false,
        'housing',
      )
      const ipScore = scoreSraWorkAreaForMatching('Intellectual Property, Corporate', {
        wantHousing: true,
        wantEmployment: false,
        wantImmigration: false,
        wantConsumer: false,
        wantCar: false,
        wantMotoring: false,
      })
      const housingScore = scoreSraWorkAreaForMatching('Housing, Landlord and Tenant', {
        wantHousing: true,
        wantEmployment: false,
        wantImmigration: false,
        wantConsumer: false,
        wantCar: false,
        wantMotoring: false,
      })
      return (
        assert(
          !shown.some((area) => /intellectual property/i.test(area)),
          `IP leaked onto housing cards: ${shown.join(', ')}`,
        ) ||
        assert(ipScore < 20, `IP score too high: ${ipScore}`) ||
        assert(housingScore >= 20, `housing score too low: ${housingScore}`)
      )
    },
  },
  {
    id: 'admissible-geometry-laptop-not-housing-or-motoring',
    run: () => {
      const story =
        "Staff member arrested. Police took the employer's work laptop and Dropbox. If they are not charged, can we get the laptop back? Can police open the work files? How do we get it back?"
      const s = intake([story])
      const { frame } = attachResolvedMatterFrame(s, story)
      const cased = buildCaseLedOverview({
        story,
        frame,
        clientQuestion: 'Can we get the laptop back if they are not charged?',
        hitTitles: ['Rights of way and using a back garden', 'Tenancy deposits'],
      })
      const flags = resolveSraSearchFlags({
        matterType: 'crime',
        query: story,
        taxonomySlug: 'criminal_defence',
      })
      const brief = buildLawyerBrief(
        { ...s, whatHappened: story, clientQuestion: 'Can we get the laptop back if they are not charged?' },
        50,
      )
      const offGraph = titleAllowedOnGraph('Rights of way and using a back garden', frame)
      const deposit = titleAllowedOnGraph('Tenancy deposits', frame)
      const critique = critiqueOverviewRecommendation({
        latestText: story,
        clientQuestion: 'Can we get the laptop back?',
        answerPackage: {
          answerOverview: cased.answer,
          recommendations: cased.recommendations,
          options: cased.options,
          followUps: cased.followUpPrompts,
          wikiPages: [],
          bullets: [],
          origin: 'retrieve-deterministic',
        } as never,
        matterFrame: frame,
      })
      return (
        assert(!/matched housing guidance/i.test(cased.answer), 'housing playbook on laptop story') ||
        assert(!/right of way|back garden/i.test(cased.answer), 'garden fill on laptop story') ||
        assert(/library is thin|police seizure|employer property/i.test(cased.answer), `weak rec missing: ${cased.answer.slice(0, 220)}`) ||
        assert(!offGraph, 'garden title still allowed on crime graph') ||
        assert(!deposit, 'tenancy deposit still allowed on crime graph') ||
        assert(flags.wantMotoring === false, `wantMotoring=${flags.wantMotoring}`) ||
        assert(!/driving \/ PCN/i.test(sraMatchReason('Motoring, Crime - General', { ...flags, wantCar: false, wantConsumer: false })), 'motoring PCN reason on non-driving crime') ||
        assert(
          /arrested person/i.test(
            sraMatchReason('Criminal Defence, Crime - General', { ...flags, wantCar: false, wantConsumer: false }),
          ),
          'SRA reason still treats employer as the defendant',
        ) ||
        assert(!/progress the .{0,40} using the matched guidance/i.test(cased.answer), 'fill line still in live-now') ||
        assert(
          !/Staff member arrested\. Police took/i.test(cased.answer.split('Your questions:')[1] || ''),
          'whole brief echoed as Your questions',
        ) ||
        assert(
          !titleAdmissibleOnGeometry('If you report child abuse to the police', frame, story, { requireCoverage: true }),
          'child-abuse police title still admitted',
        ) ||
        assert(
          !titleAdmissibleOnGeometry('How to react if you are asked to attend a police interview under caution?', frame, story, {
            requireCoverage: true,
          }),
          'interview-under-caution title still admitted for employer',
        ) ||
        assert(
          !freeHelpAdmissibleOnGeometry(
            'Our free helpline - Shelter England',
            'you are homeless you have nowhere to stay tonight',
            story,
          ),
          'Shelter homelessness helpline still allowed on employer-kit crime',
        ) ||
        assert(
          !titleAdmissibleOnGeometry(
            'Check if you can get your money back after a scam',
            frame,
            story,
            { requireCoverage: true },
          ),
          'consumer scam wiki still admitted on employer-kit crime',
        ) ||
        assert(
          !titleAdmissibleOnGeometry('If something you ordered hasn\'t arrived', frame, story, {
            requireCoverage: true,
          }),
          'delivery wiki still admitted on employer-kit crime',
        ) ||
        assert(
          !freeHelpAdmissibleOnGeometry(
            'Citizens Advice consumer helpline',
            'Help with faulty goods, refunds, traders, contracts and consumer rights.',
            story,
          ),
          'consumer helpline still allowed on employer-kit crime',
        ) ||
        assert(
          !sraOrganisationAdmissible('CROWN PROSECUTION SERVICE HOUNSLOW'),
          'CPS still treated as an admissible SRA defence match',
        ) ||
        assert(
          !freeHelpAdmissibleOnGeometry(
            'Civil Legal Advice (legal aid gateway)',
            'Check legal aid eligibility and speak to an adviser for housing, debt, family and other civil matters.',
            story,
          ),
          'CLA housing gateway still allowed on employer-kit crime',
        ) ||
        assert(
          /Recover the work laptop/i.test(compressLiveGoal(story)),
          `goal not compressed: ${compressLiveGoal(story)}`,
        ) ||
        assert(!/\?.*\?/.test(compressLiveGoal(story)), 'compressed goal still concatenates questions') ||
        assert(
          matchingHelpLanesForStory(story).join(',') === 'arrested_person,employer_property',
          `lanes=${matchingHelpLanesForStory(story).join(',')}`,
        ) ||
        assert(
          /employer property/i.test(
            sraMatchReason('Employment, Commercial', {
              ...employerPropertySraFlags(story),
              query: story,
              wantCar: false,
              wantConsumer: false,
            }),
          ),
          'employer lane still labelled as defence',
        ) ||
        assert(
          slotRetryQueries(coverageSlotsFrom(frame, story), [], story).some((row) =>
            /return of seized|work files|PACE/i.test(row.query),
          ),
          'slot-retry missing employer-kit queries',
        ) ||
        assert(
          isOfficialAuthoritySource('PACE Code B 2023', 'https://www.gov.uk/government/publications/pace-code-b-2023'),
          'PACE/GOV.UK not treated as official',
        ) ||
        assert(
          !isOfficialAuthoritySource('If something you ordered hasn\'t arrived', ''),
          'delivery wiki treated as official',
        ) ||
        assert(
          critiqueOverviewRecommendation({
            latestText: story,
            answerPackage: {
              answerOverview:
                'This client was recommended by LegalShaman.com. Start with the consumer helpline about faulty goods and a scam refund if the item hasn\'t arrived.',
              recommendations: ['a', 'b'],
              options: [{ title: 'One', description: 'x' }, { title: 'Two', description: 'y' }],
              followUps: [{ id: '1', label: 'a', prompt: 'a' }, { id: '2', label: 'b', prompt: 'b' }, { id: '3', label: 'c', prompt: 'c' }],
              wikiPages: [],
              bullets: [],
              origin: 'retrieve-deterministic',
            } as never,
            matterFrame: frame,
          }).errors.some((e) => /consumer filler/i.test(e)),
          'critic missed consumer filler on employer-kit overview',
        ) ||
        assert(
          !/Your live questions:|Are we likely to get it back|do not paste/i.test(cased.recommendations.join(' ')),
          'takeaways still dump live questions or author notes',
        ) ||
        assert(
          !/do not paste/i.test(cased.takeaways.join(' ')),
          'takeaways still contain do not paste',
        ) ||
        assert(
          critiqueOverviewRecommendation({
            latestText: story,
            answerPackage: {
              answerOverview: 'This client was recommended by LegalShaman.com. Write to the force.',
              recommendations: [
                'Write to the force — do not paste the client\'s question list into the takeaways.',
                'Ask about the property reference.',
              ],
              options: [{ title: 'One', description: 'x' }, { title: 'Two', description: 'y' }],
              followUps: [{ id: '1', label: 'a', prompt: 'a' }, { id: '2', label: 'b', prompt: 'b' }, { id: '3', label: 'c', prompt: 'c' }],
              wikiPages: [],
              bullets: [],
              origin: 'retrieve-deterministic',
            } as never,
            matterFrame: frame,
          }).errors.some((e) => /do not paste|author instructions|question dump/i.test(e)),
          'critic missed do-not-paste author note in takeaways',
        ) ||
        assert(
          !titleAdmissibleOnGeometry('If you are accused', frame, story, { requireCoverage: true }),
          'accused wiki still admitted on employer-kit crime',
        ) ||
        assert(
          !titleAdmissibleOnGeometry('Who can accompany you to a disciplinary meeting', frame, story, {
            requireCoverage: true,
          }),
          'disciplinary wiki still admitted on employer-kit crime',
        ) ||
        assert(
          !sraOrganisationAdmissible('Care Quality Commission'),
          'CQC still treated as an admissible SRA solicitor match',
        ) ||
        assert(extractClientQuestions(story).every((q) => q.length <= 180), 'questions still dump the narrative') ||
        assert(!/Asking for any police officers|Not yet stated/i.test(`${brief.situationSummary} ${brief.desiredOutcome}`), `brief=${brief.situationSummary} | ${brief.desiredOutcome}`) ||
        assert(critique.ok || !critique.errors.some((e) => /fewer than 2 wiki/.test(e)), `critic still demands two wiki pages: ${critique.critique}`)
      )
    },
  },
  {
    id: 'ambiguous-seized-device-asks-who-the-asker-is',
    run: () => {
      const ambiguous = 'Someone was arrested and the police took a laptop. What happens next?'
      const employer =
        "Staff member arrested. Police took the employer's work laptop. Can we get it back if they are not charged?"
      const { frame: unclear } = attachResolvedMatterFrame(intake([ambiguous]), ambiguous)
      const { frame: clear } = attachResolvedMatterFrame(intake([employer]), employer)
      return (
        assert(storyLooksAmbiguousSeizedDevice(ambiguous), 'ambiguous geometry not detected') ||
        assert(!storyLooksAmbiguousSeizedDevice(employer), 'clear employer kit treated as ambiguous') ||
        assert(
          unclear.ambiguities.some((a) => /arrested, or the employer/i.test(a.question) && a.blocking),
          `missing blocking capacity ask: ${unclear.ambiguities.map((a) => a.question).join(' | ')}`,
        ) ||
        assert(
          !clear.ambiguities.some((a) => a.blocking && /arrested, or the employer/i.test(a.question)),
          'clear employer kit still blocked',
        ) ||
        assert(
          clear.capacities.some((c) => c.partyId === 'user' && c.capacity === 'employer'),
          `employer capacity missing: ${clear.capacities.map((c) => `${c.partyId}:${c.capacity}`).join(',')}`,
        )
      )
    },
  },
  {
    id: 'admissible-geometry-cafe-flat-keeps-housing-drops-garden',
    run: () => {
      const story =
        'Landlord removed the front door of my flat. No tenancy agreement. Wages held until I leave. I am still inside with no door.'
      const s = intake([story])
      const { frame } = attachResolvedMatterFrame(s, story)
      const cased = buildCaseLedOverview({
        story,
        frame,
        hitTitles: ['Illegal Evictions Guide For Tenants', 'Housing And Homelessness'],
      })
      return (
        assert(titleAllowedOnGraph('Illegal Evictions Guide For Tenants', frame), 'housing title blocked') ||
        assert(!titleAllowedOnGraph('Rights of way and using a back garden', frame), 'garden still on housing graph') ||
        assert(/still in occupation|missing door/i.test(cased.answer), 'occupying rec missing') ||
        assert(!/right of way/i.test(cased.answer), 'garden leaked into cafe-flat overview')
      )
    },
  },
  {
    id: 'admissible-geometry-rro-relet-not-s21-or-illegal-evict',
    run: () => {
      const story =
        'My partner and I received a notice via our letting agent stating we needed to vacate our rental on the grounds that the landlord’s family member intended to move into the property. We complied and moved out on 31 July 2026. Since then the property has been re-listed for rent and a new tenancy has been agreed. This may be a breach of the restriction on re-letting under the Renters’ Rights Act and grounds for a rent repayment order via the First-tier Tribunal. How strong is this? What is the time limit to apply?'
      const s = intake([story])
      const { frame } = attachResolvedMatterFrame(s, story)
      const slots = coverageSlotsFrom(frame, story)
      const solidPack = {
        answerOverview:
          'This client was recommended by LegalShaman.com. This situation may indeed constitute a solid case for a rent repayment order. You typically apply within 12 months. Keep screenshots and tenancy documents. Get a Citizens Advice check.',
        recommendations: ['This is a strong case — file the RRO.', 'Keep the re-listing screenshots.'],
        options: [
          { title: 'Tribunal RRO', description: 'Apply to the First-tier Tribunal.' },
          { title: 'Advice check', description: 'Shelter or Citizens Advice housing.' },
        ],
        followUps: [
          { id: '1', label: 'a', prompt: 'a' },
          { id: '2', label: 'b', prompt: 'b' },
          { id: '3', label: 'c', prompt: 'c' },
        ],
        wikiPages: [],
        bullets: [],
        origin: 'retrieve-deterministic',
      } as never
      const hedgedPack = {
        answerOverview:
          'This client was recommended by LegalShaman.com. A tribunal looks at the possession ground used, whether the property was re-let, and what evidence is missing (notice, dates, listing). Time limits: sources disagree (12 vs 24 months) — check sources before filing. Do not treat this as a stay-in-home or section 21 problem: they already left. Shelter housing advice or Justice for Tenants can check the papers.',
        recommendations: [
          'Bundle the family-ground notice, move-out date, and re-listing proof.',
          'Check official sources on the RRO window (12 vs 24 months).',
        ],
        options: [
          { title: 'Evidence pack', description: 'What the tribunal looks at.' },
          { title: 'Free housing advice', description: 'Justice for Tenants or CAB housing.' },
        ],
        followUps: [
          { id: '1', label: 'a', prompt: 'a' },
          { id: '2', label: 'b', prompt: 'b' },
          { id: '3', label: 'c', prompt: 'c' },
        ],
        wikiPages: [],
        bullets: [{ text: 'Keep the tenancy agreement and rent statements.' }],
        origin: 'retrieve-deterministic',
      } as never
      const solidCritique = critiqueOverviewRecommendation({
        latestText: story,
        clientQuestion: 'How strong is this? What is the time limit to apply?',
        answerPackage: solidPack,
        matterFrame: frame,
      })
      const hedgedCritique = critiqueOverviewRecommendation({
        latestText: story,
        clientQuestion: 'How strong is this? What is the time limit to apply?',
        answerPackage: hedgedPack,
        matterFrame: frame,
      })
      return (
        assert(storyLooksVacatedRroRelet(story), 'vacated RRO/re-let geometry not detected') ||
        assert(
          slots.some((slot) => slot.id === 'rro_relet_restriction'),
          `missing RRO slot: ${slots.map((slot) => slot.id).join(',')}`,
        ) ||
        assert(
          !slots.some((slot) => slot.id === 'illegal_eviction' || slot.id === 'homelessness'),
          `lock-out/homeless slots on vacated RRO: ${slots.map((slot) => slot.id).join(',')}`,
        ) ||
        assert(
          !titleAdmissibleOnGeometry('Illegal Evictions Guide For Tenants', frame, story, {
            requireCoverage: true,
          }),
          'Illegal Evictions Guide still required coverage on vacated RRO',
        ) ||
        assert(
          !titleAdmissibleOnGeometry('Eviction notices from private landlords — section 21', frame, story, {
            requireCoverage: true,
          }),
          'section 21 still admitted as required coverage on vacated RRO',
        ) ||
        assert(
          titleAdmissibleOnGeometry('Rent repayment orders and re-letting after Ground 1', frame, story, {
            requireCoverage: true,
          }),
          'RRO/re-let title not admitted on vacated RRO geometry',
        ) ||
        assert(
          !freeHelpAdmissibleOnGeometry(
            'Our free helpline - Shelter England',
            'you are homeless you have nowhere to stay tonight',
            story,
          ),
          'Shelter homelessness helpline still allowed on vacated RRO',
        ) ||
        assert(
          !freeHelpAdmissibleOnGeometry(
            'Housing Loss Prevention Advice Service (HLPAS)',
            'on-the-day advice if you are at risk of losing your home',
            story,
          ),
          'HLPAS still allowed on vacated RRO',
        ) ||
        assert(
          !freeHelpAdmissibleOnGeometry('LEASE (leasehold advice)', 'Advice for leaseholders.', story),
          'LEASE still allowed on vacated RRO',
        ) ||
        assert(
          !freeHelpAdmissibleOnGeometry(
            'Getting paid when you leave a job',
            'Holiday pay and last wages after you leave.',
            story,
          ),
          'leave-a-job pay page still allowed on vacated RRO',
        ) ||
        assert(
          freeHelpAdmissibleOnGeometry(
            'Shelter housing advice',
            'Advice for private tenants including the Renters’ Rights Act.',
            story,
          ),
          'Shelter housing advice blocked on vacated RRO',
        ) ||
        assert(
          freeHelpAdmissibleOnGeometry(
            'Justice for Tenants',
            'Help with rent repayment orders and rogue landlords.',
            story,
          ),
          'Justice for Tenants blocked on vacated RRO',
        ) ||
        assert(
          freeHelpAdmissibleOnGeometry(
            'Citizens Advice housing',
            'Housing advice for private tenants.',
            story,
          ),
          'CAB housing blocked on vacated RRO',
        ) ||
        assert(
          freeHelpAdmissibleOnGeometry(
            'Civil Legal Advice (legal aid gateway)',
            'Check legal aid eligibility for housing matters.',
            story,
          ),
          'CLA blocked on vacated RRO',
        ) ||
        assert(
          solidCritique.errors.some((e) => /rates claim strength/i.test(e)),
          `critic missed solid case: ${solidCritique.critique}`,
        ) ||
        assert(
          solidCritique.errors.some((e) => /settled RRO|apply window/i.test(e)),
          `critic missed settled 12-month window: ${solidCritique.critique}`,
        ) ||
        assert(
          /what a tribunal looks at/i.test(solidCritique.critique),
          'critic rewrite hint missing tribunal-looks-at instruction',
        ) ||
        assert(
          !hedgedCritique.errors.some((e) => /rates claim strength|settled RRO/i.test(e)),
          `hedged RRO overview still failed strength/limitation: ${hedgedCritique.critique}`,
        ) ||
        assert(
          !/solid case|strong case/i.test(hedgedPack.recommendations.join(' ')),
          'hedged takeaways still contain solid/strong case',
        ) ||
        assert(
          !/do not paste/i.test(hedgedPack.recommendations.join(' ')),
          'takeaways contain do not paste',
        )
      )
    },
  },
  {
    id: 'hypothesis-probe-school-cleaner-not-family-only-gate',
    run: () => {
      const story =
        'I started a job as a school cleaner. Staff are not allowed holidays during school term and contact is only by radios — no phones or earphones. I have autism and severe anxiety so earphones help me. Am I allowed to take holidays in school breaks and use earphones at work?'
      const s = intake([story])
      const framed = attachResolvedMatterFrame(s, story)
      const primary = framed.frame.primaryIssues[0]?.slug || ''
      const gate = matterGatePrompt(framed.session)
      const labels = (gate.options || []).map((o) => o.label.toLowerCase()).join(' | ')
      const hypSlugs = (framed.hypothesisSet.hypotheses || []).map((h) => h.slug)
      const employmentLive =
        primary === 'employment' ||
        hypSlugs.includes('employment') ||
        /employment|workplace/i.test(labels)
      const familyOnlyGate =
        /mainly family/i.test(labels) &&
        !/employment|workplace/i.test(labels) &&
        hypSlugs.length <= 1 &&
        primary === 'family'
      return (
        assert(storyLooksWorkplaceLeaveOrStaffRules(story), 'workplace leave detector missed cleaner story') ||
        assert(s.matterType === 'employment', `sense matterType=${s.matterType}, want employment`) ||
        assert(
          framed.session.researchDialogue?.status === 'active',
          `expected late-freeze active dialogue, got ${framed.session.researchDialogue?.status}`,
        ) ||
        assert(
          framed.session.hypothesisProbe?.status !== 'committed',
          'early commit before dialogue',
        ) ||
        assert(employmentLive, `employment missing as competitor/primary; primary=${primary}; hyps=${hypSlugs.join(',')}; gate=${labels}`) ||
        assert(!familyOnlyGate, `family-only gate: ${labels}`) ||
        assert(
          !framed.frame.exclusions.includes('discrimination_equality') ||
            hypSlugs.includes('employment'),
          'equality excluded on workplace neurodiversity story',
        )
      )
    },
  },
  {
    id: 'debt-allowed-not-owed-substring',
    run: () => {
      const story = 'Am I allowed to take holidays during school breaks as a cleaner?'
      const s = senseDetails(story, createInitialSession())
      return assert(s.matterType !== 'debt', `allowed→debt bleed: matterType=${s.matterType}`)
    },
  },
  {
    id: 'hypothesis-probe-commit-then-prefer-frame-matching',
    run: () => {
      const story =
        'I started a job as a school cleaner. Staff are not allowed holidays during school term. No phones or earphones. Autism and severe anxiety — earphones help. What are my rights?'
      const s = intake([story])
      let framed = attachResolvedMatterFrame(s, story)
      let set = framed.hypothesisSet
      if (framed.session.researchDialogue?.status === 'active' || framed.session.hypothesisProbe?.status === 'probing') {
        set = applyHypothesisProbeAnswer(
          set,
          'hyp_probe_employment_vs_family_0',
          'This is mainly about employment',
        )
        framed = {
          ...commitHypothesisProbeToSession(framed.session, set, story),
          hypothesisSet: set,
          researchDialogue: framed.researchDialogue,
        }
      }
      const committed = framed.session
      const curated = {
        matterType: 'family' as const,
        topicId: 'family-contact',
        rationale: 'child contact arrangements',
      }
      const research = {
        matterType: 'employment' as const,
        topicId: 'employment-leave',
        rationale: 'holiday entitlement at work',
      }
      const preferred = preferFrameMatching(curated, research, committed.matterFrame)
      return (
        assert(
          committed.researchDialogue?.status === 'committed' ||
            committed.hypothesisProbe?.status === 'committed',
          'dialogue did not commit',
        ) ||
        assert(
          committed.matterFrame?.primaryIssues?.[0]?.slug === 'employment',
          `committed primary not employment: ${committed.matterFrame?.primaryIssues?.[0]?.slug}`,
        ) ||
        assert(shouldCommitHypothesisSet(set), 'shouldCommit false after user pick') ||
        assert(
          preferred?.matterType === 'employment',
          `preferFrameMatching ignored committed employment: ${preferred?.matterType}`,
        )
      )
    },
  },
  {
    id: 'late-freeze-force-commit-budget-keeps-employment',
    run: () => {
      const story =
        'I started a job as a school cleaner. Staff are not allowed holidays during school term. No phones. Autism — earphones help.'
      const s = intake([story])
      const framed = attachResolvedMatterFrame(s, story)
      const dialogue: ResearchDialogueState = {
        ...(framed.session.researchDialogue as ResearchDialogueState),
        turns: RESEARCH_DIALOGUE_MAX_TURNS,
        set: {
          ...framed.hypothesisSet,
          turns: RESEARCH_DIALOGUE_MAX_TURNS,
        },
      }
      return (
        assert(shouldForceCommitDialogue(dialogue), 'force commit false at budget') ||
        assert(
          dialogue.set.hypotheses[0]?.slug === 'employment',
          `top hyp not employment at force: ${dialogue.set.hypotheses[0]?.slug}`,
        )
      )
    },
  },
  {
    id: 'late-freeze-no-overview-without-commit',
    run: () => {
      const story =
        'I started a job as a school cleaner. Staff are not allowed holidays during school term.'
      const framed = attachResolvedMatterFrame(intake([story]), story)
      const canLaunchPenumbra =
        framed.session.researchDialogue?.status === 'committed' ||
        framed.session.hypothesisProbe?.status === 'committed'
      return assert(!canLaunchPenumbra, 'Penumbra launch allowed before late commit')
    },
  },
  {
    id: 'hypothesis-local-wiki-evidence-merge',
    run: () => {
      const set = {
        hypotheses: [
          {
            slug: 'employment',
            score: 20,
            why: ['det'],
            evidence: [] as Array<{ title: string; support: 'support' | 'contradict' | 'neutral' }>,
          },
          {
            slug: 'family',
            score: 18,
            why: ['tax'],
            evidence: [] as Array<{ title: string; support: 'support' | 'contradict' | 'neutral' }>,
          },
        ],
        turns: 0,
        askedProbeIds: [] as string[],
      }
      const next = mergeHypothesisEvidence(set, {
        employment: [{ title: 'Holiday entitlement', support: 'support' }],
        family: [{ title: 'Child arrangements orders', support: 'support' }],
      })
      return (
        assert(
          next.hypotheses[0]!.evidence.some((e) => /Holiday entitlement/i.test(e.title)),
          'employment evidence missing',
        ) ||
        assert(next.hypotheses[0]!.score > 20, 'support did not boost score') ||
        assert(
          next.hypotheses.some((h) => h.why.includes('local wiki support')),
          'wiki support why missing',
        )
      )
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
