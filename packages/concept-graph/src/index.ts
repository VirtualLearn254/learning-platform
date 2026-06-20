/**
 * @lp/concept-graph — tracks which concepts each beat teaches and which
 * concepts each beat depends on. Powers the "reference earlier concept"
 * callback feature: when authoring a later beat, the author script can ask
 * "which earlier beats taught my prerequisites?" and inject callback markers
 * with the correct timestamps.
 *
 * Storage: lives in beats.concepts_taught and beats.concepts_required JSONB
 * columns, plus an in-memory graph computed when needed. We don't materialize
 * the graph in Postgres — it's cheap to recompute from beats per course.
 */

import type { Beat } from "@lp/shared";

export interface ConceptNode {
  concept: string;
  /** Beats (in playback order) that teach this concept. */
  taughtBy: Array<{ beatId: string; beatKey: string; order: number; timestampSec: number }>;
  /** Beats that reference this concept as a prerequisite. */
  requiredBy: Array<{ beatId: string; beatKey: string; order: number }>;
}

export interface ConceptCallback {
  /** The current beat that mentions an earlier concept. */
  fromBeatId: string;
  /** The earlier beat that originally taught the concept. */
  toBeatId: string;
  toBeatKey: string;
  /** Timestamp in the master MP4 where the earlier teaching happens. */
  toTimestampSec: number;
  /** Human-readable concept label. */
  concept: string;
  /** Suggested narrator script for the callback: "Remember when we covered ..." */
  narratorLine: string;
}

export interface ConceptGraph {
  /** Build the graph from a list of beats (per course). */
  build(beats: Array<Beat & { startTimestampSec: number }>): Map<string, ConceptNode>;
  /** Find callbacks for a beat about to be authored. */
  findCallbacks(beat: Beat & { earlierBeats: Array<Beat & { startTimestampSec: number }> }): ConceptCallback[];
}

export function createConceptGraph(): ConceptGraph {
  return {
    build(beats) {
      const graph = new Map<string, ConceptNode>();
      for (const beat of beats) {
        for (const c of beat.conceptsTaught) {
          const node = graph.get(c) ?? { concept: c, taughtBy: [], requiredBy: [] };
          node.taughtBy.push({ beatId: beat.id, beatKey: beat.beatKey, order: beat.order, timestampSec: beat.startTimestampSec });
          graph.set(c, node);
        }
        for (const c of beat.conceptsRequired) {
          const node = graph.get(c) ?? { concept: c, taughtBy: [], requiredBy: [] };
          node.requiredBy.push({ beatId: beat.id, beatKey: beat.beatKey, order: beat.order });
          graph.set(c, node);
        }
      }
      return graph;
    },
    findCallbacks(beat) {
      const out: ConceptCallback[] = [];
      const earlierByConcept = new Map<string, Beat & { startTimestampSec: number }>();
      for (const earlier of beat.earlierBeats) {
        for (const c of earlier.conceptsTaught) {
          // Only record the EARLIEST occurrence per concept.
          if (!earlierByConcept.has(c)) earlierByConcept.set(c, earlier);
        }
      }
      for (const c of beat.conceptsRequired) {
        const earlier = earlierByConcept.get(c);
        if (!earlier) continue;
        out.push({
          fromBeatId: beat.id,
          toBeatId: earlier.id,
          toBeatKey: earlier.beatKey,
          toTimestampSec: earlier.startTimestampSec,
          concept: c,
          narratorLine: `Remember when we covered ${c}? Press the button below if you'd like a quick refresher.`,
        });
      }
      return out;
    },
  };
}
