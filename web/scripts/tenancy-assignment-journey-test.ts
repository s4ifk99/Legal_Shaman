/**
 * Client journey test: deed of assignment / deposit / inventory (production Third Eye + SRA).
 */
import './load-dotenv'

import Module from 'node:module'

type NodeLoad = (request: string, parent: unknown, isMain: boolean) => unknown
const nodeModule = Module as typeof Module & { _load: NodeLoad }
const load = nodeModule._load
nodeModule._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {}
  return load(request, parent, isMain)
}

const PROMPT = `I am due to move into a new rental flat in England in a few weeks' time. There is a pre-existing tenancy for the current two tenants - one tenant is staying, the other is moving out and I am taking their place. The letting agent has provided us all with a deed of assignment to sign, basically confirming that I am taking the place of the tenant who is moving out. Part of this agreement includes the following:

"The replacement tenant and the outgoing tenant have settled the question of any deterioration at the property since the date of the inventory/check in document. The remaining tenant and the replacement tenant agree to be responsible to the landlord for any such deterioration other than fair wear and tear."

For the deposit itself, I think the letting agency is going to change the deposit protection info to reflect me as a new tenant. As part of that, I send the letting agency my share of the deposit, which they then use to reimburse the outgoing tenant.

My concern is that:

The inventory they have sent me is five years old;

I'm not convinced we as tenants are qualified to determine what constitutes "damage" beyond wear and tear (and to what value).

I'm therefore a little apprehensive about the clause above, and the possibility of a deposit dispute in the future for any damage that occurred in the five years before I moved in. Especially in terms of some vague notion that I should have "settled it" with the outgoing tenant beforehand (when we're talking about a flat that neither of us own or have a vested interest in). Ideally, I'd ask the letting agency for a new inventory, but even if they say no, I really need a place to live and would just have to sign anyway.

Are there any established rules/laws for these types of situations?`

const CLIENT_QUESTION =
  'Are there established rules or laws for signing a deed of assignment when the inventory is five years old and I may inherit liability for pre-existing damage?'

const BASE = process.env.LIVE_SITE?.trim() || 'https://www.legalshaman.com'
const CASE_KEY = `case-tenancy-assign-${Date.now().toString(36)}`

async function thirdEyeResearch(message = '') {
  const res = await fetch(`${BASE}/api/coherence/aramb/research`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': `journey-${Date.now()}`,
      'x-idempotency-key': `journey-${Date.now()}`,
    },
    body: JSON.stringify({
      latestText: PROMPT,
      understanding: PROMPT.slice(0, 1500),
      clientQuestion: CLIENT_QUESTION,
      message,
      searchMode: 'penumbra',
      caseKey: CASE_KEY,
      stream: false,
    }),
  })
  const data = (await res.json()) as Record<string, unknown>
  return { ok: res.ok, status: res.status, data }
}

async function liveSraSearch(matterType: string, story: string) {
  const res = await fetch(`${BASE}/api/coherence/sra/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: story.slice(0, 500),
      matterType,
      limit: 6,
    }),
  })
  return (await res.json()) as Record<string, unknown>
}

async function main() {
  const { createInitialSession, senseDetails } = await import('../lib/coherence/sense')
  const { proposeCoherentFrames } = await import('../lib/coherence/frames')
  const { buildLawyerBrief } = await import('../lib/coherence/brief')
  const { buildHelpPack, matchingSessionForHelp } = await import('../lib/coherence/services')
  const { buildAnswerPackage } = await import('../lib/coherence/answerPackage')
  const { MatterEngine } = await import('../lib/matter/resolve')

  let session = {
    ...createInitialSession(),
    searchMode: 'penumbra' as const,
    penumbraAcknowledged: true,
    mode: 'explain' as const,
    clientQuestion: CLIENT_QUESTION,
    whatHappened: PROMPT,
    rawInputs: [PROMPT],
  }
  session = senseDetails(PROMPT, session)

  const matter = MatterEngine.resolve({
    submission: PROMPT,
    clientQuestion: CLIENT_QUESTION,
    understanding: PROMPT,
  })

  const t0 = Date.now()
  let research = await thirdEyeResearch()
  let bundle = (research.data.bundle || null) as import('../lib/coherence/researchBundle').ResearchBundle | null
  let fallback = research.data.fallback === true

  if (research.data.status === 'needs_input' && Array.isArray(research.data.questions) && research.data.questions.length) {
    research = await thirdEyeResearch('__penumbra_skip_question__')
    bundle = (research.data.bundle || bundle) as typeof bundle
    fallback = research.data.fallback === true
  }

  session = {
    ...session,
    penumbraResearch: {
      status: 'complete',
      caseKey: CASE_KEY,
      conversationId: String(research.data.conversationId || ''),
      questions: [],
      bundle: bundle || undefined,
      fallback,
      updatedAt: new Date().toISOString(),
    },
  }

  const frames = proposeCoherentFrames(session, 4)
  const brief = buildLawyerBrief(session, 72, frames)
  const helpSession = matchingSessionForHelp(session)
  const helpPack = await buildHelpPack(helpSession, frames)
  const answer = buildAnswerPackage(session, frames, { researchBundle: bundle || undefined })

  const matterType = helpSession.matterType || bundle?.matching?.matterType || 'housing'
  const sra = await liveSraSearch(matterType, PROMPT)

  const report = {
    elapsedMs: Date.now() - t0,
    matterPrimary: matter.frame?.primaryIssues?.[0]?.slug || null,
    thirdEye: {
      fallback,
      latencyMs: research.data.latencyMs,
      status: research.data.status,
      sources: (bundle?.sources || []).map((s) => ({
        title: s.title,
        origin: s.origin,
        tier: s.tier,
        url: s.url || undefined,
      })),
      claims: bundle?.claims || [],
      missingFacts: bundle?.missingFacts || [],
      nextActions: bundle?.nextActions || [],
      answerDraft: bundle?.answerDraft?.slice(0, 1200) || null,
      diagnostic: research.data.researchDiagnostic || null,
    },
    timeline: {
      eventCount: session.events.length,
      events: session.events.map((e) => ({ date: e.date, label: e.label, certainty: e.certainty })),
      briefTimeline: brief.timeline.map((r) => ({ when: r.when, what: r.what })),
    },
    recommendation: {
      overview: answer.answerOverview || '',
      options: answer.options || [],
      followUps: answer.followUps || [],
      wikiLinks: (answer.wikiLinks || []).slice(0, 6).map((w) => ({ title: w.title, url: w.url })),
    },
    freeHelp: helpPack.freeServices.slice(0, 8).map((s) => ({
      title: s.title,
      phone: s.phone,
      url: s.url,
      blurb: s.blurb?.slice(0, 160),
    })),
    authority: helpPack.authorityOfficial.slice(0, 5).map((a) => ({
      title: a.title,
      url: a.url,
    })),
    solicitors: {
      sraReachable: (sra as { reachable?: boolean }).reachable,
      sraTotal: (sra as { total?: number }).total,
      firms: ((sra as { results?: unknown[] }).results || []).slice(0, 6).map((r) => {
        const row = r as Record<string, unknown>
        return {
          name: row.name || row.display_name,
          city: row.city || row.office_town,
          areas: row.work_areas || row.practice_areas,
        }
      }),
      packSraCount: helpPack.sraFirms.length,
    },
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
