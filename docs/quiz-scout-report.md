# Genially Quiz Template Scout Report

Structured design vocabulary extracted from the 8 quiz-flavored templates in
the Genially recon corpus (`E:\remotion-pipeline\test-data\genially-research`),
scouted 2026-07-06 by three multimodal agents reading each template's
deep-dive.md, model.json, tokens.json, translator-notes.md and screenshots.
This document feeds the quiz-skin generator prompt (`apps/api/src/lib/quiz-skin.ts`)
and future style refinement.

Canvas for all templates: 1200×675 (16:9). `tokens.json` is identical across
templates — it is Genially's platform design system (GDS), not per-template
theming; per-template themes live in deep-dive.md + model.json.

## Platform-level tokens worth adopting verbatim (GDS)

- Radii: `0.25rem / 0.5rem / 1rem` (small/medium/large)
- Shadow: `0 1px 0.25rem rgba(18,18,18,0.2)` (the ONLY shadow — tiny)
- Transition: `0.2s cubic-bezier(0.4, 0, 0.4, 1)`
- Empty/holding areas: `2px dashed rgba(199,195,211,1)`
- Selected state: `2px dashed rgba(108,41,255,1)` (or solid 1-2px accent)
- Feedback formula: pale same-hue tint bg + saturated same-hue border/ink —
  success ink `#25A782` on `#E5FAF4`, error ink `#D83F55` on `#FAE6E6`,
  warning `#F4D34A` on `#FAF6E6`. NEVER solid green/red slabs.
- House font: Schibsted Grotesk (300/400/500/600/700/900)

## The Genially quiz house style (cross-template synthesis)

1. **Three-variable theme.** Every template is exactly primary/secondary/
   tertiary + black/white, with ROLES reassigned per skin (bg/tray/ink, or
   band/bg/CTA, or bg/accent/ink). A skin should emit ~3 hexes + role
   mapping, not open-ended palettes.
2. **Structure formula: stage → surface → chips.** Either one big white
   rounded card (radius 8–28px) on a flat saturated/patterned field, or
   full-bleed color field with no surfaces. Radius shrinks outward-in
   (sheet 28px → cards 16px → pills). No borders or heavy shadows —
   separation by value/hue steps; elevation implied by roundness + overlap.
3. **Patterned "weave" background.** A subtle tiled geometric pattern in one
   theme color over another (sometimes tone-on-tone) is the default
   anti-flatness device.
4. **Extreme two-step type scale, max two families.** Hero 82–120px vs body
   16–27px (4:1 to 7.5:1), either display-serif/personality-face + utility
   sans/mono, or one family at weight 300 vs 800. Hierarchy inside cards by
   weight/position, not size. Helper text demoted by grey color, not tininess.
5. **Accent economy, strictly tiered.** Play surfaces stay near-monochrome;
   saturated color is spent on environment, identity, or the judgment/CTA
   moment — never all three. Two-accent pattern: accent-A on every
   interactive option chip, accent-B ONLY on the advance-CTA.
6. **Pills mean "press me".** Primary CTAs are fully-rounded pills in the
   single most saturated color on screen. Hover grammar is SEMANTIC:
   grow (`scale 1.06`) = grabbable · shrink (`scale 0.95`) = pressable ·
   float (`translateY(-6px)`) = CTA.
7. **Entrance vocabulary.** Default `fade-in-bottom`; `scale-in-center` for
   popups/feedback; `card-reveal-up` for option grids (whole grid together,
   after the chrome — not per-card stagger spam); ONE exotic "signature"
   effect per template reserved for the hero element (focus-in,
   text-flicker-in-glow, swirl-in-fwd). Staggers short: 0–0.5s, 2 steps.
   Dense scenes drop animation entirely.
8. **Feedback is warm, worded, and asymmetric.** Success/partial get full
   sentences at 36–45px ("Excellent job!", "You're almost there!").
   Per-item feedback small (chip recolor in desaturated pastels — sage
   `#AEE0B0` / terracotta `#D5725F`); the TERMINAL success moment is
   ceremonial (fireworks, takeover panel); failure gets its own gentle art
   direction (rain effect, navy "Oops" panel) — never a red X wall.
9. **Game framing over test framing.** A world or a device, never a
   document: letterbox bars, console frames, diegetic scenes. Stakes in the
   chrome: attempts counters ("Attempts left: 3", right-aligned in a tinted
   header strip), arcade timers, difficulty dots, "N/3" progress chips.
   Restart is a first-class themed button.

## Per-template signature moves (steal list)

**Correct Concepts** (drag-to-drawer): letterbox bars in ink color; diamond
lattice bg tile at 15-20% opacity with edge fade; monospace chips + slab
serif question; dashed 2px tray vs solid drop zones; attempts counter strip.

**Fill in the Blanks**: colored header band fused to card top (shared
radius) carrying the quiz-type label; CTA pill overlapping the card's bottom
edge; cloze gaps as tinted rectangles (`background: tint; radius 4px`)
inline in the sentence; 300-vs-800 weight-contrast headline in one family.

**Word Search** (dark field): theme-dark bg + white serif + one acid accent
for ALL interactives, zero cards/borders; italic accent subtitle (same serif,
style+color shift); difficulty/progress dots; signature-glyph entrance
(swirl) while everything else fades in bottom-up; bottom-right rounded-full
arrow pill as universal continue.

**Guess the Character**: rotated vertical title band (`writing-mode:
vertical-rl`, dark strip, caps display) down the left edge of dense grids;
brick-stagger option grid (`nth-child(even) { translateY(~75px) }`); white
zero-accent cards on one saturated flat bg; green `#8CD147` / red `#F54E4E`
reserved exclusively for the judgment moment; circular corner chip as the
"this is interactive" affordance.

**Interactive Scoreboard** (dark HUD): stage `#1B0E3B` → near-black panel
`#000F33` → team cards; Bebas-style caps hero 85px vs 14px helper (6:1);
score numeral in a thin OUTLINED box (the one hollow element); 4-token
card contract `{cardBg, cardText, buttonBg, buttonText}`; team identity
colors `#F7512D #7C4ECB #2FC49E #F3F3F7`; brightest object = the pressable.

**Match the Verbs**: the "white sheet" — one radius-28px white container
inset ~7% on a flat brand field; hero element overlapping the sheet
boundary; stadium chips 230×65 (radius 999) shrinking to 171×48 past ~16
options; two-tier accents (pink chips / mint CTA); `hvr-float` on CTAs only;
"1/3" plain-text progress chip instead of a progress bar.

**Recycle & Sort** (illustrated game): staged playfield choreography —
chrome first, drop zones `bounce-in-top` staggered ~0.2s, then ALL
draggables pop simultaneously ("pieces hit the table"); grow-hover on
grabbables, shrink-hover on buttons; per-drop audio; transient corner
"nope" callout; fireworks on completion vs rain on timeout (asymmetric
emotional art direction); themed arcade timer.

**Sorting Cards** (console): accent-at-11%-alpha chip system —
`border: 1px solid accent; background: accent @ 11%; color: accent`;
drop zones reuse the SAME border color at card scale (border rhyme = "this
goes in that"); dashed pool vs solid destinations ≥70% empty; three-state
drag grammar (rest tint → hover grow → picked-up swaps to a dedicated
selectionColor lilac `#E9AFFC` + small shadow lift); explicit Check-button
validation with `returnIncorrect` + visible attempts; desaturated verdict
pastels; navy fail / blue success popup panels with white circle icon
medallions.

## Skin token contract (derived)

Every observed template is expressible in ~10 slots:
`stage, surface, ink, accent-option, accent-cta, success, error,
selection, pattern-color, + per-card {cardBg, cardText, buttonBg,
buttonText}` (HUD/gamification).
