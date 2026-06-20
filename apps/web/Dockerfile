# Multi-stage build for the Next.js web app.
# Uses Next's "standalone" output → small, no node_modules copy.

# ── Stage 1: build ────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

# Install all deps (workspace-aware)
RUN npm ci --omit=optional || npm install

# Copy source
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build Next.js to standalone output
WORKDIR /app/apps/web
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup -g 1001 -S app && adduser -S app -u 1001
USER app

# Copy the standalone output (includes minimal node_modules)
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
