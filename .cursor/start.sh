#!/usr/bin/env bash
# Per-boot startup: ensure PostgreSQL is running before the dev server starts.
# Idempotent and safe to re-run.
set -euo pipefail

sudo pg_ctlcluster 16 main start 2>/dev/null || true

for _ in $(seq 1 30); do
  if pg_isready -h 127.0.0.1 -p 5432 -q; then
    echo "[start] PostgreSQL is ready."
    exit 0
  fi
  sleep 1
done

echo "[start] PostgreSQL did not become ready in time." >&2
exit 1
