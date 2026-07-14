#!/usr/bin/env bash
# Update TYPESENSE_HOST (and related) on Vercel without hanging on preview.
# Usage:
#   ./update-vercel-typesense.sh search.legalshaman.com
#   ./update-vercel-typesense.sh paid-foo.trycloudflare.com --quick
set -euo pipefail

HOST="${1:?Usage: $0 <typesense-hostname> [--quick]}"
QUICK="${2:-}"
WEB="$(cd "$(dirname "$0")/../../web" && pwd)"
export PATH="$HOME/.local/node/bin:$PATH"
cd "$WEB"

echo "==> Production env"
npx vercel env update TYPESENSE_HOST production --value "$HOST" -y
npx vercel env update TYPESENSE_PROTOCOL production --value "https" -y
npx vercel env update TYPESENSE_PORT production --value "443" -y

if [[ "$QUICK" != "--quick" && "$HOST" == *legalshaman.com ]]; then
  npx vercel env update LLM_BASE_URL production --value "https://llm.legalshaman.com/v1" -y
fi

echo "==> Preview env (30s timeout)"
timeout 30 npx vercel env update TYPESENSE_HOST preview --value "$HOST" -y || \
  echo "WARN: preview TYPESENSE_HOST update timed out — set manually in Vercel dashboard"

echo "==> Deploy production"
npx vercel deploy --prod --yes 2>&1 | tail -8

echo "==> Verify"
curl -sf "https://www.legalshaman.com/api/search/status" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print('reachable',d.get('typesenseListingsReachable'),'engine',d.get('activeDirectoryEngine'),'docs',d.get('legalEntitiesDocumentCount'))"
