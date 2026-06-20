"use client";

import { useState } from "react";
import type { VisualSpec } from "@lp/shared";
import { Plus, Trash2, Image as ImageIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ImagePicker } from "@/components/image-picker";

const TEMPLATES = ["single-focus", "title-body", "two-column", "recap-bullets", "matrix-anim", "tile-grid", "timeline"];

export function VisualEditor({ value, onChange }: { value: VisualSpec | null; onChange: (v: VisualSpec) => void }) {
  const [local, setLocal] = useState<VisualSpec>(value ?? { template: "single-focus", background: "solid", onScreenText: [], callouts: [] });
  const [pickerOpen, setPickerOpen] = useState(false);

  function update(patch: Partial<VisualSpec>) {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(next);
  }

  function updateArray(field: "onScreenText" | "callouts", action: "add" | "remove" | "edit", idx?: number, val?: string) {
    const arr = [...(local[field] ?? [])];
    if (action === "add") arr.push("");
    else if (action === "remove" && idx !== undefined) arr.splice(idx, 1);
    else if (action === "edit" && idx !== undefined && val !== undefined) arr[idx] = val;
    update({ [field]: arr } as Partial<VisualSpec>);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Template</Label>
          <select
            value={local.template ?? ""}
            onChange={(e) => update({ template: e.target.value })}
            className="w-full h-10 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm"
          >
            {TEMPLATES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Label>Style</Label>
          <Input
            value={local.style ?? ""}
            onChange={(e) => update({ style: e.target.value })}
            placeholder="e.g. warm-grain, swiss-grid"
          />
        </div>
      </div>

      <div>
        <Label>Background</Label>
        <select
          value={local.background ?? "solid"}
          onChange={(e) => update({ background: e.target.value as VisualSpec["background"] })}
          className="w-full h-10 rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm"
        >
          <option value="solid">Solid (brand color)</option>
          <option value="ai_image">AI-generated image</option>
          <option value="ai_video">AI-generated video</option>
          <option value="stock_image">Stock photo</option>
          <option value="stock_video">Stock video</option>
        </select>
        {local.background === "stock_image" && (
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
              <ImageIcon className="w-3.5 h-3.5" />Pick image
            </Button>
          </div>
        )}
      </div>

      <ArrayField
        label="On-screen text"
        items={local.onScreenText ?? []}
        onAdd={() => updateArray("onScreenText", "add")}
        onRemove={(i) => updateArray("onScreenText", "remove", i)}
        onEdit={(i, v) => updateArray("onScreenText", "edit", i, v)}
      />

      <ArrayField
        label="Callouts"
        items={local.callouts ?? []}
        onAdd={() => updateArray("callouts", "add")}
        onRemove={(i) => updateArray("callouts", "remove", i)}
        onEdit={(i, v) => updateArray("callouts", "edit", i, v)}
      />

      <ImagePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(img) => {
          // For now we just store the URL in a free-form field; could
          // expand the visualSpec schema to hold image refs later.
          console.log("picked image", img);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function ArrayField({ label, items, onAdd, onRemove, onEdit }: { label: string; items: string[]; onAdd: () => void; onRemove: (i: number) => void; onEdit: (i: number, v: string) => void; }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label>{label} ({items.length})</Label>
        <Button size="sm" variant="secondary" onClick={onAdd}>
          <Plus className="w-3 h-3" />Add
        </Button>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-xs text-[var(--color-muted)]">None yet.</p>}
        {items.map((t, i) => (
          <div key={i} className="flex gap-2">
            <Input value={t} onChange={(e) => onEdit(i, e.target.value)} placeholder={`${label} ${i + 1}`} />
            <button
              className="text-[var(--color-accent-2)] hover:opacity-80 p-2"
              onClick={() => onRemove(i)}
            ><Trash2 className="w-3 h-3" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
