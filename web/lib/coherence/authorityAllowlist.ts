/**
 * UK authority allowlist + tier scoring (AuthorityBench-inspired).
 * Product path never calls Exa — seeds + domain rules only.
 *
 * Tiers:
 * - primary: legislation
 * - secondary: GOV.UK / CA / ACAS / regulators
 * - tertiary: MoneyHelper / Shelter / Law Society
 * - firm: SRA-regulated firm blogs (commentary only — cite as firm opinion)
 */

export type AuthorityTier = 'primary' | 'secondary' | 'tertiary' | 'firm' | 'blocked'

/** Domains allowed as evidence. Forums / SEO / Reddit are blocked. */
export const UK_AUTHORITY_DOMAINS: Record<string, AuthorityTier> = {
  'legislation.gov.uk': 'primary',
  'gov.uk': 'secondary',
  'www.gov.uk': 'secondary',
  'judiciary.uk': 'secondary',
  'www.judiciary.uk': 'secondary',
  'bailii.org': 'secondary',
  'www.bailii.org': 'secondary',
  'citizensadvice.org.uk': 'secondary',
  'www.citizensadvice.org.uk': 'secondary',
  'acas.org.uk': 'secondary',
  'www.acas.org.uk': 'secondary',
  'sra.org.uk': 'secondary',
  'www.sra.org.uk': 'secondary',
  'lawsociety.org.uk': 'tertiary',
  'www.lawsociety.org.uk': 'tertiary',
  'ico.org.uk': 'secondary',
  'www.ico.org.uk': 'secondary',
  'fca.org.uk': 'secondary',
  'www.fca.org.uk': 'secondary',
  'moneyhelper.org.uk': 'tertiary',
  'www.moneyhelper.org.uk': 'tertiary',
  'shelter.org.uk': 'tertiary',
  'england.shelter.org.uk': 'tertiary',
  /** Higher education student complaints (uni disciplinary / Facebook association cases) */
  'oiahe.org.uk': 'tertiary',
  'www.oiahe.org.uk': 'tertiary',
  /** Rail penalty fares (Exa fallback cache) */
  'orr.gov.uk': 'secondary',
  'www.orr.gov.uk': 'secondary',
  'nationalrail.co.uk': 'tertiary',
  'www.nationalrail.co.uk': 'tertiary',
  /** Victim support / stalking guidance */
  'victimsupport.org.uk': 'tertiary',
  'www.victimsupport.org.uk': 'tertiary',
  'police.uk': 'secondary',
  'www.police.uk': 'secondary',
  'askthe.police.uk': 'secondary',
  'www.askthe.police.uk': 'secondary',
  /** NHS complaints / clinical negligence process */
  'nhs.uk': 'secondary',
  'www.nhs.uk': 'secondary',
  /** UK IPO copyright / trade marks */
  'ipo.gov.uk': 'secondary',
  'www.ipo.gov.uk': 'secondary',
  /** Aviation passenger rights */
  'caa.co.uk': 'secondary',
  'www.caa.co.uk': 'secondary',
  /** Animal welfare */
  'rspca.org.uk': 'tertiary',
  'www.rspca.org.uk': 'tertiary',
  /** Criminal procedure */
  'cps.gov.uk': 'secondary',
  'www.cps.gov.uk': 'secondary',
  /** Solicitor complaints */
  'legalombudsman.org.uk': 'secondary',
  'www.legalombudsman.org.uk': 'secondary',
  /** Energy / telecoms regulators */
  'ofgem.gov.uk': 'secondary',
  'www.ofgem.gov.uk': 'secondary',
  'ofcom.org.uk': 'secondary',
  'www.ofcom.org.uk': 'secondary',
  /** Leasehold */
  'lease-advice.org': 'tertiary',
  'www.lease-advice.org': 'tertiary',
  'housing-ombudsman.org.uk': 'tertiary',
  'www.housing-ombudsman.org.uk': 'tertiary',
  /** Devolved nations */
  'gov.scot': 'secondary',
  'www.gov.scot': 'secondary',
  'mygov.scot': 'secondary',
  'www.mygov.scot': 'secondary',
  'cas.org.uk': 'secondary',
  'www.cas.org.uk': 'secondary',
  'nidirect.gov.uk': 'secondary',
  'www.nidirect.gov.uk': 'secondary',
  'gov.wales': 'secondary',
  'www.gov.wales': 'secondary',
}

/**
 * Curated firm / legal-platform blog hosts (commentary / explainers).
 * Expand carefully — never forums or unregulated SEO “legal advice” mills.
 * Exa R&D shortlist 20260820 merged with Taylor Rose + Lawhive catalogues.
 */
export const UK_LAW_FIRM_DOMAINS: Record<string, string> = {
  'taylor-rose.co.uk': 'Taylor Rose',
  'www.taylor-rose.co.uk': 'Taylor Rose',
  'lawhive.co.uk': 'Lawhive',
  'www.lawhive.co.uk': 'Lawhive',
  // Exa SEO-hub shortlist (20260820) — bootstrap pages in authorityFirmSeedsExa.json
  'harperjames.co.uk': 'Harper James',
  'www.harperjames.co.uk': 'Harper James',
  'howell-jones.com': 'Howell Jones',
  'www.howell-jones.com': 'Howell Jones',
  'levisolicitors.co.uk': 'Levi Solicitors',
  'www.levisolicitors.co.uk': 'Levi Solicitors',
  'anthonygold.co.uk': 'Anthony Gold',
  'www.anthonygold.co.uk': 'Anthony Gold',
  'attwaters.co.uk': 'Attwaters',
  'www.attwaters.co.uk': 'Attwaters',
  'blytheliggins.co.uk': 'Blythe Liggins',
  'www.blytheliggins.co.uk': 'Blythe Liggins',
  'drnlaw.co.uk': 'DRN Law',
  'www.drnlaw.co.uk': 'DRN Law',
  'ellisons.com': 'Ellisons',
  'www.ellisons.com': 'Ellisons',
  'healys.com': 'Healys',
  'www.healys.com': 'Healys',
  'jacksonlees.co.uk': 'Jackson Lees',
  'www.jacksonlees.co.uk': 'Jackson Lees',
  'jcpsolicitors.co.uk': 'JCP Solicitors',
  'www.jcpsolicitors.co.uk': 'JCP Solicitors',
  'joneswhyte.co.uk': 'Jones Whyte',
  'www.joneswhyte.co.uk': 'Jones Whyte',
  'kentonsolicitors.co.uk': 'Kenton Solicitors',
  'www.kentonsolicitors.co.uk': 'Kenton Solicitors',
  'keystonelaw.com': 'Keystone Law',
  'www.keystonelaw.com': 'Keystone Law',
  'lisaslaw.co.uk': "Lisa's Law",
  'www.lisaslaw.co.uk': "Lisa's Law",
  'lyonsdavidson.co.uk': 'Lyons Davidson',
  'www.lyonsdavidson.co.uk': 'Lyons Davidson',
}

const BLOCKED_HOST_RE =
  /reddit\.com|rareddit\.com|quora\.com|facebook\.com|tiktok\.com|pinterest\.com|medium\.com|blogspot\.|wordpress\.com|forbes\.com|expertmarket|ai-lawyer|justanswer/i

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function lawFirmNameForUrl(url: string): string | null {
  const host = hostFromUrl(url)
  if (!host) return null
  if (UK_LAW_FIRM_DOMAINS[host]) return UK_LAW_FIRM_DOMAINS[host]
  if (UK_LAW_FIRM_DOMAINS[`www.${host}`]) return UK_LAW_FIRM_DOMAINS[`www.${host}`]
  // bare host key without www
  for (const [d, name] of Object.entries(UK_LAW_FIRM_DOMAINS)) {
    if (d.replace(/^www\./, '') === host) return name
  }
  return null
}

export function isLawFirmUrl(url: string): boolean {
  return Boolean(lawFirmNameForUrl(url))
}

export function authorityTierForUrl(url: string): AuthorityTier | 'unknown' {
  if (!url || BLOCKED_HOST_RE.test(url)) return 'blocked'
  if (isLawFirmUrl(url)) return 'firm'
  const host = hostFromUrl(url)
  if (!host) return 'unknown'
  if (UK_AUTHORITY_DOMAINS[host]) return UK_AUTHORITY_DOMAINS[host]
  if (UK_AUTHORITY_DOMAINS[`www.${host}`]) return UK_AUTHORITY_DOMAINS[`www.${host}`]
  if (host === 'gov.uk' || host.endsWith('.gov.uk')) return 'secondary'
  return 'unknown'
}

export function isAllowedAuthorityUrl(url: string): boolean {
  const tier = authorityTierForUrl(url)
  return tier === 'primary' || tier === 'secondary' || tier === 'tertiary' || tier === 'firm'
}

/** Higher = more authoritative for ranking. Firm blogs below official tertiary. */
export function authorityScore(url: string, keywordHits = 0): number {
  const tier = authorityTierForUrl(url)
  const base =
    tier === 'primary'
      ? 100
      : tier === 'secondary'
        ? 70
        : tier === 'tertiary'
          ? 40
          : tier === 'firm'
            ? 28
            : tier === 'blocked'
              ? -100
              : 0
  return base + keywordHits * 8
}

/** Exa includeDomains for R&D seed discovery — never auto-call from product. */
export const EXA_RD_INCLUDE_DOMAINS = [
  'legislation.gov.uk',
  'gov.uk',
  'citizensadvice.org.uk',
  'acas.org.uk',
  'sra.org.uk',
  'ico.org.uk',
  'moneyhelper.org.uk',
  'judiciary.uk',
  'bailii.org',
  'oiahe.org.uk',
  'orr.gov.uk',
  'nationalrail.co.uk',
  'victimsupport.org.uk',
  'police.uk',
  'askthe.police.uk',
  'nhs.uk',
  'ipo.gov.uk',
  'caa.co.uk',
  'rspca.org.uk',
  'cps.gov.uk',
  'legalombudsman.org.uk',
  'ofgem.gov.uk',
  'ofcom.org.uk',
  'lease-advice.org',
  'housing-ombudsman.org.uk',
  'gov.scot',
  'mygov.scot',
  'cas.org.uk',
  'nidirect.gov.uk',
  'gov.wales',
  'taylor-rose.co.uk',
  'lawhive.co.uk',
  'harperjames.co.uk',
  'howell-jones.com',
  'levisolicitors.co.uk',
  'anthonygold.co.uk',
  'keystonelaw.com',
  'lyonsdavidson.co.uk',
]

export const EXA_RD_FIRM_DOMAINS = [
  'taylor-rose.co.uk',
  'lawhive.co.uk',
  'harperjames.co.uk',
  'howell-jones.com',
  'levisolicitors.co.uk',
  'anthonygold.co.uk',
  'attwaters.co.uk',
  'keystonelaw.com',
  'jacksonlees.co.uk',
  'lyonsdavidson.co.uk',
]
