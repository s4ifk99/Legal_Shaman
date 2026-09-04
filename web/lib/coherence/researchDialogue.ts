/**
 * Late-freeze research dialogue: agentic ask / wiki / update loop until commit.
 * Exa / Penumbra Overview only after status === 'committed'.
 */
import type { MatterFrame, MatterResolveResult } from '@/lib/matter/types'
import type { PredictiveChoice, Prompt, SessionState } from './types'
import {
  applyCommittedHypothesisToFrame,
  applyHypothesisProbeAnswer,
  buildHypothesisSet,
  commitHypothesisToIssues,
  type HypothesisEvidence,
  type HypothesisSet,
  type MatterHypothesis,
  nextHypothesisProbe,
} from './hypothesisProbe'

export const RESEARCH_DIALOGUE_MAX_TURNS = 8

export type ResearchDialogueAction = 'ask' | 'wiki' | 'update' | 'commit'

export type ResearchDialogueTranscriptEntry = {
  role: 'user' | 'agent' | 'system'
  text: string
  at: string
}

export type ResearchDialogueState = {
  set: HypothesisSet
  status: 'active' | 'committed'
  turns: number
  transcript: ResearchDialogueTranscriptEntry[]
  lastEvidence: HypothesisEvidence[]
  statusNote?: string
}

export type AgentTurnAction = {
  action: ResearchDialogueAction
  question?: string
  options?: PredictiveChoice[]
  hypothesisPatch?: Array<{ slug: string; delta: number; why?: string }>
  selectedSlug?: string
  why?: string
  transcriptNote?: string
}

export {
  applyCommittedHypothesisToFrame,
  buildHypothesisSet,
  commitHypothesisToIssues,
  type HypothesisSet,
  type MatterHypothesis,
  type HypothesisEvidence,
}

export function seedResearchDialogue(
  resolveResult: MatterResolveResult,
  session: SessionState,
  story: string,
): ResearchDialogueState {
  const set = buildHypothesisSet(resolveResult, session, story)
  return {
    set,
    status: 'active',
    turns: 0,
    transcript: [
      {
        role: 'system',
        text: `Seeded hypotheses: ${set.hypotheses.map((h) => `${h.slug}(${Math.round(h.score)})`).join(', ')}`,
        at: new Date().toISOString(),
      },
    ],
    lastEvidence: [],
  }
}

export function shouldForceCommitDialogue(state: ResearchDialogueState): boolean {
  if (state.status === 'committed') return true
  if (state.set.selectedSlug) return true
  return state.turns >= RESEARCH_DIALOGUE_MAX_TURNS
}

/** Late freeze: never auto-commit on score alone — only force budget, user pick, or agent commit. */
export function shouldCommitResearchDialogue(state: ResearchDialogueState): boolean {
  return shouldForceCommitDialogue(state)
}

export function applyUserAnswerToDialogue(
  state: ResearchDialogueState,
  promptId: string,
  value: string,
): ResearchDialogueState {
  const set = applyHypothesisProbeAnswer(state.set, promptId, value)
  return {
    ...state,
    set,
    turns: set.turns,
    transcript: [
      ...state.transcript,
      { role: 'user', text: value.trim().slice(0, 500), at: new Date().toISOString() },
    ].slice(-24),
  }
}

function bumpHypothesis(
  set: HypothesisSet,
  slug: string,
  delta: number,
  why?: string,
): HypothesisSet {
  const hypotheses = set.hypotheses.map((h) => {
    if (h.slug !== slug) return h
    return {
      ...h,
      score: h.score + delta,
      why: why && !h.why.includes(why) ? [...h.why, why] : h.why,
    }
  })
  if (!hypotheses.some((h) => h.slug === slug)) {
    hypotheses.push({
      slug,
      score: Math.max(8, delta),
      why: why ? [why] : ['agent patch'],
      evidence: [],
    })
  }
  hypotheses.sort((a, b) => b.score - a.score)
  return { ...set, hypotheses: hypotheses.slice(0, 3) }
}

export function applyAgentPatch(
  state: ResearchDialogueState,
  action: AgentTurnAction,
): ResearchDialogueState {
  let set = state.set
  if (action.hypothesisPatch?.length) {
    for (const patch of action.hypothesisPatch) {
      const slug = String(patch.slug || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
      if (!slug) continue
      set = bumpHypothesis(set, slug, Number(patch.delta) || 0, patch.why)
    }
  }
  if (action.selectedSlug) {
    const slug = action.selectedSlug.trim().toLowerCase().replace(/\s+/g, '_')
    set = bumpHypothesis(set, slug, 40, action.why || 'agent selected')
    set = { ...set, selectedSlug: slug }
  }
  const note = action.transcriptNote || action.why || action.question
  const transcript = note
    ? [
        ...state.transcript,
        {
          role: 'agent' as const,
          text: String(note).slice(0, 400),
          at: new Date().toISOString(),
        },
      ].slice(-24)
    : state.transcript

  return {
    ...state,
    set,
    turns: state.turns + (action.action === 'ask' ? 0 : 1),
    transcript,
    statusNote: action.transcriptNote || state.statusNote,
  }
}

export function markDialogueCommitted(state: ResearchDialogueState): ResearchDialogueState {
  return { ...state, status: 'committed' }
}

export function heuristicAgentTurn(state: ResearchDialogueState, _story: string): AgentTurnAction {
  if (shouldForceCommitDialogue(state)) {
    return {
      action: 'commit',
      selectedSlug: state.set.selectedSlug || state.set.hypotheses[0]?.slug,
      why: 'Turn budget reached — commit top hypothesis.',
      transcriptNote: 'Committing after research dialogue budget.',
    }
  }

  // Prefer wiki once early if no evidence yet
  if (state.turns === 0 && state.set.hypotheses.length && !state.lastEvidence.length) {
    return {
      action: 'wiki',
      why: 'Check local wiki for open hypothesis slots.',
      transcriptNote: 'Checking Legal Shaman wiki for competing areas…',
    }
  }

  const probe = nextHypothesisProbe(state.set, {} as SessionState)
  if (probe) {
    return {
      action: 'ask',
      question: probe.text,
      options: probe.options,
      why: probe.reason,
      transcriptNote: probe.text,
    }
  }

  return {
    action: 'commit',
    selectedSlug: state.set.hypotheses[0]?.slug,
    why: 'No further discriminating questions — commit.',
    transcriptNote: 'Geometry clear enough to freeze.',
  }
}

export function promptFromAgentAsk(
  action: AgentTurnAction,
  turn: number,
  fallback: Prompt | null,
): Prompt {
  if (fallback && action.action === 'ask' && !action.question) return fallback
  const options =
    action.options && action.options.length >= 2
      ? action.options
      : fallback?.options || [
          {
            id: 'continue',
            label: 'Continue',
            value: 'Continue researching this matter.',
          },
        ]
  return {
    id: `research_ask_${turn}`,
    kind: options.length >= 2 ? 'closed' : 'open',
    text: (action.question || fallback?.text || 'What is the live legal problem?').slice(0, 320),
    reason: action.why || fallback?.reason || 'Research dialogue — pin the matter before Third Eye.',
    options: options.slice(0, 6),
  }
}

export function isResearchDialoguePromptId(id: string): boolean {
  return (
    id === 'matter_gate' ||
    id === 'hyp_probe_gate' ||
    id.startsWith('hyp_probe_') ||
    id.startsWith('research_ask_') ||
    id === 'research_dialogue_status'
  )
}

export function toHypothesisProbeCompat(state: ResearchDialogueState): SessionState['hypothesisProbe'] {
  return {
    set: state.set,
    status: state.status === 'committed' ? 'committed' : 'probing',
    turns: state.turns,
  }
}

export function fromHypothesisProbeCompat(
  probe: NonNullable<SessionState['hypothesisProbe']>,
  prior?: ResearchDialogueState,
): ResearchDialogueState {
  return {
    set: probe.set as HypothesisSet,
    status: probe.status === 'committed' ? 'committed' : 'active',
    turns: probe.turns,
    transcript: prior?.transcript || [],
    lastEvidence: prior?.lastEvidence || [],
    statusNote: prior?.statusNote,
  }
}

export function commitDialogueToFrame(frame: MatterFrame, state: ResearchDialogueState): MatterFrame {
  return applyCommittedHypothesisToFrame(frame, state.set)
}
