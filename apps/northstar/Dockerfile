# syntax=docker/dockerfile:1
#
# The synthetic Northstar systems (Story 1.8), as their own container.
#
# It has NO database, no credential and no configuration beyond a port. That is the
# point: these stand in for somebody else's systems, and the less this process is, the
# less of it can go wrong while a Run is being observed. It is also read-only at the
# system level (FR-3) — every method but GET and HEAD is refused above routing — so
# exposing it publicly gives an attacker a copy of data that is synthetic by
# construction and no way to change it.

FROM node:24.20.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /repo

# ---- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/northstar/package.json apps/northstar/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/domain/package.json packages/domain/
COPY packages/application/package.json packages/application/
COPY packages/infrastructure/package.json packages/infrastructure/
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter @intellifin/northstar build
RUN pnpm --filter @intellifin/northstar --prod deploy --legacy /out

# ---- runtime ----------------------------------------------------------------
FROM node:24.20.0-bookworm-slim AS runtime
ENV NODE_ENV=production SERVICE_NAME=northstar
# The fixtures live OUTSIDE the package, so `pnpm deploy` does not carry them. They are
# copied explicitly and named explicitly: without this the process starts, walks up for
# `fixtures/northstar`, finds nothing, and dies with a path error instead of serving.
ENV NORTHSTAR_FIXTURES_DIR=/app/fixtures/northstar
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs northstar

COPY --from=build --chown=northstar:nodejs /out ./
# Read-only to the process that serves them: a synthetic system cannot be edited by the
# Run that reads it, and nothing in this image has a reason to write here.
COPY --from=build --chown=root:root /repo/fixtures/northstar ./fixtures/northstar

USER northstar
CMD ["node", "dist/main.js"]
