#!/usr/bin/env bash
# End-to-end Ollama path: local proxy → quick tunnel → chat completion.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CF_LOG="/tmp/cloudflared-ollama.log"

echo "Ollama path check"
echo "================="

if ! pgrep -f ollama-proxy.py >/dev/null; then
  echo "Starting ollama-proxy..."
  nohup python3 "$DIR/ollama-proxy.py" > /tmp/ollama-proxy.log 2>&1 &
  sleep 1
fi

if ! pgrep -f 'cloudflared tunnel.*127.0.0.1:11435' >/dev/null; then
  echo "Starting Ollama quick tunnel..."
  "$DIR/run-hybrid-tunnels.sh" 2>&1 | grep -i ollama || true
  sleep 3
fi

OLLAMA_HOST=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" 2>/dev/null | grep -v api | tail -1)
if [[ -z "$OLLAMA_HOST" ]]; then
  echo "FAIL: no Ollama tunnel URL in $CF_LOG"
  exit 1
fi

echo "Local proxy:  $(curl -sf --max-time 5 http://127.0.0.1:11435/v1/models >/dev/null && echo OK || echo FAIL)"
echo "Tunnel URL:   $OLLAMA_HOST"

if ! curl -sf --max-time 15 "${OLLAMA_HOST}/v1/models" >/dev/null; then
  echo "FAIL: tunnel /v1/models unreachable"
  exit 1
fi
echo "Tunnel API:   OK"

START=$(date +%s%N)
REPLY=$(curl -sS --max-time 120 "${OLLAMA_HOST}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5:7b-instruct-q4_K_M",
    "messages": [{"role": "user", "content": "Reply with one word: OK"}],
    "stream": false,
    "max_tokens": 10
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'].strip())")
END=$(date +%s%N)
MS=$(( (END - START) / 1000000 ))

echo "Chat test:    OK (${MS}ms) — \"$REPLY\""
if (( MS > 10000 )); then
  echo ""
  echo "WARN: chat took ${MS}ms — Vercel Hobby serverless times out at ~10s."
  echo "      Home Ollama works locally but production needs OpenRouter or Vercel Pro + maxDuration."
fi
echo ""
echo "To route production Guidance through Ollama:"
echo "  ./update-vercel-llm.sh ollama ${OLLAMA_HOST#https://}"
echo "To revert:"
echo "  ./update-vercel-llm.sh openrouter"
