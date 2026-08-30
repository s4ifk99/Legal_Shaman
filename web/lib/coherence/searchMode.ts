import type { SearchMode } from './types'

export type SearchModePolicy = {
  mode: SearchMode
  label: string
  retrievalBreadth: 'focused' | 'broad'
  maxSecondarySources: number
  promptInstruction: string
}

export function normalizeSearchMode(value: unknown): SearchMode {
  // Penumbra is the sole product research path. Keep the union for persisted/API
  // compatibility, but never let legacy Umbra state select a different policy.
  void value
  return 'penumbra'
}

export function searchModePolicy(mode: SearchMode): SearchModePolicy {
  if (mode === 'penumbra') {
    return {
      mode,
      label: 'Penumbra',
      retrievalBreadth: 'broad',
      maxSecondarySources: 6,
      promptInstruction:
        'This is Penumbra exploratory research: include clearly labelled secondary or competing material when relevant, explain source quality and conflicts, and separate leads from established guidance.',
    }
  }

  return {
    mode: 'umbra',
    label: 'Umbra',
    retrievalBreadth: 'focused',
    maxSecondarySources: 0,
    promptInstruction:
      'This is Umbra guided research: keep retrieval focused, prefer official and primary sources, state uncertainty, and omit unsupported or weakly sourced claims.',
  }
}

export const HARD_SEARCH_GUARDRAILS =
  'In every mode, do not fabricate authorities, predict legal outcomes, expose private data, or present an unsupported claim as established law.'
