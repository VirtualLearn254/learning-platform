"use client";

import { use } from "react";
import useSWR from "swr";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

export default function CourseAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: courseId } = use(params);
  const { data: course } = useSWR(`course-${courseId}`, () => api.getCourse(courseId));
  const { data: summary } = useSWR(`course-summary-${courseId}`, () => api.analyticsSummary({ courseId }));
  const { data: replays } = useSWR(`course-replays-${courseId}`, () => api.analyticsReplays(courseId));
  const { data: quizzes } = useSWR(`course-quiz-${courseId}`, () => api.analyticsQuizDifficulty(courseId));

  return (
    <AppShell>
      <PageHeader
        title={course?.course?.title ?? "Course analytics"}
        description="Drill-down per-course performance."
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top-line KPIs */}
          <Card>
            <CardHeader>
              <CardTitle>Events</CardTitle>
              <CardDescription>Total xAPI statements received for this course</CardDescription>
            </CardHeader>
            <CardContent>
              {!summary ? <Skeleton className="h-16" /> : (
                <div className="text-4xl font-semibold tabular-nums">{summary.totalEvents.toLocaleString()}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top replayed</CardTitle>
              <CardDescription>The single most-replayed beat — your top teaching gap</CardDescription>
            </CardHeader>
            <CardContent>
              {!replays ? <Skeleton className="h-16" /> : replays.replays.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No replays yet.</p>
              ) : (
                <>
                  <p className="font-mono text-xs">{replays.replays[0]!.beatId}</p>
                  <p className="text-2xl font-semibold tabular-nums">{replays.replays[0]!.replays}</p>
                  <p className="text-xs text-[var(--color-muted)]">replays</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hardest quiz</CardTitle>
              <CardDescription>Highest wrong-answer rate</CardDescription>
            </CardHeader>
            <CardContent>
              {!quizzes ? <Skeleton className="h-16" /> : (() => {
                const worst = [...quizzes.quizzes].sort((a, b) => b.wrongRate - a.wrongRate)[0];
                if (!worst) return <p className="text-sm text-[var(--color-muted)]">No quiz attempts yet.</p>;
                return (
                  <>
                    <p className="font-mono text-xs">{worst.beatId}</p>
                    <p className="text-2xl font-semibold tabular-nums">{Math.round(worst.wrongRate * 100)}%</p>
                    <p className="text-xs text-[var(--color-muted)]">wrong</p>
                  </>
                );
              })()}
            </CardContent>
          </Card>

          {/* Per-event-type breakdown */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Engagement by event type</CardTitle>
              <CardDescription>What learners actually do — every event recorded by the SCORM player</CardDescription>
            </CardHeader>
            <CardContent>
              {!summary ? <Skeleton className="h-32" /> : (
                <div className="space-y-3">
                  {Object.entries(summary.eventsByType).map(([type, count]) => (
                    <div key={type}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-[var(--color-muted)]">{type}</span>
                        <span className="tabular-nums">{count}</span>
                      </div>
                      <Progress value={summary.totalEvents > 0 ? (count / summary.totalEvents) * 100 : 0} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </AppShell>
  );
}
