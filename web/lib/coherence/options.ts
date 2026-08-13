import type { PredictiveChoice, Prompt, SessionState } from './types'

/** Prefer options attached to the current causation question. */
export function predictiveOptions(prompt: Prompt, _session: SessionState): PredictiveChoice[] {
  if (prompt.id === 'open') return []
  return prompt.options ?? []
}

export type PredictiveOption = PredictiveChoice
