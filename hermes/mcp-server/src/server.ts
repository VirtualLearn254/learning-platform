/**
 * lp-hermes-mcp — the bridge between Hermes profiles (the production brain)
 * and the learning-platform app (the deterministic substrate).
 *
 * Design rule this server enforces by its very shape: Hermes DECIDES, the app
 * EXECUTES. Every tool here is either a read (state, frames) or a command to
 * deterministic machinery (render, stitch, publish). No tool creates content —
 * scripts, designs and quiz specs are authored by the agent and saved via
 * update_beat.
 *
 * Env:
 *   LP_API_BASE        default http://127.0.0.1  (endpoints under <base>/api)
 *   LP_ADMIN_PASSWORD  optional — if set, logs in once and reuses the cookie
 *
 * Frames are returned as MCP image content so a vision-capable agent can
 * LOOK at renders directly — the backbone of the verify step.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.LP_API_BASE ?? "http://127.0.0.1").replace(/\/$/, "");
const API = `${BASE}/api`;

// ─── HTTP plumbing (cookie auth, JSON helpers) ──────────────────────

let cookie: string | null = null;

async function login(): Promise<void> {
  const pw = process.env.LP_ADMIN_PASSWORD;
  if (!pw) return;
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0] ?? null;
}

async function req(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("cookie", cookie);
  const res = await fetch(`${API}${path}`, { ...init, headers });
  // Session expired → re-login once and retry.
  if (res.status === 401 && process.env.LP_ADMIN_PASSWORD) {
    await login();
    const h2 = new Headers(init?.headers);
    if (cookie) h2.set("cookie", cookie);
    return fetch(`${API}${path}`, { ...init, headers: h2 });
  }
  return res;
}

async function getJson(path: string): Promise<unknown> {
  const res = await req(path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function sendJson(method: "POST" | "PATCH", path: string, body?: unknown): Promise<unknown> {
  const res = await req(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 1) }] };
}

// ─── Server + tools ─────────────────────────────────────────────────

const server = new McpServer({ name: "lp-hermes-mcp", version: "0.1.0" });

// — Reads: course/lesson/beat state ——————————————————————————————————

server.registerTool("get_course_tree", {
  description: "Full structure of a course: sections → modules → lessons → beats (with stages). The map of what exists and where production stands.",
  inputSchema: { courseId: z.string().describe("Course UUID") },
}, async ({ courseId }) => textResult(await getJson(`/courses/${courseId}/tree`)));

server.registerTool("list_lessons", {
  description: "Lightweight index of every lesson (id, title, publishedAt).",
  inputSchema: {},
}, async () => textResult(await getJson(`/lessons`)));

server.registerTool("get_lesson", {
  description: "One lesson in full: metadata, ALL its beats (script, visualSpec, quiz, stage, mp4Key, review state), latest stitch/publish jobs, and AI cost so far.",
  inputSchema: { lessonId: z.string().describe("Lesson UUID") },
}, async ({ lessonId }) => textResult(await getJson(`/lessons/${lessonId}`)));

server.registerTool("list_beats", {
  description: "List beats, filterable by pipeline stage and/or lesson. Stages: queued, ingested, authoring, ai_review, revising, human_review, approved, rendering, stitched, published.",
  inputSchema: {
    stage: z.string().optional().describe("Comma-separated stage filter, e.g. 'human_review' or 'authoring,revising'"),
    lessonId: z.string().optional(),
  },
}, async ({ stage, lessonId }) => {
  const qs = new URLSearchParams();
  if (stage) qs.set("stage", stage);
  if (lessonId) qs.set("lessonId", lessonId);
  return textResult(await getJson(`/beats${qs.size ? `?${qs}` : ""}`));
});

server.registerTool("get_beat", {
  description: "One beat in full: script, visualSpec, quiz, stage, revision count, review score/issues, error message, media keys.",
  inputSchema: { beatId: z.string().describe("Beat UUID") },
}, async ({ beatId }) => textResult(await getJson(`/beats/${beatId}`)));

// — Writes: the agent's authored content lands here ————————————————————

server.registerTool("update_beat", {
  description: "Save agent-authored content onto a beat: narration script, visual spec, and/or quiz spec. This is how Hermes' creative output enters the substrate. Follow the author-beat / quiz-author skills for the required shapes and craft rules.",
  inputSchema: {
    beatId: z.string(),
    script: z.string().optional().describe("Narration script (60–100 words for a standard beat)"),
    visualSpec: z.record(z.unknown()).optional().describe("Visual spec object: { background, onScreenText[], callouts[], style? }"),
    quiz: z.record(z.unknown()).optional().describe("Quiz spec (QuizSpec shape: type, question, options[], adaptivity?, branches?)"),
  },
}, async ({ beatId, script, visualSpec, quiz }) => {
  const patch: Record<string, unknown> = {};
  if (script !== undefined) patch.script = script;
  if (visualSpec !== undefined) patch.visualSpec = visualSpec;
  if (quiz !== undefined) patch.quiz = quiz;
  return textResult(await sendJson("PATCH", `/beats/${beatId}`, patch));
});

// — Commands to deterministic machinery ————————————————————————————————

server.registerTool("render_beat", {
  description: "Queue a beat render on the substrate (TTS → designer HTML → Chromium → MP4). With correctionNote, the render incorporates the described visual fix (~$0.10, 3–6 min). Returns a job id — poll with job_status or re-check the beat's stage/mp4Key.",
  inputSchema: {
    beatId: z.string(),
    correctionNote: z.string().optional().describe("Exact visual defect and desired outcome, e.g. 'step-3 label overlaps the axis; move the label block 40px right'"),
  },
}, async ({ beatId, correctionNote }) =>
  textResult(await sendJson("POST", `/beats/${beatId}/render`, correctionNote ? { correctionNote } : {})));

server.registerTool("get_keyframes", {
  description: "Frame manifest for a rendered beat: 3 labeled verify frames (entrance/hero/settle) plus ~20-30 even-interval keyframes. Returns S3 keys — pass them to get_frame to LOOK at them. Never judge a render without viewing frames.",
  inputSchema: { beatId: z.string() },
}, async ({ beatId }) => textResult(await getJson(`/beats/${beatId}/keyframes`)));

server.registerTool("get_frame", {
  description: "Fetch one frame image (by S3 key from get_keyframes) as vision content — the agent SEES the actual rendered pixels.",
  inputSchema: { key: z.string().describe("S3 key, e.g. 'beats/<id>/verify-2.png'") },
}, async ({ key }) => {
  const res = await req(`/files/${key}`);
  if (!res.ok) throw new Error(`frame fetch ${key} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = key.endsWith(".jpg") || key.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: mime }] };
});

server.registerTool("run_ai_review", {
  description: "Queue the substrate's per-beat AI review pass (scores 0-100 + structured issues). Cheap second opinion; the agent's own frame-based verify remains authoritative.",
  inputSchema: { beatId: z.string() },
}, async ({ beatId }) => textResult(await sendJson("POST", `/beats/${beatId}/review`)));

server.registerTool("submit_review", {
  description: "Record a review decision on a beat. action=approve advances it; revise sends it back with your feedback as revision instructions; reject restarts authoring. NEVER approve past the human gate — beats in human_review awaiting the HUMAN are not yours to approve unless the operator has delegated that role to this profile.",
  inputSchema: {
    beatId: z.string(),
    action: z.enum(["approve", "revise", "reject"]),
    feedback: z.string().describe("Reason (approve) or specific, actionable instructions (revise/reject). Prefix with your profile name, e.g. '[hermes:accounting] …'"),
  },
}, async ({ beatId, action, feedback }) =>
  textResult(await sendJson("POST", `/beats/${beatId}/feedback`, { action, feedback })));

server.registerTool("stitch_lesson", {
  description: "Queue the lesson stitch: concatenate all rendered main beats into the master MP4. Deterministic; run after all main beats have mp4s.",
  inputSchema: { lessonId: z.string() },
}, async ({ lessonId }) => textResult(await sendJson("POST", `/lessons/${lessonId}/stitch`)));

server.registerTool("publish_lesson", {
  description: "Queue the SCORM publish: master MP4 + interactive quizzes + branch clips + lesson notes → self-contained zip + hosted preview. Requires a stitched master. Only publish when the lesson has passed its gates.",
  inputSchema: { lessonId: z.string() },
}, async ({ lessonId }) => textResult(await sendJson("POST", `/lessons/${lessonId}/publish`)));

server.registerTool("generate_notes", {
  description: "Queue lesson-notes PDF generation (designer-AI reference doc from source material, ships in the zip).",
  inputSchema: { lessonId: z.string() },
}, async ({ lessonId }) => textResult(await sendJson("POST", `/lessons/${lessonId}/notes`)));

server.registerTool("generate_branches", {
  description: "Create remediation branch beats for every quiz with wrong options (LP-18): alt beats that play after a final wrong answer, then resume. They ride the normal author→review→render chain.",
  inputSchema: { lessonId: z.string() },
}, async ({ lessonId }) => textResult(await sendJson("POST", `/lessons/${lessonId}/branches`)));

// — Observability ————————————————————————————————————————————————————

server.registerTool("job_status", {
  description: "Recent substrate jobs (render, stitch, scorm_build, lesson_notes…): status, progress note, errors. The cheap way to check on queued work — do NOT poll in a tight loop; renders take 3–6 minutes.",
  inputSchema: { status: z.string().optional().describe("Filter, e.g. 'running' or 'failed'") },
}, async ({ status }) =>
  textResult(await getJson(`/jobs${status ? `?status=${status}` : ""}`)));

server.registerTool("get_publish_catalog", {
  description: "Machine-readable catalog of everything published: per lesson, the stable scormUrl / playUrl / ltiLaunchUrl / notesUrl.",
  inputSchema: {},
}, async () => textResult(await getJson(`/publish/courses`)));

// ─── Boot ───────────────────────────────────────────────────────────

await login();
await server.connect(new StdioServerTransport());
console.error(`[lp-hermes-mcp] serving ${API} over stdio`);
