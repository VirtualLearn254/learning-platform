"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface StyleCardData {
  id: string;
  name: string;
  description: string | null;
  templateId: string;
  tags: string[];
  approved: boolean;
}

export function StyleCard({ style, onApprove }: { style: StyleCardData; onApprove?: () => void }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="truncate">{style.name}</CardTitle>
          <Badge variant={style.approved ? "accent" : "muted"}>
            {style.approved ? "approved" : "pending"}
          </Badge>
        </div>
        <p className="text-xs font-mono text-[var(--color-muted)]">{style.templateId}</p>
      </CardHeader>
      <CardContent>
        {style.description && (
          <p className="text-sm text-[var(--color-muted)] mb-3 line-clamp-3">{style.description}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {style.tags.map((t) => <Badge key={t} variant="muted">{t}</Badge>)}
        </div>
        {onApprove && !style.approved && (
          <button
            onClick={onApprove}
            className="mt-4 text-sm text-[var(--color-accent)] hover:underline"
          >
            Approve for production →
          </button>
        )}
      </CardContent>
    </Card>
  );
}
