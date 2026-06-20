"use client";

import { useEffect, useRef, useState } from "react";

interface UseEventStreamOptions {
  /** SSE channel: "beats" | "jobs" | "lessons" | "all" */
  channel?: string;
  /** Map of event type → handler. */
  on: Record<string, (data: Record<string, unknown>) => void>;
  enabled?: boolean;
}

/**
 * Tiny SSE hook. Subscribes to /api/events?channel=..., dispatches typed
 * messages to the right handler. Auto-reconnects on disconnect.
 */
export function useEventStream({ channel = "all", on, enabled = true }: UseEventStreamOptions) {
  const [connected, setConnected] = useState(false);
  const ref = useRef<EventSource | null>(null);
  const handlersRef = useRef(on);
  handlersRef.current = on;

  useEffect(() => {
    if (!enabled) return;
    const url = `/api/events?channel=${encodeURIComponent(channel)}`;
    const es = new EventSource(url);
    ref.current = es;
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("ping", () => { /* heartbeat */ });
    es.onerror = () => setConnected(false);
    for (const [type, handler] of Object.entries(handlersRef.current)) {
      es.addEventListener(type, (e: MessageEvent) => {
        try { handler(JSON.parse(e.data)); }
        catch { /* ignore parse failures */ }
      });
    }
    return () => { es.close(); setConnected(false); };
  }, [channel, enabled]);

  return { connected };
}
