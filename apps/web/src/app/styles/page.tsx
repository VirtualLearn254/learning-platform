"use client";

import { useState } from "react";
import useSWR from "swr";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StyleCard, type StyleCardData } from "@/components/style-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function StylesPage() {
  const [filter, setFilter] = useState<"all" | "approved" | "pending">("all");
  const { data, isLoading, mutate } = useSWR(`styles-${filter}`, () =>
    api.listStyles(filter === "all" ? undefined : filter === "approved")
  );
  const styles: StyleCardData[] = data?.styles ?? [];
  const filtered = filter === "pending" ? styles.filter((s) => !s.approved) : styles;

  return (
    <AppShell>
      <PageHeader
        title="Style library"
        description="Visual styles available to the author. Hermes proposes; you approve."
      />
      <PageBody>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <TabsList>
            <TabsTrigger value="all">All ({styles.length})</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
          </TabsList>
          <TabsContent value={filter}>
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-[var(--color-muted)]">
                No styles in this view.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((s) => (
                  <StyleCard
                    key={s.id}
                    style={s}
                    onApprove={async () => {
                      // The hermes endpoint approves by style candidate id; for in-app
                      // styles we'd hit /styles/:id/approve directly. Reusing for both flows.
                      await api.approveStyle(s.id);
                      await mutate();
                    }}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </PageBody>
    </AppShell>
  );
}
