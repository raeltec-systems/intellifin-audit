# Independent verification review — original findings

Review source: `complete.diff`, SHA-256 `c1e00eee524c52666eb12bdf2303b6fde196d66ce9e2bf984c81c70734ba3e24`. This is the reviewer's result, not the final disposition.

## Tool mapping verification derives its expected result from the implementation

- Changed surface: Tool identifiers map to Permissions purpose/action pairs in `zobba/crates/domain/src/skills.rs:64`.
- Impacted consumer or site: `SkillsRepository::eligibility` uses those mappings at `zobba/crates/infrastructure/src/skills.rs:334`.
- Existing test evidence: Broken-verification gap. The vocabulary test compares `capability_need()` against `tool.mapping()` at `zobba/crates/domain/src/skills/tests.rs:196`; both obtain their answer from the same mapping. The cross-contract corpus constructs `CapabilityNeed` directly at `zobba/crates/domain/src/permissions/capability_tests.rs:25`. Whole-repository searches found no independent behavioral assertion for that mapping; API checks only vocabulary strings.
- Missing verification: Assert intended purpose/action independently and observe compatibility against distinguishing policy bounds.
- Demonstration: Changing `TestWriteV1` from `Action::Write` to `Action::Read` leaves the vocabulary assertion passing. None of the other tests read exercises that tool against read-only test authority.
- Consequence: A declared write need could receive the wrong explanation or become selectable through the qualified repository using only read compatibility.
- Suggested test: Explicit expected mapping tuples plus repository test where test reads are permitted and test writes forbidden.

## Aggregate storage byte limits are assumed by response verification but not exercised

- Changed surface: Cumulative 2MiB installation commands at `0009_skills.sql:92`; cumulative 1MiB Task receipts at `:173`.
- Impacted consumer: Catalog and Task discovery use8MiB browser response bound through `web/src/skills.ts:105`.
- Existing evidence: Regression gap. `infrastructure/tests/skills.rs:1171` fills128 small installations; selection fixture at`:1314` seeds128 receipts. Both hit count guard. Envelope test `web/tests/skills.test.mjs:188` supplies padding assuming byte budgets and tests only response reading. Whole-repository search found no additional cumulative-byte refusal coverage.
- Missing verification: Byte-cap refusal below128 records, atomically preserving prior state.
- Demonstration: Removing cumulative-byte predicates and regenerating catalog leaves existing capacity/envelope assertions passing.
- Consequence: Individually valid records could accumulate beyond budgets, making catalog/discovery exceed browser limit and unreadable.
- Suggested test: Each byte boundary below count ceiling; refusal, unchanged revisions/history, continued restriction and exact retry.

## Browser edit-as-new-version branch has no behavioral coverage

- Changed surface: Edit clones installed command, renews key/revision, clears version and disables at `web/src/SkillCatalog.tsx:33`.
- Impacted consumer: “Edit as new skill version” invokes it at`:77`.
- Existing evidence: Regression gap. Browser authoring test at`web/tests/browser/skills.spec.ts:196` uses `fillInstall` clicking separate Install control at`:83`. None of eight cases invokes Edit. Node tests import transport/parser only. Whole-repository search found no behavioral branch coverage.
- Missing verification: Edit preserves installed scope, applicability, provenance, needs and resource bytes while producing separate immutable version.
- Demonstration: Changing Edit to call `edit()` without installed version opens blank form while existing checked tests pass.
- Consequence: Admin could lose package content when revising despite tested fresh installation.
- Suggested test: UI edit/save distinct version; preserved untouched fields plus unchanged original content/selection history.
