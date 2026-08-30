'use client'

import './PageNavigation.css'

export interface PageNavigationProps {
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
}

export function PageNavigation({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: PageNavigationProps) {
  return (
    <nav className="page-navigation" aria-label="Page navigation">
      <button
        type="button"
        className="page-navigation__button"
        aria-label="Previous page"
        onClick={onBack}
        disabled={!canGoBack}
      >
        <span aria-hidden="true">←</span>
        <span className="page-navigation__label">Back</span>
      </button>
      <span className="page-navigation__hint">Page navigation</span>
      <button
        type="button"
        className="page-navigation__button page-navigation__button--forward"
        aria-label="Next page"
        onClick={onForward}
        disabled={!canGoForward}
      >
        <span className="page-navigation__label">Next</span>
        <span aria-hidden="true">→</span>
      </button>
    </nav>
  )
}
