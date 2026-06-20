/**
 * xapi-emitter.js — queues + posts xAPI statements to our LRS endpoint.
 *
 * In production this might be the parent platform's endpoint reached via
 * an absolute URL — the SCORM package writes the endpoint into the
 * manifest at packaging time.
 *
 * Behavior:
 *   • emit(kind, data) — queue a statement for batch flush
 *   • flush()          — post the queue immediately
 *   • automatic flush on visibilitychange (hidden) + every 5 seconds
 */

(function (global) {
  function createXapiEmitter(config) {
    const queue = [];
    const lessonId = config.lessonId;
    const endpoint = config.endpoint;
    const actorId  = config.actorId;

    function statement(verbId, data) {
      return {
        actor: { account: { name: actorId, homePage: "https://learning-platform.internal" } },
        verb: { id: verbId },
        object: { id: `https://learning-platform.internal/lesson/${lessonId}` },
        timestamp: new Date().toISOString(),
        context: { extensions: { "https://learning-platform.internal/data": { lessonId, ...data } } },
      };
    }

    const VERB = {
      video_play:     "http://adlnet.gov/expapi/verbs/launched",
      video_pause:    "http://adlnet.gov/expapi/verbs/suspended",
      video_seek:     "https://w3id.org/xapi/video/verbs/seeked",
      video_complete: "http://adlnet.gov/expapi/verbs/completed",
      quiz_show:      "http://adlnet.gov/expapi/verbs/asked",
      quiz_answer:    "http://adlnet.gov/expapi/verbs/answered",
      beat_replay:    "https://learning-platform.internal/verbs/replayed",
      callback_press: "https://learning-platform.internal/verbs/referenced",
    };

    function emit(kind, data = {}) {
      const verbId = VERB[kind];
      if (!verbId) return;
      queue.push(statement(verbId, { kind, ...data }));
      if (queue.length >= 25) flush();
    }

    async function flush() {
      if (queue.length === 0) return;
      const batch = queue.splice(0, queue.length);
      try {
        await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(batch),
          keepalive: true,  // survive page unload
        });
      } catch (e) {
        // Re-queue on failure; will retry on next flush.
        queue.unshift(...batch);
        console.warn("[xapi] flush failed; will retry", e);
      }
    }

    setInterval(flush, 5000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });

    return { emit, flush };
  }

  global.createXapiEmitter = createXapiEmitter;
})(window);
