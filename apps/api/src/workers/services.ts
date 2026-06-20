/**
 * Singleton service instances. Workers grab the same instances so we don't
 * spin up extra connections per job. AI providers are constructed lazily.
 */

import { createAIClient } from "@lp/ai-provider";
import { createRenderEngine } from "@lp/render-engine";
import { createScormPackager } from "@lp/scorm-packager";
import { createPdfGenerator } from "@lp/pdf-generator";
import { createImageSearchClient } from "@lp/image-search";
import { createNotificationClient } from "@lp/notifications";
import { createLrsClient, type NormalizedEvent } from "@lp/lrs";
import { createHermesClient } from "@lp/hermes-bridge";
import { createConceptGraph } from "@lp/concept-graph";

import { env } from "../env.js";
import { db, tables } from "../db/index.js";

export const ai = createAIClient({
  vllm:     env.VLLM_BASE_URL  ? { baseUrl: env.VLLM_BASE_URL, apiKey: env.VLLM_API_KEY } : undefined,
  openai:   env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : undefined,
  deepseek: env.DEEPSEEK_API_KEY ? { apiKey: env.DEEPSEEK_API_KEY } : undefined,
});

export const renderEngine = createRenderEngine(ai);
export const scormPackager = createScormPackager();
export const pdfGenerator = createPdfGenerator();
export const conceptGraph = createConceptGraph();

export const imageSearch = createImageSearchClient({});  // wire keys when adding env vars

export const notifications = createNotificationClient({}); // wire when channels configured

export const hermes = createHermesClient({ rpcUrl: process.env.HERMES_RPC_URL ?? "" });

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
