/**
 * Singleton AI client for the API process. Rebuilt every time secrets or
 * profile overrides change so config edits take effect without restart.
 *
 * Every call is logged via the withLogging() wrapper, which inserts a row
 * into ai_usage so the Settings UI can show running totals.
 */

import { createAIClient, type AIClient, type ProviderConfig, withLogging, type UsageEvent } from "@lp/ai-provider";

import { db } from "../db/index.js";
import { aiUsage } from "../db/schema.js";
import { ensureFresh, getProfileOverride } from "./profiles_store.js";
import { getSecret } from "./secrets.js";

async function buildProviderConfig(): Promise<ProviderConfig> {
  const [anthropicKey, anthropicBase, openaiKey, deepseekKey, vllmBase, vllmKey] = await Promise.all([
    getSecret("anthropic_api_key"),
    getSecret("anthropic_base_url"),
    getSecret("openai_api_key"),
    getSecret("deepseek_api_key"),
    getSecret("vllm_base_url"),
    getSecret("vllm_api_key"),
  ]);
  return {
    ...(anthropicKey && { anthropic: { apiKey: anthropicKey, baseUrl: anthropicBase || undefined } }),
    ...(openaiKey    && { openai:    { apiKey: openaiKey } }),
    ...(deepseekKey  && { deepseek:  { apiKey: deepseekKey } }),
    ...(vllmBase     && { vllm:      { baseUrl: vllmBase, apiKey: vllmKey || "vllm-local" } }),
  };
}

async function persistUsage(evt: UsageEvent): Promise<void> {
  await db.insert(aiUsage).values({
    profileId: evt.profileId,
    providerId: evt.providerId,
    modelId: evt.modelId,
    inputTokens: evt.inputTokens,
    outputTokens: evt.outputTokens,
    costUsd: evt.costUsd.toFixed(8),
    durationMs: evt.durationMs,
    status: evt.status,
    errorMessage: evt.errorMessage ?? null,
  });
}

/** Build a fresh logged client. Call this per-request so config changes apply. */
export async function getAIClient(): Promise<AIClient> {
  await ensureFresh();
  const config = await buildProviderConfig();
  const raw = createAIClient(config, getProfileOverride);
  return withLogging(raw, persistUsage);
}

export { buildProviderConfig };
