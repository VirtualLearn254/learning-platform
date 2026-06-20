"use client";

import type { Beat, BeatStage } from "@lp/shared";
import { BeatCard } from "@/components/beat-card";

/** The lifecycle columns shown left-to-right. */
const COLUMNS: { stage: BeatStage; label: string }[] = [
  { stage: "queued",       label: "Queued" },
  { stage: "ingested",     label: "Outlined" },
  { stage: "authoring",    label: "Authoring" },
  { stage: "ai_review",    label: "AI review" },
  { stage: "human_review", label: "Needs review" },
  { stage: "revising",     label: "Revising" },
  { stage: "rendering",    label: "Rendering" },
  { stage: "approved",     label: "Approved" },
  { stage: "stitched",     label: "Stitched" },
  { stage: "published",    label: "Published" },
];

export function KanbanBoard({ beats }: { beats: Beat[] }) {
  const byStage: Record<BeatStage, Beat[]> = COLUMNS.reduce((acc, col) => {
    acc[col.stage] = [];
    return acc;
  }, {} as Record<BeatStage, Beat[]>);
  for (const b of beats) byStage[b.stage].push(b);

  return (
    <div className="overflow-x-auto -mx-12 px-12 pb-4">
      <div className="flex gap-4 min-w-max">
        {COLUMNS.map((col) => (
          <div key={col.stage} className="w-72 shrink-0">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-sm font-semibold text-[var(--color-ink)]">{col.label}</h3>
              <span className="text-xs text-[var(--color-muted)] tabular-nums">{byStage[col.stage].length}</span>
            </div>
            <div className="space-y-2 min-h-[100px] bg-[var(--color-bg)] rounded-xl p-2 border border-[var(--color-border)]">
              {byStage[col.stage].length === 0 && (
                <p className="text-xs text-[var(--color-muted)] py-8 text-center">—</p>
              )}
              {byStage[col.stage].map((b) => <BeatCard key={b.id} beat={b} compact />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
