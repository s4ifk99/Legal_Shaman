import { useState, type FormEvent } from 'react'
import {
  NATION_LABEL,
  UK_NATIONS,
  resolveUserLocation,
  type UkNation,
  type UserLocation,
} from '@/lib/coherence/serviceCoverage'

interface Props {
  location: UserLocation | null
  /** null while results are still loading. */
  hiddenCount: number | null
  onChange: (input: string, nation: UkNation | null) => void
}

export function LocationField({ location, hiddenCount, onChange }: Props) {
  const [draft, setDraft] = useState(location?.input ?? '')
  const [needsNation, setNeedsNation] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const value = draft.trim()
    if (!value) {
      setNeedsNation(null)
      onChange('', null)
      return
    }
    const resolved = resolveUserLocation(value)
    if (!resolved.nation) {
      setNeedsNation(value)
      return
    }
    setNeedsNation(null)
    onChange(value, resolved.nation)
  }

  function pickNation(nation: UkNation) {
    const value = needsNation ?? draft.trim()
    setNeedsNation(null)
    onChange(value, nation)
  }

  return (
    <section className="services__location" aria-labelledby="services-location-title">
      <h2 id="services-location-title" className="services__location-title">
        Where are you?
      </h2>
      <p className="services__location-lead">
        We only show help that covers your area, and tell you what you&apos;re missing.
      </p>
      <form className="services__location-form" onSubmit={submit}>
        <label htmlFor="services-location-input" className="services__location-label">
          Town, city or postcode
        </label>
        <div className="services__location-row">
          <input
            id="services-location-input"
            className="services__location-input"
            type="text"
            inputMode="text"
            autoComplete="postal-code"
            placeholder="e.g. Leeds, Cardiff or G1 1AA"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="services__location-submit">
            {location ? 'Update' : 'Show local help'}
          </button>
        </div>
      </form>

      {needsNation ? (
        <fieldset className="services__location-nations">
          <legend>Which part of the UK is “{needsNation}” in?</legend>
          {UK_NATIONS.map((n) => (
            <button
              key={n}
              type="button"
              className="services__location-nation"
              onClick={() => pickNation(n)}
            >
              {NATION_LABEL[n]}
            </button>
          ))}
        </fieldset>
      ) : location ? (
        <p className="services__location-status" role="status">
          Showing help for <strong>{location.label}</strong>.{' '}
          {hiddenCount === null ? null : hiddenCount > 0 ? (
            <a href="#services-missing" className="services__location-missing-link">
              {hiddenCount} matched {hiddenCount === 1 ? 'service doesn’t' : 'services don’t'} cover
              your area — see why
            </a>
          ) : (
            'Every match below covers your area.'
          )}
        </p>
      ) : (
        <p className="services__location-status services__location-status--empty">
          No location yet — some services below may not cover where you live.
        </p>
      )}
    </section>
  )
}
