"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Header context strip — lives where the breadcrumb trail used to be.
 * Prev/next stepping through siblings + position + compact status chips.
 */
export function ContextStrip({ prevHref, nextHref, position, children }: {
  prevHref?: string | null;
  nextHref?: string | null;
  position?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center rounded-lg border border-[var(--color-border)] overflow-hidden">
        <PagerLink href={prevHref} title="Previous"><ChevronLeft className="w-4 h-4" /></PagerLink>
        {position && <span className="px-2 text-xs text-[var(--color-muted)] tabular-nums border-x border-[var(--color-border)]">{position}</span>}
        <PagerLink href={nextHref} title="Next"><ChevronRight className="w-4 h-4" /></PagerLink>
      </span>
      {children}
    </div>
  );
}

function PagerLink({ href, title, children }: { href?: string | null; title: string; children: ReactNode }) {
  const cls = "flex items-center justify-center w-8 h-7";
  if (!href) return <span className={cn(cls, "text-[var(--color-border)] cursor-default")}>{children}</span>;
  return <Link href={href} title={title} className={cn(cls, "text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-bg)]")}>{children}</Link>;
}

/** Compact status chip for the strip. */
export function Chip({ label, value, tone }: { label?: string; value: ReactNode; tone?: "accent" | "warn" | "muted" }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border",
      tone === "accent" ? "border-transparent bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
        : tone === "warn" ? "border-transparent bg-amber-50 text-amber-700"
        : "border-[var(--color-border)] text-[var(--color-muted)]",
    )}>
      {label && <span className="opacity-70">{label}</span>}
      <span className={tone ? "font-medium" : "text-[var(--color-ink)]"}>{value}</span>
    </span>
  );
}
