/**
 * Client-journey smoke test for Envy: Third Eye (Aramb), timeline, matching help.
 * Usage: npx tsx scripts/envy-property-journey-test.ts
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

const PROMPT = `I bought a property 2 years ago. Twice during that time during heavy rain storms, the storm gulley outside temporarily stopped taking water and it discharged into the highway.

This water came into my garden. A fairly significant amount, too. It drained pretty quickly after the storm stopped and the gully started taking water again.

I reported it to the council. However, and this is the issue, I exaggerated the severity of it and claimed it had entered the house. I even titled the FixMyStreet report as 'House was flooded' and said so again in email communication.

I can't believe how stupid this was. I laid it on thick so the council would actually do something about it.

I planned to put the house on the market next year and move (This has nothing to do with any issue with the house).

But, there's now a record of water entering the property and that isn't true.

It was just the garden and that was resolved by the council clearing the drain.

It happened again this weekend during the storms; I reported it again. This time I was honest about what had happened.

Then it dawned on me that me previous communication was not accurate.

I'm panicking and bit and absolutely kicking myself.

How the hell do I manage this should I wish to sell?`

const BASE = process.env.ENVY_APP_BASE?.trim() || 'http://127.0.0.1:3100'
const CASE_KEY = `case-envy-property-${Date.now().toString(36)}`

async function thirdEyeResearch(message = '') {
  const res = await fetch(`${BASE}/api/coherence/aramb/research`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': `envy-journey-${Date.now()}`,
      'x-idempotency-key': `envy-journey-${Date.now()}`,
    },
    body: JSON.stringify({
      latestText: PROMPT,
      understanding: PROMPT.slice(0, 1200),
      clientQuestion: 'How do I manage this if I wish to sell?',
      message,
      searchMode: 'penumbra',
      caseKey: CASE_KEY,
      stream: false,
    }),
  })
  const data = (await res.json()) as Record<string, unknown>
  return { ok: res.ok, status: res.status, data }
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
    clientQuestion: 'How do I manage this if I wish to sell?',
    whatHappened: PROMPT,
    rawInputs: [PROMPT],
  }
  session = senseDetails(PROMPT, session)

  const matter = MatterEngine.resolve({
    submission: PROMPT,
    clientQuestion: session.clientQuestion,
    understanding: session.whatHappened,
  })

  const t0 = Date.now()
  let research = await thirdEyeResearch()
  let bundle = (research.data.bundle || null) as import('../lib/coherence/researchBundle').ResearchBundle | null
  let fallback = research.data.fallback === true
  let conversationId = String(research.data.conversationId || '')

  if (research.data.status === 'needs_input' && Array.isArray(research.data.questions) && research.data.questions.length) {
    research = await thirdEyeResearch('__penumbra_skip_question__')
    bundle = (research.data.bundle || bundle) as typeof bundle
    fallback = research.data.fallback === true
    conversationId = String(research.data.conversationId || conversationId)
  }

  session = {
    ...session,
    penumbraResearch: {
      status: research.data.status === 'needs_input' ? 'awaiting_input' : 'complete',
      caseKey: CASE_KEY,
      conversationId,
      questions: Array.isArray(research.data.questions) ? (research.data.questions as string[]) : [],
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

  const summary = {
    elapsedMs: Date.now() - t0,
    thirdEye: {
      httpOk: research.ok,
      httpStatus: research.status,
      arambActive: Boolean(conversationId) && !fallback,
      fallback,
      status: research.data.status,
      questionCount: Array.isArray(research.data.questions) ? research.data.questions.length : 0,
      sourceCount: bundle?.sources?.length || 0,
      externalSources: bundle?.sources?.filter((s) => s.origin === 'external').length || 0,
      freeResourceLeads: bundle?.freeResources?.length || 0,
      matchingMatter: bundle?.matching?.matterType || null,
    },
    timeline: {
      eventCount: session.events.length,
      briefTimelineRows: brief.timeline.length,
      sample: brief.timeline.slice(0, 5),
    },
    matchingHelp: {
      matterType: helpSession.matterType,
      freeServices: helpPack.freeServices.length,
      authorityOfficial: helpPack.authorityOfficial.length,
      legalAid: helpPack.legalAid.length,
      sraFirms: helpPack.sraFirms.length,
      probono: helpPack.probono.length,
      sraMeta: helpPack.meta.sra || null,
    },
    recommendation: {
      hasOverview: Boolean(answer.answerOverview?.trim()),
      overviewPrefix: answer.answerOverview?.slice(0, 220) || '',
      wikiLinks: answer.wikiLinks?.length || 0,
      usedResearchBundle: Boolean(bundle),
    },
    matterEnginePrimary: matter.frame?.primaryIssues?.[0]?.slug || null,
  }

  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exitCode = 1
})
