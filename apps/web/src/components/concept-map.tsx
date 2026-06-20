"use client";

import { useMemo } from "react";
import type { Beat } from "@lp/shared";

/**
 * A concept dependency map. Renders each concept as a node + arrows for
 * "concept X is taught by beat A, then required by beat B".
 *
 * Uses simple SVG geometry — no graph library. For ≤30 concepts this is
 * plenty; if we ever need force-directed layouts we'll bring in d3 or vis.
 */
export function ConceptMap({ beats }: { beats: Beat[] }) {
  const nodes = useMemo(() => buildNodes(beats), [beats]);

  if (nodes.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-[var(--color-muted)]">
        No concepts tagged yet. As beats are authored, the concept graph populates here.
      </div>
    );
  }

  const cellWidth = 240;
  const cellHeight = 80;
  const padding = 40;
  const cols = 3;
  const rows = Math.ceil(nodes.length / cols);
  const width = padding * 2 + cellWidth * cols;
  const height = padding * 2 + cellHeight * rows;

  function pos(idx: number) {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    return { x: padding + col * cellWidth + cellWidth / 2, y: padding + row * cellHeight + cellHeight / 2 };
  }

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="bg-[var(--color-bg)] rounded-xl">
        {/* Edges: concept taught by beat A → required by beat B */}
        {nodes.flatMap((from, i) =>
          from.requiredByIdx.map((j) => {
            const a = pos(i); const b = pos(j);
            return (
              <line
                key={`${i}-${j}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="#C76A4A" strokeWidth={1} strokeDasharray="4 4" opacity={0.5}
              />
            );
          }),
        )}
        {/* Nodes */}
        {nodes.map((n, i) => {
          const p = pos(i);
          return (
            <g key={n.concept} transform={`translate(${p.x}, ${p.y})`}>
              <rect
                x={-cellWidth / 2 + 8} y={-cellHeight / 2 + 8}
                width={cellWidth - 16} height={cellHeight - 16}
                fill="white"
                stroke="#0E7C66"
                strokeWidth={1}
                rx={8}
              />
              <text textAnchor="middle" y={-6} fontSize={13} fontWeight={600} fill="#1A1A1F">
                {n.concept.length > 28 ? n.concept.slice(0, 28) + "…" : n.concept}
              </text>
              <text textAnchor="middle" y={12} fontSize={10} fill="#6B6457">
                taught in {n.taughtBy.length} · req in {n.requiredByIdx.length}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function buildNodes(beats: Beat[]) {
  // Collect all unique concepts and where they appear.
  const conceptMap = new Map<string, { concept: string; taughtBy: string[]; requiredByIdx: number[] }>();
  for (const b of beats) {
    for (const c of b.conceptsTaught) {
      if (!conceptMap.has(c)) conceptMap.set(c, { concept: c, taughtBy: [], requiredByIdx: [] });
      conceptMap.get(c)!.taughtBy.push(b.beatKey);
    }
  }
  const concepts = [...conceptMap.values()];
  // Map "required" edges between concepts at the concept-graph level.
  // For each beat: every required concept depends on every taught concept (in this beat).
  for (const b of beats) {
    const taughtIdxs = b.conceptsTaught.map((c) => concepts.findIndex((n) => n.concept === c)).filter((i) => i >= 0);
    const requiredIdxs = b.conceptsRequired.map((c) => concepts.findIndex((n) => n.concept === c)).filter((i) => i >= 0);
    for (const t of taughtIdxs) {
      for (const r of requiredIdxs) {
        if (!concepts[r]?.requiredByIdx.includes(t)) concepts[r]?.requiredByIdx.push(t);
      }
    }
  }
  return concepts;
}
