# Operations cheat sheet

Day-to-day commands you'll actually run. Keep this open while operating the app — it's faster than re-deriving the command each time.

> Most things now happen in the UI at `http://<vps-ip>/settings` — only the deploy + container-level ops still need SSH.

---

## Connecting to the VPS

```bash
ssh root@178.238.231.100
```

Password is in your Contabo welcome email. If you've forgotten it: log in to **my.contabo.com → Your Services → VPS → Password reset**.

The app lives at `/root/learning-platform`.

---

## Deploy (push code → live)

**On your laptop, in `E:\learning-platform`:**

```bash
git add -A
git commit -m "your message"
git push
```

**Then on the VPS:**

```bash
bash learning-platform/infra/contabo/bootstrap.sh
```

That command:
1. `git pull`s the latest code
2. Rebuilds Docker images (most layers cached — usually 2-5 min)
3. Restarts containers
4. Pushes new DB schema if any
5. Prints the URLs

Cached layer reuse is per-content, so unchanged files = instant. A worker-only change won't rebuild the web image, etc.

---

## Live URLs

| URL | What it is |
|---|---|
| `http://178.238.231.100/` | Dashboard (web UI) |
| `http://178.238.231.100/settings` | All AI provider + role + usage config |
| `http://178.238.231.100/healthz` | Should return `ok` |
| `http://178.238.231.100/api/courses` | Should return `{"courses":[...]}` |
| `http://178.238.231.100/minio-console/` | Object storage browser (login with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` from `.env.prod`) |

---

## Common SSH-once tasks

### View logs (live tail)

```bash
# All services
docker compose -f /root/learning-platform/docker-compose.prod.yml logs -f --tail=100

# Just the API
docker compose -f /root/learning-platform/docker-compose.prod.yml logs -f api

# Just the workers
docker compose -f /root/learning-platform/docker-compose.prod.yml logs -f workers
```

Ctrl+C to stop tailing.

### Restart a single service (without full rebuild)

```bash
docker compose -f /root/learning-platform/docker-compose.prod.yml restart api
```

Useful for: env var change, hung process. **Not needed** for AI role/key changes — those take effect on the next call.

### Restart everything

```bash
cd /root/learning-platform
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d
```

### Check container health

```bash
docker compose -f /root/learning-platform/docker-compose.prod.yml ps
```

Healthy = `Up X minutes (healthy)`. Unhealthy or `Restarting` = check the logs.

### Open the Postgres shell

```bash
docker compose -f /root/learning-platform/docker-compose.prod.yml exec postgres psql -U lp -d learning_platform
```

Useful queries:

```sql
-- Recent AI usage
SELECT ts, profile_id, provider_id, model_id, input_tokens, output_tokens, cost_usd, duration_ms
FROM ai_usage
ORDER BY ts DESC
LIMIT 20;

-- Total spend by day
SELECT date_trunc('day', ts) AS day, SUM(cost_usd) AS cost, COUNT(*) AS calls
FROM ai_usage
GROUP BY day
ORDER BY day DESC;

-- All active profile overrides
SELECT * FROM ai_profile_overrides;

-- Which secrets are configured (no decryption, just metadata)
SELECT name, last_four, updated_at FROM app_secrets;

-- Course tree
SELECT c.title, COUNT(DISTINCT l.id) AS lessons, COUNT(b.id) AS beats
FROM courses c
LEFT JOIN sections s ON s.course_id = c.id
LEFT JOIN modules m ON m.section_id = s.id
LEFT JOIN lessons l ON l.module_id = m.id
LEFT JOIN beats b ON b.lesson_id = l.id
GROUP BY c.id, c.title;
```

`\q` to exit psql.

### Apply schema changes manually

```bash
docker compose -f /root/learning-platform/docker-compose.prod.yml exec -T api sh -c "yes | npm run db:push"
```

Normally the bootstrap does this for you. Run it manually if you've edited `schema.ts` and want to push it without a full redeploy.

### Seed demo data

```bash
docker compose -f /root/learning-platform/docker-compose.prod.yml exec api npm run db:seed
```

Useful after the first deploy to populate a few demo courses + lessons.

---

## Backup + restore

### Daily backup (run this from cron or manually)

```bash
mkdir -p /root/backups
docker compose -f /root/learning-platform/docker-compose.prod.yml exec -T postgres \
  pg_dump -U lp learning_platform | gzip > /root/backups/db-$(date +%F).sql.gz
```

To run nightly, add to `/etc/cron.daily/lp-backup`:

```bash
#!/bin/bash
mkdir -p /root/backups
docker compose -f /root/learning-platform/docker-compose.prod.yml exec -T postgres \
  pg_dump -U lp learning_platform | gzip > /root/backups/db-$(date +%F).sql.gz
# Keep last 14 days
find /root/backups -name "db-*.sql.gz" -mtime +14 -delete
```

`chmod +x /etc/cron.daily/lp-backup`

### Restore from a backup

```bash
gunzip -c /root/backups/db-2026-06-28.sql.gz | \
  docker compose -f /root/learning-platform/docker-compose.prod.yml exec -T postgres \
  psql -U lp -d learning_platform
```

### Don't lose the encryption master key

`LP_SECRETS_KEY` in `.env.prod` decrypts all UI-stored API keys. Losing it means re-pasting every key in the UI. To back it up safely:

```bash
grep ^LP_SECRETS_KEY /root/learning-platform/.env.prod
# Copy the value somewhere safe (1Password, encrypted note, etc.)
```

---

## Editing `.env.prod` (almost never needed anymore)

The Settings UI handles AI keys. The only env values you might still edit manually are infrastructure secrets (`POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`) — and those should basically never change.

If you do need to edit:

```bash
nano /root/learning-platform/.env.prod
# Edit, then:
# Ctrl+X → Y → Enter to save
```

Changes take effect after a container restart:

```bash
cd /root/learning-platform && docker compose -f docker-compose.prod.yml restart api workers
```

---

## Troubleshooting

### Bootstrap fails with `npm run build` TypeScript errors

Usually a schema drift between `packages/shared/src/types.ts` and either the DB schema or the web app. Look at the exact error — the file path and line number are in the build log. Fix the type, push, redeploy.

To bypass type-checking temporarily (already enabled in `apps/web/next.config.ts`): set `typescript.ignoreBuildErrors: true`. Currently we have this on.

### Healthcheck fails after deploy

```bash
docker compose -f /root/learning-platform/docker-compose.prod.yml logs --tail=200 api
```

Most likely:
- Missing env var → check `.env.prod` has everything from `.env.prod.example`
- Postgres not ready → wait 30s and check again (sometimes the API starts before pg is up)
- Schema mismatch → run `yes | npm run db:push` manually

### Container keeps restarting

```bash
docker compose -f /root/learning-platform/docker-compose.prod.yml ps
docker compose -f /root/learning-platform/docker-compose.prod.yml logs --tail=200 <service>
```

Look for the last error before the restart. Common: OOM during build, missing env var, schema mismatch.

### Out of disk

```bash
df -h
docker system df
docker system prune -af  # nuke unused images + cache
```

The Docker build cache can balloon to several GB. Pruning is safe — the next build rebuilds layers from scratch (slower, but recovers space).

### Lost SSH access

Contabo web console: **my.contabo.com → Your Services → VPS → Console**. That gives you a browser-based terminal. Reset the root password from the same panel if needed.

### Reset all AI usage history

```sql
-- In psql
TRUNCATE ai_usage;
```

Useful if you switch pricing schemes and want a clean baseline. **Irreversible.**

### Clear all stored API keys (force back-to-env)

```sql
-- In psql
TRUNCATE app_secrets;
```

After this, the app falls back to whatever's in `.env.prod`. You'll need to paste keys again in the Settings UI.

---

## When to do what

| Situation | What to do |
|---|---|
| Change an AI API key | Settings UI — no SSH |
| Swap which model a role uses | Settings UI — no SSH |
| Add a brand-new AI provider | Edit `packages/ai-provider/`, push, redeploy |
| Tune `temperature` for one role | Settings UI |
| App is slow / weird | `docker compose logs -f api workers` — find the error |
| Forgot which port runs what | See [DEPLOY.md](DEPLOY.md) "What runs where" |
| Add a new visual style/template | Edit hyperframes-pipeline (separate repo) and bump the render-engine adapter |
| Push to staging vs prod | We don't have staging yet — every push goes to prod |
