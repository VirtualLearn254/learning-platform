/**
 * Hermes — the local evolution loop (replaces the remote-RPC stub).
 *
 * A run gathers the recent evidence trail:
 *   • human feedback (beat_feedback: revise/reject reasons)
 *   • AI-review issues attached to beats
 *   • animated-fallback reasons from render jobs
 * …asks the holistic profile to distill RECURRING problems into concrete,
 * durable pipeline rules, and inserts them as PENDING (active=false) rows.
 * Nothing self-activates: the operator approves each rule in Settings.
 *
 * This is the institutional-memory engine: a correction that keeps
 * happening becomes a proposed rule; an approved rule reshapes every
 * future prompt.
 */

import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, tables } from "../db/index.js";
import { getAIClient } from "./ai_client.js";
import { invalidateRulesCache } from "./rules.js";

const ProposalSchema = z.object({
  proposals: z.array(z.object({
    scope: z.enum(["author", "designer", "reviewer", "ingest"]),
    rule: z.string().min(10).max(500),
    evidence: z.string().max(300),
  })).max(8),
});

export async function runEvolution(opts: { beatLimit?: number } = {}): Promise<{ runId: string }> {
  const [run] = await db.insert(tables.hermesRuns).values({ status: "running" }).returning();
  const runId = run!.id;

  // Fire-and-forget: the analysis takes ~30-60s; the caller gets the run id
  // immediately and watches status via GET /hermes/runs.
  void (async () => {
    try {
      const limit = opts.beatLimit ?? 50;

      const feedback = await db.select().from(tables.beatFeedback)
        .orderBy(desc(tables.beatFeedback.createdAt)).limit(limit);

      const reviewedBeats = await db.select().from(tables.beats)
        .where(sql`${tables.beats.reviewIssues} is not null`)
        .orderBy(desc(tables.beats.reviewedAt)).limit(limit);

      const fallbackJobs = await db.select().from(tables.jobs)
        .where(sql`${tables.jobs.errorMessage} like 'animated fallback:%'`)
        .orderBy(desc(tables.jobs.createdAt)).limit(20);

      const evidence = [
        "## Human feedback (revise/reject reasons)",
        ...feedback.filter((f) => f.action !== "approve").slice(0, 30)
          .map((f) => `- [${f.action}] ${f.feedback.slice(0, 200)}`),
        "",
        "## AI-review issues (recent beats)",
        ...reviewedBeats.slice(0, 30).flatMap((b) =>
          ((b.reviewIssues ?? []) as Array<{ severity: string; category: string; description: string }>)
            .slice(0, 3).map((i) => `- [${i.severity}/${i.category}] ${i.description.slice(0, 150)}`)),
        "",
        "## Animated-render fallbacks (design pipeline failures)",
        ...fallbackJobs.map((j) => `- ${(j.errorMessage ?? "").slice(0, 180)}`),
      ].join("\n");

      const beatsReviewed = feedback.length + reviewedBeats.length;

      const client = await getAIClient();
      const res = await client.chat("holistic", {
        messages: [
          { role: "system", content: `You analyze quality evidence from an AI video-course pipeline and distill RECURRING problems into durable operator rules. Each rule is appended verbatim to one AI role's prompt forever, so:
- Only propose a rule when the same problem appears 2+ times in the evidence.
- Rules must be concrete and actionable ("Always X", "Never Y"), one sentence, no vague advice.
- scope: author (narration/pedagogy), designer (visual composition), reviewer (scoring criteria), ingest (course structure).
- Fewer, sharper rules beat many weak ones. Zero proposals is a valid answer.

Reply with ONLY JSON: {"proposals":[{"scope":"...","rule":"...","evidence":"one-line why"}]}` },
          { role: "user", content: evidence.slice(0, 24_000) },
        ],
      });

      let proposals: z.infer<typeof ProposalSchema>["proposals"] = [];
      const jsonMatch = res.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = ProposalSchema.safeParse(JSON.parse(jsonMatch[0]));
        if (parsed.success) proposals = parsed.data.proposals;
      }

      // Skip proposals that duplicate existing rules (naive text overlap).
      const existing = await db.select().from(tables.pipelineRules);
      const fresh = proposals.filter((p) =>
        !existing.some((e) => e.scope === p.scope && similar(e.rule, p.rule)));

      for (const p of fresh) {
        await db.insert(tables.pipelineRules).values({
          scope: p.scope,
          rule: p.rule,
          origin: `hermes (${p.evidence.slice(0, 120)})`,
          active: false, // pending operator approval
        });
      }
      invalidateRulesCache();

      await db.update(tables.hermesRuns).set({
        status: "succeeded",
        completedAt: new Date(),
        beatsReviewed,
        rulesProposed: fresh.length,
        notes: fresh.length
          ? `Proposed ${fresh.length} rule(s) — approve or dismiss in Settings → Pipeline rules.`
          : "No recurring problems worth a rule this run.",
      }).where(eq(tables.hermesRuns.id, runId));
      console.log(`[hermes] run ${runId} done: ${fresh.length} proposals from ${beatsReviewed} evidence items`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[hermes] run ${runId} failed:`, msg);
      await db.update(tables.hermesRuns).set({
        status: "failed", completedAt: new Date(), notes: msg.slice(0, 500),
      }).where(eq(tables.hermesRuns.id, runId)).catch(() => {});
    }
  })();

  return { runId };
}

/** Crude near-duplicate check: normalized token overlap > 70%. */
function similar(a: string, b: string): boolean {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap++;
  return overlap / Math.min(ta.size, tb.size) > 0.7;
}

export async function listRuns(limit = 10) {
  return db.select().from(tables.hermesRuns)
    .orderBy(desc(tables.hermesRuns.startedAt)).limit(limit);
}
