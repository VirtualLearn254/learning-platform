/**
 * /api/ai — read-only dashboard for the AI provider stack.
 *
 *   GET  /providers          → which providers have credentials
 *   GET  /profiles           → which model serves each profile, given current creds
 *   POST /test/:provider     → fire a 1-token completion to verify the key works
 *
 * No mutation. Edits happen by changing .env.prod + redeploying.
 */

import { Hono } from "hono";

import { env } from "../env.js";
import { createAIClient, type ProviderConfig, profiles, type ProviderId } from "@lp/ai-provider";

export const aiRoute = new Hono();

const PROVIDER_DOCS: Record<ProviderId, { displayName: string; envKey: string; signupUrl: string; pricing: string }> = {
  anthropic: { displayName: "Anthropic (Claude)",  envKey: "ANTHROPIC_API_KEY", signupUrl: "https://console.anthropic.com",            pricing: "$3 in / $15 out per 1M (Sonnet)" },
  openai:    { displayName: "OpenAI",              envKey: "OPENAI_API_KEY",    signupUrl: "https://platform.openai.com/api-keys",     pricing: "$2.50 in / $10 out per 1M (gpt-4o)" },
  deepseek:  { displayName: "DeepSeek",            envKey: "DEEPSEEK_API_KEY",  signupUrl: "https://platform.deepseek.com/api_keys",   pricing: "$0.27 in / $1.10 out per 1M" },
  local:     { displayName: "vLLM (self-hosted)",  envKey: "VLLM_BASE_URL",     signupUrl: "https://github.com/vllm-project/vllm",     pricing: "free (your GPU)" },
};

function providerConfigured(p: ProviderId): boolean {
  switch (p) {
    case "anthropic": return !!env.ANTHROPIC_API_KEY;
    case "openai":    return !!env.OPENAI_API_KEY;
    case "deepseek":  return !!env.DEEPSEEK_API_KEY;
    case "local":     return !!env.VLLM_BASE_URL;
  }
}

function buildProviderConfig(): ProviderConfig {
  return {
    ...(env.ANTHROPIC_API_KEY && { anthropic: { apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL || undefined } }),
    ...(env.OPENAI_API_KEY    && { openai:    { apiKey: env.OPENAI_API_KEY } }),
    ...(env.DEEPSEEK_API_KEY  && { deepseek:  { apiKey: env.DEEPSEEK_API_KEY } }),
    ...(env.VLLM_BASE_URL     && { vllm:      { baseUrl: env.VLLM_BASE_URL, apiKey: env.VLLM_API_KEY } }),
  };
}

// ─── GET /providers ─────────────────────────────────────────────────
aiRoute.get("/providers", (c) => {
  const providers = (Object.keys(PROVIDER_DOCS) as ProviderId[]).map((id) => ({
    id,
    ...PROVIDER_DOCS[id],
    configured: providerConfigured(id),
  }));
  return c.json({ providers });
});

// ─── GET /profiles ──────────────────────────────────────────────────
aiRoute.get("/profiles", (c) => {
  const out = (Object.values(profiles)).map((profile) => {
    const active = profile.preferred.find(providerConfigured) ?? null;
    return {
      id: profile.id,
      preferred: profile.preferred,
      activeProvider: active,
      activeModel: active ? profile.modelByProvider[active] : null,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      supportsVision: profile.supportsVision ?? false,
    };
  });
  return c.json({ profiles: out });
});

// ─── POST /test/:provider ───────────────────────────────────────────
aiRoute.post("/test/:provider", async (c) => {
  const provider = c.req.param("provider") as ProviderId;
  if (!PROVIDER_DOCS[provider]) return c.json({ ok: false, error: `unknown provider: ${provider}` }, 400);
  if (!providerConfigured(provider)) return c.json({ ok: false, error: `${PROVIDER_DOCS[provider].envKey} is not set` }, 400);

  // Find a profile that prefers this provider, so we use a known-good model.
  const profile = Object.values(profiles).find((p) => p.preferred[0] === provider) ?? profiles.utility;
  const model = profile.modelByProvider[provider];

  try {
    const client = createAIClient(buildProviderConfig());
    const started = Date.now();
    const res = await client.chat(profile.id, {
      messages: [{ role: "user", content: 'Reply with the single word "ok".' }],
      maxTokens: 5,
      temperature: 0,
    });
    return c.json({
      ok: true,
      model,
      actualModel: res.model,
      latencyMs: Date.now() - started,
      sample: res.text.slice(0, 80),
      usage: res.usage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, model, error: msg }, 502);
  }
});
