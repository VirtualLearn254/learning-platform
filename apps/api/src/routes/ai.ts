/**
 * /api/ai — provider dashboard + UI-managed secrets.
 *
 *   GET  /providers                → which providers have credentials (DB or env)
 *   GET  /profiles                 → which model serves each profile
 *   POST /test/:provider           → fire a 1-token completion to verify
 *   GET  /secrets                  → status of every editable secret (no values)
 *   PUT  /secrets/:name            → save a secret (encrypted into DB)
 *   DELETE /secrets/:name          → clear a stored secret (env fallback re-engages)
 *
 * Reads always check DB first, then fall back to env vars — so existing
 * .env.prod-based setups keep working unchanged.
 */

import { Hono } from "hono";

import { createAIClient, type ProviderConfig, profiles, type ProviderId } from "@lp/ai-provider";
import {
  SECRET_NAMES,
  SecretsKeyMissingError,
  deleteSecret,
  getSecret,
  listSecretStatuses,
  setSecret,
  type SecretName,
} from "../lib/secrets.js";

export const aiRoute = new Hono();

const PROVIDER_DOCS: Record<ProviderId, { displayName: string; envKey: string; signupUrl: string; pricing: string; secretName: SecretName }> = {
  anthropic: { displayName: "Anthropic (Claude)", envKey: "ANTHROPIC_API_KEY", signupUrl: "https://console.anthropic.com",          pricing: "$3 in / $15 out per 1M (Sonnet)",   secretName: "anthropic_api_key" },
  openai:    { displayName: "OpenAI",             envKey: "OPENAI_API_KEY",    signupUrl: "https://platform.openai.com/api-keys",   pricing: "$2.50 in / $10 out per 1M (gpt-4o)", secretName: "openai_api_key" },
  deepseek:  { displayName: "DeepSeek",           envKey: "DEEPSEEK_API_KEY",  signupUrl: "https://platform.deepseek.com/api_keys", pricing: "$0.27 in / $1.10 out per 1M",        secretName: "deepseek_api_key" },
  local:     { displayName: "vLLM (self-hosted)", envKey: "VLLM_BASE_URL",     signupUrl: "https://github.com/vllm-project/vllm",   pricing: "free (your GPU)",                    secretName: "vllm_base_url" },
};

/** Build the live provider config by reading secrets fresh on each call. */
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

async function providerConfigured(p: ProviderId): Promise<boolean> {
  const value = await getSecret(PROVIDER_DOCS[p].secretName);
  return !!value;
}

// ─── GET /providers ─────────────────────────────────────────────────
aiRoute.get("/providers", async (c) => {
  const providers = await Promise.all(
    (Object.keys(PROVIDER_DOCS) as ProviderId[]).map(async (id) => ({
      id,
      ...PROVIDER_DOCS[id],
      configured: await providerConfigured(id),
    })),
  );
  return c.json({ providers });
});

// ─── GET /profiles ──────────────────────────────────────────────────
aiRoute.get("/profiles", async (c) => {
  const configured: Record<ProviderId, boolean> = {
    anthropic: await providerConfigured("anthropic"),
    openai:    await providerConfigured("openai"),
    deepseek:  await providerConfigured("deepseek"),
    local:     await providerConfigured("local"),
  };
  const out = Object.values(profiles).map((profile) => {
    const active = profile.preferred.find((p) => configured[p]) ?? null;
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
  if (!(await providerConfigured(provider))) return c.json({ ok: false, error: `${PROVIDER_DOCS[provider].envKey} is not set` }, 400);

  // Find a profile that prefers this provider for its primary model id.
  const profile = Object.values(profiles).find((p) => p.preferred[0] === provider) ?? profiles.utility;
  const model = profile.modelByProvider[provider];

  try {
    const client = createAIClient(await buildProviderConfig());
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

// ─── GET /secrets ───────────────────────────────────────────────────
aiRoute.get("/secrets", async (c) => {
  const statuses = await listSecretStatuses();
  const hasMasterKey = !!process.env.LP_SECRETS_KEY;
  return c.json({ secrets: statuses, canSave: hasMasterKey });
});

// ─── PUT /secrets/:name ─────────────────────────────────────────────
aiRoute.put("/secrets/:name", async (c) => {
  const name = c.req.param("name") as SecretName;
  if (!SECRET_NAMES.includes(name)) {
    return c.json({ ok: false, error: `unknown secret: ${name}` }, 400);
  }
  let body: { value?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON body" }, 400);
  }
  if (!body.value || typeof body.value !== "string") {
    return c.json({ ok: false, error: "body must include { value: string }" }, 400);
  }
  try {
    const status = await setSecret(name, body.value.trim());
    return c.json({ ok: true, status });
  } catch (err) {
    if (err instanceof SecretsKeyMissingError) return c.json({ ok: false, error: err.message }, 503);
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

// ─── DELETE /secrets/:name ──────────────────────────────────────────
aiRoute.delete("/secrets/:name", async (c) => {
  const name = c.req.param("name") as SecretName;
  if (!SECRET_NAMES.includes(name)) {
    return c.json({ ok: false, error: `unknown secret: ${name}` }, 400);
  }
  await deleteSecret(name);
  return c.json({ ok: true });
});
