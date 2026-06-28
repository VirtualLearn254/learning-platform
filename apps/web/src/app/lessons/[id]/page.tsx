"use client";

import { use } from "react";
import useSWR from "swr";
import { Play, Download, Wand2, Film } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VideoPlayer } from "@/components/video-player";
import { BeatCard } from "@/components/beat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { useToast } from "@/lib/use-toast";

export default function LessonDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, mutate, isLoading } = useSWR(`lesson-${id}`, () => api.getLesson(id), { refreshInterval: 5000 });
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
      notify({ title: e instanceof Error ? e.message : String(e), variant: "error" });
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
      notify({ title: e instanceof Error ? e.message : String(e), variant: "error" });
    }
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

  return (
    <AppShell>
      <PageHeader
        title={lesson.title}
        description={lesson.summary ?? undefined}
        breadcrumbs={data.breadcrumbs && <Breadcrumbs items={data.breadcrumbs} />}
        actions={
          <div className="flex gap-2 flex-wrap">
            {ingestedCount > 0 && (
              <Button onClick={() => authorAll(false)}>
                <Wand2 className="w-4 h-4" />Author {ingestedCount} beat{ingestedCount === 1 ? "" : "s"}
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
            <Button variant="secondary" onClick={() => api.stitchLesson(id).then(() => mutate())}>
              Re-stitch
            </Button>
            <Button onClick={() => api.publishLesson(id).then(() => mutate())}>
              <Play className="w-4 h-4" />Publish
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
            </Card>
          )}

          {masterUrl && (
            <Card className="p-6">
              <h3 className="font-semibold mb-3">Master</h3>
              <VideoPlayer src={masterUrl} controls />
              {scormUrl && (
                <a href={scormUrl} className="mt-4 inline-flex items-center gap-2 text-sm text-[var(--color-accent)] hover:underline">
                  <Download className="w-3.5 h-3.5" /> Download SCORM package
                </a>
              )}
            </Card>
          )}

          <Card className="p-6">
            <h3 className="font-semibold mb-4">Beats ({mainBeats.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {mainBeats.map((b) => <BeatCard key={b.id} beat={b} />)}
            </div>
          </Card>

          {altBeats.length > 0 && (
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Alt beats — scenario branches ({altBeats.length})</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {altBeats.map((b) => <BeatCard key={b.id} beat={b} />)}
              </div>
            </Card>
          )}
        </div>
      </PageBody>
    </AppShell>
  );
}
