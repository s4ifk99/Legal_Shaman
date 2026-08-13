import './ClosingNextSteps.css'

interface Props {
  onFindHelp: () => void
  onDownloadNotes: () => void
  onOslaw: () => void
  onAddDetail: () => void
  servicesReady: boolean
  preferOslaw?: boolean
  overviewReady?: boolean
  overviewLoading?: boolean
}

export function ClosingNextSteps({
  onFindHelp,
  onDownloadNotes,
  onOslaw,
  onAddDetail,
  servicesReady,
  preferOslaw = false,
  overviewReady = true,
  overviewLoading = false,
}: Props) {
  return (
    <section className="closing" aria-live="polite">
      <p className="closing__eyebrow">You’re ready for the next step</p>
      <h2 className="closing__title">What would you like to do now?</h2>
      <p className="closing__lead">
        We’ve captured enough to continue. Choose how to proceed — you can come back and add more
        anytime.
      </p>

      <div className="closing__actions">
        <button
          type="button"
          className={`closing__card${preferOslaw ? ' closing__card--primary' : ''}`}
          onClick={onOslaw}
          disabled={overviewLoading || !overviewReady}
        >
          <span className="closing__card-label">OSLAW — wiki course of action</span>
          <span className="closing__card-hint">
            {overviewLoading
              ? 'Synthesising your recommendation from wiki sources…'
              : overviewReady
                ? 'Open-source research: matched pathways and practical next steps from official guidance'
                : 'Recommendation will appear once synthesis completes'}
          </span>
        </button>

        <button
          type="button"
          className={`closing__card${!preferOslaw ? ' closing__card--primary' : ''}`}
          onClick={onFindHelp}
          disabled={!servicesReady}
        >
          <span className="closing__card-label">Find people to help</span>
          <span className="closing__card-hint">
            {servicesReady
              ? 'See matching advisers and GOV.UK guidance for your situation'
              : 'Add a place (city or nation) so we can unlock matching help'}
          </span>
        </button>

        <button type="button" className="closing__card" onClick={onDownloadNotes}>
          <span className="closing__card-label">Download notes &amp; timeline</span>
          <span className="closing__card-hint">
            Get a copy to share with a solicitor — PDF, email, or copy text
          </span>
        </button>
      </div>

      <button type="button" className="closing__more" onClick={onAddDetail}>
        Or add another detail to your story
      </button>
    </section>
  )
}
