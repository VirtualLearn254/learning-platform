import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";

import { UploadMaterialSchema } from "@lp/shared";

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";

export const materialsRoute = new Hono()
  .post("/", zValidator("json", UploadMaterialSchema), async (c) => {
    const input = c.req.valid("json");
    /**
     * Upload model: client requests an upload, we return a pre-signed S3 URL
     * + a material row. Client PUTs the file. Then calls POST /:id/ingest to
     * trigger processing.
     *
     * For now we just create the row + return a placeholder upload URL.
     */
    const [inserted] = await db.insert(tables.materials).values({
      courseId: input.courseId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.size,
      s3Key: `materials/${input.courseId}/${input.filename}`,
    }).returning();
    return c.json({
      material: inserted,
      // In the real impl we'd return a pre-signed PUT URL here.
      uploadUrl: `placeholder://${inserted!.s3Key}`,
    }, 201);
  })
  .get("/", async (c) => {
    const courseId = c.req.query("courseId");
    const where = courseId ? eq(tables.materials.courseId, courseId) : undefined;
    const rows = await db.select().from(tables.materials).where(where);
    return c.json({ materials: rows });
  })
  .post("/:id/ingest", async (c) => {
    const id = c.req.param("id");
    const material = await db.query.materials.findFirst({ where: eq(tables.materials.id, id) });
    if (!material) return c.json({ error: "not_found" }, 404);

    const job = await queues.ingest.add("ingest-material", {
      courseId: material.courseId,
      materialId: material.id,
    });
    return c.json({ ok: true, jobId: job.id });
  });
