/**
 * LTI 1.1 launch endpoint — how an LMS (Moodle "External tool", Canvas, …)
 * embeds our hosted lesson player and gets grades back.
 *
 * Setup in Moodle: Site admin → Plugins → External tool → configure a tool
 * with Tool URL = <PUBLIC_BASE_URL>/api/lti/launch?lesson=<lessonId>,
 * consumer key/secret = LTI_CONSUMER_KEY / LTI_CONSUMER_SECRET, and
 * "Accept grades from the tool" enabled. Each lesson is one tool activity.
 *
 * Public prefix (learners aren't authenticated with us); security is the
 * OAuth 1.0a launch signature.
 */

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";

import { db, tables } from "../db/index.js";
import { verifyLtiLaunch } from "../lib/lti.js";

export const ltiRoute = new Hono()
  .post("/launch", async (c) => {
    const consumerKey = process.env.LTI_CONSUMER_KEY;
    const consumerSecret = process.env.LTI_CONSUMER_SECRET;
    if (!consumerKey || !consumerSecret) return c.text("LTI is not configured (set LTI_CONSUMER_KEY / LTI_CONSUMER_SECRET)", 503);

    const form = await c.req.parseBody();
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) if (typeof v === "string") params[k] = v;
    if (params.oauth_consumer_key !== consumerKey) return c.text("unknown consumer key", 401);

    // The signature is computed over the EXACT public URL the LMS posted to.
    const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    const lessonId = c.req.query("lesson") ?? params.custom_lesson_id ?? "";
    const launchUrl = `${base}/api/lti/launch${c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : ""}`;
    const verdict = verifyLtiLaunch(launchUrl, params, consumerSecret);
    if (!verdict.ok) {
      console.warn(`[lti] launch rejected: ${verdict.reason}`);
      return c.text(`LTI launch rejected: ${verdict.reason}`, 401);
    }

    const lesson = await db.query.lessons.findFirst({ where: eq(tables.lessons.id, lessonId) });
    if (!lesson || !lesson.publishedAt) return c.text("lesson not found or not published", 404);

    // Learner identity: matches what the player will send with the attempt
    // (?learner=lti_<user> → learnerId "name:lti_<user>").
    const lmsUser = (params.user_id ?? "unknown").replace(/[^\w-]/g, "_").slice(0, 60);
    const learnerParam = `lti_${lmsUser}`;
    const learnerId = `name:${learnerParam.toLowerCase()}`;

    // Grade passback coordinates (absent when the tool isn't graded).
    if (params.lis_result_sourcedid && params.lis_outcome_service_url) {
      const existing = await db.query.ltiLinks.findFirst({
        where: and(eq(tables.ltiLinks.lessonId, lessonId), eq(tables.ltiLinks.learnerId, learnerId)),
      });
      if (existing) {
        await db.update(tables.ltiLinks).set({
          sourcedid: params.lis_result_sourcedid,
          outcomeUrl: params.lis_outcome_service_url,
        }).where(eq(tables.ltiLinks.id, existing.id));
      } else {
        await db.insert(tables.ltiLinks).values({
          lessonId, learnerId,
          consumerKey,
          sourcedid: params.lis_result_sourcedid,
          outcomeUrl: params.lis_outcome_service_url,
        });
      }
    }

    console.log(`[lti] launch ok: lesson=${lessonId} user=${lmsUser} graded=${!!params.lis_result_sourcedid}`);
    return c.redirect(`${base}/api/files/lessons/${lessonId}/preview/index.html?learner=${encodeURIComponent(learnerParam)}`, 302);
  });
