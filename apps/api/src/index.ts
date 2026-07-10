import "dotenv/config";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { getCookie } from "hono/cookie";

import { sql } from "drizzle-orm";

import { env } from "./env.js";
import { db, tables } from "./db/index.js";
import { authEnabled, verifySessionToken } from "./lib/auth.js";
import { authRoute } from "./routes/auth.js";
import { coursesRoute } from "./routes/courses.js";
import { beatsRoute } from "./routes/beats.js";
import { lessonsRoute } from "./routes/lessons.js";
import { materialsRoute } from "./routes/materials.js";
import { analyticsRoute } from "./routes/analytics.js";
import { xapiRoute } from "./routes/xapi.js";
import { attemptsRoute } from "./routes/attempts.js";
import { hermesRoute } from "./routes/hermes.js";
import { searchRoute } from "./routes/search.js";
import { stylesRoute } from "./routes/styles.js";
import { healthRoute } from "./routes/health.js";
import { filesRoute } from "./routes/files.js";
import { jobsRoute } from "./routes/jobs.js";
import { eventsRoute } from "./routes/events.js";
import { conceptsRoute } from "./routes/concepts.js";
import { aiRoute } from "./routes/ai.js";
import { rulesRoute } from "./routes/rules.js";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({
  origin: ["http://localhost:3000"],
  credentials: true,
}));

/**
 * Auth gate. Public surface is deliberately tiny:
 *   /health      — container healthchecks
 *   /auth/*      — the login flow itself
 *   /xapi        — learner-side event ingestion (players run in LMSes,
 *                  not in the admin session)
 * Everything else requires the lp_session cookie (browser) or a valid
 * session token as Bearer (automation). When LP_ADMIN_PASSWORD is unset,
 * the gate is open — dev mode — and we say so loudly at boot.
 */
const PUBLIC_PREFIXES = ["/health", "/auth", "/xapi"];

app.use("*", async (c, next) => {
  if (!authEnabled()) return next();
  const path = c.req.path;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return next();

  const cookieToken = getCookie(c, "lp_session");
  const bearer = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (verifySessionToken(cookieToken) || verifySessionToken(bearer)) return next();

  return c.json({ error: "unauthorized" }, 401);
});

app.route("/health",    healthRoute);
app.route("/auth",      authRoute);
app.route("/courses",   coursesRoute);
app.route("/lessons",   lessonsRoute);
app.route("/beats",     beatsRoute);
app.route("/materials", materialsRoute);
app.route("/analytics", analyticsRoute);
app.route("/xapi",      xapiRoute);
app.route("/attempts",  attemptsRoute);
app.route("/hermes",    hermesRoute);
app.route("/search",    searchRoute);
app.route("/styles",    stylesRoute);
app.route("/files",     filesRoute);
app.route("/jobs",      jobsRoute);
app.route("/events",    eventsRoute);
app.route("/concepts",  conceptsRoute);
app.route("/ai",        aiRoute);
app.route("/rules",     rulesRoute);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error("[api error]", err);
  return c.json({ error: "internal", message: err.message }, 500);
});

if (!authEnabled()) {
  console.warn("[api] ⚠️  AUTH DISABLED — set LP_ADMIN_PASSWORD (and LP_SECRETS_KEY) in .env.prod to lock the API.");
}

/**
 * Housekeeping: the jobs table grows per pipeline action forever. Sweep
 * daily — succeeded jobs older than 30 days, failed older than 90 (kept
 * longer for post-mortems). Runs at boot + every 24h.
 */
async function sweepOldJobs() {
  try {
    await db.delete(tables.jobs).where(sql`status = 'succeeded' and created_at < now() - interval '30 days'`);
    await db.delete(tables.jobs).where(sql`status = 'failed' and created_at < now() - interval '90 days'`);
  } catch (err) {
    console.warn("[housekeeping] job sweep failed:", err instanceof Error ? err.message : err);
  }
}
void sweepOldJobs();
setInterval(sweepOldJobs, 24 * 60 * 60 * 1000).unref();

const port = env.API_PORT;
console.log(`[api] listening on http://localhost:${port} (auth: ${authEnabled() ? "on" : "OFF"})`);
serve({ fetch: app.fetch, port });

export type AppType = typeof app;
