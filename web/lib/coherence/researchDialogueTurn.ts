/**
 * Server-side research-dialogue agent turn (OpenRouter JSON + local wiki).
 * Does not call Exa or burn monthly Penumbra search quota.
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
  lastUserMessage?: string,
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
- Keep question under 220 characters; 2–4 options for closed asks.`

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

export type ResearchDialogueTurnResult = {
  dialogue: ResearchDialogueState
  action: AgentTurnAction
  prompt: Prompt | null
  committed: boolean
  statusNote?: string
}

/**
 * Run one agent turn: may ask, wiki (local), update, or commit.
 * Wiki steps auto-chain into a follow-up ask/commit without another LLM call when possible.
 */
export async function runResearchDialogueTurn(input: {
  story: string
  dialogue: ResearchDialogueState
  lastUserMessage?: string
  session?: SessionState
}): Promise<ResearchDialogueTurnResult> {
  let dialogue = input.dialogue
  let action = await llmAgentTurn(dialogue, input.story, input.lastUserMessage)

  // Execute wiki locally (no Exa)
  if (action.action === 'wiki') {
    const enriched = attachLocalHypothesisEvidence(dialogue.set, input.story)
    const evidence = enriched.hypotheses.flatMap((h) => h.evidence).slice(0, 8)
    const titles = evidence.map((e) => e.title).filter(Boolean).slice(0, 3)
    dialogue = {
      ...applyAgentPatch(
        { ...dialogue, set: enriched, lastEvidence: evidence },
        {
          ...action,
          transcriptNote:
            titles.length > 0
              ? `Checked: ${titles.join('; ')}`
              : action.transcriptNote || 'Checked local wiki.',
        },
      ),
      set: enriched,
      lastEvidence: evidence,
      turns: dialogue.turns + 1,
      statusNote:
        titles.length > 0 ? `Checked ${titles[0]}${titles[1] ? ` · ${titles[1]}` : ''}` : 'Checked local wiki',
    }
    // Follow with ask or commit without second LLM if budget allows
    if (shouldForceCommitDialogue(dialogue)) {
      action = {
        action: 'commit',
        selectedSlug: dialogue.set.selectedSlug || dialogue.set.hypotheses[0]?.slug,
        why: 'Budget after wiki — commit.',
        transcriptNote: 'Committing after wiki check.',
      }
    } else {
      const probe = nextHypothesisProbe(dialogue.set, input.session || ({} as SessionState))
      action = {
        action: 'ask',
        question: probe?.text,
        options: probe?.options,
        why: probe?.reason || 'Ask after wiki evidence.',
        transcriptNote: probe?.text,
      }
    }
  }

  if (action.action === 'update') {
    dialogue = applyAgentPatch(dialogue, action)
    dialogue = { ...dialogue, turns: dialogue.turns + 1 }
    if (!shouldForceCommitDialogue(dialogue)) {
      const probe = nextHypothesisProbe(dialogue.set, input.session || ({} as SessionState))
      action = {
        action: probe ? 'ask' : 'commit',
        question: probe?.text,
        options: probe?.options,
        why: probe?.reason || action.why,
        selectedSlug: probe ? undefined : dialogue.set.hypotheses[0]?.slug,
        transcriptNote: probe?.text || 'Updated hypotheses.',
      }
    } else {
      action = {
        action: 'commit',
        selectedSlug: dialogue.set.selectedSlug || dialogue.set.hypotheses[0]?.slug,
        why: 'Budget after update — commit.',
      }
    }
  }

  if (action.action === 'commit' || shouldForceCommitDialogue(dialogue)) {
    if (action.selectedSlug) {
      dialogue = applyAgentPatch(dialogue, action)
    }
    dialogue = { ...dialogue, status: 'committed' }
    return {
      dialogue,
      action: { ...action, action: 'commit' },
      prompt: null,
      committed: true,
      statusNote: dialogue.statusNote || action.transcriptNote || 'Matter committed.',
    }
  }

  if (action.action === 'ask') {
    dialogue = {
      ...dialogue,
      turns: Math.max(dialogue.turns, dialogue.set.turns),
      statusNote: action.transcriptNote || dialogue.statusNote,
    }
    const fallback = nextHypothesisProbe(dialogue.set, input.session || ({} as SessionState))
    const prompt = promptFromAgentAsk(action, dialogue.turns, fallback)
    return {
      dialogue,
      action,
      prompt,
      committed: false,
      statusNote: dialogue.statusNote,
    }
  }

  // Fallback: heuristic ask
  const fallbackAction = heuristicAgentTurn(dialogue, input.story)
  if (fallbackAction.action === 'commit') {
    dialogue = applyAgentPatch(dialogue, fallbackAction)
    dialogue = { ...dialogue, status: 'committed' }
    return { dialogue, action: fallbackAction, prompt: null, committed: true }
  }
  const fallback = nextHypothesisProbe(dialogue.set, input.session || ({} as SessionState))
  return {
    dialogue,
    action: fallbackAction,
    prompt: promptFromAgentAsk(fallbackAction, dialogue.turns, fallback),
    committed: false,
    statusNote: dialogue.statusNote,
  }
}
