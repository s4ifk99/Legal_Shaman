#!/usr/bin/env tsx
/**
 * Offline Admit compiler eval — hard gates + mocked AI votes.
 * Does not call Exa or OpenRouter.
 *
 *   npm run test:admit-compiler
 */
import { admitHitSync, parseAiCriticJson } from '../lib/graph-ingest/admitCompiler'
import type { AiCriticDecision, CrawlHit } from '../lib/graph-ingest/types'

type Case = {
  id: string
  hit: CrawlHit
  ai?: unknown
  expectStatus: string
  expectVisible?: boolean
}

const cases: Case[] = [
  {
    id: 'govuk-hard-allow',
    hit: {
      url: 'https://www.gov.uk/legal-aid',
      title: 'Legal aid',
      excerpt: 'Check if you can get legal aid in England and Wales.',
    },
    ai: {
      vote: 'allow',
      confidence: 0.9,
      doorKind: 'law_centre',
      looksLikeLegalAdvice: false,
      ukPublicHelp: true,
      reasons: ['GOV.UK'],
    },
    expectStatus: 'admitted',
    expectVisible: true,
  },
  {
    id: 'reddit-hard-deny-beats-ai-allow',
    hit: {
      url: 'https://www.reddit.com/r/legaladviceuk/foo',
      title: 'Shelter housing advice thread',
      excerpt: 'People say call Shelter.',
    },
    ai: {
      vote: 'allow',
      confidence: 0.99,
      doorKind: 'specialist',
      looksLikeLegalAdvice: false,
      ukPublicHelp: true,
      reasons: ['mentions Shelter'],
    },
    expectStatus: 'denied',
    expectVisible: false,
  },
  {
    id: 'http-denied',
    hit: { url: 'http://shelter.org.uk/get-help', title: 'Shelter', excerpt: 'Helpline' },
    expectStatus: 'denied',
    expectVisible: false,
  },
  {
    id: 'advice-shaped-denied',
    hit: {
      url: 'https://example-claims.co.uk/sue',
      title: 'You should sue your landlord today',
      excerpt: 'Guaranteed compensation no win no fee',
    },
    expectStatus: 'denied',
  },
  {
    id: 'govuk-ai-deny-holds-review',
    hit: {
      url: 'https://www.gov.uk/evicting-tenants',
      title: 'Evicting tenants',
      excerpt: 'Guidance for landlords.',
    },
    ai: {
      vote: 'deny',
      confidence: 0.7,
      doorKind: null,
      looksLikeLegalAdvice: false,
      ukPublicHelp: true,
      reasons: ['landlord-facing'],
    },
    expectStatus: 'review',
    expectVisible: false,
  },
  {
    id: 'ai-self-deny-unknown',
    hit: {
      url: 'https://best-uk-lawyers.example/chat',
      title: 'Instant UK lawyer chat',
      excerpt: 'Ask anything.',
    },
    ai: {
      vote: 'deny',
      confidence: 0.95,
      doorKind: null,
      looksLikeLegalAdvice: true,
      ukPublicHelp: false,
      reasons: ['unregulated chat'],
    },
    expectStatus: 'denied',
  },
  {
    id: 'ai-self-allow-org-uk-queue-not-live',
    hit: {
      url: 'https://newtownlawcentre.org.uk/',
      title: 'Newtown Law Centre',
      excerpt: 'Free housing advice clinic. England.',
    },
    ai: {
      vote: 'allow',
      confidence: 0.9,
      doorKind: 'law_centre',
      looksLikeLegalAdvice: false,
      ukPublicHelp: true,
      reasons: ['named law centre'],
    },
    expectStatus: 'self_allowed_queue',
    expectVisible: false,
  },
  {
    id: 'firm-blog-review',
    hit: {
      url: 'https://www.taylor-rose.co.uk/insights/housing',
      title: 'Housing insight',
      excerpt: 'Our solicitors explain possession.',
    },
    ai: {
      vote: 'allow',
      confidence: 0.88,
      doorKind: 'firm',
      looksLikeLegalAdvice: false,
      ukPublicHelp: false,
      reasons: ['firm blog'],
    },
    expectStatus: 'review',
    expectVisible: false,
  },
]

function fail(id: string, detail: string) {
  console.error(`FAIL ${id} — ${detail}`)
  process.exitCode = 1
}

function main() {
  let failed = 0
  for (const c of cases) {
    const ai = c.ai ? parseAiCriticJson(c.ai) : null
    if (c.ai && !ai) {
      fail(c.id, 'could not parse mocked AI JSON')
      failed++
      continue
    }
    const result = admitHitSync(c.hit, ai as AiCriticDecision | null)
    if (result.status !== c.expectStatus) {
      fail(c.id, `status=${result.status} expected ${c.expectStatus} (${result.reasons.join('; ')})`)
      failed++
      continue
    }
    if (c.expectVisible !== undefined && result.clientVisible !== c.expectVisible) {
      fail(c.id, `visible=${result.clientVisible} expected ${c.expectVisible}`)
      failed++
      continue
    }
    console.log(`ok  ${c.id}`)
  }
  if (!failed) {
    console.log(`\n${cases.length} admit-compiler cases passed.`)
  }
}

main()
