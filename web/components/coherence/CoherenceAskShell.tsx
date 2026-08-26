'use client'

import CoherenceApp from './CoherenceApp'
import './coherence-index.css'

type Props = {
  initialStory?: string
}

/**
 * Coherence intake inside Legal Shaman chrome (Header/Footer provided by page).
 */
export function CoherenceAskShell({ initialStory = '' }: Props) {
  return (
    <div className="coherence-ask-root bg-background">
      <CoherenceApp initialStory={initialStory} />
    </div>
  )
}
