# UK legal knowledge search (Exa-style)

Semantic legal search over curated UK legal-help content, with hybrid retrieval (keyword + pgvector), reranking, confidence scoring, and directory integration.

## Architecture

| Layer | Module | Purpose |
|-------|--------|---------|
| Ingestion | `lib/ingestion/wiki-import.ts` | Import Obsidian/wiki markdown |
| Chunking | `lib/legal-knowledge/chunker.ts` | 500–1000 token chunks, heading-aware |
| Embeddings | `lib/legal-knowledge/embed-chunks.ts` | OpenAI-compatible embeddings → pgvector |
| Retrieval | `lib/legal-knowledge/retrieval.ts` | Hybrid lexical + vector + authority + freshness |
| Rerank | `lib/legal-knowledge/rerank.ts` | Heuristic rerank (official UK sources preferred) |
| Confidence | `lib/legal-knowledge/confidence.ts` | Score + clarifying question when low |
| API | `POST /api/legal-search` | Unified response with sources + directory |
| Crawler | `lib/ingestion/crawler.ts` | Placeholder for GOV.UK / Citizens Advice (future) |

Existing `/api/search` directory search is **unchanged**.

## Database

Migration: `prisma/migrations/20260628120000_legal_knowledge/migration.sql`

Tables: `legal_sources`, `legal_documents`, `legal_chunks`, `ingestion_runs`

Apply locally:

```bash
cd web
npm run db:migrate:dev
npx prisma generate
```

## Environment

Add to `web/.env.local`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/legal_shaman
LLM_API_KEY=sk-or-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_EMBED_MODEL=text-embedding-3-small
LLM_EMBED_DIM=1536
```

Optional dedicated embedding endpoint:

```env
EMBEDDING_API_KEY=
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
```

Wiki source path: `config/wiki-source.json` → `wikiPagesDir`.

## Ingest wiki content

```bash
cd web
npm run ingest:legal-knowledge
```

Flags:

- `--skip-embeddings` — chunk only, no API calls
- `--limit=50` — import first N markdown files (testing)

Re-run is safe: documents upsert by `source_url`, chunks are replaced per document.

## Test search

### UI

Open **http://localhost:3000/legal-search** — Exa-style criteria panel updates as you type; full search returns cited sources and directory results.

### API

```bash
curl -s http://localhost:3000/api/legal-search \
  -H 'Content-Type: application/json' \
  -d '{"query":"my landlord won'\''t return my deposit","includeDirectory":true}' | jq
```

### Eval harness

```bash
npm run legal-search:eval
npm run legal-search:eval -- --query="I was dismissed while pregnant"
```

Eval cases cover: unfair dismissal, housing disrepair, deposit, domestic abuse, immigration, debt, small claims, prison law, child contact, pregnancy discrimination.

## Response shape

Response shape includes `searchCriteria` — colored blocks showing how the query was interpreted (legal issue, situation, jurisdiction, help route, sources).

```json
{
  "answerType": "legal_information",
  "confidence": 0.62,
  "searchCriteria": [
    { "id": "c-1", "kind": "situation", "label": "Your situation", "text": "..." }
  ],
  "issueClassification": { "area": "Housing", "subArea": "housing", "urgency": "low" },
  "sources": [{ "title": "...", "url": "...", "source": "...", "snippet": "...", "score": 0.71 }],
  "directoryResults": [],
  "suggestedNextSteps": [],
  "clarifyingQuestion": null,
  "answer": "...",
  "disclaimer": "Signposting and legal information only — not legal advice..."
}
```

## Next steps (not in MVP)

1. Per-domain crawlers with robots.txt (`lib/ingestion/crawler.ts`)
2. Cross-encoder reranker via existing `ENABLE_OPEN_RERANKER`
3. External fallback search when confidence is low
4. GOV.UK / Citizens Advice bulk import jobs in CI
