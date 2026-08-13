export interface SraOrganisation {
  sraId: string
  name: string
  businessName: string
  organisationName: string
  city: string
  postcode: string
  county: string
  country: string
  phone: string
  email: string
  website: string
  profileUrl: string
  workArea: string
  authorisationStatus: string
}

export function parseWorkAreas(workAreaRaw: string): string[] {
  try {
    const parsed = JSON.parse(workAreaRaw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean)
    }
  } catch {
    // fall through
  }
  return workAreaRaw
    .replace(/[\[\]"]/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function fetchSraOrganisation(sraId: string): Promise<SraOrganisation | null> {
  try {
    const res = await fetch(`/api/coherence/sra/organisation/${encodeURIComponent(sraId)}`)
    if (!res.ok) return null
    const data = (await res.json()) as { organisation?: SraOrganisation }
    return data.organisation ?? null
  } catch {
    return null
  }
}
