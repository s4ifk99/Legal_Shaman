import type { SessionState } from './types'
import type { KnowledgeHit } from './knowledgeTypes'

export interface V1WikiPage {
  id: string
  title: string
  category: string
  relativePath: string
  summary: string
  keyInformation: string[]
  practicalGuidance: string[]
  relatedOrganisations: string[]
  sources: { title?: string; url?: string }[] | string[]
  content: string
}

export interface V1WikiHit extends KnowledgeHit {
  layer: 'v1-wiki'
  category: string
}

interface V1WikiBundle {
  meta: {
    sourceIndexedAt: string | null
    importedAt: string
    immigrationCount: number
    gettingHelpCount: number
  }
  immigration: V1WikiPage[]
  gettingHelp: V1WikiPage[]
}

let cache: V1WikiBundle | null = null

async function load(): Promise<V1WikiBundle> {
  if (cache) return cache
  const mod = await import('@/data/coherence/v1WikiKnowledge.json')
  cache = mod.default as V1WikiBundle
  return cache
}

function sessionText(session: SessionState): string {
  return [
    ...session.rawInputs,
    session.whatHappened,
    session.howCaused,
    session.goal,
    ...session.events.map((e) => e.label),
    ...session.documents,
    session.matterType,
    session.locationHint,
  ]
    .join(' ')
    .toLowerCase()
}

function primaryUrl(page: V1WikiPage): string {
  for (const s of page.sources || []) {
    if (typeof s === 'string' && /^https?:\/\//i.test(s)) return s
    if (s && typeof s === 'object' && s.url && /^https?:\/\//i.test(s.url)) return s.url
  }
  if (page.category === 'Immigration and Citizenship') {
    return 'https://www.gov.uk/browse/visas-immigration'
  }
  return 'https://www.gov.uk/browse/justice'
}

function pageHay(page: V1WikiPage): string {
  return `${page.title} ${page.summary} ${page.keyInformation.join(' ')} ${page.content}`.toLowerCase()
}

/** Topic buckets used to stop ILR stories pulling EU settled / NHS fluff. */
function topicFlags(hay: string) {
  return {
    euSettled: /eu settlement|pre-settled|settled status|eea|swiss citizen/.test(hay),
    nhsHealthcare: /healthcare|nhs|immigration health surcharge|ordinarily resident/.test(hay),
    citizenshipForms: /british citizenship|certificate of entitlement|form (ard|nr|em|roa)\b|life in the uk test/.test(
      hay,
    ),
    ukraine: /ukraine|homes for ukraine|upe scheme/.test(hay),
    ilrSettlement: /\bilr\b|indefinite leave|settlement|leave to remain/.test(hay),
    refusalAppeal: /refus|reject|appeal|administrative review|tribunal/.test(hay),
    asylum: /asylum|refugee|protection/.test(hay),
    freeAdvice: /free legal advice|legal aid|pro bono|getting help|funding/.test(hay),
  }
}

function scorePage(page: V1WikiPage, text: string): number {
  let score = 0
  const hay = pageHay(page)
  const pageTopics = topicFlags(hay)
  const sessionTopics = topicFlags(text)
  const parkingStory =
    /\b(car\s*park|parking|pcn|popla|parking (?:fine|ticket|charge)|private parking|penalty charge)\b/i.test(
      text,
    )

  if (parkingStory) {
    if (/parking|pcn|popla|motoring|ticket/.test(hay)) score += 14
    if (/immig|visa|asylum|ilr|settled|citizenship|refugee/.test(hay)) score -= 20
    if (/employment|unfair dismiss|acas|housing|evict|landlord/.test(hay)) score -= 12
    return score
  }

  const tokens = text
    .split(/[^a-z0-9+]+/)
    .filter((t) => t.length > 3)
    .slice(0, 40)

  for (const t of tokens) {
    if (hay.includes(t)) score += t.length > 6 ? 2 : 1
  }

  if (sessionTopics.asylum && pageTopics.asylum) score += 10
  if (sessionTopics.refusalAppeal && pageTopics.refusalAppeal) score += 10
  if (sessionTopics.ilrSettlement && pageTopics.ilrSettlement) score += 10
  if (/visa|sponsor|skilled worker|student/.test(text) && /visa|sponsor|skilled|student/.test(hay))
    score += 6
  if (/legal aid|free advice|pro bono|adviser|solicitor/.test(text) && pageTopics.freeAdvice) score += 6
  if (page.category === 'Getting Help' && /help|advice|solicitor|adviser|clinic|legal aid/.test(text))
    score += 4

  // Title-level boosts for refusal / ILR stories
  if (/\bilr\b|indefinite leave/.test(text) && /\bilr\b|indefinite leave/.test(page.title.toLowerCase()))
    score += 8
  if (/refus|reject|appeal/.test(text) && /refus|appeal|review/.test(page.title.toLowerCase())) score += 8

  const wantsIlr =
    /\bilr\b|indefinite leave/.test(text) ||
    (sessionTopics.ilrSettlement && !sessionTopics.euSettled)
  if (wantsIlr && pageTopics.euSettled && !/\beu\b|eea|settled status|pre-settled/.test(text)) {
    score -= 18
  }
  if (!/health|nhs|hospital|gp|surcharge/.test(text) && pageTopics.nhsHealthcare) {
    score -= 16
  }
  if (
    !/citizenship|naturalis|british citizen|passport|life in the uk/.test(text) &&
    pageTopics.citizenshipForms &&
    !pageTopics.refusalAppeal
  ) {
    score -= 14
  }
  if (!/ukraine/.test(text) && pageTopics.ukraine) {
    score -= 16
  }
  // Prefer refusal/appeal pages when the story is a refusal
  if (sessionTopics.refusalAppeal && pageTopics.refusalAppeal && pageTopics.ilrSettlement) score += 4

  return score
}

/**
 * Match V1 Obsidian wiki articles (Immigration + Getting Help).
 * Complements Phase 2 compiled GOV.UK wiki — does not replace it.
 */
export async function matchV1Wiki(
  session: SessionState,
  limit = 4,
): Promise<V1WikiHit[]> {
  const bundle = await load()
  const text = sessionText(session)
  const pool =
    session.matterType === 'immigration' ||
    /\bilr\b|visa|home office|deport|asylum|refugee|immigration/.test(text)
      ? [...bundle.immigration, ...bundle.gettingHelp]
      : bundle.gettingHelp

  const scored = pool
    .map((page) => ({ page, score: scorePage(page, text) }))
    .filter((x) => x.score > 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  return scored.map(({ page, score }) => ({
    id: `v1:${page.id}`,
    title: page.title,
    topic: page.category || 'Knowledge',
    description:
      page.summary ||
      page.keyInformation.slice(0, 2).join(' · ') ||
      page.content.slice(0, 180),
    sourceUrl: primaryUrl(page),
    score,
    layer: 'v1-wiki' as const,
    category: page.category,
  }))
}

export async function v1WikiInfo() {
  const bundle = await load()
  return bundle.meta
}
