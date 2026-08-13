import type { PredictiveOption } from '@/lib/coherence/options'
import type { QuestionKind } from '@/lib/coherence/types'
import './PredictiveOptions.css'

interface Props {
  options: PredictiveOption[]
  onSelect: (value: string) => void
  kind?: QuestionKind
}

export function PredictiveOptions({ options, onSelect, kind = 'open' }: Props) {
  if (options.length === 0) return null

  return (
    <div className="predict" aria-label={kind === 'closed' ? 'Answer choices' : 'Suggested answers'}>
      <p className="predict__hint">
        {kind === 'closed' ? 'Tap an answer' : 'Or tap an option — or type / dictate'}
      </p>
      <ul className="predict__list">
        {options.map((opt) => (
          <li key={opt.id}>
            <button type="button" className="predict__option" onClick={() => onSelect(opt.value)}>
              {opt.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
