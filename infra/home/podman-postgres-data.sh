#!/usr/bin/env bash
# Start Postgres + pgvector for Legal Shaman heavy data on Fedora (Podman).
# Neon free stays for accounts only; this holds SRA, embeddings, knowledge graph, etc.
#
# Usage:
#   ./podman-postgres-data.sh
#
# Binds to 127.0.0.1:5433 (avoids conflicting with a local 5432).
# Point DATA_DATABASE_URL at:
#   postgresql://legalshaman:legalshaman@127.0.0.1:5433/legal_shaman_data
# Then: cd web && npm run db:migrate:data

set -euo pipefail

NAME="${POSTGRES_DATA_CONTAINER_NAME:-signpost-postgres-data}"
IMAGE="${POSTGRES_DATA_IMAGE:-docker.io/pgvector/pgvector:pg16}"
VOLUME="${POSTGRES_DATA_VOLUME:-signpost-postgres-data}"
PORT="${POSTGRES_DATA_PORT:-5433}"
USER_NAME="${POSTGRES_DATA_USER:-legalshaman}"
PASSWORD="${POSTGRES_DATA_PASSWORD:-legalshaman}"
DB_NAME="${POSTGRES_DATA_DB:-legal_shaman_data}"

if podman container exists "$NAME" 2>/dev/null; then
  if podman container inspect "$NAME" --format '{{.State.Running}}' 2>/dev/null | grep -q true; then
    echo "Container $NAME is already running on 127.0.0.1:${PORT}"
    exit 0
  fi
  echo "Starting existing container $NAME..."
  podman start "$NAME"
else
  echo "Creating container $NAME (pgvector)..."
  podman run -d \
    --name "$NAME" \
    --restart unless-stopped \
    -e POSTGRES_USER="$USER_NAME" \
    -e POSTGRES_PASSWORD="$PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    -p "127.0.0.1:${PORT}:5432" \
    -v "${VOLUME}:/var/lib/postgresql/data" \
    "$IMAGE"
fi

echo "Waiting for Postgres..."
for i in $(seq 1 30); do
  if podman exec "$NAME" pg_isready -U "$USER_NAME" -d "$DB_NAME" >/dev/null 2>&1; then
    echo "Postgres ready: postgresql://${USER_NAME}:****@127.0.0.1:${PORT}/${DB_NAME}"
    echo ""
    echo "Add to Signpost/web/.env.local:"
    echo "  DATA_DATABASE_URL=postgresql://${USER_NAME}:${PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}"
    echo "  ACCOUNTS_DATABASE_URL=<your Neon pooled URL>"
    echo ""
    echo "Then migrate the data DB:"
    echo "  cd Signpost/web && npm run db:migrate:data"
    exit 0
  fi
  sleep 1
done

echo "Postgres did not become ready in time." >&2
exit 1
