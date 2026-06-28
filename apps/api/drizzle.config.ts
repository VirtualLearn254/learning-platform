import { defineConfig } from "drizzle-kit";
import "dotenv/config";

/**
 * Build the DB URL from parts if not explicitly set — same logic the runtime
 * uses in apps/api/src/env.ts. Lets db:push work in containers that only
 * carry POSTGRES_PASSWORD via env_file.
 */
function resolveUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const pw   = process.env.POSTGRES_PASSWORD;
  const host = process.env.POSTGRES_HOST ?? "postgres";
  const port = process.env.POSTGRES_PORT ?? "5432";
  const user = process.env.POSTGRES_USER ?? "lp";
  const db   = process.env.POSTGRES_DB   ?? "learning_platform";
  if (pw) return `postgres://${user}:${pw}@${host}:${port}/${db}`;
  // Last-resort dev fallback for `npm run db:push` outside docker.
  return "postgres://lp:lp_dev_password@localhost:5432/learning_platform";
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: resolveUrl() },
  strict: true,
  verbose: true,
});
