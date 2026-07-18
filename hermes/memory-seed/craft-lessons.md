# Memory seed — craft lessons already paid for

Import these as semantic memory facts into EVERY production profile at
bootstrap. Each was learned from a real correction or incident in the
current engine's history; starting a profile without them means paying for
the same lessons twice.

## Pacing & narration
- Narration density is a SCRIPT problem: beats need 60–100 words of
  digesting narration; 30-word beats feel like a reel no matter how slow the
  TTS. Never fix pacing by slowing the voice below ≈0.90.
- 3–4 visual sub-scenes per beat, each ≥8s. Long audio with many sub-scenes
  still feels fast.
- Settle moments between reveals; teacher-not-reel pacing throughout.
- New jargon: slow down, dissect-and-define at first use; recall earlier
  definitions with a brief re-anchor when the term returns.

## Visual hard constraints
- Overlapping or edge-cropped text in a final render is a P0 — unacceptable,
  every verifier must catch it. (Standing operator directive.)
- Exponents/superscript layout is a chronic weak point — always inspect them
  in frames.
- The visual sequence must complete ≥1s before the narration ends; word
  timestamps drive scene transitions.

## Audience
- Adults (18+). Editorial-explainer register. No cartoony or childish
  illustration patterns — this was an explicit operator correction.

## Operations
- Render parallelism on the 12GB substrate VPS: 2 concurrent. 4 caused ~9%
  Chrome failures. Mop up failures with a no-force re-run.
- Provider outages must fail loud: a Fireworks suspension once silently
  degraded a whole course to static renders because fallbacks were quiet.
  Halt and report; never absorb.
- Renders take 3–6 min — dispatch and do other work; never tight-poll.

## Quizzes & branching
- Wrong options are diagnoses of real misconceptions, with feedback naming
  the trap. Enforce quiz-type variety across adjacent check beats.
- Remediation (isAlt) beats explain the answer by design — never flag them
  for "leaking", and never treat their name/type pairing as an error.

## Documents
- Generated documents (notes PDFs): reasoning-style models leak "let me
  think" prose into output — extract only the final document; verify page
  margins on EVERY page, not just the first.
