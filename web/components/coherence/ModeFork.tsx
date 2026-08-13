import type { Mode } from '@/lib/coherence/types'
import './ModeFork.css'

interface Props {
  onChoose: (mode: Mode) => void
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

export function ModeFork({ onChoose }: Props) {
  return (
    <div className="mode-fork" role="group" aria-label="How do you want to use this?">
      <p className="mode-fork__lead">How do you want to start?</p>
      <div className="mode-fork__row">
        {CHOICES.map((c) => (
          <button
            key={c.mode}
            type="button"
            className="mode-fork__chip"
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
