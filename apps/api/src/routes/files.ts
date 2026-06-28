/**
 * File streaming endpoint. Serves S3 / MinIO objects to the browser so
 * the UI can play videos and download artifacts without exposing
 * MinIO credentials.
 *
 * For audio + video, supports HTTP Range requests so the <video> element
 * can scrub without re-downloading. For everything else, just streams the
 * whole body with the correct content-type.
 */

import { Hono } from "hono";
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";

import { env } from "../env.js";

const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});

export const filesRoute = new Hono().get("/:key{.+}", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const range = c.req.header("range");

  try {
    // Use HEAD first for total size + content type, then GET with optional range
    const head = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const totalSize = head.ContentLength ?? 0;
    const contentType = head.ContentType ?? "application/octet-stream";

    if (range && totalSize > 0) {
      const m = range.match(/^bytes=(\d+)-(\d*)$/);
      if (m) {
        const start = parseInt(m[1]!, 10);
        const end = m[2] ? parseInt(m[2], 10) : Math.min(start + 1024 * 1024 - 1, totalSize - 1);
        const obj = await s3.send(new GetObjectCommand({
          Bucket: env.S3_BUCKET, Key: key, Range: `bytes=${start}-${end}`,
        }));
        const stream = obj.Body as Readable | undefined;
        if (!stream) return c.text("empty body", 502);
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=300",
          },
        });
      }
    }

    // Full-object response
    const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const stream = obj.Body as Readable | undefined;
    if (!stream) return c.text("empty body", 502);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(totalSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("NoSuchKey") || msg.includes("NotFound")) return c.json({ error: "not_found", key }, 404);
    return c.json({ error: "stream_failed", message: msg.slice(0, 200) }, 500);
  }
});
