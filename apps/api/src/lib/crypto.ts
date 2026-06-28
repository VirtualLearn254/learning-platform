/**
 * AES-256-GCM symmetric encryption for app secrets.
 *
 * The master key (LP_SECRETS_KEY) is a 64-char hex string (32 bytes).
 * The bootstrap script generates one on first run and warns the operator
 * to back it up — losing it makes every stored secret unrecoverable.
 *
 * GCM gives us authenticated encryption: the auth tag detects tampering.
 * IV is random per encryption (12 bytes, the AEAD-friendly size).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

export interface EncryptedSecret {
  ciphertextB64: string;
  ivB64: string;
  authTagB64: string;
}

export function getMasterKey(): Buffer | null {
  const hex = process.env.LP_SECRETS_KEY;
  if (!hex) return null;
  if (hex.length !== 64) {
    throw new Error(`LP_SECRETS_KEY must be 64 hex chars (32 bytes). Got ${hex.length} chars.`);
  }
  return Buffer.from(hex, "hex");
}

/** Generate a fresh random master key (for bootstrap / dev seeding). */
export function generateMasterKey(): string {
  return randomBytes(32).toString("hex");
}

export function encrypt(plaintext: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertextB64: ciphertext.toString("base64"),
    ivB64: iv.toString("base64"),
    authTagB64: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(enc: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(enc.ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(enc.authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
