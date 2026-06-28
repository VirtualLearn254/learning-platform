/**
 * withLogging — wrap an AIClient so every chat/vision call emits a usage record.
 *
 * The hook is sync-returning-a-promise (the caller can persist async without
 * blocking the response path). Errors in the hook are swallowed and logged
 * to stderr so a flaky DB write never breaks an AI call.
 */

import type { AIClient, ChatResponse } from "./index.js";
import { profiles, type Profile, type ProviderId } from "./profiles.js";
import { computeCost } from "./catalog.js";

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
}

export type UsageHook = (evt: UsageEvent) => void | Promise<void>;

export function withLogging(client: AIClient, hook: UsageHook): AIClient {
  function inferProvider(profileId: string, returnedModel: string): ProviderId | "unknown" {
    const profile = profiles[profileId as Profile];
    if (!profile) return "unknown";
    // Reverse-map by checking which provider's model id matches.
    for (const provider of profile.preferred) {
      if (profile.modelByProvider[provider] === returnedModel) return provider;
    }
    // Returned model didn't match any provider's expected id — fall back to
    // the first provider in the preference order (best guess).
    return profile.preferred[0] ?? "unknown";
  }

  async function emit(profileId: string, started: number, res: ChatResponse | null, err?: unknown) {
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
        await emit(profileId, started, res);
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
        await emit(profileId, started, res);
        return res;
      } catch (err) {
        await emit(profileId, started, null, err);
        throw err;
      }
    },
  };
}
