#!/usr/bin/env bash
# Update Vercel LLM env for guidance (Shaman Recommends).
# Usage:
#   ./update-vercel-llm.sh openrouter              # reliable default
#   ./update-vercel-llm.sh ollama <trycloudflare-host>
set -euo pipefail

MODE="${1:?Usage: $0 openrouter | ollama <hostname>}"
WEB="$(cd "$(dirname "$0")/../../web" && pwd)"
export PATH="$HOME/.local/node/bin:$PATH"
cd "$WEB"

set -a
source .env.local
set +a

if [[ "$MODE" == "openrouter" ]]; then
  LLM_BASE="https://openrouter.ai/api/v1"
  LLM_KEY="$LLM_API_KEY"
  LLM_MODEL="${LLM_MODEL:-qwen/qwen3-32b}"
elif [[ "$MODE" == "ollama" ]]; then
  HOST="${2:?Usage: $0 ollama <hostname-without-https>}"
  LLM_BASE="https://${HOST}/v1"
  LLM_KEY="ollama"
  LLM_MODEL="qwen2.5:7b-instruct-q4_K_M"
else
  echo "Unknown mode: $MODE" >&2
  exit 1
fi

echo "==> Production LLM env ($MODE)"
npx vercel env update LLM_BASE_URL production --value "$LLM_BASE" -y
npx vercel env update LLM_API_KEY production --value "$LLM_KEY" --sensitive -y
npx vercel env update LLM_MODEL production --value "$LLM_MODEL" -y

# Embeddings stay on OpenRouter (1536-dim chunks)
npx vercel env update EMBEDDING_BASE_URL production --value "https://openrouter.ai/api/v1" -y 2>/dev/null || \
  npx vercel env add EMBEDDING_BASE_URL production --value "https://openrouter.ai/api/v1" -y
npx vercel env update EMBEDDING_API_KEY production --value "$LLM_API_KEY" --sensitive -y 2>/dev/null || \
  npx vercel env add EMBEDDING_API_KEY production --value "$LLM_API_KEY" --sensitive -y
npx vercel env update EMBEDDING_MODEL production --value "text-embedding-3-small" -y 2>/dev/null || \
  npx vercel env add EMBEDDING_MODEL production --value "text-embedding-3-small" -y

echo "==> Deploy"
npx vercel deploy --prod --yes 2>&1 | tail -6

echo "Done. Sign in and retry Guidance — expect 'AI synthesised' badge."
