/**
 * Institutional memory: operator/Hermes rules injected into AI prompts.
 *
 * getRulesBlock(scope) returns a ready-to-append prompt section (or "" when
 * no active rules exist). Cached for 30s so per-beat workers don't hammer
 * the table; a saved rule reaches the next AI call almost immediately.
 */

import { and, eq, asc } from "drizzle-orm";

import { db, tables } from "../db/index.js";

export type RuleScope = "author" | "designer" | "reviewer" | "ingest";

const CACHE_TTL_MS = 30_000;
const cache = new Map<RuleScope, { at: number; rules: string[] }>();

export async function getActiveRules(scope: RuleScope): Promise<string[]> {
  const hit = cache.get(scope);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rules;
  const rows = await db.select().from(tables.pipelineRules)
    .where(and(eq(tables.pipelineRules.scope, scope), eq(tables.pipelineRules.active, true)))
    .orderBy(asc(tables.pipelineRules.createdAt));
  const rules = rows.map((r) => r.rule);
  cache.set(scope, { at: Date.now(), rules });
  return rules;
}

export function invalidateRulesCache(): void {
  cache.clear();
}

/** Prompt section appended to the role's system prompt. Empty string when
 *  there are no rules, so callers can always concatenate unconditionally. */
export async function getRulesBlock(scope: RuleScope): Promise<string> {
  const rules = await getActiveRules(scope);
  if (rules.length === 0) return "";
  return `\n\n## OPERATOR RULES (accumulated corrections — these override defaults, follow them exactly)\n${rules.map((r) => `- ${r}`).join("\n")}`;
}
