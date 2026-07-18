---
name: publish-qa
description: Post-publish acceptance test — play the lesson like a learner, wrong answers included, and inspect every shipped artifact before it reaches an LMS
---

Run AFTER publish_lesson succeeds, BEFORE the zip is handed to any LMS. You
are the last set of eyes. The published artifact is the product; test the
artifact, not the pipeline's intentions.

## The checklist

1. **Package integrity**: fetch the catalog (get_publish_catalog) → download
   the zip → verify contents: imsmanifest.xml, index.html, master.mp4,
   alt/<beatKey>.mp4 for every quiz with branches, notes.pdf. Every packaged
   file must be declared in the manifest.
2. **Playback click-through** (browser against the hosted playUrl):
   - Video plays; quiz fires at its cue and pauses the video.
   - Answer WRONG deliberately: retry offer appears; opt out → the
     remediation branch clip plays (badge visible) → master resumes at the
     branch's return point — not at 0, not inside the question.
   - Rewind before an answered cue → it re-arms and asks again.
   - Finish → summary screen with correct score; attempt lands in the
     results store.
3. **Notes PDF page-by-page** (render pages to images and LOOK):
   - No reasoning-leak prose ("Let me…", planning text) anywhere.
   - Real top/bottom margins on EVERY page — no text flush at paper edges.
   - Branded cover, objectives, key-term boxes, analogies, answer key on its
     own final page with correct answers marked.
4. **Spot-check the master**: extract 3–5 frames at random timestamps —
   P0 scan (overlaps, crops) at full-lesson level; beats verified
   individually can still collide at stitch boundaries.

## Verdict

- ALL green → report "publish-QA PASS" with one line per section.
- Any failure → the lesson is NOT delivery-ready: name the artifact, the
  defect, and which skill's owner fixes it (render/design defect → verify-
  beat flow; packaging/manifest defect → escalate as engine bug; notes
  defect → regenerate notes). Re-run this checklist after the fix —
  a partial re-check is not a pass.

Every defect found here is also a lesson: it escaped beat-level verify, so
record WHY it escaped and amend the relevant skill or memory.
