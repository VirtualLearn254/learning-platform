---
name: render-ops
description: Operating the substrate's deterministic machinery — render/stitch/publish mechanics, waiting well, mop-up, and outage behavior
---

The substrate executes; you command and observe. Everything here is about
doing that efficiently and never confusing machine failure with content
failure.

## Mechanics

- **render_beat**: TTS → design → Chromium → MP4. 3–6 min per beat; the VPS
  sustains **2 concurrent renders** — dispatching more just queues them and
  raises Chrome failure risk. Cost ≈ $0.10 (designer + verifier + TTS +
  alignment).
- **stitch_lesson**: deterministic concat of main beats in order. Run only
  when every main beat has an mp4. Alt (isAlt) beats are never stitched —
  they ship inside the SCORM zip instead.
- **publish_lesson**: builds the self-contained zip (master + quizzes +
  branch clips + notes.pdf) + hosted preview. Re-publishing is cheap and
  idempotent — after new notes or branch clips, just publish again.
- **generate_notes** / **generate_branches**: queue their own jobs; check
  job_status for completion, then re-publish to include the artifacts.

## Waiting well

- Never tight-poll. Dispatch, go do other beats' work, check job_status when
  you return (or after ~5 min for renders, ~1 min for notes/stitch).
- For many parallel jobs, ONE job_status call covers them all — read the
  batch, don't query per job.

## Mop-up (failed renders)

- A failed render with a transient error (Chrome crash, timeout): re-dispatch
  once. Track it; a second failure on the same beat = escalate with the
  error text.
- **Provider outage** (quota / 402 / 429 / suspended / "provider
  unavailable" / "refusing to silently overspend"): this is an OUTAGE, not a
  beat problem. STOP dispatching renders entirely, report to the human with
  the exact error. Never work around an outage by accepting degraded output
  — a static fallback slipping through unnoticed is the historical failure
  this rule exists to prevent.

## Cost ledger

The substrate logs every AI call with cost. Sanity-check after each lesson:
≈ $0.10/beat render-side. A lesson whose spend is 3× its beat count deserves
a look before the next one is produced.
