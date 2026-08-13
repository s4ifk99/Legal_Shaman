import type { QuestionKind } from '@/lib/coherence/types'
import './PromptBlock.css'

interface Props {
  text: string
  kind?: QuestionKind
  reason?: string
}

export function PromptBlock({ text, kind = 'open', reason }: Props) {
  return (
    <section className="prompt" aria-live="polite">
      <p className="prompt__kind">{kind === 'closed' ? 'Closed question' : 'Open question'}</p>
      <p className="prompt__text">{text}</p>
      {reason && <p className="prompt__reason">{reason}</p>}
    </section>
  )
}
