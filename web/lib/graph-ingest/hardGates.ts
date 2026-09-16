/**
 * Deterministic Admit gates. AI cannot override a hard deny.
 */
import { authorityTierForUrl, hostFromUrl } from '@/lib/coherence/authorityAllowlist'
import { sraOrganisationAdmissible } from '@/lib/matter/graphAdmissibility'
import type { CrawlHit, HardGate } from './types'

const ADVICE_SHAPED =
  /\b(you should (?:sue|claim|instruct)|I recommend you (?:sue|claim)|this is legal advice|guaranteed compensation|no win no fee)\b/i

const SEO_MILL =
  /\b(best solicitor near me|click here for a lawyer|ai lawyer chat|instant legal advice)\b/i

export function hardGateHit(hit: CrawlHit): HardGate {
  const url = (hit.url || '').trim()
  const title = hit.title || ''
  const excerpt = hit.excerpt || ''
  const blob = `${title} ${excerpt}`

  if (!/^https:\/\//i.test(url)) {
    return { action: 'deny', code: 'insecure_or_invalid_url', detail: 'Only https URLs may enter the graph' }
  }
  const host = hostFromUrl(url)
  if (!host) {
    return { action: 'deny', code: 'bad_host', detail: 'Could not parse host' }
  }
  const tier = authorityTierForUrl(url)
  if (tier === 'blocked') {
    return { action: 'deny', code: 'blocked_host', detail: host }
  }
  if (ADVICE_SHAPED.test(blob)) {
    return {
      action: 'deny',
      code: 'advice_shaped',
      detail: 'Looks like legal advice or claims marketing, not a signpost door',
    }
  }
  if (SEO_MILL.test(blob)) {
    return { action: 'deny', code: 'seo_mill', detail: 'Lead-gen / SEO mill copy' }
  }
  if (!sraOrganisationAdmissible(title) && /solicitor|law firm|llp/i.test(title)) {
    return { action: 'deny', code: 'not_a_solicitor_org', detail: title }
  }
  if (tier === 'primary' || tier === 'secondary' || tier === 'tertiary') {
    return { action: 'allow', code: `authority_${tier}`, detail: host }
  }
  if (tier === 'firm') {
    return {
      action: 'unknown',
      code: 'known_firm_commentary',
      detail: 'Firm blogs are commentary — review before treating as a help door',
    }
  }
  if (/\.org\.uk$/i.test(host) || host.endsWith('.org.uk')) {
    return { action: 'unknown', code: 'uk_charity_shape', detail: host }
  }
  return { action: 'unknown', code: 'unlisted_host', detail: host }
}
