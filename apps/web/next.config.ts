import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  /** Standalone output keeps the Docker image lean (~150 MB vs 800 MB). */
  output: "standalone",
  // Allow importing from the @lp/shared workspace package.
  transpilePackages: ["@lp/shared"],
  // Bypass TS / ESLint blocking the production build — surface those via
  // `npm run typecheck` / `npm run lint` in CI instead of at image build.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  /**
   * In dev we proxy /api/* to the backend so the browser doesn't see two
   * origins. In prod we'd point this at the deployed API URL via an env var.
   */
  async rewrites() {
    const apiBase = process.env.WEB_API_BASE_URL ?? "http://localhost:3001";
    return [
      { source: "/api/:path*", destination: `${apiBase}/:path*` },
    ];
  },
};

export default config;
