---
title: '20.1 — Reproducible Zobba workspace'
type: feature
created: '2026-09-30'
status: done
story_key: 20-1-start-the-new-application-from-one-reproducible-workspace
review_loop_iteration: 0
baseline_commit: a4041ee2b5bb4c10410ee3fa9bb16482a5b6b57d
authorization: 'Owner explicitly accepted the baseline and authorised Stories 20.1–20.4, specifications and routine choices without intermediate approval.'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/_bmad-output/specs/spec-IntelliFin Audit/SPEC.md'
---

<frozen-after-approval reason="owner-authorised Story20.1 intent and batch boundaries">

## Intent

**Problem:** The accepted Rust application has no implementation workspace. Existing TypeScript/Node commands build the historical product and cannot establish the new foundation.

**Approach:** Create independent new Rust API/worker/migration and React/Vite entrypoints with pinned tools, an owned generated HTTP interface, explicit database bootstrap and executable smoke checks.

## Boundaries & Constraints

**Always:** Follow the active SPEC and AD1/8/10/12/14/35/48. Use PostgreSQL18, inward dependencies, separate migration/runtime roles, explicit migration commands and secret-safe errors. Preserve historical files and record exact provenance of reused Pair assets. Verify before advancing to20.2.

**Ask First:** Paid cloud resources, region/spend commitments, real customer data or destructive legacy changes. Local synthetic development and routine implementation choices are already authorised.

**Never:** Build audit/domain tables beyond bootstrap metadata, an agent, auth bypass, production deployment, legacy Node bridge or wholesale deletion. Successful health is not audit capability.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behaviour | Error handling |
|---|---|---|---|
| Fresh database | Empty dedicated PostgreSQL18; explicit migration command | Apply versioned bootstrap metadata once; repeat is safe | Exit nonzero on migration failure |
| Valid runtime | Non-owner runtime role; exact applied migrations | API/worker start and report service/schema health | Bound DB connection wait |
| Wrong database | Unmigrated, incompatible version, foreign schema/marker or altered migration | Refuse startup without mutation | Stable non-secret diagnostic, nonzero exit |
| Lost database | Running process; DB becomes unavailable | Readiness fails; no invented healthy response | HTTP503 and allowlisted telemetry |

</frozen-after-approval>

## Code Map

- `AGENTS.md`, active SPEC companions and `epics.md`20.1: governing invariants/acceptance; historical root pnpm commands remain separate.
- `zobba/`: new independent Cargo and pnpm workspaces; absent at baseline. Rust domain/application/infrastructure and delivery crates own the new boundary.
- Pair pack `assets/`, `tokens/`, `DESIGN.md`: owned visual sources at baseline `a4041ee2b5bb4c10410ee3fa9bb16482a5b6b57d`; font has bundled OFL. Copy selected identity assets, not fixture application logic.
- `.github/workflows/ci.yml`: old application CI, reference only. New smoke workflow must explicitly enter `zobba/`, use its own workspace marker/lock/cache path and a distinct workflow name. Legacy `release.yml` listens for workflow name CI; never attach the new smoke workflow to that deployment chain. Root boundary/Vitest discovery excludes `zobba/`, so its checks must be explicit.

## Tasks & Acceptance

**Execution:**
- [x] `zobba/{Cargo.toml,Cargo.lock,rust-toolchain.toml}`, `crates/{domain,application,infrastructure,api,worker,cli}/` — create minimal owned bootstrap ports, SQLx adapter and composition roots; pin Rust1.98.1 and dependency lock.
- [x] `zobba/migrations/0001_bootstrap.sql`, `crates/infrastructure/tests/bootstrap.rs` — bootstrap only, explicit migration runner, exact applied-schema checks and real PostgreSQL refusal/repeat tests.
- [x] `zobba/{package.json,pnpm-workspace.yaml,pnpm-lock.yaml,.nvmrc}`, `web/` — independent Node24.20.0/pnpm11.25.0 React/Vite Pair shell; generate types from owned OpenAPI and expose actual health without fictional work.
- [x] `zobba/scripts/{check-boundaries.py,smoke.py}`, `.github/workflows/zobba.yml` — enforce crate/workspace isolation and locked build/type/lint/database/process smoke paths; CI uses disposable PostgreSQL18 only.
- [x] `zobba/{README.md,REUSE.md,.env.example}`, root `.gitignore`/README/working notes — document new bootstrap commands, separate runtime/migrator settings, supported pins and source/licence mapping; exclude local caches, data and generated credentials.

**Acceptance Criteria:**
- Given a clean supported environment, when documented bootstrap runs, then the pinned Rust API, worker and Pair-labelled web build and health-check independently of legacy code.
- Given an unsupported or unmigrated database, when either runtime starts, then it refuses without running migrations; only the explicit command changes schema.
- Given historical code remains present, when new commands/CI run, then no legacy compiler, Node domain or Drizzle dependency enters their build/runtime graph.
- Given selected upstream assets enter the new workspace, when reviewed, then their exact source revision, licence and adapted checks are recorded.

## Spec Change Log

## Design Notes

Use `zobba/` as an independent workspace so the existing root pnpm graph is reference material. Runtime credentials cannot own schema or migrate it. The local developer database is separate from the legacy cluster. Future stories add only their owned tables. No Docker or paid environment is required for this local proof. This managed workspace is prepared by `. /workspace/zobba-build-tools/activate.sh`: it selects the pinned compiler/Node/pnpm and supplies separate development/test migration/runtime database URLs. `/workspace/zobba-build-tools/README.md` documents the local PostgreSQL lifecycle and SQL helper; use it for verification, but do not make that machine-specific path a product dependency. Preserve inherited proxy and TLS verification. Current user authorisation covers ordinary story-specification checkpoints and this whole batch; no repeated routine approval is required. Complete only this story before reporting for independent review.

## Verification

**Commands:**
- `cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo test --workspace --locked` from `zobba/` — formatting/lint/unit and configured real-database cases pass.
- `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build` from `zobba/` — new web/types only; generated interface stays current.
- `python scripts/check-boundaries.py`, `python scripts/smoke.py` from `zobba/` with synthetic database URLs — dependency rules, API/worker health and wrong-schema refusal pass.
- `python3 -B -m unittest discover -s scripts -p 'test_*.py'`, `pnpm test:browser` — retain boundary/database guard regressions and actual browser health, failure, keyboard recovery and narrow-layout proof. Use the documented disposable database and owned Playwright installation.
- Independent second-agent review against canonical20.1 before done/checkpoint; browser inspect actual Pair shell.

## Suggested Review Order

**Entry and isolation**

- Start with the separate, reproducible entrypoints and exact verification commands.
  [README.md:1](../../zobba/README.md#L1)

- Keep Rust dependencies inward and the web workspace separate.
  [Cargo.toml:1](../../zobba/Cargo.toml#L1)

**Database authority**

- Validate reachable runtime authority and actual schema before admitting readiness.
  [lib.rs:72](../../zobba/crates/infrastructure/src/lib.rs#L72)

- Serialize and atomically commit explicit bootstrap; runtime startup never migrates.
  [lib.rs:292](../../zobba/crates/infrastructure/src/lib.rs#L292)

**HTTP and experience**

- Project actual service readiness through the owned HTTP interface.
  [lib.rs:65](../../zobba/crates/api/src/lib.rs#L65)

- Present truthful health, bounded refresh and stable keyboard focus.
  [App.tsx:29](../../zobba/web/src/App.tsx#L29)

**Verification and support**

- Exercise privilege, interruption and foreign-schema refusal against PostgreSQL.
  [bootstrap.rs:50](../../zobba/crates/infrastructure/tests/bootstrap.rs#L50)

- Verify actual browser failure and recovery through its API proxy.
  [health.spec.ts:4](../../zobba/web/tests/browser/health.spec.ts#L4)

- Retain regression evidence and an isolated CI path.
  [zobba.yml:1](../../.github/workflows/zobba.yml#L1)
