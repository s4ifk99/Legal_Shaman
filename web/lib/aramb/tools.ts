import { getWikiPageById } from '@/lib/wiki/search'
import type { ResearchSource } from '@/lib/coherence/researchBundle'

export const ARAMB_TOOL_MANIFEST = [
  {
    name: 'legal_shaman_wiki_search',
    description: 'Search only the already scoped Legal Shaman wiki index.',
  },
  {
    name: 'legal_shaman_authority_search',
    description: 'Return matching allowlisted authority snippets and their URLs.',
  },
  {
    name: 'legal_shaman_source_fetch',
    description: 'Fetch an excerpt from a selected Legal Shaman wiki page.',
  },
] as const

function stableSourceKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
}

/**
 * Bounded tool surface for the pilot. These run inside Legal Shaman before
 * The Shaman turn because the current SDK exposes sessions, not custom tool handlers.
 */
export function runScopedResearchTools(
  hits: Array<{ id: string; title: string; score?: number; summary?: string }>,
  authority: Array<{ title: string; url?: string; snippet?: string; dworkinKind?: string }>,
): { sources: ResearchSource[]; trace: string[] } {
  const sources: ResearchSource[] = []
  const trace: string[] = []

  for (const hit of hits.slice(0, 14)) {
    const page = getWikiPageById(hit.id)
    const excerpt = (page?.content || hit.summary || '').replace(/\s+/g, ' ').trim().slice(0, 900)
    if (!excerpt) continue
    sources.push({
      id: `wiki-${hit.id}`,
      title: hit.title,
      url: '',
      tier: 'wiki',
      excerpt,
      origin: 'curated',
      verified: true,
    })
  }
  trace.push(`legal_shaman_wiki_search:${hits.length}`)

  for (const item of authority.slice(0, 8)) {
    const excerpt = String(item.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 900)
    if (!item.title || !excerpt) continue
    sources.push({
      id: `authority-${stableSourceKey(`${item.title}-${item.url || ''}`)}`,
      title: item.title,
      url: item.url || '',
      tier: item.dworkinKind === 'rule' ? 'primary-law' : 'official',
      excerpt,
      origin: 'curated',
      verified: true,
    })
  }
  trace.push(`legal_shaman_authority_search:${authority.length}`)
  trace.push(`legal_shaman_source_fetch:${sources.length}`)

  return { sources, trace }
}

export function formatScopedResearchTools(sources: ResearchSource[]): string {
  return sources
    .map(
      (source) =>
        `[${source.id}] ${source.title} (curated; ${source.tier})${source.url ? ` ${source.url}` : ''}\n${source.excerpt}`,
    )
    .join('\n\n')
}
