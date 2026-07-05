"use client";

import Link from "next/link";
import useSWR from "swr";
import { BookOpen, KanbanSquare, Sparkles, AlertCircle, Loader2, Activity } from "lucide-react";

import { api, type ActivityJob } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/error-state";
import { useLiveJobs } from "@/lib/use-live-jobs";

const PROVIDER_LABELS: Array<{ key: string; label: string }> = [
  { key: "anthropic", label: "anthropic" },
  { key: "openai",    label: "openai" },
  { key: "deepseek",  label: "deepseek" },
  { key: "fireworks", label: "fireworks" },
  { key: "vllm",      label: "vllm" },
];

export default function Dashboard() {
  const { data: health } = useSWR("health", () => api.health(), { refreshInterval: 10000 });
  const { data: coursesData, error: coursesError, mutate: retryCourses } = useSWR("courses", () => api.listCourses());
  const { data: beatsData } = useSWR("beats", () => api.listBeats(), { refreshInterval: 5000 });
  const { data: jobsData, mutate: refreshJobs } = useSWR("dash-jobs", () => api.listJobs(), { refreshInterval: 5000 });
  useLiveJobs(() => refreshJobs());

  const courses = coursesData?.courses ?? [];
  const beats = beatsData?.beats ?? [];
  const jobs = jobsData?.jobs ?? [];

  const needsReviewCount = beats.filter((b) => b.stage === "human_review").length;
  const inFlightCount = beats.filter((b) => ["authoring", "ai_review", "rendering", "revising", "stitched"].includes(b.stage)).length;
  const publishedCount = beats.filter((b) => b.stage === "published").length;

  // Last-24h failures + currently running, straight from the job feed.
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recentFailed = jobs.filter((j) => j.status === "failed" && new Date(j.createdAt).getTime() > dayAgo);
  const running = jobs.filter((j) => j.status === "running" || j.status === "queued");

  return (
    <AppShell>
      <PageHeader title="Dashboard" description="Where you are right now in the pipeline." />
      <PageBody>
        {/* Health + provider status — reads the encrypted secrets store, not env */}
        <Card className="mb-6">
          <CardContent className="p-6 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm text-[var(--color-muted)] mb-1">System</p>
              <p className="font-semibold">
                {health ? (health.ok ? "Healthy" : "Degraded") : "Checking…"}
                {health && (
                  <span className="ml-3 text-xs text-[var(--color-muted)]">
                    db {health.db ? "✓" : "✗"}
                    {PROVIDER_LABELS.map(({ key, label }) => (
                      <span key={key}> · {label} {(health.providers as Record<string, boolean>)[key] ? "✓" : "—"}</span>
                    ))}
                  </span>
                )}
              </p>
            </div>
            <Badge variant={health?.ok ? "accent" : "accent2"}>{health?.ok ? "Online" : health ? "Offline" : "…"}</Badge>
          </CardContent>
        </Card>

        {/* Failures — pinned above everything when present */}
        {recentFailed.length > 0 && (
          <Card className="mb-6 border-[var(--color-accent-2)]">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold text-[var(--color-accent-2)] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {recentFailed.length} failure{recentFailed.length === 1 ? "" : "s"} in the last 24h
                </p>
                <Link href="/activity" className="text-sm text-[var(--color-accent)] hover:underline">
                  Open Activity →
                </Link>
              </div>
              <ul className="text-sm space-y-1">
                {recentFailed.slice(0, 3).map((j: ActivityJob) => (
                  <li key={j.id} className="truncate text-[var(--color-muted)]">
                    <span className="font-mono text-xs">{j.queue}</span> · {j.errorMessage?.slice(0, 120) ?? "failed"}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Running strip */}
        {running.length > 0 && (
          <Card className="mb-6">
            <CardContent className="p-4 flex items-center gap-3 flex-wrap">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--color-accent)] shrink-0" />
              <span className="text-sm font-medium">{running.length} job{running.length === 1 ? "" : "s"} in progress</span>
              <span className="text-xs text-[var(--color-muted)] truncate flex-1">
                {running.slice(0, 2).map((j) => `${j.queue}: ${j.progressNote ?? "…"}`).join("  ·  ")}
              </span>
              <Link href="/activity" className="text-sm text-[var(--color-accent)] hover:underline shrink-0">watch →</Link>
            </CardContent>
          </Card>
        )}

        {/* Top KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Kpi label="Courses" value={courses.length} icon={BookOpen} href="/courses" />
          <Kpi label="Needs your review" value={needsReviewCount} icon={KanbanSquare} href="/kanban" highlight={needsReviewCount > 0} />
          <Kpi label="In flight" value={inFlightCount} icon={Activity} href="/activity" />
          <Kpi label="Published" value={publishedCount} icon={Sparkles} href="/kanban" />
        </div>

        {/* Recent courses */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent courses</CardTitle>
            </CardHeader>
            <CardContent>
              {coursesError ? (
                <ErrorState error={coursesError} onRetry={() => retryCourses()} title="Couldn't load courses" />
              ) : courses.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No courses yet. <Link href="/courses" className="text-[var(--color-accent)] hover:underline">Create one</Link>.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {courses.slice(0, 5).map((c) => (
                    <li key={c.id} className="py-3">
                      <Link href={`/courses/${c.id}`} className="font-medium hover:text-[var(--color-accent)] transition-colors">
                        {c.title}
                      </Link>
                      <p className="text-xs text-[var(--color-muted)] mt-1">updated {new Date(c.updatedAt).toLocaleString()}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick links</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                <li><Link href="/activity" className="text-[var(--color-accent)] hover:underline">Live activity feed</Link></li>
                <li><Link href="/courses" className="text-[var(--color-accent)] hover:underline">Browse courses</Link></li>
                <li><Link href="/kanban" className="text-[var(--color-accent)] hover:underline">Open the Kanban</Link></li>
                <li><Link href="/analytics" className="text-[var(--color-accent)] hover:underline">Analytics dashboards</Link></li>
                <li><Link href="/settings" className="text-[var(--color-accent)] hover:underline">AI providers &amp; roles</Link></li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </AppShell>
  );
}

function Kpi({ label, value, icon: Icon, href, highlight }: { label: string; value: number; icon: typeof BookOpen; href: string; highlight?: boolean }) {
  return (
    <Link href={href}>
      <Card className={`p-5 hover:border-[var(--color-ink)] transition-colors cursor-pointer ${highlight ? "border-[var(--color-accent-2)]" : ""}`}>
        <Icon className="w-4 h-4 text-[var(--color-muted)] mb-3" />
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-[var(--color-muted)] mt-1">{label}</p>
      </Card>
    </Link>
  );
}
