"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Search, BookOpen, FileText, Layers, ArrowRight } from "lucide-react";

import { api } from "@/lib/api";

interface PaletteItem {
  id: string;
  kind: "page" | "course" | "lesson" | "beat";
  title: string;
  subtitle?: string;
  href: string;
}

const PAGES: PaletteItem[] = [
  { id: "p-dash",      kind: "page", title: "Dashboard",  href: "/" },
  { id: "p-courses",   kind: "page", title: "Courses",    href: "/courses" },
  { id: "p-activity",  kind: "page", title: "Activity",   href: "/activity" },
  { id: "p-kanban",    kind: "page", title: "Kanban",     href: "/kanban" },
  { id: "p-analytics", kind: "page", title: "Analytics",  href: "/analytics" },
  { id: "p-results",   kind: "page", title: "Results",    href: "/results" },
  { id: "p-hermes",    kind: "page", title: "Hermes",     href: "/hermes" },
  { id: "p-styles",    kind: "page", title: "Styles",     href: "/styles" },
  { id: "p-docs",      kind: "page", title: "Docs",       href: "/docs" },
  { id: "p-settings",  kind: "page", title: "Settings — AI providers & roles", href: "/settings" },
];

function KindIcon({ kind }: { kind: PaletteItem["kind"] }) {
  const cls = "w-4 h-4 text-[var(--color-muted)] shrink-0";
  if (kind === "course") return <BookOpen className={cls} />;
  if (kind === "lesson") return <Layers className={cls} />;
  if (kind === "beat")   return <FileText className={cls} />;
  return <ArrowRight className={cls} />;
}

/**
 * Ctrl/Cmd+K command palette: jump to any page, course, lesson, or beat.
 * Data loads lazily on first open; simple substring scoring keeps it
 * dependency-free (fine at internal-tool scale).
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Lazy data: only fetch once the palette has been opened.
  const { data: coursesData } = useSWR(open ? "cp-courses" : null, () => api.listCourses());
  const { data: lessonsData } = useSWR(open ? "cp-lessons" : null, () => api.listLessons());
  const { data: beatsData } = useSWR(open ? "cp-beats" : null, () => api.listBeats());

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const courses: PaletteItem[] = (coursesData?.courses ?? []).map((c) => ({
      id: c.id, kind: "course", title: c.title, subtitle: "course", href: `/courses/${c.id}`,
    }));
    const lessons: PaletteItem[] = (lessonsData?.lessons ?? []).map((l) => ({
      id: l.id, kind: "lesson", title: l.title,
      subtitle: l.publishedAt ? "lesson · published" : "lesson", href: `/lessons/${l.id}`,
    }));
    const beats: PaletteItem[] = (beatsData?.beats ?? []).map((b) => ({
      id: b.id, kind: "beat", title: b.beatKey,
      subtitle: b.script.slice(0, 70), href: `/beats/${b.id}`,
    }));
    return [...PAGES, ...courses, ...lessons, ...beats];
  }, [coursesData, lessonsData, beatsData]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 12);
    return items
      .map((it) => {
        const t = it.title.toLowerCase();
        const s = (it.subtitle ?? "").toLowerCase();
        let score = 0;
        if (t === q) score = 100;
        else if (t.startsWith(q)) score = 80;
        else if (t.includes(q)) score = 60;
        else if (s.includes(q)) score = 30;
        return { it, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => r.it);
  }, [items, query]);

  const go = useCallback((item: PaletteItem) => {
    setOpen(false);
    router.push(item.href);
  }, [router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-[var(--color-border)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)]">
          <Search className="w-4 h-4 text-[var(--color-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
              if (e.key === "ArrowUp")   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter" && results[selected]) go(results[selected]);
            }}
            placeholder="Jump to a course, lesson, beat, or page…"
            className="flex-1 outline-none text-sm bg-transparent"
          />
          <kbd className="text-[10px] text-[var(--color-muted)] border border-[var(--color-border)] rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <li className="px-4 py-6 text-sm text-[var(--color-muted)] text-center">No matches.</li>
          )}
          {results.map((item, i) => (
            <li key={`${item.kind}-${item.id}`}>
              <button
                onClick={() => go(item)}
                onMouseEnter={() => setSelected(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === selected ? "bg-[var(--color-bg)]" : ""
                }`}
              >
                <KindIcon kind={item.kind} />
                <span className="font-medium truncate">{item.title}</span>
                {item.subtitle && (
                  <span className="text-xs text-[var(--color-muted)] truncate flex-1">{item.subtitle}</span>
                )}
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)] shrink-0">{item.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
