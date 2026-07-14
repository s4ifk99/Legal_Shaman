#!/usr/bin/env bash
# Export Vercel DNS records for legalshaman.com (for Cloudflare import).
set -euo pipefail
export PATH="$HOME/.local/node/bin:$PATH"
OUT="$(cd "$(dirname "$0")" && pwd)/vercel-dns-export.txt"
npx vercel dns list legalshaman.com 2>&1 | tee "$OUT"
echo ""
echo "Wrote $OUT"
echo "Recreate these in Cloudflare DNS before switching nameservers."
