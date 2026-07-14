#!/usr/bin/env bash
# Start Typesense for Legal Shaman on Fedora (Podman).
# Usage:
#   export TYPESENSE_API_KEY="your-strong-key"
#   ./podman-typesense.sh
#
# Binds to 127.0.0.1:8108 only — expose via Cloudflare Tunnel, not the public internet.

set -euo pipefail

NAME="${TYPESENSE_CONTAINER_NAME:-signpost-typesense}"
IMAGE="${TYPESENSE_IMAGE:-docker.io/typesense/typesense:27.1}"
VOLUME="${TYPESENSE_VOLUME:-signpost-typesense-data}"
PORT="${TYPESENSE_PORT:-8108}"
API_KEY="${TYPESENSE_API_KEY:-}"

if [[ -z "$API_KEY" ]]; then
  echo "Set TYPESENSE_API_KEY in the environment (same value as Vercel TYPESENSE_API_KEY)." >&2
  exit 1
fi

if podman container exists "$NAME" 2>/dev/null; then
  if podman container inspect "$NAME" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    echo "Container $NAME is already running."
    curl -sf "http://127.0.0.1:${PORT}/health" && echo " — health OK" || echo " — health check failed"
    exit 0
  fi
  echo "Starting existing container $NAME..."
  podman start "$NAME"
else
  echo "Creating container $NAME..."
  podman run -d \
    --name "$NAME" \
    --restart unless-stopped \
    -p "127.0.0.1:${PORT}:8108" \
    -v "${VOLUME}:/data" \
    "$IMAGE" \
    --data-dir /data \
    --api-key="$API_KEY" \
    --enable-cors
fi

sleep 2
curl -sf "http://127.0.0.1:${PORT}/health" && echo "Typesense ready on 127.0.0.1:${PORT}"
