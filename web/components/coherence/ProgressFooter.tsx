import { FOOTER_DISCLAIMER } from '@/lib/coherence/compliance'
import './ProgressFooter.css'

interface Props {
  progress: number
  serviceConfidence: number
  /** After first submission — show faint Notes button */
  notesVisible: boolean
  /** Intake complete enough for full Notes CTA */
  notesReady: boolean
  /** End-of-intake close — clearer next-step labels */
  closing?: boolean
  onShowServices: () => void
  onShowNotes: () => void
}

export function ProgressFooter({
  progress,
  serviceConfidence,
  notesVisible,
  notesReady,
  closing = false,
  onShowServices,
  onShowNotes,
}: Props) {
  const showServices = serviceConfidence >= 0.75 || closing
  const displayProgress = closing ? 100 : progress

  return (
    <footer className="footer">
      <div className="footer__progress">
        <div className="footer__meta">
          <span>{closing ? 'Ready for next step' : 'Progress toward next stage'}</span>
          <span className="footer__pct">{displayProgress}%</span>
        </div>
        <div
          className="footer__track"
          role="progressbar"
          aria-valuenow={displayProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={closing ? 'Intake complete' : 'Intake progress'}
        >
          <div className="footer__fill" style={{ width: `${displayProgress}%` }} />
        </div>
      </div>

      <div className="footer__actions">
        {notesVisible && (
          <button
            type="button"
            className={[
              'footer__notes',
              notesReady || closing ? 'footer__notes--ready' : 'footer__notes--draft',
            ].join(' ')}
            onClick={onShowNotes}
            aria-label={
              closing || notesReady
                ? 'Download notes and timeline for your lawyer'
                : 'Notes for your Lawyer — draft preview'
            }
          >
            {closing ? 'Download notes & timeline' : 'Notes for your Lawyer'}
            {!notesReady && !closing && <span className="footer__notes-tag">Draft</span>}
          </button>
        )}

        {showServices && (
          <button type="button" className="footer__services" onClick={onShowServices}>
            {closing ? 'Find people to help' : 'Show services'}
          </button>
        )}
      </div>

      <p className="footer__disclaimer">{FOOTER_DISCLAIMER}</p>
    </footer>
  )
}
