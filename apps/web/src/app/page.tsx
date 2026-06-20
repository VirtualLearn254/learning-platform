"use client";

import Link from "next/link";
import useSWR from "swr";
import { BookOpen, KanbanSquare, BarChart3, Sparkles } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: health } = useSWR("health", () => api.health(), { refreshInterval: 5000 });
  const { data: coursesData } = useSWR("courses", () => api.listCourses());
  const { data: beatsData } = useSWR("beats", () => api.listBeats(), { refreshInterval: 5000 });

  const courses = coursesData?.courses ?? [];
  const beats = beatsData?.beats ?? [];
  const needsReviewCount = beats.filter((b) => b.stage === "human_review").length;
  const inFlightCount = beats.filter((b) => ["authoring", "ai_review", "rendering", "revising", "stitched"].includes(b.stage)).length;
  const publishedCount = beats.filter((b) => b.stage === "published").length;

  return (
    <AppShell>
      <PageHeader title="Dashboard" description="Where you are right now in the pipeline." />
      <PageBody>
        {/* Health + provider status */}
        <Card className="mb-6">
          <CardContent className="p-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--color-muted)] mb-1">System</p>
              <p className="font-semibold">
                {health?.ok ? "Healthy" : "Degraded"}
                {health && (
                  <span className="ml-3 text-xs text-[var(--color-muted)]">
                    db {health.db ? "✓" : "✗"} · vllm {health.providers.vllm ? "✓" : "—"} · openai {health.providers.openai ? "✓" : "—"} · deepseek {health.providers.deepseek ? "✓" : "—"}
                  </span>
                )}
              </p>
            </div>
            <Badge variant={health?.ok ? "accent" : "accent2"}>{health?.ok ? "Online" : "Offline"}</Badge>
          </CardContent>
        </Card>

        {/* Top KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Kpi label="Courses" value={courses.length} icon={BookOpen} href="/courses" />
          <Kpi label="Needs your review" value={needsReviewCount} icon={KanbanSquare} href="/kanban" highlight={needsReviewCount > 0} />
          <Kpi label="In flight" value={inFlightCount} icon={KanbanSquare} href="/kanban" />
          <Kpi label="Published" value={publishedCount} icon={Sparkles} href="/kanban" />
        </div>

        {/* Recent courses */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent courses</CardTitle>
            </CardHeader>
            <CardContent>
              {courses.length === 0 ? (
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
                <li><Link href="/courses" className="text-[var(--color-accent)] hover:underline">Browse courses</Link></li>
                <li><Link href="/kanban" className="text-[var(--color-accent)] hover:underline">Open the Kanban</Link></li>
                <li><Link href="/analytics" className="text-[var(--color-accent)] hover:underline">Analytics dashboards</Link></li>
                <li><Link href="/hermes" className="text-[var(--color-accent)] hover:underline">Hermes evolution loop</Link></li>
                <li><Link href="/settings" className="text-[var(--color-accent)] hover:underline">Notification preferences</Link></li>
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
