# Restore Typesense

The previous cluster `gxewjkzrbcavfp0dp-1.a2.typesense.net` is **terminated** (DNS no longer resolves). Typesense Cloud does not restore deleted clusters — you need a **new cluster** and a **full re-index** from Postgres.

## Local dev (this machine)

```bash
# 1. Start Typesense (Podman/Docker)
podman run -d --name signpost-typesense -p 8108:8108 -v signpost-typesense-data:/data \
  docker.io/typesense/typesense:27.1 \
  --data-dir /data --api-key=YOUR_KEY --enable-cors

# 2. Point web/.env.local at localhost (already set if using defaults)
# TYPESENSE_HOST=localhost
# TYPESENSE_PROTOCOL=http
# TYPESENSE_PORT=8108

# 3. Index from Neon Postgres
cd web
npm run typesense:restore
```

Verify: `npm run search:index:verify` and `curl http://localhost:8108/health`

## Production (legalshaman.com)

### Option A — Typesense Cloud console (manual)

1. Log in at [cloud.typesense.org](https://cloud.typesense.org)
2. **Create cluster** — recommend **London**, **2 GB RAM**, Typesense **27.x**
3. **Generate API keys** — copy admin key
4. Copy hostname (load-balanced `*.typesense.net`)
5. Update **Vercel** project env vars:
   - `TYPESENSE_HOST`
   - `TYPESENSE_API_KEY`
   - `TYPESENSE_PROTOCOL=https`
   - `TYPESENSE_PORT=443`
6. Update matching **GitHub Actions secrets**
7. Re-index: GitHub → **Daily SRA sync and index** → Run workflow  
   Or locally against the new host:
   ```bash
   TYPESENSE_HOST=xxx.typesense.net TYPESENSE_API_KEY=... TYPESENSE_PROTOCOL=https TYPESENSE_PORT=443 \
     npm run typesense:restore
   ```

### Option B — CLI provision (Typesense Cloud Management API key)

1. Create a **Management API key** at cloud.typesense.org → API Keys
2. Add to `web/.env.local`: `TYPESENSE_CLOUD_MANAGEMENT_API_KEY=...`
3. Run:
   ```bash
   cd web
   npm run typesense:restore -- --provision
   ```
4. Paste printed `TYPESENSE_HOST` / `TYPESENSE_API_KEY` into Vercel + GitHub secrets
5. Confirm production: `https://legalshaman.com/api/search/status`  
   Expect `typesenseListingsReachable: true`, `legalEntitiesCollectionExists: true`

## After restore

- `sraTypesenseCount` should be ~25,000
- `/search?q=solicitor` returns SRA firms with unified Typesense ranking (faster than Postgres fallback)
