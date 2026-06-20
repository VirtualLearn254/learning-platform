/**
 * Server-Sent Events stream for real-time UI updates.
 *
 * Channels: "beats" (any beat state change), "jobs" (queue events).
 * Both are driven by a simple in-memory pub-sub bus that workers update
 * when they advance a beat/job state. Persistent fan-out (Redis Streams
 * or Postgres LISTEN/NOTIFY) is the production replacement.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { eventBus } from "../lib/event-bus.js";

export const eventsRoute = new Hono()
  .get("/", (c) => {
    return streamSSE(c, async (stream) => {
      const channel = c.req.query("channel") ?? "all";
      const id = Math.random().toString(36).slice(2);
      let alive = true;
      const unsub = eventBus.subscribe(channel, (msg) => {
        if (!alive) return;
        void stream.writeSSE({
          event: msg.type,
          data: JSON.stringify(msg.data),
          id: `${Date.now()}-${id}`,
        });
      });

      // Initial hello so the client knows it's connected.
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ channel, ts: Date.now() }) });

      // Heartbeat every 15s — keeps load balancers + reverse proxies awake.
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: String(Date.now()) });
      }, 15000);

      // Wait until client disconnects.
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          alive = false;
          clearInterval(heartbeat);
          unsub();
          resolve();
        });
      });
    });
  });
