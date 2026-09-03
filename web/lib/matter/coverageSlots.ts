/**
 * Shared coverage checklist for wiki retrieve and Third Eye.
 * Hits compete to fill slots on the frozen MatterFrame — not to win a second rec.
 */

export type CoverageSlot = {
  id: string
  label: string
  cover: RegExp[]
  exaQuery: string
}

type IssueGraph = {
  primaryIssues: { slug: string }[]
  secondaryIssues: { slug: string }[]
  exclusions?: string[]
}

export function primaryMatterSlug(matterSlug?: string): string {
  return (matterSlug || "").split("+")[0].trim().toLowerCase()
}

export function storyLooksWales(story: string): boolean {
  return /\bwales\b|welsh law|cardiff|swansea|newport\b/i.test(story)
}

export function textOffJurisdiction(text: string, story: string): boolean {
  if (storyLooksWales(story)) return false
  return /\bwales\b|gov\.wales|advicelink cymru|rentinghomes\.gov/i.test(text)
}

function lockoutStory(story: string): boolean {
  return /door.{0,24}removed|removed.{0,24}(?:the )?(?:front )?door|no front door|changed? (?:the )?locks?|forced .{0,40}(?:leave|vacate)|leave immediately|illegal evict|lock(?:ed)? out/i.test(
    story,
  )
}

function alreadyForcedOut(story: string): boolean {
  return /had no choice but to comply|leave everything else behind|son in law showed up/i.test(story)
}

function homelessStory(story: string): boolean {
  return /nowhere else|homeless|tonight|emergency (?:housing|alternative)|sofa to crash/i.test(story)
}

function wagesStory(story: string): boolean {
  return /wages|holiday pay|ssp|statutory sick|last pay/i.test(story)
}

function occupancyStatusStory(story: string): boolean {
  return /no tenancy|tied accommodat|service occup|employment contract.{0,80}accommodat|landlord.{0,40}employer/i.test(
    story,
  )
}

function employerSeizedKitStory(story: string): boolean {
  const s = story || ""
  const policeTookKit =
    /\b(police|cops|seized|confiscat|took)\b/i.test(s) &&
    /\b(laptop|computer|phone|dropbox|work files)\b/i.test(s)
  if (!policeTookKit) return false
  return (
    /\b(work laptop|company laptop|employer(?:'s)? (?:work )?laptop|work (?:computer|pc|phone)|belongs to the business|my laptop.{0,40}work laptop|staff (?:member|has been)|member of my staff)\b/i.test(
      s,
    ) || /\b(company files|work files|employer(?:'s)? (?:property|kit|equipment))\b/i.test(s)
  )
}

export function coverageSlotsFrom(frame: IssueGraph, story: string): CoverageSlot[] {
  const primary = frame.primaryIssues[0]?.slug || ""
  const slugs = new Set([
    ...frame.primaryIssues.map((i) => i.slug),
    ...frame.secondaryIssues.map((i) => i.slug),
  ])
  const slots: CoverageSlot[] = []

  const housingMatter =
    primary === "housing" ||
    slugs.has("housing") ||
    (lockoutStory(story) && primary !== "criminal_defence" && !slugs.has("criminal_defence"))

  if (housingMatter) {
    if (lockoutStory(story)) {
      slots.push({
        id: "illegal_eviction",
        label: "Illegal eviction / lock-out",
        cover: [
          /illegal evict|protection from eviction|lock-?out|changed? (?:the )?locks?|front door|harassment.{0,40}landlord|police.{0,40}evict/i,
        ],
        exaQuery:
          "England illegal eviction lock out landlord removed door Protection from Eviction Act Shelter police what to expect",
      })
    }
    if (lockoutStory(story) && !alreadyForcedOut(story)) {
      slots.push({
        id: "occupying_insecure",
        label: "Still occupying without a secure door",
        cover: [
          /occup|right to (?:stay|remain)|no (?:written )?tenancy|service occup|tied accommodat|illegal evict|front door|eviction notices? from private/i,
        ],
        exaQuery:
          "England occupier no written tenancy landlord removed door still living there illegal eviction stay without court order Shelter",
      })
    }
    if (homelessStory(story) || alreadyForcedOut(story)) {
      slots.push({
        id: "homelessness",
        label: "Homelessness / emergency housing",
        cover: [
          /homeless|nowhere to stay|emergency accommodation|temporary accommodation|homelessness duty/i,
        ],
        exaQuery:
          "England local authority homelessness duty emergency accommodation Shelter nowhere to stay tonight",
      })
    }
    if (occupancyStatusStory(story) || /no tenancy/i.test(story)) {
      slots.push({
        id: "occupancy_status",
        label: "Tenancy / occupancy without a written agreement",
        cover: [
          /tenancy agreement|service occup|tied accommodat|excluded occupier|occupier with basic protection|landlord and tenant/i,
        ],
        exaQuery:
          "England occupier no written tenancy agreement service occupancy tied accommodation tenant rights Shelter Citizens Advice",
      })
    }
    slots.push({
      id: "housing_core",
      label: "Housing / landlord and tenant",
      cover: [
        /landlord.?tenant|private renting|section\s*21|eviction notice|illegal evict|homeless|housing and homelessness|renting/i,
      ],
      exaQuery: "England private renting eviction rules GOV.UK Shelter landlord tenant",
    })
  }

  if (wagesStory(story) || (slugs.has("employment") && primary === "housing")) {
    slots.push({
      id: "wages_pay",
      label: "Last wages / holiday pay",
      cover: [
        /holiday pay|getting paid when you leave|unpaid wage|last (?:wages|pay)|acas|statutory sick/i,
      ],
      exaQuery:
        "England last wages holiday pay withheld until leave job Citizens Advice ACAS getting paid when you leave",
    })
  }

  if (primary === "employment" && !slugs.has("housing")) {
    slots.push({
      id: "employment_core",
      label: "Employment rights",
      cover: [/employment|acas|unfair dismiss|redundan|holiday pay|notice pay/i],
      exaQuery: "England employment rights ACAS GOV.UK",
    })
  }

  if (employerSeizedKitStory(story)) {
    slots.push({
      id: "return_seized_property",
      label: "Return of seized employer property",
      cover: [
        /return of (?:seized )?property|seized property|retention of property|property reference|pace.{0,30}(?:s\.?\s*)?22|if not charged|not charged.{0,40}return|recover.{0,20}(?:laptop|computer|property)/i,
      ],
      exaQuery:
        "England police seized employer laptop return of property if not charged PACE section 22 property reference owner",
    })
    slots.push({
      id: "employer_data_on_device",
      label: "Police examining employer files on a seized device",
      cover: [
        /work (?:files|laptop|computer)|employer (?:property|data|files)|dropbox|third[- ]party data|computer files|digital evidence|examine.{0,24}(?:device|computer|files)|work files/i,
      ],
      exaQuery:
        "England police examine employer work files on seized laptop Dropbox third party data PACE owner",
    })
  } else if (
    primary === "criminal_defence" ||
    slugs.has("criminal_defence")
  ) {
    slots.push({
      id: "criminal_defence_core",
      label: "Criminal defence / police station",
      cover: [
        /criminal defence|duty solicitor|police station|under caution|magistrates|charged with|legal aid.{0,20}crime/i,
      ],
      exaQuery: "England arrested police station duty solicitor criminal legal aid magistrates",
    })
  }

  if (!slots.length && primary) {
    const label = primary.replace(/_/g, " ")
    slots.push({
      id: "primary",
      label,
      cover: [new RegExp(label.replace(/\s+/g, ".{0,20}"), "i")],
      exaQuery: `England Wales ${label} official guidance GOV.UK Citizens Advice`,
    })
  }

  return slots
}

export function matchingSlotIds(text: string, slots: CoverageSlot[], story = ""): string[] {
  if (textOffJurisdiction(text, story)) return []
  const blob = text.replace(/\s+/g, " ")
  return slots.filter((slot) => slot.cover.some((re) => re.test(blob))).map((slot) => slot.id)
}

export function titleCoversGraph(title: string, slots: CoverageSlot[], story = ""): boolean {
  if (!slots.length) return true
  return matchingSlotIds(title, slots, story).length > 0
}

export function rankByCoverage<T extends { title: string; score?: number }>(
  items: T[],
  slots: CoverageSlot[],
  opts: { story?: string; limit: number; extraText?: (item: T) => string },
): T[] {
  const story = opts.story || ""
  if (!slots.length) return items.slice(0, opts.limit)
  const scored = items.map((item) => {
    const blob = `${item.title} ${opts.extraText?.(item) || ""}`
    const ids = matchingSlotIds(blob, slots, story)
    const first = ids.length ? slots.findIndex((s) => s.id === ids[0]) : 99
    return { item, n: ids.length, first, score: item.score || 0 }
  })
  const covering = scored.filter((row) => row.n > 0)
  // Never complete the page with off-slot neighbours when the graph has slots.
  const pool = covering.length > 0 ? covering : []
  return pool
    .sort((a, b) => b.n - a.n || a.first - b.first || b.score - a.score)
    .map((row) => row.item)
    .slice(0, opts.limit)
}

export function uncoveredSlots(
  slots: CoverageSlot[],
  texts: string[],
  story = "",
): CoverageSlot[] {
  const covered = new Set<string>()
  for (const text of texts) {
    for (const id of matchingSlotIds(text, slots, story)) covered.add(id)
  }
  return slots.filter((slot) => !covered.has(slot.id))
}

/** Wiki / Exa queries for slots that still have no admitted hit. */
export function slotRetryQueries(
  slots: CoverageSlot[],
  texts: string[],
  story = "",
): Array<{ slot: CoverageSlot; query: string }> {
  return uncoveredSlots(slots, texts, story).flatMap((slot) => [
    { slot, query: slot.exaQuery },
    { slot, query: slot.label },
  ])
}

export function isOfficialAuthoritySource(title: string, url = "", excerpt = ""): boolean {
  const hay = `${title} ${url} ${excerpt}`.toLowerCase()
  return /gov\.uk|legislation\.gov|pace code|pace.{0,20}(?:s\.?\s*)?22|disclosure manual|attorney general|college of policing|cps\.gov|criminal justice and police act/i.test(
    hay,
  )
}

export function groupBySlot<T extends { title: string }>(
  items: T[],
  slots: CoverageSlot[],
  opts: { story?: string; extraText?: (item: T) => string } = {},
): Array<{ slot: CoverageSlot | null; items: T[] }> {
  const story = opts.story || ""
  const buckets = new Map<string, T[]>()
  const leftover: T[] = []
  for (const item of items) {
    const ids = matchingSlotIds(`${item.title} ${opts.extraText?.(item) || ""}`, slots, story)
    if (!ids.length) {
      leftover.push(item)
      continue
    }
    const id = ids[0]
    const list = buckets.get(id) || []
    list.push(item)
    buckets.set(id, list)
  }
  const groups: Array<{ slot: CoverageSlot | null; items: T[] }> = slots
    .filter((slot) => (buckets.get(slot.id) || []).length)
    .map((slot) => ({ slot, items: buckets.get(slot.id) || [] }))
  if (leftover.length) groups.push({ slot: null, items: leftover })
  return groups
}
