import type { SraSearchMeta } from './sraLive'

/** User-facing footnote under Matching help — never expose dev infra details in production. */
export function sraRegisterFootnote(meta: SraSearchMeta | undefined): string {
  if (meta?.hitsReturned && meta.hitsReturned > 0) {
    return meta.reachable
      ? `Live SRA register: ${meta.total?.toLocaleString() ?? '—'} organisations. `
      : 'Firms matched from the SRA register. '
  }
  if (meta?.emptyReason === 'no_practice_route') {
    return 'This dispute could not be routed to an SRA practice area yet — add detail or a location. '
  }
  if (meta?.emptyReason === 'no_matches') {
    return 'No SRA firms matched this dispute type on the live register. '
  }
  if (meta?.reachable) {
    return `Live SRA register: ${meta.total?.toLocaleString() ?? '—'} organisations. `
  }
  if (!meta?.configured || meta?.emptyReason === 'unavailable' || meta?.emptyReason === 'http_error') {
    if (process.env.NODE_ENV === 'development') {
      return 'Live SRA register temporarily unreachable — ensure DATA_DATABASE_URL Postgres is running locally, then refresh. '
    }
    return 'Live SRA firm matching is temporarily unavailable — use the official directories below. '
  }
  return 'Live SRA firm matching is temporarily unavailable — use the official directories below. '
}

/** Above-the-fold Matching Help alert when the SRA lane failed or returned nothing. */
export function sraLaneAlert(meta: SraSearchMeta | undefined, firmCount: number): {
  tone: 'alert' | 'status'
  title: string
  detail: string
} | null {
  if (firmCount > 0) return null
  if (!meta) {
    return {
      tone: 'status',
      title: 'SRA firms not loaded yet',
      detail: 'Matching help is still checking the live register.',
    }
  }
  if (!meta.reachable || meta.emptyReason === 'unavailable' || meta.emptyReason === 'http_error') {
    return {
      tone: 'alert',
      title: 'Live SRA matching unavailable',
      detail:
        'The SRA register could not be queried for named firms. Official directories below still work — this is not a curated firm list.',
    }
  }
  if (meta.emptyReason === 'no_practice_route') {
    return {
      tone: 'alert',
      title: 'No SRA practice route for this dispute',
      detail:
        'We could not map this matter onto a register work area. Add a town/postcode or more detail so Matching Help can query firms.',
    }
  }
  return {
    tone: 'status',
    title: 'No SRA-regulated firms matched',
    detail: meta.reachable
      ? 'The live register returned no firms for this dispute type. Add a town or postcode to rank nearby practices, or use the official directories.'
      : 'No named firms matched. Use the official directories below while Matching Help retries the register.',
  }
}
