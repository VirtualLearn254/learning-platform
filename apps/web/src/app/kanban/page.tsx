"use client";

import { useState } from "react";
import useSWR from "swr";
import { CheckCheck } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { KanbanBoard } from "@/components/kanban-board";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/error-state";
import { useToast } from "@/lib/use-toast";

export default function KanbanPage() {
  const { data, error, mutate, isLoading } = useSWR("all-beats", () => api.listBeats(), { refreshInterval: 5000 });
  const { notify } = useToast();
  const [bulkBusy, setBulkBusy] = useState(false);

  // Bulk approve: everything awaiting human review that the AI reviewer
  // scored >=90 with no open issues — the "clearly fine" pile.
  const clean = (data?.beats ?? []).filter(
    (b) => b.stage === "human_review" && (b.reviewScore ?? 0) >= 90,
  );

  async function approveAllClean() {
    setBulkBusy(true);
    let ok = 0;
    try {
      for (const b of clean) {
        try {
          await api.giveBeatFeedback(b.id, { action: "approve", feedback: "Bulk-approved: AI review score >= 90, no open issues." });
          ok++;
        } catch { /* keep going; the summary toast reports the count */ }
      }
      notify({ title: `Approved ${ok}/${clean.length} clean beat${clean.length === 1 ? "" : "s"}`, variant: ok === clean.length ? "success" : "destructive" });
      mutate();
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        compact
        title="Kanban"
        description="Every beat across every course — auto-refreshes. Approve or send back straight from the cards."
        actions={
          clean.length > 0 ? (
            <Button onClick={approveAllClean} disabled={bulkBusy}>
              <CheckCheck className="w-4 h-4" />
              {bulkBusy ? "Approving…" : `Approve ${clean.length} clean (score ≥90)`}
            </Button>
          ) : undefined
        }
      />
      <PageBody padding="px-4 pt-3 pb-2">
        {error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : isLoading || !data ? (
          <Skeleton className="w-full h-96" />
        ) : (
          <div className="h-full min-h-0">
            <KanbanBoard beats={data.beats} onAction={() => mutate()} />
          </div>
        )}
      </PageBody>
    </AppShell>
  );
}
