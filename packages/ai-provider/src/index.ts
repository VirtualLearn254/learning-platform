/**
 * @lp/ai-provider — the abstraction that replaces every direct `claude -p` /
 * `@anthropic-ai/sdk` call in the legacy pipeline. All AI work in the new app
 * goes through this module.
 *
 * Provider routing:
 *   `local` (vLLM on the GPU host) is the default for production.
 *   `openai` / `deepseek` are cloud fallbacks selected per call.
 *
 * Three primary surfaces:
 *   - chat()        → generic text completion (authoring, reviewing, planning)
 *   - vision()      → image + text completion (the screenshot verifier)
 *   - embeddings()  → vector embeddings (deferred; used in P3 for memory)
 *
 * Each call accepts a `profile` (e.g. "author" / "reviewer" / "verifier") that
 * picks the right model + temperature defaults. Profiles are defined in
 * ./profiles.ts and can be edited without touching call sites.
 */

import { type AIProfile, type Profile, type ProviderId, profiles } from "./profiles.js";
import { MODEL_CATALOG } from "./catalog.js";
import { type ChatRequest, type ChatResponse, type VisionRequest } from "./types.js";

/** $ per 1M output tokens for a provider's model (0 if unknown). Used to
 *  refuse a silent, materially-pricier provider fallback. */
function outputPricePer1M(providerId: ProviderId, modelId: string): number {
  return MODEL_CATALOG[providerId]?.find((m) => m.id === modelId)?.outputPer1M ?? 0;
}
import { VllmProvider } from "./providers/vllm.js";
import { OpenAIProvider } from "./providers/openai.js";
import { AnthropicProvider } from "./providers/anthropic.js";

export * from "./types.js";
export * from "./profiles.js";
export * from "./catalog.js";
export * from "./logging.js";

export interface ProviderConfig {
  anthropic?: { apiKey: string; baseUrl?: string };
  vllm?: { baseUrl: string; apiKey?: string };
  openai?: { apiKey: string };
  deepseek?: { apiKey: string };
  fireworks?: { apiKey: string };
  moonshot?: { apiKey: string };
}

/**
 * Runtime overrides on top of the static profile defaults. Set whichever
 * fields you want to change; the rest fall back to profiles.ts.
 *
 * `preferredProvider` shoves a single provider to the front of the chain
 * (the static fallback chain still applies after it).
 */
export interface ProfileOverride {
  preferredProvider?: import("./profiles.js").ProviderId;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIClient {
  chat(profile: Profile, req: ChatRequest): Promise<ChatResponse>;
  vision(profile: Profile, req: VisionRequest): Promise<ChatResponse>;
}

/**
 * Construct a client wired with whichever providers have credentials. The
 * profile decides which provider/model is preferred; if that provider isn't
 * configured, we fall through to the next available one.
 *
 * `getOverrides` is called once per request so DB-backed overrides take
 * effect without rebuilding the client.
 */
export function createAIClient(
  config: ProviderConfig,
  getOverrides?: (profileId: string) => ProfileOverride | undefined,
): AIClient {
  const anthropic = config.anthropic ? new AnthropicProvider(config.anthropic) : null;
  const vllm = config.vllm ? new VllmProvider(config.vllm) : null;
  const openai = config.openai ? new OpenAIProvider({ apiKey: config.openai.apiKey, baseUrl: "https://api.openai.com/v1" }) : null;
  const deepseek = config.deepseek ? new OpenAIProvider({ apiKey: config.deepseek.apiKey, baseUrl: "https://api.deepseek.com/v1" }) : null;
  const fireworks = config.fireworks ? new OpenAIProvider({ apiKey: config.fireworks.apiKey, baseUrl: "https://api.fireworks.ai/inference/v1" }) : null;
  const moonshot = config.moonshot ? new OpenAIProvider({ apiKey: config.moonshot.apiKey, baseUrl: "https://api.moonshot.ai/v1" }) : null;

  /** Returns the effective preference chain with any override-preferred provider pinned to the front. */
  function effectiveChain(profile: AIProfile, override?: ProfileOverride): readonly import("./profiles.js").ProviderId[] {
    if (!override?.preferredProvider) return profile.preferred;
    const head = override.preferredProvider;
    return [head, ...profile.preferred.filter((p) => p !== head)];
  }

  function pickProvider(profile: AIProfile, override?: ProfileOverride) {
    const chain = effectiveChain(profile, override);
    const overrideModel = override?.modelId;
    const intended = chain[0]!; // profile.preferred is never empty
    const resolve = (id: import("./profiles.js").ProviderId) => {
      if (id === "anthropic" && anthropic) return { provider: anthropic, model: overrideModel ?? profile.modelByProvider.anthropic };
      if (id === "local" && vllm)          return { provider: vllm,      model: overrideModel ?? profile.modelByProvider.local };
      if (id === "openai" && openai)       return { provider: openai,    model: overrideModel ?? profile.modelByProvider.openai };
      if (id === "deepseek" && deepseek)   return { provider: deepseek,  model: overrideModel ?? profile.modelByProvider.deepseek };
      if (id === "fireworks" && fireworks) return { provider: fireworks, model: overrideModel ?? profile.modelByProvider.fireworks };
      if (id === "moonshot" && moonshot)   return { provider: moonshot,  model: overrideModel ?? profile.modelByProvider.moonshot };
      return null;
    };
    for (const id of chain) {
      const picked = resolve(id);
      if (!picked) continue;
      if (id !== intended) {
        // A fallback occurred — the preferred/pinned provider isn't configured.
        // NEVER let this be silent (it hid a Fireworks outage while quietly
        // running the designer on 13x-pricier Anthropic).
        console.warn(`[ai-provider] ${profile.id}: preferred provider "${intended}" is not configured — falling back to "${id}".`);
        // If the operator EXPLICITLY pinned a provider (a deliberate cost/
        // quality choice) and the fallback is materially pricier, refuse to
        // silently overspend — fail loud so the outage is noticed, not absorbed.
        if (override?.preferredProvider === intended) {
          const iPrice = outputPricePer1M(intended, profile.modelByProvider[intended]);
          const aPrice = outputPricePer1M(id, profile.modelByProvider[id]);
          if (iPrice > 0 && aPrice > iPrice * 2) {
            throw new Error(
              `[ai-provider] provider unavailable: role "${profile.id}" is pinned to "${intended}" but it is not configured, and the only available fallback "${id}" costs ${(aPrice / iPrice).toFixed(1)}x more per output token ($${iPrice}→$${aPrice}/1M). Refusing to silently overspend — restore "${intended}" or change the role's provider in Settings.`,
            );
          }
        }
      }
      return { ...picked, providerId: id };
    }
    throw new Error(
      `No configured provider for profile "${profile.id}". Preferred order: ${chain.join(", ")}. ` +
      `Set ANTHROPIC_API_KEY, VLLM_BASE_URL, OPENAI_API_KEY, DEEPSEEK_API_KEY, or FIREWORKS_API_KEY in your environment, ` +
      `or save one via the Settings UI.`,
    );
  }

  return {
    async chat(profileId, req) {
      const profile = profiles[profileId];
      if (!profile) throw new Error(`Unknown profile: ${profileId}`);
      const override = getOverrides?.(profileId);
      const { provider, model } = pickProvider(profile, override);
      return provider.chat({
        ...req,
        model: req.model ?? model,
        temperature: req.temperature ?? override?.temperature ?? profile.temperature,
        maxTokens: req.maxTokens ?? override?.maxTokens ?? profile.maxTokens,
      });
    },
    async vision(profileId, req) {
      const profile = profiles[profileId];
      if (!profile) throw new Error(`Unknown profile: ${profileId}`);
      if (!(profile as AIProfile).supportsVision) {
        throw new Error(`Profile "${profileId}" does not support vision. Use a vision-capable profile (e.g. "verifier").`);
      }
      const override = getOverrides?.(profileId);
      const { provider, model } = pickProvider(profile, override);
      if (!provider.vision) {
        throw new Error(`Selected provider does not implement vision.`);
      }
      return provider.vision({
        ...req,
        model: req.model ?? model,
        temperature: req.temperature ?? override?.temperature ?? profile.temperature,
        maxTokens: req.maxTokens ?? override?.maxTokens ?? profile.maxTokens,
      });
    },
  };
}
