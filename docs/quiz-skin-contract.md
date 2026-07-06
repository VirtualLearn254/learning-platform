# Quiz Skin Contract

Quizzes in this platform are split into two layers:

- **Essence (fixed)** — the quiz engine in `@lp/scorm-packager`: interaction
  semantics, grading, feedback flow, drag mechanics, auto-fit, seek-gate
  integration. Never regenerated. The 19 styles in the gallery are the
  reference catalog of essences.
- **Presentation (per lesson)** — a **quiz skin**: CSS generated at
  production time by the designer AI from the lesson's design brief, so
  quizzes align with the lesson's video beats in branding, fonts, sizes,
  and backgrounds. Injected after the base scene CSS as
  `<style id="quiz-skin">`. The palette-variable default styling is the
  guaranteed fallback whenever a skin is absent or fails lint.

## The class contract (stable — treat like the HF data-* clip contract)

Scene shell:

| Selector | Role |
|---|---|
| `.quiz-scene` | full-stage scene root; palette vars `--q-bg --q-ink --q-muted --q-accent --q-surface --q-line --q-accent-soft --q-accent-faint --q-btn-ink` live here |
| `.qz-frame` | the centered 16:9 content frame (padding, vertical rhythm) |
| `.qz-deco` | decorative background numeral (bleeds off-frame by design) |
| `.qz-rule` | accent rule bar above the eyebrow |
| `.qz-eyebrow` | small-caps type label ("TRUE OR FALSE?") |
| `.qz-howto` | one-line usage hint |
| `.qz-q` (`.qz-q.long`) | question display type (long variant auto-applied) |
| `.qz-opts` + layout class | the interaction area; layout classes: `.tf .fi .hs .match .ord .sort .wb .sc .lk .fc .img .est .mem .tot .ws .gc` |
| `.qz-foot`, `.qz-fb`, `.qz-go`, `#qz-submit` | footer: feedback line, Submit, Continue |

Interaction elements (shared): `.qz-opt` (+ `.k` letter chip, `.grip`),
`.qz-chip`, `.qz-input`, `.qz-answer-chip`.

Per-style elements: `.qz-match-term/.qz-match-slot/.qz-match-card/.qz-match-pool`,
`.qz-buckets/.qz-bucket/.qz-sort-items`, `.qz-wb-sentence/.qz-wb-slot/.qz-wb-bank`,
`.qz-sc-panel/.qz-sc-actions`, `.qz-lk-seg`, `.qz-fc-card/.qz-fc-face/.qz-fc-hint/.qz-fc-verdicts`,
`.qz-est/.qz-est-val/.qz-est-bounds/.qz-est-reveal`, `.qz-mem-card`,
`.qz-tot-card/.qz-tot-dots/.qz-tot-dot/.qz-tot-btns`, `.qz-ws-grid/.qz-ws-cell/.qz-ws-word`,
`.qz-gc-hint/.qz-gc-more/.qz-gc-row`.

State classes the engine toggles (style them, never remove/replace them):
`.sel .correct .wrong .found .got .matched .miss .down .flipped .on .used
.badged .path .no .now .flash-right .flash-wrong .dragging .drop-hover
.qz-placeholder .settled .in`.

## What a skin MAY do

- Recolor anything (including overriding the `--q-*` variables themselves)
- Change font stacks (system stacks or data-URI @font-face only), sizes,
  weights, letter-spacing, casing
- Reshape: radii, borders, shadows, gradients, background motifs on
  `.quiz-scene` / `.qz-frame` / `.qz-deco`
- Restyle state classes (e.g. a brand's own correct/wrong treatment — keep
  right and wrong distinguishable for color-blind users: differ by more
  than hue)
- Add `@keyframes` and animations scoped to `.qz-*` elements
- Adjust spacing/padding within the frame

## What a skin MUST NOT do (lint-enforced by `lintQuizSkin`)

- `display: none` or `visibility: hidden` — hides engine elements
- `pointer-events` — breaks interactions
- `position: fixed | sticky` — breaks the drag ghost's positioning
- Selectors outside the `.quiz-scene` / `.qz-*` scope — skins may not touch
  the video, controls, or page
- `@import` or `url(http…)` — no external resources; packages must stay
  self-contained offline zips
- `<script>`/markup of any kind
- Size over 24 KB

On lint failure the skin is dropped and the palette default ships — a bad
skin can never break a lesson.

## Iteration loop

Drop CSS into `apps/api/scripts/quiz-skin-draft.css`, rebuild the gallery
(`npx tsx apps/api/scripts/build-quiz-gallery.ts`), open it — all 19 styles
render with the skin exactly as the SCORM player would ship it.

## Production flow (LP-15)

At publish, `scorm.worker` asks the designer profile to produce a skin from
the lesson's `design_brief` + style palette + the Genially scout vocabulary
(`docs/quiz-scout-report.md`), lints it, stores it at
`lessons/<id>/quiz-skin.css`, and passes it to the packager. Failures are
non-fatal: publish continues with the default styling.
