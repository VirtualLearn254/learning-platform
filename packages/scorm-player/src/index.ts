/**
 * @lp/scorm-player — the player that runs INSIDE the SCORM iframe inside
 * Moodle. Contains:
 *
 *   src/assets/player.html       — the HTML shell
 *   src/assets/quiz-overlay.js   — the editorial-minimalist overlay (5 types)
 *   src/assets/scorm-api.js      — SCORM 1.2 + 2004 API wrapper
 *   src/assets/xapi-emitter.js   — xAPI statement emitter that POSTs to our LRS
 *   src/assets/player.css        — player chrome styles
 *
 * The scorm-packager package reads these files from this package's
 * `src/assets/` and embeds them in the SCORM zip alongside the lesson MP4
 * + manifest.
 *
 * The functions exported here are helpers for the API/render pipeline:
 *   • playerManifestFor(lesson, beats) → JSON the player loads
 *   • playerEntrypoint(lessonId)       → returns the URL hash a SCORM-wrap
 *                                         page should use
 */

import type { Lesson, Beat } from "@lp/shared";

export interface PlayerManifest {
  id: string;
  title: string;
  durationSec: number;
  masterUrl: string;
  /** Chapter table for scrubbing + the concept-callback feature. */
  chapters: Array<{ id: string; beatKey: string; label: string; startSec: number; endSec: number }>;
  /** Quiz triggers with their data, anchored to chapter times. */
  quizzes: Array<{
    beatId: string;
    beatKey: string;
    type: string;
    question: string;
    eyebrow?: string;
    options: unknown[];
    correctFeedback?: string;
    wrongFeedback?: string;
    branches?: unknown[];
    start_at: number;
    trigger_at: number;
    end_at: number;
  }>;
  /** Alt beats kept as standalone MP4s for branching playback. */
  altBeats: Record<string, { url: string; durationSec: number }>;
  /** Concept callbacks: per-beat "press to jump back to earlier teaching". */
  callbacks: Array<{
    fromBeatKey: string;
    toBeatKey: string;
    toTimestampSec: number;
    concept: string;
    narratorLine: string;
  }>;
}

export function playerManifestFor(input: {
  lesson: Lesson;
  beats: Beat[];
  masterUrl: string;
  /** Per-alt-beat URLs (the scorm-packager passes these in based on its asset layout). */
  altBeatUrls: Record<string, string>;
}): PlayerManifest {
  const mainBeats = input.beats.filter((b) => !b.isAlt).sort((a, b) => a.order - b.order);
  const altBeats = input.beats.filter((b) => b.isAlt);

  // Compute chapter start/end times by walking durations.
  const chapters: PlayerManifest["chapters"] = [];
  let cursor = 0;
  for (const b of mainBeats) {
    const dur = b.durationSeconds ?? 0;
    chapters.push({
      id: b.id,
      beatKey: b.beatKey,
      label: b.beatKey,
      startSec: cursor,
      endSec: cursor + dur,
    });
    cursor += dur + 1.5; // inter-beat pause
  }
  const totalDuration = cursor;

  const quizzes: PlayerManifest["quizzes"] = [];
  for (const b of mainBeats) {
    if (b.beatType !== "check" || !b.quiz) continue;
    const ch = chapters.find((c) => c.id === b.id);
    if (!ch) continue;
    const q = b.quiz as { type: string; question: string; eyebrow?: string; options: unknown[]; correctFeedback?: string; wrongFeedback?: string; branches?: unknown[] };
    quizzes.push({
      beatId: b.id,
      beatKey: b.beatKey,
      type: q.type,
      question: q.question,
      eyebrow: q.eyebrow,
      options: q.options,
      correctFeedback: q.correctFeedback,
      wrongFeedback: q.wrongFeedback,
      branches: q.branches,
      start_at: ch.startSec,
      trigger_at: ch.startSec + 0.5,
      end_at: ch.endSec,
    });
  }

  const altBeatMap: Record<string, { url: string; durationSec: number }> = {};
  for (const a of altBeats) {
    const url = input.altBeatUrls[a.beatKey];
    if (!url) continue;
    altBeatMap[a.beatKey] = { url, durationSec: a.durationSeconds ?? 0 };
  }

  return {
    id: input.lesson.id,
    title: input.lesson.title,
    durationSec: totalDuration,
    masterUrl: input.masterUrl,
    chapters,
    quizzes,
    altBeats: altBeatMap,
    callbacks: [],  // populated by concept-graph when scorm-packager calls
  };
}
