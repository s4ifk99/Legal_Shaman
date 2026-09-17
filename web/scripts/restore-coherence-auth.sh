#!/usr/bin/env bash
# Re-enable coherence auth after temporary test window.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "[$(date -Iseconds)] Restoring REQUIRE_COHERENCE_AUTH on Vercel production..."
npx vercel@59.10.0 env rm REQUIRE_COHERENCE_AUTH production --yes 2>&1 || true
npx vercel@59.10.0 env rm NEXT_PUBLIC_REQUIRE_COHERENCE_AUTH production --yes 2>&1 || true
cd ..
npx vercel@59.10.0 --prod --yes 2>&1 | tail -5
echo "[$(date -Iseconds)] Coherence auth restored (defaults to required)."
