"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, CheckCircle2, AlertCircle, Loader2, ThumbsUp, RotateCcw } from "lucide-react";
import type { Beat } from "@lp/shared";
import { api } from "@/lib/api";
import { StageBadge } from "@/components/stage-badge";
import { cn } from "@/lib/cn";

/**
 * One-line beat row for lesson pages — a 7-beat lesson fits without
 * scrolling. Stage badge · key · type · script preview · score · duration ·
 * status, with Approve/Revise appearing on hover for human_review beats.
 * (The kanban keeps the richer BeatCard with its hero frame.)
 */
export function BeatRow({ beat, onAction }: { beat: Beat; onAction?: () => void }) {
  const [busy, setBusy] = useState(false);

  async function quick(e: React.MouseEvent, action: "approve" | "revise") {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await api.giveBeatFeedback(beat.id, {
        action,
        feedback: action === "approve" ? "Approved from lesson list." : "Revise — flagged from lesson list; see AI review issues.",
      });
      onAction?.();
    } finally {
      setBusy(false);
    }
  }

  const statusIcon = {
    pending:   <Clock className="w-3.5 h-3.5 text-[var(--color-muted)]" />,
    running:   <Loader2 className="w-3.5 h-3.5 text-[var(--color-accent)] animate-spin" />,
    succeeded: <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />,
    failed:    <AlertCircle className="w-3.5 h-3.5 text-[var(--color-accent-2)]" />,
  }[beat.status];

  return (
    <Link
      href={`/beats/${beat.id}`}
      className="group flex items-center gap-3 px-3 py-2 rounded-lg border border-transparent hover:border-[var(--color-border)] hover:bg-white transition-colors"
    >
      <span className="shrink-0">{statusIcon}</span>
      <span className="font-mono text-xs w-40 truncate shrink-0">
        {beat.beatKey}
        {beat.isAlt && <span className="ml-1 text-[10px] uppercase text-[var(--color-muted)]">alt</span>}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] w-14 shrink-0">{beat.beatType}</span>
      <span className="text-sm text-[var(--color-muted)] truncate flex-1 min-w-0">
        {beat.script.slice(0, 110)}
      </span>
      {beat.reviewScore != null && (
        <span className={cn("text-xs tabular-nums shrink-0", beat.reviewScore >= 85 ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]")}>
          {beat.reviewScore}
        </span>
      )}
      {beat.revisionCount > 0 && (
        <span className="text-[10px] text-[var(--color-muted)] shrink-0">r{beat.revisionCount}</span>
      )}
      {beat.durationSeconds ? (
        <span className="text-xs text-[var(--color-muted)] tabular-nums shrink-0 w-10 text-right">
          {Math.floor(beat.durationSeconds / 60)}:{String(Math.round(beat.durationSeconds % 60)).padStart(2, "0")}
        </span>
      ) : <span className="w-10 shrink-0" />}
      <span className="shrink-0"><StageBadge stage={beat.stage} /></span>
      {beat.stage === "human_review" && onAction && (
        <span className="hidden group-hover:flex items-center gap-1 shrink-0">
          <button disabled={busy} onClick={(e) => quick(e, "approve")} title="Approve"
            className="p-1.5 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50">
            <ThumbsUp className="w-3 h-3" />
          </button>
          <button disabled={busy} onClick={(e) => quick(e, "revise")} title="Revise"
            className="p-1.5 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg)] disabled:opacity-50">
            <RotateCcw className="w-3 h-3" />
          </button>
        </span>
      )}
    </Link>
  );
}
