/**
 * File streaming endpoint. Proxies S3 / MinIO → browser so the UI can
 * play videos and download PDFs without making the client deal with
 * pre-signed URLs (and so we can attach auth later in one place).
 *
 * Real implementation: streams the byte range from S3 with proper
 * Range header support for video scrubbing. Today: 404s with a clear
 * message since no S3 client is wired yet.
 */

import { Hono } from "hono";

export const filesRoute = new Hono()
  .get("/:key{.+}", async (c) => {
    const key = c.req.param("key");
    /**
     * Will become:
     *   const obj = await s3.getObject({ Bucket: env.S3_BUCKET, Key: key });
     *   const range = c.req.header("range");
     *   return new Response(obj.Body, { headers: streamHeaders(obj, range) });
     */
    return c.json({
      error: "files_endpoint_not_wired",
      message: `Streaming for ${key} requires the S3 client. Adapter is in apps/api/src/lib/s3.ts (placeholder).`,
    }, 501);
  });
