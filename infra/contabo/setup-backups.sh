#!/usr/bin/env bash
# One-time backup setup: installs the nightly cron (03:15 server time) and
# runs an immediate first backup so you're covered from minute one.
#
# Usage (on the VPS): bash /root/learning-platform/infra/contabo/setup-backups.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/root/learning-platform}"
SCRIPT="$APP_DIR/infra/contabo/backup.sh"
LOG="/root/backups/backup.log"

chmod +x "$SCRIPT"
mkdir -p /root/backups

# Idempotent cron install.
CRON_LINE="15 3 * * * APP_DIR=$APP_DIR bash $SCRIPT >> $LOG 2>&1"
( crontab -l 2>/dev/null | grep -vF "$SCRIPT" ; echo "$CRON_LINE" ) | crontab -
echo "[setup-backups] cron installed: $CRON_LINE"

echo "[setup-backups] running first backup now…"
APP_DIR="$APP_DIR" bash "$SCRIPT"

echo ""
echo "[setup-backups] done. Recommended next steps:"
echo "  1. Copy the newest env-prod-* file somewhere OFF this server (it holds LP_SECRETS_KEY)."
echo "  2. Optional offsite: 'apt install rclone && rclone config' → create a remote named 'offsite'"
echo "     (Cloudflare R2 works well; free egress). The nightly job syncs automatically once it exists."
