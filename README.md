# learning-platform

Internal video-lesson production platform. Wraps the `hyperframes-pipeline` render engine and the `audit-toolkit` QA engine with a UI, course state machine, queues, storage, analytics, and a Hermes-driven evolution loop.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 + Tailwind + shadcn/ui |
| Backend | Hono (TypeScript), Drizzle ORM |
| DB | Postgres |
| Queue | BullMQ + Redis |
| Storage | S3-compatible (MinIO locally, R2 or MinIO in prod) |
| AI | vLLM (local GPU) → OpenAI / DeepSeek fallbacks |
| TTS | Coqui XTTS-v2 (local GPU) |
| Vision | Qwen2-VL (local GPU) |
| Agent runtime | Nous Research hermes-agent (cron + notifications + evolution loop) |
| GPU host | Runpod A100 pod |

## Quick start (dev)

```bash
# 1. install deps
npm install

# 2. copy env
cp .env.example .env

# 3. start Postgres + Redis + MinIO (local stack)
npm run dev:db

# 4. push DB schema
npm run db:push

# 5. start web + api with hot reload
npm run dev
```

- Web: <http://localhost:3000>
- API: <http://localhost:3001>
- MinIO console: <http://localhost:9001> (lp_dev / lp_dev_password_minio)

## Repository layout

```
learning-platform/
├── apps/
│   ├── web/                # Next.js frontend (dashboard, Kanban, beat review)
│   └── api/                # Hono backend + workers
├── packages/
│   ├── shared/             # Types + Zod schemas used by both apps
│   ├── ai-provider/        # vLLM / OpenAI / DeepSeek abstraction
│   ├── render-engine/      # Wraps hyperframes-pipeline (placeholder)
│   └── scorm-packager/     # SCORM 2004 + xAPI emitter (placeholder)
├── infra/
│   └── runpod/             # Pod provision scripts
└── docs/                   # DEV.md, ARCHITECTURE.md, ROADMAP.md
```

## Roadmap

See `docs/ROADMAP.md`. Current phase: **P0 — provider migration + GPU setup**.
