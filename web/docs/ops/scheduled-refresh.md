# Scheduled refresh & operations jobs

Legal Shaman keeps search, SRA data, provider enrichment, and admin diagnostics fresh via CLI jobs and optional cron (Vercel or GitHub Actions).

## CLI commands

Run from `Signpost/web/`:

| Command | Purpose |
|---------|---------|
| `npm run prod:health` | DB + Typesense + required env checks |
| `npm run jobs:daily` | Lightweight daily refresh (bounded) |
| `npm run jobs:weekly` | SRA sync + full index + verify + eval |
| `npm run jobs:refresh-approved` | Process queued incremental index jobs |
| `npm run index:provider -- --id=sra:123 --source=sra` | Re-index one provider in Typesense |

### Local development

Local Postgres/Typesense require explicit opt-in:

```bash
npm run jobs:daily -- --allow-local --yes
npm run jobs:weekly -- --allow-local --yes
```

### Production

Production runs require `--yes` (or `OPS_JOBS_YES=1`) and configured secrets:

- `DATABASE_URL`
- `TYPESENSE_HOST` / `TYPESENSE_API_KEY`
- `ADMIN_SECRET`
- `SEARCH_EVENT_SALT`
- `SRA_APIM_SUBSCRIPTION_KEY` (daily SRA sync + weekly)

## Daily job (`jobs:daily`)

1. `prod:health`
2. `providers:coverage-report`
3. `providers:enrich:weak -- --limit=100 --missing-contact-only`
4. `jobs:refresh-approved` (incremental Typesense upserts)
5. `search:index:verify`

Does **not** run full `search:index` or `sra:sync` (see **Daily SRA sync** below).

## Daily SRA sync (`sra-daily-sync.yml` / `npm run sra:sync`)

Runs at **04:00 UTC** via GitHub Actions (`.github/workflows/sra-daily-sync.yml`):

1. `npm run db:migrate`
2. `npm run sra:sync -- --skip-embeddings`
   - Fetches SRA GetAll (gzip)
   - Upserts ~25k organisations with v2 fields (`rawPayload`, `workArea`, offices, etc.)
   - **Archives and deletes** rows not in GetAll (`sra_organisations_archive`)
   - Re-indexes Typesense SRA documents after purge

Manual purge (uses last sync snapshot or live GetAll):

```bash
npm run sra:purge-stale -- --dry-run
npm run sra:purge-stale -- --from-snapshot
```

## Weekly job (`jobs:weekly`)

1. `prod:health`
2. `sra:sync` (includes stale-row purge when run as a full sync)
3. `search:index:sra` (with `SRA_INDEX_SKIP_GEO=1`)
4. `search:index` (all sources)
5. `search:index:verify` — build marked **failed** if verify fails
6. `search:eval`

If SRA sync reports errors or very few organisations, indexing is **aborted** unless `--force` is passed.

## Incremental indexing

When an admin approves enrichment or crawler fields, an `IndexingJob` row is queued. `jobs:refresh-approved` (also run at the end of daily) processes the queue:

- Up to 3 attempts per job
- Failed jobs visible on `/admin/ops`

Manual single-entity index:

```bash
npm run index:provider -- --id=sra:921469 --source=sra --allow-local
```

## Admin visibility

- **`/admin/ops`** — health, counts, queue, last jobs, CLI cheat sheet (read-only)
- **`GET /api/search/status`** — adds `lastIndexBuildAt`, `lastIndexStatus`, `lastIndexSource`, `lastIndexCounts`, `lastIndexErrors`

## Option A: Vercel Cron

Add cron routes that call protected admin APIs (set `ADMIN_SECRET` in Vercel):

```http
POST /api/admin/jobs/daily
POST /api/admin/jobs/weekly
x-admin-secret: <ADMIN_SECRET>
```

Configure in `vercel.json` (example):

```json
{
  "crons": [
    { "path": "/api/admin/jobs/daily", "schedule": "0 5 * * *" },
    { "path": "/api/admin/jobs/weekly", "schedule": "0 6 * * 0" }
  ]
}
```

Ensure serverless `maxDuration` is sufficient for weekly (or run weekly via GitHub Actions instead).

## Option B: GitHub Actions

See `.github/workflows/ops-scheduled-jobs.yml` and `.github/workflows/sra-daily-sync.yml`:

- Daily ops: `05:00 UTC` — `npm run jobs:daily`
- Daily SRA: `04:00 UTC` — `npm run sra:sync -- --skip-embeddings`
- Weekly: `06:00 UTC` Sunday — `npm run jobs:weekly`

Required repository secrets (same as production deploy):

- `DATABASE_URL`
- `TYPESENSE_HOST`
- `TYPESENSE_API_KEY`
- `ADMIN_SECRET`
- `SEARCH_EVENT_SALT`
- `SRA_APIM_SUBSCRIPTION_KEY` (daily + weekly)

## Fail-safe behaviour

| Condition | Behaviour |
|-----------|-----------|
| Typesense unreachable | `prod:health` and index steps fail; build not marked successful |
| DB unreachable | Health fails; jobs exit non-zero |
| SRA sync partial | Weekly indexing aborted (unless `--force`) |
| `search:index:verify` fails | Weekly build status `failed` |
| Indexing job failure | Retries up to 3; then `failed` on `/admin/ops` |

## Database migrations

```bash
cd web && npm run db:migrate
```

Adds `indexing_jobs` and `search_index_builds` tables.
