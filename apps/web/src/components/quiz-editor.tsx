"use client";

import { useState } from "react";
import type { QuizSpec, QuizType, QuizOption } from "@lp/shared";
import { Plus, Trash2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

const TYPES: QuizType[] = ["multiple_choice", "match", "fill_in", "scenario", "likert"];

export function QuizEditor({ value, onChange }: { value: QuizSpec | null; onChange: (v: QuizSpec) => void }) {
  const [local, setLocal] = useState<QuizSpec>(value ?? makeDefault("multiple_choice"));

  function update(patch: Partial<QuizSpec>) {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(next);
  }
  function updateOption(i: number, patch: Partial<QuizOption>) {
    const opts = local.options.map((o, j) => (i === j ? { ...o, ...patch } : o));
    update({ options: opts });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Type</Label>
          <select
            value={local.type}
            onChange={(e) => update(makeDefault(e.target.value as QuizType))}
            className="w-full h-10 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label>Eyebrow</Label>
          <Input
            value={local.eyebrow ?? ""}
            onChange={(e) => update({ eyebrow: e.target.value })}
            placeholder="e.g. Quick check — apply"
          />
        </div>
      </div>

      <div>
        <Label>Question</Label>
        <Textarea
          value={local.question}
          onChange={(e) => update({ question: e.target.value })}
          rows={2}
          placeholder="The question shown to the learner"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Options ({local.options.length})</Label>
          <Button
            size="sm" variant="secondary"
            onClick={() => update({ options: [...local.options, makeBlankOption(local.options.length)] })}
          >
            <Plus className="w-3 h-3" /> Add
          </Button>
        </div>
        <div className="space-y-2">
          {local.options.map((opt, i) => (
            <div key={opt.id} className="border border-[var(--color-border)] rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-[var(--color-muted)]">{opt.id}</span>
                <button
                  className="text-[var(--color-accent-2)] hover:opacity-80"
                  onClick={() => update({ options: local.options.filter((_, j) => j !== i) })}
                ><Trash2 className="w-3 h-3" /></button>
              </div>
              <Input
                value={opt.text}
                onChange={(e) => updateOption(i, { text: e.target.value })}
                placeholder="Option text"
              />
              <Textarea
                value={opt.feedback ?? ""}
                onChange={(e) => updateOption(i, { feedback: e.target.value })}
                rows={2}
                placeholder="Feedback shown when this option is picked"
              />
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={opt.isCorrect ?? false}
                    onChange={(e) => updateOption(i, { isCorrect: e.target.checked })}
                  />
                  Correct
                </label>
                {local.type === "match" && (
                  <Input
                    value={opt.matchTargetId ?? ""}
                    onChange={(e) => updateOption(i, { matchTargetId: e.target.value })}
                    placeholder="match target id"
                    className="text-xs"
                  />
                )}
                {local.type === "fill_in" && (
                  <>
                    <Input
                      type="number"
                      value={opt.numericValue ?? ""}
                      onChange={(e) => updateOption(i, { numericValue: parseFloat(e.target.value) })}
                      placeholder="numeric value"
                      className="text-xs"
                    />
                    <Input
                      type="number"
                      value={opt.numericTolerancePct ?? ""}
                      onChange={(e) => updateOption(i, { numericTolerancePct: parseFloat(e.target.value) })}
                      placeholder="tolerance %"
                      className="text-xs"
                    />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Correct feedback (fallback)</Label>
          <Textarea
            value={local.correctFeedback ?? ""}
            onChange={(e) => update({ correctFeedback: e.target.value })}
            rows={2}
          />
        </div>
        <div>
          <Label>Wrong feedback (fallback)</Label>
          <Textarea
            value={local.wrongFeedback ?? ""}
            onChange={(e) => update({ wrongFeedback: e.target.value })}
            rows={2}
          />
        </div>
      </div>
    </div>
  );
}

function makeDefault(type: QuizType): QuizSpec {
  return {
    type,
    question: "",
    eyebrow: "",
    options: [makeBlankOption(0), makeBlankOption(1)],
  };
}

function makeBlankOption(i: number): QuizOption {
  return { id: `opt${i + 1}`, text: "", feedback: "" };
}
