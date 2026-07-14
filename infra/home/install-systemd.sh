#!/usr/bin/env bash
# Install systemd user units: auto-start + watchdog for quick-tunnel hybrid hosting.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"

sed "s|%h/Projects/Legal Shaman|$HOME/Projects/Legal Shaman|g" \
  "$DIR/hybrid-watchdog.service" > "$UNIT_DIR/hybrid-watchdog.service"
cp "$DIR/hybrid-watchdog.timer" "$UNIT_DIR/"
sed "s|%h/Projects/Legal Shaman|$HOME/Projects/Legal Shaman|g" \
  "$DIR/ollama-proxy.service" > "$UNIT_DIR/ollama-proxy.service"

chmod +x "$DIR/health-check.sh" "$DIR/ensure-hybrid.sh"

systemctl --user daemon-reload
systemctl --user enable hybrid-watchdog.timer ollama-proxy.service
systemctl --user start hybrid-watchdog.timer ollama-proxy.service

# Boot-time ensure (oneshot)
systemctl --user enable hybrid-watchdog.service 2>/dev/null || true

echo "Installed hybrid watchdog (checks every 5 min, restarts if down)."
echo ""
echo "Commands:"
echo "  systemctl --user status hybrid-watchdog.timer"
echo "  $DIR/health-check.sh"
echo "  journalctl --user -u hybrid-watchdog.service -n 20"
echo ""
echo "Enable services after logout (recommended):"
echo "  sudo loginctl enable-linger $USER"
echo ""
echo "Run ensure now:"
"$DIR/ensure-hybrid.sh"
"$DIR/health-check.sh"
