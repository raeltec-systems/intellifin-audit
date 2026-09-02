- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Add a CI check that `max(schema_meta.version)` after `pnpm db:migrate` equals the generation this build declares, so a migration that forgets its version insert fails the pull request.
  evidence: `0001_worker_heartbeat.sql` hand-inserts `version = 1`; nothing enforces that later migrations do the same, and `readSchemaVersion` uses `max(version)`.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Give the worker heartbeat a consumer: a staleness threshold surfaced on the Administration diagnostics surface and a Railway restart policy tied to it.
  evidence: The worker writes `seen_at` every 30 seconds but no route, test, or alert reads it; Story 9.2 (diagnostics) is the natural home.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Wire Playwright: a `test:e2e` script, a config under `tests/e2e`, and a CI step, once the first UI story (1.4) exists.
  evidence: `@playwright/test` is pinned at the root with no config, script, or CI step; `tests/e2e` holds only a `.gitkeep`.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Resolved 2026-09-02: the root now pins `typescript@7.0.2`; dependency-cruiser only warns and still cruises every module. Remove the `missing-typescript-transpiler` warning when dependency-cruiser ships TypeScript 7 support.
  evidence: Verified by planting type-only and `.tsx` vendor imports; both were reported with the root on 7.0.2.
