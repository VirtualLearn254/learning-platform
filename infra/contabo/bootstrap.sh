#!/usr/bin/env bash
# bootstrap.sh — one-shot VPS bootstrap.
#
# Run from the Contabo web console (or any root shell):
#   curl -fsSL https://raw.githubusercontent.com/VirtualLearn254/learning-platform/main/infra/contabo/bootstrap.sh | bash
#
# Idempotent — safe to re-run. Installs docker + git if missing, clones (or
# pulls) the repo, generates .env.prod with random secrets on first run,
# then builds + starts the docker compose stack.

set -euo pipefail

REPO_URL="https://github.com/VirtualLearn254/learning-platform.git"
APP_DIR="/root/learning-platform"
COMPOSE_FILE="docker-compose.prod.yml"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[1;32m[OK]\033[0m %s\n' "$*"; }
warn() { printf '    \033[1;33m[warn]\033[0m %s\n' "$*"; }

# ── 1. Install prerequisites if missing ─────────────────────────────
log "checking prerequisites"
if ! command -v docker >/dev/null 2>&1; then
  log "installing docker"
  curl -fsSL https://get.docker.com | sh
else
  ok "docker present: $(docker --version)"
fi
if ! command -v git >/dev/null 2>&1; then
  log "installing git"
  apt-get update && apt-get install -y git
else
  ok "git present: $(git --version)"
fi
if ! command -v openssl >/dev/null 2>&1; then
  apt-get install -y openssl
fi

# ── 2. Clone or pull ────────────────────────────────────────────────
if [ ! -d "$APP_DIR" ]; then
  log "cloning $REPO_URL -> $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
else
  log "pulling latest in $APP_DIR"
  cd "$APP_DIR" && git pull --ff-only
fi
cd "$APP_DIR"
ok "repo at $(git rev-parse --short HEAD)"

# ── 3. Generate .env.prod with random secrets if missing ────────────
# The app's S3 client talks to MinIO over the internal docker network, so we
# point S3_ACCESS_KEY/S3_SECRET_KEY at the MinIO ROOT credentials — that way
# there's only one set of MinIO creds to manage. (For production with R2/AWS,
# you'd replace S3_ENDPOINT + these keys with real cloud credentials.)
if [ ! -f .env.prod ]; then
  log "generating .env.prod with random secrets"
  POSTGRES_PW=$(openssl rand -hex 24)
  MINIO_ROOT_PW=$(openssl rand -hex 24)
  LP_SECRETS=$(openssl rand -hex 32)
  cat > .env.prod <<ENV
POSTGRES_PASSWORD=$POSTGRES_PW
MINIO_ROOT_USER=lp_admin
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PW
LOG_LEVEL=info
API_PORT=3001
LP_SECRETS_KEY=$LP_SECRETS
S3_REGION=us-east-1
S3_BUCKET=learning-platform
S3_ACCESS_KEY=lp_admin
S3_SECRET_KEY=$MINIO_ROOT_PW
S3_FORCE_PATH_STYLE=true
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
VLLM_BASE_URL=
VLLM_API_KEY=
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
XTTS_BASE_URL=
VLM_BASE_URL=
HERMES_RPC_URL=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
UNSPLASH_ACCESS_KEY=
PEXELS_API_KEY=
PIXABAY_API_KEY=
ENV
  chmod 600 .env.prod
  ok ".env.prod created (secrets are random — view with: cat $APP_DIR/.env.prod)"
else
  ok ".env.prod already exists — keeping existing secrets"
  # Back-fill LP_SECRETS_KEY for older installs that pre-date the UI secrets manager.
  if ! grep -q '^LP_SECRETS_KEY=' .env.prod; then
    LP_SECRETS=$(openssl rand -hex 32)
    echo "LP_SECRETS_KEY=$LP_SECRETS" >> .env.prod
    ok "added LP_SECRETS_KEY to existing .env.prod (32 random bytes — back up this file)"
  fi
  # ALWAYS sync S3_ACCESS_KEY/S3_SECRET_KEY to MINIO_ROOT_USER/MINIO_ROOT_PASSWORD,
  # because the random S3 creds the early bootstrap generated were never known
  # to MinIO and silently broke uploads.
  MINIO_USER=$(grep '^MINIO_ROOT_USER=' .env.prod | cut -d= -f2-)
  MINIO_PW=$(grep '^MINIO_ROOT_PASSWORD=' .env.prod | cut -d= -f2-)
  CURRENT_S3_KEY=$(grep '^S3_ACCESS_KEY=' .env.prod | cut -d= -f2- || echo "")
  ENV_PROD_CHANGED=0
  if [ -n "$MINIO_USER" ] && [ -n "$MINIO_PW" ] && [ "$CURRENT_S3_KEY" != "$MINIO_USER" ]; then
    log "syncing S3_ACCESS_KEY / S3_SECRET_KEY to MinIO root credentials"
    # Use a different delimiter for sed since secrets may contain /
    sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$MINIO_USER|" .env.prod
    sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$MINIO_PW|" .env.prod
    ENV_PROD_CHANGED=1
    ok "S3 credentials now match MinIO root"
  fi
fi

# ── 4. Build + start ────────────────────────────────────────────────
log "building + starting docker compose stack (first build = 5-10 min)"
docker compose -f "$COMPOSE_FILE" up -d --build

# Docker Compose doesn't always notice env_file CONTENT changes (only path
# changes). If we modified .env.prod above, force-recreate the services that
# depend on those env vars so they actually pick up the new values.
if [ "${ENV_PROD_CHANGED:-0}" = "1" ]; then
  log "force-recreating api + workers to pick up updated .env.prod"
  docker compose -f "$COMPOSE_FILE" up -d --force-recreate --no-deps api workers
fi

# ── 5. Wait for api to be healthy + run schema push ─────────────────
log "waiting for postgres to be ready"
for i in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U lp -d learning_platform >/dev/null 2>&1; then
    ok "postgres ready"
    break
  fi
  sleep 2
done

log "pushing schema"
# drizzle-kit 0.30 has interactive prompts that don't work over `exec -T`.
# `--force` (in the script) skips confirmation; piping `yes` is a safety net
# in case any other y/n prompt appears.
docker compose -f "$COMPOSE_FILE" exec -T api sh -c "yes | npm run db:push" || warn "db:push had a non-zero exit — check logs"

# ── 6. Final status ─────────────────────────────────────────────────
log "stack status"
docker compose -f "$COMPOSE_FILE" ps

VPS_IP=$(curl -s --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')
echo
ok "deploy complete"
echo
echo "    dashboard:      http://$VPS_IP/"
echo "    api healthcheck: http://$VPS_IP/healthz"
echo "    minio console:  http://$VPS_IP/minio-console/"
echo
echo "    to view logs:   docker compose -f $APP_DIR/$COMPOSE_FILE logs -f api"
echo "    to redeploy:    cd $APP_DIR && git pull && docker compose -f $COMPOSE_FILE up -d --build"
