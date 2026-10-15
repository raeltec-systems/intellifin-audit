# Story 21.1 API review repairs

Completed the disjoint API assignments R06, R11, R12, R13 and R14. No commits,
story-status edits, dependency changes, development mutations or IdP work were
performed. The lead granted and received back the restricted patch-test database
lease. The generated interface is current.

## Repairs

| ID | Implemented behavior and proof |
| --- | --- |
| R06 | `api/src/evidence.rs` maps the application-owned `ReservationLimit` to HTTP 409 / `evidence_reservation_limit` without `Retry-After`. The existing two-slot I/O refusal remains HTTP 429 / `evidence_capacity` with `Retry-After: 1`. A response test distinguishes both from ordinary `evidence_conflict`. The reservation OpenAPI response describes the finite 100-incomplete limit, completing an existing reservation, and the absence of expiry/abandonment. |
| R11 | API attachment filenames and the root-owned browser contract use the agreed algorithm: map Unicode scalar characters to ASCII `[A-Za-z0-9._-]` or `_`; trim outer dots; cap at 120 ASCII characters; preserve the final 1–20 alphanumeric extension while shortening the basename; otherwise truncate and trim trailing dots again. Empty input falls back to `evidence-original`; case is preserved. API tests cover long names/extensions, Unicode (including a supplementary scalar), dots, path/header characters and empty fallback. Shared vectors were coordinated with root. |
| R12 | `EvidenceBinary` describes `type: string`, `format: binary`. Upload request and download success use it under `application/octet-stream`; neither is a JSON integer array or base64 body. Regenerated `openapi.json` and `web/src/generated/api.ts`. Contract tests inspect both operations and compare the checked-in OpenAPI with the source-generated document. |
| R13 | The existing guarded HTTP suite now executes four isolated child processes with cleared environments and explicit synthetic AWS configuration: configured, missing bucket, invalid bucket and invalid HTTP endpoint. Each invokes the actual production `authenticated_router`, not the injected-object constructor. Valid configuration exposes `storage_configured: true` and accepts an authenticated, scoped reservation; the other cases expose false and refuse reserve with 503. A numeric-loopback network sentinel fails on any S3 connection. No object request, cloud credential, insecure production transport or paid endpoint is used. |
| R14 | The guarded HTTP suite drives the complete `authenticated_router_with_evidence`, including its outer deadline and the real evidence admission layer. Two upload bodies are held only after actual identity/session, scope and reservation checks finish. A third is refused before body polling. Controlled Tokio time proves metadata remains bounded at 15 seconds, both I/O requests survive that boundary and 119 seconds, and both return 503 at 120 seconds. Time resumes and the same immutable reservation completes through real fixture S3, proving usable capacity after timeout. The existing inner-lane test also checks both permits return. No mocked handlers or weakened authority are used; in-process requests prevent the ordinary HTTP client's 10-second timeout from masking the router behavior. |

API files changed: `crates/api/src/{evidence,lib}.rs`,
`crates/api/tests/evidence_http.rs`, new
`crates/api/tests/evidence_http/composition.rs`, and new
`crates/api/tests/evidence_contract.rs`. Generated files:
`openapi.json`, `web/src/generated/api.ts`. Application enum/metadata work remains
with the lead; web implementation remains with root.

## Executed verification

All commands ran in `/workspace/intellifin-audit/zobba` after sourcing
`/workspace/zobba-build-tools/activate-tests.sh`; captured pipelines used
`set -o pipefail`. Logs are retained under `/tmp/zobba-21-1-api-repair-logs/`.

| Command | Result | Log |
| --- | --- | --- |
| `cargo test --locked -p zobba-api --lib evidence::tests -- --nocapture` | 5 passed; 10 unrelated filtered | `unit.log` |
| `pnpm api:generate` | regenerated successfully | `generate.log` |
| `cargo test --locked -p zobba-api --test evidence_contract` | 2 passed | `contract.log` |
| `cargo test --locked -p zobba-api --test evidence_http -- --test-threads=1` | 3 passed; one child helper marked ignored in the parent run, explicitly executed successfully in four subprocess cases | `evidence-http.log` |
| `cargo clippy --locked -p zobba-api --lib --tests -- -D warnings` | passed | `clippy.log` |
| `node web/scripts/generate-api.mjs --check` | source/OpenAPI/TypeScript agreement passed | `api-check.log` |
| `rustfmt --edition 2024 --check crates/api/src/evidence.rs crates/api/src/lib.rs crates/api/tests/evidence_http.rs crates/api/tests/evidence_http/composition.rs crates/api/tests/evidence_contract.rs` | passed | tool output |
| `git diff --check` scoped to the changed tracked API/generated files | passed | tool output |

The HTTP suite used only `zobba_patch20_3_test` at `127.0.0.1:55434`, with
`zobba_patch20_3_owner` for migrations, `zobba_patch20_3_app` for runtime and
`zobba_local_admin` for guarded fixture setup. `ZOBBA_PUBLIC_ORIGIN` was
`https://localhost:5173`; OIDC variables were unset because the test establishes
ordinary server sessions through the existing identity repository. There was no
IdP lease or IdP request. Child production-constructor cases use their own
synthetic origin and environment isolation.

An initial check invocation used nonexistent `pnpm api:check`; it was corrected
to the repository's actual generator `--check` entry point above. Its fixed
command diagnostic is retained as `api-check-command-error.log`; this was not an
application/test failure. Initial unit-struct schema syntax was corrected to the
supported tuple schema before successful compilation and generated-contract tests.

These focused results do not replace the lead/root combined gates or independent
re-review. Production constructor validation proves composition without object I/O;
it makes no assertion about live S3, AWS IAM, bucket versioning or deployment.
