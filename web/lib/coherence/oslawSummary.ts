import type { SessionState } from './types'
import {
  OSLAW_RIGHTS,
  OSLAW_RIGHTS_GENERIC,
  RIGHTS_CAVEAT,
  type RightsBullet,
  type RightsSummary,
} from './oslawRights'
import { tidySentence } from './timelineExtract'

export type SourceSnippet = {
  title: string
  url: string
  preview: string
  authority?: string
}

const CATALOGUE_LOADERS: Record<string, () => Promise<{ default: { articles: CatalogueArticle[] } }>> = {
  'citizens-advice': () => import('@/data/coherence/catalogues/citizens-advice.json'),
  advicenow: () => import('@/data/coherence/catalogues/advicenow.json'),
  govuk: () => import('@/data/coherence/catalogues/govuk.json'),
  shelter: () => import('@/data/coherence/catalogues/shelter.json'),
  acas: () => import('@/data/coherence/catalogues/acas.json'),
}

type CatalogueArticle = {
  title?: string
  sourceUrl?: string
  bodyPreview?: string
  description?: string
  authority?: string
}

let snippetIndex: Map<string, SourceSnippet> | null = null

function normUrl(u: string): string {
  return u.trim().replace(/\/+$/, '').toLowerCase()
}

function cleanPreview(raw: string): string {
  return raw
    .replace(/^#+\s*/gm, '')
    .replace(/^\*\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420)
}

async function ensureSnippetIndex(): Promise<Map<string, SourceSnippet>> {
  if (snippetIndex) return snippetIndex
  const map = new Map<string, SourceSnippet>()
  await Promise.all(
    Object.values(CATALOGUE_LOADERS).map(async (load) => {
      try {
        const mod = await load()
        for (const a of mod.default.articles || []) {
          const url = (a.sourceUrl || '').trim()
          if (!url) continue
          const preview = cleanPreview(a.bodyPreview || a.description || '')
          if (!preview) continue
          map.set(normUrl(url), {
            title: (a.title || 'Open guidance').replace(/\s*[|–—-]\s*(Citizens Advice|Advicenow|GOV\.UK|Shelter|ACAS).*$/i, '').trim(),
            url,
            preview,
            authority: a.authority,
          })
        }
      } catch {
        // optional catalogue missing
      }
    }),
  )
  snippetIndex = map
  return map
}

/** Resolve catalogue snippets for pathway source URLs (best-effort). */
export async function loadSourceSnippets(urls: string[], limit = 5): Promise<SourceSnippet[]> {
  const index = await ensureSnippetIndex()
  const out: SourceSnippet[] = []
  const seen = new Set<string>()
  for (const url of urls) {
    const hit = index.get(normUrl(url))
    if (!hit || seen.has(normUrl(url))) continue
    seen.add(normUrl(url))
    out.push(hit)
    if (out.length >= limit) break
  }
  return out
}

export function buildHeuristicRightsSummary(
  pathwayId: string,
  snippets: SourceSnippet[],
): RightsSummary {
  const base = OSLAW_RIGHTS[pathwayId] ?? OSLAW_RIGHTS_GENERIC
  const bullets: RightsBullet[] = base.bullets.map((text) => ({ text }))

  // Attach top snippets as cited elaborations when they add distinct titles
  for (const s of snippets.slice(0, 3)) {
    const already = bullets.some((b) => b.sourceUrl === s.url)
    if (already) continue
    const line = s.preview.split(/[.!?]/).map((p) => p.trim()).find((p) => p.length > 40)
    if (!line) continue
    bullets.push({
      text: tidySentence(line),
      sourceTitle: s.title,
      sourceUrl: s.url,
    })
  }

  return {
    overview: base.overview,
    bullets: bullets.slice(0, 7),
    origin: 'heuristic',
    caveat: RIGHTS_CAVEAT,
  }
}

const ADVICE_BAN =
  /\b(you should sue|you have a (strong|good) claim|i advise|you will win|definitely entitled|you are entitled to £)\b/i

function parseRightsJson(content: string): { overview: string; bullets: string[] } | null {
  try {
    const cleaned = content.replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    const data = JSON.parse(cleaned) as { overview?: string; bullets?: string[] }
    const overview = (data.overview || '').trim()
    const bullets = (data.bullets || []).map((b) => String(b).trim()).filter((b) => b.length >= 20)
    if (overview.length < 40 || overview.length > 900) return null
    if (bullets.length < 2) return null
    if (ADVICE_BAN.test(overview) || bullets.some((b) => ADVICE_BAN.test(b))) return null
    return { overview, bullets: bullets.slice(0, 6) }
  } catch {
    return null
  }
}

/**
 * Ask OpenRouter to write a rights summary grounded only in provided wiki snippets + story.
 * Returns null on failure — caller keeps heuristic.
 */
export async function enhanceRightsSummaryWithLlm(
  session: SessionState,
  pathwayTitle: string,
  heuristic: RightsSummary,
  snippets: SourceSnippet[],
  signal?: AbortSignal,
): Promise<RightsSummary | null> {
  if (snippets.length === 0) return null

  const system = `You write a short OSLAW rights summary for a UK open-source legal research tool.

Rules:
- Use ONLY the provided wiki / catalogue source snippets. Do not invent statutes, deadlines, or case outcomes not supported by the snippets.
- Summarise what rights and remedies those open sources describe for someone in this situation.
- Plain language. No solicitor tone. NOT legal advice.
- Never say the person "will win", "should sue", or that they are "definitely entitled" to a specific sum.
- Prefer "open guidance commonly says…" / "sources describe…" wording.
- Return JSON only: { "overview": string (2–4 sentences), "bullets": string[] (3–6 short rights/remedy points) }`

  const user = JSON.stringify(
    {
      pathway: pathwayTitle,
      situation: {
        matterType: session.matterType,
        whatHappened: session.whatHappened,
        howCaused: session.howCaused,
        goal: session.goal,
        recentInputs: session.rawInputs.slice(-4),
      },
      heuristic_overview: heuristic.overview,
      sources: snippets.map((s) => ({
        title: s.title,
        url: s.url,
        excerpt: s.preview,
      })),
    },
    null,
    2,
  )

  try {
    const res = await fetch('/api/coherence/llm/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, user }),
      signal,
    })
    const data = (await res.json()) as { content?: string }
    if (!res.ok || !data.content) return null
    const parsed = parseRightsJson(data.content)
    if (!parsed) return null

    const bullets: RightsBullet[] = parsed.bullets.map((text, i) => ({
      text,
      sourceTitle: snippets[i % snippets.length]?.title,
      sourceUrl: snippets[i % snippets.length]?.url,
    }))

    return {
      overview: parsed.overview,
      bullets,
      origin: 'llm',
      caveat: RIGHTS_CAVEAT,
    }
  } catch {
    return null
  }
}
