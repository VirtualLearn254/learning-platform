import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[100px] w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm transition-colors resize-y",
        "focus-visible:outline-none focus-visible:border-[var(--color-ink)] focus-visible:ring-1 focus-visible:ring-[var(--color-ink)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "placeholder:text-[var(--color-muted)]",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
