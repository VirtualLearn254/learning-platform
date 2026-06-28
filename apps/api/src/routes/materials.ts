import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { queues } from "../queue/index.js";
import { s3 } from "../lib/s3.js";

export const materialsRoute = new Hono()
  /**
   * Direct multipart upload: client POSTs the file as multipart/form-data with
   * fields { courseId, file }. We stream it to S3, persist a row, optionally
   * queue an ingest job.
   *
   * For a future enhancement we'd switch to presigned PUT URLs so the browser
   * uploads to MinIO directly without traveling through the API. Current
   * approach is simpler and fine for PDFs up to ~50 MB.
   */
  .post("/", async (c) => {
    const form = await c.req.parseBody({ all: false });
    const courseId = typeof form.courseId === "string" ? form.courseId : "";
    const file = form.file;
    const triggerIngest = form.triggerIngest === "true";

    if (!courseId) return c.json({ error: "courseId required" }, 400);
    if (!(file instanceof File)) return c.json({ error: "file required (multipart field 'file')" }, 400);

    const course = await db.query.courses.findFirst({ where: eq(tables.courses.id, courseId) });
    if (!course) return c.json({ error: "course not found" }, 404);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const s3Key = `materials/${courseId}/${Date.now()}-${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    await s3.putObject(s3Key, bytes, { contentType: file.type || "application/octet-stream" });

    const [inserted] = await db.insert(tables.materials).values({
      courseId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: bytes.length,
      s3Key,
    }).returning();

    let jobId: string | undefined;
    if (triggerIngest) {
      const job = await queues.ingest.add("ingest-material", {
        courseId,
        materialId: inserted!.id,
      });
      jobId = job.id;
    }

    return c.json({ material: inserted, ingestJobId: jobId }, 201);
  })

  .get("/", async (c) => {
    const courseId = c.req.query("courseId");
    const where = courseId ? eq(tables.materials.courseId, courseId) : undefined;
    const rows = await db.select().from(tables.materials).where(where);
    return c.json({ materials: rows });
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const row = await db.query.materials.findFirst({ where: eq(tables.materials.id, id) });
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ material: row });
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
