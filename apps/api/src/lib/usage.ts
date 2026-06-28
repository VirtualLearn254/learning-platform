/**
 * AI usage analytics — windowed summaries off the ai_usage table.
 * All queries respect a single `since` cutoff so the UI's time-window
 * selector drives one consistent slice across every panel.
 */

import { sql } from "drizzle-orm";

import { db } from "../db/index.js";

export type UsageWindow = "1h" | "24h" | "7d" | "30d";

const WINDOW_MS: Record<UsageWindow, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function sinceDate(window: UsageWindow): Date {
  return new Date(Date.now() - WINDOW_MS[window]);
}

export interface UsageSummary {
  window: UsageWindow;
  since: string;
  totals: {
    calls: number;
    okCalls: number;
    errorCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    avgLatencyMs: number;
    avgCostUsd: number;
  };
  byProfile: Array<UsageBreakdownRow>;
  byProvider: Array<UsageBreakdownRow>;
  byModel: Array<UsageBreakdownRow>;
  timeSeries: Array<{ bucket: string; calls: number; costUsd: number }>;
}

export interface UsageBreakdownRow {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  share: number; // 0..1, % of total cost in window
}

export async function getUsageSummary(window: UsageWindow): Promise<UsageSummary> {
  const since = sinceDate(window);
  const sinceIso = since.toISOString();

  // 1. Totals
  const totalsRows = await db.execute<{
    calls: number; ok_calls: number; error_calls: number;
    input_tokens: number; output_tokens: number;
    cost_usd: string; avg_latency_ms: number;
  }>(sql`
    SELECT
      COUNT(*)::int                                       AS calls,
      COUNT(*) FILTER (WHERE status = 'ok')::int          AS ok_calls,
      COUNT(*) FILTER (WHERE status = 'error')::int       AS error_calls,
      COALESCE(SUM(input_tokens), 0)::int                 AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::int                AS output_tokens,
      COALESCE(SUM(cost_usd), 0)::numeric                 AS cost_usd,
      COALESCE(AVG(duration_ms)::int, 0)                  AS avg_latency_ms
    FROM ai_usage
    WHERE ts >= ${sinceIso}
  `);
  const t = totalsRows.at(0) ?? { calls: 0, ok_calls: 0, error_calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: "0", avg_latency_ms: 0 };
  const totalCost = Number(t.cost_usd);

  const totals: UsageSummary["totals"] = {
    calls: t.calls,
    okCalls: t.ok_calls,
    errorCalls: t.error_calls,
    inputTokens: t.input_tokens,
    outputTokens: t.output_tokens,
    costUsd: totalCost,
    avgLatencyMs: t.avg_latency_ms,
    avgCostUsd: t.calls > 0 ? totalCost / t.calls : 0,
  };

  // 2. Breakdowns
  async function breakdown(group: "profile_id" | "provider_id" | "model_id"): Promise<UsageBreakdownRow[]> {
    const rows = await db.execute<{
      key: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: string;
    }>(sql`
      SELECT
        ${sql.raw(group)}                          AS key,
        COUNT(*)::int                              AS calls,
        COALESCE(SUM(input_tokens), 0)::int        AS input_tokens,
        COALESCE(SUM(output_tokens), 0)::int       AS output_tokens,
        COALESCE(SUM(cost_usd), 0)::numeric        AS cost_usd
      FROM ai_usage
      WHERE ts >= ${sinceIso}
      GROUP BY ${sql.raw(group)}
      ORDER BY cost_usd DESC
    `);
    return rows.map((r) => {
      const cost = Number(r.cost_usd);
      return {
        key: r.key,
        calls: r.calls,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        costUsd: cost,
        share: totalCost > 0 ? cost / totalCost : 0,
      };
    });
  }

  const [byProfile, byProvider, byModel] = await Promise.all([
    breakdown("profile_id"),
    breakdown("provider_id"),
    breakdown("model_id"),
  ]);

  // 3. Time series — hourly buckets for ≤24h windows, daily otherwise
  const bucket = window === "1h" || window === "24h" ? "hour" : "day";
  const series = await db.execute<{ bucket: string; calls: number; cost_usd: string }>(sql`
    SELECT
      date_trunc(${bucket}, ts)::text  AS bucket,
      COUNT(*)::int                    AS calls,
      COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
    FROM ai_usage
    WHERE ts >= ${sinceIso}
    GROUP BY bucket
    ORDER BY bucket
  `);

  return {
    window,
    since: sinceIso,
    totals,
    byProfile,
    byProvider,
    byModel,
    timeSeries: series.map((r) => ({ bucket: r.bucket, calls: r.calls, costUsd: Number(r.cost_usd) })),
  };
}
