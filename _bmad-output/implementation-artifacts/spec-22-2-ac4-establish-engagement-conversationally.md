---
title: '22.2 AC4 — Establish an engagement conversationally from the first objective'
type: 'feature'
created: '2026-10-07'
status: 'in-progress'
baseline_commit: '65cd82e677b64319c244a5ee4332fa884c1973c5'
story_key: 22-2-continue-a-real-task-under-changing-guidance
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-2-continue-a-real-task-under-changing-guidance.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A Task needs an existing engagement. No runtime path creates a client, an engagement or an assignment, and engagements have no period. A new user with no assignment sees only "Contact your organisation administrator".

**Approach:**
1. The member types a first objective at organisation level.
2. Zobba asks in the conversation only for what is missing: the client and the audit period.
3. Zobba shows one confirmation.
4. On confirmation, one transaction creates the client (when new), the engagement with its period, the creator's assignment and the first Task.

Nothing acquires material before that transaction commits.

Owner decisions (2026-10-07):
- Any current Auditor or Audit manager member may establish an engagement.
- A new client may be created after explicit confirmation.
- Only the creator is assigned.

## Boundaries & Constraints

**Always:**
- Persist each message before interpreting it.
- Use deterministic, server-side resolution. No model call.
- Match a client on the exact name, or with context-independent Unicode simple case folding. More than one match means a question; no match means a proposal to create a new client, which needs explicit confirmation.
- Accept the period only as explicit ISO dates with start ≤ end.
- Recheck the exact session and the current active, unexpired membership with the auditor or audit_manager role after taking organisation advisory lock 205 and then the new engagement row. Admin alone is not enough.
- Creation runs through an owner-mediated SECURITY DEFINER function. Do not grant the runtime role INSERT.
- Server-generated scope IDs follow the existing rule: 1–128 ASCII letters, digits, `_` and `-`.
- Labels follow the existing 1–200 scalar label rule.
- Idempotency is per actor, organisation and key. A retry returns the original receipt. A changed meaning is a conflict.
- Bounds: at most 8 open setups per actor in each organisation, and at most 20 engagements created per actor in each organisation per UTC day.
- Preserve migrations and catalogues 1–12 byte for byte. Schema 13 is additive. Existing engagements keep an unknown (NULL) period.

**Ask First:**
- Any live model call.
- Any change to Admin continuity or membership rules.
- Changes to the bounds above.

**Never:**
- A procedure, methodology or skill-selection wizard.
- Assigning anyone other than the creator.
- Creating an engagement for an organisation where the actor has no audit role.
- Inferring the client or period from model output.
- Acquiring or disclosing client material before the engagement exists.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy path | Auditor with 0 assignments types an objective, names an existing client exactly, gives `2026-01-01 to 2026-12-31`, confirms | Engagement (with period), assignment and the first Task are created atomically; the conversation opens in the new engagement | — |
| Ambiguous client | Two clients fold to the same name | Asks which one, listing both; nothing is created | An answer naming a client outside the candidates is refused |
| New client | No client matches | Proposes "Create client X?"; created only after confirmation | Declining keeps the setup open |
| Missing or invalid period | No dates, or start > end | Asks for the period with the expected format | Invalid answers are refused with the reason; the setup stays open |
| Unauthorised | Admin-only member, or membership revoked or expired before confirmation | 403; nothing is created | Revocation after the lock is decided under that lock |
| Retry | Same key and meaning after a lost reply | The original receipt and the original engagement/Task IDs | Same key with different meaning → 409 |
| Concurrent confirms | Two tabs confirm one setup | Exactly one engagement | The loser gets the original receipt |
| Bounds | 9th open setup, or 21st engagement today | 409 capacity, with the reason | — |

</frozen-after-approval>

## Code Map

All paths are under `zobba/`.

**Schema and authority**
- `migrations/0002_identity_scope.sql:25-108` -- clients, engagements, memberships and assignments. RLS is forced. Runtime has SELECT only, plus `UPDATE(name)`.
- `migrations/0005_membership_administration.sql`:
  - `membership_admin` :64 -- the pattern for an owner-only function.
  - `membership_write` :186-261 -- assignment insert and lock order :212.
  - `membership_fence` :146.
- `crates/infrastructure/src/lib.rs`:
  - runtime grants :1113 -- grant EXECUTE on the new function only.
  - the ledger `LIMIT` :843 -- raise it to 14.
  - the catalogue chain :795 -- add schema-v13.
- `crates/domain/src/lib.rs:16` -- `SCHEMA_VERSION`.
- `crates/domain/src/identity.rs:52-80` -- `AuditRole` and `has_audit_authority`.

**Task admission**
- `crates/infrastructure/src/task.rs`:
  - `lock` :94-110 -- lock order org 205, then engagement, then Task.
  - `admit` :174 -- reuse it inside the same transaction once scope is set to the new engagement.
- `crates/infrastructure/src/work.rs` `direct` :256 and `crates/domain/src/work.rs` `route_direction` :365 -- the existing engagement-scoped routing. Leave it unchanged.

**API and web**
- `crates/api/src/identity`, `crates/api/src/membership.rs:709` -- session and CSRF extraction pattern for organisation-level routes.
- `zobba/web/src/App.tsx:121-139,315-331`:
  - the engagement list
  - the empty state, to replace with the organisation setup composer
  - a "Start new engagement" entry
- `web/src/conversation-outbox.ts` -- durable outbox to reuse, with a new binding kind keyed by organisation.

**Fixtures and tests**
- `crates/infrastructure/src/fixture.rs:85` -- the seed shape for clients and engagements.
- `crates/infrastructure/tests/membership/` -- concurrency and revocation test patterns.

## Tasks & Acceptance

**Execution:**
- [ ] `migrations/0013_engagement_setup.sql`, `schema-v13.catalog`, `domain/src/lib.rs`, `infrastructure/src/lib.rs`
  - Add nullable `period_start` and `period_end` to `engagements`, with a CHECK that both are set or both are NULL and start ≤ end.
  - Add `engagement_setups`: org, actor, key, objective, state, candidates, resolved client, new-client name, period, engagement, Task, receipt.
  - Add `engagement_setup_messages`, with RLS limited to the actor.
  - Add the owner function `engagement_establish`. It authorises under the locks, creates the client, engagement and assignment, and enforces the bounds.
- [ ] `domain/src/engagement_setup.rs` (new)
  - A pure state machine (objective → client → period → confirm → established) and the resolution rules: case folding, ISO period parsing, ID generation, bounds.
  - Unit tests for every row of the matrix.
- [ ] `infrastructure/src/engagement_setup.rs` (new)
  - A repository that persists each message, then resolves it.
  - Confirmation calls `engagement_establish`, sets the new scope, and runs the existing Task `admit` Create in the same transaction.
  - Exact replay.
- [ ] `api/src/engagement_setup.rs` and OpenAPI
  - Routes: `POST /organisations/{org}/engagement-setups`, `.../{id}/messages` and `.../{id}/confirm`, plus `GET` of a setup. All use the session and CSRF fences and `X-Expected-Actor`.
- [ ] `web/src/EngagementSetup.tsx`, `App.tsx`
  - An organisation-level conversation with a composer.
  - Question and answer turns, a candidate pick list, the new-client confirmation, and a summary confirmation.
  - Durable outbox recovery; then open the new engagement conversation.
  - Keyboard, narrow-screen and WCAG 2.2 AA support.
- [ ] Tests:
  - PostgreSQL: atomic creation and rollback on Task failure, authority revocation under the lock, the concurrent-confirm race (a held transaction observed in `pg_locks`), bounds, replay and conflict, and that the runtime role has no INSERT.
  - API HTTP.
  - Chromium: an Auditor with zero assignments completes the happy path with keyboard only, plus the ambiguous-client path.

**Acceptance Criteria:**
- Given an Auditor member with no assignments, when they type a first objective and resolve the client and period, then after one confirmation the engagement, their assignment and the first Task exist, and the conversation continues in that engagement.
- Given setup is incomplete or refused, when any step fails, then no client, engagement, assignment, Task or material access exists.

## Design Notes

Keep setup out of the engagement-scoped routing tables (22.2 AC1–3). They require an engagement, so an organisation-level setup is a separate aggregate that ends by handing off to the normal Create path in the same transaction. The period lives on the engagement, so later methodology binding can use it as the default context, without changing the 21.2 binding rules.

## Verification

**Environment:** first run `. /tmp/zobba-env.sh` (PostgreSQL 18.6 `zobba_local_test` on port 55434; Node 24.20.0; pnpm 11.25.0). For the bootstrap and smoke checks, add `?sslmode=disable` to the three `ZOBBA_TEST_*` URLs. Never commit, push, or call a live provider.

**Commands** (run from `zobba/`, one after another):
- `cargo fmt --check && cargo clippy --locked --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --locked --workspace -- --test-threads=1` -- expected: all pass.
- `cargo run -p zobba-cli --locked -- openapi`, then `pnpm check && pnpm test:browser` -- expected: the types match and the suites pass with zero retries. The only allowed failures are the two known IPv6-only sandbox unit tests.

## Implementation Notes (2026-10-07)

Delivered (not committed):
- `migrations/0013_engagement_setup.sql` + `schema-v13.catalog` (captured byte-for-byte
  with `psql -At` from a scratch database after migrations 1–13; the same capture of
  1–12 reproduced `schema-v12.catalog` exactly). `SCHEMA_VERSION` 13, ledger `LIMIT 14`,
  inventory/grant/effective-role checks, and `check_setup_functions` (three runtime
  entry points, one private helper, no runtime INSERT on clients/engagements/assignments).
- `domain/src/engagement_setup.rs`: pure state machine, simple case folding,
  ISO period parser, bounds, ID/key derivation; unit tests per matrix row.
- `application/src/engagement_setup.rs` port; `infrastructure/src/engagement_setup.rs`
  repository (message committed, then interpreted; confirm calls `engagement_establish`,
  enters the new scope and runs the existing `admit_in` Create + `admission_fence` in
  the same transaction; exact replay; concurrent loser returns the original receipt).
- `api/src/engagement_setup.rs` (+ OpenAPI): `GET /engagement-setups/organisations`,
  `GET|POST /organisations/{org}/engagement-setups`, `GET .../{id}`,
  `POST .../{id}/messages`, `POST .../{id}/confirm`. Mutations require CSRF, Origin
  and `X-Expected-Actor`; reads honour `X-Expected-Session`.
- Web: `engagement-setup.ts`, `EngagementSetup.tsx`, App empty state replaced by the
  setup conversation and a "Start new engagement" entry; setup outbox channel
  (`setup:` binding keyed by actor + organisation); explicit "Send again" recovery.

Decisions inside the frozen intent:
- Matching: exact name first; otherwise simple folding. Folding is computed in Rust
  (lowercase of the single-scalar uppercase; `ı`/`İ` fold to themselves). SQL returns
  a bounded superset (same scalar count and `lower(upper(.. COLLATE pg_c_utf8))`,
  at most 21 rows); a full page is refused as "too many clients" rather than guessed.
- Engagement name is `Audit YYYY-MM-DD to YYYY-MM-DD`; IDs are `c-`/`e-`/`s-` + 32 hex.
- Establishment bumps `membership_versions` so an open administration draft cannot
  silently replace the new assignment.
- A member "cancel" message closes an open setup (needed to recover from the 8-open bound).
- The engagement period is stored but not yet passed as the Task's methodology
  context (the design note defers that use).
- Narrow screens: the existing ≤620px brand bar now wraps (`.sidebar` flex-wrap); it
  overflowed 360px pages by 17px before this change.

Verification (local, disposable `zobba_local_test`, `sslmode=disable` URLs):
- `cargo fmt --check`, `cargo clippy --locked --workspace --all-targets -D warnings`: clean.
- `cargo test --locked --workspace --no-fail-fast -- --test-threads=1`: 387 passed,
  0 failed except `oidc_protocol` (14), which needs the running OIDC fixture; with
  `pnpm fixture:start` it passes 14/14. New: domain `engagement_setup` (8),
  infrastructure `tests/engagement_setup.rs` (happy path, ambiguous, new client,
  Admin-only refusal, revocation decided under lock 205, concurrent confirms held on
  205 and observed in `pg_locks`, Task-failure rollback, open/daily bounds, replay
  and conflict, runtime has no INSERT), API `tests/setup_http.rs`, bootstrap tamper,
  privilege and upgrade checks for schema 13.
- `scripts/smoke.py`: passed. `pnpm check`: types current, 190/192 (the same two
  IPv6-only sandbox failures). `pnpm test:browser`: 165 passed, zero retries,
  including `engagement-setup.spec.ts` (keyboard happy path, ambiguous client,
  360px narrow screen).
