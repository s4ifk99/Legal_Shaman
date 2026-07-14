#!/usr/bin/env bash
# Check Typesense + Cloudflare quick tunnel (and optional Ollama stack).
# Usage:
#   ./health-check.sh           # human-readable
#   ./health-check.sh --quiet   # exit 0/1 only (for scripts/timer)
#   ./health-check.sh --json    # machine-readable
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
QUIET=false
JSON=false
for arg in "$@"; do
  case "$arg" in
    --quiet|-q) QUIET=true ;;
    --json|-j) JSON=true ;;
  esac
done

ts_local=false
ts_container=false
cf_typesense=false
tunnel_url=""
tunnel_ok=false
ollama_proxy=false
ollama_local=false

if podman container exists signpost-typesense 2>/dev/null && \
   podman container inspect signpost-typesense --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
  ts_container=true
fi

if curl -sf --max-time 3 http://127.0.0.1:8108/health >/dev/null 2>&1; then
  ts_local=true
fi

if pgrep -f "cloudflared tunnel.*127.0.0.1:8108" >/dev/null; then
  cf_typesense=true
  while IFS= read -r url; do
    [[ -z "$url" ]] && continue
    if curl -sf --max-time 10 "${url}/health" >/dev/null 2>&1; then
      tunnel_url="$url"
      tunnel_ok=true
      break
    fi
    [[ -z "$tunnel_url" ]] && tunnel_url="$url"
  done < <(grep -ohE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared*.log 2>/dev/null | grep -v api | sort -u)
fi

if pgrep -f ollama-proxy.py >/dev/null; then
  ollama_proxy=true
fi
if curl -sf --max-time 3 http://127.0.0.1:11435/api/tags >/dev/null 2>&1; then
  ollama_local=true
fi

all_core_ok=false
if $ts_local && $cf_typesense && $tunnel_ok; then
  all_core_ok=true
fi

if $JSON; then
  printf '{"typesense_container":%s,"typesense_local":%s,"cloudflared_typesense":%s,"tunnel_url":"%s","tunnel_public_ok":%s,"ollama_proxy":%s,"ollama_proxy_ok":%s,"ok":%s}\n' \
    "$ts_container" "$ts_local" "$cf_typesense" "${tunnel_url:-}" "$tunnel_ok" "$ollama_proxy" "$ollama_local" "$all_core_ok"
  $all_core_ok || exit 1
  exit 0
fi

if $QUIET; then
  $all_core_ok || exit 1
  exit 0
fi

echo "Hybrid home hosting health"
echo "=========================="
printf "Typesense container:  %s\n" "$( $ts_container && echo OK || echo DOWN )"
printf "Typesense local:      %s\n" "$( $ts_local && echo OK || echo DOWN )"
printf "cloudflared (8108):   %s\n" "$( $cf_typesense && echo OK || echo DOWN )"
printf "Tunnel public:        %s\n" "$( $tunnel_ok && echo OK || echo DOWN )"
[[ -n "$tunnel_url" ]] && echo "Tunnel URL:           $tunnel_url"
printf "ollama-proxy:         %s\n" "$( $ollama_proxy && echo OK || echo 'not running (optional)' )"
echo ""
if $all_core_ok; then
  echo "Overall: OK (Typesense + tunnel)"
  exit 0
fi
echo "Overall: DEGRADED — run: $DIR/ensure-hybrid.sh"
exit 1
