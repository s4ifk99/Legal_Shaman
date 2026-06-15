#!/usr/bin/env bash
# Snail-pace Law Society recovery: repeated small batches with rest between runs.
# Usage: ./scripts/sra-recover-lawsociety-loop.sh
# Env: BATCH_LIMIT (default 5), LOOP_PAUSE_SEC (default 600 = 10 min between batches)

set -euo pipefail
cd "$(dirname "$0")/.."

LIMIT="${BATCH_LIMIT:-5}"
PAUSE="${LOOP_PAUSE_SEC:-600}"

echo "Law Society slow loop: ${LIMIT} firms per batch, ${PAUSE}s between batches"
echo "Progress log: .cache/law-society-sra-recovery/progress.jsonl"
echo "Checkpoint:   .cache/law-society-sra-recovery/checkpoint.json"
echo "Stop with Ctrl+C — resume with: npm run sra:recover:lawsociety -- --slow --resume"

while true; do
  echo "--- $(date -Iseconds) starting batch limit=${LIMIT} ---"
  npm run sra:recover:lawsociety -- --slow --limit="${LIMIT}" --resume || true
  echo "--- sleeping ${PAUSE}s ---"
  sleep "${PAUSE}"
done
