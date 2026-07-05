#!/usr/bin/env bash
# Nightly backup: Postgres dump + MinIO data + .env.prod → /root/backups,
# 7-day local retention. Optional offsite sync to any rclone remote named
# "offsite" (e.g. Cloudflare R2) if rclone is installed and configured.
#
# Install:  bash infra/contabo/setup-backups.sh
# Restore Postgres:  gunzip -c pg-YYYY-MM-DD.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U lp learning_platform
# Restore MinIO:     stop stack, untar minio-YYYY-MM-DD.tar.gz into the minio volume, start stack
set -euo pipefail

APP_DIR="${APP_DIR:-/root/learning-platform}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
STAMP="$(date +%F)"
COMPOSE="docker compose -f $APP_DIR/docker-compose.prod.yml"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

echo "[backup] $STAMP starting"

# 1. Postgres — logical dump through the running container.
$COMPOSE exec -T postgres pg_dump -U lp learning_platform | gzip > "$BACKUP_DIR/pg-$STAMP.sql.gz"
echo "[backup] postgres: $(du -h "$BACKUP_DIR/pg-$STAMP.sql.gz" | cut -f1)"

# 2. MinIO — tar the data volume via a throwaway container (consistent enough
#    for object storage; objects are immutable once written).
MINIO_VOLUME="$(docker volume ls -q | grep minio | head -1)"
if [ -n "$MINIO_VOLUME" ]; then
  docker run --rm -v "$MINIO_VOLUME":/data:ro -v "$BACKUP_DIR":/backup alpine \
    tar czf "/backup/minio-$STAMP.tar.gz" -C /data .
  echo "[backup] minio: $(du -h "$BACKUP_DIR/minio-$STAMP.tar.gz" | cut -f1)"
else
  echo "[backup] WARN: no minio volume found — skipped"
fi

# 3. Secrets file — LP_SECRETS_KEY is unrecoverable; keep a copy with the dumps.
cp "$APP_DIR/.env.prod" "$BACKUP_DIR/env-prod-$STAMP" 2>/dev/null \
  && chmod 600 "$BACKUP_DIR/env-prod-$STAMP" \
  || echo "[backup] WARN: .env.prod not found"

# 4. Retention.
find "$BACKUP_DIR" -maxdepth 1 \( -name 'pg-*.sql.gz' -o -name 'minio-*.tar.gz' -o -name 'env-prod-*' \) \
  -mtime +"$RETENTION_DAYS" -delete

# 5. Offsite (optional): any rclone remote named "offsite".
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q '^offsite:'; then
  rclone sync "$BACKUP_DIR" offsite:learning-platform-backups --transfers 2 --quiet
  echo "[backup] offsite sync done"
fi

echo "[backup] $STAMP complete → $BACKUP_DIR"
