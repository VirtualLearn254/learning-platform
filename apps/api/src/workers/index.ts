/**
 * Worker process bootstrapper. Run as a separate process with:
 *   tsx watch apps/api/src/workers/index.ts
 *
 * In production we'd run this under a process manager (systemd or pm2)
 * separate from the HTTP server so workers can scale independently.
 */

import "dotenv/config";

// Keep the workers process alive even if some stray async error fires.
// Without this, an unhandled EPIPE or socket error inside a child process
// callback would kill all 7 workers + stall their in-flight jobs.
process.on("uncaughtException", (err) => {
  console.error("[workers] uncaughtException (continuing):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[workers] unhandledRejection (continuing):", reason);
});

import { startIngestWorker } from "./ingest.worker.js";
import { startAuthorWorker } from "./author.worker.js";
import { startAIReviewWorker } from "./ai-review.worker.js";
import { startHolisticWorker } from "./holistic.worker.js";
import { startRenderWorker } from "./render.worker.js";
import { startStitchWorker } from "./stitch.worker.js";
import { startAuditWorker } from "./audit.worker.js";
import { startScormWorker } from "./scorm.worker.js";

const workers = [
  startIngestWorker(),
  startAuthorWorker(),
  startAIReviewWorker(),
  startHolisticWorker(),
  startRenderWorker(),
  startStitchWorker(),
  startAuditWorker(),
  startScormWorker(),
];

console.log(`[workers] started ${workers.length} workers`);

const shutdown = async () => {
  console.log("[workers] shutting down…");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
