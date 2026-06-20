/**
 * @lp/lrs — minimal Learning Record Store (xAPI). Receives statements from the
 * SCORM-packaged player when Moodle runs it. We don't need the full xAPI
 * conformance suite — just a write endpoint + query helpers backed by the
 * `learning_events` table.
 *
 * The API server exposes this via routes/xapi.ts. The web app dashboards
 * call query() to render heatmaps + completion funnels.
 */

export interface XApiStatement {
  /** xAPI actor — we use account.name as the learner id. */
  actor: { account: { name: string; homePage: string } };
  verb: { id: string; display?: Record<string, string> };
  object: { id: string };
  timestamp?: string;
  context?: { extensions?: Record<string, unknown> };
  result?: { score?: { scaled: number }; success?: boolean; completion?: boolean };
}

/** Reduced shape used internally — what we actually store in the events table. */
export interface NormalizedEvent {
  learnerId: string;
  courseId: string;
  beatId?: string;
  eventType: string;
  data: Record<string, unknown>;
  ts: Date;
}

export interface LrsClient {
  /** Accept one statement and return whether it was stored. */
  record(statement: XApiStatement): Promise<{ ok: boolean; eventId?: string; error?: string }>;
  /** Query aggregated metrics for dashboards. */
  query(filter: QueryFilter): Promise<QueryResult>;
}

export interface QueryFilter {
  courseId?: string;
  beatId?: string;
  learnerId?: string;
  eventType?: string;
  from?: Date;
  to?: Date;
  groupBy?: "beat" | "learner" | "day" | "event_type";
  limit?: number;
}

export interface QueryResult {
  rows: Array<Record<string, string | number>>;
  total: number;
}

export interface LrsConfig {
  /** Function the LRS calls to actually persist a normalized event. */
  storeEvent: (event: NormalizedEvent) => Promise<void>;
  /** Function the LRS calls to run aggregation queries. */
  runQuery: (filter: QueryFilter) => Promise<QueryResult>;
}

export function createLrsClient(config: LrsConfig): LrsClient {
  return {
    async record(statement) {
      try {
        const normalized = normalize(statement);
        await config.storeEvent(normalized);
        return { ok: true, eventId: crypto.randomUUID() };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
    async query(filter) {
      return config.runQuery(filter);
    },
  };
}

function normalize(statement: XApiStatement): NormalizedEvent {
  const verbId = statement.verb.id;
  const data = (statement.context?.extensions?.["https://learning-platform.internal/data"] as Record<string, unknown> | undefined) ?? {};
  const eventType = inferEventType(verbId);
  return {
    learnerId: statement.actor.account.name,
    courseId: (data.courseId as string) ?? "",
    beatId: data.beatId as string | undefined,
    eventType,
    data,
    ts: statement.timestamp ? new Date(statement.timestamp) : new Date(),
  };
}

function inferEventType(verbId: string): string {
  if (verbId.endsWith("/played"))     return "video_play";
  if (verbId.endsWith("/paused"))     return "video_pause";
  if (verbId.endsWith("/answered"))   return "quiz_answer";
  if (verbId.endsWith("/completed"))  return "video_complete";
  if (verbId.endsWith("/replayed"))   return "beat_replay";
  if (verbId.endsWith("/referenced")) return "callback_press";
  return "unknown";
}
