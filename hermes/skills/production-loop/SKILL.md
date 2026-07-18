---
name: production-loop
description: The conductor procedure — drive a lesson's beats through author → design/render → verify → human gate, spawning one subagent per beat-step, in parallel within compute limits
---

You are conducting production of one lesson on the substrate (via the lp MCP
tools). You decide and delegate; the substrate renders and stores. The beats
table IS the state machine — never keep authoritative production state
anywhere else.

## The per-beat pipeline

```
ingested → [author-sub: script+visualSpec+quiz] → update_beat
        → [verify-sub: review the WRITING before paying to render]
        → render_beat → wait (3–6 min; check job_status, don't tight-poll)
        → [verify-sub: get_keyframes → get_frame × 3+ → judge]
             ├─ pass        → submit_review(approve) …beat proceeds to human gate
             ├─ visual bug  → render_beat(correctionNote) — max 2 corrections/beat
             └─ script flaw → revise via author-sub, then re-render
        → HUMAN GATE (human_review) — STOP. Not yours to pass.
```

## Orchestration rules

- **One subagent, one beat-step.** Fresh context per task; pass in only that
  beat's data plus the relevant skill. Never let one subagent touch two beats.
- **Parallelism**: author/verify subagents — up to 6 concurrent (cheap).
  Renders — the substrate VPS sustains **2 concurrent**; queue the rest.
  Pipeline, don't batch: beat A can render while beat B authors.
- **Waiting**: renders take 3–6 min. Move to another beat's work; check
  job_status when you come back. Never spin a polling loop.
- **Stitch** only when every main beat has an mp4 and has passed verify.
  **Publish** only after the human has cleared human_review AND you have run
  generate_notes and (for quizzed lessons) generate_branches.
- **Retries have a budget**: 2 correction re-renders per beat, 2 authoring
  revisions per beat. A beat that exhausts both is ESCALATED to the human with
  frames and your diagnosis — never loop it silently.
- **Failures fail loud**: a render job that errors with provider/quota
  messages is an OUTAGE — stop dispatching renders, report it. Never absorb
  it by degrading quality.

## Cost discipline

Target ≤ $0.40 per finished beat including retries. Use scripts (RPC) for
mechanical spans — downloading frame sets, checking many job statuses —
instead of one loop turn per step. Reasoning is for decisions only.

## Learning

Every human correction that reaches you (a revise reason, an edit diff, a
rejected beat) is a lesson. Deposit it: subject-specific → this profile's
memory; craft-general (pacing, overlap, register, sync) → flag it for the
shared craft library so every profile inherits it.
