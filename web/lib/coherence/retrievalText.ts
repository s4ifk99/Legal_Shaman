/**
 * Shared retrieval text builder: Atwell query + style translation + CAQI context tokens.
 */

import type { SessionState } from './types'

/** Lowercased corpus string for wiki / coherence / signpost matching. */
export function buildRetrievalText(session: SessionState): string {
  return [
    session.styleTranslatedQuery,
    session.confirmedSearchQuery,
    ...(session.searchContextTokens || []),
    ...session.rawInputs,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.events.map((e) => `${e.label} ${e.rawSpan ?? ''}`),
    ...session.parties.map((p) => `${p.label} ${p.role ?? ''}`),
    ...session.documents,
    ...session.softFlags,
    session.matterType !== 'unknown' ? session.matterType : '',
    session.locationHint,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
