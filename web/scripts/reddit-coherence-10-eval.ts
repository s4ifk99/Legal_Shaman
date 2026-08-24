/**
 * Live Reddit × Coherence eval (10 posts).
 * Scores: matter understanding, OSLAW recommendation, Matching Help.
 *
 * Usage:
 *   npx tsx scripts/reddit-coherence-10-eval.ts
 *   npx tsx scripts/reddit-coherence-10-eval.ts --limit=10
 */
import './load-dotenv'

import Module from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown
const nodeModule = Module as typeof Module & { _load: NodeLoad }
const load = nodeModule._load
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {}
  return load(request, parent, isMain)
}

const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || 10)
const OUT_JSON = path.join(process.cwd(), 'reports/reddit-coherence-10-eval.json')
const OUT_MD = path.join(process.cwd(), 'reports/reddit-coherence-10-eval.md')

const SKIP_TITLE =
  /\b(banned|generative ai|ai advice|megathread|weekly thread|daily thread|mod (post|announcement)|rules reminder)\b/i

type Grade = 'pass' | 'partial' | 'fail'

type CaseResult = {
  id: string
  title: string
  url: string
  subreddit: string
  query: string
  matter: {
    matterType: string
    taxonomySlug: string | null
    jurisdiction: string
    locationHint: string
    topFrames: Array<{ id: string; label: string; fit: number }>
    grade: Grade
    notes: string
  }
  oslaw: {
    pathwayTitle: string | null
    pathwayId: string | null
    stepCount: number
    answerTopicId: string | null
    usedCarOnParking: boolean
    grade: Grade
    notes: string
  }
  matchingHelp: {
    freeCount: number
    freeTitles: string[]
    solicitorCount: number
    solicitorTitles: string[]
    solicitorAreas: string[]
    officialCount: number
    grade: Grade
    notes: string
  }
  overall: Grade
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function isLikelyLegalQuestion(title: string, snippet: string): boolean {
  if (SKIP_TITLE.test(title)) return false
  const blob = `${title} ${snippet}`.toLowerCase()
  return (
    /\b(i |my |our |landlord|tenant|employer|evict|deposit|dismiss|tribunal|visa|asylum|divorce|bailiff|parking|pcn|police|arrest|debt|benefit|probate|will |solicitor|court|claim|section 21|uc |pip)\b/i.test(
      blob,
    ) || title.includes('?')
  )
}

/** Heuristic expected matter from story text (eval gold). */
function expectedMatter(text: string): {
  matters: string[]
  parking?: boolean
  housing?: boolean
  employment?: boolean
  crime?: boolean
  family?: boolean
  immigration?: boolean
  debt?: boolean
  consumer?: boolean
} {
  const t = text.toLowerCase()
  const out: ReturnType<typeof expectedMatter> = { matters: [] }
  if (/\b(car\s*park|parking|pcn|popla|parking (?:fine|ticket|charge)|private parking|penalty charge)\b/i.test(t)) {
    out.parking = true
    out.matters.push('consumer')
  }
  if (/\b(landlord|tenant|section\s*21|section\s*8|evict|deposit|disrepair|mould|homeless|ast\b)\b/i.test(t)) {
    out.housing = true
    out.matters.push('housing')
  }
  if (/\b(employer|dismiss|redundan|grievance|acas|tribunal|wages|zero.?hours|unfair dismiss)\b/i.test(t)) {
    out.employment = true
    out.matters.push('employment')
  }
  if (/\b(arrest|police|caution|charged with|cps|magistrates|assault|theft)\b/i.test(t) && !out.parking) {
    out.crime = true
    out.matters.push('crime')
  }
  if (/\b(divorce|child arrangements|contact order|custody|domestic abuse|molestation)\b/i.test(t)) {
    out.family = true
    out.matters.push('family')
  }
  if (/\b(visa|asylum|home office|ilr|immigration|deport)\b/i.test(t)) {
    out.immigration = true
    out.matters.push('immigration')
  }
  if (/\b(bailiff|debt|ccj|iva|council tax arrears|creditor)\b/i.test(t) && !out.parking) {
    out.debt = true
    out.matters.push('debt')
  }
  if (/\b(refund|faulty|trader|consumer rights|retailer|goods)\b/i.test(t) && !out.parking) {
    out.consumer = true
    out.matters.push('consumer')
  }
  if (!out.matters.length) out.matters.push('unknown')
  return out
}

function gradeMatter(
  session: { matterType: string; taxonomySlug?: string | null },
  frames: Array<{ id: string; label: string }>,
  text: string,
): { grade: Grade; notes: string } {
  const exp = expectedMatter(text)
  const frameBlob = frames.map((f) => `${f.id} ${f.label}`).join(' ').toLowerCase()
  const t = text.toLowerCase()

  if (exp.parking) {
    const ok =
      session.taxonomySlug === 'parking_pcn' ||
      /parking|pcn|popla/.test(frameBlob) ||
      session.matterType === 'consumer'
    if (session.matterType === 'crime' && !/assault|arrest|police/.test(t)) {
      return { grade: 'fail', notes: 'Parking story typed as crime' }
    }
    if (ok && session.taxonomySlug === 'parking_pcn')
      return { grade: 'pass', notes: 'parking_pcn + consumer/parking frame' }
    if (ok) return { grade: 'partial', notes: 'Parking-ish but taxonomySlug missing' }
    return { grade: 'fail', notes: 'Missed parking classification' }
  }

  // Clear employment cues (not merely "I am employed as…")
  const clearEmployment =
    /\b(manager|employer|dismiss|redundan|grievance|holiday hours|shift|acas|unpaid|wages|drinking water|drs appointment|holiday pay)\b/i.test(
      t,
    ) && /\b(work|job|manager|employer|shift|holiday)\b/i.test(t)

  if (clearEmployment || exp.employment) {
    if (session.matterType === 'employment' || /emp-/.test(frameBlob)) {
      return { grade: 'pass', notes: `matter=${session.matterType}; employment frames` }
    }
    if (session.matterType === 'unknown') {
      return { grade: 'fail', notes: 'Missed employment classification' }
    }
    return { grade: 'partial', notes: `Expected employment-ish, got ${session.matterType}` }
  }

  if (exp.housing || /\b(neighbour|neighbor|flat|house|landlord|tenant|heating|excavating)\b/i.test(t)) {
    if (session.matterType === 'housing' || /hous|neighbour|disrepair|deposit/.test(frameBlob)) {
      return { grade: 'pass', notes: `matter=${session.matterType}; housing/neighbour frames` }
    }
    return { grade: 'partial', notes: `Neighbour/housing-ish → ${session.matterType}` }
  }

  if (/\b(festival|ticket|insurer|insurance|operation|fraud)\b/i.test(t)) {
    if (session.matterType !== 'unknown') {
      return { grade: 'partial', notes: `Ambiguous Reddit story → ${session.matterType}` }
    }
    return { grade: 'fail', notes: 'Ambiguous story left unknown' }
  }

  if (session.matterType !== 'unknown') {
    return { grade: 'partial', notes: `Classified ${session.matterType} without strong gold` }
  }
  return { grade: 'fail', notes: 'Unknown matter' }
}

function gradeOslaw(opts: {
  text: string
  course: { pathwayTitle?: string; pathwayId?: string; steps?: unknown[] } | null
  answerTopicId: string | null
}): { grade: Grade; notes: string; usedCarOnParking: boolean } {
  const { text, course, answerTopicId } = opts
  const parking = /\b(car\s*park|parking|pcn|popla|parking (?:fine|ticket|charge)|private parking)\b/i.test(text)
  const title = `${course?.pathwayTitle || ''} ${course?.pathwayId || ''} ${answerTopicId || ''}`.toLowerCase()
  const usedCarOnParking = parking && /used.?car|faulty.?goods|buying.?a.?used/.test(title)

  if (usedCarOnParking) {
    return { grade: 'fail', notes: 'Used-car pathway on parking story', usedCarOnParking: true }
  }
  if (parking) {
    if (answerTopicId === 'private-parking-charge' || /parking|pcn|popla/.test(title)) {
      return {
        grade: 'pass',
        notes: course ? `Pathway/answer parking-aligned (${course.pathwayTitle || answerTopicId})` : `Answer pack ${answerTopicId}`,
        usedCarOnParking: false,
      }
    }
    if (course && (course.steps?.length || 0) > 0) {
      return { grade: 'partial', notes: `Course present but not clearly parking: ${course.pathwayTitle}`, usedCarOnParking: false }
    }
    return { grade: 'fail', notes: 'No parking OSLAW/answer pathway', usedCarOnParking: false }
  }

  if (course && (course.steps?.length || 0) >= 2 && course.pathwayTitle) {
    return { grade: 'pass', notes: `Pathway: ${course.pathwayTitle}`, usedCarOnParking: false }
  }
  if (answerTopicId || (course && course.pathwayTitle)) {
    return { grade: 'partial', notes: course?.pathwayTitle || `topic ${answerTopicId}`, usedCarOnParking: false }
  }
  return { grade: 'fail', notes: 'No OSLAW course / answer topic', usedCarOnParking: false }
}

function gradeMatchingHelp(opts: {
  text: string
  matterType: string
  taxonomySlug: string | null
  freeTitles: string[]
  solicitorTitles: string[]
  solicitorBlurbs: string[]
  officialTitles: string[]
}): { grade: Grade; notes: string } {
  const { text, taxonomySlug, freeTitles, solicitorTitles, solicitorBlurbs, officialTitles } = opts
  const parking =
    taxonomySlug === 'parking_pcn' ||
    /\b(car\s*park|parking|pcn|popla|parking (?:fine|ticket|charge)|private parking)\b/i.test(text)
  const freeBlob = freeTitles.join(' ').toLowerCase()
  const solBlob = [...solicitorTitles, ...solicitorBlurbs].join(' ').toLowerCase()
  const offBlob = officialTitles.join(' ').toLowerCase()
  const notes: string[] = []

  const hasFree = freeTitles.length > 0 || officialTitles.length > 0
  const hasSol = solicitorTitles.length > 0

  if (parking) {
    const freeOk = /parking|pcn|popla|citizens advice|resolver|tribunal|ias/.test(freeBlob + ' ' + offBlob)
    const freeBad = /victim support|universal credit|stalking|immigration|asylum|stepchange|avma|age uk/.test(freeBlob)
    const solOk = hasSol && /consumer|litigation|parking|pcn|motoring|local/.test(solBlob)
    if (freeOk && !freeBad && solOk) {
      notes.push('Parking free + solicitors on-topic')
      return { grade: 'pass', notes: notes.join('; ') }
    }
    if (freeOk && !freeBad) {
      return { grade: 'partial', notes: hasSol ? 'Free OK; solicitor practice-area weak' : 'Free OK; no solicitors' }
    }
    if (freeBad) return { grade: 'fail', notes: 'Off-topic free help on parking' }
    return { grade: 'fail', notes: 'Weak parking matching help' }
  }

  if (hasFree && hasSol) return { grade: 'pass', notes: `Free ${freeTitles.length}, solicitors ${solicitorTitles.length}` }
  if (hasFree || hasSol) return { grade: 'partial', notes: `Free ${freeTitles.length}, solicitors ${solicitorTitles.length}` }
  return { grade: 'fail', notes: 'Empty matching help' }
}

function overallGrade(parts: Grade[]): Grade {
  if (parts.every((g) => g === 'pass')) return 'pass'
  if (parts.some((g) => g === 'fail')) return parts.filter((g) => g === 'fail').length >= 2 ? 'fail' : 'partial'
  return 'partial'
}

async function collectLive(limit: number) {
  // Prefer previously collected live ids when --skip-fetch and file exists
  if (process.argv.includes('--skip-fetch')) {
    const prevPath = path.join(process.cwd(), 'reports/reddit-coherence-10-eval.json')
    try {
      const { readFileSync } = await import('node:fs')
      const prev = JSON.parse(readFileSync(prevPath, 'utf8')) as {
        cases: Array<{ id: string; title: string; url: string; subreddit: string; query: string }>
      }
      if (prev.cases?.length) {
        console.info(JSON.stringify({ event: 'reuse_queries', count: prev.cases.length }))
        return prev.cases.map((c) => ({
          id: c.id,
          title: c.title,
          snippet: c.query,
          url: c.url,
          subreddit: c.subreddit,
          query: c.query,
        }))
      }
    } catch {
      /* fall through */
    }
  }
  const { fetchSubredditListing, dedupeOslawPosts } = await import('../lib/reddit-search/listing')
  const { OSLAW_SUBREDDITS, OSLAW_SEARCH_EXTRA_SUBREDDITS } = await import('../lib/oslaw/config')

  const subs = [
    ...OSLAW_SUBREDDITS.filter((s) => s.name === 'LegalAdviceUK' || s.name === 'HousingUK'),
    ...OSLAW_SUBREDDITS.filter((s) => s.name !== 'LegalAdviceUK' && s.name !== 'HousingUK'),
    ...OSLAW_SEARCH_EXTRA_SUBREDDITS.filter((s) => s.name === 'CarTalkUK'),
  ]

  const all: Array<{
    id: string
    title: string
    snippet: string
    url: string
    permalink?: string
    subreddit: string
  }> = []

  for (const sub of subs) {
    for (const source of [
      { sort: 'hot' as const, limit: 40 },
      { sort: 'new' as const, limit: 40 },
    ]) {
      try {
        const batch = await fetchSubredditListing(sub.name, {
          sort: source.sort,
          limit: source.limit,
        })
        all.push(...batch.posts)
        console.info(JSON.stringify({ event: 'reddit_fetched', subreddit: sub.name, sort: source.sort, count: batch.posts.length }))
      } catch (err) {
        console.warn(JSON.stringify({ event: 'reddit_fetch_error', subreddit: sub.name, error: String(err) }))
      }
      await sleep(800)
      if (dedupeOslawPosts(all).length >= limit * 4) break
    }
    if (dedupeOslawPosts(all).length >= limit * 4) break
  }

  const out: Array<{ id: string; title: string; snippet: string; url: string; subreddit: string; query: string }> = []
  const seen = new Set<string>()
  for (const p of dedupeOslawPosts(all)) {
    if (out.length >= limit) break
    if (!isLikelyLegalQuestion(p.title, p.snippet || '')) continue
    const key = p.title.toLowerCase().replace(/\s+/g, ' ').trim()
    if (seen.has(key)) continue
    seen.add(key)
    const snippet = (p.snippet || '').slice(0, 500)
    out.push({
      id: p.id,
      title: p.title.trim(),
      snippet,
      url: p.permalink || p.url,
      subreddit: p.subreddit,
      query: [p.title.trim(), snippet].filter(Boolean).join('. ').slice(0, 900),
    })
  }
  return out
}

async function main() {
  console.info(JSON.stringify({ event: 'start', limit: LIMIT }))
  const posts = await collectLive(LIMIT)
  if (posts.length < LIMIT) {
    console.warn(JSON.stringify({ event: 'short_collection', got: posts.length, wanted: LIMIT }))
  }

  const { createInitialSession, senseDetails } = await import('../lib/coherence/sense')
  const { proposeCoherentFrames } = await import('../lib/coherence/frames')
  const { matchOslawCourse } = await import('../lib/coherence/wiki')
  const { buildAnswerPackage } = await import('../lib/coherence/answerPackage')
  const { buildHelpPack } = await import('../lib/coherence/services')

  const results: CaseResult[] = []

  for (const post of posts) {
    console.info(JSON.stringify({ event: 'case_start', id: post.id, title: post.title.slice(0, 80) }))
    let session = createInitialSession()
    session = senseDetails(post.query, session)
    const frames = proposeCoherentFrames(session, 4)
    const course = await matchOslawCourse(session, frames, 3)
    const answer = buildAnswerPackage(session, frames)
    const pack = await buildHelpPack(session, frames)

    // Node has no relative /api — hydrate SRA firms against the local Next server.
    if (!pack.sraFirms.length) {
      try {
        const { buildSraSearchPayload, relevantWorkAreas, sraMatchReason } = await import(
          '../lib/coherence/sraQuery'
        )
        const payload = buildSraSearchPayload(session, frames, 5)
        const res = await fetch('http://127.0.0.1:3000/api/coherence/sra/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          const data = (await res.json()) as {
            hits?: Array<{
              sraId: string
              name: string
              city: string
              postcode: string
              phone: string
              workArea: string
              score: number
              profileUrl?: string
            }>
          }
          pack.sraFirms = (data.hits || []).map((h) => {
            const place = [h.city, h.postcode].filter(Boolean).join(' · ')
            const areas = relevantWorkAreas(
              h.workArea || '',
              payload.matterType,
              payload.wantCar,
              payload.taxonomySlug,
            )
            const reason = sraMatchReason(h.workArea || '', payload)
            return {
              id: `sra:${h.sraId}`,
              title: h.name,
              type: 'SRA-regulated firm',
              blurb: [reason, place, areas.length ? `Work areas: ${areas.join(', ')}` : '']
                .filter(Boolean)
                .join(' — '),
              phone: h.phone || undefined,
              sraId: h.sraId,
              score: h.score,
            }
          })
        }
      } catch {
        /* leave empty */
      }
    }

    const freeTitles = [
      ...pack.freeServices.map((s) => s.title),
      ...pack.signposts.map((s) => s.title),
    ]
    const officialTitles = pack.authorityOfficial.map((s) => s.title)
    const solicitorTitles = pack.sraFirms.map((s) => s.title)
    const solicitorBlurbs = pack.sraFirms.map((s) => s.blurb)

    const matterG = gradeMatter(session, frames, post.query)
    const oslawG = gradeOslaw({
      text: post.query,
      course: course
        ? {
            pathwayTitle: course.title,
            pathwayId: course.pathwayId,
            steps: course.steps,
          }
        : null,
      answerTopicId: answer.matchedTopicId,
    })
    const helpG = gradeMatchingHelp({
      text: post.query,
      matterType: session.matterType,
      taxonomySlug: session.taxonomySlug || null,
      freeTitles: [...freeTitles, ...officialTitles],
      solicitorTitles,
      solicitorBlurbs,
      officialTitles,
    })

    const row: CaseResult = {
      id: post.id,
      title: post.title,
      url: post.url,
      subreddit: post.subreddit,
      query: post.query,
      matter: {
        matterType: session.matterType,
        taxonomySlug: session.taxonomySlug || null,
        jurisdiction: session.jurisdiction,
        locationHint: session.locationHint || '',
        topFrames: frames.slice(0, 3).map((f) => ({
          id: f.id,
          label: f.label,
          fit: f.fitScore ?? f.score,
        })),
        grade: matterG.grade,
        notes: matterG.notes,
      },
      oslaw: {
        pathwayTitle: course?.title || null,
        pathwayId: course?.pathwayId || null,
        stepCount: course?.steps?.length || 0,
        answerTopicId: answer.matchedTopicId,
        usedCarOnParking: oslawG.usedCarOnParking,
        grade: oslawG.grade,
        notes: oslawG.notes,
      },
      matchingHelp: {
        freeCount: freeTitles.length + officialTitles.length,
        freeTitles: [...new Set([...freeTitles, ...officialTitles])].slice(0, 6),
        solicitorCount: solicitorTitles.length,
        solicitorTitles: solicitorTitles.slice(0, 5),
        solicitorAreas: solicitorBlurbs.map((b) => b.split('—')[0]?.trim() || b).slice(0, 5),
        officialCount: officialTitles.length,
        grade: helpG.grade,
        notes: helpG.notes,
      },
      overall: overallGrade([matterG.grade, oslawG.grade, helpG.grade]),
    }
    results.push(row)
    console.info(
      JSON.stringify({
        event: 'case_done',
        id: post.id,
        matter: row.matter.grade,
        oslaw: row.oslaw.grade,
        help: row.matchingHelp.grade,
        overall: row.overall,
      }),
    )
  }

  const tally = (key: 'matter' | 'oslaw' | 'matchingHelp' | 'overall') => {
    const g = { pass: 0, partial: 0, fail: 0 }
    for (const r of results) {
      const grade = key === 'overall' ? r.overall : r[key].grade
      g[grade]++
    }
    return g
  }

  const report = {
    generatedAt: new Date().toISOString(),
    limit: LIMIT,
    collected: results.length,
    summary: {
      matter: tally('matter'),
      oslaw: tally('oslaw'),
      matchingHelp: tally('matchingHelp'),
      overall: tally('overall'),
    },
    passRates: {
      matter: results.length ? tally('matter').pass / results.length : 0,
      oslaw: results.length ? tally('oslaw').pass / results.length : 0,
      matchingHelp: results.length ? tally('matchingHelp').pass / results.length : 0,
      overall: results.length ? tally('overall').pass / results.length : 0,
    },
    cases: results,
  }

  mkdirSync(path.dirname(OUT_JSON), { recursive: true })
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2))

  const pct = (n: number) => `${Math.round(n * 100)}%`
  const lines = [
    '# Reddit coherence eval (10 live posts)',
    '',
    `Generated: ${report.generatedAt}`,
    `Cases: ${report.collected}`,
    '',
    '## Pass rates (strict pass only)',
    '',
    `| Dimension | Pass | Partial | Fail | Pass rate |`,
    `|---|---:|---:|---:|---:|`,
    `| Matter understanding | ${report.summary.matter.pass} | ${report.summary.matter.partial} | ${report.summary.matter.fail} | ${pct(report.passRates.matter)} |`,
    `| OSLAW recommendation | ${report.summary.oslaw.pass} | ${report.summary.oslaw.partial} | ${report.summary.oslaw.fail} | ${pct(report.passRates.oslaw)} |`,
    `| Matching Help | ${report.summary.matchingHelp.pass} | ${report.summary.matchingHelp.partial} | ${report.summary.matchingHelp.fail} | ${pct(report.passRates.matchingHelp)} |`,
    `| Overall | ${report.summary.overall.pass} | ${report.summary.overall.partial} | ${report.summary.overall.fail} | ${pct(report.passRates.overall)} |`,
    '',
    '## Cases',
    '',
  ]
  for (const c of results) {
    lines.push(`### ${c.title}`)
    lines.push(`- Subreddit: r/${c.subreddit} · [post](${c.url})`)
    lines.push(
      `- Matter: **${c.matter.grade}** — ${c.matter.matterType}${c.matter.taxonomySlug ? ` / ${c.matter.taxonomySlug}` : ''} (${c.matter.notes})`,
    )
    lines.push(`- OSLAW: **${c.oslaw.grade}** — ${c.oslaw.notes}`)
    lines.push(`- Matching Help: **${c.matchingHelp.grade}** — ${c.matchingHelp.notes}`)
    lines.push(`- Overall: **${c.overall}**`)
    lines.push('')
  }
  writeFileSync(OUT_MD, lines.join('\n'))
  console.info(JSON.stringify({ event: 'wrote', json: OUT_JSON, md: OUT_MD, summary: report.summary, passRates: report.passRates }))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
