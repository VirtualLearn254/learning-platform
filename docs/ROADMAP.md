# Roadmap

Phased build plan. Each phase ships a working slice. We update this doc as we learn.

## P0 — Scaffolding + provider migration (CURRENT)

**Goal:** monorepo bootstrapped; AI provider abstraction in place; local dev workflow fast and obvious.

- [x] Monorepo + workspaces + tsconfig
- [x] Docker compose for Postgres + Redis + MinIO
- [x] `@lp/shared` types + Zod schemas
- [x] `@lp/ai-provider` with vLLM / OpenAI / DeepSeek backends + profiles
- [x] `apps/api` Hono server + Drizzle schema + initial routes (courses, beats, health)
- [x] `apps/web` Next.js 15 + Tailwind v4 + dashboard placeholder
- [x] Runpod provision script
- [x] DEV.md + ARCHITECTURE.md
- [ ] **You: install + boot the stack** (`npm install && npm run dev:db && npm run db:push && npm run dev`) — confirm dashboard loads + health endpoint reports OK
- [ ] **You: provision the Runpod pod** with `infra/runpod/provision.sh`
- [ ] **Me: port the existing hyperframes-pipeline author/review code into `packages/render-engine`** to call `@lp/ai-provider` (replaces every `claude -p`)
- [ ] Reference render — pick a small existing lesson, regenerate it on the new stack, compare quality

## P1 — Vertical slice MVP

**Goal:** upload a document → produce a SCORM-ready lesson, with humans reviewing beats in a Kanban.

- [ ] Upload UI (drag-drop into a course) + MinIO storage
- [ ] Ingest worker: PDF/DOCX → text → AI decomposes into modules/sections/lessons/beats outline
- [ ] Authoring worker (calls render-engine via queue)
- [ ] AI review worker
- [ ] Human review UI: render the beat's MP4 in a player, accept/revise/reject, attach screenshots
- [ ] Render worker (wraps hyperframes-pipeline)
- [ ] Stitch worker
- [ ] Kanban board: columns = stages, cards = beats with progress + ETA
- [ ] Queue retry + dead-letter queue (production-quality from MVP)
- [ ] Real-time updates via SWR polling (Supabase realtime later if needed)

## P2 — Storage + LMS export + analytics

- [ ] Postgres data model finalized + first proper migrations
- [ ] R2/MinIO bucket layout
- [ ] Branded PDF generation (Puppeteer + React PDF template)
- [ ] SCORM 2004 packager (`scorm-again` + custom manifest)
- [ ] xAPI LRS endpoint (collects events from player inside Moodle)
- [ ] Moodle Web Service client + "Publish to Moodle" button
- [ ] Analytics dashboards: per-learner, per-course, per-beat replay heatmap
- [ ] PDF + MP4 + SCORM download buttons

## P3 — Intelligence + integrations

- [ ] Hermes agent integration (cron jobs + Telegram notifications)
- [ ] Image search providers (Unsplash + Pexels + Pixabay) + AI image picker
- [ ] "Reference earlier concept" callback feature (concept dependency graph + player button)
- [ ] WhatsApp notifications via Hermes gateway
- [ ] Accessibility: VTT captions exported alongside MP4
- [ ] Concept dependency graph rendered in UI (per-course knowledge map)

## P4 — Polish + production hardening

- [ ] Docker images for web + api
- [ ] Caddy for TLS + reverse proxy
- [ ] Backup automation (pg_dump + mc mirror)
- [ ] Observability: structured logs + Grafana
- [ ] CI: GitHub Actions runs typecheck + tests + builds images
- [ ] First real test suite (Vitest)
- [ ] Proper migration generation (`drizzle-kit generate`)

## P5 — Differentiation (post-launch nice-to-haves)

- [ ] Adaptive course paths based on quiz performance
- [ ] Active recall pushes via Telegram (spaced repetition reminders)
- [ ] Multilingual: scripts → translations → re-TTS → re-render
- [ ] Searchable transcripts with timestamp jump
- [ ] A/B test beats — measure which variant lands better
- [ ] Webhook bus for arbitrary integrations
