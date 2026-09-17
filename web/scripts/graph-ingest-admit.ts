#!/usr/bin/env tsx
/**
 * Batch Admit: stdin or file of {url,title,excerpt}[] → Admit results.
 *   npx tsx scripts/graph-ingest-admit.ts hits.json
 *   npx tsx scripts/graph-ingest-admit.ts hits.json --ai
 *
 * --ai calls OpenRouter. Hard deny still wins. self_allowed_queue is not live matching.
 */
import { readFileSync } from 'node:fs'
import { admitBatch, type CrawlHit } from '../lib/graph-ingest/admitCompiler'

async function main() {
  const file = process.argv[2]
  if (!file || file.startsWith('--')) {
    console.error('Usage: tsx scripts/graph-ingest-admit.ts hits.json [--ai]')
    process.exit(1)
  }
  const useAi = process.argv.includes('--ai')
  const hits = JSON.parse(readFileSync(file, 'utf8')) as CrawlHit[]
  const results = await admitBatch(hits, { useAi })
  console.log(JSON.stringify(results, null, 2))
  const counts = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )
  console.error(JSON.stringify({ useAi, counts }))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
