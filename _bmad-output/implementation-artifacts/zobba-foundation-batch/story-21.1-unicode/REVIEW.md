# Independent repair review

Three same-capability reviewers independently read the complete tracked and
untracked repair diff: blind implementation, edge cases and verification gaps.
All three were launched before collection and triage. They inspected the actual
test paths and local receipts, not only the summary. No production-validation
blocker was identified. Follow-up source and final evidence rechecks found no remaining repair blocker.

## Accepted verification and packaging patches

| Finding | Consequence | Repair |
| --- | --- | --- |
| Ignored `.log` files omitted from the review diff | Medium: remote evidence links would be broken | Archive bounded raw logs under tracked `.txt` filenames; verify link targets and final Git inventory. |
| Replay output directory assumed to exist | Low: clean replay fails before testing | Create the directory before redirection and run final checks into a fresh directory. |
| Negative command could run repaired production | Medium: passing current code could be mislabeled a baseline control | Guard both production files against the baseline; document isolated reconstruction and filtered negative-unit execution. |
| New source-entry case used an ordinary filename | Low: fresh affected-filename acquisition lacked browser coverage | Use a leading-U+FEFF filename and assert the outgoing value. |
| Safe download name lacked an assertion for affected fixtures | Low: bytes alone would not prove attachment behaviour | Assert concrete expected suggested names separately from immutable metadata. |
| Console receipt preceded its failing assertion | Medium: a failed hook could leave a passing receipt | Make the receipt outcome include console/page failures. |
| Red/green artifact paths overlapped | Low: a later run could overwrite earlier receipts | Derive Unicode artifacts from the selected run's Playwright output directory. |
| Screenshot showed only the normal row | Low: visual evidence did not show an affected item | Capture affected rows or affected details as well. |

These are bounded patches within the accepted repair scope. They do not change
the frozen intent, Rust acceptance, schema, stored values or Admin policy.

## Pre-existing follow-ups

Two independent observations are recorded in [deferred work](../../deferred-work.md):
malformed UTF-16 wire-string parity and an accessible display description for
filenames consisting entirely of invisible characters. They predate this fix
(including already accepted invisible characters other than U+FEFF); neither is
presented as completed. Raw accepted metadata and byte access are qualified here.

The Admin-expiry question remains the separate [owner decision](../ADMIN-EXPIRY-OWNER-DECISION.md).

## Final independent recheck

The reviewer confirmed six matching current source hashes, the full-run source
snapshot and exact one-line cursor delta, completed 57/57 and separate 3/3 exit-0
runs, twelve baseline-identical schema files, working report links and Git-visible
archive files. The affected screenshot shows all five rows. The [final result](final-verification.md)
reports no verification gaps. The earlier [source recheck](blind-recheck.md)
accurately recorded then-pending archive work; the final check closes those items.
