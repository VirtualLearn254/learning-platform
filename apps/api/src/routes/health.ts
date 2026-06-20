import { Hono } from "hono";

import { db } from "../db/index.js";
import { env } from "../env.js";

export const healthRoute = new Hono()
  .get("/", async (c) => {
    const dbOk = await db.execute(`select 1 as ok`).then(() => true).catch(() => false);
    return c.json({
      ok: dbOk,
      db: dbOk,
      providers: {
        vllm: Boolean(env.VLLM_BASE_URL),
        openai: Boolean(env.OPENAI_API_KEY),
        deepseek: Boolean(env.DEEPSEEK_API_KEY),
      },
      timestamp: new Date().toISOString(),
    });
  });
