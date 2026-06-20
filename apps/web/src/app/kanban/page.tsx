"use client";

import useSWR from "swr";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { KanbanBoard } from "@/components/kanban-board";
import { Skeleton } from "@/components/ui/skeleton";

export default function KanbanPage() {
  const { data, isLoading } = useSWR("all-beats", () => api.listBeats(), { refreshInterval: 5000 });

  return (
    <AppShell>
      <PageHeader title="Kanban" description="Every beat across every course — auto-refreshes." />
      <PageBody>
        {isLoading || !data ? (
          <Skeleton className="w-full h-96" />
        ) : (
          <KanbanBoard beats={data.beats} />
        )}
      </PageBody>
    </AppShell>
  );
}
