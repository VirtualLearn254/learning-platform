"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AppShell } from "@/components/app-shell";
import { DOCS, findDoc } from "@/lib/docs.generated";
import { cn } from "@/lib/cn";

export default function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const doc = findDoc(slug);
  const [query, setQuery] = useState("");

  const filteredDocs = useMemo(() => {
    if (!query.trim()) return DOCS;
    const q = query.toLowerCase();
    return DOCS.filter((d) =>
      d.title.toLowerCase().includes(q) ||
      d.content.toLowerCase().includes(q)
    );
  }, [query]);

  // Find matching lines in the current doc for highlighting/jumping
  const searchHits = useMemo(() => {
    if (!doc || !query.trim()) return [];
    const q = query.toLowerCase();
    const lines = doc.content.split("\n");
    return lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.toLowerCase().includes(q))
      .slice(0, 20);
  }, [doc, query]);

  if (!doc) {
    return (
      <AppShell>
        <div className="p-12">
          <h1 className="text-2xl font-semibold mb-2">Doc not found</h1>
          <p className="text-[var(--color-muted)] mb-6">
            No doc with slug <code>{slug}</code>. The current docs are bundled at build time.
          </p>
          <Link href="/docs" className="text-[var(--color-accent)] hover:underline">← Back to docs index</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* Fills the AppShell main slot; each child scrolls independently */}
      <div className="flex-1 flex overflow-hidden">
        {/* Doc sidebar: search pinned + nav list scrolls */}
        <aside className="w-64 shrink-0 border-r border-[var(--color-border)] bg-white flex flex-col overflow-hidden">
          <div className="shrink-0 p-4 border-b border-[var(--color-border)]">
            <Link href="/docs" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">
              ← All docs
            </Link>
            <input
              type="search"
              placeholder="Search all docs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mt-3 w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-ink)]"
              autoFocus
            />
            {query && (
              <p className="text-xs text-[var(--color-muted)] mt-2">
                {filteredDocs.length} doc{filteredDocs.length === 1 ? "" : "s"} match
                {searchHits.length > 0 && (
                  <span> · {searchHits.length} hit{searchHits.length === 1 ? "" : "s"} on this page</span>
                )}
              </p>
            )}
          </div>

          <nav className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredDocs.map((d) => {
              const active = d.slug === slug;
              return (
                <Link
                  key={d.slug}
                  href={`/docs/${d.slug}`}
                  className={cn(
                    "block px-3 py-2 rounded text-sm transition-colors",
                    active
                      ? "bg-[var(--color-ink)] text-white"
                      : "text-[var(--color-ink)] hover:bg-[var(--color-bg)]"
                  )}
                >
                  {d.title}
                  <span className={cn("block text-xs mt-0.5", active ? "text-white/70" : "text-[var(--color-muted)]")}>
                    /docs/{d.slug}
                  </span>
                </Link>
              );
            })}
            {filteredDocs.length === 0 && (
              <p className="text-xs text-[var(--color-muted)] px-3 py-2">No matches.</p>
            )}
          </nav>
        </aside>

        {/* Doc body: scrolls independently of sidebar */}
        <article className="flex-1 overflow-y-auto"><div className="max-w-4xl mx-auto p-10">
          {searchHits.length > 0 && (
            <div className="mb-6 p-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] text-xs">
              <strong>{searchHits.length}</strong> match{searchHits.length === 1 ? "" : "es"} on this page for &ldquo;{query}&rdquo;
              <button
                onClick={() => setQuery("")}
                className="ml-3 text-[var(--color-accent)] hover:underline"
              >
                Clear
              </button>
            </div>
          )}

          <div className="prose-styles">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...props }) => {
                  // Rewrite relative .md links to /docs/<slug>
                  if (href && href.endsWith(".md")) {
                    const slugFromHref = href.split("/").pop()!.replace(/\.md$/i, "").toLowerCase().replace(/_/g, "-");
                    return <Link href={`/docs/${slugFromHref}`}>{children}</Link>;
                  }
                  // Hashes within the same doc
                  if (href && href.startsWith("#")) {
                    return <a href={href} {...props}>{children}</a>;
                  }
                  // External
                  return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>;
                },
              }}
            >
              {doc.content}
            </ReactMarkdown>
          </div>

          <hr className="my-10 border-[var(--color-border)]" />
          <p className="text-xs text-[var(--color-muted)]">
            Source: <code>docs/{doc.filename}</code> · Edit on disk + redeploy to update.
            <button
              onClick={() => router.push("/docs")}
              className="ml-3 text-[var(--color-accent)] hover:underline"
            >
              Back to index
            </button>
          </p>
          </div>
        </article>
      </div>
    </AppShell>
  );
}
