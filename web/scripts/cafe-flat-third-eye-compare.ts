/**
 * Compare library Overview vs Third Eye on the cafe-flat story (no forced-exit update).
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

process.env.ENABLE_LLM_ANSWER = 'false'
process.env.ENABLE_ARAMB_PILOT = process.env.ENABLE_ARAMB_PILOT || '1'

const STORY = `I'm in a dispute with my landlord/employer about my right to stay in my flat. I'm giving as much detail as I can, because I don't know what's relevant.

I live above the cafe I used to run, the landlord is also my former employer. The cafe is now closed permanently, and my landlord wants me to leave.

I have an employment contract, but no tenancy agreement. My employment contract makes no mention of my accommodation being tied. My local Council has told me that they think I have rights as a tenant, my landlord is disputing this. He is insisting I leave on September 1st.

To complicate the issue, I had major knee surgery on Thursday. I need two crutches to hobble around, and even so I'm still extremely limited in how far I can go. I am physically incapable of moving out right now. My landlord is aware of this, and so is the housing department at the council.

On Friday, my employer/landlord switched off the internet, knowing I can't get signal for my phone in the flat (building made of 50cm thick stone walls, full lead pipes, far from a phone mast). He deliberately left me isolated and unable to call for help if I needed it, when I was less than 24hrs out of surgery.

Also on Friday, he sent me an email telling me I'd get my last wages and outstanding holiday pay "upon vacating the property on Sept 1st", so now I'm very worried he's not going to pay me.

I informed my assigned housing officer at the council about both, who got in touch with my landlord and asked if this could be resolved after the bank holiday weekend, which he refused. My housing officer gave me the emergency housing number in case anything happened over the bank holiday, and said there was nothing else she could do for the moment.

Yesterday I had to go to the pharmacy, it took me about an hour, and when I came home the front door to my flat had been removed. I immediately called the emergency housing people at the council, who attempted to call my landlord. When he didn't answer the phone, they advised me to call the police. I called them and got a crime reference number.

The emergency housing team said they'd keep trying to ring my landlord, the police said someone would ring me back but couldn't tell me when. Meanwhile, I still had no front door. I don't have any friends or family in the area I can stay with, so last night I had no choice but to stay in this flat with no door.

I just spent a sleepless night in my flat, and called the council and police again this morning to see if any progress could be made. The council said theres nothing they can do to help, the police again said someone will ring me but refused to give me a time frame.

I have been living off statutory sick pay (just under £125 a week) for the last couple of months, and I have burnt through all my savings so I don't have money for a hotel. The emergency housing team at the council told me they won't provide me with emergency alternative accommodation when I enquired whether I met the criteria, so I have nowhere else to go. I do not feel safe here, and I'm worried that the stress of it all is impacting my recovery from knee surgery.

I really don't know what my next step should be, and I hope maybe someone here can give me some advice. Shelter is not open until Tuesday morning, and my assigned housing officer at the council (who I believe would advocate for me far more forcefully than the emergency team) won't be back at work until then either.`

async function main() {
  const { createInitialSession, senseDetails } = await import('../lib/coherence/sense')
  const { proposeCoherentFrames } = await import('../lib/coherence/frames')
  const { attachResolvedMatterFrame } = await import('../lib/coherence/applyMatterFrame')
  const { matchingSessionForHelp, buildHelpPack } = await import('../lib/coherence/services')
  const { buildOverviewAnswer } = await import('../lib/coherence/overviewAnswer')
  const { KnowledgeRetriever, matterEvidenceToWikiHits } = await import('../lib/matter/retrieve')
  const { retrieveDworkinSnippetsForOverview } = await import('../lib/coherence/overviewDworkinPack')
  const { formatScopedResearchTools, runScopedResearchTools } = await import('../lib/aramb/tools')
  const { buildExaResearchBrief, cacheMatterKey } = await import('../lib/penumbra/exaBrief')
  const { runPenumbraResearch, penumbraResearchEnabled } = await import('../lib/penumbra/researcher')
  const { exaPenumbraConfigured } = await import('../lib/penumbra/exaSearch')
  const { matchingGuidanceFromFrame, preferFrameMatching } = await import('../lib/coherence/issueRouting')

  let session = senseDetails(STORY, {
    ...createInitialSession(),
    searchMode: 'penumbra',
    penumbraAcknowledged: true,
    mode: 'dispute',
  })
  const attached = attachResolvedMatterFrame(session, STORY)
  session = attached.session
  const frame = attached.frame
  const frames = proposeCoherentFrames(session, 4)
  const helpSession = matchingSessionForHelp(session)
  const help = await buildHelpPack(helpSession, frames)

  const { answerPackage: pack, meta } = await buildOverviewAnswer({
    latestText: STORY,
    clientQuestion: session.clientQuestion,
    understanding: session.briefUnderstanding,
    matterFrame: frame,
    taxonomySlug: frame.primaryIssues[0]?.slug,
    searchMode: 'penumbra',
  })

  const evidence = KnowledgeRetriever.forMatter({ matterFrame: frame, submission: STORY, limit: 8 })
  const hits = matterEvidenceToWikiHits(evidence.hits)
  const authority = retrieveDworkinSnippetsForOverview({
    query: STORY,
    taxonomySlug: frame.primaryIssues[0]?.slug,
    excludeTitles: hits.map((h) => h.title),
    limit: 2,
  })
  const scoped = runScopedResearchTools(
    hits,
    authority.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet, dworkinKind: s.dworkinKind })),
  )
  const planned = buildExaResearchBrief({
    story: STORY,
    frame,
    clientQuestion: session.clientQuestion,
  })
  const thirdEyeEnabled = penumbraResearchEnabled()
  const liveExa = exaPenumbraConfigured()
  const first = await runPenumbraResearch({
    mode: 'penumbra',
    query: planned.brief,
    sourceContext: formatScopedResearchTools(scoped.sources),
    canonicalSources: scoped.sources,
    tenantKey: 'local-compare:cafe-flat',
    matterSlug: cacheMatterKey(frame),
    exaQueries: planned.queries,
    coverageSlots: planned.slots,
    story: STORY,
  })
  const second = await runPenumbraResearch({
    mode: 'penumbra',
    query: planned.brief,
    sourceContext: formatScopedResearchTools(scoped.sources),
    canonicalSources: scoped.sources,
    tenantKey: 'local-compare:cafe-flat',
    matterSlug: cacheMatterKey(frame),
    exaQueries: planned.queries,
    coverageSlots: planned.slots,
    story: STORY,
  })

  const eye = first.ok ? first.result : null
  const matching = eye
    ? preferFrameMatching(matchingGuidanceFromFrame(frame, eye.bundle.sources), eye.bundle.matching, frame)
    : matchingGuidanceFromFrame(frame, scoped.sources)

  const overview = pack.answerOverview || ''
  const memo = eye?.bundle.answerDraft || ''
  const eyeTitles = (eye?.bundle.sources || []).map((s) => s.title)
  const wikiTitles = pack.wikiPages?.map((w) => w.title) || evidence.hits.map((h) => h.title)

  const compare = {
    storyHasForcedExitUpdate: /son in law showed up|had no choice but to comply/i.test(STORY),
    library: {
      writer: meta.used,
      matterType: session.matterType,
      overview,
      nextSteps: pack.recommendations,
      options: pack.options?.map((o) => o.title),
      wiki: wikiTitles,
      alreadyOut: /already been made to leave|forced out/i.test(overview),
      occupying: /still in occupation|missing door/i.test(overview),
      tonight: /tonight|homeless/i.test(overview),
      lockout: /illegal evict|lock-?out|door/i.test(overview),
      wages: /wage|holiday pay|acas/i.test(overview),
      discrimination: /equality act|discrimination at work/i.test(overview),
    },
    matchingHelp: {
      matterType: helpSession.matterType,
      topicId: helpSession.topicId,
      freeHelp: help.freeServices.slice(0, 6).map((s) => s.title),
      wiki: help.phase2Wiki.slice(0, 6).map((w) => w.title),
      afterThirdEyeLens: matching,
    },
    thirdEye: {
      enabled: thirdEyeEnabled,
      liveExaConfigured: liveExa,
      ok: first.ok,
      error: first.ok ? null : first.diagnostic.reason,
      firstCacheHit: eye?.cacheHit === true,
      secondCacheHit: second.ok ? second.result.cacheHit === true : null,
      exaSource: eye?.exaSource,
      sourceCount: eye?.bundle.sources.length || 0,
      claimCount: eye?.bundle.claims.length || 0,
      sources: (eye?.bundle.sources || []).slice(0, 12).map((s) => ({
        title: s.title,
        origin: s.origin,
        tier: s.tier,
        url: s.url,
      })),
      allExternal: (eye?.bundle.sources || [])
        .filter((s) => s.origin === 'external' && s.url)
        .map((s) => ({ title: s.title, url: s.url, tier: s.tier })),
      claims: (eye?.bundle.claims || []).slice(0, 6).map((c) => c.claim.slice(0, 220)),
      memo: memo.slice(0, 1800),
      mentionsIllegalEviction: /illegal evict|protection from eviction|lock/i.test(`${memo} ${eyeTitles.join(' ')}`),
      mentionsHomelessness: /homeless|shelter|emergency accommodation/i.test(`${memo} ${eyeTitles.join(' ')}`),
      mentionsWages: /wage|holiday pay|acas/i.test(`${memo} ${eyeTitles.join(' ')}`),
      mentionsDiscrimination: /equality act|discrimination/i.test(`${memo} ${eyeTitles.join(' ')}`),
    },
    vs: {
      libraryLeadsWithCase: /The matter/i.test(overview),
      thirdEyeIsExploratory: /exploratory|Third Eye|unverified/i.test(memo),
      thirdEyeAddsUrlsLibraryDoesNot:
        (eye?.bundle.sources || []).filter((s) => s.origin === 'external' && s.url && !s.url.includes('legalshaman.com'))
          .length,
    },
  }
  console.log(JSON.stringify(compare, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
