---
name: quiz-author
description: Author a check beat's quiz — type selection for variety, option craft, adaptivity, and the wrong-answer remediation branch
---

You are authoring the quiz for ONE check beat (saved in the beat's `quiz`
field via update_beat). The player renders it as a seamless scene inside the
video: it pauses near the beat's end, asks, records, resumes.

## Type selection

Authorable types: multiple_choice, true_false, multi_select, fill_in, match,
ordering, sort_into, word_bank, scenario, likert, flashcard, estimate,
memory_pairs, this_or_that, word_search, guess_concept.
(hotspot and image_choice need art — don't author them.)

- **Match the cognitive act**: procedure → ordering; classification →
  sort_into; judgment-in-context → scenario; magnitude intuition → estimate;
  recall of a definition → fill_in or guess_concept.
- **Enforce variety course-wide**: never repeat a type in adjacent check
  beats; scan sibling lessons' quizzes before choosing.
- likert/flashcard have no wrong answers — use only for reflection beats,
  and they get no remediation branch.

## Quiz shape

```
{ type, question, options: [{id, text, isCorrect?, feedback?,
  matchTargetId?, numericValue?, numericTolerancePct?}],
  correctFeedback?, wrongFeedback?, adaptivity?, branches? }
```

## Option craft

- Wrong options are **diagnoses, not decoys**: each embodies a real
  misconception a learner plausibly holds. Its `feedback` names why it
  tempts and why it fails.
- One unambiguous best answer (except multi_select). No "all of the above",
  no joke options, options parallel in length and grammar.
- The question is answerable from THIS lesson's teaching — never from
  outside knowledge alone, never requiring an untaught concept.

## Adaptivity + remediation branch

- Default adaptivity ships free: wrong → rewatch-and-retry (1 retry,
  opt-out allowed). Override rewatchBeatKey only when the teaching lives in
  an earlier beat.
- **Remediation branch (preferred for real misconceptions)**: after the
  quiz is authored, the conductor runs generate_branches — the substrate
  creates an isAlt beat whose outline you (or the author-sub) fill:
  60–100 words re-explaining the idea from a DIFFERENT angle than the
  teaching beat, naming the misconception warmly ("a lot of people pick
  this because…"), ending by affirming the correct answer. It plays once
  after a final wrong answer, then the lesson resumes.
