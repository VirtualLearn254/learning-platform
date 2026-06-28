import "dotenv/config";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";

import { env } from "./env.js";
import { coursesRoute } from "./routes/courses.js";
import { beatsRoute } from "./routes/beats.js";
import { lessonsRoute } from "./routes/lessons.js";
import { materialsRoute } from "./routes/materials.js";
import { analyticsRoute } from "./routes/analytics.js";
import { xapiRoute } from "./routes/xapi.js";
import { hermesRoute } from "./routes/hermes.js";
import { searchRoute } from "./routes/search.js";
import { stylesRoute } from "./routes/styles.js";
import { healthRoute } from "./routes/health.js";
import { filesRoute } from "./routes/files.js";
import { jobsRoute } from "./routes/jobs.js";
import { eventsRoute } from "./routes/events.js";
import { conceptsRoute } from "./routes/concepts.js";
import { aiRoute } from "./routes/ai.js";

const app = new Hono();

app.use("*", logger());
app.use("*", cors({
  origin: ["http://localhost:3000"],
  credentials: true,
}));

app.route("/health",    healthRoute);
app.route("/courses",   coursesRoute);
app.route("/lessons",   lessonsRoute);
app.route("/beats",     beatsRoute);
app.route("/materials", materialsRoute);
app.route("/analytics", analyticsRoute);
app.route("/xapi",      xapiRoute);
app.route("/hermes",    hermesRoute);
app.route("/search",    searchRoute);
app.route("/styles",    stylesRoute);
app.route("/files",     filesRoute);
app.route("/jobs",      jobsRoute);
app.route("/events",    eventsRoute);
app.route("/concepts",  conceptsRoute);
app.route("/ai",        aiRoute);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error("[api error]", err);
  return c.json({ error: "internal", message: err.message }, 500);
});

const port = env.API_PORT;
console.log(`[api] listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });

export type AppType = typeof app;
