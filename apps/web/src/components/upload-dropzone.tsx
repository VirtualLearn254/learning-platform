"use client";

import { useCallback, useState } from "react";
import { Upload, FileText, X, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";

interface UploadDropzoneProps {
  onFiles: (files: File[]) => Promise<void>;
  accept?: string;
}

type Status = "queued" | "uploading" | "done" | "error";
interface Item { file: File; status: Status; error?: string }

export function UploadDropzone({ onFiles, accept = ".pdf,.docx,.md,.txt" }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<Item[]>([]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    setItems(arr.map((file) => ({ file, status: "uploading" as const })));
    try {
      await onFiles(arr);
      setItems((cur) => cur.map((it) => ({ ...it, status: "done" })));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setItems((cur) => cur.map((it) => ({ ...it, status: "error", error: msg })));
    }
  }, [onFiles]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "border-2 border-dashed rounded-xl p-12 text-center transition-colors",
        dragging ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5" : "border-[var(--color-border)] hover:border-[var(--color-ink)]",
      )}
    >
      <input
        id="upload-input"
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <label htmlFor="upload-input" className="cursor-pointer block">
        <Upload className="w-10 h-10 text-[var(--color-muted)] mx-auto mb-3" />
        <p className="font-semibold mb-1">Drop files or click to browse</p>
        <p className="text-sm text-[var(--color-muted)]">PDF, DOCX, MD, or TXT — multiple files allowed</p>
      </label>
      {items.length > 0 && (
        <div className="mt-6 text-left space-y-2">
          {items.map((it, i) => (
            <div key={i} className="border border-[var(--color-border)] rounded-lg p-3 bg-white">
              <div className="flex items-center gap-2 text-sm">
                <FileText className="w-4 h-4 text-[var(--color-muted)]" />
                <span className="flex-1 truncate">{it.file.name}</span>
                <span className="text-xs text-[var(--color-muted)]">{(it.file.size / 1024).toFixed(1)} KB</span>
                {it.status === "uploading" && <span className="text-xs text-[var(--color-accent)]">uploading…</span>}
                {it.status === "done"      && <CheckCircle2 className="w-4 h-4 text-[var(--color-accent)]" />}
                {it.status === "error"     && <AlertCircle  className="w-4 h-4 text-[var(--color-accent-2)]" />}
                {it.status === "queued"    && <X className="w-3 h-3 text-[var(--color-muted)]" />}
              </div>
              {it.status === "error" && (
                <p className="text-xs text-[var(--color-accent-2)] mt-2 break-all">
                  {it.error || "Upload failed (no details returned)"}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
