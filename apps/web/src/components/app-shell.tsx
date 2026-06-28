"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, KanbanSquare, BarChart3, Settings, Sparkles, Home, Palette, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
}

const NAV: NavItem[] = [
  { href: "/",           label: "Dashboard",  icon: Home },
  { href: "/courses",    label: "Courses",    icon: BookOpen },
  { href: "/kanban",     label: "Kanban",     icon: KanbanSquare },
  { href: "/analytics",  label: "Analytics",  icon: BarChart3 },
  { href: "/styles",     label: "Styles",     icon: Palette },
  { href: "/hermes",     label: "Hermes",     icon: Sparkles },
  { href: "/docs",       label: "Docs",       icon: FileText },
  { href: "/settings",   label: "Settings",   icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Left nav: header pinned, link list scrolls, status pinned ── */}
      <aside className="w-60 bg-white border-r border-[var(--color-border)] flex flex-col">
        <div className="shrink-0 px-6 py-6 border-b border-[var(--color-border)]">
          <Link href="/" className="text-lg font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            learning-platform
          </Link>
          <p className="text-xs text-[var(--color-muted)] mt-1">internal · v0.1</p>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {NAV.map((item) => {
            const active = item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-[var(--color-ink)] text-white"
                    : "text-[var(--color-ink)] hover:bg-[var(--color-bg)]",
                )}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="shrink-0 p-4 border-t border-[var(--color-border)] text-xs text-[var(--color-muted)]">
          Status: <span className="text-[var(--color-accent)]">scaffold</span>
        </div>
      </aside>
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
