/**
 * LTI 1.1 tool provider — the "publish directly into the LMS" path.
 *
 * The LMS (Moodle "External tool", Canvas, Blackboard…) is configured once
 * with our launch URL + consumer key/secret. Launch = a signed OAuth 1.0a
 * form POST; we verify the HMAC-SHA1 signature, note the grade-passback
 * coordinates (lis_result_sourcedid + outcome service URL), and hand the
 * learner our hosted lesson player. When the player reports the attempt,
 * we POST the score back to the LMS gradebook (LTI Basic Outcomes POX).
 *
 * Credentials come from env: LTI_CONSUMER_KEY / LTI_CONSUMER_SECRET.
 */

import { createHmac, createHash, randomBytes } from "node:crypto";

/** RFC 5849 percent-encoding (stricter than encodeURIComponent). */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function signatureBaseString(method: string, url: string, params: Record<string, string>): string {
  const pairs = Object.entries(params)
    .filter(([k]) => k !== "oauth_signature")
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  return `${method.toUpperCase()}&${enc(url)}&${enc(paramString)}`;
}

function hmacSha1(base: string, secret: string): string {
  return createHmac("sha1", `${enc(secret)}&`).update(base).digest("base64");
}

/** Verify an LTI 1.1 launch (OAuth 1.0a body-signed form POST). `url` is the
 *  EXACT public URL the LMS posted to; per OAuth 1.0a its query parameters
 *  join the signed parameter set and the base-string URI excludes the query. */
export function verifyLtiLaunch(url: string, params: Record<string, string>, consumerSecret: string): { ok: boolean; reason?: string } {
  if (params.lti_message_type !== "basic-lti-launch-request") return { ok: false, reason: "not a launch request" };
  if (params.oauth_signature_method !== "HMAC-SHA1") return { ok: false, reason: "unsupported signature method" };
  const ts = Number(params.oauth_timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return { ok: false, reason: "stale timestamp" };
  const [baseUrl, query = ""] = url.split("?");
  const all: Record<string, string> = { ...params };
  for (const [k, v] of new URLSearchParams(query)) all[k] = v;
  const expected = hmacSha1(signatureBaseString("POST", baseUrl!, all), consumerSecret);
  return expected === params.oauth_signature ? { ok: true } : { ok: false, reason: "bad signature" };
}

/** POST a score (0..1) back to the LMS gradebook via LTI Basic Outcomes. */
export async function sendLtiGrade(args: {
  outcomeUrl: string; sourcedid: string; score01: number;
  consumerKey: string; consumerSecret: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const messageId = randomBytes(16).toString("hex");
  const pox = `<?xml version="1.0" encoding="UTF-8"?>
<imsx_POXEnvelopeRequest xmlns="http://www.imsglobal.org/services/ltiv1p1/xsd/imsoms_v1p0">
  <imsx_POXHeader><imsx_POXRequestHeaderInfo>
    <imsx_version>V1.0</imsx_version><imsx_messageIdentifier>${messageId}</imsx_messageIdentifier>
  </imsx_POXRequestHeaderInfo></imsx_POXHeader>
  <imsx_POXBody><replaceResultRequest><resultRecord>
    <sourcedGUID><sourcedId>${args.sourcedid.replace(/[<&>]/g, "")}</sourcedId></sourcedGUID>
    <result><resultScore><language>en</language><textString>${args.score01.toFixed(4)}</textString></resultScore></result>
  </resultRecord></replaceResultRequest></imsx_POXBody>
</imsx_POXEnvelopeRequest>`;

  const bodyHash = createHash("sha1").update(pox).digest("base64");
  const oauth: Record<string, string> = {
    oauth_consumer_key: args.consumerKey,
    oauth_nonce: randomBytes(12).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    oauth_body_hash: bodyHash,
  };
  oauth.oauth_signature = hmacSha1(signatureBaseString("POST", args.outcomeUrl, oauth), args.consumerSecret);
  const authHeader = "OAuth " + Object.entries(oauth).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");

  const res = await fetch(args.outcomeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/xml", Authorization: authHeader },
    body: pox,
  });
  const body = await res.text().catch(() => "");
  const ok = res.ok && /imsx_codeMajor>\s*success/i.test(body);
  return { ok, status: res.status, body: body.slice(0, 300) };
}
