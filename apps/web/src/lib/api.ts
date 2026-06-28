/**
 * Typed fetch wrapper. The Next.js rewrite (next.config.ts) maps
 * /api/* → the backend, so the browser sees one origin.
 */

import type { Course, Beat, Lesson, BeatStage, LearningEvent } from "@lp/shared";

const BASE = "/api";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetchJson<{ ok: boolean; db: boolean; providers: Record<string, boolean> }>("/health"),

  // Courses
  listCourses: () => fetchJson<{ courses: Course[] }>("/courses"),
  getCourse: (id: string) => fetchJson<{ course: Course }>(`/courses/${id}`),
  getCourseTree: (id: string) => fetchJson<{ tree: CourseTreeResponse }>(`/courses/${id}/tree`),
  createCourse: (input: { title: string; summary?: string }) =>
    fetchJson<{ course: Course }>("/courses", { method: "POST", body: JSON.stringify(input) }),

  // Lessons
  getLesson: (id: string) => fetchJson<{ lesson: Lesson; beats: Beat[] }>(`/lessons/${id}`),
  authorLesson: (id: string, opts?: { all?: boolean }) =>
    fetchJson<{ ok: boolean; queued?: number; jobIds?: string[]; message?: string; error?: string }>(`/lessons/${id}/author${opts?.all ? "?all=true" : ""}`, { method: "POST" }),
  stitchLesson: (id: string) => fetchJson<{ ok: boolean; jobId: string }>(`/lessons/${id}/stitch`, { method: "POST" }),
  publishLesson: (id: string) => fetchJson<{ ok: boolean; jobId: string }>(`/lessons/${id}/publish`, { method: "POST" }),

  // Beats
  listBeats: (params?: { stage?: BeatStage[]; lessonId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.stage) qs.set("stage", params.stage.join(","));
    if (params?.lessonId) qs.set("lessonId", params.lessonId);
    return fetchJson<{ beats: Beat[] }>(`/beats${qs.toString() ? `?${qs}` : ""}`);
  },
  getBeat: (id: string) => fetchJson<{ beat: Beat }>(`/beats/${id}`),
  authorBeat: (id: string) => fetchJson<{ ok: boolean; jobId: string }>(`/beats/${id}/author`, { method: "POST" }),
  giveBeatFeedback: (id: string, input: { feedback: string; action: "approve" | "revise" | "reject"; screenshotKeys?: string[] }) =>
    fetchJson<{ ok: boolean; stage: BeatStage }>(`/beats/${id}/feedback`, { method: "POST", body: JSON.stringify(input) }),
  updateBeat: (id: string, patch: Partial<Beat>) =>
    fetchJson<{ beat: Beat }>(`/beats/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  listBeatJobs: (beatId: string) =>
    fetchJson<{ jobs: Array<{ id: string; queue: string; status: string; attempts: number; startedAt: string | null; endedAt: string | null; etaSeconds: number | null; errorMessage: string | null; createdAt: string }> }>(`/jobs?beatId=${beatId}`),

  // Concepts
  conceptsByCourse: (courseId: string) =>
    fetchJson<{ concepts: Array<{ concept: string; taughtBy: string[]; requiredBy: string[] }> }>(`/concepts/by-course/${courseId}`),

  // Materials
  listMaterials: (courseId: string) =>
    fetchJson<{ materials: Array<{ id: string; filename: string; mimeType: string; sizeBytes: number; ingestedAt: string | null; s3Key: string; latestJob: JobSummary | null }> }>(`/materials?courseId=${courseId}`),
  getMaterial: (id: string) =>
    fetchJson<{ material: { id: string; courseId: string; filename: string; mimeType: string; sizeBytes: number; ingestedAt: string | null; uploadedAt: string; s3Key: string; extractedText: string | null; latestJob: JobSummary | null } }>(`/materials/${id}`),
  /** Direct multipart upload. Set triggerIngest=true to auto-queue ingest after upload. */
  uploadMaterial: async (input: { courseId: string; file: File; triggerIngest?: boolean }) => {
    const fd = new FormData();
    fd.append("courseId", input.courseId);
    fd.append("file", input.file);
    if (input.triggerIngest) fd.append("triggerIngest", "true");
    const res = await fetch("/api/materials", { method: "POST", body: fd });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<{ material: { id: string; s3Key: string; filename: string }; ingestJobId?: string }>;
  },
  triggerIngest: (materialId: string) =>
    fetchJson<{ ok: boolean; jobId: string }>(`/materials/${materialId}/ingest`, { method: "POST" }),

  // Analytics
  analyticsSummary: (params: { courseId?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return fetchJson<{ eventsByType: Record<string, number>; totalEvents: number }>(`/analytics/summary${qs ? `?${qs}` : ""}`);
  },
  analyticsReplays: (courseId?: string) =>
    fetchJson<{ replays: Array<{ beatId: string; replays: number }> }>(`/analytics/beats/replays${courseId ? `?courseId=${courseId}` : ""}`),
  analyticsQuizDifficulty: (courseId?: string) =>
    fetchJson<{ quizzes: Array<{ beatId: string; total: number; wrong: number; wrongRate: number }> }>(`/analytics/quizzes/difficulty${courseId ? `?courseId=${courseId}` : ""}`),

  // Hermes
  listHermesRuns: () =>
    fetchJson<{ runs: Array<{ runId: string; startedAt: string; completedAt: string | null; status: string; beatsReviewed: number; stylesProposed: number; notes: string }> }>("/hermes/runs"),
  triggerHermesRun: (input?: { beatLimit?: number }) =>
    fetchJson<{ runId: string }>("/hermes/runs", { method: "POST", body: JSON.stringify(input ?? {}) }),
  listPendingStyles: () =>
    fetchJson<{ candidates: Array<{ id: string; name: string; description: string; rationale: string; recommendedFor: string[]; previewMp4Key?: string }> }>("/hermes/styles/pending"),
  approveStyle: (id: string) =>
    fetchJson<{ ok: boolean }>(`/hermes/styles/${id}/approve`, { method: "POST" }),
  rejectStyle: (id: string, reason: string) =>
    fetchJson<{ ok: boolean }>(`/hermes/styles/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),

  // Images
  searchImages: (q: string, opts?: { perProvider?: number; aspect?: "16:9" | "1:1" | "any" }) => {
    const params = new URLSearchParams({ q, ...(opts?.perProvider ? { perProvider: String(opts.perProvider) } : {}), ...(opts?.aspect ? { aspect: opts.aspect } : {}) });
    return fetchJson<{ results: Array<{ id: string; provider: string; url: string; thumbnailUrl: string; width: number; height: number; alt: string | null }> }>(`/search/images?${params}`);
  },

  // Styles
  listStyles: (approved?: boolean) =>
    fetchJson<{ styles: Array<{ id: string; name: string; description: string | null; templateId: string; tags: string[]; approved: boolean }> }>(`/styles${approved !== undefined ? `?approved=${approved}` : ""}`),

  // xAPI (used by the SCORM player; mostly here for completeness)
  postXApiStatement: (statement: unknown) =>
    fetchJson<{ ok: boolean; received: number }>("/xapi/statements", { method: "POST", body: JSON.stringify(statement) }),

  // AI provider dashboard
  listAIProviders: () =>
    fetchJson<{ providers: Array<{ id: "anthropic" | "openai" | "deepseek" | "local"; displayName: string; envKey: string; signupUrl: string; pricing: string; configured: boolean; secretName: string }> }>("/ai/providers"),
  listAIProfiles: () =>
    fetchJson<{ profiles: Array<{ id: string; preferred: string[]; activeProvider: string | null; activeModel: string | null; temperature: number; maxTokens: number; supportsVision: boolean }> }>("/ai/profiles"),
  testAIProvider: (provider: string) =>
    fetchJson<{ ok: boolean; model?: string; actualModel?: string; latencyMs?: number; sample?: string; usage?: { inputTokens: number; outputTokens: number }; error?: string }>(`/ai/test/${provider}`, { method: "POST" }),

  // AI secrets — UI-managed, encrypted at rest
  listAISecrets: () =>
    fetchJson<{
      canSave: boolean;
      secrets: Array<{ name: string; configured: boolean; source: "db" | "env" | null; lastFour: string | null; updatedAt: string | null }>;
    }>("/ai/secrets"),
  saveAISecret: (name: string, value: string) =>
    fetchJson<{ ok: boolean; status?: { name: string; lastFour: string; updatedAt: string }; error?: string }>(`/ai/secrets/${name}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
  deleteAISecret: (name: string) =>
    fetchJson<{ ok: boolean }>(`/ai/secrets/${name}`, { method: "DELETE" }),

  // AI model catalog + role overrides
  listAIModels: () =>
    fetchJson<{ catalog: Record<"anthropic" | "openai" | "deepseek" | "local", Array<{ id: string; displayName: string; inputPer1M: number; outputPer1M: number; supportsVision?: boolean; speed?: string; tier?: string }>> }>("/ai/models"),
  saveAIProfile: (id: string, patch: { preferredProvider?: string; modelId?: string; temperature?: number; maxTokens?: number }) =>
    fetchJson<{ ok: boolean; error?: string }>(`/ai/profiles/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  resetAIProfile: (id: string) =>
    fetchJson<{ ok: boolean }>(`/ai/profiles/${id}`, { method: "DELETE" }),

  // AI usage analytics
  getAIUsage: (window: "1h" | "24h" | "7d" | "30d") =>
    fetchJson<{
      window: string;
      since: string;
      totals: { calls: number; okCalls: number; errorCalls: number; inputTokens: number; outputTokens: number; costUsd: number; avgLatencyMs: number; avgCostUsd: number };
      byProfile: Array<{ key: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; share: number }>;
      byProvider: Array<{ key: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; share: number }>;
      byModel: Array<{ key: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; share: number }>;
      timeSeries: Array<{ bucket: string; calls: number; costUsd: number }>;
    }>(`/ai/usage?window=${window}`),
};

// Course tree response shape (from /courses/:id/tree)
export interface CourseTreeResponse extends Course {
  sections: Array<{
    id: string; courseId: string; title: string; order: number;
    modules: Array<{
      id: string; sectionId: string; title: string; order: number;
      lessons: Array<Lesson & { beats: Beat[] }>;
    }>;
  }>;
}

export type { LearningEvent };

export interface JobSummary {
  id: string;
  status: string; // queued | running | succeeded | failed
  progressNote: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  endedAt: string | null;
}
