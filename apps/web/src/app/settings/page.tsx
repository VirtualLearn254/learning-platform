"use client";

import { useState } from "react";

import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Settings is single-user for an internal tool — preferences stored in
 *  localStorage today; can move to a user_settings table later if needed. */

interface NotificationPrefs {
  inApp: boolean;
  telegram: boolean;
  whatsapp: boolean;
  email: boolean;
  /** Optional Telegram chat id to send to. */
  telegramChatId: string;
}

export default function SettingsPage() {
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
    <AppShell>
      <PageHeader title="Settings" description="Notification preferences, AI profiles, branding." />
      <PageBody>
        <div className="space-y-6 max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>Which channels to ping when a beat needs your attention</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(["inApp", "telegram", "whatsapp", "email"] as const).map((k) => (
                <label key={k} className="flex items-center gap-3 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs[k]}
                    onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })}
                  />
                  <span>{labelFor(k)}</span>
                </label>
              ))}
              {prefs.telegram && (
                <div className="ml-8">
                  <Label htmlFor="tg-chat">Telegram chat id</Label>
                  <Input
                    id="tg-chat"
                    value={prefs.telegramChatId}
                    onChange={(e) => setPrefs({ ...prefs, telegramChatId: e.target.value })}
                    placeholder="e.g. 123456789"
                    className="max-w-xs"
                  />
                </div>
              )}
              <Button onClick={save}>Save preferences</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI</CardTitle>
              <CardDescription>Provider routing — edit packages/ai-provider/src/profiles.ts to change models</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-[var(--color-muted)]">
                Profiles: <span className="font-mono text-xs">author · reviewer · holistic · verifier · ingest · utility</span>
              </p>
              <p className="text-sm text-[var(--color-muted)] mt-2">
                Default route: <strong>local</strong> (vLLM) → DeepSeek → OpenAI. Configure endpoints in <code>.env</code>.
              </p>
            </CardContent>
          </Card>

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
        </div>
      </PageBody>
    </AppShell>
  );
}

function defaultPrefs(): NotificationPrefs {
  return { inApp: true, telegram: false, whatsapp: false, email: false, telegramChatId: "" };
}

function labelFor(k: keyof NotificationPrefs): string {
  return { inApp: "In-app notifications", telegram: "Telegram", whatsapp: "WhatsApp", email: "Email", telegramChatId: "" }[k];
}
