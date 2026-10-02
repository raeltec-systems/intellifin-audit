- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Give the worker heartbeat a consumer: a staleness threshold surfaced on the Administration diagnostics surface and a Railway restart policy tied to it.
  evidence: The worker writes `seen_at` every 30 seconds but no route, test, or alert reads it; Story 9.2 (diagnostics) is the natural home.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Wire Playwright: a `test:e2e` script, a config under `tests/e2e`, and a CI step, once the first UI story (1.4) exists.
  evidence: `@playwright/test` is pinned at the root with no config, script, or CI step; `tests/e2e` holds only a `.gitkeep`.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-bootstrap-the-monorepo-and-deploy-web-and-worker.md`
  summary: Drop the root-only `typescript@6.0.3` pin once dependency-cruiser supports TypeScript 7; `scripts/check-boundaries.mjs` will fail loudly rather than silently if the pin is removed early.
  evidence: With TypeScript 7 at the root, dependency-cruiser 18.2.0 cruises zero modules and exits 0 (reproduced 2026-09-02 after a clean reinstall).

- source_spec: `_bmad-output/implementation-artifacts/spec-21-1-preserve-evidence-unicode-values.md`
  summary: Align evidence request validation for malformed UTF-16 wire strings in a focused follow-up.
  evidence: Pre-existing browser TextEncoder measurement substitutes isolated surrogates while retaining the input string; Rust JSON decoding refuses their escaped wire form. The U+FEFF repair changes neither behaviour. Add wire-level parity cases and client refusal without narrowing valid server values.

- source_spec: `_bmad-output/implementation-artifacts/spec-21-1-preserve-evidence-unicode-values.md`
  summary: Provide an accessible display description for evidence filenames composed entirely of invisible Unicode characters while preserving immutable metadata.
  evidence: Existing filename rendering can appear blank for accepted U+200B and similar strings; U+FEFF-only values expose the same display limitation after this repair. Raw metadata, identity and byte access now work, but a labelled display representation is a separate presentational follow-up.

- source_spec: `_bmad-output/implementation-artifacts/spec-20-6-admin-continuity-safeguard.md`
  summary: Consider scoped read-only identity activity or a continuity indicator in membership administration.
  evidence: The existing membership projection reports membership activity and expiry but does not expose application identity activity; an owner-deactivated identity can therefore retain a visibly active membership. The approved safeguard enforces the full predicate in the database, its refusal explicitly requires an active account, and operator preflight identifies invalid continuity. No identity-management UI or authority is added in this follow-up.

- source_spec: `_bmad-output/implementation-artifacts/spec-21-3-install-and-select-trusted-skills.md`
  summary: Existing Story21.2 unsent methodology edits are lost after a transient session-check outage unmounts the workspace; retain exact-session draft custody in a focused batch follow-up.
  evidence: `zobba/web/src/MethodologyWorkspace.tsx` keeps `draft`, recall reason and selected organisation only in component state, while `App.tsx:149–159` switches a failed session read to an unavailable view that unmounts it. `methodology.ts:265–276` retains only submitted uncertain actions. Independent source inspection confirmed this predates Story21.3; the existing browser recovery proof covers submitted delivery, not unsent edits.

- source_spec: `_bmad-output/implementation-artifacts/spec-21-4-remember-scoped-working-knowledge-with-its-basis.md`
  summary: Closed the Story 21.3 follow-up for unsent methodology edit and recall custody within this batch.
  evidence: Exact actor/session/organisation memory custody now survives actual session-check outage and App unmount. Recovery requires the workspace’s own fresh current-Admin read; replacement, denial, logout, cancellation and success clear private custody, without automatic submission. The previous component fails the intended restored-editor assertion; the repaired four-case browser invocation passes. See `zobba-foundation-batch/story-21.4/methodology-custody/README.md` and the final Story 21.4 verification record for manifests, negative-control restoration, independent review and combined coverage. The original discovery entry above is retained.
