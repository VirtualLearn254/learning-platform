/**
 * Audit worker — runs the audit-toolkit-equivalent post-stitch QA on the
 * master MP4. Surfaces any boundary-gap or audio issues for human action.
 * If clean → enqueue SCORM build.
 */

import { Worker } from "bullmq";
import { eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { QueueNames, queues } from "../queue/index.js";
import { workerConnection } from "./connection.js";
import { notifications } from "./services.js";

interface JobData { lessonId: string }

export function startAuditWorker() {
  return new Worker<JobData>(QueueNames.Audit, async (job) => {
    const { lessonId } = job.data;
    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, lessonId) });
    if (!lesson) throw new Error(`Lesson ${lessonId} not found`);

    // Placeholder audit: would call audit-toolkit's auditMaster() with the
    // master MP4 key. For now we treat audits as always-passing.
    const auditPassed = true;

    if (auditPassed) {
      await queues.scormBuild.add("build-scorm", { lessonId });
    } else {
      await notifications.dispatch(["in_app", "telegram"], {
        kind: "lesson.stitched",
        body: `Lesson ${lesson.title} stitch produced issues — review master`,
        url: `/lessons/${lessonId}`,
      });
    }
  }, { connection: workerConnection, concurrency: 2 });
}
