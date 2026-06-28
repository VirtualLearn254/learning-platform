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

export interface ProviderConfig {
  anthropic?: { apiKey: string; baseUrl?: string };
  vllm?: { baseUrl: string; apiKey?: string };
  openai?: { apiKey: string };
  deepseek?: { apiKey: string };
}

export interface AIClient {
  chat(profile: Profile, req: ChatRequest): Promise<ChatResponse>;
  vision(profile: Profile, req: VisionRequest): Promise<ChatResponse>;
}

/**
 * Construct a client wired with whichever providers have credentials. The
 * profile decides which provider/model is preferred; if that provider isn't
 * configured, we fall through to the next available one.
 */
export function createAIClient(config: ProviderConfig): AIClient {
  const anthropic = config.anthropic ? new AnthropicProvider(config.anthropic) : null;
  const vllm = config.vllm ? new VllmProvider(config.vllm) : null;
  const openai = config.openai ? new OpenAIProvider({ apiKey: config.openai.apiKey, baseUrl: "https://api.openai.com/v1" }) : null;
  const deepseek = config.deepseek ? new OpenAIProvider({ apiKey: config.deepseek.apiKey, baseUrl: "https://api.deepseek.com/v1" }) : null;

  function pickProvider(profile: AIProfile) {
    for (const preferred of profile.preferred) {
      if (preferred === "anthropic" && anthropic) return { provider: anthropic, model: profile.modelByProvider.anthropic };
      if (preferred === "local" && vllm) return { provider: vllm, model: profile.modelByProvider.local };
      if (preferred === "openai" && openai) return { provider: openai, model: profile.modelByProvider.openai };
      if (preferred === "deepseek" && deepseek) return { provider: deepseek, model: profile.modelByProvider.deepseek };
    }
    throw new Error(
      `No configured provider for profile "${profile.id}". Preferred order: ${profile.preferred.join(", ")}. ` +
      `Set ANTHROPIC_API_KEY, VLLM_BASE_URL, OPENAI_API_KEY, or DEEPSEEK_API_KEY in your environment.`,
    );
  }

  return {
    async chat(profileId, req) {
      const profile = profiles[profileId];
      if (!profile) throw new Error(`Unknown profile: ${profileId}`);
      const { provider, model } = pickProvider(profile);
      return provider.chat({
        ...req,
        model: req.model ?? model,
        temperature: req.temperature ?? profile.temperature,
        maxTokens: req.maxTokens ?? profile.maxTokens,
      });
    },
    async vision(profileId, req) {
      const profile = profiles[profileId];
      if (!profile) throw new Error(`Unknown profile: ${profileId}`);
      if (!profile.supportsVision) {
        throw new Error(`Profile "${profileId}" does not support vision. Use a vision-capable profile (e.g. "verifier").`);
      }
      const { provider, model } = pickProvider(profile);
      if (!provider.vision) {
        throw new Error(`Selected provider does not implement vision.`);
      }
      return provider.vision({
        ...req,
        model: req.model ?? model,
        temperature: req.temperature ?? profile.temperature,
        maxTokens: req.maxTokens ?? profile.maxTokens,
      });
    },
  };
}
