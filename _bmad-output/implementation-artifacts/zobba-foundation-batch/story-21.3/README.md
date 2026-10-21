# Story 21.3 evidence package

This package records the installed-skills checkpoint against producer `643ed095314d42f576106effd287703824003c73`. The final combined run passed all 123 Chromium cases with zero retries; all eleven verification gate families passed. See the [checkpoint report](../STORY-21.3-CHECKPOINT.md).

## Review surfaces

- `integration-contract.md` describes the delivered producer interfaces, authority boundaries and limits for later consumers.
- `repair/closure-matrix.md` maps the twelve retained review repairs to actual verification.
- `repair/verification.md` records commands, counts, source reconciliation and failed attempts.
- `review/root-triage.md` records the three independent review layers, duplicate consolidation and follow-up dispositions.
- `review/` contains independent source/receipt closure reports. Reviewers inspected executed evidence; they did not claim a separate independent execution of every test.
- `repair/` contains allowlisted final source/gate records, targeted proofs, selected screenshots and passing receipts. `repair/final/` contains inspected captures from the final complete browser invocation. `initial/` preserves the earlier pre-review stage, which cannot establish acceptance of later repairs.

The initial and repaired stages remain distinct. Focused browser passes are attributed to their own invocations; failed runs are never relabelled as an all-green suite. The final combined browser receipt is the acceptance gate for the combined application.

## Source and schema

Published migrations/catalogues 1–8 are byte-identical to the producer. Schema 9 is the new additive suffix. Raw catalogue capture preserves inherited carriage returns. Explicit C collation makes text cursor comparisons, both ordering stages and their indexes agree with browser ordering regardless of database locale. A separately guarded non-C disposable database probe demonstrated the difference and verified cleanup.

The full Rust and smoke runs preceded later frontend-only changes. Their source manifests establish unchanged Rust, SQL and backend test bytes; final web and browser receipts cover the final frontend. No blanket claim that every gate started on identical files is made.

## Proof limits and reproduction

Use the pinned setup and guarded test commands in `zobba/README.md`, the story context and verification report. All execution here uses synthetic identities, a local OIDC fixture, disposable PostgreSQL databases, local object storage and Chromium. Browser lifecycle simulation does not qualify other browsers, OS tab behavior or a production deployment. No model call, script-resource execution, production tool adapter or paid cloud qualification is claimed.

Failed raw logs, traces, fixture environments, generated credentials, sign-in screens and unrelated screenshots remain private local artifacts. Sanitized failure dispositions and hashes retain the relevant observations. Machine-specific paths in evidence identify the original execution; they are not portable setup requirements. Original private artifacts may not survive this workspace. Reproduce the named tests rather than relying on those paths.

`publication-manifest.json` lists every allowlisted copied artifact by path, size and SHA-256. When only Markdown navigation changed, it also records the original hash. The checkpoint and this index are root-authored summaries. The manifest's credential-pattern scan supplements explicit inspection; it is not a claim that arbitrary source material is safe to publish.
