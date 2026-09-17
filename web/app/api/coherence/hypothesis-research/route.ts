import { NextResponse } from 'next/server'

import { evidenceMapForHypotheses } from '@/lib/coherence/hypothesisResearch'
import type { HypothesisSet } from '@/lib/coherence/hypothesisProbe'
import { coherenceApiGuard } from '@/lib/coherence/server/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Light local wiki evidence for open hypothesis slots.
 * Does not call Exa — Penumbra monthly quota stays untouched.
 */
export async function POST(req: Request) {
  const blocked = coherenceApiGuard()
  if (blocked) return blocked

  let body: { set?: HypothesisSet; story?: string }
  try {
    body = (await req.json()) as { set?: HypothesisSet; story?: string }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!body.set?.hypotheses?.length) {
    return NextResponse.json({ error: 'missing_hypotheses' }, { status: 400 })
  }

  const evidenceBySlug = evidenceMapForHypotheses(body.set)
  return NextResponse.json({ evidenceBySlug })
}
