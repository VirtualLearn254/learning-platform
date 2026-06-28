/**
 * /api/ai — provider dashboard, secrets, role overrides, usage analytics.
 *
 * Providers + secrets:
 *   GET    /providers
 *   GET    /secrets
 *   PUT    /secrets/:name
 *   DELETE /secrets/:name
 *
 * Profiles + roles:
 *   GET    /profiles                  (effective routing — TS + overrides)
 *   PUT    /profiles/:id              (save override)
 *   DELETE /profiles/:id              (clear override)
 *   GET    /models                    (catalog grouped by provider)
 *
 * Test + usage:
 *   POST   /test/:provider            (1-token health check)
 *   GET    /usage?window=24h          (windowed analytics)
 */

import { Hono } from "hono";

import {
  MODEL_CATALOG, profiles, type ProviderId,
} from "@lp/ai-provider";
import {
  SECRET_NAMES, SecretsKeyMissingError, deleteSecret, getSecret,
  listSecretStatuses, setSecret, type SecretName,
} from "../lib/secrets.js";
import {
  deleteProfileOverride, listProfileOverrides, setProfileOverride,
} from "../lib/profiles_store.js";
import { getAIClient } from "../lib/ai_client.js";
import { getUsageSummary, type UsageWindow } from "../lib/usage.js";

export const aiRoute = new Hono();

const PROVIDER_DOCS: Record<ProviderId, { displayName: string; envKey: string; signupUrl: string; pricing: string; secretName: SecretName }> = {
  anthropic: { displayName: "Anthropic (Claude)", envKey: "ANTHROPIC_API_KEY", signupUrl: "https://console.anthropic.com",          pricing: "$3 in / $15 out per 1M (Sonnet)",   secretName: "anthropic_api_key" },
  openai:    { displayName: "OpenAI",             envKey: "OPENAI_API_KEY",    signupUrl: "https://platform.openai.com/api-keys",   pricing: "$2.50 in / $10 out per 1M (gpt-4o)", secretName: "openai_api_key" },
  deepseek:  { displayName: "DeepSeek",           envKey: "DEEPSEEK_API_KEY",  signupUrl: "https://platform.deepseek.com/api_keys", pricing: "$0.27 in / $1.10 out per 1M",        secretName: "deepseek_api_key" },
  local:     { displayName: "vLLM (self-hosted)", envKey: "VLLM_BASE_URL",     signupUrl: "https://github.com/vllm-project/vllm",   pricing: "free (your GPU)",                    secretName: "vllm_base_url" },
};

async function providerConfigured(p: ProviderId): Promise<boolean> {
  const value = await getSecret(PROVIDER_DOCS[p].secretName);
  return !!value;
}

// ─── Providers ──────────────────────────────────────────────────────
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

// ─── Profiles (effective routing) ───────────────────────────────────
aiRoute.get("/profiles", async (c) => {
  const overrides = await listProfileOverrides();
  const configured: Record<ProviderId, boolean> = {
    anthropic: await providerConfigured("anthropic"),
    openai:    await providerConfigured("openai"),
    deepseek:  await providerConfigured("deepseek"),
    local:     await providerConfigured("local"),
  };

  const out = Object.values(profiles).map((profile) => {
    const ov = overrides[profile.id] ?? {};
    const preferredHead = ov.preferredProvider as ProviderId | undefined;
    const effectiveChain: ProviderId[] = preferredHead
      ? [preferredHead, ...profile.preferred.filter((p) => p !== preferredHead)]
      : Array.from(profile.preferred);
    const active = effectiveChain.find((p) => configured[p]) ?? null;
    const defaultModel = active ? profile.modelByProvider[active] : null;
    const activeModel = ov.modelId ?? defaultModel;
    return {
      id: profile.id,
      preferred: effectiveChain,
      defaultPreferred: profile.preferred,
      activeProvider: active,
      activeModel,
      defaultModel,
      temperature: ov.temperature ?? profile.temperature,
      defaultTemperature: profile.temperature,
      maxTokens: ov.maxTokens ?? profile.maxTokens,
      defaultMaxTokens: profile.maxTokens,
      supportsVision: profile.supportsVision ?? false,
      isOverridden: Object.keys(ov).length > 0,
    };
  });
  return c.json({ profiles: out });
});

aiRoute.put("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  if (!profiles[id as keyof typeof profiles]) return c.json({ ok: false, error: `unknown profile: ${id}` }, 400);
  let body: { preferredProvider?: string; modelId?: string; temperature?: number; maxTokens?: number };
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid JSON body" }, 400); }

  if (body.preferredProvider && !(["anthropic", "openai", "deepseek", "local"] as const).includes(body.preferredProvider as ProviderId)) {
    return c.json({ ok: false, error: `invalid preferredProvider: ${body.preferredProvider}` }, 400);
  }
  await setProfileOverride(id, {
    preferredProvider: body.preferredProvider as ProviderId | undefined,
    modelId: body.modelId,
    temperature: body.temperature,
    maxTokens: body.maxTokens,
  });
  return c.json({ ok: true });
});

aiRoute.delete("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  if (!profiles[id as keyof typeof profiles]) return c.json({ ok: false, error: `unknown profile: ${id}` }, 400);
  await deleteProfileOverride(id);
  return c.json({ ok: true });
});

// ─── Model catalog ──────────────────────────────────────────────────
aiRoute.get("/models", (c) => {
  return c.json({ catalog: MODEL_CATALOG });
});

// ─── Secrets ────────────────────────────────────────────────────────
aiRoute.get("/secrets", async (c) => {
  const statuses = await listSecretStatuses();
  const hasMasterKey = !!process.env.LP_SECRETS_KEY;
  return c.json({ secrets: statuses, canSave: hasMasterKey });
});

aiRoute.put("/secrets/:name", async (c) => {
  const name = c.req.param("name") as SecretName;
  if (!SECRET_NAMES.includes(name)) return c.json({ ok: false, error: `unknown secret: ${name}` }, 400);
  let body: { value?: string };
  try { body = await c.req.json(); } catch { return c.json({ ok: false, error: "invalid JSON body" }, 400); }
  if (!body.value || typeof body.value !== "string") return c.json({ ok: false, error: "body must include { value: string }" }, 400);
  try {
    const status = await setSecret(name, body.value.trim());
    return c.json({ ok: true, status });
  } catch (err) {
    if (err instanceof SecretsKeyMissingError) return c.json({ ok: false, error: err.message }, 503);
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

aiRoute.delete("/secrets/:name", async (c) => {
  const name = c.req.param("name") as SecretName;
  if (!SECRET_NAMES.includes(name)) return c.json({ ok: false, error: `unknown secret: ${name}` }, 400);
  await deleteSecret(name);
  return c.json({ ok: true });
});

// ─── Test (logged) ──────────────────────────────────────────────────
aiRoute.post("/test/:provider", async (c) => {
  const provider = c.req.param("provider") as ProviderId;
  if (!PROVIDER_DOCS[provider]) return c.json({ ok: false, error: `unknown provider: ${provider}` }, 400);
  if (!(await providerConfigured(provider))) return c.json({ ok: false, error: `${PROVIDER_DOCS[provider].envKey} is not set` }, 400);

  // Use a profile that prefers this provider, so the test hits the right model.
  const profile = Object.values(profiles).find((p) => p.preferred[0] === provider) ?? profiles.utility;
  const model = profile.modelByProvider[provider];

  try {
    const client = await getAIClient();
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
    return c.json({ ok: false, model, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// ─── Usage ──────────────────────────────────────────────────────────
aiRoute.get("/usage", async (c) => {
  const raw = (c.req.query("window") ?? "24h") as UsageWindow;
  const allowed: UsageWindow[] = ["1h", "24h", "7d", "30d"];
  const window = (allowed as string[]).includes(raw) ? raw : ("24h" as UsageWindow);
  const summary = await getUsageSummary(window);
  return c.json(summary);
});
