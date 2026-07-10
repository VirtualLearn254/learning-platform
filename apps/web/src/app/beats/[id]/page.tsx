"use client";

import { use, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { Wand2, Film, CheckCircle2 } from "lucide-react";

import { api } from "@/lib/api";
import { AppShell, PageBody, PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/stage-badge";
import { FeedbackForm } from "@/components/feedback-form";
import { Skeleton } from "@/components/ui/skeleton";
import { BeatEditor } from "@/components/beat-editor";
import { JobTimeline } from "@/components/job-timeline";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReviewIssues } from "@/components/review-issues";
import { ErrorState } from "@/components/error-state";
import { useToast } from "@/lib/use-toast";
import { ContextStrip, Chip } from "@/components/context-strip";
import { ThumbsUp, RotateCcw } from "lucide-react";

/**
 * Render history: every versioned MP4 for this beat, newest first. Pick two
 * to compare side by side — the fastest way to judge a model/prompt change.
 */
function RenderHistory({ beatId }: { beatId: string }) {
  const { data } = useSWR(`beat-renders-${beatId}`, () => api.listBeatRenders(beatId), { refreshInterval: 15000 });
  const [compare, setCompare] = useState<string[]>([]);
  const renders = data?.renders ?? [];
  if (renders.length === 0) return null;

  function toggle(key: string) {
    setCompare((prev) => prev.includes(key)
      ? prev.filter((k) => k !== key)
      : [...prev.slice(-1), key]); // keep at most 2
  }

  return (
    <Card className="p-6">
      <h3 className="font-semibold mb-1">Render history ({renders.length})</h3>
      <p className="text-xs text-[var(--color-muted)] mb-3">Select two to compare side by side.</p>
      <ul className="space-y-1.5 mb-4">
        {renders.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={compare.includes(r.key)}
              onChange={() => toggle(r.key)}
              className="accent-[var(--color-accent)]"
            />
            <span className="tabular-nums text-xs text-[var(--color-muted)]">
              {r.renderedAt ? new Date(r.renderedAt).toLocaleString() : "—"}
            </span>
            <span className={r.mode === "animated" ? "text-[var(--color-accent)] text-xs" : "text-[var(--color-muted)] text-xs"}>{r.mode}</span>
            <span className="text-xs text-[var(--color-muted)] ml-auto">{(r.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
          </li>
        ))}
      </ul>
      {compare.length === 2 && (
        <div className="grid grid-cols-2 gap-3">
          {compare.map((key) => (
            <video key={key} src={`/api/files/${encodeURIComponent(key)}`} controls className="w-full rounded-lg border border-[var(--color-border)]" />
          ))}
        </div>
      )}
    </Card>
  );
}

const fileUrl = (key: string) => `/api/files/${encodeURIComponent(key)}`;

/**
 * Fix-this-beat studio: a scrubbable video + a strip of the beat's UNIQUE
 * frames (scene-change) to pinpoint the wrong moment, plus a correction note /
 * annotated image that re-renders the beat (~$0.10) with the fix applied.
 */
function CorrectionStudio({ beatId, mp4Url, onRerender }: { beatId: string; mp4Url: string; onRerender: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { data } = useSWR(`beat-keyframes-${beatId}`, () => api.getBeatKeyframes(beatId));
  const [note, setNote] = useState("");
  const [imageKey, setImageKey] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function seek(t: number) {
    const v = videoRef.current;
    if (v) { v.currentTime = t; v.pause(); }
  }
  async function onFile(f: File) {
    setImagePreview(URL.createObjectURL(f));
    try { const res = await api.uploadBeatReferenceImage(beatId, f); setImageKey(res.key); }
    catch { setImagePreview(null); }
  }
  async function submit() {
    setBusy(true);
    try {
      await api.renderBeat(beatId, { correctionNote: note.trim() || undefined, referenceImageKey: imageKey ?? undefined });
      setNote(""); setImageKey(null); setImagePreview(null);
      onRerender();
    } finally { setBusy(false); }
  }

  const frames = data?.frames ?? [];
  const verifyFrames = data?.verifyFrames ?? [];
  return (
    <Card className="p-6">
      <h3 className="font-semibold mb-1">Preview &amp; fix</h3>
      <p className="text-xs text-[var(--color-muted)] mb-3">
        Scrub to the moment that&apos;s wrong (or click a keyframe to jump there), describe the fix — attach an annotated image if it helps — then re-render (~$0.10).
      </p>
      <video ref={videoRef} src={mp4Url} controls className="w-full rounded-lg border border-[var(--color-border)] bg-black aspect-video" />
      {verifyFrames.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          {verifyFrames.map((v) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <figure key={v.key} className="min-w-0">
              <img src={fileUrl(v.key)} alt={v.label}
                className="w-full aspect-video object-cover rounded border border-[var(--color-border)] bg-[var(--color-bg)]"
                onError={(e) => { (e.target as HTMLImageElement).closest("figure")!.style.display = "none"; }} />
              <figcaption className="text-[10px] text-[var(--color-muted)] mt-0.5 text-center uppercase tracking-wide">{v.label}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {frames.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto mt-3 pb-1">
          {frames.map((f, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <button key={i} onClick={() => seek(f.timeSec)} title={`${f.timeSec.toFixed(1)}s`} className="shrink-0 focus:outline-none">
              <img src={fileUrl(f.key)} alt={`frame at ${f.timeSec.toFixed(1)}s`}
                className="h-14 rounded border border-[var(--color-border)] hover:border-[var(--color-accent)]" />
            </button>
          ))}
        </div>
      )}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3}
        placeholder="e.g. The exponent in the second line should be a superscript. Move the title up so it doesn't overlap the chart."
        className="w-full mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm" />
      <div className="flex items-center gap-3 mt-2">
        <label className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)] cursor-pointer border border-[var(--color-border)] rounded-md px-2 py-1">
          Attach image
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </label>
        {imagePreview && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={imagePreview} alt="reference" className="h-8 rounded border border-[var(--color-border)]" />
        )}
        <Button className="ml-auto" disabled={busy || (!note.trim() && !imageKey)} onClick={submit}>
          {busy ? "Re-rendering…" : "Re-render with correction"}
        </Button>
      </div>
    </Card>
  );
}

export default function BeatDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { notify } = useToast();
  const { data, error, mutate, isLoading } = useSWR(`beat-${id}`, () => api.getBeat(id), { refreshInterval: 4000 });
  const lessonId = data?.beat?.lessonId;
  const { data: siblingsData } = useSWR(lessonId ? `beat-siblings-${lessonId}` : null, () => api.listBeats({ lessonId: lessonId! }));

  /** Run an action with toast feedback — no more silent buttons. */
  async function act(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      notify({ title: `${label} queued`, variant: "success" });
      await mutate();
    } catch (e) {
      notify({ title: `${label} failed: ${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
    }
  }

  async function submitFeedback(input: { feedback: string; action: "approve" | "revise" | "reject"; screenshotKeys: string[] }) {
    await api.giveBeatFeedback(id, input);
    await mutate();
  }

  if (error) {
    return (
      <AppShell>
        <PageHeader title="Beat" />
        <PageBody><ErrorState error={error} onRetry={() => mutate()} /></PageBody>
      </AppShell>
    );
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
  const courseId = data.breadcrumbs?.find((c) => c.kind === "course")?.id ?? undefined;

  // Siblings for prev/next stepping (the reviewer loop: check → next → check).
  const siblings = (siblingsData?.beats ?? [])
    .filter((b) => !b.isAlt)
    .sort((a, b) => a.order - b.order);
  const idx = siblings.findIndex((b) => b.id === id);
  const prevBeat = idx > 0 ? siblings[idx - 1] : null;
  const nextBeat = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  async function quickReview(action: "approve" | "revise") {
    await submitFeedback({ action, feedback: action === "approve" ? "Approved from header." : "Revise — flagged from header; see AI review issues.", screenshotKeys: [] });
    notify({ title: action === "approve" ? "Approved" : "Sent back for revision", variant: "success" });
    if (action === "approve" && nextBeat) router.push(`/beats/${nextBeat.id}`);
  }

  return (
    <AppShell courseId={courseId}>
      <PageHeader
        title={beat.beatKey}
        breadcrumbs={
          <ContextStrip
            prevHref={prevBeat ? `/beats/${prevBeat.id}` : null}
            nextHref={nextBeat ? `/beats/${nextBeat.id}` : null}
            position={idx >= 0 ? `${idx + 1} / ${siblings.length}` : undefined}
          >
            <Chip value={beat.beatType} />
            {beat.reviewScore != null && <Chip label="score" value={`${beat.reviewScore}/100`} tone={beat.reviewScore >= 85 ? "accent" : "muted"} />}
            {beat.durationSeconds ? <Chip label="dur" value={`${beat.durationSeconds.toFixed(0)}s`} /> : null}
            {beat.revisionCount > 0 && <Chip label="rev" value={beat.revisionCount} tone="warn" />}
            {data.aiCostUsd > 0 && <Chip label="spend" value={`$${data.aiCostUsd.toFixed(2)}`} />}
            {beat.stage === "human_review" && (
              <span className="inline-flex items-center gap-1.5 ml-1">
                <button onClick={() => quickReview("approve")}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90">
                  <ThumbsUp className="w-3 h-3" /> Approve{nextBeat ? " → next" : ""}
                </button>
                <button onClick={() => quickReview("revise")}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border border-[var(--color-border)] hover:bg-[var(--color-bg)]">
                  <RotateCcw className="w-3 h-3" /> Revise
                </button>
              </span>
            )}
          </ContextStrip>
        }
        actions={
          <div className="flex items-center gap-2">
            <StageBadge stage={beat.stage} />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => document.getElementById("beat-editor")?.scrollIntoView({ behavior: "smooth" })}
            >
              Edit script
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => act("Author", () => api.authorBeat(id))}
            >
              <Wand2 className="w-3.5 h-3.5" />
              {beat.stage === "ingested" || beat.stage === "queued" ? "Author" : "Re-author"}
            </Button>
            {(beat.stage === "ai_review" || beat.stage === "human_review" || beat.stage === "approved" || beat.mp4Key) && (
              <Button
                size="sm"
                onClick={() => act("Render", () => api.renderBeat(id))}
              >
                <Film className="w-3.5 h-3.5" />
                {beat.mp4Key ? "Re-render" : "Render"}
              </Button>
            )}
            {(beat.stage !== "queued" && beat.stage !== "ingested") && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => act("Review", () => api.reviewBeat(id))}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Re-review
              </Button>
            )}
          </div>
        }
      />
      <PageBody>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {beat.errorMessage && (
              <Card className="p-5 border-[var(--color-accent-2)]">
                <h3 className="font-semibold mb-1 text-[var(--color-accent-2)]">Last error</h3>
                <p className="text-sm">{beat.errorMessage}</p>
              </Card>
            )}

            {previewUrl ? (
              /* One video, two jobs: preview AND fix — no duplicate players. */
              <CorrectionStudio beatId={id} mp4Url={previewUrl} onRerender={() => { notify({ title: "Re-render queued with your correction", variant: "success" }); mutate(); }} />
            ) : (
              <Card className="p-6">
                <h3 className="font-semibold mb-3">Preview</h3>
                <div className="aspect-video bg-[var(--color-bg)] rounded-xl flex items-center justify-center">
                  <p className="text-sm text-[var(--color-muted)]">No MP4 rendered yet</p>
                </div>
              </Card>
            )}


            {(beat.reviewScore !== null || (beat.reviewIssues && beat.reviewIssues.length > 0)) && (
              <Card className="p-6">
                <h3 className="font-semibold mb-3">AI review</h3>
                <ReviewIssues issues={beat.reviewIssues} score={beat.reviewScore} />
                {beat.reviewedAt && (
                  <p className="text-xs text-[var(--color-muted)] mt-3">
                    Reviewed {new Date(beat.reviewedAt).toLocaleString()}
                  </p>
                )}
              </Card>
            )}

            <Card className="p-6" id="beat-editor">
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

          </div>

          <div className="space-y-6">
            {beat.stage === "human_review" && (
              <Card className="p-6 border-amber-300">
                <h3 className="font-semibold mb-3">Your review</h3>
                <FeedbackForm onSubmit={async (input) => { await submitFeedback(input); router.push("/kanban"); }} />
              </Card>
            )}

            <Card className="p-6">
              <h3 className="font-semibold mb-3">Metadata</h3>
              <dl className="text-sm space-y-2">
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Order</dt><dd>{beat.order}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Alt beat</dt><dd>{beat.isAlt ? "yes" : "no"}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Concepts taught</dt><dd>{beat.conceptsTaught.length || "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Concepts required</dt><dd>{beat.conceptsRequired.length || "—"}</dd></div>
              </dl>
            </Card>

            <RenderHistory beatId={id} />
          </div>
        </div>
      </PageBody>
    </AppShell>
  );
}
