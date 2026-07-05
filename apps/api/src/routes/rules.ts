/**
 * Pipeline rules CRUD — the institutional-memory surface.
 * Rules with active=true are appended to their scope's AI prompts on the
 * next call (30s cache). active=false rows are pending proposals (Hermes).
 */

import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq, desc } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { invalidateRulesCache } from "../lib/rules.js";

const ScopeSchema = z.enum(["author", "designer", "reviewer", "ingest"]);

export const rulesRoute = new Hono()
  .get("/", async (c) => {
    const rows = await db.select().from(tables.pipelineRules)
      .orderBy(desc(tables.pipelineRules.createdAt)).limit(200);
    return c.json({ rules: rows });
  })
  .post("/", zValidator("json", z.object({
    scope: ScopeSchema,
    rule: z.string().min(5).max(1000),
  })), async (c) => {
    const input = c.req.valid("json");
    const [row] = await db.insert(tables.pipelineRules).values({
      scope: input.scope, rule: input.rule, origin: "operator", active: true,
    }).returning();
    invalidateRulesCache();
    return c.json({ rule: row }, 201);
  })
  .patch("/:id", zValidator("json", z.object({
    active: z.boolean().optional(),
    rule: z.string().min(5).max(1000).optional(),
  })), async (c) => {
    const id = c.req.param("id");
    const input = c.req.valid("json");
    const [row] = await db.update(tables.pipelineRules)
      .set(input).where(eq(tables.pipelineRules.id, id)).returning();
    if (!row) return c.json({ error: "not_found" }, 404);
    invalidateRulesCache();
    return c.json({ rule: row });
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(tables.pipelineRules).where(eq(tables.pipelineRules.id, id));
    invalidateRulesCache();
    return c.json({ ok: true });
  });
