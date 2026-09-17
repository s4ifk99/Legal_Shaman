import { classifyHelpDoorKind } from './peopleFirst'

export const SEARCH_MAG_MIN = 1
export const SEARCH_MAG_MAX = 5
export const SEARCH_MAG_DEFAULT = 3

export type SearchMagLevel = 1 | 2 | 3 | 4 | 5

export const SEARCH_MAG_META: Record<
  SearchMagLevel,
  { name: string; hint: string }
> = {
  1: {
    name: 'Signpost',
    hint: 'Official and people-first doors only — Law Centre, CAB, duty, regulator.',
  },
  2: {
    name: 'People',
    hint: 'Charities, helplines, and Third Eye leads. No solicitor register yet.',
  },
  3: {
    name: 'Matched',
    hint: 'Usual Matching Help: free doors, then SRA-regulated firms.',
  },
  4: {
    name: 'Wide',
    hint: 'Directories and a longer list. Still admitted sources, not the open web.',
  },
  5: {
    name: 'Raw search',
    hint: 'Retrieved sources as the system saw them. Not legal advice — verify every page.',
  },
}

const TIGHT_KINDS = new Set(['duty', 'law_centre', 'cab', 'regulator'])

export function parseSearchMagLevel(value: unknown): SearchMagLevel {
  const n = Number(value)
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5) return n
  return SEARCH_MAG_DEFAULT
}

export function showSolicitorsAtMag(level: SearchMagLevel): boolean {
  return level >= 3
}

export function showDirectoriesAtMag(level: SearchMagLevel): boolean {
  return level >= 4
}

export function showThirdEyeHelpAtMag(level: SearchMagLevel): boolean {
  return level >= 2
}

export function showRawSourcesAtMag(level: SearchMagLevel): boolean {
  return level === 5
}

export function magBlurbMax(level: SearchMagLevel): number {
  if (level <= 2) return 90
  if (level === 3) return 120
  if (level === 4) return 180
  return 280
}

export function magShowScores(level: SearchMagLevel): boolean {
  return level >= 4
}

export function magShowRawUrl(level: SearchMagLevel): boolean {
  return level === 5
}

export function filterFreeHelpByMag<T extends { title: string; type: string }>(
  rows: T[],
  level: SearchMagLevel,
): T[] {
  if (level >= 3) return rows
  return rows.filter((row) => {
    const hay = `${row.title} ${row.type}`
    if (/\bsra-regulated\b|solicitor|law firm|\bllp\b/i.test(hay)) return false
    const kind = classifyHelpDoorKind(row.title, row.type, 'match_free_help')
    if (kind === 'firm') return false
    if (level === 1) return TIGHT_KINDS.has(kind)
    return true
  })
}
