#!/usr/bin/env bash
# Fix search.legalshaman.com for Cloudflare Tunnel + point Vercel at it.
#
# Why Vercel CNAME → cfargotunnel.com fails:
# cfargotunnel.com is not publicly routable. Cloudflare must PROXY the hostname
# (orange cloud) in the same account. That requires legalshaman.com on Cloudflare DNS.
#
# This script:
#   1. Ensures named tunnel + ollama-proxy are running
#   2. Registers search + llm hostnames with the tunnel (Cloudflare side)
#   3. Removes broken Vercel CNAMEs (cfargotunnel.com targets)
#   4. Prints Cloudflare DNS records to add after NS migration
#   5. If search.legalshaman.com responds, updates Vercel via update-vercel-typesense.sh
set -euo pipefail

CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TUNNEL_NAME="${TUNNEL_NAME:-legal-shaman-home}"
TUNNEL_ID="51965b93-78c7-4664-abc0-2ad13e8c0bc8"
SEARCH_HOST="search.legalshaman.com"
LLM_HOST="llm.legalshaman.com"
DOMAIN="legalshaman.com"
export PATH="$HOME/.local/node/bin:$PATH"

if [[ ! -f "$HOME/.cloudflared/cert.pem" ]]; then
  echo "Run: cloudflared tunnel login" >&2
  exit 1
fi

echo "==> Typesense + Ollama proxy"
"$DIR/podman-typesense.sh" 2>/dev/null || true
systemctl --user start ollama-proxy.service 2>/dev/null || true
if ! pgrep -f ollama-proxy.py >/dev/null; then
  nohup python3 "$DIR/ollama-proxy.py" >/tmp/ollama-proxy.log 2>&1 &
fi

echo "==> Named tunnel config"
mkdir -p "$HOME/.cloudflared"
if [[ ! -f "$HOME/.cloudflared/config.yml" ]]; then
  sed "s|<TUNNEL_ID>|$TUNNEL_ID|g; s|<USER>|$USER|g" \
    "$DIR/cloudflared.example.yml" > "$HOME/.cloudflared/config.yml"
fi

pkill -f 'cloudflared tunnel --url' 2>/dev/null || true
sleep 1
if ! pgrep -f "cloudflared tunnel run $TUNNEL_NAME" >/dev/null; then
  nohup env GODEBUG=netdns=go "$CF" tunnel run "$TUNNEL_NAME" > /tmp/cloudflared-named.log 2>&1 &
  sleep 12
fi

echo "==> Register hostnames in Cloudflare (proxied CNAME in CF DNS)"
"$CF" tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$SEARCH_HOST" 2>&1 || true
"$CF" tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$LLM_HOST" 2>&1 || true

echo "==> Remove broken Vercel CNAMEs (cfargotunnel.com — not publicly routable)"
cd "$DIR/../../web"
for rec in rec_5e175da26f746398d93a380e rec_927ad42c523a25a7628cde7a; do
  npx vercel dns remove "$rec" -y 2>/dev/null && echo "Removed $rec" || true
done

echo ""
echo "=================================================================="
echo "CLOUDFLARE DNS REQUIRED (legalshaman.com must use Cloudflare NS)"
echo "=================================================================="
echo ""
echo "1. Add legalshaman.com at https://dash.cloudflare.com (Free plan OK)"
echo "2. Import DNS — run: $DIR/export-vercel-dns.sh"
echo "3. At your registrar, change nameservers to Cloudflare's (not Vercel)"
echo "4. In Cloudflare DNS, ensure these exist (proxied = orange cloud):"
echo "     $SEARCH_HOST  CNAME  ${TUNNEL_ID}.cfargotunnel.com  (Proxied)"
echo "     $LLM_HOST     CNAME  ${TUNNEL_ID}.cfargotunnel.com  (Proxied)"
echo "     www           CNAME  cname.vercel-dns-017.com       (DNS only)"
echo "     @             ALIAS  cname.vercel-dns-017.com       (DNS only)"
echo ""
echo "tunnel route dns may have created search/llm records already in Cloudflare."
echo "=================================================================="
echo ""

echo "==> Testing $SEARCH_HOST (up to 90s)..."
for i in $(seq 1 18); do
  if curl -sf --max-time 5 "https://${SEARCH_HOST}/health" >/dev/null 2>&1; then
    echo "OK: https://${SEARCH_HOST}/health"
    "$DIR/update-vercel-typesense.sh" "$SEARCH_HOST"
    exit 0
  fi
  sleep 5
done

echo ""
echo "search.legalshaman.com not reachable yet — nameservers still on Vercel."
echo "After Cloudflare NS propagate, run:"
echo "  $DIR/update-vercel-typesense.sh $SEARCH_HOST"
echo ""
echo "Temporary fallback (quick tunnel):"
echo "  mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.named.bak"
echo "  env GODEBUG=netdns=go cloudflared tunnel --url http://127.0.0.1:8108"
echo "  $DIR/update-vercel-typesense.sh <hostname>.trycloudflare.com --quick"
exit 1
