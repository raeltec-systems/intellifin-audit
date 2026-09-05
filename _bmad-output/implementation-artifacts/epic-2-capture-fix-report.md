# Epic 2 follow-up: remove forced capture requirements

Removing the last agent-driven Target now removes the Structural Snapshot and screenshot requirements that the platform added. Values already chosen by the auditor or supplied by the Template remain.

## What changed

- Capture requirements record the authored snapshot and screenshot choices separately from their effective values.
- The evidence editor sends authored choices. Reloading, renaming an attribute, adding a requirement, or saving Targets again does not convert forced values into authored ones.
- Removing the last agent-driven Target restores those choices in the existing audited Target-save transaction. Registration changes that create platform Drafts use the same function.
- If removal leaves an attribute without grounding, the Draft remains readable and editable. Evidence save, plan derivation and submission require the auditor to supply grounding or explicitly declare model-read. The system does not invent an exemption.
- Audit evidence and row digests include the new provenance. Reviewed versions are not rewritten.

## Existing data

Older requirements did not record whether the auditor or platform selected a snapshot or screenshot. The fix preserves those values rather than guess. For an existing Draft with such values, remove the Target and edit the evidence choices once. Subsequent selections and removals use the recorded choices. No database migration or bulk rewrite is required; the optional provenance is stored in the existing JSON field.

## Verification

The regression coverage includes repeated Target saves, authored snapshot/screenshot combinations, legacy rows, malformed provenance, database reload, missing-grounding refusal, and the actual browser editor with dirty edits and reloads.

| Check | Result |
| --- | --- |
| Full unit suite | 81 files, 1,956 tests passed; one worker, 30-second per-test limit |
| Procedure PostgreSQL integration suite | 59 tests passed against the isolated PostgreSQL 18.6 test database, schema generation 14 |
| Real browser and WCAG checks | 5 passed: three authentication/setup checks and both evidence authoring journeys |
| TypeScript checks | Passed across the workspace and root tests |
| Package, worker and Northstar builds | Passed |
| Web production build | Passed, including TypeScript and route generation |
| Dependency boundaries | Clean workspace and forbidden-import cases passed in the unit suite |
| Delivery report | HTML structure and 11 link targets checked; whitespace check passed |

An earlier unit run had an authentication import timeout and ran the new grounding test against code still being updated. The focused rerun passed all 139 tests; the final full run above passed all 1,956. Those earlier failures are not counted as passes. Browser assertions and retries were not weakened.

## Decision and owner action

Preserve unknown legacy authorship; do not silently erase evidence requirements. Allow incomplete Drafts to be repaired while keeping plan and submission gates strict. These rules are also recorded in `CLAUDE.md`.

Review this fix with the Epic 2 changes. No further product choice is needed. Live-provider setup and release decisions from the main delivery report are unchanged.
