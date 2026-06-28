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
  const { data, isLoading } = useSWR("ai-providers", () => api.listAIProviders());
  const [testing, setTesting] = useState<Record<string, "idle" | "running" | "ok" | "fail">>({});
  const [results, setResults] = useState<Record<string, { latencyMs?: number; sample?: string; actualModel?: string; error?: string }>>({});

  async function runTest(id: string) {
    setTesting((s) => ({ ...s, [id]: "running" }));
    try {
      const r = await api.testAIProvider(id);
      setTesting((s) => ({ ...s, [id]: r.ok ? "ok" : "fail" }));
      setResults((s) => ({ ...s, [id]: { latencyMs: r.latencyMs, sample: r.sample, actualModel: r.actualModel, error: r.error } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTesting((s) => ({ ...s, [id]: "fail" }));
      setResults((s) => ({ ...s, [id]: { error: msg } }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI providers</CardTitle>
        <CardDescription>
          Configure API keys in <code className="text-xs">.env.prod</code> on the VPS and redeploy. This panel shows current status and lets you verify each key works.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
        <ul className="divide-y divide-[var(--color-border)]">
          {data?.providers.map((p) => {
            const state = testing[p.id] ?? "idle";
            const res = results[p.id];
            return (
              <li key={p.id} className="py-3 flex items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.displayName}</span>
                    {p.configured
                      ? <Badge variant="accent">configured</Badge>
                      : <Badge variant="muted">not set</Badge>}
                    {state === "ok"   && <Badge variant="default">✓ key works</Badge>}
                    {state === "fail" && <Badge variant="accent2">✗ test failed</Badge>}
                  </div>
                  <p className="text-xs text-[var(--color-muted)] mt-1">
                    env var: <code>{p.envKey}</code> · pricing: {p.pricing}
                  </p>
                  {!p.configured && (
                    <p className="text-xs mt-1">
                      <a href={p.signupUrl} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">
                        Get an API key →
                      </a>
                    </p>
                  )}
                  {res?.error && <p className="text-xs text-[var(--color-accent-2)] mt-2">Error: {res.error}</p>}
                  {res?.sample && state === "ok" && (
                    <p className="text-xs text-[var(--color-muted)] mt-2">
                      Latency: {res.latencyMs}ms · Model returned: <code>{res.actualModel}</code> · Sample: <span className="italic">&ldquo;{res.sample}&rdquo;</span>
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!p.configured || state === "running"}
                  onClick={() => runTest(p.id)}
                >
                  {state === "running" ? "Testing…" : "Test"}
                </Button>
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
          Each task type (author, reviewer, etc.) routes to the first available provider in its preferred chain. Edit{" "}
          <code className="text-xs">packages/ai-provider/src/profiles.ts</code> to change models or preferences.
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

// ─── Notifications (unchanged from before) ───────────────────────────

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
