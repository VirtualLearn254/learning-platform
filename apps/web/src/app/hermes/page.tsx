"use client";

import { useState } from "react";
import useSWR from "swr";
import { Sparkles, Check, X, Plus, PlayCircle } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ─── Types ──────────────────────────────────────────────────────────
type Scope = "author" | "designer" | "reviewer" | "ingest";
const SCOPES: Scope[] = ["author", "designer", "reviewer", "ingest"];
const SCOPE_LABEL: Record<Scope, string> = {
  author: "Author · narration & pedagogy",
  designer: "Designer · visual composition",
  reviewer: "Reviewer · scoring criteria",
  ingest: "Ingest · course structure",
};

interface PipelineRule { id: string; scope: Scope; rule: string; origin: string; active: boolean; createdAt?: string }
interface ReviewIssue { severity: "P0" | "P1" | "P2"; category: string; description: string; suggestion?: string }
interface EvidenceBeat {
  beatId: string; beatKey: string; beatType: string; reviewScore: number | null;
  issues: ReviewIssue[]; mp4Key: string | null; courseTitle: string; lessonTitle: string;
}

const fileUrl = (key: string) => `/api/files/${encodeURIComponent(key)}`;
const evidenceOf = (origin: string) => origin.replace(/^hermes\s*\(/, "").replace(/\)$/, "").trim();

export default function HermesPage() {
  const { data: rulesData, mutate: refreshRules } = useSWR("pipeline-rules", () =>
    fetch("/api/rules").then((r) => r.json() as Promise<{ rules: PipelineRule[] }>), { refreshInterval: 15000 });
  const { data: runsData, mutate: refreshRuns } = useSWR("hermes-runs", () => api.listHermesRuns(), { refreshInterval: 8000 });
  const { data: evidenceData } = useSWR("hermes-evidence", () =>
    fetch("/api/hermes/evidence").then((r) => r.json() as Promise<{ evidence: EvidenceBeat[] }>));

  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const rules = rulesData?.rules ?? [];
  const pending = rules.filter((r) => !r.active && r.origin.startsWith("hermes"));
  const active = rules.filter((r) => r.active);

  async function ruleCall(method: string, path: string, body?: unknown) {
    setBusy(true);
    try {
      await fetch(`/api${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      await refreshRules();
    } finally { setBusy(false); }
  }
  async function runNow() {
    setRunning(true);
    try { await api.triggerHermesRun({ beatLimit: 50 }); await refreshRuns(); }
    finally { setRunning(false); }
  }

  return (
    <AppShell>
      <PageHeader
        title="Hermes"
        description="Institutional memory. Distils recurring review findings into durable prompt rules — you approve; Hermes never self-activates."
        actions={<Button onClick={runNow} disabled={running}><Sparkles className="w-4 h-4" />{running ? "Running…" : "Run now"}</Button>}
      />
      <PageBody>
        <Tabs defaultValue="recommendations">
          <TabsList>
            <TabsTrigger value="recommendations">Recommendations{pending.length ? ` (${pending.length})` : ""}</TabsTrigger>
            <TabsTrigger value="rules">Active rules{active.length ? ` (${active.length})` : ""}</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="demos">Demonstrations</TabsTrigger>
          </TabsList>

          {/* ── Recommendations: pending Hermes proposals ── */}
          <TabsContent value="recommendations">
            {!rulesData ? <Skeleton className="h-40" /> : pending.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-sm text-[var(--color-muted)]">
                No pending recommendations. Hit <strong>Run now</strong> to mine your recent review findings.
              </CardContent></Card>
            ) : (
              <div className="space-y-4">
                {SCOPES.filter((s) => pending.some((p) => p.scope === s)).map((scope) => (
                  <Card key={scope}>
                    <CardHeader><CardTitle className="text-sm">{SCOPE_LABEL[scope]}</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {pending.filter((p) => p.scope === scope).map((r) => (
                        <div key={r.id} className="border border-[var(--color-border)] rounded-lg p-4">
                          <p className="font-medium">{r.rule}</p>
                          <p className="text-xs text-[var(--color-muted)] italic mt-1.5">Why: {evidenceOf(r.origin)}</p>
                          <div className="flex gap-2 mt-3">
                            <Button size="sm" disabled={busy} onClick={() => ruleCall("PATCH", `/rules/${r.id}`, { active: true })}>
                              <Check className="w-3.5 h-3.5" />Adopt
                            </Button>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => ruleCall("DELETE", `/rules/${r.id}`)}>
                              <X className="w-3.5 h-3.5" />Dismiss
                            </Button>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Active rules (+ manual add) ── */}
          <TabsContent value="rules">
            <AddRuleForm onAdd={(scope, rule) => ruleCall("POST", "/rules", { scope, rule })} busy={busy} />
            {!rulesData ? <Skeleton className="h-40 mt-4" /> : active.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-sm text-[var(--color-muted)]">
                No active rules yet. Adopt a recommendation or add one above — each is appended to its role&apos;s AI prompt on every future call.
              </CardContent></Card>
            ) : (
              <div className="space-y-4 mt-4">
                {SCOPES.filter((s) => active.some((r) => r.scope === s)).map((scope) => (
                  <Card key={scope}>
                    <CardHeader><CardTitle className="text-sm">{SCOPE_LABEL[scope]}</CardTitle></CardHeader>
                    <CardContent className="space-y-2">
                      {active.filter((r) => r.scope === scope).map((r) => (
                        <div key={r.id} className="flex items-start gap-3 text-sm border border-[var(--color-border)] rounded-lg p-3">
                          <p className="flex-1">{r.rule}</p>
                          <Badge variant="muted">{r.origin.startsWith("hermes") ? "hermes" : "manual"}</Badge>
                          <button className="text-[var(--color-muted)] hover:text-[var(--color-ink)]" disabled={busy}
                            onClick={() => ruleCall("PATCH", `/rules/${r.id}`, { active: false })} title="Deactivate">Pause</button>
                          <button className="text-[var(--color-muted)] hover:text-[var(--color-ink)]" disabled={busy}
                            onClick={() => ruleCall("DELETE", `/rules/${r.id}`)} title="Delete"><X className="w-4 h-4" /></button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Runs ── */}
          <TabsContent value="runs">
            <Card>
              <CardHeader>
                <CardTitle>Evolution runs</CardTitle>
                <CardDescription>Each run pools recent human feedback + AI-review findings + render fallbacks into one distillation pass.</CardDescription>
              </CardHeader>
              <CardContent>
                {!runsData ? <Skeleton className="h-32" /> : runsData.runs.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted)]">No runs yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {runsData.runs.map((r) => (
                      <li key={r.runId} className="flex items-center justify-between gap-4 text-sm border-b border-[var(--color-border)] pb-3 last:border-0">
                        <div className="min-w-0">
                          <p className="text-xs text-[var(--color-muted)]">{new Date(r.startedAt).toLocaleString()} · {r.beatsReviewed} evidence items · {r.stylesProposed} proposed</p>
                          {r.notes ? <p className="truncate">{r.notes}</p> : null}
                        </div>
                        <Badge variant={r.status === "succeeded" || r.status === "completed" ? "accent" : r.status === "failed" ? "accent2" : "muted"}>{r.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Demonstrations: rendered beats that ground the recommendations ── */}
          <TabsContent value="demos">
            <Card className="mb-4"><CardContent className="py-4 text-sm text-[var(--color-muted)]">
              Every recommendation traces to observable defects on real rendered beats. These are the beats whose review findings Hermes distilled — the video is the evidence you can point at.
            </CardContent></Card>
            {!evidenceData ? <Skeleton className="h-64" /> : evidenceData.evidence.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-sm text-[var(--color-muted)]">No reviewed beats yet.</CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {evidenceData.evidence.map((b) => (
                  <Card key={b.beatId}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs text-[var(--color-muted)] truncate">{b.courseTitle} › {b.lessonTitle}</p>
                          <p className="font-semibold">{b.beatKey} <span className="text-xs font-normal text-[var(--color-muted)]">({b.beatType})</span></p>
                        </div>
                        {b.reviewScore != null ? <Badge variant={b.reviewScore >= 85 ? "accent" : "muted"}>{b.reviewScore}</Badge> : null}
                      </div>
                      {b.mp4Key ? (
                        <video src={fileUrl(b.mp4Key)} controls muted preload="metadata"
                          className="w-full rounded-lg mt-3 border border-[var(--color-border)] bg-black aspect-video" />
                      ) : (
                        <div className="w-full rounded-lg mt-3 border border-[var(--color-border)] aspect-video grid place-items-center text-xs text-[var(--color-muted)]">no render</div>
                      )}
                      <ul className="mt-3 space-y-1.5">
                        {b.issues.slice(0, 3).map((i, k) => (
                          <li key={k} className="text-xs flex gap-2">
                            <Badge variant={i.severity === "P0" ? "accent2" : "muted"}>{i.severity}·{i.category}</Badge>
                            <span className="text-[var(--color-muted)]">{i.description}</span>
                          </li>
                        ))}
                      </ul>
                      <a href={`/beats/${b.beatId}`} className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] mt-3 hover:underline">
                        <PlayCircle className="w-3.5 h-3.5" />Open beat
                      </a>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PageBody>
    </AppShell>
  );
}

function AddRuleForm({ onAdd, busy }: { onAdd: (scope: Scope, rule: string) => void; busy: boolean }) {
  const [scope, setScope] = useState<Scope>("designer");
  const [text, setText] = useState("");
  return (
    <Card>
      <CardContent className="p-4 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
        <div>
          <label className="text-xs text-[var(--color-muted)] block mb-1">Scope</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}
            className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm">
            {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Always… / Never…"
          className="flex-1 h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-sm" />
        <Button disabled={busy || text.trim().length < 5} onClick={() => { onAdd(scope, text.trim()); setText(""); }}>
          <Plus className="w-4 h-4" />Add rule
        </Button>
      </CardContent>
    </Card>
  );
}
