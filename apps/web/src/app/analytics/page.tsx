"use client";

import useSWR from "swr";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

export default function AnalyticsPage() {
  const { data: summary } = useSWR("analytics-summary", () => api.analyticsSummary({}));
  const { data: replays } = useSWR("analytics-replays", () => api.analyticsReplays());
  const { data: quizzes } = useSWR("analytics-quiz-difficulty", () => api.analyticsQuizDifficulty());

  return (
    <AppShell>
      <PageHeader
        title="Analytics"
        description="Learner behavior pulled from the xAPI LRS — heatmaps, replay leaderboards, quiz difficulty."
      />
      <PageBody>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Event volume */}
          <Card>
            <CardHeader>
              <CardTitle>Event volume</CardTitle>
              <CardDescription>Total xAPI statements received, by type</CardDescription>
            </CardHeader>
            <CardContent>
              {!summary ? (
                <Skeleton className="h-32" />
              ) : (
                <div className="space-y-3">
                  <div className="text-3xl font-semibold tabular-nums">{summary.totalEvents.toLocaleString()}</div>
                  <p className="text-xs text-[var(--color-muted)] mb-4">total events</p>
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

          {/* Most-replayed beats */}
          <Card>
            <CardHeader>
              <CardTitle>Most-replayed beats</CardTitle>
              <CardDescription>High replays = concept needs clearer teaching</CardDescription>
            </CardHeader>
            <CardContent>
              {!replays ? (
                <Skeleton className="h-32" />
              ) : replays.replays.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No replay data yet.</p>
              ) : (
                <ol className="space-y-2 text-sm">
                  {replays.replays.slice(0, 10).map((r, i) => (
                    <li key={r.beatId} className="flex items-center gap-3">
                      <span className="font-mono text-xs text-[var(--color-muted)] w-6 text-right">{i + 1}</span>
                      <span className="font-mono text-xs flex-1 truncate">{r.beatId}</span>
                      <span className="tabular-nums">{r.replays}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Quiz difficulty */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Quiz difficulty</CardTitle>
              <CardDescription>Wrong-answer rate per quiz — sort signals where teaching is failing</CardDescription>
            </CardHeader>
            <CardContent>
              {!quizzes ? (
                <Skeleton className="h-32" />
              ) : quizzes.quizzes.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No quiz attempts yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[var(--color-muted)] text-xs uppercase tracking-wide">
                      <th className="py-2">Beat</th>
                      <th className="py-2">Total</th>
                      <th className="py-2">Wrong</th>
                      <th className="py-2 w-1/3">Wrong rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quizzes.quizzes.map((q) => (
                      <tr key={q.beatId} className="border-t border-[var(--color-border)]">
                        <td className="py-2 font-mono text-xs">{q.beatId}</td>
                        <td className="py-2 tabular-nums">{q.total}</td>
                        <td className="py-2 tabular-nums">{q.wrong}</td>
                        <td className="py-2"><Progress value={q.wrongRate * 100} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </AppShell>
  );
}
