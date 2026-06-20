/**
 * Centralized env access. Fail fast on missing required vars; provide typed
 * defaults for everything else. Read from process.env (dotenv loads .env at
 * the repo root via apps/api/src/index.ts).
 */

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function optional(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function optionalNumber(key: string, defaultValue: number): number {
  const v = process.env[key];
  if (!v) return defaultValue;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env var ${key} is not a number: "${v}"`);
  return n;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  REDIS_URL: optional("REDIS_URL", "redis://localhost:6379"),

  API_PORT: optionalNumber("API_PORT", 3001),
  LOG_LEVEL: optional("LOG_LEVEL", "info"),

  S3_ENDPOINT: optional("S3_ENDPOINT", "http://localhost:9000"),
  S3_REGION: optional("S3_REGION", "us-east-1"),
  S3_BUCKET: optional("S3_BUCKET", "learning-platform-dev"),
  S3_ACCESS_KEY: optional("S3_ACCESS_KEY", "lp_dev"),
  S3_SECRET_KEY: optional("S3_SECRET_KEY", "lp_dev_password_minio"),
  S3_FORCE_PATH_STYLE: optional("S3_FORCE_PATH_STYLE", "true") === "true",

  VLLM_BASE_URL: optional("VLLM_BASE_URL", ""),
  VLLM_API_KEY: optional("VLLM_API_KEY", "vllm-local"),
  OPENAI_API_KEY: optional("OPENAI_API_KEY", ""),
  DEEPSEEK_API_KEY: optional("DEEPSEEK_API_KEY", ""),

  XTTS_BASE_URL: optional("XTTS_BASE_URL", "http://localhost:8001"),
  VLM_BASE_URL: optional("VLM_BASE_URL", ""),
};
