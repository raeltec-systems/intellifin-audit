# syntax=docker/dockerfile:1
#
# AD-11: web ships as its own container, built from this one repository.
# AD-15: this image contains no migration step. The release workflow alone migrates;
# the process refuses to start outside its supported schema range.

FROM node:24.20.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

# ---- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/infrastructure/package.json packages/infrastructure/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter "./packages/**" build
RUN pnpm --filter @intellifin/web build

# ---- runtime ----------------------------------------------------------------
FROM node:24.20.0-bookworm-slim AS runtime
ENV NODE_ENV=production SERVICE_NAME=web PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Next.js standalone output already contains the traced node_modules it needs.
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
