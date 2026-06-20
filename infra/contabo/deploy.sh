#!/usr/bin/env bash
# deploy.sh — one-command deploy from your laptop to the Contabo VPS.
#
# Run locally (not on the VPS):
#   ./infra/contabo/deploy.sh user@vps-ip
#
# What it does:
#   1. rsync the repo over (excludes node_modules, .next, etc.)
#   2. SSH in and rebuild + restart the docker compose stack
#   3. Tail logs until the api healthcheck passes

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 user@vps-ip"
  exit 1
fi

REMOTE="$1"
REMOTE_DIR="${REMOTE_DIR:-/home/lp/app}"

echo "==> [1/3] syncing code → $REMOTE:$REMOTE_DIR"
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude 'captures' \
  --exclude '.git' \
  --exclude 'out' \
  ./ "$REMOTE:$REMOTE_DIR/"

echo "==> [2/3] rebuilding + restarting stack"
ssh "$REMOTE" "cd $REMOTE_DIR && \
  docker compose -f docker-compose.prod.yml up -d --build && \
  docker compose -f docker-compose.prod.yml exec -T api npm run db:push"

echo "==> [3/3] healthcheck"
HOST="${REMOTE#*@}"
for i in $(seq 1 30); do
  if curl -fsS "http://$HOST/healthz" >/dev/null 2>&1; then
    echo "    ✓ alive at http://$HOST/"
    exit 0
  fi
  sleep 2
done

echo "    ✗ healthcheck did not pass within 60s. Check logs:"
echo "        ssh $REMOTE 'docker compose -f $REMOTE_DIR/docker-compose.prod.yml logs --tail 100'"
exit 1
