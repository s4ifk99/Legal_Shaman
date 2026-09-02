import 'server-only'

import { createHash } from 'node:crypto'

import type { ResearchBundle } from '@/lib/coherence/researchBundle'
import type { SearchMode } from '@/lib/coherence/types'
import type { ArambResearchDiagnostic } from '@/lib/aramb/diagnostics'
import {
  penumbraResearchEnabled,
  runPenumbraResearch,
  type PenumbraResearchOutcome,
} from '@/lib/penumbra/researcher'

type ArambResearchInput = {
  mode: SearchMode
  query: string
  sourceContext: string
  canonicalSources: import('@/lib/coherence/researchBundle').ResearchSource[]
  tenantKey: string
  conversationId?: string
}

export type ArambResearchResult = {
  bundle: ResearchBundle
  conversationId: string
  tokens?: number
  latencyMs: number
}

export type ArambResearchOutcome = PenumbraResearchOutcome

/** @deprecated Use penumbraResearchEnabled — kept for route compatibility. */
export function arambPilotEnabled(): boolean {
  return penumbraResearchEnabled()
}

/** Stable, non-reversible tenant key; never send an email or case text as subTenant. */
export function arambSubTenant(tenantKey: string): string {
  return `ls-${createHash('sha256').update(`legal-shaman:${tenantKey}`).digest('hex').slice(0, 32)}`
}

/**
 * Third Eye research — Exa gap-fill + OpenRouter synthesis (replaces Aramb SDK).
 */
export async function runArambResearch(
  input: ArambResearchInput,
  onChunk?: (delta: string) => void,
): Promise<ArambResearchOutcome> {
  return runPenumbraResearch(input, onChunk)
}

export type { ArambResearchDiagnostic }
