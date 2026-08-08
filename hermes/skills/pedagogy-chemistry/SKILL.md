---
name: pedagogy-chemistry
description: Subject overlay for Kenya CBC Grade 10 (Senior School / STEM) chemistry — particles-first pedagogy, formula-fidelity discipline, lab-observable visuals, competency framing
---

(Profile-level skill: loads only in the chemistry profile, on top of the
shared craft skills. Where this conflicts with a craft skill, craft wins on
hard constraints; this wins on pedagogy and style. The syllabus spine and
per-strand scope live in the companion file `grade10-kicd-syllabus.md` — read
it before outlining any lesson.)

## The curriculum this teaches

Kenya CBC **Senior School, Grade 10 Chemistry** (KICD design, June 2024, ISBN
978-9914-52-913-5), STEM pathway, 180 lessons/year. This is NOT 8-4-4 Form 2 —
it is competency-based, project-driven, and re-sequenced. Structure is
**Strand → Sub-Strand → Specific Learning Outcomes → Learning Experiences →
Key Inquiry Question → Core Competencies → Values → PCIs**, assessed by
rubric levels (Exceeds / Meets / Approaches / Below expectation), not a single
exam. Every beat should serve a specific learning outcome from the design and,
where natural, gesture at the sub-strand's Key Inquiry Question.

## How chemistry is taught (the pedagogy)

- **Particles-first, symbols-second.** Build the mental picture — electrons in
  energy levels/orbitals, ions gaining or losing them, lattices and molecules
  — BEFORE the formula or equation that notates it. The symbol equation is the
  shorthand; the particle story is the content.
- **Every abstraction earns an observable.** Anchor each idea in something the
  learner could see, smell, weigh, or test: the limewater test for CO₂, the
  grey lead bead and brown bromine vapour of molten PbBr₂ electrolysis, the
  lilac flame of potassium, universal-indicator colour on the pH scale. No
  observable, not yet taught.
- **Inquiry framing.** Open a concept from its Key Inquiry Question where it
  fits ("How are electrons arranged in an atom?"); teach toward being able to
  answer it. Prefer the CBC verbs — investigate, illustrate, describe trends,
  relate structure to use.
- **Trends are the through-line.** Periodicity is the spine of Grade 10: size,
  ionisation energy, electron affinity, reactivity down a group and across a
  period. Teach one trend by walking the family/period member-by-member and
  letting the pattern emerge, never as a memorised table.
- **Projects and application close the loop.** Where the design mandates a
  project (drug-abuse posters, bonding models from local materials, fertiliser
  eutrophication), name it — the course is meant to point outward to the
  learner's world and the STEM careers it feeds.

## Formula fidelity (a hard discipline — the known weak spot)

Chemical notation is content, and it is exactly where the renderer has failed
before (subscripts/superscripts). Treat every one as a P0-equivalent
correctness check in authoring AND in frame QA:

- **Subscripts = counts**: H₂O, CO₂, H₂SO₄, Ca(OH)₂. Never "H2O" flat.
- **Superscripts = charges, sign AFTER magnitude**: Na⁺, Cl⁻, Fe³⁺, SO₄²⁻,
  Al³⁺. Not Na+1, not ³Fe.
- **State symbols** where the syllabus demands them: (s), (l), (g), (aq).
- **Balanced equations** must actually balance — atom counts each side, and
  charge balance in ionic equations (precipitation). A miscounted coefficient
  is a correctness fail.
- **Electron notation**: CBC uses **s/p orbital notation** for the first 20
  elements (e.g. 1s² 2s² 2p⁶ 3s¹ for sodium) alongside the older 2.8.1 shell
  form — check superscripts on both. Orbital notation is new vs 8-4-4; do not
  fall back to shells-only.
- In frame QA, read every formula in the rendered frame character by
  character; a dropped subscript is invisible at a glance and fatal.

## Visual language

- **Native forms**: periodic-table cells and highlighted group/period strips;
  Bohr/energy-level shells and s/p orbital-fill diagrams; dot-and-cross
  bonding diagrams (ionic transfer, covalent sharing, dative, metallic sea);
  lattice/molecule models (NaCl, diamond, graphite, SiO₂); reaction set-ups
  (gas prep + collection, electrolysis cell with labelled electrodes and ion
  migration arrows); the pH/universal-indicator colour scale; trend-gradient
  bars for periodicity; before/after colour-change and gas-test panels.
- **Show the CHANGE**: highlight the electron that transfers, the ion that
  migrates, the cell that updates — not the whole diagram at once. Build
  tables/periodic strips member-by-member in narration sync.
- **Reuse the LP-20 device palette where it maps** (see author/design skills):
  `flow-from-sources` for reactants→products; `split-mirror` for
  reactant/product or metal/non-metal contrasts; `delta-chip` for a trend step
  or mass change; `myth-truth-panels` for misconception vs correct; `settle-check`
  to land the balanced result. Where a chemistry-native device recurs
  (dot-and-cross, orbital-fill, periodic-cell, electrolysis-cell, ph-scale,
  trend-gradient), propose it for distillation into the shared device library
  per the LP-20 growth rule — don't hand-build the same motif twice.
- **Style**: clean lab-editorial — real apparatus and molecular geometry,
  never cartoon beakers, googly-eyed atoms, or bubbling green "science" clip-art.
  Adult register even for 15-year-olds: precise, not childish.

## Narration register

Lab-bench teacher who has run the experiment, talking to a capable Grade 10
STEM learner. Anchor abstractions in consequence and observation ("the ions
have to be free to move — that's why the solid won't conduct but the melt
will"). Define every term at first use (dissect-and-define: ion, isotope,
electronegativity, deliquescent) and re-anchor recalled terms with their plain
meaning. Warm and precise; zero hype, zero condescension.

## Quiz distribution (variety within the subject)

Lean on: `fill_in` with numericValue+tolerance (RAM from isotopic abundance,
balancing coefficients, formula mass); `sort_into` (metal/non-metal, ionic/
covalent, soluble/insoluble salt, cation/anion, deliquescent/efflorescent/
hygroscopic); `ordering` (reactivity series, trend down a group, steps of a
salt preparation); `scenario` (which preparation method for THIS salt; is this
oxide amphoteric); `estimate` (relative reactivity, bond-type from properties).
Every computation quiz's wrong options are the CHEMISTRY of a specific mistake
— wrong isotopic weighting, unbalanced equation, charge sign flipped, subscript
vs coefficient confusion — never random numbers.
