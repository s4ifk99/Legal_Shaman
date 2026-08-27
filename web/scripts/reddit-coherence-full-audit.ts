/**
 * Full Coherence pipeline audit on Reddit r/LegalAdviceUK posts.
 * Measures: interactive intake, timeline, frame matching, Matching Help,
 * recommendation (answer package), OSLAW, offline authority / Exa cache fallback.
 *
 * Usage:
 *   npx tsx scripts/reddit-coherence-full-audit.ts --limit=100
 *   npx tsx scripts/reddit-coherence-full-audit.ts --from-file=data/reddit-eval-100-lauk-random.json --live-sra=https://www.legalshaman.com
 */
import './load-dotenv'

import Module from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown
const nodeModule = Module as typeof Module & { _load: NodeLoad }
const load = nodeModule._load
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {}
  return load(request, parent, isMain)
}

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require('dotenv') as typeof import('dotenv')
  config({ path: path.resolve(process.cwd(), '../../LS R&D/.env') })
} catch {
  /* optional */
}

const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] || 100)
const FROM_FILE =
  process.argv.find((a) => a.startsWith('--from-file='))?.split('=')[1] ||
  'data/reddit-eval-100-lauk-random.json'
const LIVE_SRA =
  process.argv.find((a) => a.startsWith('--live-sra='))?.split('=')[1]?.replace(/\/$/, '') || ''
const MAX_TURNS = Number(process.argv.find((a) => a.startsWith('--max-turns='))?.split('=')[1] || 8)
const OUT_JSON = path.join(process.cwd(), 'reports/reddit-coherence-full-audit.json')
const OUT_MD = path.join(process.cwd(), 'reports/reddit-coherence-full-audit.md')

type Grade = 'pass' | 'partial' | 'fail'

type PostRow = {
  id: string
  title: string
  query: string
  url: string
  subreddit: string
  flair?: string
}

type AuditCase = {
  id: string
  title: string
  url: string
  flair: string
  interactive: {
    turns: number
    promptIds: string[]
    complete: boolean
    matterStart: string
    matterEnd: string
    grade: Grade
    notes: string
  }
  timeline: {
    eventCount: number
    partyCount: number
    hasGoal: boolean
    grade: Grade
    notes: string
  }
  frames: {
    top: Array<{ id: string; label: string; fit: number }>
    topFit: number
    grade: Grade
    notes: string
  }
  authority: {
    mode: 'auto_seed' | 'simulated_topic' | 'none'
    official: number
    exaCache: number
    firm: number
    total: number
    usedExaFallback: boolean
    auditOk: boolean
    grade: Grade
    notes: string
  }
  oslaw: {
    pathwayTitle: string | null
    stepCount: number
    grade: Grade
    notes: string
  }
  recommendation: {
    topicId: string | null
    bulletCount: number
    citationOk: boolean
    freeHelpCount: number
    grade: Grade
    notes: string
  }
  matchingHelp: {
    freeCount: number
    officialCount: number
    solicitorCount: number
    grade: Grade
    notes: string
  }
  concepts: {
    clusterIds: string[]
    intents: string[]
    primarySlug: string | null
    wikiTitles: string[]
    grade: Grade
    notes: string
  }
  overall: Grade
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function overallGrade(grades: Grade[]): Grade {
  if (grades.every((g) => g === 'pass')) return 'pass'
  if (grades.some((g) => g === 'fail')) return 'fail'
  return 'partial'
}

function flairMatterHint(flair: string, text: string): string {
  const f = (flair || '').toLowerCase()
  const t = text.toLowerCase()
  if (/housing|landlord|tenant/.test(f)) return 'housing'
  if (/employ|workplace/.test(f)) return 'employment'
  if (/family|divorce|child/.test(f)) return 'family'
  if (/debt|money|finance/.test(f)) return 'debt'
  if (/consumer|retail/.test(f)) return 'consumer'
  if (/crime|police/.test(f)) return 'crime'
  if (/immig|visa/.test(f)) return 'immigration'
  if (/scotland/.test(f) && /employ/.test(t)) return 'employment'
  if (/\b(parking|pcn|motoring|traffic)\b/.test(t)) return 'consumer'
  if (/\b(neighbour|landlord|tenant|section 21|deposit)\b/.test(t)) return 'housing'
  if (/\b(employer|sacked|dismiss|wages|acas|probation)\b/.test(t)) return 'employment'
  if (/\b(ex|child|custody|divorce)\b/.test(t)) return 'family'
  if (/\b(refund|trader|faulty|consumer)\b/.test(t)) return 'consumer'
  return 'other'
}

function applyGapAnswer(
  promptId: string,
  value: string,
  next: import('../lib/coherence/types').SessionState,
): import('../lib/coherence/types').SessionState {
  const v = value.trim()
  const lower = v.toLowerCase()
  if (promptId === 'matter' || promptId === 'matter_for_services') {
    if (/family|child|divorce|domestic/.test(lower)) return { ...next, matterType: 'family' }
    if (/hous|landlord|rent|neighbour|neighbor/.test(lower)) return { ...next, matterType: 'housing' }
    if (/employ|job|workplace|manager/.test(lower)) return { ...next, matterType: 'employment' }
    if (/insur|ticket|refund|trader|consumer|disability|access|wheelchair/.test(lower))
      return { ...next, matterType: 'consumer' }
    if (/debt|bailiff|ccj/.test(lower)) return { ...next, matterType: 'debt' }
    if (/crime|police/.test(lower)) return { ...next, matterType: 'crime' }
    if (/immig|visa/.test(lower)) return { ...next, matterType: 'immigration' }
    return { ...next, matterType: 'other' }
  }
  if (promptId === 'gap_goal' || promptId === 'constraint_goal') return { ...next, goal: next.goal || v }
  if (promptId === 'gap_where' || promptId === 'constraint_jurisdiction') {
    if (/scotland/.test(lower)) return { ...next, jurisdiction: 'Scotland', locationHint: 'Scotland' }
    if (/northern/.test(lower))
      return { ...next, jurisdiction: 'NorthernIreland', locationHint: 'Northern Ireland' }
    if (/wales/.test(lower)) return { ...next, jurisdiction: 'EnglandWales', locationHint: 'Wales' }
    return { ...next, jurisdiction: 'EnglandWales', locationHint: next.locationHint || v }
  }
  if (promptId === 'gap_evidence' || promptId === 'documents') {
    const docs = [...next.documents]
    if (v && !docs.includes(v)) docs.push(v.slice(0, 64))
    return { ...next, documents: docs }
  }
  if (promptId === 'safety' || promptId === 'constraint_safety') {
    return { ...next, safetyRisk: /urgent|danger|need help/i.test(lower) ? true : false }
  }
  if (promptId.startsWith('gap_') || promptId.startsWith('constraint_')) {
    return { ...next, whatHappened: next.whatHappened ? `${next.whatHappened} ${v}` : v }
  }
  return next
}

function autoReply(
  prompt: { id: string; text: string; options?: Array<{ value: string; label: string }> },
  post: PostRow,
): string {
  const blob = `${post.title} ${post.query}`.toLowerCase()
  const hint = flairMatterHint(post.flair || '', blob)

  if (prompt.id === 'matter' || prompt.id === 'matter_for_services') {
    const map: Record<string, string> = {
      housing: 'This is mainly about housing or a neighbour dispute',
      employment: 'This is mainly about employment or my job',
      family: 'This is mainly about family, children or domestic abuse',
      consumer: 'This is mainly about a purchase, refund, tickets, insurance or disability access',
      debt: 'This is mainly about debt, CCJs or bailiffs',
      crime: 'This is mainly about crime or the police',
      immigration: 'This is mainly about immigration or visas',
    }
    return map[hint] || 'This is about something else'
  }

  if (prompt.options?.length) {
    if (/scotland/.test(blob)) {
      const sc = prompt.options.find((o) => /scotland/i.test(o.label))
      if (sc) return sc.value
    }
    if (/wales/.test(blob)) {
      const w = prompt.options.find((o) => /wales/i.test(o.label))
      if (w) return w.value
    }
    if (/england/.test(blob)) {
      const e = prompt.options.find((o) => /england/i.test(o.label))
      if (e) return e.value
    }
  }

  if (/goal|outcome|want|need most|looking for/i.test(prompt.text)) {
    return `Understand my options and next steps regarding: ${post.title.slice(0, 120)}`
  }
  if (/where|jurisdiction|england|scotland|wales/i.test(prompt.text)) {
    if (/scotland/.test(blob)) return 'Scotland'
    if (/wales/.test(blob)) return 'Wales'
    if (/northern ireland/.test(blob)) return 'Northern Ireland'
    return 'England'
  }
  if (/document|evidence|writing|letter|photo|message/i.test(prompt.text)) {
    return 'Any letters, emails, photos or messages mentioned in my post'
  }
  if (/safe|danger|urgent/i.test(prompt.text)) return 'I am safe for now'
  if (/when|date|deadline|timing/i.test(prompt.text)) return 'Recently — within the last few months'
  if (/who|responsible|party|employer|landlord/i.test(prompt.text)) {
    if (/landlord/.test(blob)) return 'Landlord'
    if (/employer|boss/.test(blob)) return 'Employer'
    return 'The other party mentioned in my post'
  }
  if (prompt.options?.[0]) return prompt.options[0].value
  return post.title.slice(0, 200)
}

function loadPosts(limit: number): PostRow[] {
  const p = path.isAbsolute(FROM_FILE) ? FROM_FILE : path.join(process.cwd(), FROM_FILE)
  const raw = JSON.parse(readFileSync(p, 'utf8')) as {
    questions: Array<{
      id: string
      title: string
      query: string
      url: string
      subreddit?: string
      flair?: string
    }>
  }
  return (raw.questions || []).slice(0, limit).map((q) => ({
    id: q.id,
    title: q.title,
    query: q.query,
    url: q.url,
    subreddit: q.subreddit || 'LegalAdviceUK',
    flair: q.flair || '',
  }))
}

function gradeInteractive(opts: {
  complete: boolean
  turns: number
  matterStart: string
  matterEnd: string
}): { grade: Grade; notes: string } {
  if (opts.matterEnd === 'unknown') {
    return { grade: 'fail', notes: `Still unknown after ${opts.turns} turns` }
  }
  if (!opts.complete && opts.turns >= MAX_TURNS) {
    return { grade: 'partial', notes: `Hit turn cap (${MAX_TURNS}) before complete` }
  }
  if (opts.matterStart === 'unknown' && opts.matterEnd !== 'unknown') {
    return { grade: 'pass', notes: `Classified via intake: ${opts.matterStart}→${opts.matterEnd}` }
  }
  if (opts.complete) return { grade: 'pass', notes: `Intake complete in ${opts.turns} turns` }
  return { grade: 'partial', notes: `Matter=${opts.matterEnd}, incomplete` }
}

function gradeTimeline(session: import('../lib/coherence/types').SessionState): {
  grade: Grade
  notes: string
} {
  const n = session.events.length
  if (n >= 2) return { grade: 'pass', notes: `${n} timeline events` }
  if (n === 1) return { grade: 'partial', notes: 'Single timeline beat' }
  if ((session.whatHappened || '').length > 80)
    return { grade: 'partial', notes: 'Narrative only, no structured events' }
  return { grade: 'fail', notes: 'No timeline' }
}

function gradeFrames(
  matter: string,
  frames: Array<{ id: string; label: string; fit: number }>,
): { grade: Grade; notes: string } {
  if (!frames.length) return { grade: 'fail', notes: 'No frames' }
  const top = frames[0]!
  const fit = top.fit ?? 0
  const id = top.id
  const aligned =
    (matter === 'housing' && /hous|neighbour|deposit/.test(id)) ||
    (matter === 'employment' && /emp-/.test(id)) ||
    (matter === 'family' && /fam-/.test(id)) ||
    (matter === 'consumer' && /cons-/.test(id)) ||
    (matter === 'debt' && /debt-/.test(id)) ||
    (matter === 'crime' && /crime-/.test(id)) ||
    (matter === 'immigration' && /imm-/.test(id)) ||
    matter === 'other' ||
    matter === 'unknown'
  if (fit >= 45 && aligned) return { grade: 'pass', notes: `${id} fit=${fit}` }
  if (fit >= 35 || aligned) return { grade: 'partial', notes: `${id} fit=${fit}` }
  return { grade: 'partial', notes: `Weak frame ${id} fit=${fit}` }
}

function gradeAuthority(opts: {
  official: number
  exaCache: number
  firm: number
  total: number
  auditOk: boolean
}): { grade: Grade; notes: string } {
  if (opts.official >= 1) {
    return {
      grade: 'pass',
      notes: `Official=${opts.official}, exaCache=${opts.exaCache}, firm=${opts.firm}`,
    }
  }
  if (opts.exaCache >= 1) {
    return {
      grade: 'partial',
      notes: `Exa-cache fallback only (${opts.exaCache}); no official seed`,
    }
  }
  if (opts.firm >= 1) {
    return { grade: 'partial', notes: `Firm commentary only (${opts.firm})` }
  }
  return { grade: 'fail', notes: 'No authority hits (seed/exa/firm)' }
}

function gradeOslaw(
  matter: string,
  course: { title?: string; steps?: unknown[] } | null,
): { grade: Grade; notes: string } {
  if (course?.title && (course.steps?.length || 0) > 0) {
    return { grade: 'pass', notes: course.title }
  }
  if (matter === 'other' || matter === 'unknown') {
    return { grade: 'partial', notes: 'No OSLAW pathway (ambiguous matter)' }
  }
  return { grade: 'fail', notes: 'No OSLAW course' }
}

function gradeRecommendation(answer: import('../lib/coherence/answerPackage').AnswerPackage): {
  grade: Grade
  notes: string
} {
  const bullets = answer.bullets?.length || 0
  if (bullets >= 2 && answer.citation?.ok) {
    return { grade: 'pass', notes: `${bullets} bullets, citation ok` }
  }
  if (bullets >= 1 || answer.answerOverview?.length > 40) {
    return { grade: 'partial', notes: `${bullets} bullets; citation=${answer.citation?.ok}` }
  }
  return { grade: 'fail', notes: 'Thin recommendation package' }
}

function gradeMatchingHelp(opts: {
  matterType: string
  freeCount: number
  solicitorCount: number
  officialCount: number
}): { grade: Grade; notes: string } {
  const total = opts.freeCount + opts.officialCount
  if (opts.matterType === 'unknown') {
    return { grade: 'partial', notes: 'Unknown matter — help may be generic' }
  }
  if (total >= 3 && opts.solicitorCount >= 1) {
    return { grade: 'pass', notes: `Free/official ${total}, solicitors ${opts.solicitorCount}` }
  }
  if (total >= 2) return { grade: 'pass', notes: `Free/official ${total}, sols ${opts.solicitorCount}` }
  if (total >= 1) return { grade: 'partial', notes: `Sparse help (${total})` }
  return { grade: 'fail', notes: 'No matching help' }
}

function gradeConcepts(opts: {
  clusterIds: string[]
  intents: string[]
  wikiTitles: string[]
  matter: string
}): { grade: Grade; notes: string } {
  const intents = opts.intents.join(' | ')
  const bleed =
    opts.matter !== 'employment' &&
    /unfair dismissal employment tribunal/i.test(intents) &&
    !opts.clusterIds.length
  if (bleed) {
    return { grade: 'fail', notes: `Dismissal default bleed; clusters=${opts.clusterIds.join(',') || 'none'}` }
  }
  if (opts.clusterIds.length && opts.wikiTitles.length >= 1) {
    return {
      grade: 'pass',
      notes: `${opts.clusterIds.slice(0, 2).join('+')} → ${opts.wikiTitles.slice(0, 2).join('; ')}`,
    }
  }
  if (opts.intents.length >= 2) {
    return { grade: 'partial', notes: `No cluster; ${opts.intents.length} intents (Area/keyphrase)` }
  }
  return { grade: 'fail', notes: 'No concept intents' }
}

async function runCase(
  post: PostRow,
  deps: Awaited<ReturnType<typeof loadDeps>>,
): Promise<AuditCase> {
  const { createInitialSession, senseDetails, nextPrompt, proposeCoherentFrames, matchOslawCourse, buildAnswerPackage, buildHelpPack, buildAuthorityPackage, tryAutoAuthorityResolve, needsAuthorityInterrogator, applyAuthorityInterrogator, suggestMatterFromText, prepareAuthorityRetrievalText, retrieveAuthorityOfficial, retrieveAuthorityExaCache, retrieveAuthorityFirms } =
    deps

  let session = createInitialSession()
  session = senseDetails(post.query, session)
  const matterStart = session.matterType
  const promptIds: string[] = []
  let turns = 0
  let complete = false

  for (let t = 0; t < MAX_TURNS; t++) {
    const prompt = nextPrompt(session)
    if (prompt.id === 'complete') {
      complete = true
      promptIds.push('complete')
      break
    }
    const reply = autoReply(prompt, post)
    session = senseDetails(reply, session)
    session = applyGapAnswer(prompt.id, reply, session)
    session = {
      ...session,
      answeredPromptIds: Array.from(new Set([...session.answeredPromptIds, prompt.id])),
      goal: session.goal || (/goal|constraint_goal/.test(prompt.id) ? reply : session.goal),
    }
    promptIds.push(prompt.id)
    turns++
  }

  let authorityMode: 'auto_seed' | 'simulated_topic' | 'none' = 'none'
  if (needsAuthorityInterrogator(session)) {
    const auto = tryAutoAuthorityResolve(session)
    if (auto) {
      session = auto
      authorityMode = 'auto_seed'
    } else {
      const suggested = suggestMatterFromText(post.query.toLowerCase())
      const topic =
        suggested === 'unknown' || suggested === 'personal_injury' || suggested === 'conveyancing'
          ? flairMatterHint(post.flair || '', post.query.toLowerCase())
          : suggested
      const answers: Record<string, string> = {
        authority_topic: topic === 'immigration' ? 'other' : topic,
        authority_goal: 'rights',
      }
      if (session.jurisdiction === 'Unknown') answers.authority_jurisdiction = 'EnglandWales'
      session = applyAuthorityInterrogator(session, answers)
      authorityMode = 'simulated_topic'
    }
  }

  const prep = prepareAuthorityRetrievalText({
    original: post.query,
    confirmedReformulation: session.confirmedSearchQuery || null,
  })
  const retrieval = prep.retrievalText
  const officialHits = retrieveAuthorityOfficial(retrieval, 6)
  const exaHits = retrieveAuthorityExaCache(retrieval, 4)
  const firmHits = retrieveAuthorityFirms(retrieval, 4, session.matterType)
  const authPack = buildAuthorityPackage(session)

  session = {
    ...session,
    styleTranslatedQuery: prep.retrievalText.slice(0, 500),
  }

  const frameList = proposeCoherentFrames(session, 4)
  const frames = frameList.slice(0, 3).map((f) => ({
    id: f.id,
    label: f.label,
    fit: f.fitScore ?? f.score,
  }))
  const course = await matchOslawCourse(session, frameList, 3)
  const answer = buildAnswerPackage(session, frameList)
  const pack = await buildHelpPack(session, frameList)

  // Concept-planned retrieval (Area defaults + clusters) — same path Overview uses
  const matterResolved = deps.resolveMatterFrame({
    submission: post.query,
    clientQuestion: session.goal || '',
    understanding: session.whatHappened || post.query.slice(0, 400),
  })
  const conceptPlan = deps.buildConceptRetrievalPlan(matterResolved.frame, post.query)
  const wikiEvidence = deps.KnowledgeRetriever.forMatter({
    matterFrame: matterResolved.frame,
    submission: post.query,
    limit: 6,
  })
  const wikiTitles = wikiEvidence.hits.map((h) => h.title)

  if (LIVE_SRA && !pack.sraFirms.length) {
    try {
      const { buildSraSearchPayload, sraMatchReason } = await import('../lib/coherence/sraQuery')
      const payload = buildSraSearchPayload(session, frameList, 5)
      const res = await fetch(`${LIVE_SRA}/api/coherence/sra/search`, {
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
          }>
        }
        pack.sraFirms = (data.hits || []).map((h) => ({
          id: `sra:${h.sraId}`,
          title: h.name,
          type: 'SRA-regulated firm',
          blurb: [
            sraMatchReason(h.workArea || '', payload),
            [h.city, h.postcode].filter(Boolean).join(' · '),
          ].join(' — '),
          phone: h.phone || undefined,
          sraId: h.sraId,
          score: h.score,
        }))
      }
    } catch {
      /* ignore */
    }
  }

  const matterEnd = session.matterType
  const iG = gradeInteractive({ complete, turns, matterStart, matterEnd })
  const tG = gradeTimeline(session)
  const fG = gradeFrames(matterEnd, frames)
  const aG = gradeAuthority({
    official: officialHits.length,
    exaCache: exaHits.length,
    firm: firmHits.length,
    total: authPack.hits.length,
    auditOk: authPack.auditOk,
  })
  const oG = gradeOslaw(matterEnd, course)
  const rG = gradeRecommendation(answer)
  const freeCount = pack.freeServices.length + pack.signposts.length
  const officialCount = pack.authorityOfficial.length
  const mG = gradeMatchingHelp({
    matterType: matterEnd,
    freeCount: freeCount + officialCount,
    solicitorCount: pack.sraFirms.length,
    officialCount,
  })
  const cG = gradeConcepts({
    clusterIds: conceptPlan.clusterIds,
    intents: conceptPlan.intents,
    wikiTitles,
    matter: matterEnd,
  })

  const overall = overallGrade([
    iG.grade,
    tG.grade,
    fG.grade,
    aG.grade,
    oG.grade,
    rG.grade,
    mG.grade,
    cG.grade,
  ])

  return {
    id: post.id,
    title: post.title,
    url: post.url,
    flair: post.flair || '',
    interactive: {
      turns,
      promptIds,
      complete,
      matterStart,
      matterEnd,
      grade: iG.grade,
      notes: iG.notes,
    },
    timeline: {
      eventCount: session.events.length,
      partyCount: session.parties.length,
      hasGoal: Boolean(session.goal?.trim()),
      grade: tG.grade,
      notes: tG.notes,
    },
    frames: {
      top: frames,
      topFit: frames[0]?.fit ?? 0,
      grade: fG.grade,
      notes: fG.notes,
    },
    authority: {
      mode: authorityMode,
      official: officialHits.length,
      exaCache: exaHits.length,
      firm: firmHits.length,
      total: authPack.hits.length,
      usedExaFallback: officialHits.length === 0 && exaHits.length > 0,
      auditOk: authPack.auditOk,
      grade: aG.grade,
      notes: aG.notes,
    },
    oslaw: {
      pathwayTitle: course?.title || null,
      stepCount: course?.steps?.length || 0,
      grade: oG.grade,
      notes: oG.notes,
    },
    recommendation: {
      topicId: answer.matchedTopicId,
      bulletCount: answer.bullets?.length || 0,
      citationOk: Boolean(answer.citation?.ok),
      freeHelpCount: answer.freeHelp?.length || 0,
      grade: rG.grade,
      notes: rG.notes,
    },
    matchingHelp: {
      freeCount: freeCount + officialCount,
      officialCount,
      solicitorCount: pack.sraFirms.length,
      grade: mG.grade,
      notes: mG.notes,
    },
    concepts: {
      clusterIds: conceptPlan.clusterIds,
      intents: conceptPlan.intents.slice(0, 6),
      primarySlug: matterResolved.frame.primaryIssues[0]?.slug || null,
      wikiTitles: wikiTitles.slice(0, 4),
      grade: cG.grade,
      notes: cG.notes,
    },
    overall,
  }
}

async function loadDeps() {
  const { createInitialSession, senseDetails } = await import('../lib/coherence/sense')
  const { nextPrompt } = await import('../lib/coherence/questions')
  const { proposeCoherentFrames } = await import('../lib/coherence/frames')
  const { matchOslawCourse } = await import('../lib/coherence/wiki')
  const { buildAnswerPackage } = await import('../lib/coherence/answerPackage')
  const { buildHelpPack } = await import('../lib/coherence/services')
  const {
    buildAuthorityPackage,
    tryAutoAuthorityResolve,
    needsAuthorityInterrogator,
    applyAuthorityInterrogator,
    suggestMatterFromText,
    retrieveAuthorityOfficial,
    retrieveAuthorityExaCache,
    retrieveAuthorityFirms,
  } = await import('../lib/coherence/authorityInterrogator')
  const { prepareAuthorityRetrievalText } = await import('../lib/coherence/authorityQueryRewrite')
  const { resolveMatterFrame } = await import('../lib/matter/resolve')
  const { buildConceptRetrievalPlan } = await import('../lib/matter/conceptRetrievalPlan')
  const { KnowledgeRetriever } = await import('../lib/matter/retrieve')
  return {
    createInitialSession,
    senseDetails,
    nextPrompt,
    proposeCoherentFrames,
    matchOslawCourse,
    buildAnswerPackage,
    buildHelpPack,
    buildAuthorityPackage,
    tryAutoAuthorityResolve,
    needsAuthorityInterrogator,
    applyAuthorityInterrogator,
    suggestMatterFromText,
    prepareAuthorityRetrievalText,
    retrieveAuthorityOfficial,
    retrieveAuthorityExaCache,
    retrieveAuthorityFirms,
    resolveMatterFrame,
    buildConceptRetrievalPlan,
    KnowledgeRetriever,
  }
}

function tally(cases: AuditCase[], key: keyof AuditCase) {
  const g = { pass: 0, partial: 0, fail: 0 }
  for (const c of cases) {
    const grade =
      key === 'overall' ? c.overall : (c[key] as { grade: Grade }).grade
    g[grade]++
  }
  return g
}

async function main() {
  const posts = loadPosts(LIMIT)
  console.info(JSON.stringify({ event: 'start', count: posts.length, from: FROM_FILE, liveSra: LIVE_SRA || 'local' }))
  const deps = await loadDeps()
  const cases: AuditCase[] = []

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]!
    console.info(JSON.stringify({ event: 'case', i: i + 1, id: post.id, title: post.title.slice(0, 60) }))
    cases.push(await runCase(post, deps))
    if (LIVE_SRA && i % 5 === 4) await sleep(150)
  }

  const n = cases.length
  const dims = [
    'interactive',
    'timeline',
    'frames',
    'authority',
    'oslaw',
    'recommendation',
    'matchingHelp',
    'concepts',
    'overall',
  ] as const
  const summary: Record<string, { pass: number; partial: number; fail: number; passRate: number }> = {}
  for (const d of dims) {
    const t = tally(cases, d)
    summary[d] = { ...t, passRate: n ? t.pass / n : 0 }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: FROM_FILE,
    count: n,
    liveSra: LIVE_SRA || null,
    maxTurns: MAX_TURNS,
    summary,
    aggregate: {
      matterUnknownStart: cases.filter((c) => c.interactive.matterStart === 'unknown').length,
      matterUnknownEnd: cases.filter((c) => c.interactive.matterEnd === 'unknown').length,
      intakeComplete: cases.filter((c) => c.interactive.complete).length,
      avgTurns: n ? cases.reduce((s, c) => s + c.interactive.turns, 0) / n : 0,
      avgTimelineEvents: n ? cases.reduce((s, c) => s + c.timeline.eventCount, 0) / n : 0,
      exaFallbackUsed: cases.filter((c) => c.authority.usedExaFallback).length,
      authorityOfficialAny: cases.filter((c) => c.authority.official >= 1).length,
      avgFrameFit: n ? cases.reduce((s, c) => s + c.frames.topFit, 0) / n : 0,
      conceptClusterHits: cases.filter((c) => c.concepts.clusterIds.length > 0).length,
    },
    cases,
  }

  mkdirSync(path.dirname(OUT_JSON), { recursive: true })
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2))

  const pct = (x: number) => `${Math.round(x * 100)}%`
  const lines = [
    '# Reddit full Coherence audit (r/LegalAdviceUK)',
    '',
    `Generated: ${report.generatedAt}`,
    `Posts: ${n} · Source: \`${FROM_FILE}\``,
    `Interactive max turns: ${MAX_TURNS} · Live SRA: ${LIVE_SRA || 'off'}`,
    '',
    '## Pass rates (strict pass)',
    '',
    '| Dimension | Pass | Partial | Fail | Pass rate |',
    '|---|---:|---:|---:|---:|',
  ]
  for (const d of dims) {
    const s = summary[d]!
    lines.push(
      `| ${d} | ${s.pass} | ${s.partial} | ${s.fail} | ${pct(s.passRate)} |`,
    )
  }
  lines.push('', '## Aggregate', '')
  lines.push(`- Matter unknown: ${report.aggregate.matterUnknownStart} → ${report.aggregate.matterUnknownEnd} (after intake)`)
  lines.push(`- Intake complete: ${report.aggregate.intakeComplete}/${n}`)
  lines.push(`- Avg interactive turns: ${report.aggregate.avgTurns.toFixed(1)}`)
  lines.push(`- Avg timeline events: ${report.aggregate.avgTimelineEvents.toFixed(1)}`)
  lines.push(`- Avg top frame fit: ${report.aggregate.avgFrameFit.toFixed(0)}`)
  lines.push(`- Concept cluster hit: ${report.aggregate.conceptClusterHits}/${n}`)
  lines.push(`- Authority official hits: ${report.aggregate.authorityOfficialAny}/${n}`)
  lines.push(`- Exa-cache fallback (no official): ${report.aggregate.exaFallbackUsed}/${n}`)
  lines.push('', '_Exa = offline `authorityExaIndex.json` only — no live Exa per query._', '')
  lines.push('## Sample passes / fails', '')
  for (const c of cases.filter((x) => x.overall === 'pass').slice(0, 5)) {
    lines.push(
      `- ✓ **${c.title.slice(0, 70)}** — matter \`${c.interactive.matterEnd}\`, timeline ${c.timeline.eventCount}, OSLAW: ${c.oslaw.pathwayTitle || '—'}, clusters: ${c.concepts.clusterIds.join(',') || 'none'}`,
    )
  }
  lines.push('')
  for (const c of cases.filter((x) => x.overall === 'fail').slice(0, 8)) {
    lines.push(
      `- ✗ **${c.title.slice(0, 70)}** — interactive=${c.interactive.grade}, timeline=${c.timeline.grade}, oslaw=${c.oslaw.grade}, concepts=${c.concepts.grade} (${c.concepts.notes})`,
    )
  }
  lines.push('', '## Cases', '')
  for (const c of cases) {
    lines.push(`### ${c.title}`)
    lines.push(`- [post](${c.url}) · flair: ${c.flair || '—'} · overall **${c.overall}**`)
    lines.push(
      `- Interactive (${c.interactive.turns} turns): ${c.interactive.matterStart}→${c.interactive.matterEnd} — ${c.interactive.notes}`,
    )
    lines.push(`- Timeline: ${c.timeline.eventCount} events — ${c.timeline.notes}`)
    lines.push(
      `- Frames: ${c.frames.top.map((f) => `${f.label} (${f.fit})`).join('; ') || 'none'} — ${c.frames.notes}`,
    )
    lines.push(
      `- Authority (${c.authority.mode}): official ${c.authority.official}, exa ${c.authority.exaCache}, firm ${c.authority.firm} — ${c.authority.notes}`,
    )
    lines.push(`- OSLAW: ${c.oslaw.pathwayTitle || 'none'} — ${c.oslaw.notes}`)
    lines.push(
      `- Recommendation: topic=${c.recommendation.topicId || 'none'}, bullets=${c.recommendation.bulletCount} — ${c.recommendation.notes}`,
    )
    lines.push(`- Matching Help: free/official ${c.matchingHelp.freeCount}, SRA ${c.matchingHelp.solicitorCount} — ${c.matchingHelp.notes}`)
    lines.push(
      `- Concepts: slug=${c.concepts.primarySlug || '—'}, clusters=${c.concepts.clusterIds.join(',') || 'none'} — ${c.concepts.notes}`,
    )
    if (c.concepts.wikiTitles.length) {
      lines.push(`  - Wiki: ${c.concepts.wikiTitles.join('; ')}`)
    }
    lines.push('')
  }
  writeFileSync(OUT_MD, lines.join('\n'))
  console.info(JSON.stringify({ event: 'done', json: OUT_JSON, md: OUT_MD, summary }))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
