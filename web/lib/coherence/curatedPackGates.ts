/**
 * Prevent brittle curated regex packs from winning when matter type or story
 * signals clearly point elsewhere (e.g. tenancy assignment ≠ commercial contract).
 */
import type { SessionState } from './types'
import type { LegalFrame } from './frames'
import { buildRetrievalText } from './retrievalText'

export type CuratedPackId =
  | 'property-transfer-conveyancing'
  | 'wills-lpa-trusts'
  | 'family-agreement'
  | 'commercial-business-contracts'
  | 'legal-document-certification'
  | 'tax-estate-banking'

function storyText(session: SessionState, frames: LegalFrame[]): string {
  return `${buildRetrievalText(session)} ${frames.map((f) => f.id).join(' ')}`.toLowerCase()
}

const HOUSING_TENANCY =
  /\b(tenant|tenancy|landlord|letting agent|rental|rent\b|deposit|inventory|assignment|wear and tear|assured shorthold|joint tenant|outgoing tenant|replacement tenant|flatmate|housemate)\b/i

const COMMERCIAL_BUSINESS =
  /\b(business|commercial|company|companies|supplier|customer|client|trade|shop|retail|partnership|sole trader)\b/i

const TENANCY_ASSIGNMENT =
  /\b(deed of assignment|assign(?:ment|ing)? (?:of )?(?:the )?tenancy|replacement tenant|outgoing tenant|taking (?:their|his|her) place)\b/i

const CONVEYANCING_PURCHASE =
  /\b(conveyanc|buying (?:a )?(?:property|flat|house)|selling (?:a )?(?:property|flat|house)|transfer of equity|remortgag|stamp duty|land registry)\b/i

/** Matter types that should block commercial / conveyancing curated packs. */
const NON_COMMERCIAL_MATTERS = new Set([
  'housing',
  'employment',
  'family',
  'immigration',
  'crime',
  'debt',
  'personal_injury',
])

export function curatedPackAllowed(
  packId: CuratedPackId,
  session: SessionState,
  frames: LegalFrame[],
): boolean {
  const text = storyText(session, frames)
  const matter = session.matterType

  if (packId === 'commercial-business-contracts') {
    if (matter && NON_COMMERCIAL_MATTERS.has(matter)) return false
    if (HOUSING_TENANCY.test(text)) return false
    if (!COMMERCIAL_BUSINESS.test(text)) return false
    return /\b(contract|agreement|terms|invoice|unpaid|dispute|draft|review|breach|termination|lease|licence)\b/i.test(
      text,
    )
  }

  if (packId === 'property-transfer-conveyancing') {
    if (TENANCY_ASSIGNMENT.test(text)) return false
    if (HOUSING_TENANCY.test(text) && !CONVEYANCING_PURCHASE.test(text)) return false
    return true
  }

  if (packId === 'legal-document-certification') {
    if (TENANCY_ASSIGNMENT.test(text)) return false
    if (HOUSING_TENANCY.test(text) && /\bdeed of assignment\b/i.test(text)) return false
    return true
  }

  return true
}
