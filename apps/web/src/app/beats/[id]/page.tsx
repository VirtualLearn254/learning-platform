"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Wand2 } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/stage-badge";
import { FeedbackForm } from "@/components/feedback-form";
import { VideoPlayer } from "@/components/video-player";
import { Skeleton } from "@/components/ui/skeleton";
import { BeatEditor } from "@/components/beat-editor";
import { JobTimeline } from "@/components/job-timeline";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/breadcrumbs";

export default function BeatDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, mutate, isLoading } = useSWR(`beat-${id}`, () => api.getBeat(id), { refreshInterval: 4000 });

  async function submitFeedback(input: { feedback: string; action: "approve" | "revise" | "reject"; screenshotKeys: string[] }) {
    await api.giveBeatFeedback(id, input);
    await mutate();
  }

  if (isLoading || !data) {
    return (
      <AppShell>
        <PageHeader title="Loading…" />
        <PageBody><Skeleton className="w-full h-64" /></PageBody>
      </AppShell>
    );
  }

  const beat = data.beat;
  const previewUrl = beat.mp4Key ? `/api/files/${encodeURIComponent(beat.mp4Key)}` : null;

  return (
    <AppShell>
      <PageHeader
        title={beat.beatKey}
        description={`${beat.beatType} · revision ${beat.revisionCount} · stage:`}
        breadcrumbs={data.breadcrumbs && <Breadcrumbs items={data.breadcrumbs} />}
        actions={
          <div className="flex items-center gap-2">
            <StageBadge stage={beat.stage} />
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => { await api.authorBeat(id); await mutate(); }}
            >
              <Wand2 className="w-3.5 h-3.5" />
              {beat.stage === "ingested" || beat.stage === "queued" ? "Author" : "Re-author"}
            </Button>
          </div>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6">
              <h3 className="font-semibold mb-3">Preview</h3>
              {previewUrl ? (
                <VideoPlayer src={previewUrl} controls />
              ) : (
                <div className="aspect-video bg-[var(--color-bg)] rounded-xl flex items-center justify-center">
                  <p className="text-sm text-[var(--color-muted)]">No MP4 rendered yet</p>
                </div>
              )}
            </Card>

            <Card className="p-6">
              <Tabs defaultValue="edit">
                <TabsList>
                  <TabsTrigger value="edit">Edit</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>
                <TabsContent value="edit">
                  <BeatEditor
                    beat={beat}
                    onSave={async (patch) => {
                      await api.updateBeat(id, patch as never);
                      await mutate();
                    }}
                  />
                </TabsContent>
                <TabsContent value="history">
                  <JobTimeline beatId={id} />
                </TabsContent>
              </Tabs>
            </Card>

            {beat.errorMessage && (
              <Card className="p-6 border-[var(--color-accent-2)]">
                <h3 className="font-semibold mb-2 text-[var(--color-accent-2)]">Last error</h3>
                <p className="text-sm">{beat.errorMessage}</p>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card className="p-6">
              <h3 className="font-semibold mb-3">Your review</h3>
              {beat.stage === "human_review" ? (
                <FeedbackForm onSubmit={async (input) => { await submitFeedback(input); router.push("/kanban"); }} />
              ) : (
                <p className="text-sm text-[var(--color-muted)]">
                  This beat isn't awaiting human review right now.
                </p>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-3">Metadata</h3>
              <dl className="text-sm space-y-2">
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Duration</dt><dd>{beat.durationSeconds ? `${beat.durationSeconds.toFixed(1)}s` : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Beat type</dt><dd>{beat.beatType}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Order</dt><dd>{beat.order}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Alt beat</dt><dd>{beat.isAlt ? "yes" : "no"}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Concepts taught</dt><dd>{beat.conceptsTaught.length || "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Concepts required</dt><dd>{beat.conceptsRequired.length || "—"}</dd></div>
              </dl>
            </Card>
          </div>
        </div>
      </PageBody>
    </AppShell>
  );
}
