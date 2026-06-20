# Architecture

This document captures the "why" of the technical decisions so future-you (or another contributor) doesn't have to reverse-engineer it.

## One-paragraph orientation

The system takes uploaded course material (PDFs, docs) and produces SCORM-packaged video lessons with interactive quizzes for distribution via Moodle. It wraps the existing `hyperframes-pipeline` render engine and `audit-toolkit` QA engine with a web UI, course/beat state machine, queues, structured storage, learner analytics, and a Hermes-driven nightly evolution loop. AI work runs on a self-hosted GPU (Runpod) via vLLM, with OpenAI/DeepSeek as cloud fallbacks. Single-tenant, internal-only.

## Component map

```
┌────────────────────┐
│ Next.js frontend   │  Upload UI · Kanban board · Beat review UI · Player · Dashboards
└─────────┬──────────┘
          │ fetch /api/*   (Next dev rewrite → API at :3001)
┌─────────▼──────────┐
│ Hono backend       │  CRUD · Job dispatch · RPC for Hermes · Webhooks · SCORM packager
└──┬──────────┬──────┘
   │          │
   │  ┌───────▼──────────┐
   │  │ BullMQ + Redis   │  Per-stage queues: ingest, author, ai_review, render, stitch, audit
   │  └────────┬─────────┘
   │           │
   │   ┌───────▼─────────────────────────┐
   │   │ Workers (Node processes)         │
   │   │ • Ingest worker                  │
   │   │ • Author worker                  │
   │   │ • AI review worker               │
   │   │ • Render worker (wraps HF)       │
   │   │ • Stitch worker                  │
   │   │ • Audit worker (wraps toolkit)   │
   │   │ • SCORM packager                 │
   │   └──────────┬──────────────────────┘
   │              │
┌──▼──────────┐   │   ┌────────────────────────────┐
│ Postgres    │   │   │ GPU host (Runpod A100)     │
│ Drizzle ORM │   │   │ • vLLM (Qwen2.5-32B)       │
└─────────────┘   │   │ • XTTS-v2 (TTS)            │
                  │   │ • Qwen2-VL (vision)        │
                  │   │ • ComfyUI (image gen, P3)  │
                  │   └──────────┬─────────────────┘
                  │              │
                  │   ┌──────────▼─────────────────┐
┌────────────┐    │   │ @lp/ai-provider abstraction│
│ MinIO / R2 │◄───┘   │ vLLM → DeepSeek → OpenAI   │
│ (assets)   │        └────────────────────────────┘
└────────────┘
```

## Why each major choice

### Monorepo with npm workspaces (not Turborepo, not pnpm)

- Workspaces are stdlib, zero config. Turbo's caching helps in CI; we don't have one yet.
- pnpm is faster, but Node 22 + npm workspaces are fast enough at our scale.
- Shared types between `apps/web` and `apps/api` live in `packages/shared` and update instantly without a build step.

### Hono on the backend (not Express, not Fastify, not NestJS)

- Hono's runtime is tiny and the HMR experience with `tsx watch` is excellent.
- It runs on Node, Bun, Cloudflare Workers — gives us deployment flexibility later.
- Built-in Zod validator integration via `@hono/zod-validator` matches our shared schemas.
- NestJS would over-engineer for an internal tool.

### Drizzle (not Prisma)

- TypeScript types come from the schema directly; no generation step.
- Smaller bundle, faster cold starts.
- SQL escape hatches are easier when we want them.
- Prisma's runtime is heavy and codegen slows the dev loop.

### Tailwind v4 + shadcn/ui

- Copy-paste components > opaque library. We own the markup; we can modify it.
- v4 is faster to build than v3 and the new `@theme` syntax keeps tokens in one place.
- The same tokens we use here (cream/ink/teal/terracotta) are the tokens the lesson player uses — visual continuity.

### BullMQ + Redis (not Inngest, not a custom solution)

- Mature, observable, well-documented.
- The previous pipeline iteration considered it (task #95); this is the right time to actually adopt it.
- One Redis instance, multiple queues = clean per-stage observability.
- Inngest's developer experience is nicer but vendor-locked; BullMQ runs anywhere we run.

### Single host for production deploy

For an internal tool with ~10 courses/month:
- GPU host runs: web + api + Postgres + Redis + MinIO + vLLM + XTTS + Qwen2-VL + workers.
- Network hops between services are unnecessary at this scale.
- Backup = `pg_dump` + `mc mirror` to off-host storage.
- Tailscale gives team members SSH/web access without exposing ports.

When we outgrow this, the natural split is: keep web/api/Postgres on a small VPS, move inference + workers to a larger GPU host. The code doesn't need to change for that — just env vars.

### SCORM-wraps-our-player (not Moodle's native player)

Moodle's built-in video player can't do:
- Our custom quiz overlay
- Branching scenarios with alt beats
- The "reference earlier concept" callback button
- xAPI emission for our custom event types

A SCORM 2004 package is just a zip of HTML + assets that Moodle loads in an iframe. We package the existing `web/player.html` + `quiz-overlay.js` + the lesson MP4s + manifest. Inside the iframe our player runs with all our features intact, and emits xAPI statements to our LRS endpoint.

## State machine: a beat's lifecycle

```
queued
  ↓ (ingest worker creates beats from outline)
ingested
  ↓ (author queue → AI generates HTML)
authoring
  ↓ (success)
ai_review
  ↓ (AI review pass)
human_review ─── feedback: revise ───┐
  │                                   │
  │ feedback: approve                 ↓
  ↓                                 revising ─── author re-run ──> ai_review
approved
  ↓ (when all beats in lesson are approved → stitch queue)
rendering          (MP4 written by HF)
  ↓
stitched           (master MP4 ready, audit kicks in)
  ↓ (audit passes)
published          (SCORM package ready)
```

Each transition writes a row to the `jobs` table for observability; the web UI subscribes (via SWR polling for now; Supabase realtime later if we go that direction) and updates the Kanban board.

## What's deliberately not in P0

- **Auth** — single-tenant + internal, behind Tailscale. We add basic session auth in P1 if needed; full RBAC never (not warranted).
- **CI/CD** — we'll add GitHub Actions in P4. Until then: `npm run typecheck && npm run dev` is the test.
- **Tests** — deferred to P2 once the data model stops moving.
- **Observability** — `console.log` is fine for dev. Grafana stack in P4.
- **Migrations** — `drizzle-kit push` in dev; we generate proper migrations in P4.
- **Multi-tenancy** — locked out at the data model level; would require a tenant_id column on every table. Not happening.

## Files of interest when ramping up

1. `apps/api/src/db/schema.ts` — the data model. Start here.
2. `packages/ai-provider/src/profiles.ts` — what AI does what.
3. `apps/api/src/queue/index.ts` — the job pipeline shape.
4. `packages/shared/src/types.ts` — the wire format.
5. `apps/api/src/index.ts` — backend entry, route registry.
6. `apps/web/src/app/page.tsx` — frontend entry, dashboard.
