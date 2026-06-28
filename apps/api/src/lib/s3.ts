/**
 * S3 client — wired to MinIO in dev/prod (forcePathStyle), works with R2/AWS S3
 * in cloud setups by swapping endpoint + credentials.
 *
 * Auto-creates the bucket on first use so a fresh deploy never fails on a
 * missing bucket — idempotent, safe to re-run.
 */

import {
  S3Client as AwsS3Client,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../env.js";

export interface S3Client {
  putObject(key: string, body: Buffer | Uint8Array, opts?: { contentType?: string }): Promise<void>;
  getObject(key: string): Promise<{ body: Uint8Array; contentType: string; size: number }>;
  presignedPutUrl(key: string, opts: { contentType: string; expiresInSec?: number }): Promise<string>;
  presignedGetUrl(key: string, opts?: { expiresInSec?: number }): Promise<string>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string, limit?: number): Promise<Array<{ key: string; size: number; lastModified: Date }>>;
}

function buildClient(): AwsS3Client {
  return new AwsS3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}

let bucketEnsured = false;
async function ensureBucket(client: AwsS3Client): Promise<void> {
  if (bucketEnsured) return;
  try {
    await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    bucketEnsured = true;
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
      console.log(`[s3] created bucket ${env.S3_BUCKET}`);
      bucketEnsured = true;
    } catch (err) {
      // BucketAlreadyOwnedByYou is fine; anything else is a real problem
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("AlreadyOwnedByYou") || msg.includes("BucketAlreadyExists")) {
        bucketEnsured = true;
      } else {
        console.warn(`[s3] bucket create failed (will retry on next call):`, msg);
      }
    }
  }
}

export function createS3Client(): S3Client {
  const aws = buildClient();
  return {
    async putObject(key, body, opts) {
      await ensureBucket(aws);
      await aws.send(new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: opts?.contentType,
      }));
    },

    async getObject(key) {
      await ensureBucket(aws);
      const out = await aws.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      const stream = out.Body as ReadableStream<Uint8Array> | undefined;
      if (!stream) throw new Error(`S3 getObject ${key}: no body`);
      const chunks: Uint8Array[] = [];
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const buf = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) { buf.set(c, pos); pos += c.length; }
      return {
        body: buf,
        contentType: out.ContentType ?? "application/octet-stream",
        size: out.ContentLength ?? buf.length,
      };
    },

    async presignedPutUrl(key, opts) {
      await ensureBucket(aws);
      return getSignedUrl(aws, new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ContentType: opts.contentType,
      }), { expiresIn: opts.expiresInSec ?? 900 });
    },

    async presignedGetUrl(key, opts) {
      await ensureBucket(aws);
      return getSignedUrl(aws, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
        expiresIn: opts?.expiresInSec ?? 900,
      });
    },

    async deleteObject(key) {
      await aws.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    },

    async listObjects(prefix, limit = 1000) {
      await ensureBucket(aws);
      const out = await aws.send(new ListObjectsV2Command({
        Bucket: env.S3_BUCKET, Prefix: prefix, MaxKeys: limit,
      }));
      return (out.Contents ?? []).map((o) => ({
        key: o.Key!,
        size: o.Size ?? 0,
        lastModified: o.LastModified ?? new Date(0),
      }));
    },
  };
}

export const s3 = createS3Client();
