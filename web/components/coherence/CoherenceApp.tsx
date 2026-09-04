'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Timeline } from './Timeline'
import { PromptBlock } from './PromptBlock'
import { PredictiveOptions } from './PredictiveOptions'
import { InputBar } from './InputBar'
import { ProgressFooter } from './ProgressFooter'
import { ServicesView } from './ServicesView'
import { LawyerNotes } from './LawyerNotes'
import { LawyerLogin } from './LawyerLogin'
import { LawyerPortal } from './LawyerPortal'
import { ModeFork } from './ModeFork'
import { FrameChips } from './FrameChips'
import { ClosingNextSteps } from './ClosingNextSteps'
import { OslawView } from './OslawView'
import { SraOrganisationView } from './SraOrganisationView'
import { LoadingScreen } from './LoadingScreen'
import { PageNavigation } from './PageNavigation'
import { B2CBillingBanner } from '@/components/billing/b2c-billing-banner'
import { captureProductEvent } from '@/components/analytics/posthog-provider'
import type { SearchDestination } from './ReformulationGate'
import { createInitialSession, isMetaCauseLine, isPhysicalNeedNotGoal, senseDetails } from '@/lib/coherence/sense'
import { summariseToLabel } from '@/lib/coherence/timelineExtract'
import { matterClassifierPrompt, nextPrompt } from '@/lib/coherence/questions'
import { predictiveOptions } from '@/lib/coherence/options'
import { computeProgress, computeServiceConfidence } from '@/lib/coherence/slots'
import { isBriefReady } from '@/lib/coherence/brief'
import { enhanceQuestionWithLlm, getLlmStatus } from '@/lib/coherence/llmQuestion'
import {
  clarifiersForSession,
} from '@/lib/coherence/llmOrchestrate'
import { applyMasterToSession, runMasterOrchestrate, type HelpMatchResult, type MasterResult } from '@/lib/coherence/masterAgent'
import { isFinalOverviewPackage, fetchRetrieveAnswer, sessionAnswerQuery } from '@/lib/coherence/retrieveAnswer'
import { useCoherenceAuth } from '@/lib/auth/use-coherence-auth'
import { MatterFrameInspector } from './MatterFrameInspector'
import type { AnswerFollowUp, AnswerPackage } from '@/lib/coherence/answerPackage'
import { proposeCoherentFrames } from '@/lib/coherence/frames'
import { applyTopicLockToSession } from '@/lib/coherence/topicLock'
import {
  attachResolvedMatterFrame,
  commitResearchDialogueToSession,
  matterGatePrompt,
  sessionMatterGate,
} from '@/lib/coherence/applyMatterFrame'
import {
  applyUserAnswerToDialogue,
  dialogueFailurePrompt,
  framesFromHypotheses,
  fromHypothesisProbeCompat,
  isResearchDialoguePromptId,
  researchingCompetitorLine,
  toHypothesisProbeCompat,
  type ResearchDialogueState,
} from '@/lib/coherence/researchDialogue'
import {
  applyPackClassification,
  classificationFromClarifyAnswer,
  heuristicSuggestPack,
  shouldRunPackClassify,
  type PackClassification,
} from '@/lib/coherence/packClassifier'
import { resolveApiUrl } from '@/lib/site/api-url'
import { clearPersisted, loadPersisted, savePersisted } from '@/lib/coherence/persist'
import { loadLawyerSession, type LawyerSession } from '@/lib/coherence/lawyerAuth'
import { buildSearchContextProfile } from '@/lib/coherence/searchContext'
import { styleTranslateForRetrieval } from '@/lib/coherence/styleTranslation'
import {
  newPenumbraCaseKey,
  requestPenumbraResearch,
} from '@/lib/coherence/penumbraResearch'
import type { Mode, Party, Prompt, SearchMode, SessionState, TimelineEvent } from '@/lib/coherence/types'
import './CoherenceApp.css'

const PENUMBRA_SKIP_QUESTION = '__penumbra_skip_question__'

type View = 'intake' | 'services' | 'notes' | 'oslaw' | 'lawyer-login' | 'lawyer-portal' | 'sra-org'

function PenumbraStatusBanner({
  research,
  busy,
}: {
  research: SessionState['penumbraResearch']
  busy: boolean
}) {
  const status = research?.status ?? 'idle'
  const running = busy || status === 'starting'
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!running) {
      return
    }
    const startedAt = Date.parse(research?.updatedAt || '') || Date.now()
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [research?.updatedAt, running])

  if (!research || status === 'idle') return null

  const content =
    status === 'awaiting_input'
      ? {
          title: 'Research paused — your answer is needed',
          message:
            'The Shaman found a gap that could change the research. Answer the question below, or skip it to continue with the current facts.',
          duration: 'Waiting for you',
        }
      : status === 'complete'
        ? {
            title: 'Research complete — ready for review',
            message:
              'The Shaman has finished its research pass. Legal Shaman can now check the findings and prepare the grounded answer.',
            duration: 'Complete',
          }
        : status === 'error'
          ? {
              title: 'Research stopped — please try again',
              message:
                'The research pass did not complete. Your case information is still saved; run the research again when ready.',
              duration: 'Stopped',
            }
          : {
              title: 'Researching now',
              message:
                'The Shaman is reviewing curated Legal Shaman sources first, then checking wider public sources for genuine gaps.',
              duration: `Running for ${elapsed}s`,
            }

  return (
    <section
      className={`penumbra-status penumbra-status--${status}`}
      aria-live="polite"
      aria-busy={running}
    >
      <div className="penumbra-status__top">
        <div className="penumbra-status__title">
          <span className={`penumbra-status__indicator${running ? ' is-running' : ''}`} aria-hidden="true" />
          <strong>{content.title}</strong>
        </div>
        <span className="penumbra-status__duration">{content.duration}</span>
      </div>
      <p className="penumbra-status__message">{content.message}</p>
      {running ? (
        <ol className="penumbra-status__steps" aria-label="Research steps">
          <li className="is-current">Reviewing curated Legal Shaman sources</li>
          <li>Checking wider public sources for gaps</li>
          <li>Preparing findings for Legal Shaman review</li>
        </ol>
      ) : null}
    </section>
  )
}

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function pushEvent(events: SessionState['events'], label: string, raw?: string) {
  if (events.some((e) => e.label === label)) return events
  return [...events, { id: uid(), label, kind: 'event' as const, rawSpan: raw }]
}

/** Narrative prompts: timeline events come from senseDetails() — only set story fields here. */
function applyNarrativeAnswer(value: string, next: SessionState): SessionState {
  const v = value.trim()
  return {
    ...next,
    whatHappened: next.whatHappened ? `${next.whatHappened} ${v}` : v,
  }
}

function applyGapAnswer(promptId: string, value: string, next: SessionState): SessionState {
  const v = value.trim()
  const lower = v.toLowerCase()

  switch (promptId) {
    case 'gap_incident_detail':
      return applyNarrativeAnswer(v, next)
    case 'gap_mechanism':
      if (isMetaCauseLine(v) || isPhysicalNeedNotGoal(v)) return next
      return {
        ...next,
        howCaused: next.howCaused ? `${next.howCaused}; ${v}` : v,
        events: pushEvent(next.events, `Mechanism: ${summariseToLabel(v, 56)}`, v),
      }
    case 'gap_breach':
    case 'gap_refusal_reason':
      if (isMetaCauseLine(v) || isPhysicalNeedNotGoal(v)) return next
      return {
        ...next,
        howCaused: v,
        events: pushEvent(next.events, `Cause: ${summariseToLabel(v, 60)}`, v),
      }
    case 'gap_responsible': {
      let parties: Party[] = [...next.parties]
      if (/employer/.test(lower) && !parties.some((p) => p.role === 'employer')) {
        parties = [...parties, { label: 'Employer', role: 'employer' }]
      }
      if (/landlord/.test(lower) && !parties.some((p) => p.role === 'landlord')) {
        parties = [...parties, { label: 'Landlord', role: 'landlord' }]
      }
      if (/neighbour|neighbor/.test(lower) && !parties.some((p) => p.role === 'neighbour')) {
        parties = [...parties, { label: 'Neighbour', role: 'neighbour' }]
      }
      if (/agent/.test(lower) && !parties.some((p) => /agent/i.test(p.label))) {
        parties = [...parties, { label: 'Letting agent', role: 'agent' }]
      }
      if (/company on site|another company/.test(lower)) {
        parties = [...parties, { label: 'Other company on site', role: 'third_party' }]
      }
      return { ...next, parties, events: pushEvent(next.events, v, v) }
    }
    case 'gap_employer_duty': {
      const parties = [...next.parties]
      if (/employee|agency|temporary/.test(lower) && !parties.some((p) => p.role === 'employer')) {
        parties.push({ label: 'Employer', role: 'employer' })
      }
      return { ...next, parties, events: pushEvent(next.events, `Work status: ${v}`, v) }
    }
    case 'gap_harm':
      return { ...next, events: pushEvent(next.events, `Harm: ${summariseToLabel(v, 60)}`, v) }
    case 'gap_aftermath':
    case 'gap_housing_trigger':
      return { ...next, events: pushEvent(next.events, summariseToLabel(v, 60), v) }
    case 'gap_character':
      return {
        ...next,
        softFlags:
          /yes|raised|character/.test(lower) && !/no, character was not/.test(lower)
            ? Array.from(new Set([...next.softFlags, 'character_concern_raised']))
            : next.softFlags,
      }
    case 'gap_when': {
      const dateApprox =
        v.match(
          /\b((?:19|20)\d{2}|last \w+|this \w+|yesterday|today|earlier)\b/i,
        )?.[0] || v
      if (next.events.length) {
        const events = [...next.events]
        const last = { ...events[events.length - 1], dateApprox: events[events.length - 1].dateApprox || dateApprox }
        events[events.length - 1] = last
        return { ...next, events }
      }
      return next
    }
    case 'gap_where': {
      if (/scotland/.test(lower)) return { ...next, jurisdiction: 'Scotland', locationHint: next.locationHint || 'Scotland' }
      if (/northern/.test(lower))
        return { ...next, jurisdiction: 'NorthernIreland', locationHint: next.locationHint || 'Northern Ireland' }
      if (/wales/.test(lower)) return { ...next, jurisdiction: 'EnglandWales', locationHint: next.locationHint || 'Wales' }
      if (/london/.test(lower)) return { ...next, jurisdiction: 'EnglandWales', locationHint: 'London' }
      if (/england/.test(lower) || lower.length > 2)
        return { ...next, jurisdiction: 'EnglandWales', locationHint: next.locationHint || v }
      return next
    }
    case 'gap_evidence':
    case 'documents': {
      if (/no documents|nothing yet|no papers/i.test(v)) {
        return { ...next, answeredPromptIds: Array.from(new Set([...next.answeredPromptIds, 'documents', 'gap_evidence'])) }
      }
      const docs = [...next.documents]
      if (v && !docs.includes(v)) docs.push(summariseToLabel(v, 64))
      return { ...next, documents: docs }
    }
    case 'pack_clarify': {
      const chosen = classificationFromClarifyAnswer(v)
      return chosen ? applyPackClassification(next, chosen) : next
    }
    case 'gap_goal':
      return { ...next, goal: next.goal || v }
    case 'constraint_goal':
      return { ...next, goal: next.goal || v }
    case 'constraint_jurisdiction': {
      if (/scotland/.test(lower)) return { ...next, jurisdiction: 'Scotland', locationHint: next.locationHint || 'Scotland' }
      if (/northern/.test(lower))
        return { ...next, jurisdiction: 'NorthernIreland', locationHint: next.locationHint || 'Northern Ireland' }
      if (/wales/.test(lower)) return { ...next, jurisdiction: 'EnglandWales', locationHint: next.locationHint || 'Wales' }
      if (/england|london|manchester|birmingham/.test(lower) || lower.length > 2)
        return { ...next, jurisdiction: 'EnglandWales', locationHint: next.locationHint || v }
      return next
    }
    case 'constraint_timeline_thin':
      return applyNarrativeAnswer(v, next)
    case 'constraint_decision_date':
      return {
        ...next,
        events: pushEvent(next.events, `Decision timing: ${summariseToLabel(v, 56)}`, v),
      }
    case 'constraint_decision_letter':
      return {
        ...next,
        documents: next.documents.includes(v) ? next.documents : [...next.documents, summariseToLabel(v, 64)],
      }
    case 'constraint_leave_status':
    case 'constraint_family_link':
    case 'constraint_protection_basis':
    case 'constraint_removal_when':
    case 'constraint_character_detail':
      return {
        ...next,
        events: pushEvent(next.events, summariseToLabel(v), v),
      }
    case 'matter':
    case 'matter_for_services': {
      if (/immig|ilr|visa/.test(lower)) return { ...next, matterType: 'immigration' }
      if (/injur|accident|pi/.test(lower)) return { ...next, matterType: 'personal_injury' }
      if (/hous|landlord|rent|evict|neighbour|neighbor/.test(lower)) return { ...next, matterType: 'housing' }
      if (/convey|buy|sell|purchase|home/.test(lower) && /convey|home|flat|house/.test(lower))
        return { ...next, matterType: 'conveyancing', mode: 'browse' }
      if (/employ|job|workplace|holiday|manager|shift/.test(lower)) return { ...next, matterType: 'employment' }
      if (/debt|bailiff|ccj/.test(lower)) return { ...next, matterType: 'debt' }
      if (/insur|medical funding|ticket|festival|refund|trader|consumer|disability|access|wheelchair/.test(lower))
        return { ...next, matterType: 'consumer' }
      if (/family|child|divorce|domestic/.test(lower)) return { ...next, matterType: 'family' }
      if (/crime|police|arrest/.test(lower)) return { ...next, matterType: 'crime' }
      return { ...next, matterType: 'other' }
    }
    case 'safety':
      return {
        ...next,
        safetyRisk: /urgent|danger|need help/i.test(lower)
          ? true
          : /safe for now/i.test(lower)
            ? false
            : next.safetyRisk,
      }
    default:
      return next
  }
}

function storyFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function persistedLooksLikeStory(session: SessionState, story: string): boolean {
  const needle = storyFingerprint(story)
  if (needle.length < 24) return false
  const hay = storyFingerprint(
    [...session.rawInputs, session.whatHappened || '', session.goal || ''].join(' '),
  )
  if (!hay) return false
  // Same deep-link / paste if either side contains a substantial shared prefix/chunk.
  const head = needle.slice(0, 64)
  return hay.includes(head) || needle.includes(hay.slice(0, 64))
}

function normalizeSession(session: SessionState): SessionState {
  const base = createInitialSession()
  const research = session.penumbraResearch
  const normalizedResearch =
    research && typeof research.caseKey === 'string'
      ? {
          ...research,
          status:
            // An in-flight request cannot survive a page reload. Recover stale
            // persisted work to an actionable idle state.
            research.status === 'starting'
              ? 'idle' as const
              : research.status === 'awaiting_input' ||
                  (research.status as string) === 'needs_input' ||
                  research.status === 'complete' ||
                  research.status === 'error'
              ? research.status
              : 'idle' as const,
          caseKey: research.caseKey.slice(0, 120),
          questions: Array.isArray(research.questions)
            ? research.questions.filter((question): question is string => typeof question === 'string').slice(0, 3)
            : [],
          fallback: research.fallback === true,
        }
      : undefined
  return {
    ...base,
    ...session,
    // Penumbra is now the sole research path; normalize legacy persisted sessions.
    searchMode: 'penumbra',
    penumbraAcknowledged: session.penumbraAcknowledged === true,
    penumbraResearch: normalizedResearch,
    confirmedSearchQuery: session.confirmedSearchQuery ?? '',
    reformulationOutcome: session.reformulationOutcome ?? 'none',
    styleTranslatedQuery: session.styleTranslatedQuery ?? '',
    searchContextTokens: session.searchContextTokens ?? [],
    searchIntent: session.searchIntent ?? 'unknown',
    abPrimaryMetric: session.abPrimaryMetric ?? 'unset',
    confirmedUserRole: session.confirmedUserRole ?? 'unset',
    ukTaxonomyL1: session.ukTaxonomyL1 ?? '',
    ukTaxonomyL2: session.ukTaxonomyL2 ?? '',
    ukTaxonomyPackId: session.ukTaxonomyPackId ?? '',
    ukTaxonomyConfidence: session.ukTaxonomyConfidence ?? 0,
    authorityAnswers: session.authorityAnswers ?? [],
    authorityHits: session.authorityHits ?? [],
    authorityAuditOk: session.authorityAuditOk ?? false,
  }
}

function initialFromStorage(initialStory = ''): {
  session: SessionState
  view: View
  shouldAutoRun: boolean
} {
  const story = initialStory.trim()
  const stored = loadPersisted()

  // Deep-link ?q= wins over a stale local session (e.g. yesterday's case still in OSLAW).
  if (story) {
    if (stored && persistedLooksLikeStory(stored.session, story)) {
      const view =
        stored.view === 'services' || stored.view === 'notes' || stored.view === 'oslaw'
          ? stored.view
          : 'intake'
      return { session: normalizeSession(stored.session), view, shouldAutoRun: false }
    }
    clearPersisted()
    return { session: createInitialSession(), view: 'intake', shouldAutoRun: true }
  }

  if (stored) {
    const view =
      stored.view === 'services' || stored.view === 'notes' || stored.view === 'oslaw'
        ? stored.view
        : 'intake'
    return { session: normalizeSession(stored.session), view, shouldAutoRun: false }
  }
  return { session: createInitialSession(), view: 'intake', shouldAutoRun: false }
}

function shouldRunMasterPipeline(
  answeredId: string,
  value: string,
  prev: SessionState,
): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 12) return false

  // Opening account — always compile the first story.
  if (answeredId === 'open') return trimmed.length >= 20

  // Huge new paste (user dumped more chronology) — re-run agents once.
  if (trimmed.length >= 220 && /[.!?]/.test(trimmed)) return true

  // First real narrative after a tiny opener.
  if ((prev.whatHappened || '').trim().length < 40 && trimmed.length >= 100) return true

  // Short clarifiers / chip answers — heuristic only (no 60s master).
  return false
}

type CoherenceAppProps = {
  /** Prefill / auto-run when arriving via ?q= (classic search deep-link). */
  initialStory?: string
}

export default function CoherenceApp({ initialStory = '' }: CoherenceAppProps) {
  const { requireCoherenceAuth, emailVerified, authRequired, user } = useCoherenceAuth()
  const boot = useMemo(() => initialFromStorage(initialStory), [])
  const [session, setSession] = useState<SessionState>(boot.session)
  const [view, setView] = useState<View>(boot.view)
  const pageHistoryRef = useRef<View[]>([boot.view])
  const pageIndexRef = useRef(0)
  const [, setPageNavigationVersion] = useState(0)
  const [selectedNode, setSelectedNode] = useState<string | undefined>()
  const [llmConfigured, setLlmConfigured] = useState(false)
  const [llmStatusReady, setLlmStatusReady] = useState(false)
  const [llmBusy, setLlmBusy] = useState(false)
  const [overviewPending, setOverviewPending] = useState(false)
  const [llmEnhancing, setLlmEnhancing] = useState(false)
  const [llmPhase, setLlmPhase] = useState<'idle' | 'compiling' | 'grounding' | 'sharpening'>('idle')
  const [skipEnhance, setSkipEnhance] = useState(false)
  const [addingDetail, setAddingDetail] = useState(false)
  const [notesAutoDownload, setNotesAutoDownload] = useState(false)
  const [lawyer, setLawyer] = useState<LawyerSession | null>(() => loadLawyerSession())
  const [selectedSraId, setSelectedSraId] = useState<string | null>(null)
  const [helpMatch, setHelpMatch] = useState<HelpMatchResult | null>(null)
  const [matterInspector, setMatterInspector] = useState<MasterResult['matterInspector']>(null)
  /** Matching Help / OSLAW deferred until matter is classified. */
  const [resumeSearchAfterMatter, setResumeSearchAfterMatter] = useState<SearchDestination | null>(null)
  const [enrichingSearch, setEnrichingSearch] = useState(false)
  const [answerPackage, setAnswerPackage] = useState<AnswerPackage | null>(null)
  const [pendingFollowUp, setPendingFollowUp] = useState<AnswerFollowUp | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [penumbraBusy, setPenumbraBusy] = useState(false)
  const masterInFlightRef = useRef(false)
  const penumbraInFlightRef = useRef(false)
  const masterRanRef = useRef(boot.session.rawInputs.length > 0)
  const autoStartedRef = useRef(false)
  const shouldAutoRunRef = useRef(boot.shouldAutoRun)
  const lastStoryRef = useRef(initialStory.trim())

  function resetPageNavigation(nextView: View) {
    pageHistoryRef.current = [nextView]
    pageIndexRef.current = 0
    setPageNavigationVersion((version) => version + 1)
    setView(nextView)
  }

  function navigatePage(nextView: View) {
    const current = pageHistoryRef.current[pageIndexRef.current]
    if (current === nextView) return
    const nextHistory = pageHistoryRef.current.slice(0, pageIndexRef.current + 1)
    nextHistory.push(nextView)
    pageHistoryRef.current = nextHistory
    pageIndexRef.current = nextHistory.length - 1
    setPageNavigationVersion((version) => version + 1)
    setView(nextView)
  }

  function goToPreviousPage() {
    if (pageIndexRef.current === 0) return
    pageIndexRef.current -= 1
    setPageNavigationVersion((version) => version + 1)
    setView(pageHistoryRef.current[pageIndexRef.current])
  }

  function goToNextPage() {
    if (pageIndexRef.current >= pageHistoryRef.current.length - 1) return
    pageIndexRef.current += 1
    setPageNavigationVersion((version) => version + 1)
    setView(pageHistoryRef.current[pageIndexRef.current])
  }

  const pageNavigation = {
    canGoBack: pageIndexRef.current > 0,
    canGoForward: pageIndexRef.current < pageHistoryRef.current.length - 1,
    onBack: goToPreviousPage,
    onForward: goToNextPage,
  }

  const heuristicPrompt = useMemo(() => nextPrompt(session), [session])
  const [prompt, setPrompt] = useState<Prompt>(heuristicPrompt)
  const turnKey = `${heuristicPrompt.id}|${session.answeredPromptIds.length}|${session.rawInputs.length}`

  useEffect(() => {
    void getLlmStatus().then((s) => {
      setLlmConfigured(s.configured)
      setLlmStatusReady(true)
    })
  }, [])

  // New ?q= (or changed q) replaces stale persisted OSLAW / intake.
  useEffect(() => {
    const story = initialStory.trim()
    if (story === lastStoryRef.current) return
    lastStoryRef.current = story
    const nextBoot = initialFromStorage(story)
    shouldAutoRunRef.current = nextBoot.shouldAutoRun
    autoStartedRef.current = false
    masterInFlightRef.current = false
    masterRanRef.current = nextBoot.session.rawInputs.length > 0
    setSession(nextBoot.session)
    resetPageNavigation(nextBoot.view)
    setPrompt(nextPrompt(nextBoot.session))
    setHelpMatch(null)
    setMatterInspector(null)
    setAnswerPackage(null)
    setPendingFollowUp(null)
    setAgentError(null)
    setResumeSearchAfterMatter(null)
    setSelectedNode(undefined)
    setLlmBusy(false)
    setLlmEnhancing(false)
    setLlmPhase('idle')
  }, [initialStory])

  useEffect(() => {
    if (view === 'lawyer-login' || view === 'lawyer-portal') return
    const persistView =
      view === 'sra-org' ? 'services' : view
    savePersisted(session, persistView)
  }, [session, view])

  useEffect(() => {
    // Master run owns the loading overlay — do not clear busy here.
    if (skipEnhance) {
      setSkipEnhance(false)
      return
    }
    // Penumbra owns the research questioning loop. Do not let the legacy
    // local question enhancer run before The Shaman has identified the real gaps.
    if (session.searchMode === 'penumbra') {
      // runPenumbraResearch sets an explicit running/question/ready prompt.
      // A session update during that request must not replace it with the
      // heuristic closed question (which also makes the input look disabled).
      if (penumbraBusy || penumbraInFlightRef.current) return
      setLlmEnhancing(false)
      setLlmPhase('idle')
      return
    }
    setPrompt(heuristicPrompt)
    if (masterInFlightRef.current) return

    if (
      heuristicPrompt.id === 'open' ||
      heuristicPrompt.id === 'complete' ||
      session.rawInputs.length === 0
    ) {
      setLlmEnhancing(false)
      setLlmPhase('idle')
      return
    }

    // Quiet sharpen — never full-screen; keep the timeline interactive.
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      if (masterInFlightRef.current) return
      setLlmEnhancing(true)
      setLlmPhase('sharpening')
      void enhanceQuestionWithLlm(session, heuristicPrompt, controller.signal)
        .then((enhanced) => {
          if (enhanced && !controller.signal.aborted) setPrompt(enhanced)
        })
        .finally(() => {
          if (!controller.signal.aborted && !masterInFlightRef.current) {
            setLlmEnhancing(false)
            setLlmPhase('idle')
          }
        })
    }, 120)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey])

  // When intake returns to questioning, leave the closing "add detail" mode
  useEffect(() => {
    if (heuristicPrompt.id !== 'complete') setAddingDetail(false)
  }, [heuristicPrompt.id])

  const options = useMemo(() => {
    if (penumbraBusy || session.rawInputs.length === 0) return []
    return predictiveOptions(prompt, session)
  }, [penumbraBusy, prompt, session])
  const progress = useMemo(() => computeProgress(session), [session])
  const serviceConfidence = useMemo(() => computeServiceConfidence(session), [session])
  const frames = useMemo(() => {
    if (session.rawInputs.length === 0) return []
    // While research dialogue is active, chips come from hypotheses (dialogue owns display).
    if (
      session.researchDialogue?.status === 'active' ||
      session.hypothesisProbe?.status === 'probing'
    ) {
      return framesFromHypotheses(
        session.researchDialogue?.set || session.hypothesisProbe?.set,
      ) as ReturnType<typeof proposeCoherentFrames>
    }
    if (session.matterType === 'unknown') return []
    return proposeCoherentFrames(session, 3)
  }, [session])

  const researchCompetitorNote = useMemo(() => {
    if (session.researchDialogue?.status !== 'active' && session.hypothesisProbe?.status !== 'probing') {
      return null
    }
    return researchingCompetitorLine(
      session.researchDialogue?.set || session.hypothesisProbe?.set,
    )
  }, [session.researchDialogue, session.hypothesisProbe])

  // Persist topic lock once frames resolve — not while dialogue still owns geometry.
  const frameKey = frames.map((f) => f.id).join('|')
  useEffect(() => {
    if (!frames.length) return
    if (
      session.researchDialogue?.status === 'active' ||
      session.hypothesisProbe?.status === 'probing'
    ) {
      return
    }
    const locked = applyTopicLockToSession(session, frames)
    if (locked.topicId && locked.topicId !== session.topicId) {
      setSession(locked)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional narrow deps
  }, [frameKey, session.topicId, session.rawInputs.length, session.researchDialogue?.status])

  const notesVisible = session.rawInputs.length > 0 || session.mode === 'dispute'
  const notesReady = isBriefReady(session, progress)
  const showModeFork = !session.answeredPromptIds.includes('mode_fork') && session.rawInputs.length === 0
  const closing = prompt.id === 'complete' && !addingDetail
  const servicesReady = serviceConfidence >= 0.75
  const overviewReady = isFinalOverviewPackage(answerPackage)
  const overviewLoading = (llmBusy && llmConfigured) || overviewPending

  /** Sole prompt setter while research dialogue is active — never pack clarify / nextPrompt. */
  function setDialoguePrompt(next: Prompt) {
    setSkipEnhance(true)
    setPrompt(next)
  }

  function penumbraRunningPrompt(): Prompt {
    return {
      id: 'penumbra_research_running',
      kind: 'closed',
      text: 'Researching your matter with the committed geometry…',
      reason: 'Matter frozen — Third Eye next.',
      options: [],
    }
  }

  async function handleAnswer(value: string) {
    setAddingDetail(false)
    setAgentError(null)
    const answeredId = prompt.id
    const followUp = pendingFollowUp
    setPendingFollowUp(null)

    if (answeredId === 'penumbra_research_running') return

    if (answeredId === 'penumbra_research_question') {
      const skipped = value === PENUMBRA_SKIP_QUESTION
      const next = {
        ...(skipped ? session : senseDetails(value, session)),
        answeredPromptIds: Array.from(new Set([...session.answeredPromptIds, answeredId])),
      }
      setSession(next)
      void runPenumbraResearch(
        skipped
          ? 'No additional information is available for that question. Skip it and continue the research using the facts already provided.'
          : value,
        next,
      )
      return
    }

    if (answeredId === 'penumbra_research_ready') {
      void applyPenumbraResearch(session)
      return
    }

    // Research dialogue answers: agent ask / wiki / update until late commit.
    const dialogueActive =
      session.researchDialogue?.status === 'active' ||
      session.hypothesisProbe?.status === 'probing'
    if (isResearchDialoguePromptId(answeredId) && dialogueActive) {
      let dialogue: ResearchDialogueState =
        session.researchDialogue ||
        fromHypothesisProbeCompat(session.hypothesisProbe!)
      dialogue = applyUserAnswerToDialogue(dialogue, answeredId, value)
      const story = [session.whatHappened, ...session.rawInputs.slice(-2), value]
        .filter(Boolean)
        .join('\n')
      try {
        const res = await fetch(resolveApiUrl('/api/coherence/research-dialogue/turn'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            story,
            dialogue,
            lastUserMessage: value,
          }),
        })
        if (res.ok) {
          const data = (await res.json()) as {
            dialogue?: ResearchDialogueState
            prompt?: Prompt | null
            committed?: boolean
            statusNote?: string
          }
          if (data.dialogue) dialogue = data.dialogue
          if (data.committed) {
            const committed = commitResearchDialogueToSession(
              {
                ...session,
                answeredPromptIds: Array.from(new Set([...session.answeredPromptIds, answeredId])),
                researchDialogue: dialogue,
                hypothesisProbe: toHypothesisProbeCompat(dialogue),
              },
              dialogue,
              value,
            )
            const next = committed.session
            const locked = applyTopicLockToSession(next, proposeCoherentFrames(next, 3))
            setMatterInspector(committed.inspector)
            setSession(locked)
            setDialoguePrompt(
              locked.penumbraResearch?.bundle ? nextPrompt(locked) : penumbraRunningPrompt(),
            )
            if (!locked.penumbraResearch?.bundle && locked.searchMode === 'penumbra') {
              const launch = () => {
                void runPenumbraResearch('', locked)
              }
              if (authRequired) requireCoherenceAuth(launch)
              else launch()
            }
            return
          }
          const probing: SessionState = {
            ...session,
            answeredPromptIds: Array.from(new Set([...session.answeredPromptIds, answeredId])),
            researchDialogue: {
              ...dialogue,
              statusNote: data.statusNote || dialogue.statusNote,
            },
            hypothesisProbe: toHypothesisProbeCompat(dialogue),
          }
          setSession(probing)
          setDialoguePrompt(data.prompt || dialogueFailurePrompt(probing, dialogue))
          return
        }
      } catch {
        // Agentic recovery — never pack clarify / nextPrompt.
      }
      const probing: SessionState = {
        ...session,
        answeredPromptIds: Array.from(new Set([...session.answeredPromptIds, answeredId])),
        researchDialogue: dialogue,
        hypothesisProbe: toHypothesisProbeCompat(dialogue),
      }
      setSession(probing)
      setDialoguePrompt(dialogueFailurePrompt(probing, dialogue))
      return
    }

    // Heuristic baseline immediately so UI stays responsive
    let next = senseDetails(value, session)
    next = applyGapAnswer(answeredId, value, next)
    if (followUp && value.trim()) {
      next = {
        ...next,
        feedbackHistory: [
          ...(session.feedbackHistory || []),
          {
            kind: followUp.kind,
            text: value.trim(),
            at: new Date().toISOString(),
          },
        ],
      }
      if (answerPackage?.answerOverview?.trim()) {
        next = {
          ...next,
          answerRevisionHistory: [
            ...(session.answerRevisionHistory || []),
            {
              kind: followUp.kind,
              answerOverview: answerPackage.answerOverview.slice(0, 4000),
              at: new Date().toISOString(),
            },
          ].slice(-5),
        }
      }
    }
    if (answeredId === 'goal' || answeredId === 'gap_goal' || answeredId === 'constraint_goal') {
      if (!isPhysicalNeedNotGoal(value) && !isMetaCauseLine(value)) {
        next = { ...next, goal: next.goal || value.trim() }
      }
    }

    // Fast pack classify (OpenRouter) on first story — before keyword topic lock hardens
    if (shouldRunPackClassify(next, answeredId) && value.trim().length >= 8) {
      const heuristic = heuristicSuggestPack(value)
      next = applyPackClassification(next, heuristic)
      try {
        const res = await fetch(resolveApiUrl('/api/coherence/llm/classify'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: value.trim() }),
        })
        if (res.ok) {
          const data = (await res.json()) as { classification?: PackClassification }
          if (data.classification?.packId) {
            next = applyPackClassification(next, data.classification)
          }
        }
      } catch {
        // Heuristic already applied
      }
    }

    const earlyFrames = proposeCoherentFrames(next, 3)
    // Topic lock waits until research dialogue commits — frames must not steal the ask.
    next = {
      ...next,
      answeredPromptIds: Array.from(new Set([...next.answeredPromptIds, answeredId])),
    }
    const framed = attachResolvedMatterFrame(next, value)
    next = framed.session
    setMatterInspector(framed.inspector)
    setSession(next)

    // Late freeze: start research dialogue (wiki + asks) — no Penumbra until commit.
    if (next.researchDialogue?.status === 'active' || next.hypothesisProbe?.status === 'probing') {
      if (session.rawInputs.length === 0 && value.trim()) {
        captureProductEvent('b2c_search_started', { search_mode: next.searchMode })
      }
      const dialogue =
        next.researchDialogue || fromHypothesisProbeCompat(next.hypothesisProbe!)
      try {
        const res = await fetch(resolveApiUrl('/api/coherence/research-dialogue/turn'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            story: value,
            dialogue,
            lastUserMessage: value,
          }),
        })
        if (res.ok) {
          const data = (await res.json()) as {
            dialogue?: ResearchDialogueState
            prompt?: Prompt | null
            committed?: boolean
            statusNote?: string
          }
          if (data.dialogue) {
            next = {
              ...next,
              researchDialogue: {
                ...data.dialogue,
                statusNote: data.statusNote || data.dialogue.statusNote,
              },
              hypothesisProbe: toHypothesisProbeCompat(data.dialogue),
            }
          }
          if (data.committed && data.dialogue) {
            const committed = commitResearchDialogueToSession(next, data.dialogue, value)
            next = committed.session
            next = applyTopicLockToSession(next, proposeCoherentFrames(next, 3))
            setMatterInspector(committed.inspector)
            setSession(next)
            setDialoguePrompt(
              next.penumbraResearch?.bundle ? nextPrompt(next) : penumbraRunningPrompt(),
            )
            if (!next.penumbraResearch?.bundle && next.searchMode === 'penumbra') {
              const launch = () => {
                void runPenumbraResearch('', next)
              }
              if (authRequired) requireCoherenceAuth(launch)
              else launch()
            }
            return
          }
          setSession(next)
          setDialoguePrompt(
            data.prompt ||
              dialogueFailurePrompt(next, next.researchDialogue || dialogue),
          )
          return
        }
      } catch {
        // Agentic recovery — never pack clarify.
      }
      setDialoguePrompt(dialogueFailurePrompt(next, next.researchDialogue || dialogue))
      return
    }

    const gate = sessionMatterGate(next)
    if (gate.status === 'needs_clarification' && !next.answeredPromptIds.includes('matter_gate')) {
      setDialoguePrompt(matterGatePrompt(next))
      return
    }

    setPrompt(nextPrompt(next))
    if (session.rawInputs.length === 0 && value.trim()) {
      captureProductEvent('b2c_search_started', { search_mode: next.searchMode })
    }

    // After matter clarify for Matching Help / OSLAW — resume destination once classified
    if (
      (answeredId === 'matter' || answeredId === 'matter_for_services') &&
      resumeSearchAfterMatter
    ) {
      const dest = resumeSearchAfterMatter
      setResumeSearchAfterMatter(null)
      if (next.matterType !== 'unknown') {
        if (next.reformulationOutcome === 'none' && next.rawInputs.length > 0) {
          const original = next.rawInputs.find((r) => r.trim().length >= 8)?.trim() || next.whatHappened.trim()
          void confirmSearchQuery(original, 'skipped', dest, next)
        } else {
          navigatePage(dest)
        }
        return
      }
    }

    // Penumbra only after research dialogue commit (late freeze).
    if (
      !followUp &&
      next.searchMode === 'penumbra' &&
      !next.penumbraResearch?.bundle &&
      (next.researchDialogue?.status === 'committed' ||
        next.hypothesisProbe?.status === 'committed')
    ) {
      const launch = () => {
        void runPenumbraResearch('', next)
      }
      if (authRequired) {
        requireCoherenceAuth(launch)
      } else {
        launch()
      }
      return
    }

    if (!llmConfigured) {
      // Keep the local-first loop usable when no LLM credentials are configured.
      if (followUp) navigatePage('oslaw')
      return
    }

    const runMasterPipeline = async () => {
      if (authRequired && user && !emailVerified) {
        setAgentError(
          'Verify your email before analysing your matter. Check your inbox or request a new verification link from account settings.',
        )
        return
      }

      const controller = new AbortController()
      masterInFlightRef.current = true
      setSkipEnhance(true)
      setLlmEnhancing(false)
      setLlmBusy(true)
      setLlmPhase('compiling')
      try {
        const phaseTimer = window.setTimeout(() => setLlmPhase('grounding'), 900)
        const sharpenTimer = window.setTimeout(() => setLlmPhase('sharpening'), 12_000)
        const analysisText = followUp
          ? `${sessionAnswerQuery(next, earlyFrames)}\n\nFollow-up request (${followUp.kind}): ${value.trim()}`
          : value
        const master = await runMasterOrchestrate(
          next,
          analysisText,
          nextPrompt(next),
          controller.signal,
          'intake',
          followUp
            ? {
                kind: followUp.kind,
                text: value.trim(),
                priorAnswer: answerPackage?.answerOverview,
              }
            : undefined,
        )
        window.clearTimeout(phaseTimer)
        window.clearTimeout(sharpenTimer)

        if (master?.error) {
          setSkipEnhance(false)
          if (master.error === 'auth_required') {
            requireCoherenceAuth(() => {
              void runMasterPipeline()
            })
            return
          }
          if (master.error === 'email_verification_required') {
            setAgentError('Verify your email before analysing your matter.')
            return
          }
          if (
            master.error === 'daily_quota' ||
            master.error === 'minute_quota' ||
            master.error === 'monthly_search_quota'
          ) {
            setAgentError(
              master.error === 'monthly_search_quota'
                ? 'You have used your 5 free searches this month. Upgrade to The Shaman Unlimited for £3.49 every 4 weeks.'
                : 'Daily or per-minute search limit reached. Try again later.',
            )
            return
          }
          setAgentError(master.message || 'Agent request failed. Please try again.')
          return
        }

        if (!master?.brief) {
          setSkipEnhance(false)
          setAgentError(
            'Agents did not return a brief — check OpenRouter credits/model, then try Continue again.',
          )
          return
        }

        masterRanRef.current = true
        let merged = applyMasterToSession(next, master, value)
        merged = {
          ...merged,
          answeredPromptIds: Array.from(new Set([...merged.answeredPromptIds, answeredId])),
        }
        clarifiersForSession(merged)
        setSession(merged)
        if (master.helpMatch) setHelpMatch(master.helpMatch)
        setMatterInspector(master.matterInspector ?? null)

        if (master.answerPackage && isFinalOverviewPackage(master.answerPackage as AnswerPackage)) {
          setAnswerPackage(master.answerPackage as AnswerPackage)
          setOverviewPending(false)
        } else {
          // Unlock the intake UI first — synthesise overview in the background
          // (hourglass on the OSLAW card) instead of holding the full-screen loader.
          setAnswerPackage(null)
          setOverviewPending(true)
          const framesForOverview = proposeCoherentFrames(merged, 3)
          void fetchRetrieveAnswer(
            merged,
            framesForOverview,
            followUp
              ? {
                  kind: followUp.kind,
                  text: value.trim(),
                  priorAnswer: answerPackage?.answerOverview,
                }
              : undefined,
            merged.penumbraResearch?.bundle,
          )
            .then((retrieved) => {
              if (retrieved?.answerPackage && isFinalOverviewPackage(retrieved.answerPackage)) {
                setAnswerPackage(retrieved.answerPackage)
              }
            })
            .finally(() => setOverviewPending(false))
        }

        if (master.ask?.text) {
          setSkipEnhance(true)
          setPrompt({
            id: master.ask.id || 'master_ask',
            kind: master.ask.kind === 'closed' ? 'closed' : 'open',
            text: master.ask.text,
            reason: master.ask.reason,
            options: master.ask.options,
          })
        } else {
          setSkipEnhance(false)
          setPrompt(nextPrompt(merged))
        }
      } catch {
        setSkipEnhance(false)
        setOverviewPending(false)
        setAgentError('Agent request failed or was interrupted. Please try again.')
      } finally {
        masterInFlightRef.current = false
        setLlmBusy(false)
        setLlmPhase('idle')
      }
    }

    // Full master is expensive (~30–70s). Only on opening / large new story dumps.
    if (!followUp && !shouldRunMasterPipeline(answeredId, value, session)) {
      return
    }
    if (!followUp && masterRanRef.current && value.trim().length < 220) {
      return
    }

    if (authRequired) {
      requireCoherenceAuth(() => {
        void runMasterPipeline()
      })
      return
    }

    void runMasterPipeline()
  }

  function handleFollowUp(followUp: AnswerFollowUp) {
    setPendingFollowUp(followUp)
    setAnswerPackage(null)
    setAgentError(null)
    navigatePage('intake')
    setAddingDetail(followUp.kind === 'add_detail')
    setPrompt({
      id: `feedback_${followUp.id}`,
      kind: 'open',
      text: followUp.prompt,
      reason: 'Your response will be added to the case and used to refine the guidance.',
    })
  }

  // Deep-link: /ask-the-shaman?q=… should run Coherence intake, not sit ignored.
  useEffect(() => {
    const story = initialStory.trim()
    if (!llmStatusReady || !story || autoStartedRef.current) return
    if (!shouldAutoRunRef.current) return
    autoStartedRef.current = true
    shouldAutoRunRef.current = false
    resetPageNavigation('intake')
    setHelpMatch(null)
    setMatterInspector(null)
    setAnswerPackage(null)
    setAgentError(null)
    void handleAnswer(story)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmStatusReady, initialStory])

  function openNotes(download = false) {
    setNotesAutoDownload(download)
    navigatePage('notes')
  }

  function requestSearch(destination: SearchDestination) {
    // Penumbra must research the user's story before asking for any
    // classification. Matching Help can use the evidence-based routing lens
    // while The Shaman is still completing its curated-first pass.
    if (session.searchMode === 'penumbra' && session.rawInputs.length > 0) {
      if (!session.penumbraResearch?.bundle && !penumbraInFlightRef.current) {
        void runPenumbraResearch('', session)
      }
      navigatePage(destination)
      return
    }

    // Empty solicitor packs are a product signal when matter is unknown — ask once first
    if (
      session.matterType === 'unknown' &&
      !session.answeredPromptIds.includes('matter_for_services')
    ) {
      setResumeSearchAfterMatter(destination)
      navigatePage('intake')
      setSkipEnhance(true)
      setPrompt(
        session.answeredPromptIds.includes('matter')
          ? matterClassifierPrompt(session, 'matter_for_services')
          : matterClassifierPrompt(session, 'matter'),
      )
      return
    }
    if (session.reformulationOutcome === 'none' && session.rawInputs.length > 0) {
      const original =
        session.rawInputs.find((r) => r.trim().length >= 8)?.trim() ||
        session.whatHappened.trim() ||
        ''
      void confirmSearchQuery(original, 'skipped', destination)
      return
    }
    navigatePage(destination)
  }

  async function confirmSearchQuery(
    query: string,
    outcome: SessionState['reformulationOutcome'],
    destination: SearchDestination,
    sourceSession: SessionState = session,
  ) {
    setEnrichingSearch(true)
    try {
      let next: SessionState = {
        ...sourceSession,
        confirmedSearchQuery: query,
        reformulationOutcome: outcome,
      }
      const profile = buildSearchContextProfile(next)
      const style = await styleTranslateForRetrieval(next, profile)
      next = {
        ...next,
        styleTranslatedQuery: style.retrieval,
        searchContextTokens: profile.tokens,
        searchIntent: profile.intent,
        abPrimaryMetric: profile.abPrimaryMetric,
      }
      setSession(next)
      navigatePage(destination)
    } finally {
      setEnrichingSearch(false)
    }
  }

  function chooseMode(mode: Mode) {
    setSession((prev) => {
      const next = {
        ...prev,
        mode,
        answeredPromptIds: Array.from(new Set([...prev.answeredPromptIds, 'mode_fork'])),
      }
      setPrompt(nextPrompt(next))
      return next
    })
  }

  function chooseSearchMode(searchMode: SearchMode) {
    if (searchMode !== 'penumbra') return
    setSession((prev) => ({ ...prev, searchMode: 'penumbra' }))
    setAnswerPackage(null)
  }

  function acknowledgePenumbra() {
    setSession((prev) => ({ ...prev, penumbraAcknowledged: true }))
  }

  async function runPenumbraResearch(message = '', sourceSession: SessionState = session) {
    if (sourceSession.searchMode !== 'penumbra' || penumbraInFlightRef.current) return
    penumbraInFlightRef.current = true
    setPenumbraBusy(true)
    setSkipEnhance(true)
    setPrompt({
      id: 'penumbra_research_running',
      kind: 'open',
      text: 'Third Eye is researching your case before asking for more detail.',
      reason: 'The Shaman is reviewing curated Legal Shaman sources first, then checking wider public sources for genuine gaps.',
    })
    const current = sourceSession.penumbraResearch
    const researchState = {
      status: 'starting' as const,
      caseKey: current?.caseKey || newPenumbraCaseKey(),
      conversationId: current?.conversationId,
      questions: current?.questions || [],
      bundle: current?.bundle,
      fallback: current?.fallback,
      updatedAt: new Date().toISOString(),
    }
    const requestSession = { ...sourceSession, penumbraResearch: researchState }
    setSession(requestSession)
    try {
      // Use Aramb's awaited run contract here. The SDK's WebSocket streaming
      // path is unreliable when the agent invokes research capabilities; the
      // server still exposes a clear running state while this request completes.
      const result = await requestPenumbraResearch(requestSession, { message, stream: false })
      if (!result) throw new Error('aramb_research_unavailable')
      const nextSession = {
        ...requestSession,
        penumbraResearch: {
          ...researchState,
          status: result.status === 'needs_input' ? 'awaiting_input' : 'complete',
          conversationId: result.conversationId,
          questions: result.questions,
          bundle: result.bundle,
          fallback: result.fallback === true,
          cacheHit: result.cacheHit === true,
          exaSource: result.exaSource,
          updatedAt: new Date().toISOString(),
        },
      }
      setSession(nextSession)
      if (result.questions.length > 0) {
        setSkipEnhance(true)
        setPrompt({
          id: 'penumbra_research_question',
          kind: 'open',
          text: result.questions[0],
          reason: 'The Shaman reviewed the curated sources and identified this missing fact before the grounded answer is prepared.',
          options: [{
            id: 'penumbra-skip-question',
            label: 'Skip this question and continue',
            value: PENUMBRA_SKIP_QUESTION,
          }],
        })
      } else {
        setSkipEnhance(true)
        navigatePage('oslaw')
        void applyPenumbraResearch(nextSession)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'aramb_research_failed'
      if (error instanceof Error && error.message === 'monthly_search_quota') {
        setAgentError('You have used your 5 free searches this month. Upgrade to The Shaman Unlimited for £3.49 every 4 weeks.')
      }
      setSession((prev) => ({
        ...prev,
        penumbraResearch: {
          ...researchState,
          status: 'error',
          error: errorMessage,
          updatedAt: new Date().toISOString(),
        },
      }))
      setPrompt({
        id: 'penumbra_research_error',
        kind: 'closed',
        text: 'Third Eye research stopped before it completed.',
        reason: 'Your case information is still saved. Run Third Eye again to retry the research pass.',
      })
    } finally {
      penumbraInFlightRef.current = false
      setPenumbraBusy(false)
    }
  }

  async function applyPenumbraResearch(sourceSession: SessionState = session) {
    const bundle = sourceSession.penumbraResearch?.bundle
    if (sourceSession.searchMode !== 'penumbra' || !bundle) return
    navigatePage('oslaw')
    setOverviewPending(true)
    setAgentError(null)
    try {
      const result = await fetchRetrieveAnswer(
        sourceSession,
        proposeCoherentFrames(sourceSession, 3),
        undefined,
        bundle,
      )
      if (!result?.answerPackage) throw new Error('final_synthesis_unavailable')
      setAnswerPackage(result.answerPackage)
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'final_synthesis_unavailable')
    } finally {
      setOverviewPending(false)
    }
  }

  function updateEvent(id: string, patch: Partial<Pick<TimelineEvent, 'label' | 'dateApprox'>>) {
    setSession((prev) => ({
      ...prev,
      events: prev.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
  }

  function deleteEvent(id: string) {
    setSession((prev) => ({ ...prev, events: prev.events.filter((e) => e.id !== id) }))
    setSelectedNode(undefined)
  }

  function moveEvent(id: string, dir: -1 | 1) {
    setSession((prev) => {
      const idx = prev.events.findIndex((e) => e.id === id)
      if (idx < 0) return prev
      const nextIdx = idx + dir
      if (nextIdx < 0 || nextIdx >= prev.events.length) return prev
      const events = [...prev.events]
      const [item] = events.splice(idx, 1)
      events.splice(nextIdx, 0, item)
      return { ...prev, events }
    })
  }

  function restart() {
    clearPersisted()
    const fresh = createInitialSession()
    masterInFlightRef.current = false
    masterRanRef.current = false
    setSession(fresh)
    setHelpMatch(null)
    setMatterInspector(null)
    setAnswerPackage(null)
    setPenumbraBusy(false)
    setPendingFollowUp(null)
    setAgentError(null)
    resetPageNavigation('intake')
    setSelectedNode(undefined)
    setPrompt(nextPrompt(fresh))
    setLlmBusy(false)
    setLlmEnhancing(false)
    setLlmPhase('idle')
  }

  if (view === 'sra-org' && selectedSraId) {
    return (
      <SraOrganisationView
        sraId={selectedSraId}
        onBack={() => navigatePage('services')}
      />
    )
  }

  if (view === 'services') {
    return (
      <ServicesView
        session={session}
        frames={frames}
        helpMatch={helpMatch}
        onBack={() => navigatePage('intake')}
        onOpenSraFirm={(sraId) => {
          setSelectedSraId(sraId)
          navigatePage('sra-org')
        }}
        pageNavigation={pageNavigation}
      />
    )
  }

  if (view === 'oslaw') {
    return (
      <OslawView
        session={session}
        frames={frames}
        masterAnswerPackage={answerPackage}
        overviewLoading={overviewLoading}
        onBack={() => navigatePage('intake')}
        onFindHelp={() => requestSearch('services')}
        onFollowUp={handleFollowUp}
        searchMode={session.searchMode}
        onStartPenumbraResearch={(message) => {
          if (authRequired) {
            requireCoherenceAuth(() => {
              void runPenumbraResearch(message)
            })
          } else {
            void runPenumbraResearch(message)
          }
        }}
        onUsePenumbraResearch={() => {
          if (authRequired) {
            requireCoherenceAuth(() => {
              void applyPenumbraResearch()
            })
          } else {
            void applyPenumbraResearch()
          }
        }}
        pageNavigation={pageNavigation}
      />
    )
  }

  if (view === 'notes') {
    return (
      <LawyerNotes
        session={session}
        progress={progress}
        frames={frames}
        autoDownload={notesAutoDownload}
        audience="client"
        onBack={() => {
          setNotesAutoDownload(false)
          navigatePage('intake')
        }}
        pageNavigation={pageNavigation}
      />
    )
  }

  if (view === 'lawyer-login') {
    return (
      <LawyerLogin
        onSignedIn={(s) => {
          setLawyer(s)
          navigatePage('lawyer-portal')
        }}
        onBackToClient={() => navigatePage('intake')}
      />
    )
  }

  if (view === 'lawyer-portal') {
    if (!lawyer) {
      return (
        <LawyerLogin
          onSignedIn={(s) => {
            setLawyer(s)
            navigatePage('lawyer-portal')
          }}
          onBackToClient={() => navigatePage('intake')}
        />
      )
    }
    return (
      <LawyerPortal
        lawyer={lawyer}
        liveSession={session}
        liveProgress={progress}
        liveFrames={frames}
        onSignedOut={() => {
          setLawyer(null)
          navigatePage('lawyer-login')
        }}
        onBackToClient={() => navigatePage('intake')}
      />
    )
  }

  return (
    <div className="shell">
      {llmBusy ? <LoadingScreen phase={llmPhase} /> : null}
      <div className="shell__brand">
        <span className="shell__mark">Ask the Shaman</span>
        <span className="shell__product">
          Chronology intake
          {llmBusy
            ? llmPhase === 'compiling'
              ? ' · reading brief…'
              : llmPhase === 'grounding'
                ? ' · checking results…'
                : llmPhase === 'sharpening'
                  ? ' · synthesising overview…'
                  : ' · sharpening…'
            : llmEnhancing
              ? ' · refining question…'
              : llmConfigured
                ? ' · ready'
                : ' · offline mode'}
          {session.rawInputs.length > 0 || session.answeredPromptIds.includes('mode_fork') ? (
            <>
              {' · '}
              <button type="button" className="shell__restart" onClick={restart}>
                Restart
              </button>
            </>
          ) : null}
          {' · '}
          <button
            type="button"
            className="shell__solicitor"
            onClick={() => navigatePage(lawyer ? 'lawyer-portal' : 'lawyer-login')}
          >
            Solicitor login
          </button>
        </span>
      </div>
      <B2CBillingBanner />
      <PageNavigation {...pageNavigation} />
      {agentError ? (
        <p role="alert" className="agent-error">
          {agentError}
        </p>
      ) : null}
      {session.researchDialogue?.statusNote && session.researchDialogue.status === 'active' ? (
        <p className="research-dialogue-note" aria-live="polite">
          {session.researchDialogue.statusNote}
        </p>
      ) : null}
      {researchCompetitorNote ? (
        <p className="research-dialogue-competitors" aria-live="polite">
          {researchCompetitorNote}
        </p>
      ) : null}

      <Timeline
        session={session}
        activeId={selectedNode}
        onSelect={setSelectedNode}
        onUpdateEvent={updateEvent}
        onDeleteEvent={deleteEvent}
        onMoveEvent={moveEvent}
        onUpdateGoal={(goal) => setSession((prev) => ({ ...prev, goal }))}
      />

      <FrameChips frames={frames} />

      {showModeFork && (
        <ModeFork
          onChoose={chooseMode}
          searchMode={session.searchMode}
          penumbraAcknowledged={session.penumbraAcknowledged}
          onSearchMode={chooseSearchMode}
          onAcknowledgePenumbra={acknowledgePenumbra}
        />
      )}

      <main className="shell__main">
        {closing ? (
          <ClosingNextSteps
            servicesReady={servicesReady}
            preferOslaw={session.mode === 'research'}
            overviewReady={overviewReady || !llmConfigured}
            overviewLoading={overviewLoading || enrichingSearch}
            onOslaw={() => requestSearch('oslaw')}
            onFindHelp={() => requestSearch('services')}
            onDownloadNotes={() => openNotes(true)}
            onAddDetail={() => setAddingDetail(true)}
          />
        ) : (
          <>
            <PenumbraStatusBanner research={session.penumbraResearch} busy={penumbraBusy} />
            <PromptBlock
              text={
                addingDetail
                  ? 'What else should we add to your timeline or notes?'
                  : prompt.text
              }
              kind={addingDetail ? 'open' : prompt.kind}
              reason={
                addingDetail
                  ? 'Optional — then we’ll bring you back to the next-step choices.'
                  : prompt.reason
              }
            />
            {!addingDetail && (
              <PredictiveOptions options={options} onSelect={handleAnswer} kind={prompt.kind} />
            )}
            {/* Background synthesis must not prevent the user drafting the next answer. */}
            <InputBar
              onSubmit={handleAnswer}
              // Keep answers typeable whenever a question is visible. Only
              // the explicit research-running state should temporarily block
              // submission while the handoff prompt is being replaced.
              disabled={penumbraBusy && prompt.id === 'penumbra_research_running'}
            />
          </>
        )}
      </main>

      {view === 'intake' && matterInspector ? (
        <div className="coherence-matter-inspector-wrap px-4 pb-2 md:px-6">
          <MatterFrameInspector inspector={matterInspector} />
        </div>
      ) : null}

      <ProgressFooter
        progress={progress}
        serviceConfidence={serviceConfidence}
        notesVisible={notesVisible}
        notesReady={notesReady}
        closing={closing || prompt.id === 'complete'}
        onShowServices={() => requestSearch('services')}
        onShowNotes={() => openNotes(false)}
      />
      <PageNavigation {...pageNavigation} />
    </div>
  )
}
