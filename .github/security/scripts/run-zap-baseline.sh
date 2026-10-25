#!/usr/bin/env bash
# Passive OWASP ZAP baseline. No active scan, no authentication, no form posts.
set -euo pipefail

REPORT_DIR="${1:?report dir}"
TARGET_URL="${2:?target url}"
IMAGE="ghcr.io/zaproxy/zaproxy@sha256:5ccfff9a411743ab2615136a2edd7416bec9ce41572fa94e935df38c14adb2b6"

mkdir -p "$REPORT_DIR/zap-wrk"
chmod 0777 "$REPORT_DIR/zap-wrk"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not available, so the ZAP baseline did not run" > "$REPORT_DIR/zap-error.txt"
  echo "3" > "$REPORT_DIR/zap.exit"
  exit 0
fi

set +e
docker run --rm \
  -v "$REPORT_DIR/zap-wrk:/zap/wrk:rw" \
  "$IMAGE" \
  zap-baseline.py \
  -t "$TARGET_URL" \
  -J zap.json \
  -w zap.md \
  -I \
  -m 2 \
  -T 12 \
  -z "-config spider.postForm=false -config spider.maxDepth=2 -config spider.maxChildren=20 -config spider.threadCount=2"
code=$?
set -e

echo "$code" > "$REPORT_DIR/zap.exit"
if [[ -f "$REPORT_DIR/zap-wrk/zap.json" ]]; then
  mv "$REPORT_DIR/zap-wrk/zap.json" "$REPORT_DIR/zap.json"
fi
if [[ -f "$REPORT_DIR/zap-wrk/zap.md" ]]; then
  mv "$REPORT_DIR/zap-wrk/zap.md" "$REPORT_DIR/zap.md"
fi
if [[ ! -f "$REPORT_DIR/zap.json" ]]; then
  echo "ZAP baseline exited ${code} without a JSON report" > "$REPORT_DIR/zap-error.txt"
fi
