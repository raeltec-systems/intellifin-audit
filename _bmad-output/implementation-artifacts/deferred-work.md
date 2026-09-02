- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Give the worker heartbeat a consumer: a staleness threshold surfaced on the Administration diagnostics surface and a Railway restart policy tied to it.
  evidence: The worker writes `seen_at` every 30 seconds but no route, test, or alert reads it; Story 9.2 (diagnostics) is the natural home.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Wire Playwright: a `test:e2e` script, a config under `tests/e2e`, and a CI step, once the first UI story (1.4) exists.
  evidence: `@playwright/test` is pinned at the root with no config, script, or CI step; `tests/e2e` holds only a `.gitkeep`.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Drop the root-only `typescript@6.0.3` pin once dependency-cruiser supports TypeScript 7; `scripts/check-boundaries.mjs` will fail loudly rather than silently if the pin is removed early.
  evidence: With TypeScript 7 at the root, dependency-cruiser 18.2.0 cruises zero modules and exits 0 (reproduced 2026-09-02 after a clean reinstall).
