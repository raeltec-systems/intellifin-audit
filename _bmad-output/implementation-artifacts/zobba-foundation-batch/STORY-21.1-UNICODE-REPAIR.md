# Story 21.1 owner-review repair

**1 October 2026 (Africa/Lusaka). Repair complete; tested and independently reviewed. Ready for owner acceptance.**

Baseline: `26271284b03d5114f6ead2146092c5e1a50fdd7c` on
`codex/zobba-foundation-batch`. The owner accepted Story 20.6; the active queue
records it as done. Story 21.1 remains in review. No next story has begun.

## Repair

The browser now applies Rust's Unicode White_Space rules to evidence filename
and source-field validation. JavaScript's built-in trim additionally removes
U+FEFF, which caused it to reject immutable values the server already accepted.
The same helper handles new source input without stripping U+FEFF.

Accepted filenames, all five source assertions, reservation identities and
recovery drafts retain their exact strings. The server contract, stored records,
UTF-8 byte limits, control/path restrictions, session fencing, migrations and
catalogues are unchanged. There is no data rewrite or fallback that skips rows.

## Verification

The shared fixture supplies **2,196 cases: 366 for each of filename, system,
account, source_version, selection and coverage**. Rust exercises actual API DTO
deserialization, the domain validator and exact serialization. Browser unit tests
exercise parsing, evidence inspection shapes and draft save/recovery. Cases cover
leading/trailing/internal/standalone U+FEFF, Unicode White_Space, C0/C1 controls,
filename separators, null/empty values, non-normalized strings and UTF-8 limits.

Before the fix, every field's unit group failed on seven accepted U+FEFF cases.
All three real-browser regressions also failed against the old production code:
the mixed registered panel, the mixed pending panel and new source entry. An
initial harness run additionally exposed Chromium's alternate wording of the
expected anonymous-session 401; the monitor was narrowed to the exact endpoint
and two observed forms, then the clean failing run was recorded.

The browser regressions create actual records through the API using the owned
OIDC/PostgreSQL/S3 protocol fixture. They test one normal plus four affected
records together, inspect exact raw DOM metadata and original downloaded bytes,
and recover five pending reservations through reload with identical request keys,
metadata and identities. They also verify fresh acquisition with a U+FEFF filename
and new source entry in every field, plus concrete suggested attachment names.
Ordinary whitespace-normalizing text matchers are not used to prove preservation.

Final execution: **107 frontend tests, 3 Rust API contract tests, 20 domain unit
tests, 2 domain doctests and 57 Chromium scenarios passed**. Generated API and
TypeScript checks, production web build, formatting and workspace/all-target
Clippy also passed. The browser ran with one worker, no retries, no skips and an
explicit exit 0. All twelve published migrations/catalogues remain byte-identical.

- [Results and scope](story-21.1-unicode/results.json), [command exits](story-21.1-unicode/exit-receipts.txt), [replay commands](story-21.1-unicode/commands.sh.txt).
- Failing baseline: [unit](story-21.1-unicode/negative-unit.txt), [browser](story-21.1-unicode/negative-browser.txt), [initial harness attempt](story-21.1-unicode/negative-browser-initial-harness.txt).
- Passing checks: [frontend](story-21.1-unicode/frontend-check.txt), [Rust contract](story-21.1-unicode/evidence-contract.txt), [domain](story-21.1-unicode/domain.txt), [browser](story-21.1-unicode/browser.txt).
- [Affected-record screenshot](story-21.1-unicode/mixed-affected-registry.png), [panel screenshot](story-21.1-unicode/mixed-registered-originals.png), [source manifest](story-21.1-unicode/source-manifest.json), [unchanged published schema](story-21.1-unicode/published-schema-baseline.json).
- [Independent review and disposition](story-21.1-unicode/REVIEW.md), [isolated negative replay](story-21.1-unicode/NEGATIVE-CONTROL-REPLAY.md), [executed replay qualification](story-21.1-unicode/replay-qualification.json).

After review, a 55/57 intermediate run exposed Chromium's suggested-name fallback;
its [failure and source snapshot](story-21.1-unicode/filename-fallback-run/browser.txt)
are retained. The corrected full run passed 57/57. A subsequent screenshot-only
cursor adjustment passed a separate [3/3 Unicode rerun](story-21.1-unicode/browser-unicode-capture.txt)
with [exit 0](story-21.1-unicode/capture-exit-receipt.txt). The [exact one-line delta](story-21.1-unicode/capture-only-source-delta.txt)
and separate source manifests distinguish these executions; this is 57 distinct
browser scenarios, not 60.

Both implementer and coordinator inspected the rendered affected-record screenshot. Exact
preservation is established by raw-string/byte assertions, not by the image of an
invisible character. The selected browser suite includes every evidence case and
all authentication/account-binding cases. The previous checkpoint's complete Rust
workspace, fixture and Python suite counts are historical, not claimed as rerun
here. Independent review and final receipt checks found no remaining repair blocker; all execution used local disposable services.

## Limits and separate owner decision

This qualifies the compatibility repair against the local protocol fixture and
Chromium. It does not qualify live AWS custody or another browser engine. Preview
eligibility and safe attachment filenames retain their existing rules: an
affected filename can be download-only while metadata and original bytes remain
readable and exact.

Chromium suggests `download` when given the sanitised attachment name `_` for a
FEFF-only original. The test qualifies that observed name separately from the
immutable filename. Two pre-existing follow-ups remain documented in the review:
malformed-surrogate input parity and an accessible label for invisible-only
filenames. Neither is represented as resolved by this compatibility repair.

The [Admin-expiry safeguard](ADMIN-EXPIRY-OWNER-DECISION.md) is recommended for
owner approval: retain one active, non-expiring Admin membership attached to an
active identity. Temporary additional Admins remain possible; ordinary edits
remain ordinary Save. **That policy is not implemented by this repair.** No merge
or deployment is authorised or performed.
