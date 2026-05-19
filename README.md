# Legal Shaman (UK Legal Services Directory)

Monorepo: a **static** Craigslist-style directory at the repo root, plus a **Next.js** app under `web/` — a **full UK legal services directory** by practice area, with **GOV.UK legal-aid provider rows as one merged data source** (filterable in search), optional **SRA / Meilisearch** national firms, curated category listings, and AI search.

The Next.js app also ships an **agentic lawyer matcher** at `/find-a-lawyer` — Postgres + pgvector, OpenAI-compatible LLM, hybrid search, ranking, and guardrails. See ["Lawyer Matcher (MVP)"](#lawyer-matcher-mvp) below.

## Run locally

### Static directory

Open `index.html` in your browser (scripts live in `static-site/`).

### Next.js app (`web/`)

```bash
cd web
npm install
npm run dev
```

Then open the URL shown in the terminal (usually `http://localhost:3000`).

**Windows PowerShell — “running scripts is disabled” / `npm.ps1` error:** Node installs `npm.ps1`, which PowerShell may block. Use one of: **`npm.cmd run sra:probe`** (and other scripts) instead of `npm run …`; or open **Command Prompt** (`cmd.exe`) instead of PowerShell; or allow local scripts for your user: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` (review your org’s IT policy first).

**Deploying the Next.js app** (e.g. Vercel): in the project **Settings → General → Root Directory**, set **`web`** (the folder that contains `package.json` and `next.config.mjs`). Leave the default install/build commands. If Root Directory stays at the repository root, the build may succeed but the deployment often returns **404** on every route because the serverless bundle is looked up in the wrong place. Do not rely on a root `vercel.json` that only runs `npm run build --prefix web` without this setting.

**Semantic search (optional):** set `HF_TOKEN` (Hugging Face Inference API) in the deployment environment. Precomputed vectors live in `web/data/listings-embeddings.bin` + `listings-embeddings-meta.json` (model id and dimensions are in the meta file). Regenerate locally with `cd web && npm run embed:dump` then `python web/scripts/embed-listings.py` (requires `sentence-transformers`), or run the **Build listing embeddings** workflow. When the **monthly legal aid ingest** updates `legal-aid-listings.json`, the same workflow also regenerates embeddings if that JSON changed (so vectors stay aligned with listings).

**Search health:** with the app running, open `GET /api/search/status` (e.g. `http://localhost:3000/api/search/status`) for embeddings, Typesense reachability, `legal_entities` document count, feature flags, and degraded-mode warnings (no secrets returned).

**Typesense unified search (recommended for `/search`):**

1. Start Typesense (example):  
   `docker run -d --name signpost-typesense -p 8108:8108 -v signpost-typesense-data:/data typesense/typesense:27.1 --data-dir /data --api-key=xyz --enable-cors`
2. In `web/.env.local`, set `TYPESENSE_HOST`, `TYPESENSE_API_KEY`, `TYPESENSE_PROTOCOL=http`, `TYPESENSE_PORT=8108`, and enable:
   - `ENABLE_TYPESENSE=true`
   - `ENABLE_TYPESENSE_UNIFIED=true`
3. Build the unified index: `cd web && npm run search:index` (adds taxonomy projection fields; use `ENABLE_GEOCODING=false` for a faster first pass).
4. Verify: `npm run search:index:verify` and `npm run search:smoke`.
5. Restart `npm run dev`. Directory search uses `legal_entities`; if Typesense is down, the app **degrades to legacy** hybrid search without crashing.

**Vague-query rescue:** broad taxonomy queries (e.g. `i need a prison lawyer`) use multi-query Typesense retrieval, related-area fallback, and a refinement prompt instead of forcing clarification. Debug with `ENABLE_SEARCH_DEBUG=true` (on in development) — see fallback flags in the debug panel on `/search`.

**SRA + Meilisearch (optional, national directory):** the app does **not** store the full SRA register in Git. You **fetch** it from the API and **index** it in Meilisearch; search then merges those hits with **curated and legal-aid** listings (single search experience, not a legal-aid-only product).

**SRA + MySQL (system of record):** [`web/prisma/schema.prisma`](web/prisma/schema.prisma) defines table **`sra_organisations`**. When **`DATABASE_URL`** is set, **`npm run sra:sync`** upserts each batch to **MySQL first**, then to Meilisearch (if MySQL fails, that batch is not sent to Meili). Without `DATABASE_URL`, sync behaves as Meilisearch-only. Apply schema with `cd web && npm run db:migrate` (loads `.env` / `.env.local`; or `npm run db:migrate:dev` locally). Prisma client is generated on **`npm install`** / **`npm run build`**.

1. Subscribe at the [SRA API developer portal](https://sra-prod-apim.developer.azure-api.net) and copy your subscription key.
2. Run Meilisearch locally (example):  
   `docker run -d --name meili -p 7700:7700 -e MEILI_MASTER_KEY=dev_master_key getmeili/meilisearch:v1.11`
3. (Optional) Run MySQL and set **`DATABASE_URL`** in `.env.local` (see [`web/.env.example`](web/.env.example)); run **`cd web && npm run db:migrate`** once.
4. In `web/`, copy [`web/.env.example`](web/.env.example) to `.env.local` and set `SRA_APIM_SUBSCRIPTION_KEY`, `MEILISEARCH_HOST` (e.g. `http://127.0.0.1:7700`), and `MEILISEARCH_API_KEY` (use `dev_master_key` to match step 2).
5. From `web/`, run **`npm run sra:probe`** once to confirm the SRA subscription key returns **HTTP 200** (see [`docs/sra-api-fields.md`](docs/sra-api-fields.md) if you get 401/403).
6. Run **`npm run sra:sync`** — calls `GetAll`, normalises rows, upserts **MySQL** (if configured) then Meilisearch index **`sra_organisations`**.
7. Start the app with **`npm run dev`**; open `/search` and `/api/search/status` (expect `meilisearchConfigured` / `meilisearchReachable` true).

For production, use a **search-only** Meilisearch API key in the Next.js environment; keep `SRA_APIM_SUBSCRIPTION_KEY` only on the machine or CI that runs sync. Scheduled sync: [`.github/workflows/sra-meilisearch-sync.yml`](.github/workflows/sra-meilisearch-sync.yml) (secrets: `SRA_APIM_SUBSCRIPTION_KEY`, `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY`; optional **`DATABASE_URL`** for dual-write). Field notes: [`docs/sra-api-fields.md`](docs/sra-api-fields.md).

**Search regression checks:** `cd web && npm run test:search-golden` runs fuzzy-search expectations in [`web/data/search-golden.json`](web/data/search-golden.json).

**Unified legal search (`web/lib/legal-search/`):** directory GET uses **`ENABLE_TYPESENSE_UNIFIED`** (Typesense `legal_entities` + taxonomy projection + vague-query rescue) when Typesense is healthy; otherwise legacy hybrid (Fuse/Typesense listings + optional Meilisearch SRA). Matcher POST uses Postgres pgvector hybrid **plus** Typesense recall when unified is on. Flags: **`ENABLE_LLM_SEARCH`**, **`ENABLE_VECTOR_SEARCH`**, **`ENABLE_MEILISEARCH`**, **`ENABLE_TYPESENSE`**, **`ENABLE_SEARCH_DEBUG`**. CLI checks: `npm run search:eval` (deterministic), `npm run search:smoke` (live Typesense), `npm run search:index:verify` (index integrity).

**Admin tools** (`/admin/search-quality`, `/admin/failed-searches`, `/admin/ranking-analysis`, `/admin/provider-enrichment`, and `/api/admin/search-quality`, `/api/admin/provider-enrichment`): these surfaces can include search-quality and enrichment data. Configure **`ADMIN_SECRET`** in the deployment environment (see [`web/.env.example`](web/.env.example)). **Do not ship production without `ADMIN_SECRET`:** when `NODE_ENV=production` and it is unset, admin pages and admin APIs respond with **503** and do not serve that data publicly. In **local development**, leaving `ADMIN_SECRET` unset keeps admin routes reachable for convenience, but the admin layout shows a **warning** so this mode is obvious. After setting `ADMIN_SECRET` in `.env.local`, restart `npm run dev`, open **`/admin/login`**, submit the same value as the password to obtain an **httpOnly** session cookie for browser use. For scripts and HTTP clients, send **`x-admin-secret: <ADMIN_SECRET>`** on admin API requests (the cookie is also accepted). Deterministic checks for this gate run inside **`npm run search:eval`**.

**Troubleshooting zero results on broad queries:** confirm Typesense is reachable (`/api/search/status`), re-run `npm run search:index`, check `npm run search:index:verify` for `practiceAreaSlugs` / `taxonomyAliases`, and inspect debug fields `fallbackTriggered`, `initialHitCount`, and `degradedModeWarnings` on `/search?q=...` (with debug enabled).

**Known limitations:** hosted chat providers (e.g. Groq) often lack a matching embedding API — keep **`EMBEDDING_*`** pointed at an OpenAI-compatible embed endpoint or use a second provider; listing lat/lng is sparse so distance scoring is mostly text/postcode; `SearchInteraction.rawQuery` storage should be reviewed for PII (see TODO in code).

**Signposting hub:** national links are edited in [`web/data/signposting-resources.json`](web/data/signposting-resources.json); [`web/data/signposting-advocate.json`](web/data/signposting-advocate.json) is a stub for a future Advocate/bar feed. The `/signposting` page explains the **full-directory** model (curated + legal aid + optional SRA), shows live counts from the merged index, and links into `/search` and category pages.

## CSV export

The same directory is available as **`data/services.csv`** (columns: title, category, summary, areas_of_law, tags, coverage, phone, email, hours, cta, website, affiliate, sponsored, priority).

Regenerate locally with:

```bash
node scripts/json-to-csv.js
```

CSV sync is also automated in GitHub Actions via `.github/workflows/sync-services-csv.yml`.
On pushes to `main` (or PRs) that touch `data/services.json` or `scripts/json-to-csv.js`,
the workflow regenerates `data/services.csv`; on `main` pushes, it auto-commits updated CSV output.

## Monthly GOV.UK legal aid provider ingest

This project now includes a monthly ingest pipeline for the Legal Aid Agency provider directory from GOV.UK:

- Source page: `https://www.gov.uk/government/publications/directory-of-legal-aid-providers`
- Script: `scripts/update-legal-aid-providers.py`
- Workflow: `.github/workflows/monthly-legal-aid-ingest.yml`

### Outputs

- `data/legal_aid_providers_latest.csv` (normalized provider rows from all workbook sheets)
- `data/legal_aid_providers_meta.json` (source URL, pull timestamp, sheet/row stats)

### Schedule

Runs automatically on the 2nd day of every month at 06:00 UTC, and can be run manually from the GitHub Actions tab (`workflow_dispatch`).

The same workflow also regenerates **`web/data/legal-aid-listings.json`** (and meta) for the Next.js app via `web/scripts/update-legal-aid-listings-adl.py`, and refreshes **`web/data/listings-embeddings.bin`** when the legal-aid JSON changes (keeps semantic search in sync).

## Edit listings

Update `data/services.json`.

Each listing supports:
- `title`: service name
- `category`: must match a category in the file
- `summary`: one-line description
- `tags`: array of short labels
- `cta`: button text (e.g., "Visit", "Get help", "Check eligibility")
- `url`: destination URL
- `affiliate`: set `true` if it’s an affiliate/partner link
- `priority`: higher shows first within a category

## Affiliate tracking

Affiliate buttons automatically append URL parameters (UTM) in `static-site/config.js`.
Edit:
- `UTM_SOURCE`
- `UTM_MEDIUM`
- `UTM_CAMPAIGN`

If a URL already contains `utm_*`, the script will keep the existing values.

## Lawyer Matcher (MVP)

Agentic, semantic search over an individual-lawyer directory. Lives in parallel with the existing org directory — different routes, different tables, same Next.js app.

**Stack:** Postgres + pgvector · Prisma 5 · OpenAI-compatible LLM (chat + embeddings) · hand-rolled TypeScript agent workflow · hybrid retrieval (SQL filters + ANN + ILIKE) · weighted ranking · guardrail validator.

**Architecture overview:** user query → LLM filter extraction → (clarifying question if vague | embed semantic query) → hybrid candidate retrieval → weighted rank → per-result explanation → guardrail post-check → top 5 + disclaimer.

### Quick start

1. Spin up Postgres with pgvector:
   ```bash
   docker run -d --name pg-legal \
     -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=legal_shaman \
     -p 5432:5432 \
     pgvector/pgvector:pg16
   ```
2. Configure env:
   ```bash
   cd web
   cp .env.example .env.local
   ```
   Fill in `DATABASE_URL` (default works with the docker command above), `LLM_API_KEY` (OpenAI key or compatible), and `ADMIN_TOKEN` (any random string).
3. Apply migrations (creates the `vector` and `pg_trgm` extensions plus all tables):
   ```bash
   npm run db:migrate:dev
   ```
4. Seed 24 sample lawyers across the 6 practice areas, and (if `LLM_API_KEY` is set) generate embeddings:
   ```bash
   npm run db:seed
   ```
5. Start the dev server:
   ```bash
   npm run dev
   ```
6. Open `http://localhost:3000/find-a-lawyer` and try:
   - *I was unfairly dismissed in London*
   - *Need an immigration lawyer who speaks Urdu*
   - *Divorce solicitor near Manchester with fixed-fee consultation*

### API surface

- `POST /api/search` — body `{ query, sessionId?, appliedFilters? }` → either `{ kind: "clarify", question, disclaimer }` or `{ kind: "matches", results, disclaimer, extracted, parsedQuery? }` (structured parse for transparency).
- `POST /api/search/clarify` — body `{ originalQuery, clarification, sessionId?, appliedFilters? }` → same response shapes.
- `GET /api/lawyers/:id` — full profile for the detail page.
- `POST /api/lawyers/embed` — admin-only (`Authorization: Bearer $ADMIN_TOKEN`), body `{ ids?: string[]; all?: boolean }`. Regenerates embeddings; called automatically by the seed script.

The legacy `GET /api/search?q=…` endpoint for the org directory is preserved on the same route file. With **`ENABLE_UNIFIED_DIRECTORY=true`**, the handler may merge SRA Meilisearch hits and attach ranking metadata while keeping the legacy row shape for existing clients.

### Switching LLM provider

The OpenAI SDK is used as a transport — any compatible backend works by changing env only.

**Aliases:** `LLM_MODEL` overrides the chat model when set (same role as `LLM_CHAT_MODEL`). Optional **`EMBEDDING_BASE_URL`**, **`EMBEDDING_API_KEY`**, **`EMBEDDING_MODEL`** use a dedicated OpenAI-compatible client for embeddings; if `EMBEDDING_API_KEY` is unset, embeddings fall back to `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_EMBED_MODEL`. Groq example chat URL: `https://api.groq.com/openai/v1` with e.g. `LLM_MODEL=meta-llama/llama-3.1-8b-instant` — you still need a separate embed-capable endpoint for pgvector unless you use a provider that exposes both.

| Provider | LLM_BASE_URL | LLM_CHAT_MODEL | LLM_EMBED_MODEL | LLM_EMBED_DIM |
|---|---|---|---|---|
| OpenAI (default) | `https://api.openai.com/v1` | `gpt-4o-mini` | `text-embedding-3-small` | `1536` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1:8b` | `nomic-embed-text` | `768` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4o-mini` | `text-embedding-3-small` | `1536` |
| Together AI | `https://api.together.xyz/v1` | `meta-llama/Llama-3.1-8B-Instruct-Turbo` | `togethercomputer/m2-bert-80M-8k-retrieval` | `768` |

> **Embedding-dimension gotcha:** the `lawyers.embedding` column is declared `vector(1536)` in [`web/prisma/migrations/.../migration.sql`](web/prisma/migrations). Changing `LLM_EMBED_DIM` to a different value (e.g. 768 for `nomic-embed-text`) requires editing that migration (or adding a new one that does `ALTER TABLE lawyers ALTER COLUMN embedding TYPE vector(768);` plus rebuilding the HNSW index) and re-running `npm run db:migrate:dev`. Then re-embed: `curl -X POST http://localhost:3000/api/lawyers/embed -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"all":true}'`.

### Code layout

- `web/prisma/schema.prisma` — `Lawyer`, `Firm` (with `sraId` + `sraProfileUrl`), `PracticeArea`, `Location`, `Language`, `Credential`, `Review`, `Availability`, `SearchInteraction`, and `SraOrganisation` (with `embedding vector(1536)`).
- `web/lib/legal-search/` — unified directory + matcher helpers (`runDirectorySearch`, `runMatcherUnified`, adapters, ranking, explanations).
- `web/lib/llm/client.ts` — OpenAI-compatible chat + embeddings (optional `LLM_MODEL` / `EMBEDDING_*` aliases).
- `web/lib/agent/` — `types.ts`, `extractor.ts`, `clarifier.ts`, `explainer.ts` (separate lawyer + org prompts), `workflow.ts` (orchestrator).
- `web/lib/lawyers/` — `db.ts` (Prisma include + lookup), `search.ts` (hybrid retrieval over lawyers **and** SRA orgs), `rank.ts` (weighted scoring, org penalty), `embed.ts` (vector generation).
- `web/lib/sra/` — `embed.ts` (SRA-org vector generation), `link-firms.ts` (firm <-> SRA name matcher).
- `web/lib/sra-mysql-sync.ts` — `upsertSraDocumentsMysql` + `upsertFirmsFromSra` (Postgres upsert helpers; file retains its legacy name).
- `web/lib/guardrails/validator.ts` — advice/outcome filter and fact-grounding check (separate token sets for lawyers and orgs).
- `web/app/api/` — `search/route.ts` (POST + GET), `search/clarify/route.ts`, `lawyers/[id]/route.ts`, `lawyers/embed/route.ts`.
- `web/app/find-a-lawyer/` + `web/app/lawyers/[id]/` — UI pages.
- `web/components/` — `lawyer-result-card.tsx`, `org-result-card.tsx`, `lawyer-filters-sidebar.tsx`, `clarify-prompt.tsx`, `disclaimer-banner.tsx`.
- `web/scripts/` — `sync-sra-meili.ts` (`sra:sync` — pull + upsert + Meilisearch + embed + link), `embed-sra-orgs.ts` (`sra:embed` backfill), `link-firms-to-sra.ts` (`sra:link-firms` re-run).

### SRA register integration

The matcher mixes curated `Lawyer` cards with SRA-registered firms (organisations from the SRA Data Share register). Two integration points:

1. **SRA orgs as matchable candidates.** Every org in `sra_organisations` carries a `vector(1536)` embedding and trigram indexes on `business_name` + `search_text`. The hybrid search adds a 4th retrieval source (pgvector ANN + ILIKE on those columns), the ranker applies a small `orgPenalty = 0.05` so a curated lawyer with equal evidence ranks above a firm card, and the result UI renders an `OrgResultCard` that links out to the official SRA consumer profile.
2. **Firm-level verification.** Every `Firm` row gets an `sraId` + `sraProfileUrl` either directly during `sra:sync` (when the firm was inserted from SRA data) or via the `sra:link-firms` name-normalising matcher (lowercased, legal suffixes like LLP/Ltd/Solicitors stripped). When a curated lawyer's firm is linked, the lawyer card shows a "Firm SRA-verified" badge and the firm name links to its SRA profile.

#### One-time setup

1. **Get an SRA APIM key** at [https://sra-prod-apim.developer.azure-api.net](https://sra-prod-apim.developer.azure-api.net) and subscribe to the Data Share product.
2. **Run Meilisearch** (required — also drives the legacy `/search` page):
   ```bash
   docker run -d --name meili -p 7700:7700 \
     -e MEILI_MASTER_KEY=dev_master_key getmeili/meilisearch:v1.11
   ```
3. **Set env in `web/.env.local`:**
   ```env
   SRA_APIM_SUBSCRIPTION_KEY=...
   MEILISEARCH_HOST=http://127.0.0.1:7700
   MEILISEARCH_API_KEY=dev_master_key
   ```
4. **Apply the SRA migration** (adds `firms.sra_id`, `sra_organisations.embedding`, HNSW + trigram indexes):
   ```bash
   cd web && npm run db:migrate:dev
   ```
5. **Confirm the APIM key:**
   ```bash
   npm run sra:probe
   ```
6. **Run the full sync** (idempotent; can be re-run):
   ```bash
   npm run sra:sync
   ```
   Per batch this script will: upsert into `sra_organisations`, upsert one `firms` row per org keyed on `sraId`, index Meilisearch, then (if `LLM_API_KEY` is set) embed each row. Pass `--skip-embeddings` if you want a fast pull without embeddings. After the loop, it runs `linkFirmsToSra()` over any remaining seeded firms.
7. **(Optional) re-run individual stages later:**
   ```bash
   npm run sra:embed         # backfill embeddings only (missing rows by default; --all forces full re-embed)
   npm run sra:link-firms    # re-run firm <-> SRA name matching after editing names
   ```

Search `/find-a-lawyer` for e.g. *"commercial solicitors in London"* — results now mix curated lawyer cards with SRA-verified firm cards (links to the SRA register).

### Guardrails

The validator is the trust boundary. Every LLM-produced user-facing string passes through `sanitizeAdviceText` (regex-strips "you should", "guaranteed", outcome percentages, currency-amount predictions, "best lawyer" claims) before reaching the response. Per-match explanations also pass through `validateExplanation`, which falls back to a deterministic template if the LLM introduces a proper-noun not present in the lawyer record. The system prompt for every agent step explicitly forbids advice, outcome prediction, and invented credentials, and every successful response includes the disclaimer:

> This is not legal advice. These matches are based on your search criteria.

This is a matching tool, not a legal-advice chatbot.

