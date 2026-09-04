/**
 * Server-side research-dialogue agent turn (OpenRouter JSON + local wiki).
 * Does not call Exa or burn monthly Penumbra search quota.
 *
 * One HTTP request = up to INTERNAL_STEP_MAX wiki/update steps, then one ask or commit.
 */
import { chat, llmConfigured } from '@/lib/llm/client'
import { attachLocalHypothesisEvidence } from './hypothesisResearch'
import {
  applyAgentPatch,
  heuristicAgentTurn,
  promptFromAgentAsk,
  shouldForceCommitDialogue,
  type AgentTurnAction,
  type ResearchDialogueState,
} from './researchDialogue'
import { nextHypothesisProbe } from './hypothesisProbe'
import type { PredictiveChoice, Prompt, SessionState } from './types'

const INTERNAL_STEP_MAX = 3

function parseAction(raw: string): AgentTurnAction | null {
  try {
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    const data = JSON.parse(cleaned) as AgentTurnAction
    const action = data.action
    if (action !== 'ask' && action !== 'wiki' && action !== 'update' && action !== 'commit') {
      return null
    }
    const options = Array.isArray(data.options)
      ? data.options
          .map((o, i) => ({
            id: String((o as PredictiveChoice).id || `opt-${i}`),
            label: String((o as PredictiveChoice).label || '').trim(),
            value: String((o as PredictiveChoice).value || (o as PredictiveChoice).label || '').trim(),
          }))
          .filter((o) => o.label && o.value)
          .slice(0, 6)
      : undefined
    return {
      action,
      question: data.question ? String(data.question).slice(0, 320) : undefined,
      options,
      hypothesisPatch: Array.isArray(data.hypothesisPatch) ? data.hypothesisPatch.slice(0, 6) : undefined,
      selectedSlug: data.selectedSlug ? String(data.selectedSlug).slice(0, 64) : undefined,
      why: data.why ? String(data.why).slice(0, 240) : undefined,
      transcriptNote: data.transcriptNote ? String(data.transcriptNote).slice(0, 240) : undefined,
    }
  } catch {
    return null
  }
}

async function llmAgentTurn(
  state: ResearchDialogueState,
  story: string,
  lastUserMessage: string | undefined,
  step: number,
): Promise<AgentTurnAction> {
  if (!llmConfigured()) return heuristicAgentTurn(state, story)

  const system = `You are Legal Shaman's research dialogue agent (England & Wales signposting).
Decide ONE next action as JSON only:
{"action":"ask"|"wiki"|"update"|"commit","question?":string,"options?":[{"id","label","value"}],"hypothesisPatch?":[{"slug","delta","why"}],"selectedSlug?":string,"why?":string,"transcriptNote?":string}

Rules:
- Prefer discriminating closed questions that split the top two hypotheses (employment vs family, etc).
- Use "wiki" to gather local Legal Shaman wiki evidence when scores are close or evidence is empty.
- Use "update" only with small hypothesisPatch deltas after user answers or wiki.
- Use "commit" when the top hypothesis is clear OR turn budget is nearly spent — set selectedSlug.
- Never invent statutes or give case strength advice.
- Never mention Exa or open-web search.
- Keep question under 220 characters; 2–4 options for closed asks.
- Internal step ${step}/${INTERNAL_STEP_MAX}: prefer wiki/update early; ask or commit to finish the beat.`

  const hyps = state.set.hypotheses
    .map((h) => `${h.slug}:${Math.round(h.score)} why=[${h.why.slice(0, 3).join('; ')}]`)
    .join('\n')
  const transcript = state.transcript
    .slice(-8)
    .map((t) => `${t.role}: ${t.text}`)
    .join('\n')

  const user = `Story:
${story.slice(0, 2500)}

Hypotheses:
${hyps || '(none)'}

Turns used: ${state.turns}/8
Force commit soon: ${shouldForceCommitDialogue(state)}
Last evidence: ${(state.lastEvidence || []).map((e) => e.title).slice(0, 3).join('; ') || '(none)'}
Last user message: ${(lastUserMessage || '').slice(0, 500) || '(none)'}
Recent transcript:
${transcript || '(none)'}

Return the next action JSON.`

  try {
    const raw = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      {
        jsonMode: true,
        temperature: 0.2,
        maxTokens: 500,
        timeoutMs: 20_000,
        purpose: 'evidence_research_exception',
        caller: 'researchDialogue.turn',
      },
    )
    const parsed = parseAction(raw)
    if (parsed) return parsed
  } catch {
    // fall through to heuristic
  }
  return heuristicAgentTurn(state, story)
}

function executeWiki(
  dialogue: ResearchDialogueState,
  story: string,
  action: AgentTurnAction,
): ResearchDialogueState {
  const enriched = attachLocalHypothesisEvidence(dialogue.set, story)
  const evidence = enriched.hypotheses.flatMap((h) => h.evidence).slice(0, 8)
  const titles = evidence.map((e) => e.title).filter(Boolean).slice(0, 3)
  const note =
    titles.length > 0 ? `Checked: ${titles.join(' · ')}` : action.transcriptNote || 'Checked local wiki.'
  return {
    ...applyAgentPatch(
      { ...dialogue, set: enriched, lastEvidence: evidence },
      { ...action, transcriptNote: note },
    ),
    set: enriched,
    lastEvidence: evidence,
    turns: dialogue.turns + 1,
    statusNote: titles.length > 0 ? `Checked ${titles.slice(0, 2).join(' · ')}` : 'Checked local wiki',
  }
}

function finishAsk(
  dialogue: ResearchDialogueState,
  action: AgentTurnAction,
  session?: SessionState,
): ResearchDialogueTurnResult {
  const nextDialogue = {
    ...dialogue,
    turns: Math.max(dialogue.turns, dialogue.set.turns),
    statusNote: action.transcriptNote || dialogue.statusNote || action.question || 'Asking a discriminating question',
  }
  const fallback = nextHypothesisProbe(nextDialogue.set, session || ({} as SessionState))
  const prompt = promptFromAgentAsk(action, nextDialogue.turns, fallback)
  return {
    dialogue: nextDialogue,
    action,
    prompt,
    committed: false,
    statusNote: nextDialogue.statusNote,
  }
}

function finishCommit(
  dialogue: ResearchDialogueState,
  action: AgentTurnAction,
): ResearchDialogueTurnResult {
  let next = dialogue
  if (action.selectedSlug || action.hypothesisPatch?.length) {
    next = applyAgentPatch(next, action)
  }
  if (!next.set.selectedSlug && next.set.hypotheses[0]) {
    next = {
      ...next,
      set: { ...next.set, selectedSlug: next.set.hypotheses[0].slug },
    }
  }
  next = { ...next, status: 'committed', statusNote: action.transcriptNote || next.statusNote || 'Matter committed.' }
  return {
    dialogue: next,
    action: { ...action, action: 'commit' },
    prompt: null,
    committed: true,
    statusNote: next.statusNote,
  }
}

export type ResearchDialogueTurnResult = {
  dialogue: ResearchDialogueState
  action: AgentTurnAction
  prompt: Prompt | null
  committed: boolean
  statusNote?: string
}

/**
 * One user-visible beat: up to INTERNAL_STEP_MAX wiki/update steps, then ask or commit.
 */
export async function runResearchDialogueTurn(input: {
  story: string
  dialogue: ResearchDialogueState
  lastUserMessage?: string
  session?: SessionState
}): Promise<ResearchDialogueTurnResult> {
  let dialogue = input.dialogue
  let lastAction: AgentTurnAction = { action: 'ask' }

  for (let step = 1; step <= INTERNAL_STEP_MAX; step++) {
    if (shouldForceCommitDialogue(dialogue)) {
      return finishCommit(dialogue, {
        action: 'commit',
        selectedSlug: dialogue.set.selectedSlug || dialogue.set.hypotheses[0]?.slug,
        why: 'Turn budget — commit.',
        transcriptNote: 'Committing after research dialogue budget.',
      })
    }

    const action =
      step === 1
        ? await llmAgentTurn(dialogue, input.story, input.lastUserMessage, step)
        : // After wiki/update, prefer heuristic ask/commit to avoid burning another LLM call.
          heuristicAgentTurn(dialogue, input.story)
    lastAction = action

    if (action.action === 'wiki') {
      dialogue = executeWiki(dialogue, input.story, action)
      continue
    }

    if (action.action === 'update') {
      dialogue = applyAgentPatch(dialogue, action)
      dialogue = {
        ...dialogue,
        turns: dialogue.turns + 1,
        statusNote: action.transcriptNote || action.why || 'Updated competing matters',
      }
      continue
    }

    if (action.action === 'commit' || shouldForceCommitDialogue(dialogue)) {
      return finishCommit(dialogue, action)
    }

    if (action.action === 'ask') {
      return finishAsk(dialogue, action, input.session)
    }
  }

  // Exhausted internal steps without ask/commit — force a user ask or commit.
  if (shouldForceCommitDialogue(dialogue)) {
    return finishCommit(dialogue, {
      action: 'commit',
      selectedSlug: dialogue.set.hypotheses[0]?.slug,
      why: 'Internal step budget — commit.',
    })
  }
  const probe = nextHypothesisProbe(dialogue.set, input.session || ({} as SessionState))
  return finishAsk(
    dialogue,
    {
      action: 'ask',
      question: probe?.text || lastAction.question,
      options: probe?.options || lastAction.options,
      why: probe?.reason || 'Ask after internal research steps.',
      transcriptNote: dialogue.statusNote || probe?.text,
    },
    input.session,
  )
}
