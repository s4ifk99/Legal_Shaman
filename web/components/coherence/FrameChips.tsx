import type { LegalFrame } from '@/lib/coherence/frames'
import './FrameChips.css'

interface Props {
  frames: LegalFrame[]
}

export function FrameChips({ frames }: Props) {
  if (frames.length === 0) return null

  return (
    <section className="frames" aria-label="Possible legal frames">
      <p className="frames__lead">Possible frames (local fit — not advice)</p>
      <ul className="frames__list">
        {frames.map((f) => (
          <li key={f.id} className="frames__item">
            <span className="frames__label">
              {f.label}
              {typeof f.fitScore === 'number' ? (
                <span className="frames__fit"> · fit {f.fitScore}</span>
              ) : null}
            </span>
            <span className="frames__why">{f.why}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
