# Story 21.4 evidence package

Completed verification: 305 Rust tests, 181 web unit tests and 145 Chromium cases, with zero browser retries. Gate receipts keep invocation counts separate.

This package records scoped working knowledge against the Story 21.3 producer, `d38e1daed736415ef13e7606345dac71bd1d9f01`. The [checkpoint report](../STORY-21.4-CHECKPOINT.md) describes delivered behaviour and limits.

## Review surfaces

- [Canonical specification and suggested review order](../../spec-21-4-remember-scoped-working-knowledge-with-its-basis.md).
- [Ten-row verification map](repaired/verification-map.md) and [repair closure](repaired/repair-closure.md).
- [Consumer contract](integration-contract.md) for later Task/context consumers.
- [Gate receipts](repaired/repair-final-gates.json) and [source reconciliation](repaired/repair-source-reconciliation.json).
- [Original review triage](review/root-triage.md), [independent coverage preflight](review/final-coverage-preflight.md), and [final independent reconciliation](review/final-evidence-closure.md).
- [Methodology draft custody and prior-component negative control](methodology-custody/README.md).
- [Publication manifest](publication-manifest.json), which pins the explicitly selected artifacts and any Markdown-link rewriting.

The first full browser invocation passed 131 cases and failed five; the first repaired full invocation passed 142 and failed three; the next passed 144 and failed one unsupported ordering assertion. All used one worker and zero retries. Their outcomes remain historical failed evidence. Focused passes are not combined into a fictional all-green run. The final combined invocation passed all 145 cases in 16.7 minutes; before/after manifests contain the same 245 application files.

## Source and schema

Migration 10 is additive. All eighteen published migration/catalogue files through schema 9 remain byte-identical to the accepted producer. Catalogue captures preserve literal carriage returns. Populated upgrades preserve prior records without inventing historical captures. The separate public recovery proof acquires real original bytes under schema 9, then exercises migration, current UI recovery, API restart and exact replay against the same object.

The source reconciliation compares Rust, static, smoke and browser execution boundaries with the final application files, including an independently checked comment-only backend difference. It names frontend and test-only changes made after backend verification and the later checks that cover them. It does not imply every gate ran on an identical full tree.

## Proof limits and reproduction

Use the pinned setup and disposable-database guards in `zobba/README.md`, the story context and verification map. Tests use synthetic identities, local OIDC and object-storage fixtures, PostgreSQL and Chromium. This evidence does not qualify other database locales, browsers, native OS tab behaviour, model inference or a real managed computer.

Plain UTF-8 automatic capture covers at most 16 KiB. Unsupported formats and incomplete coverage remain visible. Retrieval returns at most fifty records after inspecting at most 1,024 candidates. A scan-limit notice does not establish absence, and exact lookup does not discover unknown IDs. Global discovery remains a later story.

Raw traces, fixture credentials/environments, private JSON reporters, sign-in captures and unrelated screenshots remain outside this package. Explicitly inspected artifacts are allowlisted; the publication manifest records byte lengths and SHA-256, including original hashes when Markdown navigation changes. Pattern scans supplement inspection; they do not certify arbitrary files as safe. Local paths identify the original execution and may not survive the workspace; reproduce the named tests.

Independent source review and reconciliation of execution receipts are labelled separately from independent execution. No merge, deployment, customer-data use, model-provider call or paid cloud qualification is included.
