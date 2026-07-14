#!/usr/bin/env bash
# Start or restart hybrid stack if anything is down (idempotent).
# Used by systemd timer and after reboot.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
QUICK_CFG="$DIR/cloudflared-quick-empty.yml"
export GODEBUG=netdns=go

ENV_LOCAL="$DIR/../../web/.env.local"
if [[ -z "${TYPESENSE_API_KEY:-}" && -f "$ENV_LOCAL" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_LOCAL"
  set +a
  export TYPESENSE_API_KEY
fi

"$DIR/podman-typesense.sh" 2>/dev/null || true

if ! pgrep -f ollama-proxy.py >/dev/null; then
  nohup python3 "$DIR/ollama-proxy.py" > /tmp/ollama-proxy.log 2>&1 &
fi

start_quick_tunnel() {
  local name="$1" port="$2"
  local log="/tmp/cloudflared-${name}.log"
  if pgrep -f "cloudflared tunnel.*127.0.0.1:${port}" >/dev/null; then
    return 0
  fi
  nohup "$CF" tunnel --config "$QUICK_CFG" --url "http://127.0.0.1:${port}" > "$log" 2>&1 &
  sleep 12
}

start_quick_tunnel typesense 8108
start_quick_tunnel ollama 11435

if ! "$DIR/health-check.sh" --quiet 2>/dev/null; then
  echo "ensure-hybrid: stack still unhealthy after start — check logs in /tmp/cloudflared-*.log" >&2
  exit 1
fi
