/**
 * @lp/hermes-bridge — RPC client + server adapter for the Hermes agent.
 *
 * Two directions of communication:
 *   1. App → Hermes: trigger an evolution run, list memories, mark a
 *      suggested style as approved, query the agent's current task.
 *   2. Hermes → App: Hermes' Python scripts call into our API to fetch
 *      lessons, inspect renders, propose style candidates, mark beats for
 *      re-render. The API exposes a thin RPC surface for this in
 *      apps/api/src/routes/hermes.ts.
 *
 * Today these are clean interfaces with placeholder implementations.
 */

export interface HermesMemory {
  id: string;
  kind: "skill" | "observation" | "preference";
  content: string;
  createdAt: string;
}

export interface StyleCandidate {
  id: string;
  name: string;
  description: string;
  /** Why Hermes suggests this style — references it discovered. */
  rationale: string;
  /** Subjects this style is recommended for. */
  recommendedFor: string[];
  /** A preview render of a single beat in the new style. */
  previewMp4Key?: string;
}

export interface EvolutionRunSummary {
  runId: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed";
  beatsReviewed: number;
  stylesProposed: number;
  notes: string;
}

export interface HermesClient {
  /** Trigger an evolution run immediately (alongside the daily cron). */
  triggerEvolutionRun(opts?: { beatLimit?: number }): Promise<{ runId: string }>;
  /** List recent evolution runs. */
  listEvolutionRuns(limit?: number): Promise<EvolutionRunSummary[]>;
  /** List style candidates Hermes has proposed but humans haven't approved yet. */
  listPendingStyleCandidates(): Promise<StyleCandidate[]>;
  /** Approve a style candidate. Moves it into the style library. */
  approveStyle(candidateId: string): Promise<{ ok: boolean }>;
  /** Reject a style candidate (Hermes learns from this signal). */
  rejectStyle(candidateId: string, reason: string): Promise<{ ok: boolean }>;
  /** Recent Hermes memories (so we can introspect what the agent has learned). */
  listMemories(limit?: number): Promise<HermesMemory[]>;
}

export interface HermesConfig {
  rpcUrl: string;
  apiKey?: string;
}

export function createHermesClient(_config: HermesConfig): HermesClient {
  return {
    async triggerEvolutionRun() {
      return { runId: `stub-${Date.now()}` };
    },
    async listEvolutionRuns() {
      return [];
    },
    async listPendingStyleCandidates() {
      return [];
    },
    async approveStyle() {
      return { ok: true };
    },
    async rejectStyle() {
      return { ok: true };
    },
    async listMemories() {
      return [];
    },
  };
}
