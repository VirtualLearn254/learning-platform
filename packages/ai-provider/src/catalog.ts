/**
 * Model catalog + pricing.
 *
 * Catalog = the set of model ids the UI offers as choices per provider.
 * Prices = $ per 1M input/output tokens. Hardcoded because rate-card files
 * are stable for months at a time; update when providers shift pricing.
 *
 * The `local` provider has no fixed catalog because vLLM serves whatever
 * weights you boot it with — so the UI lets you free-text the model id.
 *
 * Last updated: 2026-Q2 — check provider docs if costs look off.
 */

import type { ProviderId } from "./profiles.js";

export interface ModelInfo {
  id: string;
  displayName: string;
  /** $ per 1M input tokens. */
  inputPer1M: number;
  /** $ per 1M output tokens. */
  outputPer1M: number;
  supportsVision?: boolean;
  /** Loose "speed tier" for the UI to hint at perceived latency. */
  speed?: "fast" | "balanced" | "slow";
  /** Loose "quality tier". */
  tier?: "frontier" | "mid" | "cheap";
}

export const MODEL_CATALOG: Record<ProviderId, ModelInfo[]> = {
  anthropic: [
    // Opus 4.5 dropped Opus-class pricing to $5/$25 and 4.8 kept it — the old
    // $15/$75 here made the overspend guard treat Opus as 17× GLM output-cost
    // when it is really ~5.7×.
    { id: "claude-opus-4-8",              displayName: "Claude Opus 4.8",   inputPer1M:  5.0, outputPer1M: 25.0, supportsVision: true,  speed: "slow",      tier: "frontier" },
    { id: "claude-sonnet-4-6",            displayName: "Claude Sonnet 4.6", inputPer1M:  3.0, outputPer1M: 15.0, supportsVision: true,  speed: "balanced",  tier: "mid" },
    { id: "claude-haiku-4-5-20251001",    displayName: "Claude Haiku 4.5",  inputPer1M:  1.0, outputPer1M:  5.0, supportsVision: true,  speed: "fast",      tier: "cheap" },
  ],
  openai: [
    { id: "gpt-4o",                       displayName: "GPT-4o",             inputPer1M:  2.50, outputPer1M: 10.0, supportsVision: true, speed: "balanced", tier: "mid" },
    { id: "gpt-4o-mini",                  displayName: "GPT-4o mini",        inputPer1M:  0.15, outputPer1M:  0.60, supportsVision: true, speed: "fast",     tier: "cheap" },
    { id: "o1",                           displayName: "o1 (reasoning)",     inputPer1M: 15.0,  outputPer1M: 60.0,  supportsVision: false, speed: "slow",    tier: "frontier" },
    { id: "o1-mini",                      displayName: "o1 mini (reasoning)",inputPer1M:  3.0,  outputPer1M: 12.0,  supportsVision: false, speed: "balanced",tier: "mid" },
  ],
  moonshot: [
    // Kimi K3 (Moonshot direct API): native vision, 1M context, near-frontier.
    // Cached input is $0.30/M on Moonshot direct — the big saving for agent loops.
    { id: "kimi-k3", displayName: "Kimi K3 (Moonshot)", inputPer1M: 3.0, outputPer1M: 15.0, supportsVision: true, speed: "balanced", tier: "frontier" },
  ],
  fireworks: [
    { id: "accounts/fireworks/models/glm-5p2", displayName: "GLM 5.2 (Z.ai)", inputPer1M: 1.40, outputPer1M: 4.40, speed: "balanced", tier: "frontier" },
  ],
  deepseek: [
    { id: "deepseek-chat",                displayName: "DeepSeek Chat",      inputPer1M: 0.27, outputPer1M: 1.10, speed: "balanced", tier: "cheap" },
    { id: "deepseek-reasoner",            displayName: "DeepSeek Reasoner",  inputPer1M: 0.55, outputPer1M: 2.19, speed: "slow",     tier: "mid" },
  ],
  local: [
    // Empty by design — the UI lets you type any model id for self-hosted vLLM.
  ],
};

/** Which provider's catalog lists this model id? Lets usage logging price a
 *  call even when the role was overridden to a provider outside its default
 *  preferred chain (e.g. designer → Fireworks GLM). Returns null if unknown. */
export function providerForModel(modelId: string): ProviderId | null {
  for (const [provider, models] of Object.entries(MODEL_CATALOG) as [ProviderId, ModelInfo[]][]) {
    if (models.some((m) => m.id === modelId)) return provider;
  }
  return null;
}

/** Compute USD cost for a call given the model and tokens used. Falls back to
 *  a global model→provider lookup so a mis-attributed provider (inference
 *  guessed wrong) still gets priced from the model's real rate card. */
export function computeCost(providerId: ProviderId, modelId: string, inputTokens: number, outputTokens: number): number {
  let info = MODEL_CATALOG[providerId]?.find((m) => m.id === modelId);
  if (!info) {
    const realProvider = providerForModel(modelId);
    if (realProvider) info = MODEL_CATALOG[realProvider].find((m) => m.id === modelId);
  }
  if (!info) {
    // Genuinely unknown model — return 0 rather than crash the call. The usage
    // row still logs the token counts; cost can be backfilled later.
    return 0;
  }
  return (inputTokens / 1_000_000) * info.inputPer1M + (outputTokens / 1_000_000) * info.outputPer1M;
}
