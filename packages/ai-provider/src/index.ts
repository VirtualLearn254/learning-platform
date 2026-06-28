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

import { type AIProfile, type Profile, profiles } from "./profiles.js";
import { type ChatRequest, type ChatResponse, type VisionRequest } from "./types.js";
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

  /** Returns the effective preference chain with any override-preferred provider pinned to the front. */
  function effectiveChain(profile: AIProfile, override?: ProfileOverride): readonly import("./profiles.js").ProviderId[] {
    if (!override?.preferredProvider) return profile.preferred;
    const head = override.preferredProvider;
    return [head, ...profile.preferred.filter((p) => p !== head)];
  }

  function pickProvider(profile: AIProfile, override?: ProfileOverride) {
    const chain = effectiveChain(profile, override);
    const overrideModel = override?.modelId;
    for (const preferred of chain) {
      if (preferred === "anthropic" && anthropic) return { provider: anthropic, model: overrideModel ?? profile.modelByProvider.anthropic };
      if (preferred === "local" && vllm)         return { provider: vllm,      model: overrideModel ?? profile.modelByProvider.local };
      if (preferred === "openai" && openai)      return { provider: openai,    model: overrideModel ?? profile.modelByProvider.openai };
      if (preferred === "deepseek" && deepseek)  return { provider: deepseek,  model: overrideModel ?? profile.modelByProvider.deepseek };
    }
    throw new Error(
      `No configured provider for profile "${profile.id}". Preferred order: ${chain.join(", ")}. ` +
      `Set ANTHROPIC_API_KEY, VLLM_BASE_URL, OPENAI_API_KEY, or DEEPSEEK_API_KEY in your environment, ` +
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
      if (!profile.supportsVision) {
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
