"use client";

import { use } from "react";
import useSWR from "swr";
import { Play, Download, Wand2, Film, Glasses } from "lucide-react";

import { api, type LessonJobSummary } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VideoPlayer } from "@/components/video-player";
import { BeatRow } from "@/components/beat-row";
import { ContextStrip, Chip } from "@/components/context-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { ReviewIssues } from "@/components/review-issues";
import { ErrorState } from "@/components/error-state";
import { useToast } from "@/lib/use-toast";

function JobPill({ label, job }: { label: string; job: LessonJobSummary | null }) {
  if (!job) {
    return (
      <span className="text-xs text-[var(--color-muted)]">
        {label} <span className="opacity-60">— not run</span>
      </span>
    );
  }
  const tone =
    job.status === "running"   ? "text-[var(--color-accent)]" :
    job.status === "succeeded" ? "text-[var(--color-accent)]" :
    job.status === "failed"    ? "text-[var(--color-accent-2)]" :
    "text-[var(--color-muted)]";
  const dot =
    job.status === "running"   ? "bg-[var(--color-accent)] animate-pulse" :
    job.status === "succeeded" ? "bg-[var(--color-accent)]" :
    job.status === "failed"    ? "bg-[var(--color-accent-2)]" :
    "bg-[var(--color-muted)]";
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${tone}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
      {label} · {job.status}
      {job.progressNote && <span className="text-[var(--color-muted)]">· {job.progressNote}</span>}
    </span>
  );
}

export default function LessonDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate, isLoading } = useSWR(`lesson-${id}`, () => api.getLesson(id), { refreshInterval: 5000 });
  const cid = data?.breadcrumbs?.find((c) => c.kind === "course")?.id;
  const { data: treeData } = useSWR(cid ? `course-tree-${cid}` : null, () => api.getCourseTree(cid!));
  const { notify } = useToast();

  async function authorAll(reauthor = false) {
    try {
      const r = await api.authorLesson(id, { all: reauthor });
      if (!r.ok) throw new Error(r.error ?? "failed");
      notify({
        title: r.queued
          ? `Queued ${r.queued} beat${r.queued === 1 ? "" : "s"} for authoring`
          : r.message ?? "Nothing to author",
        variant: "success",
      });
      mutate();
    } catch (e) {
      notify({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function holisticReview() {
    try {
      const r = await api.holisticReviewLesson(id);
      if (!r.ok) throw new Error("failed");
      notify({ title: "Holistic review queued — runs against Claude opus profile", variant: "success" });
      mutate();
    } catch (e) {
      notify({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function publish() {
    try {
      const r = await api.publishLesson(id);
      if (!r.ok) throw new Error("failed to enqueue publish");
      notify({ title: "Publishing queued — building SCORM 2004 zip", variant: "success" });
      mutate();
    } catch (e) {
      notify({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function restitch() {
    try {
      const r = await api.stitchLesson(id);
      if (!r.ok) throw new Error("failed to enqueue stitch");
      notify({ title: "Stitch queued — concatenating beats into master mp4", variant: "success" });
      mutate();
    } catch (e) {
      notify({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function renderAll(rerender = false) {
    try {
      const r = await api.renderLesson(id, { all: rerender });
      if (!r.ok) throw new Error(r.error ?? "failed");
      notify({
        title: r.queued
          ? `Queued ${r.queued} beat${r.queued === 1 ? "" : "s"} for render`
          : r.message ?? "Nothing to render",
        variant: "success",
      });
      mutate();
    } catch (e) {
      notify({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  if (error) {
    return (
      <AppShell>
        <PageHeader title="Lesson" />
        <PageBody><ErrorState error={error} onRetry={() => mutate()} /></PageBody>
      </AppShell>
    );
  }
  if (isLoading || !data) {
    return (
      <AppShell>
        <PageHeader title="Loading…" />
        <PageBody><Skeleton className="w-full h-96" /></PageBody>
      </AppShell>
    );
  }

  const { lesson, beats } = data;
  const masterUrl = lesson.masterMp4Key ? `/api/files/${encodeURIComponent(lesson.masterMp4Key)}` : null;
  const scormUrl  = lesson.scormPackageKey ? `/api/files/${encodeURIComponent(lesson.scormPackageKey)}` : null;
  const mainBeats = beats.filter((b) => !b.isAlt);
  const altBeats  = beats.filter((b) =>  b.isAlt);

  const ingestedCount = mainBeats.filter((b) => b.stage === "ingested" || b.stage === "queued").length;
  const authoredCount = mainBeats.filter((b) =>
    b.stage === "ai_review" || b.stage === "human_review" || b.stage === "approved" ||
    b.stage === "rendering" || b.stage === "stitched" || b.stage === "published"
  ).length;
  const inFlightCount = mainBeats.filter((b) => b.stage === "authoring" || b.stage === "revising").length;
  // Render-stage counts
  const renderableCount = mainBeats.filter((b) =>
    (b.stage === "ai_review" || b.stage === "human_review" || b.stage === "approved") && !b.mp4Key
  ).length;
  const renderedCount   = mainBeats.filter((b) => !!b.mp4Key).length;
  const renderingNow    = mainBeats.filter((b) => b.stage === "rendering").length;

  const courseId = data.breadcrumbs?.find((c) => c.kind === "course")?.id ?? undefined;
  const courseLessons = (treeData?.tree.sections ?? [])
    .flatMap((s) => s.modules.flatMap((m) => m.lessons));
  const lIdx = courseLessons.findIndex((l) => l.id === id);
  const prevLesson = lIdx > 0 ? courseLessons[lIdx - 1] : null;
  const nextLesson = lIdx >= 0 && lIdx < courseLessons.length - 1 ? courseLessons[lIdx + 1] : null;

  return (
    <AppShell courseId={courseId}>
      <PageHeader
        title={lesson.title}
        description={lesson.summary ?? undefined}
        breadcrumbs={
          <ContextStrip
            prevHref={prevLesson ? `/lessons/${prevLesson.id}` : null}
            nextHref={nextLesson ? `/lessons/${nextLesson.id}` : null}
            position={lIdx >= 0 ? `${lIdx + 1} / ${courseLessons.length}` : undefined}
          >
            <Chip label="beats" value={mainBeats.length} />
            {data.aiCostUsd > 0 && <Chip label="spend" value={`$${data.aiCostUsd.toFixed(2)}`} />}
            {lesson.publishedAt
              ? <Chip value={`published ${new Date(lesson.publishedAt).toLocaleDateString()}`} tone="accent" />
              : <Chip value="unpublished" tone="warn" />}
          </ContextStrip>
        }
        actions={
          <div className="flex gap-2 flex-wrap">
            {ingestedCount > 0 && (
              <Button onClick={() => authorAll(false)}>
                <Wand2 className="w-4 h-4" />Author {ingestedCount} beat{ingestedCount === 1 ? "" : "s"}
              </Button>
            )}
            {authoredCount > 0 && (
              <Button variant="secondary" onClick={holisticReview}>
                <Glasses className="w-4 h-4" />Holistic review
              </Button>
            )}
            {renderableCount > 0 && (
              <Button onClick={() => renderAll(false)}>
                <Film className="w-4 h-4" />Render {renderableCount} beat{renderableCount === 1 ? "" : "s"}
              </Button>
            )}
            {renderedCount > 0 && (
              <Button variant="secondary" onClick={() => renderAll(true)}>
                <Film className="w-4 h-4" />Re-render all
              </Button>
            )}
            <Button variant="secondary" onClick={restitch}>
              Re-stitch
            </Button>
            <Button onClick={publish} disabled={data.scormJob?.status === "running"}>
              <Play className="w-4 h-4" />
              {data.scormJob?.status === "running" ? "Publishing…" : "Publish"}
            </Button>
          </div>
        }
      />
      <PageBody>
        <div className="space-y-6">
          {/* Authoring progress strip */}
          {mainBeats.length > 0 && (
            <Card className="p-4 space-y-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium w-20">Authoring</span>
                <span className="text-[var(--color-muted)]">{ingestedCount} ingested</span>
                {inFlightCount > 0 && <span className="text-[var(--color-accent)]">{inFlightCount} in progress</span>}
                <span className="text-[var(--color-accent)]">{authoredCount} authored</span>
                <div className="flex-1 h-2 bg-[var(--color-bg)] rounded overflow-hidden ml-auto max-w-md">
                  <div className="h-full bg-[var(--color-accent)] transition-all"
                       style={{ width: `${(authoredCount / mainBeats.length) * 100}%` }} />
                </div>
                <span className="text-xs text-[var(--color-muted)] tabular-nums w-12 text-right">
                  {authoredCount}/{mainBeats.length}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="font-medium w-20">Rendering</span>
                <span className="text-[var(--color-muted)]">{renderableCount} ready</span>
                {renderingNow > 0 && <span className="text-[var(--color-accent)]">{renderingNow} in progress</span>}
                <span className="text-[var(--color-accent)]">{renderedCount} rendered</span>
                <div className="flex-1 h-2 bg-[var(--color-bg)] rounded overflow-hidden ml-auto max-w-md">
                  <div className="h-full bg-[var(--color-accent)] transition-all"
                       style={{ width: `${(renderedCount / mainBeats.length) * 100}%` }} />
                </div>
                <span className="text-xs text-[var(--color-muted)] tabular-nums w-12 text-right">
                  {renderedCount}/{mainBeats.length}
                </span>
              </div>
              {(data.stitchJob || data.scormJob) && (
                <div className="flex items-center gap-4 text-sm pt-1 border-t border-[var(--color-border)]">
                  <span className="font-medium w-20">Publishing</span>
                  <JobPill label="Stitch"  job={data.stitchJob} />
                  <JobPill label="SCORM"   job={data.scormJob} />
                  {data.aiCostUsd > 0 && (
                    <span className="text-xs text-[var(--color-muted)] ml-auto tabular-nums">AI spend ${data.aiCostUsd.toFixed(2)}</span>
                  )}
                  {lesson.publishedAt && (
                    <span className="text-xs text-[var(--color-muted)]">
                      Published {new Date(lesson.publishedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </Card>
          )}

          {(lesson.holisticScore !== null || (lesson.holisticIssues && lesson.holisticIssues.length > 0)) && (
            <Card className="p-6">
              <h3 className="font-semibold mb-3">Holistic review</h3>
              <ReviewIssues issues={lesson.holisticIssues} score={lesson.holisticScore} />
              {lesson.holisticReviewedAt && (
                <p className="text-xs text-[var(--color-muted)] mt-3">
                  Reviewed {new Date(lesson.holisticReviewedAt).toLocaleString()}
                </p>
              )}
            </Card>
          )}

          {masterUrl && (
            <Card className="p-6">
              <div className="flex items-start justify-between mb-3 gap-4">
                <h3 className="font-semibold">Master</h3>
                <div className="flex gap-3">
                  <a
                    href={masterUrl}
                    download={`${lesson.title.replace(/[^a-zA-Z0-9._-]/g, "_")}.mp4`}
                    className="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:underline"
                  >
                    <Download className="w-3.5 h-3.5" /> Download MP4
                  </a>
                  {lesson.publishedAt && (<>
                    <a href={`/api/files/lessons/${lesson.id}/preview/index.html`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:underline"><Play className="w-3.5 h-3.5" /> Interactive preview</a>
                    <a href={`/api/files/${encodeURIComponent(`lessons/${lesson.id}/content.pdf`)}`} download className="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:underline"><Download className="w-3.5 h-3.5" /> Companion PDF</a>
                    <a href={`/api/files/${encodeURIComponent(`lessons/${lesson.id}/summary.pdf`)}`} download className="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:underline"><Download className="w-3.5 h-3.5" /> Answer key PDF</a>
                  </>)}
                  {scormUrl && (
                    <a
                      href={scormUrl}
                      download={`${lesson.title.replace(/[^a-zA-Z0-9._-]/g, "_")}.zip`}
                      className="inline-flex items-center gap-1.5 text-sm text-[var(--color-accent)] hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" /> Download SCORM
                    </a>
                  )}
                </div>
              </div>
              <VideoPlayer src={masterUrl} controls />
            </Card>
          )}

          <Card className="p-6">
            <h3 className="font-semibold mb-3">Beats ({mainBeats.length})</h3>
            <div className="-mx-1">
              {mainBeats.map((b) => <BeatRow key={b.id} beat={b} onAction={() => mutate()} />)}
            </div>
          </Card>

          {altBeats.length > 0 && (
            <Card className="p-6">
              <h3 className="font-semibold mb-3">Alt beats — scenario branches ({altBeats.length})</h3>
              <div className="-mx-1">
                {altBeats.map((b) => <BeatRow key={b.id} beat={b} />)}
              </div>
            </Card>
          )}
        </div>
      </PageBody>
    </AppShell>
  );
}
