"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Shared error surface for failed data fetches. Every page that previously
 * showed an infinite skeleton on API failure renders this instead: the
 * error message, a retry button, and a hint about the API being down.
 */
export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return (
    <Card className="p-10 flex flex-col items-center text-center gap-4 border-[var(--color-accent-2)]">
      <AlertTriangle className="w-8 h-8 text-[var(--color-accent-2)]" />
      <div>
        <p className="font-semibold">{title ?? "Couldn't load this page"}</p>
        <p className="text-sm text-[var(--color-muted)] mt-1 max-w-lg break-words">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw className="w-4 h-4" /> Retry
        </Button>
      )}
      <p className="text-xs text-[var(--color-muted)]">
        If this keeps happening, the API may be down — check the Activity page or container logs.
      </p>
    </Card>
  );
}
