"use client";

import Link from "next/link";

import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { DOCS } from "@/lib/docs.generated";

export default function DocsIndexPage() {
  return (
    <AppShell>
      <PageHeader title="Documentation" description={`${DOCS.length} doc${DOCS.length === 1 ? "" : "s"} bundled with the app build`} />
      <PageBody>
        <div className="max-w-4xl grid grid-cols-1 sm:grid-cols-2 gap-4">
          {DOCS.map((doc) => (
            <Link key={doc.slug} href={`/docs/${doc.slug}`}>
              <Card className="p-5 h-full hover:border-[var(--color-ink)] transition-colors cursor-pointer">
                <h3 className="font-semibold mb-1">{doc.title}</h3>
                <p className="text-sm text-[var(--color-muted)] line-clamp-3">
                  {doc.description || <em>(no description)</em>}
                </p>
                <p className="text-xs text-[var(--color-muted)] mt-3 font-mono">
                  /docs/{doc.slug}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      </PageBody>
    </AppShell>
  );
}
