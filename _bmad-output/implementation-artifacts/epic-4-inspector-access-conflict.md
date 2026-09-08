# Epic 4 inspector access conflict

Status: **IMPLEMENTED — compatible mediation is wired; hosted verification and deployment
configuration remain before acceptance.**

## Finding

Story 4.4 and Story 3.11 require an authorized Run-detail grounding inspector to open a
stored `web_tree`/snapshot artifact. The repository has the storage and metadata needed to
register that artifact. The original checkout had no approved application-mediated read
path from the web process to the stored bytes; the bounded grant shape below now supplies
that missing seam, with generation 38 and worker/route composition now implemented.

## Authority and current seams

| Authority | Requirement or fact |
| --- | --- |
| `_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md:105-111` (AD-5) | Evidence is registered through `EvidenceStore`; authorized reads/exports are application-mediated, at most five minutes, never raw bucket credentials or durable URLs, and verify SHA-256 on every consumption. |
| `_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md:121-123` (AD-7) | Application-owned roles authorize every Evidence read and export. |
| `_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md:125-129` (AD-8) | Binary Evidence remains in `EvidenceStore`; direct database access is confined to infrastructure adapters. |
| `_bmad-output/planning-artifacts/architecture/architecture-IntelliFin Audit-2026-09-01/ARCHITECTURE-SPINE.md:137-141` (AD-10) | Raw Evidence, snapshots, credentials, and signed URLs are forbidden in telemetry; Evidence access/denial and signed-access issuance are audit events. |
| `.dependency-cruiser.cjs:136-144` | `apps/web` may not reach infrastructure Evidence: the store holds object-storage credentials and writes immutable Evidence; only the worker composes it. |
| `packages/infrastructure/src/index.ts:31-37` | The Evidence subpath is intentionally excluded from the web-imported barrel to keep the S3 SDK and store out of the web graph. |
| `packages/application/src/runs/execution-ports.ts:53-56` | The only existing port is `EvidenceStore`, combining `read` and `putIfAbsent`; it is not an authorized read contract. |
| `packages/infrastructure/src/runs/run-detail-repository.ts:299-313` | The Run-detail repository reads bounded Evidence metadata/object keys, not bytes. |
| `apps/web/src/bootstrap.ts:37-82` | `WebRuntime` has no artifact reader. No Evidence API/download route or read use case exists. |
| `_bmad-output/implementation-artifacts/spec-3-11-see-runs-and-inspect-an-adapter-runs-result-evidence-exceptions-and-timeline.md:180-182` and `_bmad-output/implementation-artifacts/spec-4-4-locate-a-record-capture-evidence-and-register-a-grounded-observation.md:98-100,148-150` | The inspector/browser journey still requires opening the stored snapshot. |

## Smallest compatible seam

Use the existing PostgreSQL queue and worker S3 client as a read-only mediation path. The
web action writes only `(runId, evidenceId, locator, actor/session/correlation, deadline)`
to a pending grant and enqueues its grant id. Under the grant row lock, the worker rechecks
the role and registered Evidence binding, resolves the object key internally, and uses the
standard AWS SDK presigner for an exact GET whose expiry is no later than five minutes. The
web server consumes that URL with redirects disabled, enforces the registered media type,
size and SHA-256, records the ID-only access audit, and passes only the domain snapshot cell
to the inspector. Object keys, credentials, durable URLs and bytes remain outside the
browser response. A fresh role check is required both when reading the capability and when
recording access, so revocation during a fetch invalidates the grant and emits an ID-only
denial.

## Resolution and remaining verification

Generation 38 supplies the grant table and capability-state constraints. The infrastructure
barrel exposes the repository and queue runner; the AWS signer remains on a worker-only
subpath. The worker starts the grant consumer and orphan recovery, including a fixed
storage-unavailable refusal when S3 configuration is absent. The authenticated route resolves
registered grounding, requests the durable grant, verifies the bounded artifact, and renders
only inert domain cells. Revocation is checked again after download. Active evidence
mismatch terminates the Run through the shared completion path; post-seal mismatch records
an integrity finding without changing the sealed package, including the terminal-lock race.

Focused inspector and web tests, workspace typechecking, dependency boundaries and builds
pass locally. Nine real PostgreSQL cases and three browser cases, including accessibility,
are committed for hosted execution; they are not yet accepted. Successful deployed reads
require the existing Evidence S3 configuration. No new owner decision or weaker Evidence
contract is required.
