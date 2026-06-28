/**
 * Secrets store — the single read/write surface for AI provider API keys.
 *
 * Read order:
 *   1. DB row (UI-managed, encrypted) — wins if present
 *   2. process.env — fallback for back-compat with the original env-file flow
 *
 * Write goes only to DB. The UI never writes to .env.
 */

import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { appSecrets } from "../db/schema.js";
import { encrypt, decrypt, getMasterKey, type EncryptedSecret } from "./crypto.js";

/** All UI-editable secret keys. The string IS the DB primary key. */
export const SECRET_NAMES = [
  "anthropic_api_key",
  "anthropic_base_url",
  "openai_api_key",
  "deepseek_api_key",
  "vllm_base_url",
  "vllm_api_key",
  "xtts_base_url",
  "vlm_base_url",
  "hermes_rpc_url",
  "telegram_bot_token",
  "telegram_chat_id",
  "unsplash_access_key",
  "pexels_api_key",
  "pixabay_api_key",
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

/** Map a SecretName to its env-var equivalent for the fallback read. */
const ENV_KEYS: Record<SecretName, string> = {
  anthropic_api_key:   "ANTHROPIC_API_KEY",
  anthropic_base_url:  "ANTHROPIC_BASE_URL",
  openai_api_key:      "OPENAI_API_KEY",
  deepseek_api_key:    "DEEPSEEK_API_KEY",
  vllm_base_url:       "VLLM_BASE_URL",
  vllm_api_key:        "VLLM_API_KEY",
  xtts_base_url:       "XTTS_BASE_URL",
  vlm_base_url:        "VLM_BASE_URL",
  hermes_rpc_url:      "HERMES_RPC_URL",
  telegram_bot_token:  "TELEGRAM_BOT_TOKEN",
  telegram_chat_id:    "TELEGRAM_CHAT_ID",
  unsplash_access_key: "UNSPLASH_ACCESS_KEY",
  pexels_api_key:      "PEXELS_API_KEY",
  pixabay_api_key:     "PIXABAY_API_KEY",
};

export interface SecretStatus {
  name: SecretName;
  configured: boolean;
  /** "db" if managed via UI; "env" if coming from .env.prod; null if unset. */
  source: "db" | "env" | null;
  /** Last 4 chars (DB only — env never shows the value). */
  lastFour: string | null;
  /** When the UI last saved it (DB only). */
  updatedAt: string | null;
}

/** Get one secret's plaintext value, preferring DB over env. */
export async function getSecret(name: SecretName): Promise<string | null> {
  const key = getMasterKey();
  if (key) {
    const rows = await db.select().from(appSecrets).where(eq(appSecrets.name, name)).limit(1);
    const row = rows[0];
    if (row) {
      return decrypt(
        { ciphertextB64: row.ciphertextB64, ivB64: row.ivB64, authTagB64: row.authTagB64 },
        key,
      );
    }
  }
  return process.env[ENV_KEYS[name]] || null;
}

/** Status (no plaintext) for every known secret. Used by the Settings UI. */
export async function listSecretStatuses(): Promise<SecretStatus[]> {
  const key = getMasterKey();
  let dbRows: Array<typeof appSecrets.$inferSelect> = [];
  if (key) dbRows = await db.select().from(appSecrets);
  const dbByName = new Map(dbRows.map((r) => [r.name, r]));

  return SECRET_NAMES.map((name) => {
    const dbRow = dbByName.get(name);
    if (dbRow) {
      return {
        name,
        configured: true,
        source: "db" as const,
        lastFour: dbRow.lastFour,
        updatedAt: dbRow.updatedAt.toISOString(),
      };
    }
    const envValue = process.env[ENV_KEYS[name]];
    if (envValue) {
      return { name, configured: true, source: "env" as const, lastFour: null, updatedAt: null };
    }
    return { name, configured: false, source: null, lastFour: null, updatedAt: null };
  });
}

/** Save / update a secret. Returns its new status. */
export async function setSecret(name: SecretName, plaintext: string): Promise<SecretStatus> {
  const key = getMasterKey();
  if (!key) throw new SecretsKeyMissingError();
  if (!plaintext.trim()) throw new Error(`Cannot save empty secret for ${name}`);

  const enc: EncryptedSecret = encrypt(plaintext, key);
  const lastFour = plaintext.slice(-4);
  const now = new Date();

  await db.insert(appSecrets)
    .values({
      name,
      ciphertextB64: enc.ciphertextB64,
      ivB64: enc.ivB64,
      authTagB64: enc.authTagB64,
      lastFour,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSecrets.name,
      set: {
        ciphertextB64: enc.ciphertextB64,
        ivB64: enc.ivB64,
        authTagB64: enc.authTagB64,
        lastFour,
        updatedAt: now,
      },
    });

  return { name, configured: true, source: "db", lastFour, updatedAt: now.toISOString() };
}

/** Remove a stored secret. After this, the env fallback kicks back in. */
export async function deleteSecret(name: SecretName): Promise<void> {
  await db.delete(appSecrets).where(eq(appSecrets.name, name));
}

export class SecretsKeyMissingError extends Error {
  constructor() {
    super(
      "LP_SECRETS_KEY is not set in the API environment. " +
      "Set it in .env.prod (the bootstrap script will generate one on next run), " +
      "or fall back to setting individual API keys directly as env vars.",
    );
    this.name = "SecretsKeyMissingError";
  }
}
