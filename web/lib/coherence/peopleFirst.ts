/** People and services before SRA firms. Signposting only. */
export type HelpToolName = 'match_free_help' | 'match_legal_aid' | 'signpost_category' | 'search_sra'

export type HelpDoorKind = 'duty' | 'law_centre' | 'cab' | 'regulator' | 'specialist' | 'firm'

export type HelpDoor = {
  id: string
  title: string
  kind: HelpDoorKind
  blurb: string
  url?: string
  phone?: string
  tool: HelpToolName
}

const KIND_ORDER: Record<HelpDoorKind, number> = {
  duty: 0,
  law_centre: 1,
  cab: 2,
  regulator: 3,
  specialist: 4,
  firm: 5,
}

export function classifyHelpDoorKind(title: string, type = '', tool: HelpToolName): HelpDoorKind {
  if (tool === 'search_sra') return 'firm'
  const hay = `${title} ${type}`.toLowerCase()
  if (/duty solicitor|police station advice|duty scheme/.test(hay)) return 'duty'
  if (/law centre|civil legal advice|\bcla\b/.test(hay)) return 'law_centre'
  if (/citizens advice/.test(hay)) return 'cab'
  if (/ombudsman|iopc|police conduct|regulator|\bsra\b|legal ombudsman/.test(hay)) return 'regulator'
  if (tool === 'match_legal_aid') return 'law_centre'
  return 'specialist'
}

/** Law Centre / CAB / duty / regulator, then specialist charities, then firms. */
export function rankPeopleFirst(doors: HelpDoor[]): HelpDoor[] {
  return [...doors].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}
