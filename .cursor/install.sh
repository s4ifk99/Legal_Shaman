#!/usr/bin/env bash
# Idempotent bootstrap for the Legal Shaman Next.js web app (web/).
# Provisions PostgreSQL 16 + pgvector, installs npm deps, applies Prisma
# migrations, and seeds sample lawyer data. Safe to run repeatedly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- System deps: PostgreSQL 16 + pgvector (only install when missing) ---
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  echo "[install] Installing PostgreSQL 16 + pgvector..."
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    postgresql-16 postgresql-16-pgvector postgresql-client-16
fi

# --- Start Postgres so migrations/seed can run during install ---
sudo pg_ctlcluster 16 main start 2>/dev/null || true
for _ in $(seq 1 30); do
  pg_isready -h 127.0.0.1 -p 5432 -q && break
  sleep 1
done

# --- Role + database + pgvector extension (idempotent) ---
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" >/dev/null
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='legal_shaman'" \
  | grep -q 1 || sudo -u postgres createdb legal_shaman
PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d legal_shaman \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

# --- Local dev env file (gitignored). Only create when absent so real
#     secrets added later (LLM_API_KEY, Typesense, SRA, Stripe, ...) survive. ---
cd "$REPO_ROOT/web"
if [ ! -f .env.local ]; then
  echo "[install] Writing web/.env.local with local dev defaults..."
  cat > .env.local <<'ENV'
# Local Cloud Agent dev defaults (gitignored). Add real API keys here as needed.
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/legal_shaman?schema=public
# Relax auth gates for local development/testing.
REQUIRE_SEARCH_AUTH=false
NEXT_PUBLIC_REQUIRE_SEARCH_AUTH=false
REQUIRE_COHERENCE_AUTH=false
NEXT_PUBLIC_REQUIRE_COHERENCE_AUTH=false
ENV
fi

# --- App dependencies (postinstall runs `prisma generate`) ---
echo "[install] Installing npm dependencies..."
npm ci

# --- Database schema + sample data (both idempotent) ---
echo "[install] Applying Prisma migrations..."
npm run db:migrate
echo "[install] Seeding sample lawyers..."
npm run db:seed

echo "[install] Done."
