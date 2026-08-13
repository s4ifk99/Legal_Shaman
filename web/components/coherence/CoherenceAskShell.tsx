'use client'

import Link from 'next/link'
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
      <div className="coherence-local-banner border-b border-border/70 bg-muted/40 px-4 py-2 text-sm text-muted-foreground md:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
          <span>
            <span className="font-medium text-primary">Coherence intake</span>
            <span className="text-muted-foreground"> · V2 preview</span>
          </span>
          <span className="flex gap-4 text-sm">
            <Link href="/ask-the-shaman?classic=1" className="font-medium text-primary hover:underline">
              Classic Ask
            </Link>
            <Link href="/ask-the-shaman?guided=1" className="font-medium text-primary hover:underline">
              Find a lawyer
            </Link>
          </span>
        </div>
      </div>
      <CoherenceApp initialStory={initialStory} />
    </div>
  )
}
