/**
 * Visual device library (LP-20) — named, proven teaching visualizations the
 * designer composes from and the author references by name.
 *
 * Philosophy (settled by the freestyle-vs-palette A/B on the ledger beat):
 * this is a PALETTE, not a menu. Each device is a reliability floor — precise
 * guarantees that eliminate the failure modes we've actually shipped
 * (overlaps, crops, unfinished timelines) — while the designer keeps full
 * creative authority over arrangement, styling and pacing, and may extend or
 * invent beyond the palette when the narration demands it.
 *
 * Growth rule: when a freestyle render produces a device worth keeping, it is
 * distilled into this file with its guarantees made explicit. The library
 * accumulates; it is never "finished".
 */

export interface VisualDevice {
  id: string;
  /** One-line summary shown to the AUTHOR when choosing devices for a beat. */
  teaches: string;
  /** Full specification injected into the DESIGNER prompt: what the device is
   *  and the guarantees that must hold. Written as direct instructions. */
  spec: string;
}

export const VISUAL_DEVICES: readonly VisualDevice[] = [
  {
    id: "running-ledger",
    teaches: "A table of transactions/events revealed row-by-row in narration sync — for any 'watch it accumulate step by step' sequence.",
    spec: "running-ledger: a strict-grid table whose columns fit the content (e.g. DAY | TRANSACTION | amounts). Rows reveal ONE at a time, each in sync with the narration moment that describes it. On reveal, changed cells count up and flash the accent; untouched cells stay muted. If totals matter, a RUNNING BALANCE row updates after each reveal. Numbers right-aligned; columns never overlap; the table never exceeds the safe area.",
  },
  {
    id: "balance-equation-bar",
    teaches: "A persistent equation footer (A = B + C as live amount cards) that updates as events land — the through-line for any invariant that must visibly hold.",
    spec: "balance-equation-bar: a persistent footer of amount cards joined by = and + glyphs (e.g. ASSETS = LIABILITIES + EQUITY). It stays on screen for the whole beat. When an event lands elsewhere on screen, the affected card counts to its new value; when the invariant holds, pulse a small badge (e.g. BALANCED) once — do not leave it animating. Cards large enough to read on a phone; this bar is the beat's through-line, never covered by other elements.",
  },
  {
    id: "delta-chip",
    teaches: "A small +/- amount chip that flies from the event to the total it changes — makes 'this number moved because of that event' physical.",
    spec: "delta-chip: a small chip showing a signed amount (e.g. +150,000) that appears at the element being narrated and flies along a visible arc into the total/card it affects, which then updates. ONE chip in flight at a time; the chip is removed on arrival (never left floating); flight duration 0.6-1.0s.",
  },
  {
    id: "flow-from-sources",
    teaches: "Pipes/streams from 2-3 labeled sources filling one labeled reservoir — for 'everything here came from exactly these places' arguments.",
    spec: "flow-from-sources: 2-3 labeled source nodes with visible channels flowing into one labeled reservoir/tank. Flow animates source-by-source in narration order; the reservoir's fill level (or total) visibly equals the sum of what flowed in. Sources remain labeled throughout; no other inflows exist visually — the point IS that these are the only sources.",
  },
  {
    id: "split-mirror",
    teaches: "One object shown with a center divider labeling its two faces/readings — for 'the same thing counted/read two ways' ideas.",
    spec: "split-mirror: one central object (a stack, a document, a total) with a divider line; each side carries its own label and reading of the SAME object (e.g. 'what we have' / 'who funded it'). The two sides enter sequentially, then a connecting glyph (=) lands between the labels. The object itself must read as single and shared — not two objects side by side.",
  },
  {
    id: "myth-truth-panels",
    teaches: "Two panels — a struck-through misconception vs the affirmed truth — for 'almost everyone gets this wrong' beats.",
    spec: "myth-truth-panels: two side-by-side panels. Left: the misconception, labeled (e.g. MYTH), which gets struck through / visually rejected AT the narration moment that debunks it — not before. Right: the correct statement, labeled (e.g. TRUTH), affirmed with an accent after the strike-through. Panels never overlap; text in both stays fully readable after the animation settles.",
  },
  {
    id: "count-up-stat",
    teaches: "One dominant number counting to its value with a one-line caption — for the single-figure moment a beat pivots on.",
    spec: "count-up-stat: one number, the largest element on screen, counting from 0 (or its prior value) to the target over 0.8-1.5s, with a one-line caption beneath. At most ONE count-up-stat dominant at a time; the final value must be exactly the narrated figure and remain on screen through the phrase that cites it.",
  },
  {
    id: "settle-check",
    teaches: "The mandatory final state: everything at rest with the beat's key result visible — every beat's landing.",
    spec: "settle-check: the final phase. ALL motion at rest at least 1s before the audio ends. The beat's key result (the total, the equation, the takeaway line) fully visible and correct; one accent affirmation mark (check/underline/pulse-once) may land as the last motion. Nothing mid-animation, nothing cropped, nothing overlapping in the final frame.",
  },
] as const;

const byId = new Map(VISUAL_DEVICES.map((d) => [d.id, d]));

/** Resolve requested device ids to known devices, dropping unknowns. */
export function resolveDevices(ids: string[] | undefined): VisualDevice[] {
  if (!ids?.length) return [];
  return ids.map((id) => byId.get(id.trim())).filter((d): d is VisualDevice => !!d);
}

/** Catalog block for the AUTHOR prompt — device names + when to use them. */
export function deviceCatalogForAuthor(): string {
  return VISUAL_DEVICES.map((d) => `- ${d.id}: ${d.teaches}`).join("\n");
}

/**
 * Palette block for the DESIGNER prompt. Includes the timeline contract with
 * concrete phase spans — the A/B test proved that without explicit spans the
 * designer fixates on the devices and under-builds the timeline.
 */
export function devicePaletteBlock(devices: VisualDevice[], audioDurationSec: number): string {
  if (!devices.length) return "";
  const dur = audioDurationSec;
  const entranceEnd = Math.min(8, dur * 0.18).toFixed(1);
  const settleStart = Math.max(dur - 8, dur * 0.8).toFixed(1);
  const settleBy = Math.max(1, dur - 1).toFixed(1);
  return `
## DEVICE PALETTE (compose from these — creative freedom in arrangement, styling and pacing; extend or add your own elements when the narration demands, but every guarantee below MUST hold)

${devices.map((d) => `- ${d.spec}`).join("\n")}

Composition rules:
- One dominant device per phase; supporting devices stay subordinate.
- TIMELINE CONTRACT (critical — devices are NOT an excuse for a short timeline): phases must span the FULL ${dur.toFixed(1)}s narration. Entrance ~0-${entranceEnd}s establishes the empty/initial state; the hero section carries the narration's main sequence with reveals synced to the spoken moments; settle ~${settleStart}s onward, all motion at rest by ${settleBy}s.
- 15% safe margins; no text overlaps ever; colors only from the skeleton's CSS variables.`;
}
