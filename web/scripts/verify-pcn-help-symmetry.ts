/**
 * Verify orchestrator + Matching help treat a PCN story as parking_pcn / Motoring,
 * not employment.
 */
import { resolveSraSearchFlags } from '../lib/coherence/sraQuery'
import { critiqueHelpMatch } from '../../R&D/coherence-v1-/scripts/lib/critic.mjs'
import { resolveSearchFlags } from '../../R&D/coherence-v1-/scripts/lib/sra-live-search.mjs'
import { runClassifyAgent } from '../../R&D/coherence-v1-/scripts/lib/agents.mjs'

const STORY = `
Someone at my work in Hounslow got two PCNs on a permit road.
The employer said use London Tribunals. Restricted hours. Council rejected the appeal.
`

const flagsTs = resolveSraSearchFlags({
  matterType: 'employment',
  query: STORY,
  taxonomySlug: null,
  wantEmployment: true,
})

const flagsMjs = resolveSearchFlags({
  matterType: 'employment',
  query: STORY,
  taxonomySlug: null,
  wantEmployment: true,
})

const classify = runClassifyAgent({
  brief: { matterType: 'employment', topicId: 'employment-rights' },
  latestText: STORY,
  taxonomy: { taxonomySlug: 'employment', matterType: 'employment', topicId: 'employment-rights' },
})

const badMatch = critiqueHelpMatch({
  helpMatch: {
    policy: 'free-first',
    topicId: 'employment-rights',
    matterType: 'employment',
    taxonomySlug: 'employment',
    freeHelp: [{ title: 'ACAS', url: 'https://www.acas.org.uk' }],
    solicitors: [{ title: 'HR Law LLP', blurb: 'Listed for Employment work on the SRA register' }],
    ranked: [
      { group: 'freeHelp', tier: 'free', title: 'ACAS' },
      { group: 'solicitors', tier: 'solicitor', title: 'HR Law LLP' },
    ],
  },
  topicId: 'consumer-parking',
  taxonomySlug: 'parking_pcn',
})

const goodMatch = critiqueHelpMatch({
  helpMatch: {
    policy: 'free-first',
    topicId: 'consumer-parking',
    matterType: 'consumer',
    taxonomySlug: 'parking_pcn',
    freeHelp: [{ title: 'Citizens Advice — parking tickets', url: 'https://www.citizensadvice.org.uk/consumer/parking-tickets/' }],
    solicitors: [
      {
        title: 'RTA Motoring Solicitors',
        blurb: 'Listed for Motoring / RTA work — confirm they take council PCN appeals',
      },
    ],
    ranked: [
      { group: 'freeHelp', tier: 'free', title: 'CAB parking' },
      { group: 'solicitors', tier: 'solicitor', title: 'RTA Motoring Solicitors' },
    ],
  },
  topicId: 'consumer-parking',
  taxonomySlug: 'parking_pcn',
})

const checks = [
  ['ts wantConsumer', flagsTs.wantConsumer === true],
  ['ts wantMotoring', flagsTs.wantMotoring === false],
  ['ts wantEmployment', flagsTs.wantEmployment === false],
  ['ts slug', flagsTs.taxonomySlug === 'parking_pcn'],
  ['mjs wantMotoring', flagsMjs.wantMotoring === true], // legacy mjs may still flag motoring
  ['mjs wantEmployment', flagsMjs.wantEmployment === false],
  ['classify slug', classify.taxonomySlug === 'parking_pcn'],
  ['classify topic', classify.topicId === 'consumer-parking'],
  ['classify not employment', classify.matterType !== 'employment'],
  ['critic rejects employment cards', badMatch.ok === false],
  ['critic accepts motoring cards', goodMatch.ok === true],
]

const failed = checks.filter(([, ok]) => !ok)
console.log(JSON.stringify({ flagsTs, flagsMjs, classify, bad: badMatch.errors, good: goodMatch.errors, checks }, null, 2))
if (failed.length) {
  console.error('FAIL', failed.map(([name]) => name))
  process.exit(1)
}
console.log('PASS pcn help symmetry')
