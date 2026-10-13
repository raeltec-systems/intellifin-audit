---
title: '22.4 — Run measured analysis in an isolated workspace'
type: 'feature'
created: '2026-10-13'
status: 'done'
baseline_commit: '794a8af2396fe96acd9638a6ccef7f90a48008af'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/zobba/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Zobba cannot run real analysis code over evidence. Large or technical files (spreadsheets, exports) need programs, and model-written programs must never see credentials, the network or anything except their declared inputs, and their outputs must never be trusted unchecked.

**Approach:** An analysis job is an exact recorded operation: a model- or human-supplied program, run in a pinned environment over immutable staged originals, with bounded compute, in a disposable sandbox. Trusted code stages inputs, collects outputs, validates them (path, link, type, size, measured hash) and registers only safe outputs as descendant evidence. A Fargate sandbox is the deployment adapter (verified offline; live with 20.7b); a local Docker sandbox is test-only and runs the hostile fixtures for real.

## Boundaries & Constraints

**Always:**
- Job admission uses the existing 20.5 operation custody (`OperationStore` admit → consume as the possible-dispatch cutoff → gateway dispatch/lookup); canonical meaning binds environment ID + image digest, program SHA-256, every input `{original id, digest}`, and limits. Exact retry returns the original job; changed meaning conflicts.
- Environments come only from a server-owned allowlist pinned by image digest; the request cannot name an image.
- Inside the sandbox: inputs read-only at a fixed path, one writable output directory, writable `/tmp` only, no network, no cloud credentials, no task role, non-root, no added capabilities, CPU/memory/PID/wall-time/output-byte limits. Fargate: no `taskRoleArn`, isolated subnets with no route out, staging and collection through job-scoped presigned URLs created by the worker outside the container.
- Collection happens only after confirmed termination. A descendant is registered only if: relative normalized path, no `..`/absolute/NUL/control characters, bounded length and depth, unique (also case-insensitive), regular file only (symlink, hardlink count >1, device, FIFO, socket refused), within per-file/total/count limits, media type in the environment's allowed set, and SHA-256 measured by trusted code. Registration reuses the 21.1 `EvidenceObjects` path (put-if-absent, pinned read-back) into new descendant tables linking job, parent originals, path, digest, size, version.
- Durable job status distinguishes: admitted, possibly started, running, terminated (completed / failed / limit exceeded / stopped), collected, unknown. Never started or authoritatively absent → retryable. Termination or isolation not confirmed → unknown: no automatic retry, no outputs registered, operator reconciliation required.
- Logs, telemetry and receipts carry only IDs, digests, sizes, counts and closed codes — never program text, input or output bytes.
- New migration 0015 updates every schema check this repo requires (catalogue snapshot, inventory, grants, functions, bootstrap version).

**Ask First:** Any environment image to add to the allowlist beyond one pinned general-purpose analysis image plus test fixtures; any limit default above 2 vCPU, 4 GiB, 15 minutes or 100 MiB total output.

**Never:** Privileged sidecar or shared trust boundary; broker or model secrets in the container; host shell execution or Docker socket access from the job; automatic trust of generated output; exposing analysis as a model tool (later story); any AWS call or live run in this story; the local Docker sandbox in production config.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | allowed env, program writes `summary.csv` | terminated completed; one descendant registered with measured hash | N/A |
| Credential probe | program reads env, `169.254.169.254`, `169.254.170.2`, any outbound host | no credentials in env; network calls fail | job still completes; nothing leaks |
| Hostile outputs | symlink, hardlink, `../x`, absolute name, `A`/`a` pair, FIFO | each refused with a closed reason; safe siblings still registered | rejected list in receipt |
| Exhaustion | fork bomb, memory hog, infinite loop, 1 GiB output | killed at limit; status limit exceeded; no oversize descendant | bounded; no host impact |
| Stop | auditor/owner stop during run | container terminated, confirmed, then collected or discarded | status stopped |
| Lost job | worker restarts mid-run | recovery looks up the sandbox: running → resume watch; absent before start → retryable; unconfirmable → unknown | no duplicate run |
| Changed retry | same key, different program or input | conflict refusal | original job unchanged |
| Unlisted environment | env ID or digest not allowlisted | refused before consume | nothing staged |

</frozen-after-approval>

## Code Map

- `zobba/crates/domain/src/permissions.rs:71,119,968-1028` -- `CanonicalOperation` (attachments, resource_version, canonical_bytes), `Operation`, `OperationAttempt`, `ConsumedOperation`, `OperationState`, `SourceFact`; `Purpose` :36.
- `zobba/crates/application/src/operation.rs:55,132,170` -- `OperationStore` (admit/consume cutoff/observe/recover), `OperationGateway{dispatch, lookup}` (lookup may return absent only if delayed dispatch is fenced).
- `zobba/crates/infrastructure/src/operation.rs:591,1094,1193,1285` -- store implementation to reuse.
- `zobba/crates/worker/src/gateway.rs:87-118` -- existing gateway dispatch/recover pattern.
- `zobba/crates/worker/src/executor.rs:54-168` -- child execution: env_clear, authority polling, kill on loss, unconfirmed join → reconciliation.
- `zobba/crates/worker/src/work.rs:33-83` -- `WorkRunner`, `Composition`: where the analysis runner composes.
- `zobba/crates/domain/src/evidence.rs:3-83` -- `ContentIdentity`, `RegisteredEvidence`; `MAX_ORIGINAL_BYTES`.
- `zobba/crates/application/src/evidence.rs:53,215-286` -- `EvidenceObjects`, `acquire` (put_if_absent, uncertain create reconciliation, pinned read-back); reuse for descendants.
- `zobba/crates/infrastructure/src/evidence/s3.rs:128-291` -- S3 adapter, namespace fingerprint; presigned URLs via the same store.
- `zobba/migrations/0006_evidence.sql`, `0014_context_compaction.sql` -- table/RLS/grant patterns; latest migration.
- `zobba/crates/infrastructure/src/lib.rs:144,446-451,465,1080-1145,1281-1339` -- every place a new schema version must be registered; `crates/infrastructure/tests/bootstrap.rs:20-31`.
- `zobba/deploy/qualification/ecs.tf`, `iam.tf`, `network.tf` -- add analysis task family, isolated subnets/SG, staging bucket, worker RunTask/StopTask/DescribeTasks/PassRole(execution only) and presign permissions; extend tftests.
- `zobba/crates/infrastructure/tests/operations/work_cycle.rs:2491` -- `owned(...)` lease-renewing helper for work-loop tests.

## Tasks & Acceptance

**Execution:**
- [x] `zobba/crates/domain/src/analysis.rs` -- environment allowlist entry, job request/limits, canonical binding, job status machine, output path/type/size validator with closed refusal codes -- pure rules, unit-tested.
- [x] `zobba/crates/application/src/analysis.rs` -- `AnalysisSandbox` port (start/status/stop/collect), staging/collection flow, admission via `OperationStore`, recovery classification, descendant registration through `EvidenceObjects` -- one trusted path.
- [x] `zobba/migrations/0015_analysis.sql` + infrastructure repository + schema checks -- jobs, outputs/descendants, rejections; RLS, append-only facts, grants.
- [x] `zobba/crates/infrastructure/src/analysis/docker.rs` -- test-only local sandbox (`--network none --read-only --cap-drop ALL --security-opt no-new-privileges`, non-root, PID/memory/CPU/time limits, tmpfs `/tmp`), enabled only by explicit test configuration.
- [x] `zobba/crates/infrastructure/src/analysis/fargate.rs` -- ECS RunTask/DescribeTasks/StopTask adapter with presigned staging/collection; tested against a stub HTTP endpoint.
- [x] `zobba/crates/worker` -- compose the runner; lost-job recovery on restart.
- [x] Hostile fixtures + integration tests -- every matrix row, the local Docker sandbox for real, on guarded `_test` databases.
- [x] `zobba/deploy/qualification/*.tf` + tests -- analysis infrastructure with invariants (no task role, no egress route).
- [x] `zobba/README.md`, `zobba/deploy/RUNBOOK.md` -- what is qualified offline vs. needs 20.7b.

**Acceptance Criteria:**
- Given any job, when its receipt and logs are inspected, then no program text, input bytes or output bytes appear.
- Given the production composition, when started without explicit test configuration, then the Docker sandbox is unavailable.
- Given the Terraform, when tested offline, then the analysis task definition has no task role and its subnets have no route outside the VPC except the S3 gateway endpoint.

## Verification

**Commands:**
- `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --workspace` against guarded `_test` databases, with Docker available -- expected: all pass, hostile fixtures run for real (not skipped).
- `terraform -chdir=zobba/deploy/qualification test` -- expected: all pass.

## Suggested Review Order

**Trusting outputs**

- Entry point: every output passes these path, link, type, size and hash rules before registration.
  [`analysis.rs:457`](../../zobba/crates/domain/src/analysis.rs#L457)

- One NFC + full case-fold key, shared with the database unique index.
  [`analysis.rs:382`](../../zobba/crates/domain/src/analysis.rs#L382)

- Accepted outputs become descendant evidence through the 21.1 object path.
  [`analysis.rs:1163`](../../zobba/crates/application/src/analysis.rs#L1163)

- Shared hardened collector: unreadable or oversized entries become rejections, never a stuck job.
  [`collect.py:73`](../../zobba/deploy/qualification/analysis/collect.py#L73)

**Job lifecycle and durable outcomes**

- Sandbox port the two adapters implement.
  [`analysis.rs:310`](../../zobba/crates/application/src/analysis.rs#L310)

- Admission through 20.5 operation custody; allowlist checked before any write.
  [`analysis.rs:418`](../../zobba/crates/application/src/analysis.rs#L418)

- Watch loop: wall limit from Running, bounded collection, limit classification.
  [`analysis.rs:837`](../../zobba/crates/application/src/analysis.rs#L837)

- Recovery: retryable absent vs unknown; never dispatches again.
  [`analysis.rs:625`](../../zobba/crates/application/src/analysis.rs#L625)

- Database facts and guard triggers for transitions, attempts and outputs.
  [`0015_analysis.sql:80`](../../zobba/migrations/0015_analysis.sql#L80)

**Isolation**

- Fargate adapter: in-task wall kill keeps collection; refusals before RunTask are retryable.
  [`fargate.rs:37`](../../zobba/crates/infrastructure/src/analysis/fargate.rs#L37)

- Dedicated analysis VPC with a fail-closed DNS Firewall allowlist.
  [`analysis.tf:191`](../../zobba/deploy/qualification/analysis.tf#L191)

- Analysis task definition: no task role, no logs from the untrusted container.
  [`analysis.tf:375`](../../zobba/deploy/qualification/analysis.tf#L375)

- Test-only Docker sandbox: no network, read-only root, no capabilities.
  [`docker.rs:5`](../../zobba/crates/infrastructure/src/analysis/docker.rs#L5)

- Production worker accepts only `fargate` or no sandbox.
  [`main.rs:110`](../../zobba/crates/worker/src/main.rs#L110)

**Verification**

- Hostile fixtures run against real Docker, PostgreSQL and S3 fixture.
  [`analysis_sandbox.rs:61`](../../zobba/crates/worker/tests/analysis_sandbox.rs#L61)

- Terraform ↔ worker environment contract.
  [`worker-environment.json`](../../zobba/deploy/qualification/analysis/worker-environment.json)
