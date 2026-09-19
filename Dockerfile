# syntax=docker/dockerfile:1

# Multi-stage build for the Boss research assistant.
#
# Produces a small runtime image from Next.js standalone output. Works on any
# container host (Tencent Cloud, Alibaba Cloud, a plain VM, Fly/Render/Railway),
# so the deployment target does not have to be chosen in advance.

# ---------------------------------------------------------------------------
# deps — resolve the dependency graph once, reproducibly
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
# pnpm-workspace.yaml carries the nodeLinker and allowBuilds settings, so it
# must be present or the install silently uses pnpm defaults instead.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder — compile the application and emit .next/standalone
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---------------------------------------------------------------------------
# runner — minimal runtime, no package manager or build toolchain
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Standalone server.js reads HOSTNAME; 0.0.0.0 is required inside a container.
ENV HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# The standalone bundle already contains the traced subset of node_modules,
# plus examples/**/*.json via outputFileTracingIncludes in next.config.mjs.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets are NOT part of the file trace and must be copied explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# Server-side secrets stay out of the image and are injected at run time:
#   docker run -e BOSS_GENERATOR=mock -e BOSS_API_KEY=... -p 3000:3000 boss
CMD ["node", "server.js"]
