---
name: design-beat
description: Judge and steer a beat's visual composition — the design language, per-lesson consistency, and what a correction note must contain
---

The substrate's designer turns script + visualSpec into an animated HTML/GSAP
composition, rendered to MP4. Your job is to STEER it — through the
visualSpec you author and the correction notes you write — and to know good
composition from bad when you see frames.

## Device palette (LP-20)

When a beat's visualSpec names `devices`, the substrate injects their full
specs into the designer prompt as a compose-from palette with a timeline
contract. Steer by CHOOSING devices (via the author) rather than describing
layouts in prose; correction notes should reference device guarantees by name
("the balance-equation-bar card did not update on Day 2").

## The design language (what "right" looks like)

- **One visual idea per sub-scene**, entering in sync with the narration
  phrase it illustrates. Entrance → hero → settle is a progression: the
  entrance sets context, the hero carries the core content at full strength,
  the settle holds the completed thought.
- **Hierarchy**: an eyebrow/kicker, one dominant element, supporting items
  clearly subordinate. If a frame has no obvious focal point, it fails.
- **Palette discipline**: the lesson's style palette (bg/ink/muted/accent/
  surface) — accent used sparingly for the thing that matters most.
- **Per-lesson consistency**: sibling beats share one design system (the
  lesson's design brief) — same eyebrow format, card treatment, motif family.
  A beat that looks like it came from a different course is a defect even if
  it is beautiful alone.
- **Type**: generous sizes, comfortable line-height; numbers and formulas
  rendered large. Exponents/superscripts are a KNOWN weak point — always
  check them in frames.

## Hard fails (P0 — never ships)

- Overlapping text or elements, anywhere, ever.
- Text cropped at any frame edge; content outside the safe area.
- Unreadable contrast or type below comfortable reading size.
- A reveal still in motion in the final second (breaks the ≥1s audio-tail
  sync rule).

## Writing a correction note (for render_beat)

A correction note is a work order to a machine, not a complaint. It must name:
1. WHERE — which sub-scene / which element ("the third step card, 'Verify'").
2. WHAT is wrong — precisely ("its label overlaps the arrow beneath it").
3. WHAT right looks like — the target state ("move the label above the card;
   keep the arrow position").
One concern per note. If two things are wrong, decide whether one note covers
both coherently or the beat needs an authoring revision instead.
