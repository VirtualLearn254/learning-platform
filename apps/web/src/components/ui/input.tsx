import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:border-[var(--color-ink)] focus-visible:ring-1 focus-visible:ring-[var(--color-ink)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "placeholder:text-[var(--color-muted)]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
