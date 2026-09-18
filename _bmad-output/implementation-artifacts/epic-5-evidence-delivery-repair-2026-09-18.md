# Epic 5 evidence delivery repair — 18 September 2026

## Scope and acceptance status

PR #47 repairs the shared delivery path for Story 4.4 stored snapshots and Epic 5 Watch/Replay. It is not a new epic. Application acceptance remains open under #45 until the deployed UI proves the entire LoanCore journey, including changing workspace state while RUNNING, Replay after release, human confirmation and the unchanged negative fixture.

## Root cause measured on historical production artifacts

Read-only validation workflow `35328313508` tested one registered screenshot and one structural snapshot from OpenAI Run `01a0b39a-9c62-7671-a424-994f989f6880`. Application source was unchanged at `ef0515efbf0c2c558c5ad0153559d7239a8652d9`.

| Evidence ID | Registered media type | Ordinary signed GET | MIME-bound signed GET | Bytes / digest |
|---|---|---|---|---|
| `de2f8e64-f137-88c6-b1c7-b4c683b424da` | `image/png` | HTTP 200, `application/octet-stream` | HTTP 200, `image/png` | Identical, registered values matched |
| `fac3e564-21f4-8c68-b8d1-8aa68a8aeb1f` | `application/vnd.intellifin.web-tree+json` | HTTP 200, `application/octet-stream` | HTTP 200, registered vendor MIME | Identical, registered values matched |

The observed failure is the response declaration, not missing objects or altered bytes. The shared web downloader correctly refused the mismatch. The diagnostic performed GETs only: no object, evidence row, Run lifecycle, registration or credential was changed.

Artifact `10539953007`, ZIP SHA256 `b98b16c50180c3ed4c8d1ed8acae55b6e41a305b346f793927ecb49b18ebabf6`. The ZIP digest was independently verified after download. Its report contains only allowlisted evidence IDs, declared/observed MIME types, byte counts and hashes, not signed URLs, object keys or credentials.

## Repair decision

The immutable registered Evidence row is the authoritative declaration. The worker already checks the viewer's role, Run/artifact binding, artifact state, kind, supported media type, size and digest before signing. Pass that validated media type across the signer port and bind `GetObjectCommand.ResponseContentType` using the official AWS SDK presigner.

This is a response header override, not an object rewrite. It restores compatibility with historical objects whose storage metadata is generic. The web must still require the returned MIME, length and SHA256 to match its actor-bound grant, refuse redirects, enforce expiry, and recheck access before returning bytes. Object metadata is not an independent proof of content; immutable registered digest and length remain the byte-integrity authority. A storage response that does not honor the requested MIME must still be refused.

No changes are made to the EvidenceStore write-once protocol, historical artifacts, negative fixture, gateway provider policy or browser secret boundaries. OpenAI remains the explicitly approved worker provider. No signed URL, S3 credential or provider workspace handle is sent to the browser.

## Regression coverage

The pre-existing application and signer tests assert that a PNG's registered declaration reaches the AWS GET command and malformed MIME values are rejected. New `tests/unit/evidence-s3-delivery.test.ts` connects the real S3 client/store and official presigner through a local HTTP contract server to the actual shared web downloader/frame reader. The server deliberately preserves generic historical object metadata rather than returning idealized headers.

The cases require successful PNG and vendor-JSON reads, unchanged historical bytes/metadata, no extra PUTs, and continued refusal for wrong response MIME, wrong bytes, wrong size and revoked access. The fixture verifies that response overrides are signed, but does not claim to implement independent SigV4 verification. Production compatibility is evidenced separately by the four measured historical GETs above.

Normal full CI, PR review and normal main/release deployment remain required. Passing these tests alone is not final acceptance. After release, inspect old evidence without rewriting it, rerun the clean UI journey, confirm model proposals through the UI, and rerun the untouched defective population only after the positive gates pass. Record exact deployed SHA, workflow/Run IDs, artifact digests and temporary-identity cleanup.

## Verification boundary

The earlier signer change passed typechecking, unit/integration, security mutation and container jobs on workflow `35326442509`; browser completion and the added regression tests must be checked on the final PR candidate. No production repair has been deployed at the time this report was written. Final CI and deployed acceptance results belong in the PR and #45 with their exact revisions; do not reinterpret this report as sign-off.
