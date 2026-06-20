"use client";

import { use } from "react";
import useSWR from "swr";
import { FileText, RefreshCcw } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/use-toast";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Material {
  id: string; courseId: string; filename: string; mimeType: string; sizeBytes: number;
  s3Key: string; uploadedAt: string; extractedText: string | null; ingestedAt: string | null;
}

export default function MaterialDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, isLoading } = useSWR<{ materials: Material[] }>(`/api/materials?id=${id}`, fetcher);
  const material = data?.materials?.[0];
  const { notify } = useToast();

  async function reingest() {
    if (!material) return;
    await api.triggerIngest(material.id);
    notify({ title: "Re-ingest queued", variant: "success" });
  }

  return (
    <AppShell>
      <PageHeader
        title={material?.filename ?? "Material"}
        description={material?.mimeType}
        actions={material && (
          <Button onClick={reingest}><RefreshCcw className="w-4 h-4" />Re-ingest</Button>
        )}
      />
      <PageBody>
        {isLoading || !material ? (
          <Skeleton className="w-full h-96" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <Card className="p-6">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />Extracted text
                </h3>
                {material.extractedText ? (
                  <pre className="text-sm whitespace-pre-wrap font-mono max-h-[60vh] overflow-y-auto">{material.extractedText}</pre>
                ) : (
                  <p className="text-sm text-[var(--color-muted)]">
                    Not yet extracted. Re-ingest or wait for the ingest worker to process this file.
                  </p>
                )}
              </Card>
            </div>
            <div>
              <Card className="p-6">
                <h3 className="font-semibold mb-3">Metadata</h3>
                <dl className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <dt className="text-[var(--color-muted)]">Size</dt>
                    <dd>{(material.sizeBytes / 1024).toFixed(1)} KB</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--color-muted)]">Type</dt>
                    <dd>{material.mimeType}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--color-muted)]">Uploaded</dt>
                    <dd>{new Date(material.uploadedAt).toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--color-muted)]">Ingest</dt>
                    <dd>
                      {material.ingestedAt
                        ? <Badge variant="accent">done {new Date(material.ingestedAt).toLocaleDateString()}</Badge>
                        : <Badge variant="muted">pending</Badge>}
                    </dd>
                  </div>
                </dl>
              </Card>
            </div>
          </div>
        )}
      </PageBody>
    </AppShell>
  );
}
