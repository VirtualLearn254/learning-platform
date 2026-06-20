"use client";

import { use } from "react";
import useSWR from "swr";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { UploadDropzone } from "@/components/upload-dropzone";
import { CourseTree } from "@/components/course-tree";
import { Skeleton } from "@/components/ui/skeleton";

export default function CourseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: treeData, mutate: refreshTree } = useSWR(`course-tree-${id}`, () => api.getCourseTree(id));
  const { data: materialsData, mutate: refreshMaterials } = useSWR(`materials-${id}`, () => api.listMaterials(id));

  async function handleUpload(files: File[]) {
    for (const file of files) {
      const res = await api.createMaterialUpload({
        courseId: id, filename: file.name, mimeType: file.type || "application/octet-stream", size: file.size,
      });
      // In the real impl: PUT to res.uploadUrl, then call triggerIngest.
      await api.triggerIngest(res.material.id);
    }
    await Promise.all([refreshMaterials(), refreshTree()]);
  }

  if (!treeData) {
    return (
      <AppShell>
        <PageHeader title="Loading…" />
        <PageBody>
          <Skeleton className="w-full h-64" />
        </PageBody>
      </AppShell>
    );
  }

  const tree = treeData.tree;
  const materials = materialsData?.materials ?? [];

  return (
    <AppShell>
      <PageHeader title={tree.title} description={tree.summary ?? undefined} />
      <PageBody>
        <Tabs defaultValue="tree">
          <TabsList>
            <TabsTrigger value="tree">Course tree</TabsTrigger>
            <TabsTrigger value="upload">Upload material</TabsTrigger>
            <TabsTrigger value="materials">Materials ({materials.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="tree">
            <Card className="p-6">
              <CourseTree tree={tree} />
            </Card>
          </TabsContent>
          <TabsContent value="upload">
            <Card className="p-6">
              <UploadDropzone onFiles={handleUpload} />
              <p className="text-xs text-[var(--color-muted)] mt-4">
                Material runs through ingest → modules/lessons/beats are drafted automatically.
              </p>
            </Card>
          </TabsContent>
          <TabsContent value="materials">
            <Card className="p-6">
              {materials.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No materials uploaded yet.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {materials.map((m) => (
                    <li key={m.id} className="py-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{m.filename}</p>
                        <p className="text-xs text-[var(--color-muted)]">
                          {(m.sizeBytes / 1024).toFixed(1)} KB · {m.mimeType}
                          {m.ingestedAt ? ` · ingested ${new Date(m.ingestedAt).toLocaleString()}` : " · pending ingest"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </PageBody>
    </AppShell>
  );
}
