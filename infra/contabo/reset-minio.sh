#!/usr/bin/env bash
# reset-minio.sh — wipe MinIO's data volume AND force-recreate all containers
# that touch MinIO, so credentials in .env.prod become authoritative.
#
# WHY: `docker compose restart` keeps cached env vars from container create-time.
# To make a changed .env.prod actually take effect, you need --force-recreate.
# Wiping the volume on top of that guarantees MinIO re-initializes its root
# user from the current env (rather than its on-disk users.json).
#
# SAFE because: this destroys MinIO objects. Run only when MinIO is fresh
# (nothing uploaded yet) or you have an external backup.

set -euo pipefail

APP_DIR="/root/learning-platform"
COMPOSE_FILE="docker-compose.prod.yml"

PROJECT_NAME="$(basename "$APP_DIR" | tr 'A-Z' 'a-z')"
VOLUME_NAME="${PROJECT_NAME}_minio_data"

cd "$APP_DIR"

echo "==> stopping + removing MinIO container (forces env re-read on next up)"
docker compose -f "$COMPOSE_FILE" rm -sf minio

echo "==> removing volume $VOLUME_NAME"
docker volume rm "$VOLUME_NAME" 2>/dev/null || echo "    (volume already gone — that's fine)"

echo "==> starting MinIO fresh (re-initializes from current .env.prod)"
docker compose -f "$COMPOSE_FILE" up -d minio

echo "==> waiting for MinIO to be healthy"
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T minio curl -sf http://localhost:9000/minio/health/live >/dev/null 2>&1; then
    echo "    [OK] MinIO ready"
    break
  fi
  sleep 1
done

echo "==> force-recreating api + workers (so they re-read .env.prod too)"
docker compose -f "$COMPOSE_FILE" up -d --force-recreate --no-deps api workers

echo "==> waiting for api to be healthy"
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T api wget -qO- http://localhost:3001/health >/dev/null 2>&1; then
    echo "    [OK] api ready"
    break
  fi
  sleep 1
done

echo
echo "    [OK] MinIO + api + workers all reset with credentials from .env.prod."
echo "    Try the upload again — should succeed."
