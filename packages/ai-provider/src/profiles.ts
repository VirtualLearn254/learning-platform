/**
 * Profiles bundle the "which model + which provider + what defaults" decision
 * so the rest of the code can stay generic. Edit this file when you want to
 * swap models or change a preferred-provider chain.
 *
 * IMPORTANT: the model names here MUST match what's actually served by vLLM
 * on the GPU host (and what your API keys can access for cloud fallbacks).
 * If you change the vLLM model, update modelByProvider.local here.
 */

export type ProviderId = "local" | "openai" | "deepseek";

export interface AIProfile {
  id: string;
  /** Provider preference order — first available wins. */
  preferred: ProviderId[];
  /** Which model id to use on each provider, if selected. */
  modelByProvider: Record<ProviderId, string>;
  temperature: number;
  maxTokens: number;
  supportsVision?: boolean;
}

export type Profile = keyof typeof profiles;

/**
 * Profile registry. To add a new one, add an entry and call `client.chat("yourProfile", ...)`.
 */
export const profiles = {
  /** Generating beat HTML/CSS/JS. Highest quality demands. */
  author: {
    id: "author",
    preferred: ["local", "deepseek", "openai"],
    modelByProvider: {
      local:    "Qwen/Qwen2.5-32B-Instruct-AWQ",
      deepseek: "deepseek-chat",
      openai:   "gpt-4o",
    },
    temperature: 0.7,
    maxTokens: 8000,
  },

  /** Reviewing a beat for static issues. Quality-tolerant, cheap. */
  reviewer: {
    id: "reviewer",
    preferred: ["local", "deepseek", "openai"],
    modelByProvider: {
      local:    "Qwen/Qwen2.5-14B-Instruct-AWQ",
      deepseek: "deepseek-chat",
      openai:   "gpt-4o-mini",
    },
    temperature: 0.3,
    maxTokens: 2000,
  },

  /** Holistic cross-beat review. One-shot per lesson. */
  holistic: {
    id: "holistic",
    preferred: ["local", "openai", "deepseek"],
    modelByProvider: {
      local:    "Qwen/Qwen2.5-32B-Instruct-AWQ",
      deepseek: "deepseek-chat",
      openai:   "gpt-4o",
    },
    temperature: 0.4,
    maxTokens: 3000,
  },

  /** Vision verifier — screenshot in, structured issues out. */
  verifier: {
    id: "verifier",
    preferred: ["local", "openai"],
    modelByProvider: {
      local:    "Qwen/Qwen2-VL-7B-Instruct",
      deepseek: "deepseek-chat",            // no vision; only here for the union
      openai:   "gpt-4o",
    },
    temperature: 0.2,
    maxTokens: 2000,
    supportsVision: true,
  },

  /** Course-material ingestion: parse upload → modules/sections/lessons. */
  ingest: {
    id: "ingest",
    preferred: ["local", "deepseek", "openai"],
    modelByProvider: {
      local:    "Qwen/Qwen2.5-32B-Instruct-AWQ",
      deepseek: "deepseek-chat",
      openai:   "gpt-4o",
    },
    temperature: 0.4,
    maxTokens: 6000,
  },

  /** Cheap classification / extraction tasks. */
  utility: {
    id: "utility",
    preferred: ["local", "deepseek", "openai"],
    modelByProvider: {
      local:    "Qwen/Qwen2.5-14B-Instruct-AWQ",
      deepseek: "deepseek-chat",
      openai:   "gpt-4o-mini",
    },
    temperature: 0.2,
    maxTokens: 1500,
  },
} as const satisfies Record<string, AIProfile>;
