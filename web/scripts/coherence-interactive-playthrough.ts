/**
 * Interactive Coherence agent playthrough (local libraries + OpenRouter reformulation).
 * Simulates multi-turn intake like /ask-the-shaman — live POST master stays auth-gated.
 *
 * Usage:
 *   npx tsx scripts/coherence-interactive-playthrough.ts
 *   npx tsx scripts/coherence-interactive-playthrough.ts --story=family
 *   npx tsx scripts/coherence-interactive-playthrough.ts --story=housing --live-sra=https://www.legalshaman.com
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

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require('dotenv') as typeof import('dotenv')
  config({ path: path.resolve(process.cwd(), '../../LS R&D/.env') })
} catch {
  /* optional */
}

const STORY_KEY = process.argv.find((a) => a.startsWith('--story='))?.split('=')[1] || 'family'
const LIVE_SRA =
  process.argv.find((a) => a.startsWith('--live-sra='))?.split('=')[1]?.replace(/\/$/, '') ||
  'https://www.legalshaman.com'
const MAX_TURNS = Number(process.argv.find((a) => a.startsWith('--max-turns='))?.split('=')[1] || 10)

type StoryPack = {
  id: string
  title: string
  opener: string
  /** Extra replies keyed by prompt id prefix / substring */
  replies: Record<string, string>
  defaultGoal: string
  expectedMatter: string
}

const STORIES: Record<string, StoryPack> = {
  family: {
    id: 'family-ex-switch',
    title: 'Ex damaged Switch / belongings at her house (family bleed test)',
    opener:
      'England. My ex damaged my Switch and some of my stuff when I went to collect them from her house. Our 6 year old was there. I just want to know where I stand and if I can claim for the damaged belongings without making contact arrangements worse.',
    replies: {
      matter: 'This is mainly about family, children or domestic abuse',
      gap_goal: 'Understand my rights and whether I can claim for the damaged Switch without harming child arrangements',
      constraint_goal:
        'Understand my rights and whether I can claim for the damaged Switch without harming child arrangements',
      gap_where: 'England — Manchester area',
      constraint_jurisdiction: 'England',
      gap_evidence: 'Photos of the damaged Switch, messages about collection, and texts about the child being present',
      documents: 'Photos of damage and WhatsApp messages',
      gap_responsible: 'My ex-partner',
      gap_when: 'Last Saturday',
      constraint_children_detail: 'We have a 6 year old; informal contact every other weekend',
      constraint_family_link: 'We were living separately; child arrangements are informal',
      constraint_safety: 'I am safe for now',
      safety: 'I am safe for now',
    },
    defaultGoal: 'Know my rights on damaged belongings after collection from ex, without worsening child contact',
    expectedMatter: 'family',
  },
  housing: {
    id: 'housing-landlord-entry',
    title: 'Landlord wants entry with two hours notice',
    opener:
      'England. My landlord emailed saying he wants to come into our flat this afternoon with only two hours notice to show contractors around. We work from home and have a toddler. Is he allowed to do that?',
    replies: {
      matter: 'This is mainly about housing or a neighbour dispute',
      gap_goal: 'Know if the landlord can enter with two hours notice and what notice is required',
      constraint_goal: 'Know if the landlord can enter with two hours notice and what notice is required',
      gap_where: 'England — Bristol',
      constraint_jurisdiction: 'England',
      gap_evidence: 'Email from landlord timed today asking to enter this afternoon',
      documents: 'Tenancy agreement and landlord email',
      gap_responsible: 'Landlord',
      gap_when: 'Today',
      constraint_housing_notice: 'He gave about two hours notice by email',
      safety: 'I am safe for now',
    },
    defaultGoal: 'Understand lawful notice for landlord entry',
    expectedMatter: 'housing',
  },
  employment: {
    id: 'employment-unpaid-weeks',
    title: 'Not paid for first two weeks of work',
    opener:
      'England. I started a new job two weeks ago and have not been paid for those first two weeks. Payroll keep saying it will be on the next run. My contract says monthly in arrears. What can I do?',
    replies: {
      matter: 'This is mainly about employment or my job',
      gap_goal: 'Get the unpaid wages paid and understand next steps if they refuse',
      constraint_goal: 'Get the unpaid wages paid and understand next steps if they refuse',
      gap_where: 'England — Leeds',
      constraint_jurisdiction: 'England',
      gap_evidence: 'Employment contract, timesheets, and emails with payroll',
      documents: 'Contract and payslip emails',
      gap_responsible: 'Employer / payroll',
      gap_when: 'Started two weeks ago; payday was last Friday',
      constraint_employment_status: 'I am an employee on a permanent contract',
      constraint_acas: 'I have not contacted ACAS yet',
      safety: 'I am safe for now',
    },
    defaultGoal: 'Recover unpaid wages for first two weeks',
    expectedMatter: 'employment',
  },
}

type Turn = {
  n: number
  promptId: string
  promptText: string
  promptKind: string
  options?: Array<{ id: string; label: string; value: string }>
  userReply: string
  matterAfter: string
  modeAfter: string
}

function pickReply(
  story: StoryPack,
  prompt: { id: string; text: string; options?: Array<{ id: string; label: string; value: string }> },
): string {
  if (story.replies[prompt.id]) return story.replies[prompt.id]
  for (const [key, val] of Object.entries(story.replies)) {
    if (prompt.id.startsWith(key) || prompt.id.includes(key)) return val
  }
  if (prompt.options?.length) {
    // Prefer option whose label/value matches expected matter words
    const want = story.expectedMatter
    const hit = prompt.options.find((o) =>
      new RegExp(want === 'family' ? 'family|child' : want, 'i').test(`${o.label} ${o.value}`),
    )
    if (hit) return hit.value
    return prompt.options[0]!.value
  }
  if (/goal|want|need/i.test(prompt.text)) return story.defaultGoal
  if (/where|england|scotland|jurisdiction|live/i.test(prompt.text)) return 'England'
  if (/document|evidence|proof/i.test(prompt.text)) return story.replies.documents || 'Photos and messages'
  if (/safe|danger|urgent/i.test(prompt.text)) return 'I am safe for now'
  return story.defaultGoal
}

async function reformulate(
  session: import('../lib/coherence/types').SessionState,
  original: string,
): Promise<string | null> {
  const { coherenceOpenRouterConfig } = await import('../lib/coherence/config')
  const { parseReformulationResponse } = await import('../lib/coherence/legalReformulation')
  const { apiKey, model, siteUrl, siteName } = coherenceOpenRouterConfig()
  if (!apiKey) return null
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': siteUrl,
      'X-Title': siteName,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'Rewrite this UK lay legal opener into one clear retrieval question. Preserve facts. No advice. Plain text only.',
        },
        {
          role: 'user',
          content: `Matter=${session.matterType}. Opener:\n${original}`,
        },
      ],
    }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const parsed = parseReformulationResponse(data.choices?.[0]?.message?.content || '', original)
  return parsed.kind === 'reformulation' ? parsed.text : null
}

async function main() {
  const story = STORIES[STORY_KEY] || STORIES.family
  console.info(JSON.stringify({ event: 'start', story: story.id, liveSra: LIVE_SRA }))

  const { createInitialSession, senseDetails } = await import('../lib/coherence/sense')
  const { nextPrompt } = await import('../lib/coherence/questions')
  const { proposeCoherentFrames } = await import('../lib/coherence/frames')
  const { matchOslawCourse } = await import('../lib/coherence/wiki')
  const { buildAnswerPackage } = await import('../lib/coherence/answerPackage')
  const { buildHelpPack } = await import('../lib/coherence/services')
  const { MatterEngine } = await import('../lib/matter/resolve')
  const { tryAutoAuthorityResolve, needsAuthorityInterrogator, applyAuthorityInterrogator, suggestMatterFromText } =
    await import('../lib/coherence/authorityInterrogator')
  const { glossaryStyleTranslate } = await import('../lib/coherence/styleTranslation')
  const { buildSraSearchPayload, relevantWorkAreas, sraMatchReason } = await import('../lib/coherence/sraQuery')

  // Inline applyGapAnswer subset (mirrors CoherenceApp)
  const applyGapAnswer = (
    promptId: string,
    value: string,
    next: import('../lib/coherence/types').SessionState,
  ) => {
    const v = value.trim()
    const lower = v.toLowerCase()
    if (promptId === 'matter' || promptId === 'matter_for_services') {
      if (/family|child|divorce|domestic/.test(lower)) return { ...next, matterType: 'family' as const }
      if (/hous|landlord|rent|neighbour|neighbor/.test(lower)) return { ...next, matterType: 'housing' as const }
      if (/employ|job|workplace|manager/.test(lower)) return { ...next, matterType: 'employment' as const }
      if (/insur|ticket|refund|trader|consumer|disability|access|wheelchair/.test(lower))
        return { ...next, matterType: 'consumer' as const }
      if (/debt|bailiff|ccj/.test(lower)) return { ...next, matterType: 'debt' as const }
      if (/crime|police/.test(lower)) return { ...next, matterType: 'crime' as const }
      if (/immig|visa/.test(lower)) return { ...next, matterType: 'immigration' as const }
      return { ...next, matterType: 'other' as const }
    }
    if (promptId === 'gap_goal' || promptId === 'constraint_goal') return { ...next, goal: next.goal || v }
    if (promptId === 'gap_where' || promptId === 'constraint_jurisdiction') {
      if (/scotland/.test(lower)) return { ...next, jurisdiction: 'Scotland' as const, locationHint: 'Scotland' }
      return { ...next, jurisdiction: 'EnglandWales' as const, locationHint: next.locationHint || v }
    }
    if (promptId === 'gap_evidence' || promptId === 'documents') {
      const docs = [...next.documents]
      if (v && !docs.includes(v)) docs.push(v.slice(0, 64))
      return { ...next, documents: docs }
    }
    if (promptId === 'safety' || promptId === 'constraint_safety') {
      return { ...next, safetyRisk: /urgent|danger|need help/i.test(lower) ? true : false }
    }
    if (promptId === 'gap_breach' || promptId === 'gap_refusal_reason') return { ...next, howCaused: v }
    if (promptId.startsWith('gap_') || promptId.startsWith('constraint_')) {
      return {
        ...next,
        whatHappened: next.whatHappened ? `${next.whatHappened} ${v}` : v,
      }
    }
    return next
  }

  let session = createInitialSession()
  const turns: Turn[] = []

  // Turn 0: opening story
  session = senseDetails(story.opener, session)
  turns.push({
    n: 0,
    promptId: 'open',
    promptText: 'Tell me what happened…',
    promptKind: 'open',
    userReply: story.opener,
    matterAfter: session.matterType,
    modeAfter: session.mode,
  })
  console.info(JSON.stringify({ event: 'turn', n: 0, matter: session.matterType, mode: session.mode }))

  for (let n = 1; n <= MAX_TURNS; n++) {
    const prompt = nextPrompt(session)
    if (prompt.id === 'complete') {
      turns.push({
        n,
        promptId: prompt.id,
        promptText: prompt.text,
        promptKind: prompt.kind,
        options: prompt.options,
        userReply: '(intake complete)',
        matterAfter: session.matterType,
        modeAfter: session.mode,
      })
      console.info(JSON.stringify({ event: 'complete', n, matter: session.matterType }))
      break
    }

    const reply = pickReply(story, prompt)
    session = senseDetails(reply, session)
    session = applyGapAnswer(prompt.id, reply, session)
    session = {
      ...session,
      answeredPromptIds: Array.from(new Set([...session.answeredPromptIds, prompt.id])),
      goal: session.goal || (prompt.id.includes('goal') ? reply : session.goal),
    }

    // MatterEngine resolution (same primitive master uses)
    const resolved = MatterEngine.resolve({
      submission: [story.opener, ...session.rawInputs.slice(1)].join('\n'),
      clientQuestion: session.goal || story.defaultGoal,
      understanding: session.whatHappened || story.opener,
    })
    const primarySlug = resolved.frame?.primary?.[0]?.slug
    if (primarySlug && session.matterType === 'unknown') {
      const map: Record<string, import('../lib/coherence/types').MatterType> = {
        housing: 'housing',
        employment: 'employment',
        family: 'family',
        consumer: 'consumer',
        debt: 'debt',
        crime: 'crime',
        immigration: 'immigration',
        personal_injury: 'personal_injury',
        conveyancing: 'conveyancing',
      }
      if (map[primarySlug]) session = { ...session, matterType: map[primarySlug]! }
    }

    turns.push({
      n,
      promptId: prompt.id,
      promptText: prompt.text,
      promptKind: prompt.kind,
      options: prompt.options,
      userReply: reply,
      matterAfter: session.matterType,
      modeAfter: session.mode,
    })
    console.info(
      JSON.stringify({
        event: 'turn',
        n,
        promptId: prompt.id,
        reply: reply.slice(0, 80),
        matter: session.matterType,
        enginePrimary: primarySlug || null,
      }),
    )
  }

  // Authority + reformulation (product workaround before Matching Help / OSLAW)
  if (needsAuthorityInterrogator(session)) {
    const auto = tryAutoAuthorityResolve(session)
    if (auto) session = auto
    else {
      const suggested = suggestMatterFromText(story.opener.toLowerCase())
      const answers: Record<string, string> = {
        authority_topic:
          suggested === 'immigration' ||
          suggested === 'personal_injury' ||
          suggested === 'conveyancing' ||
          suggested === 'unknown'
            ? story.expectedMatter
            : suggested,
        authority_goal: 'rights',
      }
      if (session.jurisdiction === 'Unknown') answers.authority_jurisdiction = 'EnglandWales'
      session = applyAuthorityInterrogator(session, answers)
    }
  }

  const reform = await reformulate(session, story.opener)
  if (reform) {
    session = {
      ...session,
      confirmedSearchQuery: reform,
      reformulationOutcome: 'confirmed',
      styleTranslatedQuery: glossaryStyleTranslate(reform, session.matterType),
    }
  }

  const frames = proposeCoherentFrames(session, 4)
  const course = await matchOslawCourse(session, frames, 3)
  const answer = buildAnswerPackage(session, frames)
  const pack = await buildHelpPack(session, frames)

  // Live SRA
  if (!pack.sraFirms.length) {
    try {
      const payload = buildSraSearchPayload(session, frames, 5)
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
      /* ignore */
    }
  }

  const matterOk = session.matterType === story.expectedMatter
  const report = {
    generatedAt: new Date().toISOString(),
    story: { id: story.id, title: story.title, expectedMatter: story.expectedMatter, opener: story.opener },
    note: 'Local interactive playthrough (sense + prompts + MatterEngine + reformulation + help). Live /api/coherence/llm/master remains auth-gated (unverified).',
    final: {
      matterType: session.matterType,
      matterMatchExpected: matterOk,
      mode: session.mode,
      jurisdiction: session.jurisdiction,
      locationHint: session.locationHint,
      goal: session.goal,
      confirmedSearchQuery: session.confirmedSearchQuery || null,
      topFrames: frames.slice(0, 4).map((f) => ({ id: f.id, label: f.label, fit: f.fitScore ?? f.score })),
      oslaw: course
        ? { title: course.title, pathwayId: course.pathwayId, steps: course.steps?.length || 0 }
        : null,
      answerTopicId: answer.matchedTopicId,
      freeServices: pack.freeServices.slice(0, 6).map((s) => s.title),
      authorityOfficial: pack.authorityOfficial.slice(0, 5).map((s) => s.title),
      solicitors: pack.sraFirms.slice(0, 5).map((s) => ({ title: s.title, blurb: s.blurb })),
    },
    turns,
  }

  const outDir = path.join(process.cwd(), 'reports')
  mkdirSync(outDir, { recursive: true })
  const stem = `coherence-interactive-${story.id}`
  const jsonPath = path.join(outDir, `${stem}.json`)
  const mdPath = path.join(outDir, `${stem}.md`)
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))

  const lines = [
    `# Interactive agent playthrough — ${story.title}`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `**Expected matter:** \`${story.expectedMatter}\` · **Got:** \`${session.matterType}\` · **Match:** ${matterOk ? 'YES' : 'NO'}`,
    '',
    '## Opening story',
    '',
    `> ${story.opener}`,
    '',
    '## Conversation',
    '',
  ]
  for (const t of turns) {
    lines.push(`### Turn ${t.n} — \`${t.promptId}\``)
    lines.push(`- **Agent:** ${t.promptText}`)
    if (t.options?.length) {
      lines.push(`- **Options:** ${t.options.map((o) => o.label).join(' · ')}`)
    }
    lines.push(`- **User:** ${t.userReply}`)
    lines.push(`- **Matter after:** \`${t.matterAfter}\` (mode \`${t.modeAfter}\`)`)
    lines.push('')
  }
  lines.push('## After reformulation + Matching Help / OSLAW', '')
  if (report.final.confirmedSearchQuery) {
    lines.push(`- **Reformulated query:** ${report.final.confirmedSearchQuery}`)
  }
  lines.push(`- **Frames:** ${report.final.topFrames.map((f) => f.label).join('; ') || '(none)'}`)
  lines.push(
    `- **OSLAW:** ${report.final.oslaw ? `${report.final.oslaw.title} (${report.final.oslaw.steps} steps)` : 'none'}`,
  )
  lines.push(`- **Answer topic:** ${report.final.answerTopicId || 'none'}`)
  lines.push(`- **Free / official:** ${(report.final.freeServices || []).concat(report.final.authorityOfficial || []).slice(0, 6).join('; ') || 'none'}`)
  lines.push(
    `- **Solicitors (live SRA):** ${report.final.solicitors.map((s) => s.title).join('; ') || 'none'}`,
  )
  lines.push('')
  lines.push(
    '_Note: Live interactive master LLM (`POST /api/coherence/llm/master`) returns `unverified` without a logged-in verified account. This playthrough uses the same local intake + MatterEngine + reformulation + help path the UI runs around that gate._',
  )
  writeFileSync(mdPath, lines.join('\n'))
  console.info(JSON.stringify({ event: 'wrote', json: jsonPath, md: mdPath, final: report.final }))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
