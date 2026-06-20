"use client";

import { useState } from "react";
import { Search, Image as ImageIcon } from "lucide-react";

import { api } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface ImagePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (image: { id: string; url: string; provider: string; alt: string | null }) => void;
}

export function ImagePicker({ open, onOpenChange, onPick }: ImagePickerProps) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; provider: string; url: string; thumbnailUrl: string; alt: string | null }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.searchImages(q, { perProvider: 8, aspect: "16:9" });
      setResults(res.results);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Find an image</DialogTitle>
          <DialogDescription>Searches Unsplash, Pexels, Pixabay, and Wikimedia Commons.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='e.g. "black hole" or "ancient roman forum"'
            onKeyDown={(e) => e.key === "Enter" && search()}
            autoFocus
          />
          <Button onClick={search} disabled={loading || !q.trim()}>
            <Search className="w-4 h-4" />
            {loading ? "Searching…" : "Search"}
          </Button>
        </div>

        {error && (
          <div className="text-sm text-[var(--color-accent-2)] py-2">Search failed: {error}</div>
        )}

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="aspect-video" />)}
            </div>
          ) : results.length === 0 ? (
            <div className="py-16 text-center text-sm text-[var(--color-muted)]">
              <ImageIcon className="w-10 h-10 mx-auto mb-3" />
              <p>{q ? "No results — try a different query." : "Search to find images."}</p>
              <p className="text-xs mt-1">No image-provider keys configured yet — wire UNSPLASH_ACCESS_KEY etc. in <code>.env</code> to enable.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {results.map((img) => (
                <button
                  key={img.id}
                  onClick={() => onPick(img)}
                  className="aspect-video rounded-lg overflow-hidden border border-[var(--color-border)] hover:border-[var(--color-ink)] transition-colors group relative"
                >
                  <img
                    src={img.thumbnailUrl}
                    alt={img.alt ?? ""}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-1 left-1 text-[10px] uppercase tracking-wider bg-white/90 px-1.5 py-0.5 rounded">
                    {img.provider}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
