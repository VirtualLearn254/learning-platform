"use client";

import { useEffect, useRef } from "react";

/**
 * Subscribe to the /api/jobs/stream SSE feed. Fires `onChange` the moment
 * any job's status or progress note changes — pages call their SWR mutate()
 * there for instant updates. Existing polling stays as the fallback:
 * if the stream can't connect (proxy buffering, API down), EventSource
 * retries quietly and nothing breaks.
 */
export function useLiveJobs(onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/jobs/stream");
      es.addEventListener("jobs", () => cb.current());
    } catch {
      // EventSource unsupported or blocked — polling covers us.
    }
    return () => es?.close();
  }, []);
}
