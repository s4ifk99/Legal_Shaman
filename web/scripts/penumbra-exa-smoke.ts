import { runScopedResearchTools, formatScopedResearchTools } from '../lib/aramb/tools'
import { runPenumbraResearch } from '../lib/penumbra/researcher'

async function main() {
  const scoped = runScopedResearchTools(
    [
      {
        id: 'Areas/Employment/Employment rights and responsibilities',
        title: 'Employment rights',
        summary: 'UK employment basics',
      },
    ],
    [
      {
        title: 'Taking action about discrimination at work',
        url: 'https://www.citizensadvice.org.uk/work/discrimination-at-work/',
        snippet: 'You may be able to make a claim to an employment tribunal.',
      },
    ],
  )

  const outcome = await runPenumbraResearch({
    mode: 'penumbra',
    query:
      'What to prepare for employment tribunal preliminary hearing unfair dismissal England Wales?',
    sourceContext: formatScopedResearchTools(scoped.sources),
    canonicalSources: scoped.sources,
    tenantKey: 'smoke-test:exa-001',
  })

  console.log('ok', outcome.ok)
  if (outcome.ok) {
    console.log('latencyMs', outcome.result.latencyMs)
    console.log('sources', outcome.result.bundle.sources.length)
    console.log('external', outcome.result.bundle.sources.filter((s) => s.origin === 'external').length)
    console.log('questions', outcome.result.bundle.questions.length)
    console.log('claims', outcome.result.bundle.claims.length)
    console.log('status', outcome.result.bundle.status)
  } else {
    console.log('reason', outcome.diagnostic.reason)
    console.log('error', outcome.diagnostic.errorMessage)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
