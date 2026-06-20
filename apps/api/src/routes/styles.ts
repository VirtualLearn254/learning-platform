import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq, desc } from "drizzle-orm";

import { db, tables } from "../db/index.js";

const CreateStyleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  templateId: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

export const stylesRoute = new Hono()
  .get("/", async (c) => {
    const onlyApproved = c.req.query("approved") === "true";
    const rows = await db.select().from(tables.styles)
      .where(onlyApproved ? eq(tables.styles.approved, true) : undefined)
      .orderBy(desc(tables.styles.createdAt));
    return c.json({ styles: rows });
  })
  .post("/", zValidator("json", CreateStyleSchema), async (c) => {
    const input = c.req.valid("json");
    const [inserted] = await db.insert(tables.styles).values({
      name: input.name,
      description: input.description ?? null,
      templateId: input.templateId,
      tags: input.tags ?? [],
      approved: false,
    }).returning();
    return c.json({ style: inserted }, 201);
  })
  .post("/:id/approve", async (c) => {
    const id = c.req.param("id");
    const [updated] = await db.update(tables.styles)
      .set({ approved: true })
      .where(eq(tables.styles.id, id))
      .returning();
    return c.json({ style: updated });
  });
