#!/usr/bin/env bash
# provision.sh — one-shot setup for a fresh Contabo Ubuntu 22.04 VPS.
#
# Assumes: Contabo VPS-M or larger (4 vCPU, 8 GB RAM minimum).
# Run as root the first time you SSH in:
#
#   ssh root@<contabo-ip>
#   curl -fsSL https://raw.githubusercontent.com/<your-org>/learning-platform/main/infra/contabo/provision.sh | bash
#
# Or scp this file over + run it locally:
#
#   scp infra/contabo/provision.sh root@<contabo-ip>:/root/
#   ssh root@<contabo-ip> bash /root/provision.sh

set -euo pipefail

echo "==> [1/6] system update"
apt-get update -qq
apt-get install -y -qq curl wget git ca-certificates ufw gnupg lsb-release

echo "==> [2/6] firewall (allow SSH, HTTP only)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw --force enable
echo "    UFW configured: SSH + HTTP allowed; everything else denied."

echo "==> [3/6] Docker + Docker Compose"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable docker
systemctl start docker
echo "    Docker $(docker --version) installed."

echo "==> [4/6] Tailscale (encrypted team access)"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
echo "    Tailscale installed. After this script: run 'tailscale up --ssh' to authenticate."

echo "==> [5/6] non-root deploy user 'lp'"
if ! id -u lp >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G docker lp
  echo "    User 'lp' created and added to 'docker' group."
fi
mkdir -p /home/lp/app
chown -R lp:lp /home/lp/app

echo "==> [6/6] swap (8 GB) — recommended for build steps on smaller VPSes"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 8G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    8 GB swap added."
fi

cat <<'NEXT'

═══════════════════════════════════════════════════════════════════════
PROVISION COMPLETE.

Next steps (do as the 'lp' user OR root):

  1. Authenticate Tailscale (recommended for team access):
       tailscale up --ssh

  2. Clone the repo as the 'lp' user:
       su - lp
       cd ~/app
       git clone <your-repo-url> .
       # (or rsync your local copy: rsync -avz ./ lp@<vps-ip>:~/app/)

  3. Create the production env file:
       cp .env.prod.example .env.prod
       nano .env.prod      # set POSTGRES_PASSWORD + MINIO_ROOT_PASSWORD

  4. Boot the stack:
       docker compose -f docker-compose.prod.yml up -d --build

     (First boot takes ~5-8 minutes — building images.)

  5. Run the database schema push (one-time):
       docker compose -f docker-compose.prod.yml exec api npm run db:push
       docker compose -f docker-compose.prod.yml exec api npm run db:seed

  6. Confirm it's running:
       curl http://localhost/healthz                  # → "ok"
       curl http://<vps-ip>/healthz                   # → "ok" (from outside)
       open http://<vps-ip>                           # dashboard

Tailscale users access via the tailnet IP (no public port needed):
       open http://<tailscale-ip-of-vps>

To check service logs:
       docker compose -f docker-compose.prod.yml logs -f api
       docker compose -f docker-compose.prod.yml logs -f workers

To stop:
       docker compose -f docker-compose.prod.yml down

═══════════════════════════════════════════════════════════════════════
NEXT
