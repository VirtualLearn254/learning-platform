/**
 * quiz-overlay.js — interactive overlay for quiz beats in the HF player.
 *
 * v8.6 (Genially editorial-minimalist redesign):
 *   - Brand palette: cream #FBF8F1 + teal #0E7C66 + terracotta #C76A4A
 *   - Word Search staging: cream backdrop → teal frame → cream inner card → question + options
 *   - NO A/B/C/D letter glyphs (Genially trusts layout + color to indicate option-ness)
 *   - NO drop shadows (depth via color contrast and 1px borders only)
 *   - Outlined-only answer cards: 1px ink border, transparent fill, terracotta-tinted on select
 *   - Triple-token feedback on resolution: border + fill + text in a triple-colored set
 *   - Type-specific UI for all 5 quiz types (multiple_choice, match, fill_in, scenario, likert)
 *
 * How it works:
 *   1. The player loads a lessonManifest containing quizzes[] with start/trigger/end times.
 *   2. As the video plays, when currentTime enters a quiz window, the overlay renders.
 *   3. On commit (click for MC/scenario/likert, Enter for fill_in, both-clicked for match),
 *      the answer is resolved and feedback shown.
 *   4. After feedback delay → resume video. If wrong + scenario+branch, route to alt beat,
 *      then back to return_to_beat_id after the alt ends.
 */

(function (global) {
  "use strict";

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const css = `
      .quiz-overlay-root {
        --qz-bg:           #FBF8F1;
        --qz-ink:          #1A1A1F;
        --qz-muted:        #6B6457;
        --qz-accent:       #0E7C66;
        --qz-accent-2:     #C76A4A;
        --qz-accent-soft:  rgba(14,124,102,0.10);
        --qz-accent-2-soft: rgba(199,106,74,0.10);
        --qz-card-border:  rgba(26,26,31,0.18);
        --qz-card-border-strong: var(--qz-ink);

        --qz-fast:  180ms;
        --qz-med:   260ms;
        --qz-ease:  cubic-bezier(0.4, 0.0, 0.2, 1);
        --qz-ease-out: cubic-bezier(0.0, 0.0, 0.2, 1);

        font-family: 'Sora', system-ui, sans-serif;
        color: var(--qz-ink);
      }

      .quiz-overlay-root .qz-backdrop {
        position: absolute; inset: 0;
        background: rgba(251, 248, 241, 0.96);
        display: flex; align-items: center; justify-content: center;
        padding: 4% 4%;
        container-type: inline-size;
      }

      /* The teal frame — Word Search "single oversized accent-color panel" */
      .quiz-overlay-root .qz-frame {
        background: var(--qz-accent);
        border-radius: 1.4cqw;
        padding: 1.6cqw;
        width: 100%;
        max-width: 78cqw;
      }
      .quiz-overlay-root .qz-frame.is-scenario {
        background: var(--qz-accent-2);
      }

      /* The category eyebrow — white-on-color, sits above the cream inner card */
      .quiz-overlay-root .qz-eyebrow {
        color: rgba(255,255,255,0.92);
        font-size: 1.0cqw;
        font-weight: 600;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        padding: 0.4cqw 0.6cqw 1.1cqw;
        display: flex; align-items: center; gap: 0.8cqw;
      }
      .quiz-overlay-root .qz-eyebrow::before {
        content: ""; display: inline-block;
        width: 0.6cqw; height: 0.6cqw;
        background: rgba(255,255,255,0.7);
        border-radius: 50%;
      }

      /* Cream inner card — the actual quiz body sits here */
      .quiz-overlay-root .qz-inner {
        background: var(--qz-bg);
        border-radius: 1.0cqw;
        padding: 2.6cqw 3.0cqw;
        display: flex; flex-direction: column;
        gap: 1.6cqw;
      }

      .quiz-overlay-root .qz-question {
        font-family: 'Bricolage Grotesque', serif;
        font-size: 2.4cqw;
        font-weight: 600;
        line-height: 1.18;
        letter-spacing: -0.01em;
        margin: 0;
        color: var(--qz-ink);
      }

      /* ──────────────────────────────────────────────────────────────── */
      /* Outlined-only option cards — shared across multiple_choice + scenario */
      /* ──────────────────────────────────────────────────────────────── */
      .quiz-overlay-root .qz-opts {
        list-style: none; margin: 0; padding: 0;
        display: flex; flex-direction: column;
        gap: 0.7cqw;
      }
      .quiz-overlay-root .qz-opt {
        position: relative;
        display: flex; align-items: center;
        padding: 1.1cqw 1.5cqw;
        background: transparent;
        border: 1.5px solid var(--qz-card-border);
        border-radius: 0.6cqw;
        font-size: 1.3cqw;
        line-height: 1.35;
        text-align: left;
        color: var(--qz-ink);
        cursor: pointer;
        font: inherit;
        font-size: 1.3cqw;
        font-weight: 500;
        transition:
          background var(--qz-fast) var(--qz-ease),
          border-color var(--qz-fast) var(--qz-ease),
          color var(--qz-fast) var(--qz-ease);
      }
      .quiz-overlay-root .qz-opt:hover:not([aria-disabled="true"]) {
        border-color: var(--qz-card-border-strong);
      }
      .quiz-overlay-root .qz-opt:focus-visible {
        outline: 3px solid var(--qz-accent);
        outline-offset: 2px;
      }
      .quiz-overlay-root .qz-opt[aria-checked="true"]:not(.is-correct):not(.is-wrong) {
        background: var(--qz-accent-2-soft);
        border-color: var(--qz-accent-2);
        color: var(--qz-accent-2);
      }
      .quiz-overlay-root .qz-opt.is-correct {
        background: var(--qz-accent-soft);
        border-color: var(--qz-accent);
        color: var(--qz-accent);
      }
      .quiz-overlay-root .qz-opt.is-wrong {
        background: var(--qz-accent-2-soft);
        border-color: var(--qz-accent-2);
        color: var(--qz-accent-2);
      }
      .quiz-overlay-root .qz-opt[aria-disabled="true"] {
        cursor: default;
      }
      .quiz-overlay-root .qz-opt[aria-disabled="true"]:not(.is-correct):not(.is-wrong) {
        opacity: 0.45;
      }

      /* Subtle correctness indicator — a dot at the trailing edge, no big checkmark */
      .quiz-overlay-root .qz-opt .qz-mark {
        margin-left: auto;
        width: 0.9cqw; height: 0.9cqw;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .quiz-overlay-root .qz-opt.is-correct .qz-mark { background: var(--qz-accent); }
      .quiz-overlay-root .qz-opt.is-wrong   .qz-mark { background: var(--qz-accent-2); }
      .quiz-overlay-root .qz-opt.is-shown-correct .qz-mark {
        background: transparent;
        border: 1.5px solid var(--qz-accent);
      }

      /* Branch indicator for scenario type — terracotta arrow */
      .quiz-overlay-root .qz-opt[data-has-branch="true"] .qz-branch-icon {
        margin-left: 0.6cqw;
        font-size: 1.2cqw;
        color: rgba(199,106,74,0.6);
      }
      .quiz-overlay-root .qz-opt[data-has-branch="true"]:hover .qz-branch-icon {
        color: var(--qz-accent-2);
      }

      /* ──────────────────────────────────────────────────────────────── */
      /* Match — two-column layout, click left then click right to pair    */
      /* ──────────────────────────────────────────────────────────────── */
      .quiz-overlay-root .qz-match {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2cqw;
      }
      .quiz-overlay-root .qz-match .qz-col {
        display: flex; flex-direction: column;
        gap: 0.7cqw;
      }
      .quiz-overlay-root .qz-match .qz-col-label {
        font-size: 0.9cqw;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--qz-muted);
        margin-bottom: 0.4cqw;
      }
      .quiz-overlay-root .qz-pair-item,
      .quiz-overlay-root .qz-pair-target {
        position: relative;
        padding: 0.9cqw 1.2cqw;
        border: 1.5px solid var(--qz-card-border);
        border-radius: 0.6cqw;
        background: transparent;
        font-size: 1.15cqw;
        line-height: 1.3;
        color: var(--qz-ink);
        cursor: pointer;
        transition: all var(--qz-fast) var(--qz-ease);
      }
      .quiz-overlay-root .qz-pair-target {
        font-family: 'JetBrains Mono', monospace;
        font-size: 1.05cqw;
        text-align: center;
      }
      .quiz-overlay-root .qz-pair-item:hover:not([aria-disabled="true"]),
      .quiz-overlay-root .qz-pair-target:hover:not([aria-disabled="true"]) {
        border-color: var(--qz-card-border-strong);
      }
      /* Paired state — colored tint by pair-index (5 distinct tones) */
      .quiz-overlay-root [data-pair="0"] { background: rgba(14,124,102,0.10); border-color: var(--qz-accent); color: var(--qz-accent); }
      .quiz-overlay-root [data-pair="1"] { background: rgba(199,106,74,0.10); border-color: var(--qz-accent-2); color: var(--qz-accent-2); }
      .quiz-overlay-root [data-pair="2"] { background: rgba(60,90,140,0.10); border-color: #3C5A8C; color: #3C5A8C; }
      .quiz-overlay-root [data-pair="3"] { background: rgba(165,110,40,0.10); border-color: #A56E28; color: #A56E28; }
      .quiz-overlay-root [data-pair="4"] { background: rgba(140,60,120,0.10); border-color: #8C3C78; color: #8C3C78; }
      /* In selection (waiting for the other half) */
      .quiz-overlay-root [aria-selected="true"]:not([data-pair]) {
        background: var(--qz-accent-soft);
        border-color: var(--qz-accent);
        color: var(--qz-accent);
      }
      .quiz-overlay-root .qz-pair-item.is-correct,
      .quiz-overlay-root .qz-pair-target.is-correct {
        border-color: var(--qz-accent);
      }
      .quiz-overlay-root .qz-pair-item.is-wrong,
      .quiz-overlay-root .qz-pair-target.is-wrong {
        border-color: var(--qz-accent-2);
      }

      /* ──────────────────────────────────────────────────────────────── */
      /* Fill-in — row of underline-only input slots, monospace            */
      /* ──────────────────────────────────────────────────────────────── */
      .quiz-overlay-root .qz-fill {
        display: flex; align-items: baseline;
        gap: 0.8cqw;
        font-family: 'JetBrains Mono', monospace;
      }
      .quiz-overlay-root .qz-fill-input {
        flex: 0 0 auto;
        min-width: 14cqw;
        padding: 0.5cqw 0;
        background: transparent;
        border: 0;
        border-bottom: 2px solid var(--qz-accent);
        font-family: 'JetBrains Mono', monospace;
        font-size: 3cqw;
        font-weight: 700;
        color: var(--qz-ink);
        text-align: center;
        letter-spacing: 0.08em;
        outline: 0;
      }
      .quiz-overlay-root .qz-fill-input:focus {
        border-bottom-width: 3px;
      }
      .quiz-overlay-root .qz-fill-input.is-correct { color: var(--qz-accent); border-bottom-color: var(--qz-accent); }
      .quiz-overlay-root .qz-fill-input.is-wrong   { color: var(--qz-accent-2); border-bottom-color: var(--qz-accent-2); }
      .quiz-overlay-root .qz-fill-unit {
        font-family: 'Sora', sans-serif;
        font-size: 1.4cqw;
        color: var(--qz-muted);
      }
      .quiz-overlay-root .qz-fill-hint {
        font-size: 0.95cqw;
        color: var(--qz-muted);
        margin-top: 0.6cqw;
      }
      .quiz-overlay-root .qz-fill-submit {
        margin-left: auto;
        padding: 0.7cqw 1.4cqw;
        background: var(--qz-ink);
        color: #fff;
        border: 0;
        border-radius: 0.5cqw;
        font-family: 'Sora', sans-serif;
        font-size: 1.05cqw;
        font-weight: 600;
        letter-spacing: 0.04em;
        cursor: pointer;
        transition: background var(--qz-fast) var(--qz-ease);
      }
      .quiz-overlay-root .qz-fill-submit:hover { background: var(--qz-accent); }
      .quiz-overlay-root .qz-fill-submit:disabled { opacity: 0.4; cursor: default; }

      /* ──────────────────────────────────────────────────────────────── */
      /* Likert — 5-point row of dots                                      */
      /* ──────────────────────────────────────────────────────────────── */
      .quiz-overlay-root .qz-likert {
        display: flex; flex-direction: column;
        gap: 1cqw;
        align-items: stretch;
      }
      .quiz-overlay-root .qz-likert-row {
        display: flex; justify-content: space-between;
        position: relative;
        padding: 0 2cqw;
      }
      .quiz-overlay-root .qz-likert-row::before {
        content: "";
        position: absolute; left: 3cqw; right: 3cqw; top: 50%;
        height: 1.5px; background: var(--qz-card-border);
      }
      .quiz-overlay-root .qz-likert-dot {
        position: relative; z-index: 1;
        width: 1.6cqw; height: 1.6cqw;
        border-radius: 50%;
        border: 1.5px solid var(--qz-ink);
        background: var(--qz-bg);
        cursor: pointer;
        transition: all var(--qz-fast) var(--qz-ease);
      }
      .quiz-overlay-root .qz-likert-dot:hover {
        transform: scale(1.15);
      }
      .quiz-overlay-root .qz-likert-dot[aria-checked="true"] {
        background: var(--qz-accent);
        border-color: var(--qz-accent);
        transform: scale(1.2);
      }
      .quiz-overlay-root .qz-likert-labels {
        display: flex; justify-content: space-between;
        padding: 0 0.7cqw;
        font-size: 0.85cqw;
        color: var(--qz-muted);
      }
      .quiz-overlay-root .qz-likert-label {
        flex: 1; text-align: center;
        max-width: 8cqw;
      }
      .quiz-overlay-root .qz-likert-label:first-child { text-align: left; }
      .quiz-overlay-root .qz-likert-label:last-child  { text-align: right; }

      /* ──────────────────────────────────────────────────────────────── */
      /* Feedback band — appears below the quiz body on resolution         */
      /* ──────────────────────────────────────────────────────────────── */
      .quiz-overlay-root .qz-feedback {
        font-size: 1.05cqw;
        line-height: 1.4;
        color: var(--qz-muted);
        min-height: 1.6cqw;
        opacity: 0;
        transform: translateY(-4px);
        transition: opacity var(--qz-fast) var(--qz-ease-out), transform var(--qz-fast) var(--qz-ease-out);
      }
      .quiz-overlay-root .qz-feedback.is-visible {
        opacity: 1; transform: translateY(0);
      }
      .quiz-overlay-root .qz-feedback.is-ok    { color: var(--qz-accent); }
      .quiz-overlay-root .qz-feedback.is-wrong { color: var(--qz-accent-2); }

      /* Screen-reader only */
      .quiz-overlay-root .qz-sr {
        position: absolute;
        width: 1px; height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    `;
    const style = document.createElement("style");
    style.setAttribute("data-quiz-overlay", "v8.6-genially");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function installQuizOverlay(videoEl, lessonManifest) {
    if (!lessonManifest || !lessonManifest.quizzes || !lessonManifest.quizzes.length) return null;

    injectStyles();

    const quizzes = lessonManifest.quizzes;
    const STORAGE_KEY = `hf-quiz-events::${lessonManifest.id || "unknown"}`;
    let activeQuiz = null;
    let lastTriggeredAt = -1;

    const wrapper = document.createElement("div");
    wrapper.className = "quiz-overlay-root";
    Object.assign(wrapper.style, {
      position: "absolute", inset: 0, pointerEvents: "none",
      display: "none",
    });
    videoEl.parentElement.style.position = "relative";
    videoEl.parentElement.appendChild(wrapper);

    function findActiveQuiz(t) {
      for (const q of quizzes) {
        if (t >= q.trigger_at && t < q.end_at && t > lastTriggeredAt) return q;
      }
      return null;
    }

    function renderQuizUI(q) {
      activeQuiz = q;
      lastTriggeredAt = q.trigger_at;
      wrapper.style.display = "block";
      wrapper.style.pointerEvents = "auto";

      const eyebrow = q.eyebrow || defaultEyebrow(q.type);
      const isScenario = q.type === "scenario";
      const bodyHtml = renderBodyForType(q);

      wrapper.innerHTML = `
        <div class="qz-backdrop">
          <div class="qz-frame${isScenario ? " is-scenario" : ""}">
            <div class="qz-eyebrow">${escapeHtml(eyebrow)}</div>
            <div class="qz-inner">
              <h2 class="qz-question">${escapeHtml(q.question)}</h2>
              ${bodyHtml}
              <div class="qz-feedback" role="status" aria-live="polite"></div>
            </div>
          </div>
        </div>
      `;
      wireBodyForType(q);
    }

    function defaultEyebrow(type) {
      switch (type) {
        case "multiple_choice": return "Quick check";
        case "match":           return "Match them up";
        case "fill_in":         return "Calculate";
        case "scenario":        return "What would happen?";
        case "likert":          return "Where do you stand?";
        default:                return "Quick check";
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // Per-type renderers
    // ──────────────────────────────────────────────────────────────────

    function renderBodyForType(q) {
      switch (q.type) {
        case "match":           return renderMatchBody(q);
        case "fill_in":         return renderFillInBody(q);
        case "likert":          return renderLikertBody(q);
        case "scenario":        return renderOptionsBody(q, true);
        case "multiple_choice":
        default:                return renderOptionsBody(q, false);
      }
    }

    function wireBodyForType(q) {
      switch (q.type) {
        case "match":           wireMatch(q); break;
        case "fill_in":         wireFillIn(q); break;
        case "likert":          wireLikert(q); break;
        case "scenario":
        case "multiple_choice":
        default:                wireOptions(q); break;
      }
    }

    // -- Multiple choice + Scenario --------------------------------------
    function renderOptionsBody(q, includeBranchMarker) {
      const branchSet = new Set((q.branches || []).map((b) => b.on_option_id));
      const items = q.options.map((opt) => {
        const branch = includeBranchMarker && branchSet.has(opt.id);
        return `
          <li role="radio" aria-checked="false" tabindex="0"
              class="qz-opt"
              data-option-id="${escapeAttr(opt.id)}"
              ${branch ? 'data-has-branch="true"' : ""}>
            <span class="qz-opt-text">${escapeHtml(opt.text)}</span>
            ${branch ? '<span class="qz-branch-icon" aria-hidden="true">↪</span>' : ""}
            <span class="qz-mark" aria-hidden="true"></span>
          </li>
        `;
      }).join("");
      return `<ul class="qz-opts" role="radiogroup">${items}</ul>`;
    }

    function wireOptions(q) {
      const optEls = [...wrapper.querySelectorAll(".qz-opt")];
      const feedbackEl = wrapper.querySelector(".qz-feedback");
      optEls.forEach((el) => {
        el.addEventListener("click", () => commitOption(q, el, optEls, feedbackEl));
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
        });
      });
    }

    function commitOption(q, chosenEl, allEls, feedbackEl) {
      const optionId = chosenEl.dataset.optionId;
      const opt = q.options.find((o) => o.id === optionId);
      if (!opt) return;
      const correct = opt.is_correct === true;
      logEvent(q.beat_id, opt.id, correct);

      // Pre-resolution beat — let the selection register visually
      chosenEl.setAttribute("aria-checked", "true");

      setTimeout(() => {
        allEls.forEach((el) => {
          el.setAttribute("aria-disabled", "true");
          el.tabIndex = -1;
        });
        chosenEl.classList.add(correct ? "is-correct" : "is-wrong");

        // If wrong, also mark the correct answer subtly (Genially "let layout speak" pattern)
        if (!correct) {
          const correctOpt = q.options.find((o) => o.is_correct === true);
          if (correctOpt) {
            const correctEl = allEls.find((el) => el.dataset.optionId === correctOpt.id);
            if (correctEl && correctEl !== chosenEl) {
              correctEl.classList.add("is-shown-correct");
            }
          }
        }

        const feedback = opt.feedback || (correct ? (q.correct_feedback || "Correct.") : (q.wrong_feedback || "Not quite."));
        feedbackEl.textContent = feedback;
        feedbackEl.classList.add("is-visible", correct ? "is-ok" : "is-wrong");

        const branch = !correct && (q.branches || []).find((br) => br.on_option_id === opt.id);
        setTimeout(() => resumeAfter(q, branch), branch ? 2400 : 1800);
      }, 280);
    }

    // -- Match -----------------------------------------------------------
    function renderMatchBody(q) {
      const lefts = q.options;
      const targetIds = [...new Set(lefts.map((o) => o.match_target_id ?? o.id))];
      // Shuffle right column for non-trivial puzzle
      const rightOrder = shuffled(targetIds);

      const leftCol = lefts.map((opt) => `
        <div class="qz-pair-item" role="button" tabindex="0"
             data-option-id="${escapeAttr(opt.id)}"
             data-target="${escapeAttr(opt.match_target_id ?? opt.id)}">
          <span>${escapeHtml(opt.text)}</span>
        </div>
      `).join("");

      const rightCol = rightOrder.map((tid) => {
        const owner = lefts.find((o) => (o.match_target_id ?? o.id) === tid);
        const label = owner?.feedback ?? tid;
        return `
          <div class="qz-pair-target" role="button" tabindex="0"
               data-target-id="${escapeAttr(tid)}">
            <span>${escapeHtml(label)}</span>
          </div>
        `;
      }).join("");

      return `
        <div class="qz-match">
          <div class="qz-col">
            <div class="qz-col-label">Items</div>
            ${leftCol}
          </div>
          <div class="qz-col">
            <div class="qz-col-label">Match</div>
            ${rightCol}
          </div>
        </div>
        <div class="qz-fill-hint">Click an item on the left, then click its match on the right. <span class="qz-progress"></span></div>
      `;
    }

    function wireMatch(q) {
      const leftEls = [...wrapper.querySelectorAll(".qz-pair-item")];
      const rightEls = [...wrapper.querySelectorAll(".qz-pair-target")];
      const feedbackEl = wrapper.querySelector(".qz-feedback");
      const progressEl = wrapper.querySelector(".qz-progress");
      let activeLeft = null;
      let pairCount = 0;
      const total = leftEls.length;
      const pairs = {};

      function updateProgress() {
        if (progressEl) progressEl.textContent = `(${pairCount} of ${total})`;
      }
      updateProgress();

      function selectLeft(el) {
        if (el.hasAttribute("data-pair")) return; // already paired
        if (activeLeft) activeLeft.setAttribute("aria-selected", "false");
        activeLeft = el;
        el.setAttribute("aria-selected", "true");
      }

      function selectRight(el) {
        if (el.hasAttribute("data-pair")) return; // already paired
        if (!activeLeft) return;
        const leftId = activeLeft.dataset.optionId;
        const expectedTargetId = activeLeft.dataset.target;
        const actualTargetId = el.dataset.targetId;
        const pairIdx = pairCount % 5; // cycle through 5 distinct tones
        activeLeft.setAttribute("data-pair", String(pairIdx));
        el.setAttribute("data-pair", String(pairIdx));
        activeLeft.removeAttribute("aria-selected");
        pairs[leftId] = { actualTargetId, expectedTargetId, correct: expectedTargetId === actualTargetId };
        activeLeft = null;
        pairCount++;
        updateProgress();
        if (pairCount === total) {
          setTimeout(() => commitMatch(q, pairs, leftEls, rightEls, feedbackEl), 600);
        }
      }

      leftEls.forEach((el) => {
        el.addEventListener("click", () => selectLeft(el));
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectLeft(el); } });
      });
      rightEls.forEach((el) => {
        el.addEventListener("click", () => selectRight(el));
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectRight(el); } });
      });
    }

    function commitMatch(q, pairs, leftEls, rightEls, feedbackEl) {
      let correctCount = 0;
      for (const id in pairs) if (pairs[id].correct) correctCount++;
      const allCorrect = correctCount === Object.keys(pairs).length;
      logEvent(q.beat_id, allCorrect ? "all-correct" : "partial", allCorrect);

      // Mark visually correct/wrong on each pair
      for (const id in pairs) {
        const leftEl = leftEls.find((e) => e.dataset.optionId === id);
        const rightEl = rightEls.find((e) => e.dataset.targetId === pairs[id].actualTargetId);
        if (leftEl)  leftEl.classList.add(pairs[id].correct ? "is-correct" : "is-wrong");
        if (rightEl) rightEl.classList.add(pairs[id].correct ? "is-correct" : "is-wrong");
      }
      [...leftEls, ...rightEls].forEach((el) => el.setAttribute("aria-disabled", "true"));

      const feedback = allCorrect
        ? (q.correct_feedback || `All ${correctCount} correct.`)
        : (q.wrong_feedback || `${correctCount} of ${Object.keys(pairs).length} correct. Let's review.`);
      feedbackEl.textContent = feedback;
      feedbackEl.classList.add("is-visible", allCorrect ? "is-ok" : "is-wrong");

      setTimeout(() => resumeAfter(q, null), 2400);
    }

    // -- Fill-in ---------------------------------------------------------
    function renderFillInBody(q) {
      const target = q.options[0] || {};
      const unit = target.text || "";
      const tolPct = target.numeric_tolerance_pct ?? 0;
      const hint = tolPct ? `±${tolPct}% tolerance` : "";
      return `
        <div class="qz-fill">
          <input class="qz-fill-input" type="text" inputmode="numeric"
                 autocomplete="off" spellcheck="false"
                 placeholder="–" />
          ${unit ? `<span class="qz-fill-unit">${escapeHtml(unit)}</span>` : ""}
          <button class="qz-fill-submit" disabled>Submit</button>
        </div>
        ${hint ? `<div class="qz-fill-hint">${hint}</div>` : ""}
      `;
    }

    function wireFillIn(q) {
      const input = wrapper.querySelector(".qz-fill-input");
      const submit = wrapper.querySelector(".qz-fill-submit");
      const feedbackEl = wrapper.querySelector(".qz-feedback");
      if (!input || !submit) return;

      input.addEventListener("input", () => {
        submit.disabled = input.value.trim().length === 0;
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !submit.disabled) { e.preventDefault(); submit.click(); }
      });
      submit.addEventListener("click", () => {
        const value = parseFloat(input.value.replace(/,/g, ""));
        const target = q.options[0] || {};
        const expected = target.numeric_value;
        const tolPct = target.numeric_tolerance_pct ?? 0;
        const tolerance = Math.abs(expected) * (tolPct / 100);
        const correct = !isNaN(value) && expected != null &&
          Math.abs(value - expected) <= tolerance;
        logEvent(q.beat_id, String(value), correct);
        input.classList.add(correct ? "is-correct" : "is-wrong");
        input.disabled = true; submit.disabled = true;
        const feedback = target.feedback || (correct
          ? (q.correct_feedback || `Correct — ${expected}.`)
          : (q.wrong_feedback || `Not quite. The answer is ${expected}.`));
        feedbackEl.textContent = feedback;
        feedbackEl.classList.add("is-visible", correct ? "is-ok" : "is-wrong");
        setTimeout(() => resumeAfter(q, null), 2400);
      });

      // Auto-focus the input
      setTimeout(() => { try { input.focus(); } catch {} }, 60);
    }

    // -- Likert ----------------------------------------------------------
    function renderLikertBody(q) {
      const scale = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
      const dots = scale.map((label, i) => `
        <div class="qz-likert-dot" role="radio" aria-checked="false" tabindex="0"
             data-likert-value="${i + 1}"
             data-option-id="${escapeAttr(q.options[i]?.id ?? "pt-" + (i + 1))}"></div>
      `).join("");
      const labels = scale.map((label) => `<div class="qz-likert-label">${label}</div>`).join("");
      return `
        <div class="qz-likert" role="radiogroup">
          <div class="qz-likert-row">${dots}</div>
          <div class="qz-likert-labels">${labels}</div>
        </div>
      `;
    }

    function wireLikert(q) {
      const dotEls = [...wrapper.querySelectorAll(".qz-likert-dot")];
      const feedbackEl = wrapper.querySelector(".qz-feedback");
      function pick(el) {
        dotEls.forEach((d) => d.setAttribute("aria-checked", d === el ? "true" : "false"));
        const value = el.dataset.likertValue;
        logEvent(q.beat_id, value, true); // Likert has no correct answer
        setTimeout(() => {
          dotEls.forEach((d) => d.setAttribute("aria-disabled", "true"));
          feedbackEl.textContent = q.correct_feedback || "Noted. Thanks.";
          feedbackEl.classList.add("is-visible", "is-ok");
          setTimeout(() => resumeAfter(q, null), 1800);
        }, 280);
      }
      dotEls.forEach((el) => {
        el.addEventListener("click", () => pick(el));
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(el); }
        });
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // Resume / branch routing (shared across types)
    // ──────────────────────────────────────────────────────────────────

    function resumeAfter(q, branch) {
      wrapper.style.display = "none";
      wrapper.style.pointerEvents = "none";
      activeQuiz = null;
      if (branch && lessonManifest.altBeats && lessonManifest.altBeats[branch.alt_beat_id]) {
        const alt = lessonManifest.altBeats[branch.alt_beat_id];
        const returnBeat = lessonManifest.chapters.find((c) => c.id === branch.return_to_beat_id);
        const masterSrc = videoEl.src;
        const resumeAt = returnBeat ? returnBeat.startSec : (q.end_at + 0.05);
        const onAltEnded = () => {
          videoEl.removeEventListener("ended", onAltEnded);
          videoEl.src = masterSrc;
          videoEl.load();
          videoEl.currentTime = resumeAt;
          videoEl.play().catch(() => {});
        };
        videoEl.addEventListener("ended", onAltEnded);
        videoEl.src = alt.url;
        videoEl.load();
        videoEl.play().catch(() => {});
      } else {
        videoEl.currentTime = q.end_at + 0.05;
        videoEl.play();
      }
    }

    videoEl.addEventListener("timeupdate", () => {
      const t = videoEl.currentTime;
      if (activeQuiz && t >= activeQuiz.end_at - 0.05) {
        videoEl.pause();
        videoEl.currentTime = activeQuiz.end_at - 0.05;
        return;
      }
      if (activeQuiz) return;
      const q = findActiveQuiz(t);
      if (q) renderQuizUI(q);
    });
    videoEl.addEventListener("seeking", () => {
      if (videoEl.currentTime < lastTriggeredAt) lastTriggeredAt = -1;
    });

    function logEvent(beatId, optionId, correct) {
      try {
        const log = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        log[beatId] = { optionId, correct, ts: Date.now() };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
      } catch { /* ignore */ }
    }

    return { dispose: () => wrapper.remove() };
  }

  // ──────────────────────────────────────────────────────────────────
  // Utilities
  // ──────────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  global.installQuizOverlay = installQuizOverlay;
})(window);
