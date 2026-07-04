/**
 * @lp/scorm-packager — builds SCORM 2004 4th-Ed packages from a stitched
 * lesson master MP4. Bundles:
 *
 *   imsmanifest.xml   — SCORM manifest declaring one SCO with one asset
 *   index.html        — HTML5 player wrapper that connects to LMS API
 *   scorm-api.js      — SCORM 1.2 + 2004 discovery + normalized client
 *   master.mp4        — the video
 *
 * The zip is returned as a Buffer for the caller to upload wherever
 * (S3, disk, whatever). SHA-256 of the resulting bytes is also returned.
 */

import { createHash } from "node:crypto";
import JSZip from "jszip";

import type { Lesson, Beat } from "@lp/shared";

/**
 * SCORM 2004 4th Edition manifest template. Uses a stable identifier
 * derived from the lesson id so re-packaging the same lesson always
 * produces the same manifest.
 */
function buildManifest(lesson: { id: string; title: string; summary?: string | null; durationSec?: number }, opts: { organization?: string } = {}): string {
  const identifier = `LP_LESSON_${lesson.id.replace(/-/g, "").slice(0, 24)}`;
  const orgId = `${identifier}_ORG`;
  const itemId = `${identifier}_ITEM`;
  const resId = `${identifier}_RES`;
  const title = xmlEscape(lesson.title);
  const description = xmlEscape((lesson.summary ?? "").slice(0, 500));
  const organizationName = xmlEscape(opts.organization ?? "Learning Platform");

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${identifier}"
          version="1.3"
          xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
          xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
          xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
                              http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd
                              http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd
                              http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
    <lom xmlns="http://ltsc.ieee.org/xsd/LOM">
      <general>
        <title><string language="en">${title}</string></title>
        <description><string language="en">${description}</string></description>
      </general>
      <lifeCycle>
        <contribute>
          <role><value>publisher</value></role>
          <entity>${organizationName}</entity>
        </contribute>
      </lifeCycle>
    </lom>
  </metadata>
  <organizations default="${orgId}">
    <organization identifier="${orgId}">
      <title>${title}</title>
      <item identifier="${itemId}" identifierref="${resId}">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="${resId}" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
      <file href="scorm-api.js"/>
      <file href="master.mp4"/>
    </resource>
  </resources>
</manifest>
`;
}

/**
 * Player HTML wrapper. Full-viewport <video> that:
 *   - Calls scorm.connect() on load
 *   - Marks completed when the video ends
 *   - Marks incomplete + disconnects on unload
 *   - Records session_time via native LMS clock (no manual tracking needed)
 */
function buildPlayerHtml(lesson: { title: string }): string {
  const title = htmlEscape(lesson.title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<script src="scorm-api.js"></script>
<style>
  html, body { margin: 0; padding: 0; background: #0a0a0a; color: #eee; font-family: system-ui, -apple-system, sans-serif; height: 100%; overflow: hidden; }
  .stage { position: relative; width: 100vw; height: 100vh; }
  video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
  .title-badge {
    position: absolute; top: 16px; left: 20px;
    font-size: 13px; color: rgba(255,255,255,0.55);
    background: rgba(0,0,0,0.4); padding: 6px 12px; border-radius: 6px;
    pointer-events: none;
    max-width: calc(100vw - 40px);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .status {
    position: absolute; bottom: 16px; right: 20px;
    font-size: 12px; color: rgba(255,255,255,0.5);
    background: rgba(0,0,0,0.5); padding: 4px 10px; border-radius: 6px;
    pointer-events: none;
  }
  .status.complete { color: #34D399; }
</style>
</head>
<body>
  <div class="stage">
    <div class="title-badge">${title}</div>
    <video id="v" src="master.mp4" controls autoplay preload="metadata" playsinline></video>
    <div class="status" id="status">connecting…</div>
  </div>
<script>
(function() {
  var scorm = window.createScormApi();
  var status = document.getElementById('status');
  var connected = scorm.connect();
  status.textContent = connected ? 'connected · in progress' : 'standalone (no LMS)';

  var video = document.getElementById('v');
  var completed = false;

  video.addEventListener('ended', function() {
    if (completed) return;
    completed = true;
    if (connected) {
      scorm.setStatus('completed');
      scorm.setScore(0, 100, 100);
      scorm.commit();
    }
    status.textContent = 'complete';
    status.classList.add('complete');
  });

  window.addEventListener('beforeunload', function() {
    if (!connected) return;
    if (!completed) scorm.setStatus('incomplete');
    scorm.commit();
    scorm.disconnect();
  });
})();
</script>
</body>
</html>
`;
}

// The SCORM API wrapper — same content as packages/scorm-player/src/assets/scorm-api.js.
// Duplicated here so scorm-packager is self-contained. If the player-side file
// diverges, mirror the update here.
const SCORM_API_JS = `(function(g){function findApi(){var w=window;for(var d=0;d<7;d++){if(w.API_1484_11)return{api:w.API_1484_11,version:'2004'};if(w.parent===w)break;w=w.parent}w=window;for(var d=0;d<7;d++){if(w.API)return{api:w.API,version:'1.2'};if(w.parent===w)break;w=w.parent}return null}
function createScormApi(){var f=null;return{connect:function(){f=findApi();if(!f){console.warn('[scorm] no LMS API found; standalone');return false}var ok=f.version==='2004'?f.api.Initialize(''):f.api.LMSInitialize('');return ok==='true'||ok===true},
disconnect:function(){if(!f)return;if(f.version==='2004')f.api.Terminate('');else f.api.LMSFinish('')},
getLearnerId:function(){if(!f)return null;return f.version==='2004'?f.api.GetValue('cmi.learner_id'):f.api.LMSGetValue('cmi.core.student_id')},
setStatus:function(s){if(!f)return;var k=f.version==='2004'?'cmi.completion_status':'cmi.core.lesson_status';if(f.version==='2004')f.api.SetValue(k,s);else f.api.LMSSetValue(k,s)},
setScore:function(min,max,raw){if(!f)return;if(f.version==='2004'){f.api.SetValue('cmi.score.min',String(min));f.api.SetValue('cmi.score.max',String(max));f.api.SetValue('cmi.score.raw',String(raw));f.api.SetValue('cmi.score.scaled',String(raw/Math.max(1,max)))}else{f.api.LMSSetValue('cmi.core.score.min',String(min));f.api.LMSSetValue('cmi.core.score.max',String(max));f.api.LMSSetValue('cmi.core.score.raw',String(raw))}},
commit:function(){if(!f)return;if(f.version==='2004')f.api.Commit('');else f.api.LMSCommit('')}}}
g.createScormApi=createScormApi})(window);`;

// ─── Types ──────────────────────────────────────────────────────────

export interface ScormBuildInput {
  lesson: Pick<Lesson, "id" | "title" | "summary">;
  /** Beats aren't required for a plain master-video SCO but accepted for future use. */
  beats?: Beat[];
  /** Raw MP4 bytes of the master video. */
  masterMp4: Buffer;
  /** Optional branding. */
  branding?: {
    organizationName?: string;
  };
  /** SCORM version target. 2004 4th Ed is the default and recommended. */
  version?: "2004_4";
}

export interface ScormBuildOutput {
  /** The zip bytes. */
  zip: Buffer;
  sizeBytes: number;
  sha256: string;
}

export interface ScormPackager {
  build(input: ScormBuildInput): Promise<ScormBuildOutput>;
}

// ─── Factory ────────────────────────────────────────────────────────

export function createScormPackager(): ScormPackager {
  return {
    async build(input) {
      const zip = new JSZip();
      zip.file("imsmanifest.xml", buildManifest(input.lesson, { organization: input.branding?.organizationName }));
      zip.file("index.html", buildPlayerHtml(input.lesson));
      zip.file("scorm-api.js", SCORM_API_JS);
      zip.file("master.mp4", input.masterMp4);

      const bytes = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      return {
        zip: bytes,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },
  };
}

// ─── xAPI helpers (unchanged) ───────────────────────────────────────

export const xapi = {
  videoPlay(actorId: string, courseId: string, beatId: string) {
    return baseStatement(actorId, "https://w3id.org/xapi/video/verbs/played", { courseId, beatId });
  },
  quizAnswered(actorId: string, courseId: string, beatId: string, optionId: string, correct: boolean) {
    return baseStatement(actorId, "http://adlnet.gov/expapi/verbs/answered", { courseId, beatId, optionId, correct });
  },
  beatReplayed(actorId: string, courseId: string, beatId: string, replayCount: number) {
    return baseStatement(actorId, "https://learning-platform.internal/verbs/replayed", { courseId, beatId, replayCount });
  },
  callbackPressed(actorId: string, courseId: string, fromBeatId: string, toBeatId: string) {
    return baseStatement(actorId, "https://learning-platform.internal/verbs/referenced", { courseId, fromBeatId, toBeatId });
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

// ─── Small XML/HTML escape utils ────────────────────────────────────

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
}
function htmlEscape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
