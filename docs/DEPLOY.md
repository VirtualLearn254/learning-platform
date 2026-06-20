# Deploy guide — Contabo VPS

Single-VPS production deploy. Everything (web, API, workers, Postgres, Redis, MinIO, Caddy) runs in Docker on one box. No domain required — access via VPS IP or Tailscale.

## Sizing

For this app + 10 courses/month + future GPU offload to Runpod:

| Contabo plan | Specs | Fits? |
|---|---|---|
| VPS S | 4 vCPU · 8 GB RAM · 200 GB | Yes (might be tight during builds) |
| **VPS M** | **6 vCPU · 16 GB RAM · 400 GB** | **Recommended** — comfortable headroom |
| VPS L | 8 vCPU · 30 GB RAM · 800 GB | Overkill for single-tenant |

Pick **VPS M** with Ubuntu 22.04 LTS.

## One-time provisioning

```bash
# After ordering, you'll get an IP + root password by email.
ssh root@<contabo-ip>

# Run the provisioner (Docker + UFW + Tailscale + non-root user + swap)
curl -fsSL https://raw.githubusercontent.com/<your-org>/learning-platform/main/infra/contabo/provision.sh | bash
# OR: scp + run locally
#   scp infra/contabo/provision.sh root@<vps-ip>:/root/
#   ssh root@<vps-ip> bash /root/provision.sh

# Authenticate Tailscale (recommended for encrypted team access)
tailscale up --ssh
# Open the URL it prints, sign in. The VPS joins your tailnet.
```

## First deploy

From your laptop:

```bash
# 1. Push the code + build + restart
./infra/contabo/deploy.sh lp@<vps-ip>

# 2. On the VPS, create the production env file (only the first time)
ssh lp@<vps-ip>
cd ~/app
cp .env.prod.example .env.prod
nano .env.prod                # set POSTGRES_PASSWORD + MINIO_ROOT_PASSWORD

# 3. Re-deploy so the new env takes effect
./infra/contabo/deploy.sh lp@<vps-ip>

# 4. Seed the DB (one-time, optional but useful)
ssh lp@<vps-ip> "cd ~/app && docker compose -f docker-compose.prod.yml exec -T api npm run db:seed"
```

Now hit it:

- Public: `http://<vps-ip>/`
- Tailscale: `http://<vps-tailscale-ip>/`
- Health: `http://<vps-ip>/healthz` → `ok`

## Subsequent deploys

Single command:

```bash
./infra/contabo/deploy.sh lp@<vps-ip>
```

That:
1. rsync's the code
2. Rebuilds + restarts the docker stack
3. Runs `db:push` to apply any schema changes
4. Polls the healthcheck until it's green

## What runs where

| Service | Port (host) | Port (internal) | Notes |
|---|---|---|---|
| Caddy | **80** | — | Only public-facing port |
| web (Next.js) | — | 3000 | Reached via Caddy `/` |
| api (Hono) | — | 3001 | Reached via Caddy `/api/*` |
| workers (BullMQ) | — | — | No HTTP; processes queues |
| postgres | — | 5432 | Internal only |
| redis | — | 6379 | Internal only |
| minio | — | 9000, 9001 | Reached via Caddy `/storage/*` + `/minio-console/*` |

## Operations

| Task | Command |
|---|---|
| Logs (live) | `ssh lp@<vps-ip> docker compose -f ~/app/docker-compose.prod.yml logs -f api` |
| Restart one service | `ssh lp@<vps-ip> docker compose -f ~/app/docker-compose.prod.yml restart api` |
| Stop everything | `ssh lp@<vps-ip> docker compose -f ~/app/docker-compose.prod.yml down` |
| Start everything | `ssh lp@<vps-ip> docker compose -f ~/app/docker-compose.prod.yml up -d` |
| Open DB shell | `ssh lp@<vps-ip> docker compose -f ~/app/docker-compose.prod.yml exec postgres psql -U lp -d learning_platform` |
| Run db migrations | `ssh lp@<vps-ip> docker compose -f ~/app/docker-compose.prod.yml exec api npm run db:push` |

## Backups (recommended)

A simple `pg_dump` + `mc mirror` cron job. The provisioner doesn't set this up; suggested addition for production:

```bash
# /etc/cron.daily/lp-backup
#!/bin/bash
cd /home/lp/app
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U lp learning_platform | gzip > /home/lp/backups/db-$(date +%F).sql.gz
# Then sync /home/lp/backups to R2 / B2 / wherever
```

## Adding a domain later

When you point a domain at the VPS:

1. Update `Caddyfile.prod`: replace `:80 {` with `your-domain.com {` (Caddy auto-issues TLS via Let's Encrypt).
2. Open port 443 in UFW: `sudo ufw allow https`
3. Redeploy: `./infra/contabo/deploy.sh lp@<vps-ip>`

That's it — TLS auto-renews.

## Troubleshooting

| Symptom | Likely fix |
|---|---|
| `docker compose up` fails on first build (OOM) | Add more swap (already provisioned 8 GB) or upgrade plan |
| Web shows "API unreachable" | `docker compose logs api` — likely missing env vars |
| `/healthz` returns 500 | `docker compose logs api postgres` — DB connection issue |
| MinIO console locked out | Reset via env vars and `docker compose up -d minio` |
| Caddy doesn't bind :80 | Something else is on port 80 — `sudo lsof -i :80` |
