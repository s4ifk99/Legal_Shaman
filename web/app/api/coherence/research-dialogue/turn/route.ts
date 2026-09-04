import { NextResponse } from 'next/server'

import { coherenceApiGuard } from '@/lib/coherence/server/guard'
import { runResearchDialogueTurn } from '@/lib/coherence/researchDialogueTurn'
import type { ResearchDialogueState } from '@/lib/coherence/researchDialogue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * One agentic research-dialogue turn (ask / wiki / update / commit).
 * Local wiki only — does not call Exa or count monthly Penumbra searches.
 */
export async function POST(req: Request) {
  const blocked = coherenceApiGuard()
  if (blocked) return blocked

  let body: {
    story?: string
    dialogue?: ResearchDialogueState
    lastUserMessage?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const story = String(body.story || '').trim()
  if (story.length < 8 || !body.dialogue?.set?.hypotheses) {
    return NextResponse.json({ error: 'missing_dialogue_context' }, { status: 400 })
  }

  try {
    const result = await runResearchDialogueTurn({
      story,
      dialogue: body.dialogue,
      lastUserMessage: body.lastUserMessage,
    })
    return NextResponse.json({
      dialogue: result.dialogue,
      action: result.action,
      prompt: result.prompt,
      committed: result.committed,
      statusNote: result.statusNote,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'research_dialogue_failed',
      },
      { status: 500 },
    )
  }
}
