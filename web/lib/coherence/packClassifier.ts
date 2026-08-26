/**
 * Coherence pack classifier — maps a client opener to a closed pack set.
 * LLM (OpenRouter) preferred; heuristics as fallback. See turn-state note.
 */
import type { MatterType, PredictiveChoice, Prompt, SessionState } from './types'
import {
  looksNeighbourDispute,
  looksOwnDrivewayActivityQuestion,
  looksProspectiveVisaApplication,
  looksVisaRefusalOrChallenge,
} from './sense'

export const PACK_CLASSIFY_ACCEPT = 0.6
export const PACK_CLASSIFY_CLARIFY_BELOW = 0.55

export type CoherencePackId =
  | 'neighbour-access-dispute'
  | 'own-property-use'
  | 'car-reject-failed-repair'
  | 'private-parking-charge'
  | 'landlord-tenant'
  | 'family-visa-apply'
  | 'visa-refusal-challenge'
  | 'family-belongings-claim'
  | 'employment-general'
  | 'general-info'
  | 'unclear'

export type PackClassification = {
  packId: CoherencePackId
  confidence: number
  reason: string
  clarifyingQuestion?: string
  source: 'llm' | 'heuristic' | 'user'
}

export const COHERENCE_PACK_IDS: CoherencePackId[] = [
  'neighbour-access-dispute',
  'own-property-use',
  'car-reject-failed-repair',
  'private-parking-charge',
  'landlord-tenant',
  'family-visa-apply',
  'visa-refusal-challenge',
  'family-belongings-claim',
  'employment-general',
  'general-info',
  'unclear',
]

const PACK_META: Record<
  CoherencePackId,
  { matter: MatterType; topicId: string; label: string; mode?: SessionState['mode'] }
> = {
  'neighbour-access-dispute': {
    matter: 'housing',
    topicId: 'housing-access',
    label: 'Neighbour / access dispute (parking, car port, blocking)',
  },
  'own-property-use': {
    matter: 'other',
    topicId: 'own-property-use',
    label: 'What I can do on my own driveway / property (not a neighbour fight)',
    mode: 'info',
  },
  'car-reject-failed-repair': {
    matter: 'consumer',
    topicId: 'consumer-car',
    label: 'Used car bought from a trader — reject / refund / repair',
  },
  'private-parking-charge': {
    matter: 'consumer',
    topicId: 'consumer-parking',
    label: 'Private parking charge / PCN',
  },
  'landlord-tenant': {
    matter: 'housing',
    topicId: 'housing-tenancy',
    label: 'Landlord–tenant (rent, repairs, eviction notice)',
  },
  'family-visa-apply': {
    matter: 'immigration',
    topicId: 'immigration-family-apply',
    label: 'Want to apply for a family / partner visa (no refusal yet)',
  },
  'visa-refusal-challenge': {
    matter: 'immigration',
    topicId: 'immigration-challenge',
    label: 'Visa / leave was refused — challenge or appeal',
  },
  'family-belongings-claim': {
    matter: 'family',
    topicId: 'family-belongings',
    label: 'Family / belongings money claim (not child arrangements)',
  },
  'employment-general': {
    matter: 'employment',
    topicId: 'employment',
    label: 'Job / employment problem',
  },
  'general-info': {
    matter: 'other',
    topicId: 'general-info',
    label: 'General legal information / signposting',
    mode: 'info',
  },
  unclear: {
    matter: 'unknown',
    topicId: '',
    label: 'Not sure yet — need a clarifying question',
  },
}

export function isCoherencePackId(id: string): id is CoherencePackId {
  return (COHERENCE_PACK_IDS as string[]).includes(id)
}

export function packMeta(packId: CoherencePackId) {
  return PACK_META[packId]
}

/** Offline / fallback classifier — better than bare keyword locks for known traps. */
export function heuristicSuggestPack(text: string): PackClassification {
  const t = text.trim()
  if (!t) {
    return {
      packId: 'unclear',
      confidence: 0.2,
      reason: 'Empty opener',
      clarifyingQuestion: 'In one sentence, what legal problem or question do you need help with?',
      source: 'heuristic',
    }
  }

  if (looksOwnDrivewayActivityQuestion(t)) {
    return {
      packId: 'own-property-use',
      confidence: 0.82,
      reason: 'Own driveway / wash-clean car style question — not neighbour access',
      source: 'heuristic',
    }
  }

  if (looksVisaRefusalOrChallenge(t)) {
    return {
      packId: 'visa-refusal-challenge',
      confidence: 0.8,
      reason: 'Visa / leave refusal or challenge language',
      source: 'heuristic',
    }
  }

  if (looksProspectiveVisaApplication(t)) {
    return {
      packId: 'family-visa-apply',
      confidence: 0.78,
      reason: 'Prospective visa / leave application',
      source: 'heuristic',
    }
  }

  if (looksNeighbourDispute(t)) {
    return {
      packId: 'neighbour-access-dispute',
      confidence: 0.76,
      reason: 'Neighbour / access conflict language',
      source: 'heuristic',
    }
  }

  if (
    /\b(used car|bought .{0,24}(?:car|vehicle)|dealer|fault codes?)\b/i.test(t) &&
    /\b(reject|refund|repair|faulty|broke|warranty|trader)\b/i.test(t)
  ) {
    return {
      packId: 'car-reject-failed-repair',
      confidence: 0.78,
      reason: 'Used-car purchase / remedy language',
      source: 'heuristic',
    }
  }

  if (/\b(parking (?:fine|ticket|charge)|car\s*park|pcn|popla|private parking)\b/i.test(t)) {
    return {
      packId: 'private-parking-charge',
      confidence: 0.75,
      reason: 'Private / council parking charge language',
      source: 'heuristic',
    }
  }

  if (/\b(landlord|tenant|tenancy|section\s*21|section\s*8|disrepair|mould)\b/i.test(t)) {
    return {
      packId: 'landlord-tenant',
      confidence: 0.74,
      reason: 'Landlord–tenant language',
      source: 'heuristic',
    }
  }

  if (
    /\b(sacked|fired|dismiss|redundan|employer|tribunal|acas|unfair dismissal)\b/i.test(t)
  ) {
    return {
      packId: 'employment-general',
      confidence: 0.72,
      reason: 'Employment language',
      source: 'heuristic',
    }
  }

  return {
    packId: 'unclear',
    confidence: 0.35,
    reason: 'No strong pack heuristic',
    clarifyingQuestion:
      'Which of these is closest — a neighbour dispute, something you want to do on your own property, a purchase/refund, immigration, or something else?',
    source: 'heuristic',
  }
}

/** Apply a pack classification onto the session (topic, matter, mode). */
export function applyPackClassification(
  session: SessionState,
  classification: PackClassification,
): SessionState {
  const meta = PACK_META[classification.packId]
  const conf = Math.max(0, Math.min(1, classification.confidence))
  const next: SessionState = {
    ...session,
    packClassification: {
      ...classification,
      confidence: conf,
    },
  }

  if (classification.packId === 'unclear' || conf < PACK_CLASSIFY_CLARIFY_BELOW) {
    return next
  }

  return {
    ...next,
    matterType: meta.matter !== 'unknown' ? meta.matter : session.matterType,
    topicId: meta.topicId || session.topicId,
    mode: meta.mode && session.mode === 'unknown' ? meta.mode : session.mode,
  }
}

export function needsPackClarify(session: SessionState): boolean {
  const c = session.packClassification
  if (!c) return false
  if (session.answeredPromptIds.includes('pack_clarify')) return false
  if (c.source === 'user') return false
  return c.packId === 'unclear' || c.confidence < PACK_CLASSIFY_CLARIFY_BELOW
}

export function packClarifyPrompt(session: SessionState): Prompt {
  const c = session.packClassification
  const text =
    c?.clarifyingQuestion?.trim() ||
    'Which of these best matches what you need help with?'
  const options: PredictiveChoice[] = [
    {
      id: 'pc1',
      label: 'Neighbour / access',
      value: 'pack:neighbour-access-dispute',
    },
    {
      id: 'pc2',
      label: 'My own driveway / property',
      value: 'pack:own-property-use',
    },
    {
      id: 'pc3',
      label: 'Used car / refund',
      value: 'pack:car-reject-failed-repair',
    },
    {
      id: 'pc4',
      label: 'Parking charge / PCN',
      value: 'pack:private-parking-charge',
    },
    {
      id: 'pc5',
      label: 'Landlord / tenant',
      value: 'pack:landlord-tenant',
    },
    {
      id: 'pc6',
      label: 'Family visa (apply)',
      value: 'pack:family-visa-apply',
    },
    {
      id: 'pc7',
      label: 'Visa refusal',
      value: 'pack:visa-refusal-challenge',
    },
    {
      id: 'pc8',
      label: 'Something else',
      value: 'pack:general-info',
    },
  ]
  return {
    id: 'pack_clarify',
    kind: 'closed',
    text,
    reason: c
      ? `Pack classifier unsure (${c.packId}, conf ${c.confidence.toFixed(2)}): ${c.reason}`
      : 'Need a pack before questions or retrieval.',
    options,
  }
}

/** Parse pack:… chip or free text after pack_clarify. */
export function classificationFromClarifyAnswer(value: string): PackClassification | null {
  const m = value.trim().match(/^pack:([a-z0-9-]+)$/i)
  if (m && isCoherencePackId(m[1]!)) {
    return {
      packId: m[1] as CoherencePackId,
      confidence: 0.95,
      reason: 'User confirmed pack',
      source: 'user',
    }
  }
  // Free text — light heuristic
  const h = heuristicSuggestPack(value)
  if (h.packId !== 'unclear') {
    return { ...h, confidence: Math.max(h.confidence, 0.7), source: 'user' }
  }
  return {
    packId: 'general-info',
    confidence: 0.7,
    reason: 'User described something else after clarify',
    source: 'user',
  }
}

export function shouldRunPackClassify(session: SessionState, answeredId: string): boolean {
  if (session.packClassification?.source === 'llm') return false
  if (session.packClassification?.source === 'user') return false
  if (session.answeredPromptIds.includes('pack_clarify')) return false
  // Opening story or deep-link auto-run
  if (answeredId === 'open') return true
  if (session.rawInputs.length <= 1 && answeredId !== 'matter' && answeredId !== 'mode_fork') {
    return true
  }
  return false
}

/** Prompt text for the OpenRouter classify call. */
export function packClassifySystemPrompt(): string {
  const lines = COHERENCE_PACK_IDS.map((id) => `- ${id}: ${PACK_META[id].label}`).join('\n')
  return `You classify a UK layperson's first message into ONE legal intake pack for Legal Shaman (signposting only — not advice).

Return JSON only:
{"packId":"<id>","confidence":0-1,"reason":"short why","clarifyingQuestion":"optional if unsure"}

Rules:
- packId MUST be one of:\n${lines}
- "can I wash my car on my driveway" / own-drive use → own-property-use (NOT neighbour-access-dispute).
- Neighbour parking/blocking/car port on shared access → neighbour-access-dispute.
- "I need a family visa" with no refusal → family-visa-apply (NOT visa-refusal-challenge).
- Used car from a dealer with reject/refund → car-reject-failed-repair (NOT private parking).
- If unsure, packId=unclear, confidence<0.5, and set clarifyingQuestion.
Never invent packs. Never give legal advice.`
}
