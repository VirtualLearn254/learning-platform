"use client";

import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Play, Square } from "lucide-react";

import { api, type JobSummary } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/upload-dropzone";
import { CourseTree } from "@/components/course-tree";
import { Skeleton } from "@/components/ui/skeleton";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { useToast } from "@/lib/use-toast";

function JobStatusBadge({ job, ingestedAt }: { job: JobSummary | null; ingestedAt: string | null }) {
  if (job?.status === "running")    return <Badge variant="accent">running</Badge>;
  if (job?.status === "succeeded" || ingestedAt) return <Badge variant="default">✓ ingested</Badge>;
  if (job?.status === "failed")     return <Badge variant="accent2">failed</Badge>;
  if (job?.status === "queued")     return <Badge variant="muted">queued</Badge>;
  return <Badge variant="muted">pending</Badge>;
}

function elapsed(startedAt: string | null): string {
  if (!startedAt) return "";
  const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return ` · ${s}s elapsed`;
}

function duration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return "";
  const s = Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  return ` · took ${s}s`;
}

export default function CourseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: materialsData, mutate: refreshMaterials } = useSWR(
    `materials-${id}`,
    () => api.listMaterials(id),
    // Poll fast (2s) while anything is queued/running; slower (10s) for "still pending" stragglers; off when all done.
    {
      refreshInterval: (latest) => {
        if (!latest) return 2000;
        const anyActive = latest.materials.some((m) => m.latestJob?.status === "queued" || m.latestJob?.status === "running");
        if (anyActive) return 2000;
        const anyUnprocessed = latest.materials.some((m) => !m.ingestedAt);
        return anyUnprocessed ? 10000 : 0;
      },
    },
  );
  const { data: treeData, error: treeError, mutate: refreshTree } = useSWR(
    `course-tree-${id}`,
    () => api.getCourseTree(id),
    // Poll the tree while autopilot runs so lesson lanes tick live.
    { refreshInterval: (latest) => latest?.tree.sections.length ? 5000 : (materialsData?.materials.length ? 4000 : 0) },
  );
  const { data: courseData, mutate: refreshCourse } = useSWR(
    `course-${id}`,
    () => api.getCourse(id),
    { refreshInterval: 10000 },
  );
  const { notify } = useToast();
  const autopilot = courseData?.course.autopilot ?? false;

  async function runCourse() {
    try {
      const r = await api.runCourse(id);
      notify({
        title: `Conductor on — ${r.authorQueued} to author, ${r.renderQueued} to render (of ${r.totalBeats} beats). Everything chains automatically.`,
        variant: "success",
      });
      refreshCourse(); refreshTree();
    } catch (e) {
      notify({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function stopCourse() {
    try {
      await api.stopCourse(id);
      notify({ title: "Autopilot off — in-flight jobs finish, nothing new auto-chains.", variant: "success" });
      refreshCourse();
    } catch (e) {
      notify({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  async function handleUpload(files: File[]) {
    for (const file of files) {
      await api.uploadMaterial({ courseId: id, file, triggerIngest: true });
    }
    await Promise.all([refreshMaterials(), refreshTree()]);
  }

  if (treeError) {
    return (
      <AppShell>
        <PageHeader title="Course" />
        <PageBody><ErrorState error={treeError} onRetry={() => refreshTree()} /></PageBody>
      </AppShell>
    );
  }
  if (!treeData) {
    return (
      <AppShell>
        <PageHeader title="Loading…" />
        <PageBody>
          <Skeleton className="w-full h-64" />
        </PageBody>
      </AppShell>
    );
  }

  const tree = treeData.tree;
  const materials = materialsData?.materials ?? [];

  // Per-lesson pipeline roll-up for the conductor lanes.
  const lessonLanes = tree.sections.flatMap((s) =>
    s.modules.flatMap((m) =>
      m.lessons.map((l) => {
        const main = l.beats.filter((b) => !b.isAlt);
        const rendered = main.filter((b) => !!b.mp4Key).length;
        const done = main.filter((b) => b.stage === "stitched" || b.stage === "published").length;
        const failed = main.filter((b) => b.status === "failed").length;
        return { id: l.id, title: l.title, total: main.length, rendered, done, failed };
      }),
    ),
  );
  const anyBeats = lessonLanes.some((l) => l.total > 0);

  return (
    <AppShell courseId={tree.id}>
      <PageHeader
        title={tree.title}
        description={tree.summary ?? undefined}
        breadcrumbs={<Breadcrumbs items={[
          { kind: "courses-root", id: null, title: "Courses" },
          { kind: "course", id: tree.id, title: tree.title },
        ]} />}
        actions={
          anyBeats ? (
            autopilot ? (
              <Button variant="secondary" onClick={stopCourse}>
                <Square className="w-4 h-4" /> Stop autopilot
              </Button>
            ) : (
              <Button onClick={runCourse}>
                <Play className="w-4 h-4" /> Run course
              </Button>
            )
          ) : undefined
        }
      />
      <PageBody>
        {/* Conductor lanes: one row per lesson, live while autopilot runs */}
        {anyBeats && (
          <Card className="p-5 mb-6 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-sm">Pipeline</h3>
              {autopilot && (
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-accent)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                  autopilot — review pass → render → stitch → publish, no gates
                </span>
              )}
            </div>
            {lessonLanes.map((l) => (
              <div key={l.id} className="flex items-center gap-3 text-sm">
                <Link href={`/lessons/${l.id}`} className="w-56 truncate hover:text-[var(--color-accent)] transition-colors shrink-0">
                  {l.title}
                </Link>
                <div className="flex-1 h-2 bg-[var(--color-bg)] rounded overflow-hidden">
                  <div className="h-full bg-[var(--color-accent)] transition-all"
                       style={{ width: l.total ? `${(l.rendered / l.total) * 100}%` : "0%" }} />
                </div>
                <span className="text-xs text-[var(--color-muted)] tabular-nums w-16 text-right shrink-0">
                  {l.rendered}/{l.total}
                </span>
                {l.failed > 0 && (
                  <span className="text-xs text-[var(--color-accent-2)] shrink-0">{l.failed} failed</span>
                )}
                {l.done === l.total && l.total > 0 && (
                  <span className="text-xs text-[var(--color-accent)] shrink-0">✓</span>
                )}
              </div>
            ))}
          </Card>
        )}

        <Tabs defaultValue="tree">
          <TabsList>
            <TabsTrigger value="tree">Course tree</TabsTrigger>
            <TabsTrigger value="upload">Upload material</TabsTrigger>
            <TabsTrigger value="materials">Materials ({materials.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="tree">
            <Card className="p-6">
              <CourseTree tree={tree} />
            </Card>
          </TabsContent>
          <TabsContent value="upload">
            <Card className="p-6">
              <UploadDropzone onFiles={handleUpload} />
              <p className="text-xs text-[var(--color-muted)] mt-4">
                Material runs through ingest → modules/lessons/beats are drafted automatically.
              </p>
            </Card>
          </TabsContent>
          <TabsContent value="materials">
            <Card className="p-6">
              {materials.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No materials uploaded yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {materials.map((m) => {
                    const job = m.latestJob;
                    const canRetry = !job || job.status === "failed" || (job.status !== "running" && job.status !== "queued" && !m.ingestedAt);
                    return (
                      <li key={m.id} className="py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{m.filename}</p>
                            <p className="text-xs text-[var(--color-muted)] mt-0.5">
                              {(m.sizeBytes / 1024).toFixed(1)} KB · {m.mimeType}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <JobStatusBadge job={job} ingestedAt={m.ingestedAt} />
                            {canRetry && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={async () => {
                                  await api.triggerIngest(m.id);
                                  await refreshMaterials();
                                }}
                              >
                                {job?.status === "failed" ? "Retry ingest" : "Run ingest"}
                              </Button>
                            )}
                          </div>
                        </div>
                        {job?.status === "running" && job.progressNote && (
                          <p className="text-xs text-[var(--color-accent)] mt-2 font-mono">
                            ▸ {job.progressNote}{elapsed(job.startedAt)}
                          </p>
                        )}
                        {job?.status === "succeeded" && job.progressNote && (
                          <p className="text-xs text-[var(--color-muted)] mt-2">
                            ✓ {job.progressNote}{duration(job.startedAt, job.endedAt)}
                          </p>
                        )}
                        {job?.status === "failed" && job.errorMessage && (
                          <p className="text-xs text-[var(--color-accent-2)] mt-2 break-words">
                            ✗ {job.errorMessage}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </AppShell>
  );
}
