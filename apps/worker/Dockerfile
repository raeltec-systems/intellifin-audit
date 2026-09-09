# syntax=docker/dockerfile:1
#
# AD-11: worker ships as its own container, built from this one repository.
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
RUN pnpm install --frozen-lockfile

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm --filter "./packages/**" build
RUN pnpm --filter @intellifin/worker build
# Drop dev dependencies so the runtime layer carries only what the worker runs on.
RUN pnpm --filter @intellifin/worker --prod deploy --legacy /out

# ---- runtime ----------------------------------------------------------------
FROM node:24.20.0-bookworm-slim AS runtime
# `PLAYWRIGHT_BROWSERS_PATH` must be set for BOTH the install below and the running
# process, or the browser is downloaded to root's home and the worker looks somewhere
# else for it. One variable, declared once, read by both.
ENV NODE_ENV=production SERVICE_NAME=worker PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs worker

COPY --from=build --chown=worker:nodejs /out ./

# The Agent Workspace's LOCAL mode launches a browser inside this container
# (`chromium.launch()` in `packages/infrastructure/src/runs/browser-execution.ts`), so
# without one every agent-driven Run fails at workspace provisioning. Solari mode
# connects to a remote browser and needs none of this; the image carries it because the
# deployment chooses the mode at boot, and an image that only worked in one of them
# would make the choice a deployment trap rather than a configuration switch.
#
# `chromium-headless-shell`, NOT the full `chromium` build. `browser-execution.ts`
# passes no `headless` option, so Playwright's default (headless) applies, and the
# headless shell is what that default launches. Verified rather than assumed: with only
# the shell present, `chromium.launch()`, `newContext()` and `page.screenshot()` all
# succeed. The full build is 389 MB against the shell's 262 MB, so this is the whole
# browser the code can reach and none of the browser it cannot. `install-deps` still
# names `chromium`, because the system libraries are shared and Playwright resolves the
# correct set for this distribution itself rather than us pinning an apt list that goes
# stale with the next browser revision.
#
# If a later change ever passes `headless: false` or selects a channel, this image stops
# being enough. The `images` CI job launches a browser through the real code path inside
# the built image, so that regression fails there rather than in a Run.
#
# The path is resolved rather than written out: `playwright-core` is a transitive
# dependency reached through `@intellifin/infrastructure`, so under pnpm it sits in a
# `.pnpm/playwright-core@<version>/` directory whose name changes with every upgrade.
# `ffmpeg` is removed because it exists only to encode video, and nothing here records any.
RUN PW_CLI="$(node -e "const path=require('path'), fs=require('fs'); const inf=fs.realpathSync('node_modules/@intellifin/infrastructure'); const pkg=require.resolve('playwright-core/package.json',{paths:[inf]}); process.stdout.write(path.join(path.dirname(pkg),'cli.js'));")" \
 && echo "playwright-core CLI: ${PW_CLI}" \
 && node "${PW_CLI}" install-deps chromium \
 && node "${PW_CLI}" install chromium-headless-shell \
 && rm -rf "${PLAYWRIGHT_BROWSERS_PATH}"/ffmpeg-* \
 && chmod -R a+rX "${PLAYWRIGHT_BROWSERS_PATH}" \
 && rm -rf /var/lib/apt/lists/*

USER worker
CMD ["node", "dist/main.js"]
