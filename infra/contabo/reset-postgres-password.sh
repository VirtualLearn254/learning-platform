#!/usr/bin/env bash
# reset-postgres-password.sh — align the postgres `lp` user's password with
# whatever .env.prod currently says.
#
# WHY: Same compose-interpolation bug that broke MinIO also broke Postgres on
# day-1 deploys — postgres got initialized with the `changeme` fallback because
# ${POSTGRES_PASSWORD:-changeme} in docker-compose.prod.yml never had the right
# value in scope. Postgres data survives across container recreates, so the
# bad password stays even after compose is fixed.
#
# This script uses local-socket trust auth (default for postgres images) to
# rewrite the password without needing to know the old one. NON-DESTRUCTIVE.

set -euo pipefail

APP_DIR="/root/learning-platform"
COMPOSE_FILE="docker-compose.prod.yml"

cd "$APP_DIR"

NEW_PW=$(grep '^POSTGRES_PASSWORD=' .env.prod | cut -d= -f2-)
if [ -z "$NEW_PW" ]; then
  echo "ERROR: POSTGRES_PASSWORD not found in .env.prod"
  exit 1
fi

echo "==> resetting postgres lp user password to match .env.prod"
# Local Unix-socket connections are trust auth by default in the postgres image.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U lp -d learning_platform \
  -c "ALTER USER lp PASSWORD '$NEW_PW';"

echo "==> force-recreating api + workers (drop cached connections)"
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
echo "    [OK] Postgres password now matches .env.prod."
