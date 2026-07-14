#!/usr/bin/env bash
# Complete named Cloudflare tunnel setup after `cloudflared tunnel login`.
# Usage: ./finish-named-tunnel.sh
set -euo pipefail

CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TUNNEL_NAME="${TUNNEL_NAME:-legal-shaman-home}"
CONFIG="$HOME/.cloudflared/config.yml"
SEARCH_HOST="search.legalshaman.com"
LLM_HOST="llm.legalshaman.com"
DOMAIN="legalshaman.com"

if [[ ! -f "$HOME/.cloudflared/cert.pem" ]]; then
  echo "Run cloudflared tunnel login first (or ./setup-tunnel.sh)." >&2
  exit 1
fi

export PATH="$HOME/.local/node/bin:$PATH"

echo "==> Ensure Typesense + Ollama proxy"
"$DIR/podman-typesense.sh" 2>/dev/null || true
if ! pgrep -f "ollama-proxy.py" >/dev/null; then
  nohup python3 "$DIR/ollama-proxy.py" > /tmp/ollama-proxy.log 2>&1 &
  sleep 1
fi

echo "==> Create tunnel $TUNNEL_NAME (if missing)"
if ! "$CF" tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
  "$CF" tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID=$("$CF" tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$0 ~ n {print $1; exit}')
if [[ -z "$TUNNEL_ID" ]]; then
  echo "Could not find tunnel ID for $TUNNEL_NAME" >&2
  exit 1
fi
echo "Tunnel ID: $TUNNEL_ID"

mkdir -p "$HOME/.cloudflared"
sed "s|<TUNNEL_ID>|$TUNNEL_ID|g; s|<USER>|$USER|g" \
  "$DIR/cloudflared.example.yml" > "$CONFIG"
echo "Wrote $CONFIG"

CNAME_TARGET="${TUNNEL_ID}.cfargotunnel.com"
cd "$DIR/../../web"

add_dns() {
  local sub="$1"
  if npx vercel dns list "$DOMAIN" 2>/dev/null | grep -qE "[[:space:]]${sub}[[:space:]]"; then
    echo "DNS ${sub}.${DOMAIN} exists on Vercel — remove after Cloudflare NS migration (see fix-search-subdomain.sh)"
  else
    echo "Skip Vercel DNS for ${sub} (use Cloudflare proxied CNAME after NS migration)"
  fi
}

echo "==> Vercel DNS CNAMEs"
add_dns search
add_dns llm

echo "==> Stop ephemeral quick tunnels"
pkill -f 'cloudflared tunnel --url' 2>/dev/null || true
sleep 2

echo "==> Start named tunnel"
if systemctl --user is-active cloudflared-legal-shaman.service &>/dev/null; then
  systemctl --user restart cloudflared-legal-shaman.service
else
  nohup "$CF" tunnel run "$TUNNEL_NAME" > /tmp/cloudflared-named.log 2>&1 &
  sleep 8
fi

echo "==> Wait for DNS (up to 60s)"
for i in $(seq 1 12); do
  if curl -sf --max-time 5 "https://${SEARCH_HOST}/health" >/dev/null 2>&1; then
    echo "Typesense reachable at https://${SEARCH_HOST}"
    break
  fi
  sleep 5
done

echo "==> Update Vercel env (production first — preview may timeout)"
"$DIR/update-vercel-typesense.sh" "$SEARCH_HOST"

echo ""
echo "Done. Verify:"
echo "  curl -s https://www.legalshaman.com/api/search/status | jq .directorySearchBackend,.typesenseListingsReachable"
echo "  systemctl --user enable --now ollama-proxy cloudflared-legal-shaman  # optional persistence"
