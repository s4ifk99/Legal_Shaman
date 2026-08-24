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
import { ReformulationGate, type SearchDestination } from './ReformulationGate'
import { createInitialSession, senseDetails } from '@/lib/coherence/sense'
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
import { isFinalOverviewPackage, fetchRetrieveAnswer } from '@/lib/coherence/retrieveAnswer'
import { useCoherenceAuth } from '@/lib/auth/use-coherence-auth'
import { MatterFrameInspector } from './MatterFrameInspector'
import type { AnswerPackage } from '@/lib/coherence/answerPackage'
import { proposeCoherentFrames } from '@/lib/coherence/frames'
import { clearPersisted, loadPersisted, savePersisted } from '@/lib/coherence/persist'
import { loadLawyerSession, type LawyerSession } from '@/lib/coherence/lawyerAuth'
import { buildSearchContextProfile } from '@/lib/coherence/searchContext'
import { styleTranslateForRetrieval } from '@/lib/coherence/styleTranslation'
import type { Mode, Party, Prompt, SessionState, TimelineEvent } from '@/lib/coherence/types'
import './CoherenceApp.css'

type View = 'intake' | 'services' | 'notes' | 'oslaw' | 'lawyer-login' | 'lawyer-portal' | 'sra-org'

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
      return {
        ...next,
        howCaused: next.howCaused ? `${next.howCaused}; ${v}` : v,
        events: pushEvent(next.events, `Mechanism: ${summariseToLabel(v, 56)}`, v),
      }
    case 'gap_breach':
    case 'gap_refusal_reason':
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
      return next
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
  return {
    ...base,
    ...session,
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
  const [pendingSearch, setPendingSearch] = useState<SearchDestination | null>(null)
  /** Matching Help / OSLAW deferred until matter is classified. */
  const [resumeSearchAfterMatter, setResumeSearchAfterMatter] = useState<SearchDestination | null>(null)
  const [enrichingSearch, setEnrichingSearch] = useState(false)
  const [answerPackage, setAnswerPackage] = useState<AnswerPackage | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const masterInFlightRef = useRef(false)
  const masterRanRef = useRef(boot.session.rawInputs.length > 0)
  const autoStartedRef = useRef(false)
  const shouldAutoRunRef = useRef(boot.shouldAutoRun)
  const lastStoryRef = useRef(initialStory.trim())

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
    setView(nextBoot.view)
    setPrompt(nextPrompt(nextBoot.session))
    setHelpMatch(null)
    setMatterInspector(null)
    setAnswerPackage(null)
    setAgentError(null)
    setPendingSearch(null)
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
    setPrompt(heuristicPrompt)
    // Master run owns the loading overlay — do not clear busy here.
    if (skipEnhance) {
      setSkipEnhance(false)
      return
    }
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
    if (session.rawInputs.length === 0) return []
    return predictiveOptions(prompt, session)
  }, [prompt, session])
  const progress = useMemo(() => computeProgress(session), [session])
  const serviceConfidence = useMemo(() => computeServiceConfidence(session), [session])
  const frames = useMemo(() => {
    if (session.matterType === 'unknown' || session.rawInputs.length === 0) return []
    // Phase 3 local fit (story-only here; wiki enrich happens in notes/services)
    return proposeCoherentFrames(session, 3)
  }, [session])
  const notesVisible = session.rawInputs.length > 0 || session.mode === 'dispute'
  const notesReady = isBriefReady(session, progress)
  const showModeFork = !session.answeredPromptIds.includes('mode_fork') && session.rawInputs.length === 0
  const closing = prompt.id === 'complete' && !addingDetail
  const servicesReady = serviceConfidence >= 0.75
  const overviewReady = isFinalOverviewPackage(answerPackage)
  const overviewLoading = (llmBusy && llmConfigured) || overviewPending

  async function handleAnswer(value: string) {
    setAddingDetail(false)
    setAgentError(null)
    const answeredId = prompt.id

    // Heuristic baseline immediately so UI stays responsive
    let next = senseDetails(value, session)
    next = applyGapAnswer(answeredId, value, next)
    if (answeredId === 'goal' || answeredId === 'gap_goal' || answeredId === 'constraint_goal') {
      next = { ...next, goal: next.goal || value.trim() }
    }
    next = {
      ...next,
      answeredPromptIds: Array.from(new Set([...next.answeredPromptIds, answeredId])),
    }
    setSession(next)
    setPrompt(nextPrompt(next))

    // After matter clarify for Matching Help / OSLAW — resume destination once classified
    if (
      (answeredId === 'matter' || answeredId === 'matter_for_services') &&
      resumeSearchAfterMatter
    ) {
      const dest = resumeSearchAfterMatter
      setResumeSearchAfterMatter(null)
      if (next.matterType !== 'unknown') {
        if (next.reformulationOutcome === 'none' && next.rawInputs.length > 0) {
          setPendingSearch(dest)
        } else {
          setPendingSearch(null)
          setView(dest)
        }
        return
      }
    }

    if (!llmConfigured) return

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
        const master = await runMasterOrchestrate(
          next,
          value,
          nextPrompt(next),
          controller.signal,
          'intake',
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
          if (master.error === 'daily_quota' || master.error === 'minute_quota') {
            setAgentError('Daily or per-minute search limit reached. Try again later.')
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
          void fetchRetrieveAnswer(merged, framesForOverview)
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
    if (!shouldRunMasterPipeline(answeredId, value, session)) {
      return
    }
    if (masterRanRef.current && value.trim().length < 220) {
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

  // Deep-link: /ask-the-shaman?q=… should run Coherence intake, not sit ignored.
  useEffect(() => {
    const story = initialStory.trim()
    if (!llmStatusReady || !story || autoStartedRef.current) return
    if (!shouldAutoRunRef.current) return
    autoStartedRef.current = true
    shouldAutoRunRef.current = false
    setView('intake')
    setHelpMatch(null)
    setMatterInspector(null)
    setAnswerPackage(null)
    setAgentError(null)
    void handleAnswer(story)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llmStatusReady, initialStory])

  function openNotes(download = false) {
    setNotesAutoDownload(download)
    setPendingSearch(null)
    setView('notes')
  }

  function requestSearch(destination: SearchDestination) {
    // Empty solicitor packs are a product signal when matter is unknown — ask once first
    if (
      session.matterType === 'unknown' &&
      !session.answeredPromptIds.includes('matter_for_services')
    ) {
      setResumeSearchAfterMatter(destination)
      setPendingSearch(null)
      setView('intake')
      setSkipEnhance(true)
      setPrompt(
        session.answeredPromptIds.includes('matter')
          ? matterClassifierPrompt(session, 'matter_for_services')
          : matterClassifierPrompt(session, 'matter'),
      )
      return
    }
    if (session.reformulationOutcome === 'none' && session.rawInputs.length > 0) {
      setPendingSearch(destination)
      return
    }
    setPendingSearch(null)
    setView(destination)
  }

  async function confirmSearchQuery(
    query: string,
    outcome: SessionState['reformulationOutcome'],
  ) {
    const destination = pendingSearch || 'services'
    setEnrichingSearch(true)
    try {
      let next: SessionState = {
        ...session,
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
      setPendingSearch(null)
      setView(destination)
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
    setAgentError(null)
    setView('intake')
    setSelectedNode(undefined)
    setPendingSearch(null)
    setPrompt(nextPrompt(fresh))
    setLlmBusy(false)
    setLlmEnhancing(false)
    setLlmPhase('idle')
  }

  if (view === 'sra-org' && selectedSraId) {
    return (
      <SraOrganisationView
        sraId={selectedSraId}
        onBack={() => setView('services')}
      />
    )
  }

  if (view === 'services') {
    return (
      <ServicesView
        session={session}
        frames={frames}
        helpMatch={helpMatch}
        onBack={() => setView('intake')}
        onOpenSraFirm={(sraId) => {
          setSelectedSraId(sraId)
          setView('sra-org')
        }}
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
        onBack={() => setView('intake')}
        onFindHelp={() => requestSearch('services')}
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
          setView('intake')
        }}
      />
    )
  }

  if (view === 'lawyer-login') {
    return (
      <LawyerLogin
        onSignedIn={(s) => {
          setLawyer(s)
          setView('lawyer-portal')
        }}
        onBackToClient={() => setView('intake')}
      />
    )
  }

  if (view === 'lawyer-portal') {
    if (!lawyer) {
      return (
        <LawyerLogin
          onSignedIn={(s) => {
            setLawyer(s)
            setView('lawyer-portal')
          }}
          onBackToClient={() => setView('intake')}
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
          setView('lawyer-login')
        }}
        onBackToClient={() => setView('intake')}
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
            onClick={() => setView(lawyer ? 'lawyer-portal' : 'lawyer-login')}
          >
            Solicitor login
          </button>
        </span>
      </div>
      {agentError ? (
        <p role="alert" className="agent-error">
          {agentError}
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

      {showModeFork && <ModeFork onChoose={chooseMode} />}

      <main className="shell__main">
        {pendingSearch ? (
          <ReformulationGate
            session={session}
            destination={pendingSearch}
            llmConfigured={llmConfigured}
            onConfirm={(query) => {
              void confirmSearchQuery(query, 'confirmed')
            }}
            onUseOriginal={() => {
              const original =
                session.rawInputs.find((r) => r.trim().length >= 8)?.trim() ||
                session.whatHappened.trim() ||
                ''
              void confirmSearchQuery(original, 'skipped')
            }}
            onCancel={() => setPendingSearch(null)}
            onDownloadNotes={() => {
              setSession((prev) => ({ ...prev, reformulationOutcome: 'refused' }))
              openNotes(true)
            }}
            onConfirmRole={(role) => {
              setSession((prev) => ({ ...prev, confirmedUserRole: role }))
            }}
            onAuthorityResolved={(next) => {
              setSession(next)
            }}
          />
        ) : closing ? (
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
            <InputBar onSubmit={handleAnswer} disabled={llmBusy} />
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
    </div>
  )
}
