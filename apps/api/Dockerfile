# API + workers Docker image. Runs tsx directly so we don't need a TS build
# step in the deploy pipeline — fast iteration, slightly slower cold start
# (~300ms extra), totally fine for an internal tool at this scale.

FROM node:22-alpine AS base
WORKDIR /app

# Need git for some npm transitive deps + curl for the healthcheck.
# chromium + ffmpeg are used by the render worker (Puppeteer + video assembly).
# ttf-freefont + font packages so the headless browser has system fonts.
RUN apk add --no-cache \
      git curl \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont font-noto \
      ffmpeg

# Tell puppeteer-core where the system chromium lives instead of downloading one.
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_DOWNLOAD=true

# ── Install workspace deps ────────────────────────────────────────────
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json           ./packages/shared/
COPY packages/ai-provider/package.json      ./packages/ai-provider/
COPY packages/render-engine/package.json    ./packages/render-engine/
COPY packages/scorm-packager/package.json   ./packages/scorm-packager/
COPY packages/scorm-player/package.json     ./packages/scorm-player/
COPY packages/image-search/package.json     ./packages/image-search/
COPY packages/notifications/package.json    ./packages/notifications/
COPY packages/pdf-generator/package.json    ./packages/pdf-generator/
COPY packages/lrs/package.json              ./packages/lrs/
COPY packages/hermes-bridge/package.json    ./packages/hermes-bridge/
COPY packages/concept-graph/package.json    ./packages/concept-graph/
COPY apps/api/package.json                  ./apps/api/

RUN npm ci --omit=optional || npm install

# ── Copy source ───────────────────────────────────────────────────────
COPY packages ./packages
COPY apps/api ./apps/api

ENV NODE_ENV=production

# Default entrypoint is the API server.
# Workers run as a separate compose service that overrides CMD.
EXPOSE 3001
CMD ["npx", "tsx", "apps/api/src/index.ts"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3001/health || exit 1
