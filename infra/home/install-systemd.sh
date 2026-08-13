#!/usr/bin/env bash
# Install systemd user units: auto-start + watchdog for quick-tunnel hybrid hosting.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_SCRIPTS="$(cd "$DIR/../../web/scripts" && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"

sed "s|%h/Projects/Legal Shaman|$HOME/Projects/Legal Shaman|g" \
  "$DIR/hybrid-watchdog.service" > "$UNIT_DIR/hybrid-watchdog.service"
cp "$DIR/hybrid-watchdog.timer" "$UNIT_DIR/"
sed "s|%h/Projects/Legal Shaman|$HOME/Projects/Legal Shaman|g" \
  "$DIR/ollama-proxy.service" > "$UNIT_DIR/ollama-proxy.service"
# Space in "Legal Shaman" must stay quoted for systemd ExecStart/WorkingDirectory.
cat >"$UNIT_DIR/next-dev-idle.service" <<EOF
[Unit]
Description=Stop idle Signpost next dev server (2h inactivity)

[Service]
Type=oneshot
WorkingDirectory=$HOME/Projects/Legal Shaman/Signpost/web
ExecStart=/bin/bash "$HOME/Projects/Legal Shaman/Signpost/web/scripts/next-dev-idle-watchdog.sh"
EOF
cp "$DIR/next-dev-idle.timer" "$UNIT_DIR/"

chmod +x "$DIR/health-check.sh" "$DIR/ensure-hybrid.sh" \
  "$WEB_SCRIPTS/next-dev-idle-watchdog.sh"

systemctl --user daemon-reload
systemctl --user enable hybrid-watchdog.timer ollama-proxy.service next-dev-idle.timer
systemctl --user start hybrid-watchdog.timer ollama-proxy.service next-dev-idle.timer

# Boot-time ensure (oneshot)
systemctl --user enable hybrid-watchdog.service 2>/dev/null || true

echo "Installed hybrid watchdog (checks every 5 min, restarts if down)."
echo "Installed next-dev idle stopper (stops local next dev after 2h inactivity)."
echo ""
echo "Commands:"
echo "  systemctl --user status hybrid-watchdog.timer"
echo "  systemctl --user status next-dev-idle.timer"
echo "  $DIR/health-check.sh"
echo "  journalctl --user -u hybrid-watchdog.service -n 20"
echo "  journalctl --user -u next-dev-idle.service -n 20"
echo ""
echo "Enable services after logout (recommended):"
echo "  sudo loginctl enable-linger $USER"
echo ""
echo "Run ensure now:"
"$DIR/ensure-hybrid.sh"
"$DIR/health-check.sh"
