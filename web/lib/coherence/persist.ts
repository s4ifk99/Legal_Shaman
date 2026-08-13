import type { SessionState } from './types'
import { createInitialSession } from './sense'

const KEY = 'coherence-intake-session-v1'

type Stored = {
  session: SessionState
  view: 'intake' | 'services' | 'notes' | 'oslaw'
  savedAt: string
}

export function loadPersisted(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Stored
    if (!data?.session || !Array.isArray(data.session.rawInputs)) return null
    return data
  } catch {
    return null
  }
}

export function savePersisted(session: SessionState, view: 'intake' | 'services' | 'notes' | 'oslaw') {
  try {
    const payload: Stored = { session, view, savedAt: new Date().toISOString() }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    // quota / private mode — ignore
  }
}

export function clearPersisted() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}

export function freshSession(): SessionState {
  clearPersisted()
  return createInitialSession()
}
