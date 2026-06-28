/**
 * Profiles bundle the "which model + which provider + what defaults" decision
 * so the rest of the code can stay generic. Edit this file when you want to
 * swap models or change a preferred-provider chain.
 *
 * Model names MUST match what the chosen provider actually serves.
 */

export type ProviderId = "anthropic" | "local" | "openai" | "deepseek";

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
    preferred: ["anthropic", "local", "openai", "deepseek"],
    modelByProvider: {
      anthropic: "claude-sonnet-4-6",
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
    preferred: ["anthropic", "local", "deepseek", "openai"],
    modelByProvider: {
      anthropic: "claude-haiku-4-5-20251001",
      local:    "Qwen/Qwen2.5-14B-Instruct-AWQ",
      deepseek: "deepseek-chat",
      openai:   "gpt-4o-mini",
    },
    temperature: 0.3,
    maxTokens: 2000,
  },

  /** Holistic cross-beat review. One-shot per lesson. Splurge here. */
  holistic: {
    id: "holistic",
    preferred: ["anthropic", "local", "openai", "deepseek"],
    modelByProvider: {
      anthropic: "claude-opus-4-8",
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
    preferred: ["anthropic", "local", "openai"],
    modelByProvider: {
      anthropic: "claude-sonnet-4-6",
      local:    "Qwen/Qwen2-VL-7B-Instruct",
      deepseek: "deepseek-chat",            // no vision; only here for the union
      openai:   "gpt-4o",
    },
    temperature: 0.2,
    maxTokens: 2000,
    supportsVision: true,
  },

  /** Course-material ingestion: parse upload → modules/sections/lessons.
   *  Output is structure-only (titles + beat outlines), so 8K is plenty. */
  ingest: {
    id: "ingest",
    preferred: ["anthropic", "local", "deepseek", "openai"],
    modelByProvider: {
      anthropic: "claude-sonnet-4-6",
      local:    "Qwen/Qwen2.5-32B-Instruct-AWQ",
      deepseek: "deepseek-chat",
      openai:   "gpt-4o",
    },
    temperature: 0.4,
    maxTokens: 8000,
  },

  /** Cheap classification / extraction tasks. */
  utility: {
    id: "utility",
    preferred: ["anthropic", "local", "deepseek", "openai"],
    modelByProvider: {
      anthropic: "claude-haiku-4-5-20251001",
      local:    "Qwen/Qwen2.5-14B-Instruct-AWQ",
      deepseek: "deepseek-chat",
      openai:   "gpt-4o-mini",
    },
    temperature: 0.2,
    maxTokens: 1500,
  },
} as const satisfies Record<string, AIProfile>;
