"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { Breadcrumb } from "@/lib/api";

/**
 * Render a clickable breadcrumb chain.
 *
 * Each crumb's href is derived from its kind. Sections and modules don't
 * have their own pages yet — they link back to the parent course's tree.
 * The current page (last crumb) is rendered without a link.
 */
export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  if (!items || items.length === 0) return null;

  function hrefFor(crumb: Breadcrumb, index: number): string | null {
    // Find the enclosing course id so section/module links land somewhere useful.
    const courseId = items.find((c) => c.kind === "course")?.id ?? null;
    switch (crumb.kind) {
      case "courses-root": return "/courses";
      case "course":       return crumb.id ? `/courses/${crumb.id}` : null;
      case "section":      // No dedicated page — jump to course tree
      case "module":
        return courseId ? `/courses/${courseId}` : null;
      case "lesson":       return crumb.id ? `/lessons/${crumb.id}` : null;
      case "beat":         // Beat is always the current page, no link
        return null;
    }
  }

  return (
    <nav className="flex items-center flex-wrap gap-1 text-xs text-[var(--color-muted)]">
      {items.map((c, i) => {
        const isLast = i === items.length - 1;
        const href = isLast ? null : hrefFor(c, i);
        return (
          <span key={`${c.kind}-${c.id ?? "root"}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3 opacity-60" />}
            {href ? (
              <Link href={href} className="hover:text-[var(--color-ink)] hover:underline truncate max-w-[220px]">
                {c.title}
              </Link>
            ) : (
              <span className="text-[var(--color-ink)] font-medium truncate max-w-[260px]">{c.title}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
