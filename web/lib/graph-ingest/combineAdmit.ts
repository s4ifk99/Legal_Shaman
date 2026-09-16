import { classifyHelpDoorKind } from '@/lib/coherence/peopleFirst'
import type { AiCriticDecision, AdmitResult, CrawlHit, HardGate } from './types'

const SELF_ALLOW_MIN = 0.82

export function combineAdmit(
  hit: CrawlHit,
  hard: HardGate,
  ai: AiCriticDecision | null,
): AdmitResult {
  const doorKind =
    ai?.doorKind ||
    classifyHelpDoorKind(hit.title, '', 'match_free_help')
  const reasons: string[] = [`hard:${hard.code}`]
  if (ai) {
    reasons.push(`ai:${ai.vote}`, ...(ai.reasons || []).slice(0, 4))
  }

  const base = {
    url: hit.url,
    title: hit.title,
    hard,
    ai,
    doorKind,
    reasons,
  }

  if (hard.action === 'deny') {
    return {
      ...base,
      status: 'denied',
      hardDenyWins: true,
      clientVisible: false,
      reasons: [...reasons, 'hard_deny_cannot_be_overridden_by_ai'],
    }
  }

  if (ai?.looksLikeLegalAdvice) {
    if (hard.action === 'allow') {
      return {
        ...base,
        status: 'review',
        hardDenyWins: false,
        clientVisible: false,
        reasons: [...reasons, 'ai_flagged_legal_advice_on_authority_host'],
      }
    }
    return {
      ...base,
      status: 'denied',
      hardDenyWins: false,
      clientVisible: false,
      reasons: [...reasons, 'ai_self_deny_legal_advice_shape'],
    }
  }

  if (hard.action === 'allow') {
    if (ai?.vote === 'deny') {
      return {
        ...base,
        status: 'review',
        hardDenyWins: false,
        clientVisible: false,
        reasons: [...reasons, 'authority_host_but_ai_denied_hold_for_review'],
      }
    }
    return {
      ...base,
      status: 'admitted',
      hardDenyWins: false,
      clientVisible: true,
    }
  }

  // Unknown host
  if (!ai) {
    return {
      ...base,
      status: 'review',
      hardDenyWins: false,
      clientVisible: false,
      reasons: [...reasons, 'unknown_host_needs_ai_or_human'],
    }
  }

  if (ai.vote === 'deny') {
    return {
      ...base,
      status: 'denied',
      hardDenyWins: false,
      clientVisible: false,
    }
  }

  if (ai.vote === 'review' || ai.doorKind === 'firm') {
    return {
      ...base,
      status: 'review',
      hardDenyWins: false,
      clientVisible: false,
      reasons: [...reasons, ai.doorKind === 'firm' ? 'firms_stay_on_sra_graph' : 'ai_asked_review'],
    }
  }

  const selfAllow =
    ai.vote === 'allow' &&
    ai.ukPublicHelp &&
    (ai.confidence || 0) >= SELF_ALLOW_MIN &&
    (ai.doorKind === 'cab' ||
      ai.doorKind === 'law_centre' ||
      ai.doorKind === 'duty' ||
      ai.doorKind === 'regulator' ||
      ai.doorKind === 'specialist') &&
    hard.code === 'uk_charity_shape'

  if (selfAllow) {
    return {
      ...base,
      status: 'self_allowed_queue',
      hardDenyWins: false,
      clientVisible: false,
      reasons: [...reasons, 'ai_self_allow_into_candidate_queue_not_live_matching'],
    }
  }

  return {
    ...base,
    status: 'review',
    hardDenyWins: false,
    clientVisible: false,
  }
}
