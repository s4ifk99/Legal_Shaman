/**
 * Chen et al. style translation for retrieval: lay UK English → guidance/statute register.
 * Heuristic glossary first; optional LLM polish via OpenRouter proxy.
 */

import type { MatterType, SessionState } from './types'
import type { SearchContextProfile } from './searchContext'

/** Lay → formal UK legal/guidance phrasing (retrieval only — not advice). */
const GLOSSARY: Array<[RegExp, string]> = [
  [/\bhome office\b/gi, 'Home Office UKVI'],
  [/\bilr\b/gi, 'indefinite leave to remain ILR'],
  [/\bsettled status\b/gi, 'EU Settlement Scheme settled status'],
  [/\bsection\s*21\b/gi, 'section 21 Housing Act 1988 notice seeking possession'],
  [/\bsection\s*8\b/gi, 'section 8 Housing Act 1988 notice seeking possession'],
  [/\bdeposit\b/gi, 'tenancy deposit'],
  [/\bmydeposits\b/gi, 'mydeposits authorised tenancy deposit scheme'],
  [/\breposit\b/gi, 'Reposit deposit alternative scheme'],
  [/\bdps\b/gi, 'Deposit Protection Service DPS'],
  [/\btds\b/gi, 'Tenancy Deposit Scheme TDS'],
  [/\bast\b/gi, 'assured shorthold tenancy AST'],
  [/\blandlord\b/gi, 'landlord'],
  [/\bflatmate\b/gi, 'joint tenant housemate'],
  [/\bsacked\b/gi, 'dismissed terminated employment'],
  [/\bfired\b/gi, 'dismissed'],
  [/\bredundan(?:cy|t)\b/gi, 'redundancy'],
  [/\bconstructive dismissal\b/gi, 'constructive unfair dismissal'],
  [/\bunfair dismissal\b/gi, 'unfair dismissal Employment Rights Act'],
  [/\bacas\b/gi, 'ACAS early conciliation'],
  [/\bwages?\b/gi, 'wages unpaid wages unlawful deduction'],
  [/\brepossess(?:ion|ed)?\b/gi, 'mortgage possession repossession'],
  [/\bbailiff\b/gi, 'county court bailiff enforcement'],
  [/\bchild trust fund\b/gi, 'Child Trust Fund CTF'],
  [/\be-?bike\b/gi, 'electrically assisted pedal cycle EAPC'],
]

const MATTER_HINTS: Partial<Record<MatterType, string>> = {
  housing: 'housing tenancy possession deposit protection England Wales',
  employment: 'employment rights dismissal redundancy ACAS tribunal',
  immigration: 'immigration leave to remain visa Home Office UKVI',
  debt: 'debt mortgage possession creditor',
  consumer: 'consumer rights refund faulty goods CRA 2015',
  family: 'family children finances',
  crime: 'criminal police property seizure',
  personal_injury: 'personal injury negligence accident',
  conveyancing: 'property purchase conveyancing',
}

export function glossaryStyleTranslate(text: string, matterType: MatterType = 'unknown'): string {
  let out = text.trim()
  if (!out) return ''
  for (const [re, replacement] of GLOSSARY) {
    out = out.replace(re, replacement)
  }
  const hint = MATTER_HINTS[matterType]
  if (hint && !out.toLowerCase().includes(hint.split(' ')[0]!)) {
    out = `${out} ${hint}`
  }
  return out.replace(/\s+/g, ' ').trim()
}

const STYLE_SYSTEM = `You rewrite a UK layperson legal question into a RETRIEVAL query for matching official guidance and statutes.
Rules:
- Keep the same facts; do not invent statutes, case names, or outcomes.
- Prefer UK formal register used on GOV.UK / Citizens Advice / legislation (e.g. "assured shorthold tenancy", "deposit protection", "indefinite leave to remain").
- Output ONE line only: keywords and noun phrases good for search, not a full polite question.
- No legal advice. No US terms (lawsuit, statute of limitations).`

/**
 * Optional LLM style pass. Returns null on failure — caller keeps glossary output.
 */
export async function llmStyleTranslate(
  layQuery: string,
  profile: SearchContextProfile,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!layQuery.trim()) return null
  try {
    const res = await fetch('/api/coherence/llm/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: STYLE_SYSTEM,
        user: JSON.stringify(
          {
            lay_query: layQuery,
            context: {
              matter: profile.matterType,
              jurisdiction: profile.jurisdiction,
              role: profile.role,
              intent: profile.intent,
            },
          },
          null,
          2,
        ),
      }),
      signal,
    })
    const data = (await res.json()) as { content?: string }
    if (!res.ok || !data.content) return null
    const line = data.content
      .replace(/^```[\w]*\s*/i, '')
      .replace(/```$/i, '')
      .trim()
      .split('\n')[0]
      ?.replace(/^["']|["']$/g, '')
      .trim()
    if (!line || line.length < 8) return null
    return line.slice(0, 400)
  } catch {
    return null
  }
}

/** Glossary always; LLM when available. */
export async function styleTranslateForRetrieval(
  session: SessionState,
  profile: SearchContextProfile,
  signal?: AbortSignal,
): Promise<{ glossary: string; retrieval: string; usedLlm: boolean }> {
  const lay =
    session.confirmedSearchQuery.trim() ||
    session.rawInputs.find((r) => r.trim().length >= 8)?.trim() ||
    session.whatHappened.trim() ||
    ''
  const glossary = glossaryStyleTranslate(lay, session.matterType)
  const llm = await llmStyleTranslate(lay || glossary, profile, signal)
  if (llm) {
    // Fuse: LLM line + glossary matter hint tokens not already present
    const fused = `${llm} ${glossary}`.replace(/\s+/g, ' ').trim()
    return { glossary, retrieval: fused.slice(0, 600), usedLlm: true }
  }
  return { glossary, retrieval: glossary, usedLlm: false }
}
