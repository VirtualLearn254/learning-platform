/**
 * @lp/scorm-packager — builds SCORM 2004 4th-Ed packages from a stitched
 * lesson master MP4. Bundles:
 *
 *   imsmanifest.xml   — SCORM manifest declaring one SCO with one asset
 *   index.html        — HTML5 player wrapper that connects to LMS API
 *   scorm-api.js      — SCORM 1.2 + 2004 discovery + normalized client
 *   master.mp4        — the video
 *
 * The zip is returned as a Buffer for the caller to upload wherever
 * (S3, disk, whatever). SHA-256 of the resulting bytes is also returned.
 */

import { createHash } from "node:crypto";
import JSZip from "jszip";

import type { Lesson, Beat } from "@lp/shared";

/**
 * SCORM 2004 4th Edition manifest template. Uses a stable identifier
 * derived from the lesson id so re-packaging the same lesson always
 * produces the same manifest.
 */
function buildManifest(lesson: { id: string; title: string; summary?: string | null; durationSec?: number }, opts: { organization?: string } = {}): string {
  const identifier = `LP_LESSON_${lesson.id.replace(/-/g, "").slice(0, 24)}`;
  const orgId = `${identifier}_ORG`;
  const itemId = `${identifier}_ITEM`;
  const resId = `${identifier}_RES`;
  const title = xmlEscape(lesson.title);
  const description = xmlEscape((lesson.summary ?? "").slice(0, 500));
  const organizationName = xmlEscape(opts.organization ?? "Learning Platform");

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${identifier}"
          version="1.3"
          xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
          xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
          xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
                              http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
                              http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
                              http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
    <lom xmlns="http://ltsc.ieee.org/xsd/LOM">
      <general>
        <title><string language="en">${title}</string></title>
        <description><string language="en">${description}</string></description>
      </general>
      <lifeCycle>
        <contribute>
          <role><value>publisher</value></role>
          <entity>${organizationName}</entity>
        </contribute>
      </lifeCycle>
    </lom>
  </metadata>
  <organizations default="${orgId}">
    <organization identifier="${orgId}">
      <title>${title}</title>
      <item identifier="${itemId}" identifierref="${resId}">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="${resId}" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
      <file href="scorm-api.js"/>
      <file href="master.mp4"/>
    </resource>
  </resources>
</manifest>
`;
}

// ─── Quiz scene: shared CSS + markup + engine ───────────────────────
// One source of truth for the quiz styles — used by the SCORM player
// (video takeover) AND the standalone style gallery (design iteration).
// Types follow H5P Interactive Video's proven data model, rendered in
// our palette scenes instead of their white cards.

const QUIZ_SCENE_CSS = `
  /* ── Quiz scene ──────────────────────────────────────────────
     Not a popup. A full-stage takeover in the same palette CSS vars
     the designer used for the beat. Per-cue colors arrive as --q-* vars;
     the em unit is set by the host to frameWidth/42 (≈ the 1920×1080
     design grid of the beats). */
  .quiz-scene {
    position: absolute; inset: 0; display: none; overflow: hidden;
    background: var(--q-bg, #101418); color: var(--q-ink, #EEF2F5);
    opacity: 0; transition: opacity 0.35s ease; z-index: 10;
    font-family: system-ui, "Helvetica Neue", Arial, sans-serif;
  }
  .quiz-scene.open { display: block; }
  .quiz-scene.visible { opacity: 1; }
  .qz-frame {
    position: absolute;
    display: flex; flex-direction: column;
    /* "safe center": tall content (hotspot images, long questions) clips at
       the bottom instead of pushing the rule/eyebrow off the top. */
    justify-content: center; justify-content: safe center;
    padding: 3.2em 5em; box-sizing: border-box;
  }
  .qz-deco {
    position: absolute; right: -0.12em; bottom: -0.38em;
    font-size: 15em; font-weight: 800; line-height: 1;
    color: var(--q-accent-faint, rgba(255,255,255,0.05));
    pointer-events: none; user-select: none;
  }
  .qz-rule { width: 3.2em; height: 0.22em; background: var(--q-accent, #22D3EE); border-radius: 0.11em; margin-bottom: 1.1em; }
  .qz-eyebrow {
    font-size: 0.62em; letter-spacing: 0.2em; text-transform: uppercase;
    color: var(--q-accent, #22D3EE); font-weight: 700; margin-bottom: 0.9em;
  }
  .qz-q {
    font-size: 1.55em; font-weight: 700; line-height: 1.25;
    letter-spacing: -0.01em; max-width: 78%; margin-bottom: 1.1em;
  }
  .qz-opts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7em; max-width: 82%; }
  /* true_false: two large verdict cards, no letter chips */
  .qz-opts.tf { max-width: 56%; }
  .qz-opts.tf .qz-opt { text-align: center; font-size: 1em; font-weight: 700; padding: 1.05em 1em; }
  .qz-opts.tf .k { display: none; }
  /* multi_select: cards toggle before a submit step */
  .qz-opt.sel { border-color: var(--q-accent, #22D3EE); background: var(--q-accent-soft, rgba(34,211,238,0.12)); }
  .qz-opt {
    text-align: left; padding: 0.85em 1em;
    background: var(--q-surface, #171C22); color: var(--q-ink, #EEF2F5);
    border: 1.5px solid var(--q-line, rgba(0,0,0,0.14)); border-radius: 0.55em;
    font-size: 0.82em; line-height: 1.35; cursor: pointer; font-family: inherit;
    transition: border-color 0.18s ease, transform 0.18s ease, background 0.18s ease;
  }
  .qz-opt .k { color: var(--q-accent, #22D3EE); font-weight: 700; margin-right: 0.55em; }
  .qz-opt:hover:not(:disabled) { border-color: var(--q-accent, #22D3EE); transform: translateY(-2px); }
  .qz-opt:disabled { cursor: default; }
  /* Verdicts use fixed semantic colors — palettes with red/green accents
     (swiss-grid, paper-mark) would otherwise make right and wrong identical. */
  .qz-opt.correct { border-color: #10B981; background: rgba(16,185,129,0.12); }
  .qz-opt.correct .k { color: #10B981; }
  .qz-opt.wrong { border-color: #EF4444; background: rgba(239,68,68,0.1); }
  .qz-opt.wrong .k { color: #EF4444; }
  /* fill_in: typed answer with tolerant matching */
  .qz-opts.fi { display: flex; max-width: 82%; }
  .qz-input {
    font-family: inherit; font-size: 0.95em; padding: 0.7em 1em;
    background: var(--q-surface, #171C22); color: var(--q-ink, #EEF2F5);
    border: 1.5px solid var(--q-line, rgba(0,0,0,0.14)); border-radius: 0.55em;
    width: 16em; max-width: 100%; outline: none;
    transition: border-color 0.18s ease;
  }
  .qz-input::placeholder { color: var(--q-muted, #8B98A5); opacity: 0.7; }
  .qz-input:focus { border-color: var(--q-accent, #22D3EE); }
  .qz-input.correct { border-color: #10B981; background: rgba(16,185,129,0.12); }
  .qz-input.wrong { border-color: #EF4444; background: rgba(239,68,68,0.1); }
  .qz-answer-chip {
    display: inline-flex; align-items: center; align-self: center;
    margin-left: 0.8em; padding: 0.7em 1em; font-size: 0.82em;
    border: 1.5px solid #10B981; background: rgba(16,185,129,0.12);
    border-radius: 0.55em; color: var(--q-ink, #EEF2F5);
  }
  .qz-answer-chip .k { color: #10B981; font-weight: 700; margin-right: 0.55em; }
  /* hotspot: the image is the question canvas */
  .qz-opts.hs { display: block; max-width: 82%; }
  .qz-hs-wrap {
    position: relative; display: inline-block; max-width: 46%;
    border: 1.5px solid var(--q-line, rgba(0,0,0,0.14)); border-radius: 0.55em;
    overflow: hidden; cursor: crosshair; line-height: 0;
    background: var(--q-surface, #171C22);
  }
  .qz-hs-wrap img { width: 100%; height: auto; display: block; user-select: none; -webkit-user-drag: none; }
  .qz-hs-wrap.done { cursor: default; }
  .qz-hs-dot {
    position: absolute; width: 1em; height: 1em; border-radius: 50%;
    transform: translate(-50%, -50%); pointer-events: none;
    border: 0.16em solid #fff; box-shadow: 0 0 0 0.12em rgba(0,0,0,0.35);
    box-sizing: border-box;
  }
  .qz-hs-dot.correct { background: #10B981; }
  .qz-hs-dot.wrong { background: #EF4444; }
  .qz-hs-region {
    position: absolute; pointer-events: none; box-sizing: border-box;
    border: 0.14em dashed #10B981; border-radius: 0.3em;
    background: rgba(16,185,129,0.14);
  }
  .qz-foot { display: flex; align-items: center; gap: 1.2em; margin-top: 1.2em; min-height: 2.4em; max-width: 82%; }
  .qz-fb { font-size: 0.72em; line-height: 1.45; color: var(--q-muted, #8B98A5); flex: 1; }
  .qz-go {
    padding: 0.7em 1.6em; background: var(--q-accent, #22D3EE); color: var(--q-btn-ink, #08221a);
    border: 0; border-radius: 2em; font-size: 0.78em; font-weight: 700; cursor: pointer;
    font-family: inherit; display: none; white-space: nowrap;
  }
  .qz-go.show { display: inline-block; }
  /* Staggered entrance — each element rises in like a designed reveal. */
  .qz-anim { opacity: 0; transform: translateY(0.8em); transition: opacity 0.45s ease, transform 0.45s ease; }
  .qz-anim.in { opacity: 1; transform: translateY(0); }
`;

const QUIZ_SCENE_HTML = `
      <div class="qz-frame" id="qz-frame">
        <div class="qz-deco">?</div>
        <div class="qz-rule qz-anim"></div>
        <div class="qz-eyebrow qz-anim" id="qz-eyebrow">Check your understanding</div>
        <div class="qz-q qz-anim" id="qz-q"></div>
        <div class="qz-opts" id="qz-opts"></div>
        <div class="qz-foot">
          <div class="qz-fb" id="qz-fb"></div>
          <button class="qz-go" id="qz-submit">Submit</button>
          <button class="qz-go" id="qz-go">Continue &#9656;</button>
        </div>
      </div>
`;

/** The quiz engine: window.__quizEngine.render(cue, ctx) fills the scene,
 *  wires interactions, opens it with staggered entrances, and reports via
 *  ctx.onSettle(right) / ctx.onContinue(). Host supplies scene sizing. */
const QUIZ_ENGINE_JS = `
window.__quizEngine = (function() {
  function hexToRgba(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(255,255,255,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function isDark(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return true;
    var n = parseInt(m[1], 16);
    return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) < 140;
  }
  function applyPalette(overlay, style) {
    var s = style || {};
    var bg = s.bg || '#101418', ink = s.ink || '#EEF2F5', accent = s.accent || '#22D3EE';
    overlay.style.setProperty('--q-bg', bg);
    overlay.style.setProperty('--q-ink', ink);
    overlay.style.setProperty('--q-muted', s.muted || '#8B98A5');
    overlay.style.setProperty('--q-accent', accent);
    overlay.style.setProperty('--q-surface', s.surface || (isDark(bg) ? 'rgba(255,255,255,0.07)' : '#FFFFFF'));
    overlay.style.setProperty('--q-line', hexToRgba(ink, 0.16));
    overlay.style.setProperty('--q-accent-soft', hexToRgba(accent, 0.13));
    overlay.style.setProperty('--q-accent-faint', hexToRgba(accent, isDark(bg) ? 0.08 : 0.07));
    overlay.style.setProperty('--q-btn-ink', isDark(accent) ? '#FFFFFF' : '#101418');
  }
  // Render "x^2" / "y^-9" with real superscripts — the videos typeset
  // exponents properly, so the quiz must too or the takeover breaks.
  // DOM-built (text nodes + <sup>), never innerHTML.
  function renderRich(el, text) {
    el.textContent = '';
    var parts = String(text || '').split(/\\^(-?[0-9a-zA-Z]+)/);
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 0) { el.appendChild(document.createTextNode(parts[i])); }
      else { var s = document.createElement('sup'); s.textContent = parts[i]; el.appendChild(s); }
    }
  }
  var EYEBROWS = {
    multiple_choice: 'Check your understanding',
    true_false: 'True or false?',
    multi_select: 'Select all that apply',
    fill_in: 'Type your answer',
    hotspot: 'Find it in the image'
  };
  function normalize(s) { return String(s || '').toLowerCase().replace(/\\s+/g, ''); }

  function render(cue, ctx) {
    var overlay = ctx.overlay;
    applyPalette(overlay, cue.style);
    var qtype = cue.quiz.type || 'multiple_choice';
    if (!EYEBROWS[qtype]) qtype = 'multiple_choice';        // unknown types fall back
    if (qtype === 'true_false' && !(cue.quiz.options || []).length) {
      cue.quiz.options = [{ id: 't', text: 'True' }, { id: 'f', text: 'False' }];
    }
    var q = function(sel) { return overlay.querySelector(sel); };
    q('#qz-eyebrow').textContent = cue.quiz.eyebrow || EYEBROWS[qtype];
    renderRich(q('#qz-q'), cue.quiz.question);
    var fb = q('#qz-fb'), go = q('#qz-go'), submit = q('#qz-submit');
    fb.textContent = '';
    go.classList.remove('show');
    submit.classList.remove('show');
    var box = q('#qz-opts');
    box.className = 'qz-opts' + (qtype === 'true_false' ? ' tf' : qtype === 'fill_in' ? ' fi' : qtype === 'hotspot' ? ' hs' : '');
    box.innerHTML = '';
    var answered = false;
    var selected = {};
    var letters = 'ABCDEFGH';

    function settle(right, feedbackText) {
      answered = true;
      renderRich(fb, feedbackText);
      Array.prototype.forEach.call(box.querySelectorAll('button, input'), function(el) { el.disabled = true; });
      submit.classList.remove('show');
      go.classList.add('show');
      ctx.onSettle(right);
    }

    if (qtype === 'fill_in') {
      // Typed answer. Accepted answers = options with isCorrect: text match
      // (case/whitespace-insensitive) or numericValue ± numericTolerancePct.
      var input = document.createElement('input');
      input.className = 'qz-input qz-anim';
      input.placeholder = 'Type your answer\\u2026';
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('spellcheck', 'false');
      box.appendChild(input);
      var grade = function() {
        if (answered) return;
        var raw = input.value;
        if (!normalize(raw)) { fb.textContent = 'Type an answer first.'; return; }
        var accepted = (cue.quiz.options || []).filter(function(o) { return o.isCorrect; });
        var hit = null;
        for (var i = 0; i < accepted.length; i++) {
          var o = accepted[i];
          if (normalize(o.text) === normalize(raw)) { hit = o; break; }
          if (o.numericValue != null) {
            var v = parseFloat(raw.replace(/[^0-9.eE+-]/g, ''));
            var tol = Math.abs(o.numericValue) * ((o.numericTolerancePct || 0) / 100) + 1e-9;
            if (!isNaN(v) && Math.abs(v - o.numericValue) <= tol) { hit = o; break; }
          }
        }
        var right = !!hit;
        input.classList.add(right ? 'correct' : 'wrong');
        if (!right && accepted.length) {
          var chip = document.createElement('span');
          chip.className = 'qz-answer-chip';
          var kk = document.createElement('span');
          kk.className = 'k';
          kk.textContent = '\\u2713';
          var body = document.createElement('span');
          renderRich(body, accepted[0].text);
          chip.appendChild(kk);
          chip.appendChild(body);
          box.appendChild(chip);
        }
        settle(right, (hit && hit.feedback) || (right
          ? (cue.quiz.correctFeedback || 'Correct.')
          : (cue.quiz.wrongFeedback || 'Not quite \\u2014 the accepted answer is shown.')));
      };
      submit.classList.add('show');
      submit.onclick = grade;
      input.addEventListener('keydown', function(e) { if (e.key === 'Enter') grade(); });
      setTimeout(function() { input.focus(); }, 700);
    }
    else if (qtype === 'hotspot') {
      // The image is the question canvas. Options carry region {x,y,w,h}
      // in percent of the image; clicking inside a correct region wins.
      var wrap = document.createElement('div');
      wrap.className = 'qz-hs-wrap qz-anim';
      var img = document.createElement('img');
      img.src = cue.quiz.image || '';
      img.alt = '';
      wrap.appendChild(img);
      box.appendChild(wrap);
      wrap.addEventListener('click', function(e) {
        if (answered) return;
        var r = wrap.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width * 100;
        var py = (e.clientY - r.top) / r.height * 100;
        var hit = null;
        (cue.quiz.options || []).forEach(function(o) {
          var g = o.region;
          if (g && px >= g.x && px <= g.x + g.w && py >= g.y && py <= g.y + g.h && !hit) hit = o;
        });
        var right = !!(hit && hit.isCorrect);
        var dot = document.createElement('div');
        dot.className = 'qz-hs-dot ' + (right ? 'correct' : 'wrong');
        dot.style.left = px + '%';
        dot.style.top = py + '%';
        wrap.appendChild(dot);
        if (!right) {
          // Reveal every correct region so the learner sees what they missed.
          (cue.quiz.options || []).forEach(function(o) {
            if (o.isCorrect && o.region) {
              var reg = document.createElement('div');
              reg.className = 'qz-hs-region';
              reg.style.left = o.region.x + '%';
              reg.style.top = o.region.y + '%';
              reg.style.width = o.region.w + '%';
              reg.style.height = o.region.h + '%';
              wrap.appendChild(reg);
            }
          });
        }
        wrap.classList.add('done');
        settle(right, (hit && hit.feedback) || (right
          ? (cue.quiz.correctFeedback || 'Correct.')
          : (cue.quiz.wrongFeedback || 'Not quite \\u2014 the highlighted area is what you were looking for.')));
      });
    }
    else {
      (cue.quiz.options || []).forEach(function(opt, i) {
        var b = document.createElement('button');
        b.className = 'qz-opt qz-anim';
        var k = document.createElement('span');
        k.className = 'k';
        k.textContent = letters.charAt(i);
        var body = document.createElement('span');
        renderRich(body, opt.text);
        b.appendChild(k);
        b.appendChild(body);
        if (qtype === 'multi_select') {
          b.onclick = function() {
            if (answered) return;
            selected[i] = !selected[i];
            b.classList.toggle('sel', !!selected[i]);
          };
        }
        else {
          // multiple_choice and true_false: one click answers.
          b.onclick = function() {
            if (answered) return;
            var right = !!opt.isCorrect;
            b.classList.add(right ? 'correct' : 'wrong');
            if (!right) {
              Array.prototype.forEach.call(box.children, function(el, j) {
                if (cue.quiz.options[j] && cue.quiz.options[j].isCorrect) el.classList.add('correct');
              });
            }
            settle(right, opt.feedback || (right ? 'Correct.' : 'Not quite \\u2014 the highlighted answer is correct.'));
          };
        }
        box.appendChild(b);
      });
      if (qtype === 'multi_select') {
        submit.classList.add('show');
        submit.onclick = function() {
          if (answered) return;
          var any = false;
          for (var i = 0; i < cue.quiz.options.length; i++) if (selected[i]) any = true;
          if (!any) { fb.textContent = 'Select at least one answer.'; return; }
          var right = cue.quiz.options.every(function(o, i) { return !!o.isCorrect === !!selected[i]; });
          Array.prototype.forEach.call(box.children, function(el, i) {
            var o = cue.quiz.options[i];
            el.classList.remove('sel');
            if (selected[i] && o.isCorrect) el.classList.add('correct');
            else if (selected[i] && !o.isCorrect) el.classList.add('wrong');
            else if (!selected[i] && o.isCorrect) el.classList.add('correct'); // reveal missed
          });
          settle(right, right
            ? (cue.quiz.correctFeedback || 'Correct \\u2014 you found them all.')
            : (cue.quiz.wrongFeedback || 'Not quite \\u2014 the full correct set is highlighted.'));
        };
      }
    }

    go.onclick = function() { ctx.onContinue(); };
    // Crossfade in, then stagger the reveals — same rhythm as a designed
    // beat, not a dialog popping open.
    overlay.classList.add('open');
    var anims = overlay.querySelectorAll('.qz-anim');
    Array.prototype.forEach.call(anims, function(el) { el.classList.remove('in'); });
    requestAnimationFrame(function() {
      overlay.classList.add('visible');
      Array.prototype.forEach.call(anims, function(el, i) {
        setTimeout(function() { el.classList.add('in'); }, 380 + i * 110);
      });
    });
  }
  return { render: render, applyPalette: applyPalette };
})();
`;

/**
 * Player HTML wrapper. Full-viewport <video> that:
 *   - Calls scorm.connect() on load
 *   - Marks completed when the video ends
 *   - Marks incomplete + disconnects on unload
 *   - Records session_time via native LMS clock (no manual tracking needed)
 */
function buildPlayerHtml(lesson: { title: string }, quizzes: ScormQuizCue[]): string {
  const title = htmlEscape(lesson.title);
  const quizJson = JSON.stringify(quizzes).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<script src="scorm-api.js"></script>
<style>
  html, body { margin: 0; padding: 0; background: #0a0a0a; color: #eee; font-family: system-ui, -apple-system, sans-serif; height: 100%; overflow: hidden; }
  .stage { position: relative; width: 100vw; height: 100vh; }
  video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
  .title-badge {
    position: absolute; top: 16px; left: 20px;
    font-size: 13px; color: rgba(255,255,255,0.55);
    background: rgba(0,0,0,0.4); padding: 6px 12px; border-radius: 6px;
    pointer-events: none;
    max-width: calc(100vw - 40px);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .status {
    position: absolute; bottom: 58px; right: 20px;
    font-size: 12px; color: rgba(255,255,255,0.5);
    background: rgba(0,0,0,0.5); padding: 4px 10px; border-radius: 6px;
    pointer-events: none;
  }
  .status.complete { color: #34D399; }
  /* ── Custom control bar ──────────────────────────────────────
     Native controls are replaced entirely: they can't host quiz
     markers on the seekbar, they fight seek-gating, and their
     fullscreen button fullscreens the bare <video> (hiding the
     quiz). PlayPosit-style: markers show upcoming interactions,
     forward seeking is clamped at the first unanswered quiz. */
  .bar {
    position: absolute; left: 0; right: 0; bottom: 0; z-index: 5;
    display: flex; align-items: center; gap: 14px; padding: 18px 18px 12px;
    background: linear-gradient(transparent, rgba(0,0,0,0.72));
    opacity: 1; transition: opacity 0.25s ease;
  }
  .bar.hidden { opacity: 0; pointer-events: none; }
  .cbtn {
    background: none; border: 0; color: #fff; cursor: pointer;
    font-size: 15px; line-height: 1; padding: 6px; opacity: 0.85; min-width: 30px;
  }
  .cbtn:hover { opacity: 1; }
  .ctime { font-size: 12px; color: rgba(255,255,255,0.85); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .track { position: relative; flex: 1; height: 22px; cursor: pointer; touch-action: none; }
  .track::before {
    content: ''; position: absolute; left: 0; right: 0; top: 9.5px; height: 3px;
    background: rgba(255,255,255,0.28); border-radius: 2px;
  }
  .track-fill { position: absolute; left: 0; top: 9.5px; height: 3px; background: #34D399; border-radius: 2px; width: 0; }
  .qmark {
    position: absolute; top: 6px; width: 10px; height: 10px; border-radius: 50%;
    background: #0a0a0a; border: 2px solid #fff; box-sizing: border-box;
    transform: translateX(-50%); pointer-events: none;
  }
  .qmark.done { background: #34D399; border-color: #34D399; }
${QUIZ_SCENE_CSS}
</style>
</head>
<body>
  <div class="stage">
    <div class="title-badge">${title}</div>
    <video id="v" src="master.mp4" autoplay preload="metadata" playsinline></video>
    <div class="bar" id="bar">
      <button class="cbtn" id="c-play" title="Play/pause (space)">&#9654;</button>
      <span class="ctime" id="c-time">0:00 / 0:00</span>
      <div class="track" id="c-track">
        <div class="track-fill" id="c-fill"></div>
        <div id="c-marks"></div>
      </div>
      <button class="cbtn" id="c-mute" title="Mute">&#128266;</button>
      <button class="cbtn" id="c-fs" title="Fullscreen (f)">&#x26F6;</button>
    </div>
    <div class="status" id="status">connecting…</div>
    <div class="quiz-scene" id="qz">
${QUIZ_SCENE_HTML}
    </div>
  </div>
<script>
${QUIZ_ENGINE_JS}
</script>
<script>
(function() {
  var QUIZZES = ${quizJson};
  var scorm = window.createScormApi();
  var status = document.getElementById('status');
  var connected = scorm.connect();
  status.textContent = connected ? 'connected · in progress' : 'standalone (no LMS)';

  var video = document.getElementById('v');
  var overlay = document.getElementById('qz');
  var stage = document.querySelector('.stage');
  var completed = false;
  var asked = {};           // cue index -> true once shown
  var done = {};            // cue index -> true once ANSWERED (gates seeking)
  var correctCount = 0;
  var answeredCount = 0;

  // ── Custom controls: play/seek/time/mute/fullscreen ─────────
  var bar = document.getElementById('bar');
  var playBtn = document.getElementById('c-play');
  var timeEl = document.getElementById('c-time');
  var track = document.getElementById('c-track');
  var fillEl = document.getElementById('c-fill');
  var marksEl = document.getElementById('c-marks');
  var muteBtn = document.getElementById('c-mute');

  function fmt(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  // Seek gate: forward seeking is clamped at the first UNANSWERED quiz cue
  // (backward always free). Landing on the cue re-triggers the quiz on play.
  function firstUnanswered() {
    var m = Infinity;
    for (var i = 0; i < QUIZZES.length; i++) {
      if (!done[i] && QUIZZES[i].atSec < m) m = QUIZZES[i].atSec;
    }
    return m;
  }
  function gatedSeek(t) {
    var lim = firstUnanswered();
    if (lim !== Infinity && t > lim) t = lim;
    video.currentTime = Math.max(0, Math.min(t, video.duration || t));
  }
  // Backstop for any seek path that bypasses gatedSeek.
  video.addEventListener('seeking', function() {
    var lim = firstUnanswered();
    if (lim !== Infinity && video.currentTime > lim + 0.01) video.currentTime = lim;
  });

  function buildMarkers() {
    if (!video.duration) return;
    marksEl.innerHTML = '';
    QUIZZES.forEach(function(c, i) {
      var d = document.createElement('div');
      d.className = 'qmark' + (done[i] ? ' done' : '');
      d.style.left = (c.atSec / video.duration * 100) + '%';
      d.title = 'Question' + (done[i] ? ' · answered' : '');
      marksEl.appendChild(d);
    });
  }
  video.addEventListener('loadedmetadata', buildMarkers);

  function togglePlay() {
    if (overlay.classList.contains('open')) return;
    if (video.paused) video.play(); else video.pause();
  }
  playBtn.onclick = togglePlay;
  video.addEventListener('click', togglePlay);
  video.addEventListener('play', function() { playBtn.innerHTML = '&#10074;&#10074;'; pokeBar(); });
  video.addEventListener('pause', function() { playBtn.innerHTML = '&#9654;'; bar.classList.remove('hidden'); clearTimeout(hideTimer); });

  muteBtn.onclick = function() {
    video.muted = !video.muted;
    muteBtn.innerHTML = video.muted ? '&#128263;' : '&#128266;';
  };

  function trackSeek(e) {
    var r = track.getBoundingClientRect();
    var pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    gatedSeek(pct * (video.duration || 0));
  }
  track.addEventListener('pointerdown', function(e) {
    if (overlay.classList.contains('open')) return;
    trackSeek(e);
    var mv = function(ev) { trackSeek(ev); };
    var up = function() {
      document.removeEventListener('pointermove', mv);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', mv);
    document.addEventListener('pointerup', up);
  });

  video.addEventListener('timeupdate', function() {
    if (video.duration) fillEl.style.width = (video.currentTime / video.duration * 100) + '%';
    timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
  });

  // Auto-hide while playing; always visible when paused or quizzing ends.
  var hideTimer = null;
  function pokeBar() {
    bar.classList.remove('hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function() {
      if (!video.paused && !overlay.classList.contains('open')) bar.classList.add('hidden');
    }, 2600);
  }
  stage.addEventListener('mousemove', pokeBar);
  stage.addEventListener('touchstart', pokeBar, { passive: true });

  document.addEventListener('keydown', function(e) {
    if (overlay.classList.contains('open')) return;
    if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { gatedSeek(video.currentTime - 5); pokeBar(); }
    else if (e.key === 'ArrowRight') { gatedSeek(video.currentTime + 5); pokeBar(); }
    else if (e.key === 'f') { fsToggle(); }
  });

  // ── Seamless quiz scene ─────────────────────────────────────
  // The scene background covers the whole stage; the content frame sits
  // in the video's rendered 16:9 content box so layout proportions match
  // the beats exactly.
  var frame = document.getElementById('qz-frame');
  function fitSceneToVideo() {
    var W = video.clientWidth, H = video.clientHeight;
    var ar = (video.videoWidth && video.videoHeight) ? video.videoWidth / video.videoHeight : 16 / 9;
    var w = Math.min(W, H * ar), h = w / ar;
    var x = video.offsetLeft + (W - w) / 2, y = video.offsetTop + (H - h) / 2;
    frame.style.left = x + 'px'; frame.style.top = y + 'px';
    frame.style.width = w + 'px'; frame.style.height = h + 'px';
    overlay.style.fontSize = (w / 42) + 'px'; // em unit ≈ the beats' design scale
  }
  window.addEventListener('resize', function() {
    if (overlay.classList.contains('open')) fitSceneToVideo();
  });

  // ── Fullscreen: always fullscreen the STAGE, never the video element.
  // A fullscreened <video> renders nothing but itself, so the quiz scene
  // would be invisible until the learner exits — controls are fully
  // custom so the only fullscreen path is ours; any video-element
  // fullscreen that still slips through is redirected to the stage.
  function fsToggle() {
    if (document.fullscreenElement) { document.exitFullscreen(); }
    else if (stage.requestFullscreen) { stage.requestFullscreen(); }
  }
  document.getElementById('c-fs').onclick = fsToggle;
  document.addEventListener('fullscreenchange', function() {
    if (document.fullscreenElement === video) {
      document.exitFullscreen().then(function() {
        if (stage.requestFullscreen) stage.requestFullscreen();
      }).catch(function() {});
    }
    if (overlay.classList.contains('open')) fitSceneToVideo();
  });

  function showQuiz(cue, idx) {
    asked[idx] = true;
    video.pause();
    // Last-resort guard: if the video element itself is fullscreen right
    // now (Safari's native video fullscreen can't be stripped), pull out
    // of it so the scene is actually visible when it opens.
    if (document.fullscreenElement === video) document.exitFullscreen().catch(function() {});
    if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) video.webkitExitFullscreen();
    fitSceneToVideo();
    bar.classList.add('hidden');
    clearTimeout(hideTimer);
    // The shared engine renders the scene + interactions; the player only
    // does the video-side bookkeeping (score, seek gate, markers, resume).
    window.__quizEngine.render(cue, {
      overlay: overlay,
      onSettle: function(right) {
        answeredCount++;
        done[idx] = true;    // unlocks forward seeking past this cue
        buildMarkers();      // marker flips to answered state
        if (right) correctCount++;
      },
      onContinue: function() {
        overlay.classList.remove('visible'); // crossfade back to the paused frame…
        setTimeout(function() {
          overlay.classList.remove('open');
          video.play();                      // …then the video carries on.
          pokeBar();
        }, 360);
      }
    });
  }

  if (QUIZZES.length > 0) {
    video.addEventListener('timeupdate', function() {
      if (overlay.classList.contains('open')) return;
      for (var i = 0; i < QUIZZES.length; i++) {
        if (!asked[i] && video.currentTime >= QUIZZES[i].atSec) {
          showQuiz(QUIZZES[i], i);
          break;
        }
      }
    });
  }

  video.addEventListener('ended', function() {
    if (completed) return;
    completed = true;
    var pct = QUIZZES.length > 0 && answeredCount > 0
      ? Math.round((correctCount / QUIZZES.length) * 100)
      : 100; // plain video: watching to the end is full marks
    if (connected) {
      scorm.setStatus('completed');
      scorm.setScore(0, 100, pct);
      scorm.commit();
    }
    status.textContent = QUIZZES.length > 0
      ? 'complete · score ' + pct + '% (' + correctCount + '/' + QUIZZES.length + ')'
      : 'complete';
    status.classList.add('complete');
  });

  window.addEventListener('beforeunload', function() {
    if (!connected) return;
    if (!completed) scorm.setStatus('incomplete');
    scorm.commit();
    scorm.disconnect();
  });
})();
</script>
</body>
</html>
`;
}

/**
 * Standalone quiz style gallery — a single HTML file for viewing and
 * evolving quiz styles WITHOUT a video. Same CSS + engine as the SCORM
 * player, so what you approve here is exactly what ships in lessons.
 * Chrome: style buttons + palette switcher + a fixed 16:9 stage.
 */
export function buildQuizStyleGallery(demos: Array<{ label: string; cue: ScormQuizCue }>): string {
  const demosJson = JSON.stringify(demos).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Quiz style gallery</title>
<style>
  html, body { margin: 0; padding: 0; background: #0e1013; color: #e7e9ec; font-family: system-ui, -apple-system, sans-serif; min-height: 100%; }
  .chrome { max-width: 1240px; margin: 0 auto; padding: 22px 24px 40px; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .sub { font-size: 12.5px; color: #8a919c; margin-bottom: 18px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 16px; }
  .demo-btn {
    padding: 8px 14px; border-radius: 8px; border: 1px solid #2a2f37; cursor: pointer;
    background: #171a1f; color: #e7e9ec; font-size: 13px; font-family: inherit;
  }
  .demo-btn:hover { border-color: #4b5563; }
  .demo-btn.active { border-color: #34D399; color: #34D399; }
  select {
    padding: 8px 10px; border-radius: 8px; border: 1px solid #2a2f37;
    background: #171a1f; color: #e7e9ec; font-size: 13px; font-family: inherit; margin-left: auto;
  }
  .stage-wrap { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; border: 1px solid #2a2f37; background: #000; }
  .hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #6b7280; font-size: 14px; }
${QUIZ_SCENE_CSS}
  .quiz-scene { z-index: 2; }
  .qz-frame { inset: 0; }
</style>
</head>
<body>
  <div class="chrome">
    <h1>Quiz style gallery</h1>
    <div class="sub">Same engine + CSS the SCORM player ships — what you approve here is what learners see. Pick a style, switch palettes, answer right and wrong.</div>
    <div class="row" id="demo-row"></div>
    <div class="stage-wrap" id="stage">
      <div class="hint" id="hint">Pick a quiz style above</div>
      <div class="quiz-scene" id="qz">
${QUIZ_SCENE_HTML}
      </div>
    </div>
  </div>
<script>
${QUIZ_ENGINE_JS}
</script>
<script>
(function() {
  var DEMOS = ${demosJson};
  var PALETTES = {
    "swiss-grid":    { bg: "#FAFAF7", ink: "#111111", muted: "#6B6B66", accent: "#DC2626", surface: "#FFFFFF" },
    "kinetic-pop":   { bg: "#F7F8FA", ink: "#0B1220", muted: "#5B6472", accent: "#2563EB", surface: "#FFFFFF" },
    "warm-grain":    { bg: "#FBF6EE", ink: "#221A10", muted: "#7A6E5C", accent: "#D97706", surface: "#FFFDF8" },
    "paper-mark":    { bg: "#F6F1E7", ink: "#1F1B14", muted: "#75705F", accent: "#166534", surface: "#FBF8F1" },
    "magnetic-flow": { bg: "#F6F4FB", ink: "#17131F", muted: "#6E6880", accent: "#7C3AED", surface: "#FFFFFF" },
    "liquid-glass":  { bg: "#0B1B2B", ink: "#F4F8FB", muted: "#93A7B8", accent: "#2DD4BF", surface: "rgba(255,255,255,0.07)" },
    "neon-grid":     { bg: "#101418", ink: "#EEF2F5", muted: "#8B98A5", accent: "#22D3EE", surface: "#171C22" }
  };
  var stage = document.getElementById('stage');
  var overlay = document.getElementById('qz');
  var hint = document.getElementById('hint');
  var row = document.getElementById('demo-row');
  var current = -1;
  var palette = 'swiss-grid';

  function fit() {
    overlay.style.fontSize = (stage.clientWidth / 42) + 'px';
  }
  window.addEventListener('resize', fit);

  function open(i) {
    current = i;
    Array.prototype.forEach.call(row.querySelectorAll('.demo-btn'), function(b, j) {
      b.classList.toggle('active', j === i);
    });
    hint.style.display = 'none';
    fit();
    // Deep-copy the cue so retakes start clean, then apply the chosen palette.
    var cue = JSON.parse(JSON.stringify(DEMOS[i].cue));
    cue.style = PALETTES[palette];
    overlay.classList.remove('visible');
    overlay.classList.remove('open');
    setTimeout(function() {
      window.__quizEngine.render(cue, {
        overlay: overlay,
        onSettle: function() {},
        onContinue: function() {
          overlay.classList.remove('visible');
          setTimeout(function() {
            overlay.classList.remove('open');
            hint.style.display = 'flex';
            hint.textContent = 'Answered — pick a style (or the same one) to run it again';
          }, 360);
        }
      });
    }, 60);
  }

  DEMOS.forEach(function(d, i) {
    var b = document.createElement('button');
    b.className = 'demo-btn';
    b.textContent = d.label;
    b.onclick = function() { open(i); };
    row.appendChild(b);
  });
  var sel = document.createElement('select');
  Object.keys(PALETTES).forEach(function(name) {
    var o = document.createElement('option');
    o.value = name; o.textContent = 'palette: ' + name;
    sel.appendChild(o);
  });
  sel.onchange = function() { palette = sel.value; if (current >= 0) open(current); };
  row.appendChild(sel);
  fit();
})();
</script>
</body>
</html>
`;
}

// The SCORM API wrapper — same content as packages/scorm-player/src/assets/scorm-api.js.
// Duplicated here so scorm-packager is self-contained. If the player-side file
// diverges, mirror the update here.
const SCORM_API_JS = `(function(g){function findApi(){var w=window;for(var d=0;d<7;d++){if(w.API_1484_11)return{api:w.API_1484_11,version:'2004'};if(w.parent===w)break;w=w.parent}w=window;for(var d=0;d<7;d++){if(w.API)return{api:w.API,version:'1.2'};if(w.parent===w)break;w=w.parent}return null}
function createScormApi(){var f=null;return{connect:function(){f=findApi();if(!f){console.warn('[scorm] no LMS API found; standalone');return false}var ok=f.version==='2004'?f.api.Initialize(''):f.api.LMSInitialize('');return ok==='true'||ok===true},
disconnect:function(){if(!f)return;if(f.version==='2004')f.api.Terminate('');else f.api.LMSFinish('')},
getLearnerId:function(){if(!f)return null;return f.version==='2004'?f.api.GetValue('cmi.learner_id'):f.api.LMSGetValue('cmi.core.student_id')},
setStatus:function(s){if(!f)return;var k=f.version==='2004'?'cmi.completion_status':'cmi.core.lesson_status';if(f.version==='2004')f.api.SetValue(k,s);else f.api.LMSSetValue(k,s)},
setScore:function(min,max,raw){if(!f)return;if(f.version==='2004'){f.api.SetValue('cmi.score.min',String(min));f.api.SetValue('cmi.score.max',String(max));f.api.SetValue('cmi.score.raw',String(raw));f.api.SetValue('cmi.score.scaled',String(raw/Math.max(1,max)))}else{f.api.LMSSetValue('cmi.core.score.min',String(min));f.api.LMSSetValue('cmi.core.score.max',String(max));f.api.LMSSetValue('cmi.core.score.raw',String(raw))}},
commit:function(){if(!f)return;if(f.version==='2004')f.api.Commit('');else f.api.LMSCommit('')}}}
g.createScormApi=createScormApi})(window);`;

// ─── Types ──────────────────────────────────────────────────────────

/** One interactive quiz, cued to a timestamp in the master video. */
export interface ScormQuizCue {
  /** Seconds into the master video where the player pauses and asks. */
  atSec: number;
  beatKey: string;
  quiz: {
    /** "multiple_choice" (default) | "true_false" | "multi_select" |
     *  "fill_in" | "hotspot". Types follow H5P Interactive Video's data
     *  model, rendered in our palette scenes. Unknown types fall back to
     *  multiple_choice. */
    type: string;
    question: string;
    /** Overrides the type's default eyebrow label. */
    eyebrow?: string;
    /** hotspot only: the image that is the question canvas (URL or data URI). */
    image?: string;
    options: Array<{
      id: string;
      text: string;
      isCorrect?: boolean;
      feedback?: string;
      /** fill_in: numeric accepted answer with percent tolerance. */
      numericValue?: number;
      numericTolerancePct?: number;
      /** hotspot: clickable region in percent of the image. */
      region?: { x: number; y: number; w: number; h: number };
    }>;
    /** Whole-question feedback (multi_select / fill_in / hotspot — per-option
     *  feedback doesn't fit set/typed/spatial answers). Field names match
     *  @lp/shared QuizSpec. */
    correctFeedback?: string;
    wrongFeedback?: string;
  };
  /** The beat's style palette (same CSS vars the designer rendered the video
   *  with). When present, the quiz scene takes over the frame in these colors
   *  so it reads as the next sub-scene of the video. Omitted = neutral dark. */
  style?: { bg: string; ink: string; muted: string; accent: string; surface: string };
}

export interface ScormBuildInput {
  lesson: Pick<Lesson, "id" | "title" | "summary">;
  /** Beats aren't required for a plain master-video SCO but accepted for future use. */
  beats?: Beat[];
  /** Raw MP4 bytes of the master video. */
  masterMp4: Buffer;
  /** Interactive quiz cues — the player pauses at each, asks, records, resumes.
   *  Answers roll up into the SCORM score; empty/omitted = plain video SCO. */
  quizzes?: ScormQuizCue[];
  /** Optional branding. */
  branding?: {
    organizationName?: string;
  };
  /** SCORM version target. 2004 4th Ed is the default and recommended. */
  version?: "2004_4";
}

export interface ScormBuildOutput {
  /** The zip bytes. */
  zip: Buffer;
  sizeBytes: number;
  sha256: string;
  /** The player page, also returned unzipped so callers can host a
   *  shareable browser preview (rewrite src="master.mp4" to taste). */
  playerHtml: string;
  scormApiJs: string;
}

export interface ScormPackager {
  build(input: ScormBuildInput): Promise<ScormBuildOutput>;
}

// ─── Factory ────────────────────────────────────────────────────────

export function createScormPackager(): ScormPackager {
  return {
    async build(input) {
      const playerHtml = buildPlayerHtml(input.lesson, input.quizzes ?? []);
      const zip = new JSZip();
      zip.file("imsmanifest.xml", buildManifest(input.lesson, { organization: input.branding?.organizationName }));
      zip.file("index.html", playerHtml);
      zip.file("scorm-api.js", SCORM_API_JS);
      zip.file("master.mp4", input.masterMp4);

      const bytes = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      return {
        zip: bytes,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        playerHtml,
        scormApiJs: SCORM_API_JS,
      };
    },
  };
}

// ─── xAPI helpers (unchanged) ───────────────────────────────────────

export const xapi = {
  videoPlay(actorId: string, courseId: string, beatId: string) {
    return baseStatement(actorId, "https://w3id.org/xapi/video/verbs/played", { courseId, beatId });
  },
  quizAnswered(actorId: string, courseId: string, beatId: string, optionId: string, correct: boolean) {
    return baseStatement(actorId, "http://adlnet.gov/expapi/verbs/answered", { courseId, beatId, optionId, correct });
  },
  beatReplayed(actorId: string, courseId: string, beatId: string, replayCount: number) {
    return baseStatement(actorId, "https://learning-platform.internal/verbs/replayed", { courseId, beatId, replayCount });
  },
  callbackPressed(actorId: string, courseId: string, fromBeatId: string, toBeatId: string) {
    return baseStatement(actorId, "https://learning-platform.internal/verbs/referenced", { courseId, fromBeatId, toBeatId });
  },
};

function baseStatement(actorId: string, verbId: string, payload: Record<string, unknown>) {
  return {
    actor: { account: { name: actorId, homePage: "https://learning-platform.internal" } },
    verb: { id: verbId },
    object: { id: `https://learning-platform.internal/object/${actorId}` },
    timestamp: new Date().toISOString(),
    context: { extensions: { "https://learning-platform.internal/data": payload } },
  };
}

// ─── Small XML/HTML escape utils ────────────────────────────────────

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
}
function htmlEscape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
