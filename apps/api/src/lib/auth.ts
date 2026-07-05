/**
 * Session auth for the admin API. Single shared password (LP_ADMIN_PASSWORD)
 * → HMAC-signed expiring session token, carried as an httpOnly cookie.
 *
 * Why cookie and not just bearer: <video>/<img> tags and EventSource cannot
 * attach Authorization headers, and the UI leans on all three (media
 * playback, thumbnails, live job stream). Cookies ride along automatically.
 * Bearer <token> is also accepted for programmatic/CLI access.
 *
 * Tokens are stateless: `<expiryMs>.<hmac(expiryMs, LP_SECRETS_KEY)>`.
 * No session table, no revocation list — rotating LP_SECRETS_KEY invalidates
 * everything, which is the right blast radius for a single-operator tool.
 *
 * If LP_ADMIN_PASSWORD is unset, auth is DISABLED (dev mode) with a loud
 * startup warning — local development keeps working with zero setup.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function signingKey(): string | null {
  return process.env.LP_SECRETS_KEY ?? null;
}

export function authEnabled(): boolean {
  return Boolean(process.env.LP_ADMIN_PASSWORD && signingKey());
}

export function checkPassword(candidate: string): boolean {
  const expected = process.env.LP_ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hmac(payload: string): string {
  return createHmac("sha256", signingKey() ?? "").update(payload).digest("base64url");
}

export function issueSessionToken(): string {
  const expiry = String(Date.now() + SESSION_TTL_MS);
  return `${expiry}.${hmac(expiry)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiry = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(expiry);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(expiry) > Date.now();
}
