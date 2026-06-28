"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Provider = "anthropic" | "openai" | "deepseek" | "local";

export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader title="Settings" description="AI providers, role routing, usage analytics, notifications." />
      <PageBody>
        <div className="space-y-6 max-w-5xl">
          <AIProvidersCard />
          <AIRolesCard />
          <AIUsageCard />
          <NotificationsCard />
          <BrandingCard />
        </div>
      </PageBody>
    </AppShell>
  );
}

// ─── AI Providers (unchanged from prior PR) ──────────────────────────

function AIProvidersCard() {
  const providers = useSWR("ai-providers", () => api.listAIProviders());
  const secrets   = useSWR("ai-secrets",   () => api.listAISecrets());
  const canSave = secrets.data?.canSave ?? false;

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, "idle" | "running" | "ok" | "fail">>({});
  const [results, setResults] = useState<Record<string, { latencyMs?: number; sample?: string; actualModel?: string; error?: string }>>({});

  function setInput(name: string, value: string) { setInputs((s) => ({ ...s, [name]: value })); }

  async function save(secretName: string) {
    const value = inputs[secretName]?.trim();
    if (!value) return;
    setSaving((s) => ({ ...s, [secretName]: true }));
    try {
      const r = await api.saveAISecret(secretName, value);
      if (!r.ok) throw new Error(r.error ?? "save failed");
      setInputs((s) => ({ ...s, [secretName]: "" }));
      await Promise.all([providers.mutate(), secrets.mutate()]);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving((s) => ({ ...s, [secretName]: false }));
    }
  }

  async function clear(secretName: string) {
    if (!window.confirm(`Clear stored ${secretName}?`)) return;
    await api.deleteAISecret(secretName);
    await Promise.all([providers.mutate(), secrets.mutate()]);
  }

  async function runTest(providerId: string) {
    setTesting((s) => ({ ...s, [providerId]: "running" }));
    try {
      const r = await api.testAIProvider(providerId);
      setTesting((s) => ({ ...s, [providerId]: r.ok ? "ok" : "fail" }));
      setResults((s) => ({ ...s, [providerId]: { latencyMs: r.latencyMs, sample: r.sample, actualModel: r.actualModel, error: r.error } }));
    } catch (e) {
      setTesting((s) => ({ ...s, [providerId]: "fail" }));
      setResults((s) => ({ ...s, [providerId]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  const secretByName = new Map((secrets.data?.secrets ?? []).map((s) => [s.name, s]));

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI providers</CardTitle>
        <CardDescription>
          Paste keys below to save them encrypted. Stored keys win over <code className="text-xs">.env.prod</code> values
          {!canSave && (
            <span className="block mt-2 text-[var(--color-accent-2)]">
              ⚠️ <code>LP_SECRETS_KEY</code> isn&apos;t set — saving disabled. Run the bootstrap once to auto-generate it.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {providers.isLoading && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
        <ul className="divide-y divide-[var(--color-border)]">
          {providers.data?.providers.map((p) => {
            const secret = secretByName.get(p.secretName);
            const state = testing[p.id] ?? "idle";
            const res = results[p.id];
            const inputValue = inputs[p.secretName] ?? "";
            const isSaving = saving[p.secretName] ?? false;
            return (
              <li key={p.id} className="py-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{p.displayName}</span>
                  {p.configured ? <Badge variant="accent">configured</Badge> : <Badge variant="muted">not set</Badge>}
                  {secret?.source === "db"  && <Badge variant="outline">stored in app</Badge>}
                  {secret?.source === "env" && <Badge variant="outline">from .env</Badge>}
                  {state === "ok"   && <Badge variant="default">✓ key works</Badge>}
                  {state === "fail" && <Badge variant="accent2">✗ test failed</Badge>}
                  <span className="ml-auto text-xs text-[var(--color-muted)]">
                    {p.pricing} · <a href={p.signupUrl} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">Get a key</a>
                  </span>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label htmlFor={`key-${p.id}`} className="text-xs">
                      {secret?.source === "db" && secret.lastFour
                        ? <>Stored key: <code>●●●●●●●●{secret.lastFour}</code> · Replace below</>
                        : secret?.source === "env"
                        ? <>Set via <code>{p.envKey}</code>. Save below to override.</>
                        : <>Paste your <code>{p.envKey}</code></>}
                    </Label>
                    <Input id={`key-${p.id}`} type="password"
                      placeholder={p.id === "anthropic" ? "sk-ant-..." : p.id === "local" ? "http://gpu-host:8000/v1" : "sk-..."}
                      value={inputValue} onChange={(e) => setInput(p.secretName, e.target.value)}
                      disabled={!canSave} autoComplete="off" />
                  </div>
                  <Button onClick={() => save(p.secretName)} disabled={!canSave || !inputValue.trim() || isSaving}>
                    {isSaving ? "Saving…" : "Save"}
                  </Button>
                  {p.configured && (
                    <Button variant="secondary" onClick={() => runTest(p.id)} disabled={state === "running"}>
                      {state === "running" ? "Testing…" : "Test"}
                    </Button>
                  )}
                  {secret?.source === "db" && <Button variant="ghost" onClick={() => clear(p.secretName)}>Clear</Button>}
                </div>
                {secret?.source === "db" && secret.updatedAt && (
                  <p className="text-xs text-[var(--color-muted)]">Last saved: {new Date(secret.updatedAt).toLocaleString()}</p>
                )}
                {res?.error && state === "fail" && <p className="text-xs text-[var(--color-accent-2)]">Error: {res.error}</p>}
                {res?.sample && state === "ok" && (
                  <p className="text-xs text-[var(--color-muted)]">
                    Latency: {res.latencyMs}ms · Returned: <code>{res.actualModel}</code> · Sample: <span className="italic">&ldquo;{res.sample}&rdquo;</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── AI Roles (editable routing) ─────────────────────────────────────

function AIRolesCard() {
  const providers = useSWR("ai-providers", () => api.listAIProviders());
  const profilesQ = useSWR("ai-profiles",  () => api.listAIProfiles());
  const modelsQ   = useSWR("ai-models",    () => api.listAIModels());

  const [drafts, setDrafts] = useState<Record<string, { preferredProvider?: string; modelId?: string; temperature?: number; maxTokens?: number; touched?: boolean }>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const configuredProviders = useMemo(() => new Set((providers.data?.providers ?? []).filter((p) => p.configured).map((p) => p.id)), [providers.data]);
  const catalog = modelsQ.data?.catalog;

  function patch(id: string, changes: Partial<typeof drafts[string]>) {
    setDrafts((s) => ({ ...s, [id]: { ...(s[id] ?? {}), ...changes, touched: true } }));
  }

  async function save(id: string) {
    const d = drafts[id];
    if (!d) return;
    setSaving((s) => ({ ...s, [id]: true }));
    try {
      const r = await api.saveAIProfile(id, {
        preferredProvider: d.preferredProvider,
        modelId: d.modelId,
        temperature: d.temperature,
        maxTokens: d.maxTokens,
      });
      if (!r.ok) throw new Error(r.error ?? "save failed");
      setDrafts((s) => { const next = { ...s }; delete next[id]; return next; });
      await profilesQ.mutate();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving((s) => ({ ...s, [id]: false }));
    }
  }

  async function reset(id: string) {
    await api.resetAIProfile(id);
    setDrafts((s) => { const next = { ...s }; delete next[id]; return next; });
    await profilesQ.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI roles</CardTitle>
        <CardDescription>
          Swap the provider + model per role. Saves take effect on the next AI call (no restart).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {profilesQ.isLoading && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
              <tr>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 pr-3">Temp</th>
                <th className="py-2 pr-3">Max tokens</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {profilesQ.data?.profiles.map((p) => {
                const draft = drafts[p.id] ?? {};
                const provider = (draft.preferredProvider ?? p.activeProvider ?? p.preferred[0]) as Provider | undefined;
                const modelList = provider && catalog ? catalog[provider] : [];
                const modelValue = draft.modelId ?? p.activeModel ?? "";
                const tempValue = draft.temperature ?? p.temperature;
                const maxValue  = draft.maxTokens ?? p.maxTokens;
                const touched = draft.touched ?? false;
                const isSaving = saving[p.id] ?? false;

                return (
                  <tr key={p.id} className="align-top">
                    <td className="py-3 pr-3 font-medium whitespace-nowrap">
                      {p.id}
                      {p.supportsVision && <Badge variant="outline" className="ml-2 text-[10px]">vision</Badge>}
                      {p.isOverridden && <Badge variant="accent" className="ml-2 text-[10px]">custom</Badge>}
                    </td>
                    <td className="py-3 pr-3">
                      <select
                        className="w-full bg-[var(--color-card)] border border-[var(--color-border)] rounded px-2 py-1 text-sm"
                        value={provider ?? ""}
                        onChange={(e) => patch(p.id, { preferredProvider: e.target.value, modelId: undefined })}
                      >
                        {(["anthropic", "openai", "deepseek", "local"] as Provider[]).map((id) => (
                          <option key={id} value={id} disabled={!configuredProviders.has(id)}>
                            {id}{configuredProviders.has(id) ? "" : " (not configured)"}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 pr-3">
                      {provider === "local" ? (
                        <Input value={modelValue} placeholder="Qwen/Qwen2.5-32B-Instruct-AWQ"
                          onChange={(e) => patch(p.id, { modelId: e.target.value })} className="text-xs" />
                      ) : (
                        <select
                          className="w-full bg-[var(--color-card)] border border-[var(--color-border)] rounded px-2 py-1 text-sm"
                          value={modelValue}
                          onChange={(e) => patch(p.id, { modelId: e.target.value })}
                        >
                          <option value="">— default —</option>
                          {modelList.map((m) => (
                            <option key={m.id} value={m.id} disabled={p.supportsVision && !m.supportsVision}>
                              {m.displayName} · ${m.inputPer1M}/${m.outputPer1M} per 1M
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="py-3 pr-3 w-20">
                      <Input type="number" step="0.05" min="0" max="2"
                        value={tempValue}
                        onChange={(e) => patch(p.id, { temperature: Number(e.target.value) })}
                        className="text-sm tabular-nums" />
                    </td>
                    <td className="py-3 pr-3 w-24">
                      <Input type="number" step="500" min="500" max="32000"
                        value={maxValue}
                        onChange={(e) => patch(p.id, { maxTokens: Number(e.target.value) })}
                        className="text-sm tabular-nums" />
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap">
                      <Button size="sm" disabled={!touched || isSaving} onClick={() => save(p.id)}>
                        {isSaving ? "Saving…" : "Save"}
                      </Button>
                      {p.isOverridden && (
                        <Button size="sm" variant="ghost" onClick={() => reset(p.id)} className="ml-1">Reset</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--color-muted)] mt-3">
          Code defaults live in <code>packages/ai-provider/src/profiles.ts</code>. UI overrides take precedence.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── AI Usage ────────────────────────────────────────────────────────

function AIUsageCard() {
  const [window, setWindow] = useState<"1h" | "24h" | "7d" | "30d">("24h");
  const usage = useSWR(`ai-usage-${window}`, () => api.getAIUsage(window), { refreshInterval: 30000 });

  const totals = usage.data?.totals;
  const maxBucket = useMemo(() => {
    const series = usage.data?.timeSeries ?? [];
    return Math.max(0.0001, ...series.map((s) => s.costUsd));
  }, [usage.data]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>AI usage</CardTitle>
            <CardDescription>Running cost + token spend across all AI calls. Auto-refreshes every 30s.</CardDescription>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--color-border)] overflow-hidden text-xs">
            {(["1h", "24h", "7d", "30d"] as const).map((w) => (
              <button
                key={w}
                onClick={() => setWindow(w)}
                className={`px-3 py-1.5 ${window === w ? "bg-[var(--color-ink)] text-white" : "bg-[var(--color-card)] text-[var(--color-ink)] hover:bg-[var(--color-bg)]"}`}
              >
                Last {w}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!usage.data && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
        {usage.data && totals && (
          <>
            {/* Top-line cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Stat label="Total spend"     value={`$${totals.costUsd.toFixed(4)}`} sub={`${totals.calls} call${totals.calls === 1 ? "" : "s"}`} />
              <Stat label="Avg per call"    value={`$${totals.avgCostUsd.toFixed(5)}`} sub={`${(totals.inputTokens + totals.outputTokens).toLocaleString()} tokens`} />
              <Stat label="Avg latency"     value={`${totals.avgLatencyMs}ms`} sub={`${totals.errorCalls} error${totals.errorCalls === 1 ? "" : "s"}`} />
              <Stat label="Token in / out"  value={`${formatTokens(totals.inputTokens)} / ${formatTokens(totals.outputTokens)}`} sub="prompt / completion" />
            </div>

            {/* Time series */}
            {usage.data.timeSeries.length > 0 && (
              <div className="mb-6">
                <p className="text-xs text-[var(--color-muted)] mb-2">Cost over time (${window === "1h" || window === "24h" ? "hourly" : "daily"} buckets)</p>
                <div className="flex items-end gap-1 h-24 border-b border-[var(--color-border)]">
                  {usage.data.timeSeries.map((b) => {
                    const h = Math.max(2, (b.costUsd / maxBucket) * 96);
                    return (
                      <div
                        key={b.bucket}
                        className="flex-1 bg-[var(--color-accent)] rounded-t hover:opacity-80 transition-opacity"
                        style={{ height: `${h}px` }}
                        title={`${new Date(b.bucket).toLocaleString()}: $${b.costUsd.toFixed(4)} (${b.calls} call${b.calls === 1 ? "" : "s"})`}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Breakdowns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Breakdown title="By role"     rows={usage.data.byProfile} />
              <Breakdown title="By provider" rows={usage.data.byProvider} />
              <Breakdown title="By model"    rows={usage.data.byModel} />
            </div>

            {totals.calls === 0 && (
              <p className="text-xs text-[var(--color-muted)] mt-4 text-center">
                No AI calls yet in this window. Try clicking <strong>Test</strong> on a configured provider above — it&apos;ll log a usage row.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="p-3 border border-[var(--color-border)] rounded-lg">
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1">{value}</p>
      <p className="text-xs text-[var(--color-muted)] mt-1">{sub}</p>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Array<{ key: string; calls: number; costUsd: number; share: number }> }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)] mb-2">{title}</p>
      {rows.length === 0 && <p className="text-xs text-[var(--color-muted)]">—</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="text-xs">
            <div className="flex justify-between gap-2">
              <span className="font-medium truncate">{r.key}</span>
              <span className="tabular-nums whitespace-nowrap">${r.costUsd.toFixed(4)} · {r.calls}</span>
            </div>
            <div className="h-1 bg-[var(--color-bg)] rounded overflow-hidden mt-1">
              <div className="h-full bg-[var(--color-accent)]" style={{ width: `${(r.share * 100).toFixed(1)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Notifications + Branding ────────────────────────────────────────

interface NotificationPrefs {
  inApp: boolean;
  telegram: boolean;
  whatsapp: boolean;
  email: boolean;
  telegramChatId: string;
}

function NotificationsCard() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => {
    if (typeof window === "undefined") return defaultPrefs();
    try {
      const raw = localStorage.getItem("lp.notification.prefs");
      return raw ? JSON.parse(raw) : defaultPrefs();
    } catch { return defaultPrefs(); }
  });

  function save() {
    localStorage.setItem("lp.notification.prefs", JSON.stringify(prefs));
    window.alert("Saved.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>Which channels to ping when a beat needs your attention</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(["inApp", "telegram", "whatsapp", "email"] as const).map((k) => (
          <label key={k} className="flex items-center gap-3 text-sm cursor-pointer">
            <input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} />
            <span>{labelFor(k)}</span>
          </label>
        ))}
        {prefs.telegram && (
          <div className="ml-8">
            <Label htmlFor="tg-chat">Telegram chat id</Label>
            <Input id="tg-chat" value={prefs.telegramChatId} onChange={(e) => setPrefs({ ...prefs, telegramChatId: e.target.value })} placeholder="e.g. 123456789" className="max-w-xs" />
          </div>
        )}
        <Button onClick={save}>Save preferences</Button>
      </CardContent>
    </Card>
  );
}

function BrandingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>Used in PDF generation + SCORM packaging</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label htmlFor="org-name">Organization name</Label>
          <Input id="org-name" placeholder="e.g. Virtualwise" />
        </div>
        <div>
          <Label htmlFor="primary-color">Primary brand color</Label>
          <Input id="primary-color" placeholder="#0E7C66" />
        </div>
        <Button>Save branding</Button>
      </CardContent>
    </Card>
  );
}

function defaultPrefs(): NotificationPrefs {
  return { inApp: true, telegram: false, whatsapp: false, email: false, telegramChatId: "" };
}

function labelFor(k: keyof NotificationPrefs): string {
  return { inApp: "In-app notifications", telegram: "Telegram", whatsapp: "WhatsApp", email: "Email", telegramChatId: "" }[k];
}
