"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import type { Beat, VisualSpec, QuizSpec } from "@lp/shared";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { QuizEditor } from "@/components/quiz-editor";
import { VisualEditor } from "@/components/visual-editor";
import { useToast } from "@/lib/use-toast";

interface BeatEditorProps {
  beat: Beat;
  onSave: (patch: { script?: string; visualSpec?: VisualSpec; quiz?: QuizSpec | null }) => Promise<void>;
}

export function BeatEditor({ beat, onSave }: BeatEditorProps) {
  const { notify } = useToast();
  const [script, setScript] = useState(beat.script);
  const [visual, setVisual] = useState<VisualSpec | null>(beat.visualSpec);
  const [quiz, setQuiz] = useState<QuizSpec | null>(beat.quiz);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await onSave({ script, visualSpec: visual ?? undefined, quiz: quiz ?? null });
      notify({ title: "Saved", description: `${beat.beatKey} updated.`, variant: "success" });
    } catch (e) {
      notify({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const isQuizBeat = beat.beatType === "check";

  return (
    <Tabs defaultValue="script">
      <div className="flex items-center justify-between mb-4">
        <TabsList>
          <TabsTrigger value="script">Script</TabsTrigger>
          <TabsTrigger value="visual">Visual</TabsTrigger>
          {isQuizBeat && <TabsTrigger value="quiz">Quiz</TabsTrigger>}
        </TabsList>
        <Button onClick={save} disabled={busy}>
          <Save className="w-4 h-4" /> {busy ? "Saving…" : "Save"}
        </Button>
      </div>

      <TabsContent value="script">
        <Label htmlFor="script-text">Narrated script</Label>
        <Textarea
          id="script-text"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={12}
          className="font-mono text-sm"
        />
        <p className="text-xs text-[var(--color-muted)] mt-2">
          {script.split(/\s+/).filter(Boolean).length} words · ~{Math.round(script.split(/\s+/).filter(Boolean).length / 2.8)}s at 0.95 speed
        </p>
      </TabsContent>

      <TabsContent value="visual">
        <VisualEditor value={visual} onChange={setVisual} />
      </TabsContent>

      {isQuizBeat && (
        <TabsContent value="quiz">
          <QuizEditor value={quiz} onChange={setQuiz} />
        </TabsContent>
      )}
    </Tabs>
  );
}
