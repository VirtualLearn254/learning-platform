# Dev guide

The dev loop is intentionally lean: `npm run dev:db && npm run dev` brings up the whole stack in two commands.

## Prerequisites

- Node.js 22+
- Docker + Docker Compose
- (Eventually) a Runpod pod or local GPU for vLLM. **You don't need this for UI development** — the API will run without AI providers; calls that need them will fail with a clear error.

## First-time setup

```bash
git clone <repo>
cd learning-platform
npm install
cp .env.example .env
npm run dev:db        # start Postgres + Redis + MinIO (containers)
npm run db:push       # create tables from the Drizzle schema
```

## Daily dev

```bash
npm run dev:db        # idempotent — ok to run every time
npm run dev           # boots web (3000) + api (3001) with hot reload
```

Hot reload everywhere:

- **Web** — Next.js Fast Refresh; edit a component, see it instantly.
- **API** — `tsx watch` restarts on file change; ~200 ms boot.
- **Shared types** — `@lp/shared` is a workspace package; types refresh on both sides on save.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Boot web + api together with HMR |
| `npm run dev:db` | Bring up Postgres + Redis + MinIO |
| `npm run dev:db:down` | Tear down the local services |
| `npm run dev:db:logs` | Follow combined Docker logs |
| `npm run db:push` | Sync DB schema (no migration files needed in dev) |
| `npm run db:studio` | Open Drizzle Studio in browser at <http://localhost:4983> |
| `npm run typecheck` | Run `tsc --noEmit` across all workspaces |
| `npm run clean` | Nuke node_modules + .next + dist |

## File layout cheatsheet

```
apps/
├── web/src/app/          Next.js routes (Dashboard, Courses, Kanban)
├── web/src/lib/api.ts    Typed fetch client → /api/* → backend
├── api/src/index.ts      Hono entry — registers routes
├── api/src/routes/       Per-resource HTTP handlers
├── api/src/db/schema.ts  Drizzle schema — source of DB truth
├── api/src/queue/        BullMQ producers (workers added in P1)

packages/
├── shared/src/types.ts   Types used by web AND api
├── shared/src/schemas.ts Zod schemas (runtime validation)
├── ai-provider/src/      vLLM / OpenAI / DeepSeek abstraction
└── ...
```

## Adding a new API route

1. Create `apps/api/src/routes/<resource>.ts` — a `Hono()` chain.
2. Mount it in `apps/api/src/index.ts` (`app.route("/foo", fooRoute)`).
3. Add the corresponding fetcher to `apps/web/src/lib/api.ts`.

## Adding a new DB table

1. Edit `apps/api/src/db/schema.ts`.
2. Run `npm run db:push` — Drizzle pushes the change directly to the dev DB.
3. (In prod we'd generate migrations via `npm run db:generate`; we skip that in dev.)

## Switching AI providers

Edit `packages/ai-provider/src/profiles.ts`. Each profile lists provider preference order + model name per provider. Change the preferred order or model names; the change takes effect on the next API request (no restart needed if `tsx watch` is running).

## Connecting to a Runpod box

Once your Runpod pod is up and authenticated to Tailscale:

1. Set `VLLM_BASE_URL=http://<pod-tailscale-ip>:8000/v1` in `.env`
2. Restart the API
3. Calls in profiles with `preferred: ["local", ...]` now hit the pod

## Common issues

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 5432` on first `npm run dev` | `npm run dev:db` first; wait ~5s for Postgres to be ready |
| `relation "courses" does not exist` | Run `npm run db:push` |
| Web shows "API unreachable" | API hasn't started or crashed; check `apps/api` logs |
| vLLM 404 on chat completion | Model name in `.env` doesn't match what vLLM is serving; check `curl http://<vllm>/v1/models` |

## Production deploy (later)

P4 will add Docker images for web + api, a single `docker-compose.prod.yml`, and Caddy in front for TLS. Not P0-relevant.
