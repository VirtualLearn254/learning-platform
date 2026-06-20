/**
 * scorm-api.js — minimal SCORM 1.2 + 2004 wrapper.
 *
 * Locates the parent LMS API on load, exposes a normalized client:
 *   • connect()              → SCORM Initialize
 *   • disconnect()           → SCORM Terminate / Finish
 *   • getLearnerId()         → cmi.learner_id (2004) or cmi.core.student_id (1.2)
 *   • setStatus(status)      → completed / incomplete
 *   • setScore(min, max, raw)
 *   • commit()
 *
 * The window.createScormApi factory is read by player.html on bootstrap.
 * If no SCORM API is found in any parent window, returns a no-op client so
 * the player still runs (handy in dev outside Moodle).
 */

(function (global) {
  function findApi() {
    // SCORM 2004
    let win = window;
    for (let depth = 0; depth < 7; depth++) {
      if (win.API_1484_11) return { api: win.API_1484_11, version: "2004" };
      if (win.parent === win) break;
      win = win.parent;
    }
    // SCORM 1.2 fallback
    win = window;
    for (let depth = 0; depth < 7; depth++) {
      if (win.API) return { api: win.API, version: "1.2" };
      if (win.parent === win) break;
      win = win.parent;
    }
    return null;
  }

  function createScormApi() {
    let found = null;
    return {
      connect() {
        found = findApi();
        if (!found) { console.warn("[scorm] no LMS API found; running standalone"); return false; }
        const ok = found.version === "2004"
          ? found.api.Initialize("")
          : found.api.LMSInitialize("");
        return ok === "true" || ok === true;
      },
      disconnect() {
        if (!found) return;
        if (found.version === "2004") found.api.Terminate("");
        else found.api.LMSFinish("");
      },
      getLearnerId() {
        if (!found) return null;
        return found.version === "2004"
          ? found.api.GetValue("cmi.learner_id")
          : found.api.LMSGetValue("cmi.core.student_id");
      },
      setStatus(status) {
        if (!found) return;
        const key = found.version === "2004" ? "cmi.completion_status" : "cmi.core.lesson_status";
        if (found.version === "2004") found.api.SetValue(key, status);
        else found.api.LMSSetValue(key, status);
      },
      setScore(min, max, raw) {
        if (!found) return;
        if (found.version === "2004") {
          found.api.SetValue("cmi.score.min", String(min));
          found.api.SetValue("cmi.score.max", String(max));
          found.api.SetValue("cmi.score.raw", String(raw));
          found.api.SetValue("cmi.score.scaled", String(raw / Math.max(1, max)));
        } else {
          found.api.LMSSetValue("cmi.core.score.min", String(min));
          found.api.LMSSetValue("cmi.core.score.max", String(max));
          found.api.LMSSetValue("cmi.core.score.raw", String(raw));
        }
      },
      commit() {
        if (!found) return;
        if (found.version === "2004") found.api.Commit("");
        else found.api.LMSCommit("");
      },
    };
  }

  global.createScormApi = createScormApi;
})(window);
