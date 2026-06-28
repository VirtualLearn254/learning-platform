"use client";

import { use } from "react";
import useSWR from "swr";

import { api, type JobSummary } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/upload-dropzone";
import { CourseTree } from "@/components/course-tree";
import { Skeleton } from "@/components/ui/skeleton";

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
  const { data: treeData, mutate: refreshTree } = useSWR(
    `course-tree-${id}`,
    () => api.getCourseTree(id),
    { refreshInterval: (latest) => latest?.tree.sections.length ? 0 : (materialsData?.materials.length ? 4000 : 0) },
  );

  async function handleUpload(files: File[]) {
    for (const file of files) {
      await api.uploadMaterial({ courseId: id, file, triggerIngest: true });
    }
    await Promise.all([refreshMaterials(), refreshTree()]);
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

  return (
    <AppShell>
      <PageHeader title={tree.title} description={tree.summary ?? undefined} />
      <PageBody>
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
