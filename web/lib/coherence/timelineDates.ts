import type { DatePrecision, TimelineEvent } from './types'

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

export function guessDatePrecision(dateApprox: string | undefined): DatePrecision {
  if (!dateApprox) return 'unknown'
  if (/\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/.test(dateApprox)) return 'day'
  if (/\w+\s+\d{4}|\d{4}-\d{2}/.test(dateApprox)) return 'month'
  if (/\d{4}/.test(dateApprox)) return 'year'
  return 'unknown'
}

/** Sort key in milliseconds; undated events sort last (Infinity). */
export function dateSortKey(event: TimelineEvent): number {
  const raw = (event.dateApprox || '').trim()
  if (!raw) return Number.POSITIVE_INFINITY
  const iso = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/)
  if (iso) {
    const y = Number(iso[1])
    const m = Number(iso[2]) - 1
    const d = iso[3] ? Number(iso[3]) : 1
    return Date.UTC(y, m, d)
  }
  const dmy = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (dmy) {
    const month = MONTHS[dmy[2].toLowerCase()]
    if (month !== undefined) return Date.UTC(Number(dmy[3]), month, Number(dmy[1]))
  }
  const my = raw.match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (my) {
    const month = MONTHS[my[1].toLowerCase()]
    if (month !== undefined) return Date.UTC(Number(my[2]), month, 1)
  }
  const y = raw.match(/\b(19|20)\d{2}\b/)
  if (y) return Date.UTC(Number(y[0]), 0, 1)
  return Number.POSITIVE_INFINITY
}

export function sortTimelineEventsByDate(events: TimelineEvent[]): TimelineEvent[] {
  return events
    .map((event, index) => ({ event, index, t: dateSortKey(event) }))
    .sort((a, b) => {
      if (a.t === b.t) return a.index - b.index
      if (a.t === Number.POSITIVE_INFINITY) return 1
      if (b.t === Number.POSITIVE_INFINITY) return -1
      return a.t - b.t
    })
    .map((row) => row.event)
}

export function parseActorList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
}
