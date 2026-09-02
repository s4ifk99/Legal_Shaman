import type { Mode, SearchMode } from '@/lib/coherence/types'
import './ModeFork.css'

interface Props {
  onChoose: (mode: Mode) => void
  searchMode: SearchMode
  penumbraAcknowledged: boolean
  onSearchMode: (mode: SearchMode) => void
  onAcknowledgePenumbra: () => void
}

const CHOICES: { mode: Mode; label: string; hint: string }[] = [
  {
    mode: 'dispute',
    label: 'Help me explain what happened',
    hint: 'Timeline + grounded questions → notes for a lawyer',
  },
  {
    mode: 'research',
    label: 'OSLAW — open-source research',
    hint: 'Wiki pathways → practical next steps from official guidance (not legal advice)',
  },
  {
    mode: 'browse',
    label: 'Just show services',
    hint: 'Skip deep intake — matter + place, then signposts',
  },
  {
    mode: 'info',
    label: 'Information only',
    hint: 'Light questions, then matching guidance links',
  },
]

export function ModeFork({
  onChoose,
  searchMode,
  penumbraAcknowledged,
  onSearchMode,
  onAcknowledgePenumbra,
}: Props) {
  function chooseSearchMode(mode: SearchMode) {
    if (mode !== 'penumbra' || !penumbraAcknowledged) return
    onSearchMode(mode)
  }

  return (
    <div className="mode-fork" aria-label="How do you want to use this?">
      <section className="mode-fork__search" aria-labelledby="search-mode-title">
        <p className="mode-fork__lead" id="search-mode-title">Third Eye research</p>
        <div className="mode-fork__search-grid" role="radiogroup" aria-label="Search mode">
          <button
            type="button"
            role="radio"
            aria-checked={searchMode === 'penumbra'}
            className={`mode-fork__search-card${searchMode === 'penumbra' ? ' is-selected' : ''}`}
            onClick={() => chooseSearchMode('penumbra')}
          >
            <span className="mode-fork__search-name">Third Eye</span>
            <span className="mode-fork__search-hint">Broader exploratory research</span>
            <span className="mode-fork__search-detail">More commentary and competing views, labelled by source quality and confidence.</span>
          </button>
        </div>
        <p className="mode-fork__risk">
          Third Eye is the main research path: Legal Shaman’s curated sources are supplied first, then The Shaman can explore wider public sources. Findings remain labelled and are checked before they inform the answer.
        </p>
        {!penumbraAcknowledged ? (
          <div className="mode-fork__ack" role="alert">
            <strong>Third Eye is exploratory.</strong>
            <span>Results may be broader or less authoritative. Check the linked sources before acting.</span>
            <button
              type="button"
              className="mode-fork__ack-button"
              onClick={() => {
                onAcknowledgePenumbra()
                onSearchMode('penumbra')
              }}
            >
              I understand — use Third Eye
            </button>
          </div>
        ) : null}
      </section>
      <p className="mode-fork__lead">How do you want to start?</p>
      <div className="mode-fork__row">
        {CHOICES.map((c) => (
          <button
            key={c.mode}
            type="button"
            className="mode-fork__chip"
            disabled={c.mode === 'research' && !penumbraAcknowledged}
            onClick={() => onChoose(c.mode)}
          >
            <span className="mode-fork__label">{c.label}</span>
            <span className="mode-fork__hint">{c.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
