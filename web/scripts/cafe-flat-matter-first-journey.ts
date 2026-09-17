/**
 * Local matter-first journey: cafe flat / illegal eviction story.
 * Does not hit production.
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

I really don't know what my next step should be, and I hope maybe someone here can give me some advice. Shelter is not open until Tuesday morning, and my assigned housing officer at the council (who I believe would advocate for me far more forcefully than the emergency team) won't be back at work until then either.

Update:

Thank you all for your replies. My landlords son in law showed up at midday, less than half an hour after I made my post, and insisted I leave immediately. I called the police, as instructed by the council. When the police arrived I showed them the email I got from the council in case this happened - the email says they believe I had a right to stay there, and instructs me not to vacate the premises without a court order and an attending court appointed bailiff. After reading the email, the policeman still insisted it was a civil matter, and told me that they only attended to "prevent a breach of the peace". No one ever said so specifically, but the implication was that I'd be arrested if I refused, so I felt I had no choice but to comply.

I've spoken to the emergency housing people at the council, who have said that if I can't find a friends or families sofa to crash on, I need to ring them back and they'll try to find me somewhere to sleep tonight.

I managed to pack a bag with a few spare clothes, toiletries, my laptop, and my passport. I had no choice but to leave everything else behind.`

async function main() {
  const { createInitialSession, senseDetails } = await import('../lib/coherence/sense')
  const { proposeCoherentFrames } = await import('../lib/coherence/frames')
  const { attachResolvedMatterFrame, sessionMatterGate } = await import('../lib/coherence/applyMatterFrame')
  const { matchingGuidanceFromFrame, preferFrameMatching } = await import('../lib/coherence/issueRouting')
  const { matchingSessionForHelp, buildHelpPack } = await import('../lib/coherence/services')
  process.env.ENABLE_LLM_ANSWER = 'false'
  const { buildOverviewAnswer } = await import('../lib/coherence/overviewAnswer')
  const { KnowledgeRetriever } = await import('../lib/matter/retrieve')

  let session = senseDetails(STORY, {
    ...createInitialSession(),
    searchMode: 'penumbra',
    penumbraAcknowledged: true,
    mode: 'dispute',
  })
  const attached = attachResolvedMatterFrame(session, STORY)
  session = attached.session
  const frame = attached.frame
  const gate = sessionMatterGate(session)
  const frames = proposeCoherentFrames(session, 4)
  const helpSession = matchingSessionForHelp(session)
  const evidence = KnowledgeRetriever.forMatter({
    matterFrame: frame,
    submission: STORY,
    limit: 8,
  })
  const sources = evidence.hits.slice(0, 8).map((h, i) => ({
    id: `curated-${i + 1}`,
    title: h.title,
    url: `https://www.legalshaman.com/wiki/${encodeURIComponent(h.id)}`,
    tier: 'wiki' as const,
    excerpt: `${h.category} · ${h.title}`,
    origin: 'curated' as const,
    verified: true,
  }))
  const curatedMatching = matchingGuidanceFromFrame(frame, sources)
  const hostileResearch = {
    matterType: 'employment' as const,
    topicId: 'discrimination',
    taxonomySlug: 'employment',
    confidence: 'high' as const,
    rationale: 'Discrimination at work is covered by the Equality Act.',
    sourceIds: sources.slice(0, 1).map((s) => s.id),
  }
  const matching = preferFrameMatching(curatedMatching, hostileResearch, frame)
  const bundle = {
    mode: 'penumbra' as const,
    status: 'complete' as const,
    questions: [] as string[],
    sources,
    claims: evidence.hits.slice(0, 4).map((h, i) => ({
      claim: h.title,
      sourceIds: [`curated-${i + 1}`],
      confidence: 'medium' as const,
    })),
    conflicts: [] as string[],
    missingFacts: [] as string[],
    nextActions: [] as string[],
    matching,
    freeResources: [] as [],
  }
  const { answerPackage: pack, meta } = await buildOverviewAnswer({
    latestText: STORY,
    clientQuestion: session.clientQuestion,
    understanding: session.briefUnderstanding,
    matterFrame: frame,
    taxonomySlug: frame.primaryIssues[0]?.slug,
    searchMode: 'penumbra',
    researchBundle: bundle,
  })
  const help = await buildHelpPack(helpSession, frames)
  const overview = pack.answerOverview || ''
  const quality = {
    namesMatter: /illegal evict|lock-?out|forced out|homeless/i.test(overview),
    namesArea: /housing/i.test(overview),
    nextSteps: (pack.recommendations?.length || 0) >= 2,
    shelterOrCouncil: /shelter|homelessness/i.test(overview),
    wagesStrand: /wage|holiday pay|acas/i.test(overview),
    notDiscrimination: !/equality act|workplace discrimination|child arrangements/i.test(overview),
    legalShamanNote: /legalshaman\.com/i.test(overview),
    usedCaseWriter: String(meta.used || '') === 'case-led-deterministic',
    noTaxWiki: !evidence.hits.some((h) => /capital gains|gifting property|unused pension/i.test(h.title)),
  }
  const qualityScore = Object.values(quality).filter(Boolean).length

  const report = {
    engine: 'local-case-builder',
    overviewMeta: meta.used,
    quality,
    qualityScore,
    gate: gate.status,
    blocking: gate.blockingAmbiguities,
    role: session.confirmedUserRole,
    matterType: session.matterType,
    helpMatterType: helpSession.matterType,
    helpTopicId: helpSession.topicId,
    taxonomySlug: session.taxonomySlug,
    primary: frame.primaryIssues,
    secondary: frame.secondaryIssues,
    exclusions: frame.exclusions,
    capacities: frame.capacities.map((c) => `${c.partyId}:${c.capacity}`),
    relationships: frame.relationships.map((r) => r.type),
    events: frame.events.map((e) => `${e.type}: ${e.description}`),
    localFrames: frames.map((f) => `${f.id} ${f.label} (${f.fit})`),
    matchingAfterHostileExa: matching,
    overview: pack.answerOverview,
    options: pack.options,
    uncovered: pack.recommendations?.slice(0, 6),
    retrieveHits: evidence.hits.map((h) => h.title),
    retrieveIntents: evidence.intents?.slice(0, 8),
    freeHelp: help.freeServices.slice(0, 8).map((s) => s.title),
    wiki: help.phase2Wiki.slice(0, 6).map((w) => w.title),
    howCaused: session.howCaused,
    goal: session.goal.slice(0, 160),
    clientQuestion: session.clientQuestion?.slice(0, 400),
  }
  console.log(JSON.stringify(report, null, 2))
  if (qualityScore < 9) {
    throw new Error(`cafe case recommendation quality ${qualityScore}/9`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
