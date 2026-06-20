/**
 * S3 client — abstracts MinIO (dev) and Cloudflare R2 / AWS S3 (prod).
 *
 * Currently interface-only; the real implementation uses the AWS SDK
 * with `forcePathStyle: true` for MinIO compatibility.
 */

import { env } from "../env.js";

export interface S3Client {
  putObject(key: string, body: Buffer | Uint8Array, opts?: { contentType?: string }): Promise<void>;
  getObject(key: string): Promise<{ body: Uint8Array; contentType: string; size: number }>;
  getObjectStream(key: string, range?: { start: number; end?: number }): Promise<ReadableStream>;
  presignedPutUrl(key: string, opts: { contentType: string; expiresInSec?: number }): Promise<string>;
  presignedGetUrl(key: string, opts?: { expiresInSec?: number }): Promise<string>;
  deleteObject(key: string): Promise<void>;
  listObjects(prefix: string, limit?: number): Promise<Array<{ key: string; size: number; lastModified: Date }>>;
}

export function createS3Client(): S3Client {
  return {
    async putObject() { throw new Error("S3 client not wired — implement in apps/api/src/lib/s3.ts"); },
    async getObject() { throw new Error("S3 client not wired"); },
    async getObjectStream() { throw new Error("S3 client not wired"); },
    async presignedPutUrl(key) { return `placeholder://${env.S3_BUCKET}/${key}`; },
    async presignedGetUrl(key) { return `placeholder://${env.S3_BUCKET}/${key}`; },
    async deleteObject() { /* noop */ },
    async listObjects() { return []; },
  };
}

export const s3 = createS3Client();
