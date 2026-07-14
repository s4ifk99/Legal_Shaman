#!/usr/bin/env bash
# One-time Cloudflare Tunnel setup for Legal Shaman hybrid hosting.
# DNS for legalshaman.com is on Vercel — after tunnel create, add CNAME in Vercel DNS:
#   search.legalshaman.com → <TUNNEL_ID>.cfargotunnel.com
#   llm.legalshaman.com    → <TUNNEL_ID>.cfargotunnel.com
#
# Quick tunnel (ephemeral): move config.yml aside so --url mode works:
#   mv ~/.cloudflared/config.yml ~/.cloudflared/config.yml.named.bak
#   env GODEBUG=netdns=go cloudflared tunnel --url http://127.0.0.1:8108
#
# Prerequisites: cloudflared in PATH (~/.local/bin/cloudflared)

set -euo pipefail

CF="${CLOUDFLARED:-$HOME/.local/bin/cloudflared}"
TUNNEL_NAME="${TUNNEL_NAME:-legal-shaman-home}"
CONFIG="$HOME/.cloudflared/config.yml"

if [[ ! -x "$CF" ]]; then
  echo "Install cloudflared first: curl -fsSL -o ~/.local/bin/cloudflared \\"
  echo "  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
  exit 1
fi

echo "Step 1: Log in to Cloudflare (browser opens or copy URL)..."
"$CF" tunnel login

echo "Step 2: Create tunnel $TUNNEL_NAME..."
TUNNEL_ID=$("$CF" tunnel create "$TUNNEL_NAME" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
if [[ -z "$TUNNEL_ID" ]]; then
  TUNNEL_ID=$("$CF" tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$0 ~ n {print $1; exit}')
fi
echo "Tunnel ID: $TUNNEL_ID"

mkdir -p "$HOME/.cloudflared"
sed "s|<TUNNEL_ID>|$TUNNEL_ID|g; s|<USER>|$USER|g" \
  "$(dirname "$0")/cloudflared.example.yml" > "$CONFIG"
echo "Wrote $CONFIG"

echo ""
echo "Step 3: Add CNAME records in Vercel DNS (legalshaman.com → DNS):"
echo "  search.legalshaman.com  CNAME  ${TUNNEL_ID}.cfargotunnel.com"
echo "  llm.legalshaman.com     CNAME  ${TUNNEL_ID}.cfargotunnel.com"
echo ""
echo "Step 4: Run tunnel (or install systemd unit):"
echo "  $CF tunnel run $TUNNEL_NAME"
echo ""
echo "Quick test without DNS (ephemeral URL):"
echo "  $CF tunnel --url http://127.0.0.1:8108"
