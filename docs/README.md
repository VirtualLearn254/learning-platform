# learning-platform docs

The app's knowledge base. Read this first; everything else links from here.

## Reference

| Doc | When to read it |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Mental model: what services exist, how they talk |
| [AI_ROLES.md](AI_ROLES.md) | What each of the 6 AI roles does, which models to use, how to swap them, cost scenarios |
| [DEPLOY.md](DEPLOY.md) | How the Contabo VPS deploy works end-to-end |
| [DEV.md](DEV.md) | Local dev setup |
| [OPERATIONS.md](OPERATIONS.md) | Day-to-day commands: SSH, redeploy, logs, backup, troubleshooting |
| [ROADMAP.md](ROADMAP.md) | What we've shipped vs what's planned |

## Quick "how do I…?"

| Task | Answer |
|---|---|
| Change which AI model powers a role | UI: `/settings` → "AI roles" card → dropdowns → Save |
| Add an API key for a new provider | UI: `/settings` → "AI providers" card → paste → Save |
| See how much we're spending on AI | UI: `/settings` → "AI usage" card → window selector |
| Deploy a code change | `git push` locally, then `bash learning-platform/infra/contabo/bootstrap.sh` on VPS — [OPERATIONS.md](OPERATIONS.md#deploy-push-code--live) |
| View live logs | [OPERATIONS.md](OPERATIONS.md#view-logs-live-tail) |
| Back up the database | [OPERATIONS.md](OPERATIONS.md#backup--restore) |
| Add a brand-new AI provider | [AI_ROLES.md](AI_ROLES.md#how-to-add-a-new-provider) |
| Restore SSH access | [OPERATIONS.md](OPERATIONS.md#lost-ssh-access) — Contabo web console |
| Understand a build error | [OPERATIONS.md](OPERATIONS.md#bootstrap-fails-with-npm-run-build-typescript-errors) |

## Where the source of truth lives

| Thing | Source |
|---|---|
| DB schema | `apps/api/src/db/schema.ts` (drizzle) |
| AI role defaults | `packages/ai-provider/src/profiles.ts` |
| Model catalog + prices | `packages/ai-provider/src/catalog.ts` |
| Routes | `apps/api/src/routes/*.ts` |
| UI pages | `apps/web/src/app/**/*.tsx` |
| Background workers | `apps/api/src/workers/*.ts` |
| Deploy config | `docker-compose.prod.yml` + `infra/contabo/bootstrap.sh` |

## What's NOT here yet

Things we know about but haven't documented because they don't exist yet in working form:

- **Workers** — currently stubbed. Will need a worker handbook once ingest/author/render are wired
- **Hermes integration** — provider-agnostic agent loop; partial scaffolding in `packages/hermes-bridge`
- **GPU / vLLM setup** — when we add the RunPod-or-local GPU, will add a separate `GPU.md`
- **SCORM / LMS export** — `packages/scorm-packager` exists but isn't wired into a worker yet

When any of these land, add a doc here.
