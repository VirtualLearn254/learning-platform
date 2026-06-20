"use client";

import { useEventStream } from "@/lib/use-event-stream";
import { useState } from "react";

import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface RecentEvent { id: string; type: string; data: Record<string, unknown>; ts: number }

export default function EventsViewerPage() {
  const [events, setEvents] = useState<RecentEvent[]>([]);

  useEventStream({
    channel: "all",
    on: {
      "beat:stage_changed": (data) => push("beat:stage_changed", data),
      "beat:progress":      (data) => push("beat:progress", data),
      "lesson:published":   (data) => push("lesson:published", data),
      "job:completed":      (data) => push("job:completed", data),
    },
  });

  function push(type: string, data: Record<string, unknown>) {
    setEvents((prev) => [{ id: Math.random().toString(36).slice(2), type, data, ts: Date.now() }, ...prev].slice(0, 200));
  }

  return (
    <AppShell>
      <PageHeader
        title="Live events"
        description="Server-sent events stream — what the system is doing right now."
      />
      <PageBody>
        <Card className="p-4">
          {events.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] py-8 text-center">Listening… events will appear here.</p>
          ) : (
            <ul className="space-y-1 font-mono text-xs max-h-[70vh] overflow-y-auto">
              {events.map((e) => (
                <li key={e.id} className="flex items-start gap-3 py-1 border-b border-[var(--color-border)] last:border-b-0">
                  <span className="text-[var(--color-muted)]">{new Date(e.ts).toLocaleTimeString()}</span>
                  <Badge variant="muted" className="!text-xs">{e.type}</Badge>
                  <span className="flex-1 truncate">{JSON.stringify(e.data)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </PageBody>
    </AppShell>
  );
}
