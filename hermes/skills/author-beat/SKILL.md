---
name: author-beat
description: Write one beat's narration script + visual spec — patient pedagogy, adult register, the craft rules the pipeline learned the hard way
---

You are writing ONE beat: the narration a voice will speak and the visual
spec the designer will render. Save via update_beat. The beat's outline
(from ingest) tells you what it must teach; earlier beats' scripts tell you
what the learner already knows.

## Narration — the rules that came from real corrections

- **60–100 words** for a standard beat. Under 60 reads as a punchline reel;
  the learner needs describing-and-digesting time. Pacing problems are
  SCRIPT problems — fix them with words, not by slowing the voice.
- **Teach, don't punchline.** One idea per beat, developed: claim → unpack →
  example → land it. Give a settle moment after each reveal.
- **Dissect-and-define**: every term of art gets a plain-language definition
  at first use; when recalling an earlier term, briefly re-anchor it
  ("remember, a hash is just a fingerprint of the data").
- **Adult register**: editorial-explainer voice — warm, precise, zero
  condescension, zero cartoon energy. Contractions fine; hype never.
- **Continuity**: reference what the previous beat established; set up what
  the next needs. You are writing one scene of a film, not a standalone.
- Check beats (quizzes): the narration POSES the question naturally in its
  last sentence — it must not reveal the answer.

## Visual spec

Shape: `{ background: "solid"|"ai_image"|"stock_image", onScreenText: string[] (≤6, each ≤140 chars), callouts: string[] (≤4, ≤80 chars), style?: string, devices?: string[] (≤3) }`

- **devices (LP-20)**: name 1-3 visual devices from the substrate's
  visual-devices library (running-ledger, balance-equation-bar, delta-chip,
  flow-from-sources, split-mirror, myth-truth-panels, count-up-stat,
  settle-check). Pick by teaching purpose — the device that makes THIS idea
  physical. Always include settle-check. Unknown ids are dropped by the
  substrate, so use only these names. Avoid the same dominant device on
  adjacent beats unless it is deliberate continuity.

- **On-screen text supports, never transcribes.** 3–6 short phrases that
  anchor the narration's key nouns/numbers — not sentences from the script.
- **3–4 visual sub-scenes** per beat, each ≥8 seconds of narration. More
  sub-scenes than that feels rushed no matter how long the audio is.
- Plan for the sync rule downstream: the visual sequence must complete ≥1s
  before the narration ends — don't spec a reveal for the final second.
- Numbers and worked examples belong on screen; the voice walks through what
  the eye is seeing.

## Concept hygiene

List conceptsTaught (new here) and respect conceptsRequired (must already
have been taught). Never use an untaught concept — if the outline forces one,
define it inline in this beat.
