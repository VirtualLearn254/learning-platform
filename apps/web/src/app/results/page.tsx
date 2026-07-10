"use client";

import { useState } from "react";
import useSWR from "swr";
import { ClipboardCheck, Users, Target, TrendingUp } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/**
 * Results — the standalone attempts store (LP-16). Every play-through of a
 * published lesson (LMS or preview link) reports here: teacher-facing roster
 * per lesson + item analysis of which questions get missed.
 */
export default function ResultsPage() {
  const { data: lessonsData } = useSWR("attempt-lessons", () => api.attemptLessons(), { refreshInterval: 30000 });
  const [selected, setSelected] = useState<string | null>(null);

  const lessons = lessonsData?.lessons ?? [];
  const active = selected ?? lessons[0]?.lessonId ?? null;

  return (
    <AppShell>
      <PageHeader
        title="Results"
        description="Learner attempts across every delivery channel — LMS (SCORM) and direct preview links. Pick a lesson for its roster and item analysis."
      />
      <PageBody>
        {!lessonsData ? (
          <Skeleton className="h-48" />
        ) : lessons.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-sm text-[var(--color-muted)]">
            No attempts recorded yet. Results appear as soon as a learner finishes a published lesson (or you play a preview link to the end).
          </CardContent></Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Lesson list */}
            <div className="space-y-2">
              {lessons.map((l) => (
                <button key={l.lessonId} onClick={() => setSelected(l.lessonId)}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${active === l.lessonId ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5" : "border-[var(--color-border)] hover:border-[var(--color-muted)]"}`}>
                  <p className="font-medium text-sm truncate">{l.lessonTitle}</p>
                  <p className="text-xs text-[var(--color-muted)] mt-1">
                    {l.attempts} attempt{l.attempts === 1 ? "" : "s"} · {l.learners} learner{l.learners === 1 ? "" : "s"} · avg {l.avgScore}%
                  </p>
                </button>
              ))}
            </div>
            {/* Detail */}
            <div className="lg:col-span-3">
              {active && <LessonResults lessonId={active} />}
            </div>
          </div>
        )}
      </PageBody>
    </AppShell>
  );
}

function LessonResults({ lessonId }: { lessonId: string }) {
  const { data: summary } = useSWR(`attempt-summary-${lessonId}`, () => api.attemptSummary(lessonId));
  const { data: attemptsData } = useSWR(`attempts-${lessonId}`, () => api.listAttempts(lessonId));
  const attempts = attemptsData?.attempts ?? [];

  return (
    <div className="space-y-4">
      {/* Stat row */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile icon={<ClipboardCheck className="w-4 h-4" />} label="Attempts" value={summary ? String(summary.attempts) : "…"} />
        <StatTile icon={<Target className="w-4 h-4" />} label="Average score" value={summary ? `${summary.avgScore}%` : "…"} />
        <StatTile icon={<TrendingUp className="w-4 h-4" />} label="Pass rate (≥60%)" value={summary ? `${summary.passRate}%` : "…"} />
      </div>

      <Tabs defaultValue="roster">
        <TabsList>
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="items">Item analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="roster">
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--color-muted)] border-b border-[var(--color-border)]">
                    <th className="px-4 py-2.5">Learner</th>
                    <th className="px-4 py-2.5">Score</th>
                    <th className="px-4 py-2.5">Correct</th>
                    <th className="px-4 py-2.5">Points</th>
                    <th className="px-4 py-2.5">Source</th>
                    <th className="px-4 py-2.5">Time</th>
                    <th className="px-4 py-2.5">When</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a) => (
                    <tr key={a.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-2.5 flex items-center gap-2">
                        <Users className="w-3.5 h-3.5 text-[var(--color-muted)]" />
                        {a.learnerName || a.learnerId.replace(/^(scorm|name|anon):/, "")}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={a.scorePct >= 60 ? "accent" : "accent2"}>{a.scorePct}%</Badge>
                      </td>
                      <td className="px-4 py-2.5">{a.correctCount}/{a.totalQuestions}</td>
                      <td className="px-4 py-2.5">{a.points}</td>
                      <td className="px-4 py-2.5"><Badge variant="muted">{a.source}</Badge></td>
                      <td className="px-4 py-2.5">{a.durationSec != null ? `${Math.floor(a.durationSec / 60)}m ${a.durationSec % 60}s` : "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-[var(--color-muted)]">{new Date(a.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="items">
          {!summary ? <Skeleton className="h-40" /> : summary.questions.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-[var(--color-muted)]">No per-question data yet.</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {summary.questions.map((q) => (
                <Card key={q.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-sm">{q.description || q.id}</CardTitle>
                        <CardDescription className="text-xs">{q.id} · {q.type} · answered {q.total}×</CardDescription>
                      </div>
                      <Badge variant={q.correctPct >= 60 ? "accent" : "accent2"}>{q.correctPct}% correct</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="h-2 rounded-full bg-[var(--color-bg)] overflow-hidden border border-[var(--color-border)]">
                      <div className="h-full bg-[var(--color-accent)]" style={{ width: `${q.correctPct}%` }} />
                    </div>
                    {q.commonWrong.length > 0 && (
                      <p className="text-xs text-[var(--color-muted)] mt-2">
                        Common wrong answers: {q.commonWrong.map((w) => `"${w.answer}" (${w.count}×)`).join(" · ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">{icon}{label}</div>
        <p className="text-2xl font-semibold mt-1" style={{ fontFamily: "var(--font-display)" }}>{value}</p>
      </CardContent>
    </Card>
  );
}
