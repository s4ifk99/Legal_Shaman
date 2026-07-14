#!/usr/bin/env bash
# Wait for Cloudflare login, then run finish-named-tunnel.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "Waiting for ~/.cloudflared/cert.pem (complete browser login)..."
while [[ ! -f "$HOME/.cloudflared/cert.pem" ]]; do sleep 5; done
echo "Login detected — finishing named tunnel setup..."
exec "$DIR/finish-named-tunnel.sh"
