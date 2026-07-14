#!/usr/bin/env bash
# Start hybrid home hosting tunnels (Typesense + Ollama via trycloudflare quick tunnels).
# For production stability, migrate to named tunnel: ./setup-tunnel.sh
#
# Logs: /tmp/cloudflared-typesense.log, /tmp/cloudflared-ollama.log

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"

start_proxy() {
  if ! pgrep -f "ollama-proxy.py" >/dev/null; then
    nohup python3 "$DIR/ollama-proxy.py" > /tmp/ollama-proxy.log 2>&1 &
    echo "Started ollama-proxy on 127.0.0.1:11435"
  fi
}

start_tunnel() {
  local name="$1" port="$2"
  local log="/tmp/cloudflared-${name}.log"
  if pgrep -f "cloudflared tunnel.*127.0.0.1:${port}" >/dev/null; then
    grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" 2>/dev/null | grep -v api | head -1 || echo "(tunnel running; check $log)"
    return
  fi
  export GODEBUG=netdns=go
  nohup "$CF" tunnel --config "$DIR/cloudflared-quick-empty.yml" --url "http://127.0.0.1:${port}" > "$log" 2>&1 &
  sleep 12
  grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | grep -v api | head -1
}

"$DIR/podman-typesense.sh" 2>/dev/null || true
start_proxy
echo "Typesense tunnel: $(start_tunnel typesense 8108)"
echo "Ollama tunnel:    $(start_tunnel ollama 11435)"
echo ""
echo "Update Vercel TYPESENSE_HOST to the Typesense hostname (no https://)."
echo "Update Vercel LLM_BASE_URL to <Ollama hostname>/v1"
