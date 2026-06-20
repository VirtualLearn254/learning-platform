"use client";

import { useCallback, useState } from "react";
import { Upload, FileText, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface UploadDropzoneProps {
  onFiles: (files: File[]) => Promise<void>;
  accept?: string;
}

export function UploadDropzone({ onFiles, accept = ".pdf,.docx,.md,.txt" }: UploadDropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [queued, setQueued] = useState<File[]>([]);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files);
    setQueued(arr);
    setUploading(true);
    try {
      await onFiles(arr);
      setQueued([]);
    } finally {
      setUploading(false);
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
        "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors",
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
      {queued.length > 0 && (
        <div className="mt-6 text-left space-y-1">
          {queued.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-[var(--color-muted)]" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-[var(--color-muted)]">{(f.size / 1024).toFixed(1)} KB</span>
              {uploading ? <span className="text-xs text-[var(--color-accent)]">uploading…</span> : <X className="w-3 h-3 text-[var(--color-muted)]" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
