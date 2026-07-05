"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock, CheckCircle2, AlertCircle, Loader2, ThumbsUp, RotateCcw } from "lucide-react";
import type { Beat } from "@lp/shared";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { StageBadge } from "@/components/stage-badge";
import { cn } from "@/lib/cn";

export function BeatCard({ beat, compact = false, onAction }: { beat: Beat; compact?: boolean; onAction?: () => void }) {
  const [busy, setBusy] = useState(false);

  /** Quick feedback without opening the beat — Approve / Revise from the card. */
  async function quick(e: React.MouseEvent, action: "approve" | "revise") {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await api.giveBeatFeedback(beat.id, {
        action,
        feedback: action === "approve" ? "Approved from kanban quick action." : "Revise — flagged from kanban; see AI review issues.",
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
    <Link href={`/beats/${beat.id}`} className="block">
      <Card className={cn("hover:border-[var(--color-ink)] transition-colors cursor-pointer overflow-hidden", compact ? "p-3" : "p-4")}>
        {/* Hero frame from the vision verifier — present for animated renders,
            hides itself for older/static beats. */}
        {beat.htmlKey && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/files/${encodeURIComponent(`beats/${beat.id}/verify-2.png`)}`}
            alt=""
            loading="lazy"
            className={cn("w-full aspect-video object-cover rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]", compact ? "mb-2" : "mb-3")}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
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
        {beat.stage === "human_review" && onAction && (
          <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--color-border)]">
            <button
              disabled={busy}
              onClick={(e) => quick(e, "approve")}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <ThumbsUp className="w-3 h-3" /> Approve
            </button>
            <button
              disabled={busy}
              onClick={(e) => quick(e, "revise")}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg)] disabled:opacity-50 transition-colors"
            >
              <RotateCcw className="w-3 h-3" /> Revise
            </button>
          </div>
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
