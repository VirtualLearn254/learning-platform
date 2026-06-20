"use client";

import Link from "next/link";
import { Clock, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import type { Beat } from "@lp/shared";
import { Card } from "@/components/ui/card";
import { StageBadge } from "@/components/stage-badge";
import { cn } from "@/lib/cn";

export function BeatCard({ beat, compact = false }: { beat: Beat; compact?: boolean }) {
  const statusIcon = {
    pending:   <Clock className="w-3.5 h-3.5 text-[var(--color-muted)]" />,
    running:   <Loader2 className="w-3.5 h-3.5 text-[var(--color-accent)] animate-spin" />,
    succeeded: <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />,
    failed:    <AlertCircle className="w-3.5 h-3.5 text-[var(--color-accent-2)]" />,
  }[beat.status];

  return (
    <Link href={`/beats/${beat.id}`} className="block">
      <Card className={cn("hover:border-[var(--color-ink)] transition-colors cursor-pointer", compact ? "p-3" : "p-4")}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-[var(--color-muted)]">{beat.beatKey}</span>
              {beat.isAlt && (
                <span className="text-[10px] uppercase tracking-wider bg-[var(--color-bg)] text-[var(--color-muted)] px-1.5 py-0.5 rounded">alt</span>
              )}
            </div>
            {!compact && (
              <p className="text-sm mt-1 line-clamp-2 text-[var(--color-ink)]">
                {beat.script.slice(0, 120)}{beat.script.length > 120 ? "…" : ""}
              </p>
            )}
          </div>
          {statusIcon}
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <StageBadge stage={beat.stage} />
          {beat.durationSeconds && (
            <span className="text-[var(--color-muted)]">{formatDuration(beat.durationSeconds)}</span>
          )}
        </div>
        {beat.revisionCount > 0 && (
          <p className="text-[10px] text-[var(--color-muted)] mt-2">{beat.revisionCount} revision{beat.revisionCount > 1 ? "s" : ""}</p>
        )}
      </Card>
    </Link>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
