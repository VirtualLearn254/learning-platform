"use client";

import { use } from "react";
import useSWR from "swr";
import type { Beat } from "@lp/shared";

import { api, type CourseTreeResponse } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { ConceptMap } from "@/components/concept-map";
import { Skeleton } from "@/components/ui/skeleton";

export default function CourseConceptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = useSWR(`course-tree-${id}`, () => api.getCourseTree(id));

  // Flatten all beats across all lessons in the course.
  const beats: Beat[] = !data ? [] : flattenBeats(data.tree);

  return (
    <AppShell>
      <PageHeader
        title="Concept map"
        description="Concepts taught and required across every beat. Edges = dependency."
      />
      <PageBody>
        <Card className="p-6">
          {!data ? <Skeleton className="h-96" /> : <ConceptMap beats={beats} />}
        </Card>
      </PageBody>
    </AppShell>
  );
}

function flattenBeats(tree: CourseTreeResponse): Beat[] {
  const out: Beat[] = [];
  for (const s of tree.sections) {
    for (const m of s.modules) {
      for (const l of m.lessons) {
        for (const b of l.beats) out.push(b);
      }
    }
  }
  return out;
}
