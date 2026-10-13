---
title: '20.7a — Qualification environment as code, verified offline'
type: 'feature'
created: '2026-10-13'
status: 'in-progress'
baseline_commit: '05e1b58cacdd35756944de156cb801ca7b851693'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
  - '{project-root}/zobba/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Zobba has no container image, no deployment and no infrastructure code, so there is no shared environment where a demo or the Story 25.4 gate can run. The owner has no AWS account or budget yet (startup credits applied for).

**Approach:** Write the complete, pinned qualification environment as Terraform, one container image, a manual release workflow and a runbook — all verified offline with mocked providers, policy scans and an image build, so that a live apply needs only credentials and an approved budget. Live proof is Story 20.7b.

## Boundaries & Constraints

**Always:**
- Isolated two-zone AWS environment: ECS/Fargate API (≥2 tasks, both zones) and worker in private subnets with no public IPs; RDS PostgreSQL 18 Multi-AZ, encrypted, `rds.force_ssl=1`, backups ≥7 days with PITR, deletion protection and a final snapshot; customer-managed KMS; S3 evidence bucket with versioning, SSE-KMS, public access blocked, TLS-only policy; secrets only in Secrets Manager (never plaintext task env or outputs); Cognito user pool, app client and hosted domain with callback exactly `<public origin>/api/auth/callback`, self sign-up disabled.
- Single public origin: CloudFront serves the built web from a private S3 bucket (OAC) and sends `/api/*` to an internal ALB through a CloudFront VPC origin, removing the `/api` prefix with a CloudFront Function. Public origin defaults to the CloudFront domain; a custom domain is an optional variable.
- Database roles match the code: `zobba_migrator` (database owner) and `zobba_app` (runtime), `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, neither in `rds_superuser`; created once by a runbook bootstrap task using the RDS-managed master secret. Runtime tasks get only the runtime URL; only the release migration task gets the migrator URL.
- Least-privilege IAM per task role (S3 actions exactly as `zobba/README.md` documents); release uses GitHub OIDC to an AWS role, no long-lived keys.
- One image (pinned Rust 1.98.1 builder, slim runtime with CA certificates, non-root) holding `zobba-api`, `zobba-worker`, `zobba-cli`; ECS selects the binary. Worker is started with no arguments; API binds `0.0.0.0`.
- Release workflow is `workflow_dispatch` only, GitHub environment `qualification` (approval), order: build+push image → run `zobba-cli migrate --runtime-role zobba_app` as a one-off task and require exit 0 → deploy services → sync web and invalidate. It never runs on push.
- AWS Budget with an owner-set monthly limit variable and email alerts; every resource tagged; remote state in an encrypted, versioned S3 backend with locking (backend config supplied at init, not committed values).
- Everything pinned: Terraform version, AWS provider version, committed `.terraform.lock.hcl`, action SHAs, base image digests.

**Ask First:** Any default region, instance size or task count that changes the cost profile beyond the smallest Multi-AZ setup; any second NAT gateway (default is one, variable allows two).

**Never:** Run `terraform apply` or any AWS call; read or invent credentials; startup migrations; `seed-local`, `ZOBBA_LOCAL_FIXTURES`, model API keys or test-only S3/OIDC switches in the environment; a public ALB or public database; legacy app (`apps/*`, Railway) access; claiming live qualification.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plan with valid vars | mocked providers, all required vars | plan succeeds; asserted invariants hold | N/A |
| Missing required var | no region / budget limit / alert email | validation fails before plan | clear variable error |
| Unsafe override | `multi_az=false`, `backup_retention<7`, `api_desired_count<2` | refused by variable validation | message names the rule |
| Migration fails | migrate task exits non-zero | workflow stops before service deploy | job fails; services unchanged |
| Image smoke | built image, `zobba-cli openapi` | prints JSON matching committed `openapi.json` | step fails on mismatch |

</frozen-after-approval>

## Code Map

- `zobba/crates/api/src/main.rs:16-36` -- reads `ZOBBA_RUNTIME_DATABASE_URL`, `ZOBBA_API_BIND` (default `127.0.0.1:4310`).
- `zobba/crates/worker/src/main.rs:89-139` -- `ZOBBA_WORKER_BIND` (default `127.0.0.1:4311`); any argument switches to child-executor mode.
- `zobba/crates/cli/src/main.rs:16-40` -- `migrate --runtime-role <role>` reads `ZOBBA_MIGRATION_DATABASE_URL`.
- `zobba/crates/infrastructure/src/oidc.rs:83-160` -- OIDC vars all-or-nothing; HTTPS real domain; redirect path `/api/auth/callback`; optional `ZOBBA_OIDC_AUTHORIZATION_ORIGIN` (Cognito hosted domain).
- `zobba/crates/infrastructure/src/lib.rs:33-48` -- DB URL query keys limited to `sslmode`/`application_name`; `PGOPTIONS` refused. Use `sslmode=require`.
- `zobba/crates/infrastructure/src/lib.rs:88-134,1197-1228` -- readiness refuses unsafe runtime role memberships; `/health/ready` on both processes.
- `zobba/crates/infrastructure/src/evidence/s3.rs:43-141` -- `AmazonS3Builder::from_env`; namespace fingerprint over endpoint/bucket/addressing/region: freeze per environment. `ZOBBA_EVIDENCE_BUCKET`.
- `zobba/README.md:191-211,811-829` -- role creation SQL; S3 IAM actions; no startup migrations.
- `zobba/web/vite.config.ts:16-21` -- dev proxy strips `/api`; production must do the same.
- `.github/workflows/zobba.yml` -- existing `foundation` job; add a separate offline infrastructure job.

## Tasks & Acceptance

**Execution:**
- [ ] `zobba/deploy/Containerfile` + `.dockerignore` -- multi-stage image for the three binaries -- one artifact for API, worker, migration.
- [ ] `zobba/deploy/qualification/*.tf` (+ `versions.tf`, `variables.tf`, `outputs.tf`, `.terraform.lock.hcl`, `example.tfvars`) -- network (2 AZ, VPC endpoints for S3/ECR/Secrets/Logs), RDS, KMS, S3 (evidence, web), Secrets, Cognito, ECS cluster/services/migration+bootstrap task definitions, internal ALB, CloudFront + VPC origin + function, IAM, logs, Budget -- the environment.
- [ ] `zobba/deploy/qualification/tests/*.tftest.hcl` -- `mock_provider "aws"` tests covering every matrix row and the Always invariants -- offline proof.
- [ ] `.github/workflows/zobba-qualification-release.yml` -- manual release in the order above, with the migration exit check -- release-only migrations.
- [ ] `.github/workflows/zobba.yml` -- new job: terraform fmt/validate/test, checkov (pinned), actionlint, image build + `openapi` smoke -- keeps it verified with no AWS.
- [ ] `zobba/deploy/RUNBOOK.md` -- prerequisites/owner gates, state backend bootstrap, first apply, role bootstrap, release, rollback limits, retained backups/evidence, destroy boundaries, spend check, secret handling; restore/reconciliation section marked "Story 20.7b, not yet exercised" -- operator path.
- [ ] `zobba/README.md` -- short pointer to the runbook; state no live deployment is qualified.

**Acceptance Criteria:**
- Given no AWS credentials, when CI runs the infrastructure job, then fmt, validate, all `terraform test` runs, checkov (no unsuppressed high findings; each suppression has a written reason) and actionlint pass.
- Given the planned task definitions, when inspected by tests, then no secret value appears in `environment`, runtime tasks receive no migrator URL, and the worker command has no arguments.
- Given the runbook, when an operator with credentials follows it, then every step names its command, the owner gate it needs, and what it costs or retains.

## Design Notes

Why a VPC origin: the API must be HTTPS on a real domain, and a TLS certificate for an ALB needs a custom domain the owner does not have yet. A CloudFront VPC origin reaches an internal ALB over the AWS network, so no public ALB exists and the CloudFront domain is the public origin.

## Verification

**Commands:**
- `terraform -chdir=zobba/deploy/qualification fmt -check -recursive && terraform -chdir=zobba/deploy/qualification init -backend=false && terraform -chdir=zobba/deploy/qualification validate && terraform -chdir=zobba/deploy/qualification test` -- expected: all pass (install pinned Terraform into the scratchpad, not the repo).
- `docker build -f zobba/deploy/Containerfile zobba` then run `zobba-cli openapi` and compare with `zobba/openapi.json` -- expected: identical (if no local Docker daemon, rely on the CI job and say so).
