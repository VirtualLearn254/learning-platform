"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { ChevronRight, BookOpen } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * Course tree in the left sidebar — sections → modules → lessons → beats,
 * each level expand/collapsible, the current lesson/beat highlighted and its
 * ancestors auto-expanded. Replaces hunting through the breadcrumb trail.
 */
export function CourseTreePanel({ courseId }: { courseId: string }) {
  const pathname = usePathname();
  const { data } = useSWR(`course-tree-${courseId}`, () => api.getCourseTree(courseId), { refreshInterval: 20000 });
  // Manual overrides on top of the auto-expanded active path.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const tree = data?.tree;
  if (!tree) return null;

  const activeLessonId = pathname.startsWith("/lessons/") ? pathname.split("/")[2] : null;
  const activeBeatId = pathname.startsWith("/beats/") ? pathname.split("/")[2] : null;

  function isOpen(key: string, autoOpen: boolean): boolean {
    return toggled[key] ?? autoOpen;
  }
  function flip(key: string, autoOpen: boolean) {
    setToggled((t) => ({ ...t, [key]: !isOpen(key, autoOpen) }));
  }

  const stageDot: Record<string, string> = {
    published: "bg-emerald-500", stitched: "bg-emerald-400", approved: "bg-sky-500",
    rendering: "bg-amber-500", ai_review: "bg-amber-400", human_review: "bg-amber-400",
    authoring: "bg-amber-300", revising: "bg-orange-400", ingested: "bg-gray-300", queued: "bg-gray-300",
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Link
        href={`/courses/${courseId}`}
        className="shrink-0 flex items-center gap-2 px-4 py-4 border-b border-[var(--color-border)] hover:bg-[var(--color-bg)]"
      >
        <BookOpen className="w-4 h-4 shrink-0 text-[var(--color-muted)]" />
        <span className="truncate text-sm font-semibold">{tree.title}</span>
      </Link>
      <div className="flex-1 overflow-y-auto px-2 pb-3 text-[13px]">
        {tree.sections.map((s) => {
          const sKey = `s:${s.id}`;
          const sActive = s.modules.some((m) => m.lessons.some((l) =>
            l.id === activeLessonId || l.beats.some((b) => b.id === activeBeatId)));
          const sOpen = isOpen(sKey, sActive || tree.sections.length === 1);
          return (
            <div key={s.id}>
              <button onClick={() => flip(sKey, sActive || tree.sections.length === 1)}
                className="w-full flex items-center gap-1 px-2 py-1.5 rounded text-left text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", sOpen && "rotate-90")} />
                <span className="truncate font-medium">{s.title}</span>
              </button>
              {sOpen && s.modules.map((m) => {
                const mKey = `m:${m.id}`;
                const mActive = m.lessons.some((l) => l.id === activeLessonId || l.beats.some((b) => b.id === activeBeatId));
                const mOpen = isOpen(mKey, mActive || s.modules.length === 1);
                return (
                  <div key={m.id} className="ml-3">
                    <button onClick={() => flip(mKey, mActive || s.modules.length === 1)}
                      className="w-full flex items-center gap-1 px-2 py-1 rounded text-left text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                      <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", mOpen && "rotate-90")} />
                      <span className="truncate">{m.title}</span>
                    </button>
                    {mOpen && m.lessons.map((l) => {
                      const lKey = `l:${l.id}`;
                      const lActive = l.id === activeLessonId || l.beats.some((b) => b.id === activeBeatId);
                      const lOpen = isOpen(lKey, lActive);
                      return (
                        <div key={l.id} className="ml-3">
                          <div className={cn("flex items-center gap-0.5 rounded", lActive && !activeBeatId && "bg-[var(--color-bg)]")}>
                            <button onClick={() => flip(lKey, lActive)} className="p-1 text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                              <ChevronRight className={cn("w-3 h-3 transition-transform", lOpen && "rotate-90")} />
                            </button>
                            <Link href={`/lessons/${l.id}`}
                              className={cn("flex-1 truncate py-1 pr-2 hover:text-[var(--color-accent)]",
                                l.id === activeLessonId ? "font-semibold text-[var(--color-ink)]" : "text-[var(--color-ink)]")}>
                              {l.title}
                            </Link>
                          </div>
                          {lOpen && l.beats.filter((b) => !b.isAlt).sort((a, b) => a.order - b.order).map((b) => (
                            <Link key={b.id} href={`/beats/${b.id}`}
                              className={cn("ml-6 mr-1 flex items-center gap-2 px-2 py-1 rounded font-mono text-xs truncate",
                                b.id === activeBeatId
                                  ? "bg-[var(--color-ink)] text-white"
                                  : "text-[var(--color-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-ink)]")}>
                              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", stageDot[b.stage] ?? "bg-gray-300")} />
                              <span className="truncate">{b.beatKey}</span>
                            </Link>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
