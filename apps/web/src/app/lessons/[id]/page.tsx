"use client";

import { use } from "react";
import useSWR from "swr";
import { Play, Download } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VideoPlayer } from "@/components/video-player";
import { BeatCard } from "@/components/beat-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LessonDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, mutate, isLoading } = useSWR(`lesson-${id}`, () => api.getLesson(id), { refreshInterval: 5000 });

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

  return (
    <AppShell>
      <PageHeader
        title={lesson.title}
        description={lesson.summary ?? undefined}
        actions={
          <div className="flex gap-2">
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
