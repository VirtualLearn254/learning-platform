"use client";

import useSWR from "swr";
import { Sparkles, Check, X } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function HermesPage() {
  const { data: runsData, mutate: refreshRuns } = useSWR("hermes-runs", () => api.listHermesRuns(), { refreshInterval: 10000 });
  const { data: candidatesData, mutate: refreshCandidates } = useSWR("hermes-pending", () => api.listPendingStyles());

  async function trigger() {
    await api.triggerHermesRun({ beatLimit: 5 });
    await refreshRuns();
  }

  return (
    <AppShell>
      <PageHeader
        title="Hermes"
        description="The nightly evolution loop. Reviews random beats, proposes new styles, learns over time."
        actions={
          <Button onClick={trigger}><Sparkles className="w-4 h-4" />Run now</Button>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent runs */}
          <Card>
            <CardHeader>
              <CardTitle>Recent evolution runs</CardTitle>
              <CardDescription>Cron + manual triggers, last 10</CardDescription>
            </CardHeader>
            <CardContent>
              {!runsData ? (
                <Skeleton className="h-32" />
              ) : runsData.runs.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No evolution runs yet.</p>
              ) : (
                <ul className="space-y-3">
                  {runsData.runs.map((r) => (
                    <li key={r.runId} className="flex items-center justify-between text-sm">
                      <div>
                        <p className="font-mono text-xs">{r.runId}</p>
                        <p className="text-xs text-[var(--color-muted)]">
                          {new Date(r.startedAt).toLocaleString()} · {r.beatsReviewed} reviewed · {r.stylesProposed} proposed
                        </p>
                      </div>
                      <Badge variant={r.status === "completed" ? "accent" : r.status === "failed" ? "accent2" : "muted"}>
                        {r.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Pending style candidates */}
          <Card>
            <CardHeader>
              <CardTitle>Pending style candidates</CardTitle>
              <CardDescription>Hermes proposes; you approve or reject</CardDescription>
            </CardHeader>
            <CardContent>
              {!candidatesData ? (
                <Skeleton className="h-32" />
              ) : candidatesData.candidates.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">Nothing pending. The agent will surface candidates here.</p>
              ) : (
                <ul className="space-y-4">
                  {candidatesData.candidates.map((c) => (
                    <li key={c.id} className="border border-[var(--color-border)] rounded-lg p-4">
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-sm text-[var(--color-muted)] my-2">{c.description}</p>
                      <p className="text-xs text-[var(--color-muted)] italic">"{c.rationale}"</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.recommendedFor.map((tag) => <Badge key={tag} variant="muted">{tag}</Badge>)}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" onClick={async () => { await api.approveStyle(c.id); refreshCandidates(); }}>
                          <Check className="w-3.5 h-3.5" />Approve
                        </Button>
                        <Button size="sm" variant="secondary" onClick={async () => {
                          const reason = window.prompt("Reason for rejecting?") ?? "no reason";
                          await api.rejectStyle(c.id, reason);
                          refreshCandidates();
                        }}>
                          <X className="w-3.5 h-3.5" />Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </AppShell>
  );
}
