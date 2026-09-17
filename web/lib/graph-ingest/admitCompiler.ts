/**
 * Admit compiler: hard gates + AI self-allow/deny.
 * Matching Help only sees status=admitted. self_allowed_queue is not live.
 */
import { combineAdmit } from './combineAdmit'
import { hardGateHit } from './hardGates'
import { runAiSourceCritic } from './aiCritic'
import type { AdmitResult, AiCriticDecision, CrawlHit } from './types'

export { crawlQueriesFromFrozenSession, queryLeaksClientStory } from './queryFromFrozenGraph'
export { hardGateHit } from './hardGates'
export { combineAdmit } from './combineAdmit'
export { parseAiCriticJson, runAiSourceCritic, ADMIT_CRITIC_SYSTEM } from './aiCritic'
export type { AdmitResult, AiCriticDecision, CrawlHit } from './types'

export function admitHitSync(hit: CrawlHit, ai: AiCriticDecision | null = null): AdmitResult {
  return combineAdmit(hit, hardGateHit(hit), ai)
}

export async function admitHit(hit: CrawlHit, opts?: { useAi?: boolean }): Promise<AdmitResult> {
  const hard = hardGateHit(hit)
  let ai: AiCriticDecision | null = null
  if (opts?.useAi !== false && hard.action !== 'deny') {
    ai = await runAiSourceCritic(hit)
  }
  return combineAdmit(hit, hard, ai)
}

export async function admitBatch(
  hits: CrawlHit[],
  opts?: { useAi?: boolean },
): Promise<AdmitResult[]> {
  const out: AdmitResult[] = []
  for (const hit of hits) {
    out.push(await admitHit(hit, opts))
  }
  return out
}

/** Live UI may only show these. */
export function clientVisibleHits(results: AdmitResult[]): AdmitResult[] {
  return results.filter((r) => r.clientVisible && r.status === 'admitted')
}
