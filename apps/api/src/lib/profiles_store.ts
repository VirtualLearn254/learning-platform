/**
 * Profile overrides store. Reads from ai_profile_overrides table.
 * Cached in-memory for 30 seconds to avoid hammering DB on every AI call;
 * cache is invalidated immediately on every write.
 */

import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { aiProfileOverrides } from "../db/schema.js";
import type { ProfileOverride, ProviderId } from "@lp/ai-provider";

const TTL_MS = 30_000;

let cache: { at: number; map: Map<string, ProfileOverride> } | null = null;

async function load(): Promise<Map<string, ProfileOverride>> {
  const rows = await db.select().from(aiProfileOverrides);
  const map = new Map<string, ProfileOverride>();
  for (const r of rows) {
    const o: ProfileOverride = {};
    if (r.preferredProvider) o.preferredProvider = r.preferredProvider as ProviderId;
    if (r.modelId) o.modelId = r.modelId;
    if (r.temperature) o.temperature = Number(r.temperature);
    if (r.maxTokens) o.maxTokens = r.maxTokens;
    map.set(r.profileId, o);
  }
  return map;
}

/** Force a fresh fetch next call. Call after writes. */
export function invalidateProfileOverrides(): void {
  cache = null;
}

export async function refreshOverrides(): Promise<void> {
  cache = { at: Date.now(), map: await load() };
}

/** Synchronous lookup for the AI client. Reads the cached map. */
export function getProfileOverride(profileId: string): ProfileOverride | undefined {
  return cache?.map.get(profileId);
}

/** Ensure the cache is fresh; refresh if expired or unset. */
export async function ensureFresh(): Promise<void> {
  if (!cache || Date.now() - cache.at > TTL_MS) await refreshOverrides();
}

export async function listProfileOverrides(): Promise<Record<string, ProfileOverride>> {
  await ensureFresh();
  return Object.fromEntries(cache!.map.entries());
}

export async function setProfileOverride(profileId: string, patch: ProfileOverride): Promise<void> {
  const now = new Date();
  await db.insert(aiProfileOverrides)
    .values({
      profileId,
      preferredProvider: patch.preferredProvider ?? null,
      modelId: patch.modelId ?? null,
      temperature: patch.temperature !== undefined ? String(patch.temperature) : null,
      maxTokens: patch.maxTokens ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: aiProfileOverrides.profileId,
      set: {
        preferredProvider: patch.preferredProvider ?? null,
        modelId: patch.modelId ?? null,
        temperature: patch.temperature !== undefined ? String(patch.temperature) : null,
        maxTokens: patch.maxTokens ?? null,
        updatedAt: now,
      },
    });
  invalidateProfileOverrides();
}

export async function deleteProfileOverride(profileId: string): Promise<void> {
  await db.delete(aiProfileOverrides).where(eq(aiProfileOverrides.profileId, profileId));
  invalidateProfileOverrides();
}
