# Hermes production bridge

Everything needed to run course production inside Hermes profiles while the
existing app remains the deterministic substrate (rendering, stitching,
packaging, storage, review UI, delivery).

**The architecture in one line: Hermes decides, the app executes.**
Authoring, design steering, quality judgment and orchestration live in
Hermes (skills + subagents + memory); MP4s, zips and state live in the app.

```
hermes/
├── mcp-server/        the bridge — 17 schema-described tools over the app API
├── skills/            shared craft library (all profiles) + subject overlays
│   ├── production-loop/   conductor: beat state machine, subagents, gates
│   ├── author-beat/       narration + visual spec craft rules
│   ├── design-beat/       composition judgment + correction-note format
│   ├── verify-beat/       frame-based adversarial QA
│   ├── quiz-author/       quiz types, option craft, remediation branches
│   ├── render-ops/        driving the machinery, mop-up, outage behavior
│   ├── publish-qa/        post-publish acceptance click-through
│   └── pedagogy-accounting/  subject overlay (pilot; template for others)
├── souls/             SOUL.core.md (every profile) + per-subject overlays
└── memory-seed/       craft lessons to import at profile bootstrap
```

## Wiring a profile (e.g. accounting)

1. **MCP server** — build once, register in the profile's MCP config:
   ```bash
   cd hermes/mcp-server && npm install && npm run build
   ```
   ```json
   {
     "mcpServers": {
       "lp": {
         "command": "node",
         "args": ["/root/learning-platform/hermes/mcp-server/dist/server.js"],
         "env": { "LP_API_BASE": "http://127.0.0.1", "LP_ADMIN_PASSWORD": "…" }
       }
     }
   }
   ```
2. **Skills** — install ALL shared craft skills + exactly one pedagogy
   overlay into the profile's skills directory (symlink from this repo so
   `git pull` updates every profile at once).
3. **Soul** — `SOUL.core.md` + the subject overlay concatenated as the
   profile's SOUL.md.
4. **Memory** — import `memory-seed/craft-lessons.md` as semantic facts at
   bootstrap.
5. **Toolset** — keep it lean: the lp MCP tools + terminal + files + vision
   + browser. Vision is non-negotiable (frame QA); browser is for
   publish-qa.
6. **Scheduler** — a production heartbeat (every 15–30 min while a lesson is
   in flight: check job_status, advance the loop) and a daily digest.

## Two-layer learning (the rule that prevents fragmentation)

- Subject lessons (what analogies land in accounting) → the profile's own
  memory.
- Craft lessons (pacing, overlap, sync, register — true for every subject)
  → PRs against `hermes/skills/*` in this repo, so every profile inherits
  them on the next pull. When the same correction arrives twice, amend the
  skill; don't just remember harder.

## Boundaries that hold regardless of profile

The human gate (human_review, publish clearance) is inviolable; provider
outages halt dispatch and get reported; retry budgets (2 corrections,
2 revisions per beat) end in escalation, not loops; no overlapping/cropped
text ever ships. These live in SOUL.core.md — human-edited only.

## Pilot plan

Run ONE profile (accounting) through ONE full lesson end-to-end. Measure:
cost/beat (target ≤$0.40), human corrections needed, wall-clock. Compare
against the current engine (~$0.10/beat, one-shot, no self-correction)
before fanning out to history / science / geography / business profiles.
