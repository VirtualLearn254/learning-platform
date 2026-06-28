#!/usr/bin/env bash
# reset-minio.sh — wipe MinIO's data volume so it re-initializes with the
# current .env.prod credentials.
#
# WHY: MinIO writes root credentials to its data directory on first start.
# Subsequent restarts IGNORE changes to MINIO_ROOT_USER / MINIO_ROOT_PASSWORD.
# If .env.prod has drifted (or was always wrong), the only safe way to
# realign is to nuke the data dir.
#
# SAFE because: this destroys MinIO objects. Run this ONLY when MinIO is
# either fresh (nothing uploaded yet) or you have an external backup.

set -euo pipefail

APP_DIR="/root/learning-platform"
COMPOSE_FILE="docker-compose.prod.yml"

# Compose project name defaults to the directory name (lowercased).
PROJECT_NAME="$(basename "$APP_DIR" | tr 'A-Z' 'a-z')"
VOLUME_NAME="${PROJECT_NAME}_minio_data"

cd "$APP_DIR"

echo "==> stopping MinIO"
docker compose -f "$COMPOSE_FILE" stop minio

echo "==> removing volume $VOLUME_NAME"
docker volume rm "$VOLUME_NAME" 2>/dev/null || echo "    (volume already gone — that's fine)"

echo "==> starting MinIO (will re-initialize from .env.prod)"
docker compose -f "$COMPOSE_FILE" up -d minio

echo "==> waiting for MinIO to be healthy"
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T minio curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    echo "    [OK] MinIO ready"
    break
  fi
  sleep 1
done

echo "==> restarting api + workers (drop cached connections)"
docker compose -f "$COMPOSE_FILE" restart api workers

echo
echo "    [OK] MinIO reset. Credentials now match .env.prod."
echo "    Try the upload again — should succeed."
