import { Hono } from "hono";

import { db } from "../db/index.js";
import { getSecret } from "../lib/secrets.js";

export const healthRoute = new Hono()
  .get("/", async (c) => {
    const dbOk = await db.execute(`select 1 as ok`).then(() => true).catch(() => false);
    // Providers come from the encrypted secrets store (with env fallback) —
    // the same source the AI client actually uses, so this reflects reality.
    const [anthropic, openai, deepseek, fireworks, vllm] = await Promise.all([
      getSecret("anthropic_api_key").catch(() => null),
      getSecret("openai_api_key").catch(() => null),
      getSecret("deepseek_api_key").catch(() => null),
      getSecret("fireworks_api_key").catch(() => null),
      getSecret("vllm_base_url").catch(() => null),
    ]);
    return c.json({
      ok: dbOk,
      db: dbOk,
      providers: {
        anthropic: Boolean(anthropic),
        openai: Boolean(openai),
        deepseek: Boolean(deepseek),
        fireworks: Boolean(fireworks),
        vllm: Boolean(vllm),
      },
      timestamp: new Date().toISOString(),
    });
  });
