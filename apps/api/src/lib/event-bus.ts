/**
 * Tiny in-memory pub-sub. Workers publish state-change events; the SSE
 * endpoint subscribes and forwards to connected browsers.
 *
 * Real-world replacement when we outgrow single-process: Redis Pub/Sub
 * or Postgres LISTEN/NOTIFY. The interface stays identical.
 */

export type EventChannel = "beats" | "jobs" | "lessons" | "all";

export interface BusMessage {
  type: string;
  data: Record<string, unknown>;
}

type Handler = (msg: BusMessage) => void;

class EventBus {
  private subs = new Map<EventChannel, Set<Handler>>();

  subscribe(channel: string, handler: Handler): () => void {
    const ch = (channel === "*" ? "all" : channel) as EventChannel;
    if (!this.subs.has(ch)) this.subs.set(ch, new Set());
    this.subs.get(ch)!.add(handler);
    return () => this.subs.get(ch)?.delete(handler);
  }

  publish(channel: EventChannel, msg: BusMessage) {
    this.subs.get(channel)?.forEach((h) => h(msg));
    this.subs.get("all")?.forEach((h) => h(msg));
  }
}

export const eventBus = new EventBus();

/** Helpers used by workers/routes for consistency. */
export const events = {
  beatStageChanged(beatId: string, fromStage: string, toStage: string) {
    eventBus.publish("beats", { type: "beat:stage_changed", data: { beatId, fromStage, toStage, ts: Date.now() } });
  },
  beatProgressUpdate(beatId: string, percent: number) {
    eventBus.publish("beats", { type: "beat:progress", data: { beatId, percent, ts: Date.now() } });
  },
  lessonPublished(lessonId: string) {
    eventBus.publish("lessons", { type: "lesson:published", data: { lessonId, ts: Date.now() } });
  },
  jobCompleted(jobId: string, queue: string, ok: boolean, errorMessage?: string) {
    eventBus.publish("jobs", { type: "job:completed", data: { jobId, queue, ok, errorMessage, ts: Date.now() } });
  },
};
