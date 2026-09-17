/**
 * Fail-closed citation / grounding checks for Overview answers.
 * Directory must never be treated as primary law.
 */
import type { AnswerPackage } from './answerPackage'

export type CitationIssue = {
  code: string
  message: string
  bulletText?: string
}

const DIRECTORY_AS_LAW =
  /directory\/firms|wiki\/directory|sra-firms\/|lawhive\.co\.uk\/knowledge-hub/i

export function checkAnswerCitations(pack: AnswerPackage): { ok: boolean; issues: CitationIssue[] } {
  const issues: CitationIssue[] = []

  for (const b of pack.bullets) {
    if (!b.sourceUrl || !/^https?:\/\//i.test(b.sourceUrl)) {
      issues.push({
        code: 'missing-url',
        message: 'Factual bullet lacks an http(s) source URL',
        bulletText: b.text.slice(0, 80),
      })
    }
    if (b.tier === 'primary-law' && !/legislation\.gov\.uk/i.test(b.sourceUrl)) {
      issues.push({
        code: 'primary-not-legislation',
        message: 'Primary-law bullet must cite legislation.gov.uk',
        bulletText: b.text.slice(0, 80),
      })
    }
    if (
      (DIRECTORY_AS_LAW.test(b.sourceUrl) || DIRECTORY_AS_LAW.test(b.sourceTitle)) &&
      b.tier === 'primary-law'
    ) {
      issues.push({
        code: 'directory-as-primary',
        message: 'Directory / firm blog cited as if it were primary law',
        bulletText: b.text.slice(0, 80),
      })
    }
  }

  for (const s of pack.sources) {
    if (s.kind === 'primary-law' && !/legislation\.gov\.uk/i.test(s.url)) {
      issues.push({
        code: 'source-primary-not-legislation',
        message: `Primary-law source is not legislation.gov.uk: ${s.title}`,
      })
    }
    if (s.kind === 'primary-law' && DIRECTORY_AS_LAW.test(s.url)) {
      issues.push({
        code: 'directory-as-primary',
        message: `Directory URL in primary-law sources: ${s.title}`,
      })
    }
  }

  if (pack.recommendedFirms.length && pack.freeHelp.length === 0) {
    issues.push({
      code: 'firms-before-free-help',
      message: 'Firms listed without free-help signposts',
    })
  }

  const hardFail = issues.some((i) =>
    ['directory-as-primary', 'primary-not-legislation', 'firms-before-free-help'].includes(i.code),
  )

  return { ok: !hardFail && issues.filter((i) => i.code === 'missing-url').length === 0, issues }
}
