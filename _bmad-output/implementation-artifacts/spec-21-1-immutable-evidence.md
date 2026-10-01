---
title: '21.1 — Acquire and inspect immutable scoped evidence'
type: feature
created: '2026-10-01'
status: ready-for-dev
story_key: 21-1-acquire-and-inspect-immutable-scoped-evidence
review_loop_iteration: 0
authorization: 'Owner approved the next dependency-ready batch and routine engineering/specification choices.'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/story-21-1-integration-contract.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="owner-authorised canonical Story 21.1">

## Intent

**Problem:** Working material has no owned evidence registry or verified, inspectable originals.

**Approach:** Reserve immutable engagement evidence, conditionally upload, independently read back and register it; inspect provenance and bounded previews beside the continuing conversation.

## Boundaries & Constraints

**Always:** Current actor/session/scope at registration and disclosure; server-owned immutable identity and attributable custody. Distinguish source assertions from verification. Retain Task selection/guidance; evidence and work products remain distinct.

**Ask First:** Paid infrastructure, live connector credentials, customer data or deployment.

**Never:** Arbitrary keys/URL fetching, overwrites, registration before verification, edited published migrations, parser execution, active HTML/SVG previews, public/presigned downloads, or treating byte identity as proof of truth/completeness.

## I/O & Edge-Case Matrix

| Scenario | Input | Result / failure |
|---|---|---|
| Acquire | Current scoped reservation and matching bytes | Register only after measured read-back; otherwise incomplete and unavailable as evidence |
| Retry | Lost reserve/upload/register acknowledgement | Reconcile the same immutable object and exact result; never overwrite |
| Substitute | Partial bytes or size/hash/version mismatch | No registration or disclosure |
| Authority | Foreign scope, revocation or replaced session | No old-audience metadata, bytes or draft; recheck after I/O |
| Inspect | Text or unsupported original | Inert bounded preview or explicit download-only state, safe headers and filename |

</frozen-after-approval>

## Code Map

- `zobba/crates/infrastructure/src/{identity,scope}.rs`, `zobba/crates/api/src/auth.rs` — current authority and audience checks.
- `zobba/crates/infrastructure/src/lib.rs`, `migrations/` — schema 6 preserves prefixes 1–5; raise the bounded catalogue cap (v5: 1018/1025 rows) and refuse truncation.
- `zobba/web/src/{App,ConversationWorkspace}.tsx`, `auth.ts` — conversation, inspection/focus and session-bound reads. The API owns the ordinary 15-second deadline.
- `/workspace/zobba-evidence-adapter-lab/{README.md,src/lib.rs,src/tests.rs}` — reviewed storage prototype; integrate through owned ports.
- `packages/infrastructure/src/evidence/s3-evidence-store{,.test}.ts` at `4fb496eaee4a676e0875e00ba5b00b913e107899` — behavioral reference only; provenance in REUSE.

## Tasks & Acceptance

**Execution** (paths relative to `zobba/` unless stated):
- [ ] `crates/{domain,application}/src/evidence.rs` — reservation, provenance, registration and storage/authority ports.
- [ ] `migrations/0006_evidence.sql`, `crates/infrastructure/src/evidence/mod.rs`, `crates/infrastructure/src/lib.rs` — strict catalogue/grants/RLS, scoped atomic registration and replay.
- [ ] `crates/infrastructure/tests/evidence_s3.rs`, `crates/api/tests/evidence_fixture.rs`, Cargo manifests — local protocol fixture, test-only API composition and bounded I/O.
- [ ] `crates/api/src/{evidence,lib}.rs`, `openapi.json`, `web/src/generated/api.ts` — authenticated reserve/upload/list/inspect/preview/download contracts.
- [ ] `web/src/{App,EvidenceWorkspace}.tsx`, `web/src/evidence.ts` — recoverable acquisition, inspection and browser coverage.
- [ ] `README.md`, `REUSE.md`, root `.github/workflows/` and `CLAUDE.md` — setup, CI, provenance and verification evidence.

**Acceptance Criteria:**
- 21.1.1: Given scoped direct upload, when read-back verifies, then register measured identity, attributed source, acquisition actor/time and immutable object version; no live connector claim.
- 21.1.2: Given old/foreign/revoked authority, when a handle is used, then disclose neither existence nor content.
- 21.1.3: Given partial/substituted/mismatched bytes, when upload or retry executes, then neither publish nor overwrite the original.

## Spec Change Log

## Design Notes

Follow the committed integration contract: exact reservation replay, immutable provenance/namespace, verified read-back, non-null versions, pinned reads and post-lock exact-session checks. No transaction spans object I/O. Reload recovery reuses the same reservation and identical reselected file.

Share fail-fast admission before body buffering: two I/O requests/process, 10 MiB/original, 120-second total and 20-second complete storage-request deadlines. Keep ordinary metadata at 15 seconds and reserved controls independent. Pin `object_store` 0.14.2; enforce production HTTPS/signing/TLS validation and separate numeric-loopback fixture transport. Missing storage configuration leaves evidence explicitly unavailable and foundation usable. Preview inert valid plain UTF-8 only, capped at 64 KiB/100 lines; binaries are download-only. Use authenticated audience-fenced Blob downloads.

Hide private state during uncertain access; retain exact same-session retry and discard it on audience change. Preserve Task selection, guidance and return focus. Root owns status/review/checkpoints; lead owns source, guarded test DBs and IdP 9444. Use `activate-tests.sh` and explicit `*_test` CLI targets; never mutate development or stop IdP 9443.

## Verification

Run Rust fmt/Clippy/tests/build, frozen pnpm/check/build, fixture/Python/boundary checks, smoke and Chromium. Cover PostgreSQL/RLS plus real S3 protocol behavior: conditional retry, lost acknowledgement, corruption, missing version/bucket, body limits/deadlines, replay and revocation during I/O. Test safe headers/preview, reload recovery, narrow keyboard/focus and unaffected conversation controls. Hold completed metadata/download responses across account and same-actor session replacement. Prove 5→6 under restricted roles and unchanged earlier bytes; record actual results and limits.
