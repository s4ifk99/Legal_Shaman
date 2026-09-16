import type { FreeResourceCandidate } from '@/lib/coherence/researchBundle'
import { freeHelpAdmissibleOnGeometry } from '@/lib/matter/graphAdmissibility'

export type ThirdEyeHelpLead = FreeResourceCandidate & { fromSession: boolean }

/**
 * Session Third Eye leads are Matching Help, including pending_review.
 * Approval is for the trusted index only — it does not gate this column.
 */
export function visibleThirdEyeHelp(opts: {
  sessionResources: FreeResourceCandidate[]
  cachedResources?: FreeResourceCandidate[]
  matterType: string
  story: string
}): { free: ThirdEyeHelpLead[]; paid: ThirdEyeHelpLead[] } {
  const seen = new Set<string>()
  const out: ThirdEyeHelpLead[] = []

  const push = (resource: FreeResourceCandidate, fromSession: boolean) => {
    if (!/^https:\/\//i.test(resource.url || '')) return
    if (resource.reviewStatus === 'rejected') return
    if (!fromSession) {
      const matter = opts.matterType || 'unknown'
      if (resource.matterType !== matter && resource.matterType !== 'unknown') return
    }
    if (
      !freeHelpAdmissibleOnGeometry(
        resource.title,
        `${resource.description || ''} ${resource.url || ''}`,
        opts.story,
      )
    ) {
      return
    }
    const key = resource.url.replace(/\/+$/, '').toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({ ...resource, fromSession })
  }

  for (const resource of opts.sessionResources || []) push(resource, true)
  for (const resource of opts.cachedResources || []) push(resource, false)

  return {
    free: out.filter((r) => r.costBand !== 'paid'),
    paid: out.filter((r) => r.costBand === 'paid'),
  }
}
