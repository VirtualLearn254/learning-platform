"use client";

import { useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface FeedbackFormProps {
  onSubmit: (input: { feedback: string; action: "approve" | "revise" | "reject"; screenshotKeys: string[] }) => Promise<void>;
  busy?: boolean;
}

/**
 * The human-review feedback surface for a beat. Supports:
 *   • free-text feedback
 *   • screenshot annotations (drag/drop or paste)
 *   • three actions: approve, revise (loop), reject (restart)
 */
export function FeedbackForm({ onSubmit, busy }: FeedbackFormProps) {
  const [text, setText] = useState("");
  const [screenshots, setScreenshots] = useState<Array<{ key: string; preview: string }>>([]);

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          const url = URL.createObjectURL(file);
          // The real version uploads to S3 and uses the returned key.
          // For now we use the object URL as the key.
          setScreenshots((s) => [...s, { key: url, preview: url }]);
        }
      }
    }
  }

  async function submit(action: "approve" | "revise" | "reject") {
    if (action !== "approve" && text.trim().length === 0) {
      window.alert("Add feedback before requesting a revision or rejection.");
      return;
    }
    await onSubmit({
      feedback: text || "(no feedback)",
      action,
      screenshotKeys: screenshots.map((s) => s.key),
    });
    setText("");
    setScreenshots([]);
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="feedback">Feedback</Label>
        <Textarea
          id="feedback"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          placeholder="Describe what to change. Paste screenshots directly to attach."
          rows={5}
        />
      </div>

      {screenshots.length > 0 && (
        <div>
          <Label className="mb-2 block">Screenshots ({screenshots.length})</Label>
          <div className="grid grid-cols-3 gap-2">
            {screenshots.map((s, i) => (
              <div key={i} className="relative group">
                <img src={s.preview} alt="" className="w-full aspect-video object-cover rounded border border-[var(--color-border)]" />
                <button
                  type="button"
                  onClick={() => setScreenshots((all) => all.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 p-1 bg-white/90 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-3 h-3 text-[var(--color-accent-2)]" />
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-[var(--color-muted)] mt-2 flex items-center gap-1">
            <Camera className="w-3 h-3" /> Paste images directly (Ctrl+V) into the feedback box above.
          </p>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="primary" onClick={() => submit("approve")} disabled={busy}>
          Approve
        </Button>
        <Button variant="secondary" onClick={() => submit("revise")} disabled={busy}>
          Revise
        </Button>
        <Button variant="destructive" onClick={() => submit("reject")} disabled={busy}>
          Reject + redo
        </Button>
      </div>
    </div>
  );
}
