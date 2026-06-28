"use client";

import { useState } from "react";
import useSWR from "swr";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader title="Settings" description="AI providers, notification preferences, branding." />
      <PageBody>
        <div className="space-y-6 max-w-4xl">
          <AIProvidersCard />
          <AIProfilesCard />
          <NotificationsCard />
          <BrandingCard />
        </div>
      </PageBody>
    </AppShell>
  );
}

// ─── AI Providers ────────────────────────────────────────────────────

function AIProvidersCard() {
  const providers = useSWR("ai-providers", () => api.listAIProviders());
  const secrets   = useSWR("ai-secrets",   () => api.listAISecrets());
  const canSave = secrets.data?.canSave ?? false;

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, "idle" | "running" | "ok" | "fail">>({});
  const [results, setResults] = useState<Record<string, { latencyMs?: number; sample?: string; actualModel?: string; error?: string }>>({});

  function setInput(name: string, value: string) {
    setInputs((s) => ({ ...s, [name]: value }));
  }

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
    if (!window.confirm(`Clear stored ${secretName}? The env-var fallback (if set) will take effect.`)) return;
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
      const msg = e instanceof Error ? e.message : String(e);
      setTesting((s) => ({ ...s, [providerId]: "fail" }));
      setResults((s) => ({ ...s, [providerId]: { error: msg } }));
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
              ⚠️ <code>LP_SECRETS_KEY</code> isn&apos;t set on the server — saving is disabled. Run <code>bash learning-platform/infra/contabo/bootstrap.sh</code> once to auto-generate it.
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
                  {p.configured
                    ? <Badge variant="accent">configured</Badge>
                    : <Badge variant="muted">not set</Badge>}
                  {secret?.source === "db"  && <Badge variant="outline">stored in app</Badge>}
                  {secret?.source === "env" && <Badge variant="outline">from .env</Badge>}
                  {state === "ok"   && <Badge variant="default">✓ key works</Badge>}
                  {state === "fail" && <Badge variant="accent2">✗ test failed</Badge>}
                  <span className="ml-auto text-xs text-[var(--color-muted)]">
                    {p.pricing} ·{" "}
                    <a href={p.signupUrl} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">
                      Get a key
                    </a>
                  </span>
                </div>

                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label htmlFor={`key-${p.id}`} className="text-xs">
                      {secret?.source === "db" && secret.lastFour
                        ? <>Stored key: <code>●●●●●●●●{secret.lastFour}</code> · Replace it below</>
                        : secret?.source === "env"
                        ? <>Set via <code>{p.envKey}</code> in <code>.env.prod</code>. Save below to override.</>
                        : <>Paste your <code>{p.envKey}</code></>}
                    </Label>
                    <Input
                      id={`key-${p.id}`}
                      type="password"
                      placeholder={p.id === "anthropic" ? "sk-ant-..." : p.id === "local" ? "http://gpu-host:8000/v1" : "sk-..."}
                      value={inputValue}
                      onChange={(e) => setInput(p.secretName, e.target.value)}
                      disabled={!canSave}
                      autoComplete="off"
                    />
                  </div>
                  <Button onClick={() => save(p.secretName)} disabled={!canSave || !inputValue.trim() || isSaving}>
                    {isSaving ? "Saving…" : "Save"}
                  </Button>
                  {p.configured && (
                    <Button variant="secondary" onClick={() => runTest(p.id)} disabled={state === "running"}>
                      {state === "running" ? "Testing…" : "Test"}
                    </Button>
                  )}
                  {secret?.source === "db" && (
                    <Button variant="ghost" onClick={() => clear(p.secretName)}>Clear</Button>
                  )}
                </div>

                {secret?.source === "db" && secret.updatedAt && (
                  <p className="text-xs text-[var(--color-muted)]">
                    Last saved: {new Date(secret.updatedAt).toLocaleString()}
                  </p>
                )}
                {res?.error && state === "fail" && (
                  <p className="text-xs text-[var(--color-accent-2)]">Error: {res.error}</p>
                )}
                {res?.sample && state === "ok" && (
                  <p className="text-xs text-[var(--color-muted)]">
                    Latency: {res.latencyMs}ms · Model returned: <code>{res.actualModel}</code> · Sample: <span className="italic">&ldquo;{res.sample}&rdquo;</span>
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

// ─── AI Profiles (active routing) ────────────────────────────────────

function AIProfilesCard() {
  const { data, isLoading } = useSWR("ai-profiles", () => api.listAIProfiles());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active profile routing</CardTitle>
        <CardDescription>
          Each task type routes to the first available provider in its preferred chain. Edit{" "}
          <code className="text-xs">packages/ai-provider/src/profiles.ts</code> to change preferences or models.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--color-muted)] border-b border-[var(--color-border)]">
            <tr>
              <th className="py-2 pr-4">Profile</th>
              <th className="py-2 pr-4">Active provider</th>
              <th className="py-2 pr-4">Model</th>
              <th className="py-2 pr-4">Preferred chain</th>
              <th className="py-2 pr-4">Temp</th>
              <th className="py-2 pr-4">Max tokens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {data?.profiles.map((p) => (
              <tr key={p.id}>
                <td className="py-2 pr-4 font-medium">
                  {p.id}
                  {p.supportsVision && <Badge variant="outline" className="ml-2 text-[10px]">vision</Badge>}
                </td>
                <td className="py-2 pr-4">
                  {p.activeProvider ?? <span className="text-[var(--color-accent-2)]">none configured</span>}
                </td>
                <td className="py-2 pr-4"><code className="text-xs">{p.activeModel ?? "—"}</code></td>
                <td className="py-2 pr-4 text-xs text-[var(--color-muted)]">{p.preferred.join(" → ")}</td>
                <td className="py-2 pr-4 tabular-nums">{p.temperature}</td>
                <td className="py-2 pr-4 tabular-nums">{p.maxTokens}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Notifications + Branding (unchanged) ────────────────────────────

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
