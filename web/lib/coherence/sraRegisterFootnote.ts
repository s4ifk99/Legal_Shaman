import type { SraSearchMeta } from './sraLive'

/** User-facing footnote under Matching help — never expose dev infra details in production. */
export function sraRegisterFootnote(meta: SraSearchMeta | undefined): string {
  if (meta?.reachable) {
    return `Live SRA register: ${meta.total?.toLocaleString() ?? '—'} organisations. `
  }
  if (!meta?.configured) {
    return 'Live SRA firm matching is temporarily unavailable — use the official directories below. '
  }
  if (process.env.NODE_ENV === 'development') {
    return 'Live SRA register temporarily unreachable — ensure DATA_DATABASE_URL Postgres is running locally, then refresh. '
  }
  return 'Live SRA firm matching is temporarily unavailable — use the official directories below. '
}
