import { Hourglass } from 'lucide-react'
import './SynthesisHourglass.css'

type Props = {
  label?: string
  size?: 'sm' | 'md'
}

/** Animated hourglass for overview / wiki synthesis in progress. */
export function SynthesisHourglass({
  label = 'Synthesising your recommendation…',
  size = 'md',
}: Props) {
  return (
    <span
      className={`synth-hourglass synth-hourglass--${size}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="synth-hourglass__icon" aria-hidden="true">
        <Hourglass className="synth-hourglass__svg" strokeWidth={1.75} />
      </span>
      <span className="synth-hourglass__label">{label}</span>
    </span>
  )
}
