#!/usr/bin/env bash
# Stop Signpost local `next dev` after prolonged inactivity.
#
# Activity = established TCP clients on the Next listen port, or recent edits
# under the web tree (source files; .next / node_modules ignored).
#
# Env:
#   IDLE_TIMEOUT_SEC   default 7200 (2 hours)
#   NEXT_PORT          default 3000
#   WEB_ROOT           default: parent of scripts/
#   STATE_FILE         default /tmp/signpost-next-dev-idle.state
#   DRY_RUN=1          log what would happen, do not kill

set -euo pipefail

IDLE_TIMEOUT_SEC="${IDLE_TIMEOUT_SEC:-7200}"
NEXT_PORT="${NEXT_PORT:-3000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_ROOT="${WEB_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
STATE_FILE="${STATE_FILE:-/tmp/signpost-next-dev-idle.state}"
LOG_FILE="${LOG_FILE:-/tmp/signpost-next-dev-idle.log}"
DRY_RUN="${DRY_RUN:-0}"
NOW="$(date +%s)"

log() {
  printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE" >/dev/null
  printf '%s %s\n' "$(date -Is)" "$*" >&2
}

belongs_to_web_root() {
  local pid="$1" cwd cmd
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$WEB_ROOT" ]] && return 0
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cmd" == *"$WEB_ROOT"* ]] && return 0
  # next-server renames argv; match via parent cmdline / cwd.
  local ppid
  ppid="$(awk '/^PPid:/{print $2}' "/proc/$pid/status" 2>/dev/null || true)"
  if [[ -n "$ppid" && -d "/proc/$ppid" ]]; then
    cwd="$(readlink -f "/proc/$ppid/cwd" 2>/dev/null || true)"
    [[ "$cwd" == "$WEB_ROOT" ]] && return 0
    cmd="$(tr '\0' ' ' < "/proc/$ppid/cmdline" 2>/dev/null || true)"
    [[ "$cmd" == *"$WEB_ROOT"* ]] && return 0
  fi
  return 1
}

find_next_dev_pids() {
  local pid cmd
  while read -r pid; do
    [[ -z "$pid" || ! -d "/proc/$pid" ]] && continue
    belongs_to_web_root "$pid" || continue
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    if [[ "$cmd" == *"next-server"* ]] || [[ "$cmd" == *"next dev"* ]] || [[ "$cmd" == *"/next"* && "$cmd" == *"dev"* ]]; then
      echo "$pid"
    fi
  done < <(pgrep -f 'next-server|next dev' 2>/dev/null || true)
}

has_clients() {
  # Established clients only (page loads / HMR). Ignore LISTEN.
  ss -Htn state established "sport = :${NEXT_PORT}" 2>/dev/null | grep -q .
}

latest_source_mtime() {
  # Newest source/config mtime under the app (excludes build + deps).
  find "$WEB_ROOT" \
    \( -path '*/node_modules/*' -o -path '*/.next/*' -o -path '*/.git/*' -o -path '*/reports/*' -o -path '*/data/*' \) -prune \
    -o -type f \( \
      -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \
      -o -name '*.css' -o -name '*.scss' -o -name '*.json' -o -name '*.mdx' \
      -o -name '*.mjs' -o -name 'next.config.*' -o -name 'middleware.ts' \
    \) -printf '%T@\n' 2>/dev/null \
    | sort -nr \
    | head -1 \
    | cut -d. -f1
}

read_state_ts() {
  if [[ -f "$STATE_FILE" ]]; then
    awk -F= '/^last_activity=/ {print $2; exit}' "$STATE_FILE" 2>/dev/null || true
  fi
}

write_state() {
  local last="$1" reason="$2"
  cat >"$STATE_FILE" <<EOF
last_activity=$last
reason=$reason
web_root=$WEB_ROOT
port=$NEXT_PORT
updated=$NOW
EOF
}

pids="$(find_next_dev_pids | sort -u | tr '\n' ' ')"
pids="${pids%% }"
if [[ -z "$pids" ]]; then
  rm -f "$STATE_FILE"
  exit 0
fi

active=0
reason="idle"
if has_clients; then
  active=1
  reason="clients"
else
  mtime="$(latest_source_mtime || true)"
  if [[ -n "${mtime:-}" ]] && (( NOW - mtime < IDLE_TIMEOUT_SEC )); then
    active=1
    reason="source_edit"
  fi
fi

last="$(read_state_ts)"
if [[ "$active" -eq 1 ]]; then
  write_state "$NOW" "$reason"
  log "active ($reason); pids=[$pids] reset idle clock"
  exit 0
fi

# First sighting with no activity: start the idle clock now (grace period).
if [[ -z "${last:-}" ]]; then
  write_state "$NOW" "first_seen_idle"
  log "first idle sighting; pids=[$pids] starting ${IDLE_TIMEOUT_SEC}s clock"
  exit 0
fi

idle_for=$((NOW - last))
if (( idle_for < IDLE_TIMEOUT_SEC )); then
  remaining=$((IDLE_TIMEOUT_SEC - idle_for))
  log "still idle ${idle_for}s; ${remaining}s until stop; pids=[$pids]"
  exit 0
fi

log "idle ${idle_for}s >= ${IDLE_TIMEOUT_SEC}s — stopping Signpost next dev pids=[$pids]"

if [[ "$DRY_RUN" == "1" ]]; then
  log "DRY_RUN=1; not killing"
  exit 0
fi

# Kill launchers first (npm/next), then any remaining next-server for this cwd.
declare -A seen=()
for pid in $pids; do
  [[ -n "${seen[$pid]:-}" ]] && continue
  seen[$pid]=1
  # Climb to the nearest `npm run dev` / `next dev` parent so children die with it.
  target="$pid"
  ppid="$(awk '/^PPid:/{print $2}' "/proc/$pid/status" 2>/dev/null || true)"
  if [[ -n "$ppid" && -r "/proc/$ppid/cmdline" ]]; then
    pcmd="$(tr '\0' ' ' < "/proc/$ppid/cmdline" 2>/dev/null || true)"
    if [[ "$pcmd" == *"next dev"* || "$pcmd" == *"npm run dev"* || "$pcmd" == *"npm"*"dev"* ]]; then
      target="$ppid"
    fi
  fi
  kill -TERM "$target" 2>/dev/null || true
done

sleep 2
for pid in $(find_next_dev_pids); do
  kill -KILL "$pid" 2>/dev/null || true
done

rm -f "$STATE_FILE"
log "stopped"
