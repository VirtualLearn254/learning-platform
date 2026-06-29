"use client";

import type { ReviewIssue } from "@lp/shared";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

/**
 * Renders a list of AI-reviewer issues with severity colour-coding +
 * category badge + optional suggestion. Used by beat detail (per-beat)
 * and lesson detail (holistic) pages.
 */
export function ReviewIssues({ issues, score, label }: { issues: ReviewIssue[] | null | undefined; score: number | null | undefined; label?: string }) {
  if (!issues || issues.length === 0) {
    if (score == null) return null;
    return (
      <div className="text-sm text-[var(--color-muted)]">
        <Badge variant="accent">{score}/100</Badge>
        <span className="ml-2">No issues found.</span>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {label && <span className="font-medium">{label}</span>}
        {score != null && (
          <Badge variant={score >= 90 ? "accent" : score >= 70 ? "outline" : "accent2"}>
            {score}/100
          </Badge>
        )}
        <span className="text-[var(--color-muted)]">{issues.length} issue{issues.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="space-y-2">
        {issues.map((iss, i) => (
          <li key={i} className="flex items-start gap-3 p-3 rounded border border-[var(--color-border)] bg-white">
            <SeverityIcon severity={iss.severity} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant={iss.severity === "P0" ? "accent2" : iss.severity === "P1" ? "outline" : "muted"}>{iss.severity}</Badge>
                <span className="text-[var(--color-muted)] font-mono">{iss.category}</span>
                {iss.affectedBeats && iss.affectedBeats.length > 0 && (
                  <span className="text-[var(--color-muted)]">· {iss.affectedBeats.join(", ")}</span>
                )}
              </div>
              <p className="text-sm mt-1">{iss.description}</p>
              {iss.suggestion && (
                <p className="text-xs text-[var(--color-muted)] mt-1 italic">→ {iss.suggestion}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: ReviewIssue["severity"] }) {
  const cls = "w-4 h-4 mt-0.5 shrink-0";
  if (severity === "P0") return <AlertCircle className={`${cls} text-[var(--color-accent-2)]`} />;
  if (severity === "P1") return <AlertTriangle className={`${cls} text-[var(--color-accent)]`} />;
  return <Info className={`${cls} text-[var(--color-muted)]`} />;
}
