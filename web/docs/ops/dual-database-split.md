# Dual-database split: Neon accounts + home data Postgres

**Goal:** Keep **accounts** (users, bookmarks) on Neon Free (~0.5 GB). Put **everything heavy** on your Fedora disk so Neon never hits storage / transfer quotas again.

```mermaid
flowchart LR
  clients[Clients] --> vercel[Vercel]
  vercel --> neon[Neon Free - accounts]
  vercel --> typesense[Typesense home - directory]
  vercel --> dataDb[Home Postgres - SRA knowledge]
  neon --> users[users bookmarks]
  dataDb --> heavy[sra_organisations legal_chunks embeddings]
```

## What lives where

| Store | Contents | Size risk |
|---|---|---|
| **Home Postgres** (`ACCOUNTS_DATABASE_URL` + `ACCOUNTS_WS_PROXY`) | `users`, `bookmarks`, `triage_feedback_emails` | Tiny — hosted on Envy, reached via `llm.legalshaman.com/pg-ws` |
| **Home Postgres** (`DATA_DATABASE_URL`) | SRA register, legal chunks/embeddings, knowledge graph, search events, CRM, crawler | Large (use disk) |
| **Typesense** (home) | Directory search index (`legal_entities`) | Large, but not Neon |

Empty unused tables on Neon are fine (almost no storage). Do **not** run SRA sync or knowledge ingest against Neon.

## One-time setup (Fedora)

### 1. Start home Postgres

```bash
cd "/home/pravda/Projects/Legal Shaman/Signpost/infra/home"
chmod +x podman-postgres-data.sh
./podman-postgres-data.sh
```

### 2. Configure `Signpost/web/.env.local`

```env
# Neon Free — accounts only (pooled URL for the app)
ACCOUNTS_DATABASE_URL=postgresql://neondb_owner:...@ep-....-pooler....neon.tech/neondb?sslmode=require

# Home Postgres — heavy data (from podman-postgres-data.sh)
DATA_DATABASE_URL=postgresql://legalshaman:legalshaman@127.0.0.1:5433/legal_shaman_data

# Optional: keep DATABASE_URL = ACCOUNTS for scripts that only know DATABASE_URL
DATABASE_URL=${ACCOUNTS_DATABASE_URL}
```

### 3. Migrate both databases

```bash
cd "/home/pravda/Projects/Legal Shaman/Signpost/web"
npm run db:migrate:accounts   # Neon — creates schema; leave heavy tables empty
npm run db:migrate:data       # Home — full schema for SRA / knowledge
```

### 4. Vercel production

| Variable | Value |
|---|---|
| `ACCOUNTS_DATABASE_URL` | Neon **pooled** URL |
| `DATABASE_URL` | Same Neon pooled URL (auth fallback + legacy) |
| `DATA_DATABASE_URL` | Only if home Postgres is reachable from Vercel (Cloudflare Tunnel). Otherwise leave unset and rely on Typesense + `wiki-index.json` for search until the tunnel is up. |

Redeploy after changing env.

### 5. Re-create your account

Neon is a **new** empty accounts DB. Register again at https://www.legalshaman.com with `s4ifk99@gmail.com` (or migrate `users`/`bookmarks` from the old Neon project if you regain access).

### 6. Load heavy data into home Postgres (not Neon)

```bash
# With DATA_DATABASE_URL pointing at 127.0.0.1:5433
npm run sra:sync          # or your SRA import path
npm run ingest:legal-knowledge
npm run search:index:sra  # Typesense directory
```

## Rules of thumb

- **Never** point `sra:sync` / `ingest:legal-knowledge` at Neon Free.
- Auth + bookmarks always use `accountsPrisma` → Neon.
- Catalogue / knowledge / search events use default `prisma` → `DATA_DATABASE_URL` when set.
- If `DATA_DATABASE_URL` is unset, `prisma` falls back to `DATABASE_URL` (single-DB mode).

## Production without a data tunnel (interim)

Until home Postgres is exposed via Cloudflare Tunnel:

1. Neon = accounts only (login works).
2. Typesense = Find a lawyer / directory.
3. `wiki-index.json` on Vercel = Ask the Shaman graph answers.
4. Hybrid RAG chunks in Postgres wait until `DATA_DATABASE_URL` is reachable from Vercel.
