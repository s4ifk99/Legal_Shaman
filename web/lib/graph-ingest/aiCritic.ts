import { openRouterJsonCompletion } from '@/lib/reddit-search/openrouter-client'
import { resolveLlmApiKey } from '@/lib/llm/openrouter'
import type { AiCriticDecision, CrawlHit } from './types'

export const ADMIT_CRITIC_SYSTEM = `You admit UK legal *signposting* sources into Legal Shaman's help graph.
You are not a lawyer. Never treat a page as legal advice.

Vote:
- deny: forums, SEO mills, "you should claim/sue", unregulated advice chat, prosecutors dressed as solicitors, non-UK marketing.
- allow: official or established public-help doors (GOV.UK, CAB, Law Centre, duty scheme, regulator, named charity helpline).
- review: law firm blogs, unknown commercial sites, mixed or thin pages.

JSON only:
{"vote":"allow"|"deny"|"review","confidence":0-1,"doorKind":"duty"|"law_centre"|"cab"|"regulator"|"specialist"|"firm"|null,"looksLikeLegalAdvice":boolean,"ukPublicHelp":boolean,"reasons":[string]}

ukPublicHelp is true only for free/public bodies or charities a frightened person can actually contact — not paid lead-gen.
doorKind firm must be review, never a live auto-allow (SRA register is the firm graph).`

export function parseAiCriticJson(raw: unknown): AiCriticDecision | null {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!o) return null
  const vote = o.vote
  if (vote !== 'allow' && vote !== 'deny' && vote !== 'review') return null
  const door =
    o.doorKind === 'duty' ||
    o.doorKind === 'law_centre' ||
    o.doorKind === 'cab' ||
    o.doorKind === 'regulator' ||
    o.doorKind === 'specialist' ||
    o.doorKind === 'firm'
      ? o.doorKind
      : null
  const reasons = Array.isArray(o.reasons)
    ? o.reasons.map((r) => String(r).slice(0, 160)).filter(Boolean).slice(0, 6)
    : []
  const confidence = Math.min(1, Math.max(0, Number(o.confidence) || 0))
  return {
    vote,
    confidence,
    doorKind: door,
    looksLikeLegalAdvice: Boolean(o.looksLikeLegalAdvice),
    ukPublicHelp: Boolean(o.ukPublicHelp),
    reasons,
  }
}

export async function runAiSourceCritic(hit: CrawlHit): Promise<AiCriticDecision | null> {
  if (!resolveLlmApiKey()) return null
  const user = JSON.stringify({
    url: hit.url,
    title: hit.title,
    excerpt: (hit.excerpt || '').slice(0, 1200),
  })
  try {
    const raw = await openRouterJsonCompletion(ADMIT_CRITIC_SYSTEM, user)
    return parseAiCriticJson(raw)
  } catch {
    return null
  }
}
