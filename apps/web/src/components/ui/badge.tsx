import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:  "bg-[var(--color-ink)] text-white",
        accent:   "bg-[var(--color-accent)] text-white",
        accent2:  "bg-[var(--color-accent-2)] text-white",
        outline:  "border border-[var(--color-border)] text-[var(--color-ink)]",
        muted:    "bg-[var(--color-bg)] text-[var(--color-muted)] border border-[var(--color-border)]",
        // Stage colors — keep semantic for the Kanban
        queued:        "bg-gray-100 text-gray-700",
        ingested:      "bg-gray-200 text-gray-800",
        authoring:     "bg-blue-100 text-blue-700",
        ai_review:     "bg-purple-100 text-purple-700",
        human_review:  "bg-amber-100 text-amber-800",
        revising:      "bg-orange-100 text-orange-700",
        rendering:     "bg-indigo-100 text-indigo-700",
        approved:      "bg-emerald-100 text-emerald-700",
        stitched:      "bg-teal-100 text-teal-700",
        published:     "bg-[var(--color-accent)] text-white",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
