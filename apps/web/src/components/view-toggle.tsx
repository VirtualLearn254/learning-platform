"use client";

import { useLayoutEffect, useState } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/cn";

export type ViewMode = "grid" | "list";

/** Persisted grid/list preference per view (storage key). Default: grid. */
export function useViewMode(storageKey: string): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("grid");
  useLayoutEffect(() => {
    try { if (localStorage.getItem(storageKey) === "list") setMode("list"); } catch { /* private mode */ }
  }, [storageKey]);
  function update(m: ViewMode) {
    setMode(m);
    try { localStorage.setItem(storageKey, m); } catch { /* private mode */ }
  }
  return [mode, update];
}

export function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <span className="inline-flex items-center rounded-lg border border-[var(--color-border)] overflow-hidden">
      {([["grid", LayoutGrid], ["list", List]] as const).map(([m, Icon]) => (
        <button
          key={m}
          title={`${m} view`}
          onClick={() => onChange(m)}
          className={cn(
            "flex items-center justify-center w-8 h-7 transition-colors",
            mode === m ? "bg-[var(--color-ink)] text-white" : "text-[var(--color-muted)] hover:bg-[var(--color-bg)]",
          )}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </span>
  );
}
