"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { AlertCircle, CheckCircle2, Clock, Loader2, RefreshCw } from "lucide-react";

import { api, type ActivityJob } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/error-state";
import { useToast } from "@/lib/use-toast";
import { useLiveJobs } from "@/lib/use-live-jobs";

const QUEUES = ["all", "ingest", "author", "ai_review", "holistic", "render", "stitch", "scorm_build"] as const;

/** How a failed job of each queue gets retried (re-enqueued via existing routes). */
async function retryJob(job: ActivityJob): Promise<string> {
  switch (job.queue) {
    case "render":      if (job.beatId)   { await api.renderBeat(job.beatId);        return "render re-queued"; } break;
    case "author":      if (job.beatId)   { await api.authorBeat(job.beatId);        return "author re-queued"; } break;
    case "ai_review":   if (job.beatId)   { await api.reviewBeat(job.beatId);        return "review re-queued"; } break;
    case "stitch":      if (job.lessonId) { await api.stitchLesson(job.lessonId);    return "stitch re-queued"; } break;
    case "scorm_build": if (job.lessonId) { await api.publishLesson(job.lessonId);   return "publish re-queued"; } break;
    case "holistic":    if (job.lessonId) { await api.holisticReviewLesson(job.lessonId); return "holistic review re-queued"; } break;
    case "ingest":      if (job.materialId) { await api.triggerIngest(job.materialId); return "ingest re-queued"; } break;
  }
  throw new Error(`Can't retry a ${job.queue} job with no target`);
}

function elapsed(job: ActivityJob): string {
  if (!job.startedAt) return "";
  const end = job.endedAt ? new Date(job.endedAt).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - new Date(job.startedAt).getTime()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function targetLink(job: ActivityJob): { href: string; label: string } | null {
  if (job.beatId)     return { href: `/beats/${job.beatId}`,       label: `beat ${job.beatId.slice(0, 8)}` };
  if (job.lessonId)   return { href: `/lessons/${job.lessonId}`,   label: `lesson ${job.lessonId.slice(0, 8)}` };
  if (job.materialId) return { href: `/materials/${job.materialId}`, label: `material ${job.materialId.slice(0, 8)}` };
  return null;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "running")   return <Loader2 className="w-4 h-4 text-[var(--color-accent)] animate-spin shrink-0" />;
  if (status === "succeeded") return <CheckCircle2 className="w-4 h-4 text-[var(--color-accent)] shrink-0" />;
  if (status === "failed")    return <AlertCircle className="w-4 h-4 text-[var(--color-accent-2)] shrink-0" />;
  return <Clock className="w-4 h-4 text-[var(--color-muted)] shrink-0" />;
}

function JobRow({ job, onRetry }: { job: ActivityJob; onRetry?: (job: ActivityJob) => void }) {
  const link = targetLink(job);
  return (
    <li className="py-3 flex items-start gap-3">
      <StatusIcon status={job.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="muted">{job.queue}</Badge>
          {link && (
            <Link href={link.href} className="font-mono text-xs text-[var(--color-accent)] hover:underline">
              {link.label}
            </Link>
          )}
          <span className="text-xs text-[var(--color-muted)]">
            {new Date(job.createdAt).toLocaleTimeString()} · {elapsed(job)}
          </span>
        </div>
        {job.progressNote && (
          <p className="text-sm mt-1 truncate" title={job.progressNote}>{job.progressNote}</p>
        )}
        {job.errorMessage && (
          <p className="text-xs text-[var(--color-accent-2)] mt-1 break-words">{job.errorMessage.slice(0, 300)}</p>
        )}
      </div>
      {job.status === "failed" && onRetry && (
        <Button size="sm" variant="secondary" onClick={() => onRetry(job)}>
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </Button>
      )}
    </li>
  );
}

export default function ActivityPage() {
  const [queueFilter, setQueueFilter] = useState<(typeof QUEUES)[number]>("all");
  const { notify } = useToast();

  const { data, error, mutate, isLoading } = useSWR(
    `activity-${queueFilter}`,
    () => api.listJobs(queueFilter === "all" ? undefined : { queue: queueFilter }),
    // Poll fast while anything runs; otherwise a lazy background refresh.
    { refreshInterval: (latest) =>
        latest?.jobs.some((j) => j.status === "running" || j.status === "queued") ? 2500 : 15000 },
  );

  useLiveJobs(() => mutate());

  async function handleRetry(job: ActivityJob) {
    try {
      const msg = await retryJob(job);
      notify({ title: msg, variant: "success" });
      mutate();
    } catch (e) {
      notify({ title: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  const jobs = data?.jobs ?? [];
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued");
  const failed  = jobs.filter((j) => j.status === "failed");
  const done    = jobs.filter((j) => j.status === "succeeded");

  return (
    <AppShell>
      <PageHeader
        title="Activity"
        description="Every pipeline job — live progress, failures with one-click retry."
        actions={
          <div className="flex gap-1 flex-wrap">
            {QUEUES.map((q) => (
              <Button
                key={q}
                size="sm"
                variant={queueFilter === q ? "primary" : "secondary"}
                onClick={() => setQueueFilter(q)}
              >
                {q === "all" ? "All" : q.replace("_", " ")}
              </Button>
            ))}
          </div>
        }
      />
      <PageBody>
        {error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <Skeleton className="w-full h-64" />
        ) : (
          <div className="space-y-6">
            {failed.length > 0 && (
              <Card className="p-6 border-[var(--color-accent-2)]">
                <h3 className="font-semibold mb-2 text-[var(--color-accent-2)]">
                  Failed ({failed.length})
                </h3>
                <ul className="divide-y divide-[var(--color-border)]">
                  {failed.map((j) => <JobRow key={j.id} job={j} onRetry={handleRetry} />)}
                </ul>
              </Card>
            )}

            {running.length > 0 && (
              <Card className="p-6">
                <h3 className="font-semibold mb-2">In progress ({running.length})</h3>
                <ul className="divide-y divide-[var(--color-border)]">
                  {running.map((j) => <JobRow key={j.id} job={j} />)}
                </ul>
              </Card>
            )}

            <Card className="p-6">
              <h3 className="font-semibold mb-2">Recent ({done.length})</h3>
              {done.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)] py-4">No completed jobs yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {done.map((j) => <JobRow key={j.id} job={j} />)}
                </ul>
              )}
            </Card>
          </div>
        )}
      </PageBody>
    </AppShell>
  );
}
