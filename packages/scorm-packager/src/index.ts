/**
 * @lp/scorm-packager — builds SCORM 2004 4th-Edition packages from a stitched
 * lesson + its quiz/branch metadata.
 *
 * Architectural choice: our custom web player runs INSIDE the SCORM iframe,
 * so all our overlay/quiz/callback features survive into Moodle. The player
 * emits xAPI statements via the SCORM API surface (cmi.interactions for
 * quiz answers; cmi.session_time for engagement; custom xAPI POSTs for
 * deeper signals like "replayed beat", "pressed callback button").
 *
 * Today these functions return interface-shaped placeholders. The real
 * implementation: build the imsmanifest.xml from a Handlebars template,
 * copy the player + assets into a temp dir, zip the whole thing.
 */

import type { Lesson, Beat } from "@lp/shared";

export interface ScormBuildInput {
  lesson: Lesson;
  beats: Beat[];
  masterMp4Key: string;
  /** Alt beats stored alongside the master for branching playback. */
  altBeats: Array<{ beatKey: string; mp4Key: string }>;
  /** The S3 key the resulting .zip should be written to. */
  outputKey: string;
  /** Branding / theme config. */
  branding?: {
    organizationName: string;
    logoUrl?: string;
  };
  /** SCORM version target. */
  version?: "1.2" | "2004_3" | "2004_4";
}

export interface ScormBuildOutput {
  scormZipKey: string;
  /** Size in bytes of the resulting zip. */
  sizeBytes: number;
  /** SHA-256 of the zip for integrity verification. */
  sha256: string;
}

export interface ScormPackager {
  build(input: ScormBuildInput): Promise<ScormBuildOutput>;
}

export function createScormPackager(): ScormPackager {
  return {
    async build(input) {
      return {
        scormZipKey: input.outputKey,
        sizeBytes: 0,
        sha256: "placeholder",
      };
    },
  };
}

/**
 * xAPI statement builders — used by the in-SCORM player to construct
 * statements before posting to the LRS endpoint.
 */
export const xapi = {
  videoPlay(actorId: string, courseId: string, beatId: string) {
    return baseStatement(actorId, "https://w3id.org/xapi/video/verbs/played", { courseId, beatId });
  },
  quizAnswered(actorId: string, courseId: string, beatId: string, optionId: string, correct: boolean) {
    return baseStatement(actorId, "http://adlnet.gov/expapi/verbs/answered", {
      courseId, beatId, optionId, correct,
    });
  },
  beatReplayed(actorId: string, courseId: string, beatId: string, replayCount: number) {
    return baseStatement(actorId, "https://learning-platform.internal/verbs/replayed", {
      courseId, beatId, replayCount,
    });
  },
  callbackPressed(actorId: string, courseId: string, fromBeatId: string, toBeatId: string) {
    return baseStatement(actorId, "https://learning-platform.internal/verbs/referenced", {
      courseId, fromBeatId, toBeatId,
    });
  },
};

function baseStatement(actorId: string, verbId: string, payload: Record<string, unknown>) {
  return {
    actor: { account: { name: actorId, homePage: "https://learning-platform.internal" } },
    verb: { id: verbId },
    object: { id: `https://learning-platform.internal/object/${actorId}` },
    timestamp: new Date().toISOString(),
    context: { extensions: { "https://learning-platform.internal/data": payload } },
  };
}
