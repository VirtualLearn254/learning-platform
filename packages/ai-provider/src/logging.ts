/**
 * withLogging — wrap an AIClient so every chat/vision call emits a usage record.
 *
 * The hook is sync-returning-a-promise (the caller can persist async without
 * blocking the response path). Errors in the hook are swallowed and logged
 * to stderr so a flaky DB write never breaks an AI call.
 */

import type { AIClient, ChatResponse } from "./index.js";
import { profiles, type Profile, type ProviderId } from "./profiles.js";
import { computeCost, providerForModel } from "./catalog.js";

export interface UsageEvent {
  profileId: string;
  providerId: ProviderId | "unknown";
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  status: "ok" | "error";
  errorMessage?: string;
  beatId?: string;
  lessonId?: string;
}

export type UsageHook = (evt: UsageEvent) => void | Promise<void>;

export function withLogging(client: AIClient, hook: UsageHook): AIClient {
  function inferProvider(profileId: string, returnedModel: string): ProviderId | "unknown" {
    const profile = profiles[profileId as Profile];
    if (!profile) return "unknown";
    // Reverse-map by the returned model id. Check EVERY provider the profile
    // can address (modelByProvider), NOT just `preferred` — an operator can
    // override a role to a provider outside its default chain (e.g. designer →
    // Fireworks), and attributing that to preferred[0] mis-prices it to $0.
    for (const [provider, model] of Object.entries(profile.modelByProvider)) {
      if (model === returnedModel) return provider as ProviderId;
    }
    // Still no match? Look the model up in the global catalog (covers any
    // provider, even ones not listed on this profile).
    const global = providerForModel(returnedModel);
    if (global) return global;
    // Last resort — first preferred provider (best guess).
    return profile.preferred[0] ?? "unknown";
  }

  async function emit(profileId: string, started: number, res: ChatResponse | null, err?: unknown, meta?: { beatId?: string; lessonId?: string }) {
    const durationMs = Date.now() - started;
    const evt: UsageEvent = res
      ? {
          profileId,
          providerId: inferProvider(profileId, res.model),
          modelId: res.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          costUsd: 0,
          durationMs,
          status: "ok",
          beatId: meta?.beatId,
          lessonId: meta?.lessonId,
        }
      : {
          profileId,
          providerId: "unknown",
          modelId: "unknown",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          durationMs,
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        };
    if (evt.providerId !== "unknown") {
      evt.costUsd = computeCost(evt.providerId, evt.modelId, evt.inputTokens, evt.outputTokens);
    }
    try {
      await hook(evt);
    } catch (hookErr) {
      console.error("[ai-provider] usage hook threw:", hookErr);
    }
  }

  return {
    async chat(profileId, req) {
      const started = Date.now();
      try {
        const res = await client.chat(profileId, req);
        await emit(profileId, started, res, undefined, req.meta);
        return res;
      } catch (err) {
        await emit(profileId, started, null, err);
        throw err;
      }
    },
    async vision(profileId, req) {
      const started = Date.now();
      try {
        const res = await client.vision(profileId, req);
        await emit(profileId, started, res, undefined, req.meta);
        return res;
      } catch (err) {
        await emit(profileId, started, null, err);
        throw err;
      }
    },
  };
}
