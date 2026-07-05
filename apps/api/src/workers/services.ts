/**
 * Singleton service instances. Workers grab the same instances so we don't
 * spin up extra connections per job. AI providers are constructed lazily.
 */

import { createScormPackager } from "@lp/scorm-packager";
import { createPdfGenerator } from "@lp/pdf-generator";
import { createImageSearchClient } from "@lp/image-search";
import { createNotificationClient } from "@lp/notifications";
import { createLrsClient, type NormalizedEvent } from "@lp/lrs";

import { db, tables } from "../db/index.js";

export const scormPackager = createScormPackager();
export const pdfGenerator = createPdfGenerator();

export const imageSearch = createImageSearchClient({});  // wire keys when adding env vars

export const notifications = createNotificationClient({}); // wire when channels configured

export const lrs = createLrsClient({
  async storeEvent(event: NormalizedEvent) {
    await db.insert(tables.learningEvents).values({
      courseId: event.courseId,
      beatId: event.beatId,
      learnerId: event.learnerId,
      eventType: event.eventType,
      data: event.data,
      ts: event.ts,
    });
  },
  async runQuery(_filter) {
    // Placeholder query implementation; real version uses Drizzle aggregates.
    return { rows: [], total: 0 };
  },
});
