/**
 * Crawl queries from the frozen issue graph only — never the client novel.
 */
import type { SessionState } from '@/lib/coherence/types'

export type GraphCrawlQuery = {
  id: string
  query: string
  scope: 'allowlist' | 'open'
}

const JURISDICTION: Record<string, string> = {
  EnglandWales: 'England and Wales',
  Scotland: 'Scotland',
  NorthernIreland: 'Northern Ireland',
  Unknown: 'United Kingdom',
}

export function crawlQueriesFromFrozenSession(session: SessionState): {
  ok: boolean
  reason?: string
  queries: GraphCrawlQuery[]
} {
  if (!session.issueGraphFrozen || !session.matterFrame?.primaryIssues?.length) {
    return { ok: false, reason: 'issue_graph_not_frozen', queries: [] }
  }
  const frame = session.matterFrame
  const place = JURISDICTION[session.jurisdiction] || 'United Kingdom'
  const primary = frame.primaryIssues[0]?.slug?.replace(/_/g, ' ') || 'legal help'
  const secondary = frame.secondaryIssues
    .slice(0, 2)
    .map((i) => i.slug.replace(/_/g, ' '))
    .filter(Boolean)
  const queries: GraphCrawlQuery[] = [
    {
      id: 'primary-allowlist',
      query: `${primary} official free advice ${place} Citizens Advice GOV.UK`.slice(0, 220),
      scope: 'allowlist',
    },
  ]
  for (const slug of secondary) {
    queries.push({
      id: `secondary-${slug.replace(/\s+/g, '-')}`,
      query: `${slug} official help ${place}`.slice(0, 220),
      scope: 'allowlist',
    })
  }
  queries.push({
    id: 'people-open',
    query: `${primary} Law Centre Citizens Advice duty solicitor ${place}`.slice(0, 220),
    scope: 'open',
  })
  return { ok: true, queries }
}

export function queryLeaksClientStory(query: string, session: SessionState): boolean {
  const story = (session.whatHappened || '').trim()
  if (story.length < 24) return false
  const needle = story.slice(0, 40).toLowerCase()
  return query.toLowerCase().includes(needle)
}
