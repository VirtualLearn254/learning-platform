"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  BookOpen, KanbanSquare, BarChart3, Settings, Sparkles, Home, Palette,
  FileText, Activity, ClipboardCheck, PanelLeftClose, PanelLeftOpen,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CommandPalette } from "@/components/command-palette";
import { CourseTreePanel } from "@/components/course-tree-panel";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
}

const NAV: NavItem[] = [
  { href: "/",           label: "Dashboard",  icon: Home },
  { href: "/courses",    label: "Courses",    icon: BookOpen },
  { href: "/activity",   label: "Activity",   icon: Activity },
  { href: "/kanban",     label: "Kanban",     icon: KanbanSquare },
  { href: "/analytics",  label: "Analytics",  icon: BarChart3 },
  { href: "/results",    label: "Results",    icon: ClipboardCheck },
  { href: "/styles",     label: "Styles",     icon: Palette },
  { href: "/hermes",     label: "Hermes",     icon: Sparkles },
  { href: "/docs",       label: "Docs",       icon: FileText },
  { href: "/settings",   label: "Settings",   icon: Settings },
];

/** Live counts for the nav badges — running jobs (Activity) and pending
 *  Hermes proposals. Light polling; SWR dedupes across pages. */
function useNavBadges(): Record<string, number> {
  const { data: jobsData } = useSWR("nav-jobs", () =>
    fetch("/api/jobs?status=running").then((r) => (r.ok ? r.json() : { jobs: [] })) as Promise<{ jobs: unknown[] }>,
    { refreshInterval: 12000 });
  const { data: rulesData } = useSWR("nav-rules", () =>
    fetch("/api/rules").then((r) => (r.ok ? r.json() : { rules: [] })) as Promise<{ rules: Array<{ active: boolean; origin: string }> }>,
    { refreshInterval: 30000 });
  return {
    "/activity": jobsData?.jobs?.length ?? 0,
    "/hermes": (rulesData?.rules ?? []).filter((r) => !r.active && r.origin.startsWith("hermes")).length,
  };
}

export function AppShell({ children, courseId }: { children: ReactNode; courseId?: string }) {
  const pathname = usePathname();
  const badges = useNavBadges();
  // Collapsed = icon-only rail. Persisted; read after mount to avoid a
  // server/client hydration mismatch (SSR can't see localStorage).
  const [collapsed, setCollapsed] = useState(false);
  // The secondary course panel has its own collapse state + slider handle.
  const [courseOpen, setCourseOpen] = useState(true);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("lp_nav_collapsed") === "1");
      setCourseOpen(localStorage.getItem("lp_course_panel") !== "0");
    } catch { /* private mode */ }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      try { localStorage.setItem("lp_nav_collapsed", c ? "0" : "1"); } catch { /* private mode */ }
      return !c;
    });
  }
  function toggleCourseOpen() {
    setCourseOpen((o) => {
      try { localStorage.setItem("lp_course_panel", o ? "0" : "1"); } catch { /* private mode */ }
      return !o;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <CommandPalette />
      {/* ── Left nav: header pinned, link list scrolls, status pinned ── */}
      <aside className={cn(
        "bg-white border-r border-[var(--color-border)] flex flex-col transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}>
        <div className={cn("shrink-0 border-b border-[var(--color-border)] flex items-center", collapsed ? "px-0 py-4 justify-center" : "px-6 py-6 justify-between")}>
          {collapsed ? (
            <Link href="/" title="learning-platform" className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>lp</Link>
          ) : (
            <div className="min-w-0">
              <Link href="/" className="text-lg font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                learning-platform
              </Link>
              <p className="text-xs text-[var(--color-muted)] mt-1">internal · v0.2</p>
            </div>
          )}
        </div>
        <nav className={cn("flex-1 overflow-y-auto space-y-1", collapsed ? "p-2" : "p-3")}>
          {NAV.map((item) => {
            const active = item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg text-sm transition-colors",
                  collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2",
                  active
                    ? "bg-[var(--color-ink)] text-white"
                    : "text-[var(--color-ink)] hover:bg-[var(--color-bg)]",
                )}
              >
                <span className="relative shrink-0">
                  <item.icon className="w-4 h-4" />
                  {collapsed && (badges[item.href] ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[var(--color-accent)]" />
                  )}
                </span>
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {!collapsed && (badges[item.href] ?? 0) > 0 && (
                  <span className={cn(
                    "text-[10px] tabular-nums rounded-full px-1.5 py-0.5 min-w-[18px] text-center",
                    active ? "bg-white/20 text-white" : "bg-[var(--color-accent)] text-white",
                  )}>
                    {badges[item.href]}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className={cn("shrink-0 border-t border-[var(--color-border)] text-xs text-[var(--color-muted)] flex items-center", collapsed ? "p-2 justify-center" : "p-3 justify-between")}>
          {!collapsed && (
            <span className="inline-flex items-center gap-1">
              <kbd className="border border-[var(--color-border)] rounded px-1 py-0.5 text-[10px]">Ctrl</kbd>
              <kbd className="border border-[var(--color-border)] rounded px-1 py-0.5 text-[10px]">K</kbd>
              search
            </span>
          )}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="p-1.5 rounded-md hover:bg-[var(--color-bg)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* ── Secondary panel: the CURRENT course's structure, beside the main
             nav, with its own slider handle. Replaces the breadcrumb trail. ── */}
      {courseId && (
        courseOpen ? (
          <aside className="w-64 bg-white border-r border-[var(--color-border)] flex flex-col relative">
            <CourseTreePanel courseId={courseId} />
            <button
              onClick={toggleCourseOpen}
              title="Collapse course panel"
              className="absolute top-1/2 -right-3 -translate-y-1/2 z-10 w-6 h-12 rounded-full bg-white border border-[var(--color-border)] shadow-sm flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </aside>
        ) : (
          <button
            onClick={toggleCourseOpen}
            title="Open course panel"
            className="w-6 shrink-0 bg-white border-r border-[var(--color-border)] flex flex-col items-center justify-center gap-2 text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-bg)]"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-[10px] tracking-widest uppercase" style={{ writingMode: "vertical-rl" }}>Course</span>
          </button>
        )
      )}

      {/* ── Main column: column-flex so PageHeader stays + PageBody scrolls ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs }: { title: string; description?: string; actions?: ReactNode; breadcrumbs?: ReactNode }) {
  return (
    <div className="shrink-0 px-12 py-6 border-b border-[var(--color-border)]">
      {breadcrumbs && <div className="mb-3">{breadcrumbs}</div>}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            {title}
          </h1>
          {description && <p className="text-sm text-[var(--color-muted)] mt-1">{description}</p>}
        </div>
        {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-y-auto overflow-x-hidden p-12">{children}</div>;
}
