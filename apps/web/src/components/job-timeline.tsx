"use client";

import useSWR from "swr";
import { Loader2, CheckCircle2, AlertCircle, Clock } from "lucide-react";

import { Card } from "@/components/ui/card";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Job {
  id: string;
  queue: string;
  status: string;
  attempts: number;
  startedAt: string | null;
  endedAt: string | null;
  etaSeconds: number | null;
  errorMessage: string | null;
  createdAt: string;
}

const statusIcon = {
  queued:    Clock,
  running:   Loader2,
  succeeded: CheckCircle2,
  failed:    AlertCircle,
};

export function JobTimeline({ beatId }: { beatId: string }) {
  const { data } = useSWR<{ jobs: Job[] }>(`/api/jobs?beatId=${beatId}`, fetcher, { refreshInterval: 5000 });
  const jobs = data?.jobs ?? [];

  if (jobs.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-[var(--color-muted)]">No job history yet.</p>
      </Card>
    );
  }

  return (
    <ol className="space-y-2">
      {jobs.map((job) => {
        const Icon = (statusIcon as Record<string, typeof CheckCircle2>)[job.status] ?? Clock;
        const color = job.status === "succeeded" ? "var(--color-accent)"
          : job.status === "failed" ? "var(--color-accent-2)"
          : "var(--color-muted)";
        const elapsedMs = job.endedAt && job.startedAt ? new Date(job.endedAt).getTime() - new Date(job.startedAt).getTime() : null;
        return (
          <li key={job.id} className="flex items-center gap-3 text-sm border-l-2 pl-3" style={{ borderColor: color }}>
            <Icon className={`w-4 h-4 ${job.status === "running" ? "animate-spin" : ""}`} style={{ color }} />
            <div className="flex-1">
              <p className="font-mono text-xs">{job.queue}</p>
              <p className="text-xs text-[var(--color-muted)]">
                {new Date(job.createdAt).toLocaleString()}
                {job.attempts > 1 && ` · attempt ${job.attempts}`}
                {elapsedMs && ` · ${Math.round(elapsedMs / 1000)}s`}
              </p>
              {job.errorMessage && (
                <p className="text-xs text-[var(--color-accent-2)] mt-1">{job.errorMessage}</p>
              )}
            </div>
            <span className="text-xs uppercase tracking-wide" style={{ color }}>{job.status}</span>
          </li>
        );
      })}
    </ol>
  );
}
