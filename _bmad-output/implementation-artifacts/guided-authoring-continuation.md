# Guided authoring continuation

## Owner-authorised release follow-up — 2026-09-11

After the independent-review handoff below, the owner explicitly authorised merging
PR #30 into main and observing its Railway deployment for owner testing. This supersedes
the initial handoff's instruction to leave this delivery unmerged and undeployed.

PR #29 has now been squash-merged. Current main is
`11736cb778923c61ae1f5a561d11d14fd56afca8`; its complete tree was verified identical
to parent `82a762262ff46709aad7ee0af522d85e37715098`. The clean three-way combination
of that parent with delivered head `28fa0efa35a65700ce8a554b61165515b88b1d9b` has
code tree `199a954d558c51fe3ecad04e7681d7b2c52128ba`. This tree incorporates all final
Epic 5 fixes while preserving the guided-authoring changes. The integration commit
records both the delivered feature head and current main as parents; no parent branch
is rewritten. PR #30 is being retargeted to main and all required hosted gates rerun.

Local integration verification passed the complete pinned typecheck, 590-module boundary
check and all 4,101 unit tests across 203 files. The full suite ran in an isolated checkout:
the synchronized workspace's first attempt had two boundary-fixture failures involving a
disappearing `.rsync-tmp` file; the isolated run passed without changing source or assertions.

Railway already holds `OPENAI_API_KEY` on the worker. The web service's dedicated
`AUTHORING_OPENAI_API_KEY` is now configured as a Railway reference to that existing
variable, with immediate redeployment disabled so the release retains migrate-before-deploy
ordering. No secret value was retrieved, copied into files or printed. The authoring model
remains `gpt-5.6-terra`, independently configured from plan checking and Run execution.

Final tested/pushed SHA, CI results, merge SHA and observed Railway deployment results
will be pinned in PR #30 after completion. Configuration presence is not live-model evidence;
the owner's real-response testing remains distinct from synthetic CI results.

## Initial delivery and baseline

Stories **2.15, 2.9 and 2.10 are implemented** on `codex/epic-2-guided-authoring`.
Review [draft PR #30](https://github.com/raeltec-systems/intellifin-audit/pull/30),
targeting `codex/epic-5-controls`. Parent PR #29 was rechecked on 2026-09-11:
open and unmerged at `2ab2995e154885e006985cf49fb43f83ec32d878`, the actual baseline.
Main was `55b61e2d5c24aeabe804279e8d41ef6e64ed3097`.

During final verification the parent advanced to `3ab917a5a2f2ad7a3b6395c41256114ddda16fc3`.
Its only change is `review-epic-5-stories.md`; application code and instructions are unchanged.
That documentation is incorporated through a merge into this feature branch, preserving both
histories. PR #29 remains open/unmerged. Its separate review findings are not absorbed into
this preparation slice. The final head includes the current parent so the CI merge tree and
feature tree contain the same files. The actual implementation baseline remains the original
`2ab2995e154885e006985cf49fb43f83ec32d878`.

The initial checkout was clean; the feature branch did not exist. No user work was
discarded. The parent, main and old Epic 2 branch were not modified. No pull request was merged; nothing was
deployed or run against production. CI's base filter includes the stacked parent;
the main-only release trigger is unchanged.

See [the implementation report](guided-authoring-implementation-report.md) for delivered
behavior, safeguards, acceptance evidence and actual UI captures; see
[the slice specification](spec-2-guided-authoring-slice.md) for acceptance criteria.

## Published checkpoints

| Commit | Scope |
| --- | --- |
| `65c1615a7bda06b92f123ee5330b37f292431f44` | 2.15: Template source contract, context editing, persistence, lifecycle and review comparison. |
| `22da7d0f27b07e72aef5304c0df78dfe03db66ea` | Enable the existing CI gates for this stacked PR base. |
| `62e97c4ace1d68df769dcba484089c318630aa72` | 2.9: guided preparation, saved-content review acknowledgements and migration 48. |
| `f9b6962c6c0146f37b2293b82748187f1ce7d428` | Native outline/hydration behavior and historical upgrade fixtures. |
| `181722d67084f525d250e64d3d17b74cf624e060` | Historical JSON and preceding-schema fixture corrections. |
| `bd7bcdad0cdd359fc2c52ced1543b54e8263b038` | 2.10: bounded OpenAI operation, receipt persistence, acceptance, UI and migration 49. |
| `fe9b991ff55c55c3270da522e27587dedadd7720` | Refuse recognised credential prose and enforce Objective limits. |
| `e7e786e582b9b0fbea872c2e6eeabb52b4bea4c2` | Disable editing until hydration; preserve browser dirty/focus contracts; strengthen submitted-response assertions. |
| `5d9be5667d317a4fd413221cc9e167f3fb30c6d1` | Retain actual browser captures under named PNG paths. |
| `ab41d7bbc47d2e7b8f75f9f53ee41042aba3aaf0` | Dispose the active browser page after a native Playwright timeout. |
| `ff527a0ed62ebe8743f35296bfcd6d2d59e7b4ae` | Actual review navigation, persisted mobile saves, help-button wrapping and location-neutral copy. |
| `abe27cab8ff323a2d15a090022b721153e6f283f` | Implementation report and six inspected original captures with provenance. |
| `18b1eac961c77dde7a932d3b90f32eec2c3eaeb9` | Preserve known late-response usage after rejection without keeping or applying its proposal. |

The authenticated GitHub connector publishes these commits because CLI Git has no push
credential. Each blob and resulting tree SHA was verified against the local tested tree.
Original local commits remain under checkpoint refs; only this feature ref advances.
The screenshot checkpoint's tree is `d4f40a81fdac10a1925c70fe23125efc1c70e0f5`.

## Verification evidence

Use the repository's **Node 24.20.0 / pnpm 11.25.0**, frozen lockfile. Installed model
dependencies remain ai 7.0.89, @ai-sdk/openai 4.0.58 and @ai-sdk/anthropic 4.0.47.

- Local first context checkpoint: 4,002 unit tests, typecheck and 575-module boundaries passed.
- Local complete authoring tree `b08b8cb098f58f7b96860e2e2a221508e4603833`:
  all 4,087 unit tests across 203 files, typecheck, 590-module boundaries, build and
  no-drift schema generation passed. The full unit run used an isolated copy because
  workspace synchronization could create disappearing files during planted-boundary tests.
- Local correction tree `67c980fa226f921eaccaaa80348e5c920090abba`:
  68 focused tests, typecheck and boundaries passed. Separate Guided/Evidence checks passed
  24 tests, keeping the dirty-state and keyboard assertions.
- Hosted [run 34598654756](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34598654756)
  on `5d9be5667d317a4fd413221cc9e167f3fb30c6d1`: typecheck, boundaries and **4,097 units**
  passed; PostgreSQL 18 migrations, no-drift generation and **549 integration tests** passed,
  including populated upgrades and immutable legacy definitions. All **22 database/browser
  guard mutations** and **7 hydrated UI/worker abuse mutations** were detected. Containers
  passed. The focused guided/owner/writing browser step passed all **8 cases** including setup.
  Full browser/accessibility: **186 passed, 8 failed, 1 skipped**. Two obsolete expectations
  (hidden Submit and absent mobile save) caused the initial failures; the restarted worker
  lost shared fixture names and caused the remaining failures. The correction preserves
  all validation assertions and proves a mobile save after reload.
- Final code tree `7eb103cb59e534c7518c0f982427dd274958d498` at `ff527a0e…` passed
  **105 focused units**, the complete pinned typecheck and 590-module boundaries locally.
  Exact final-head hosted results are pinned in PR #30 after completion, without moving
  the tested head merely to record those results.
- Live OpenAI: **blocked, zero live calls**. No dedicated authoring credential is configured.
  The live verification script exited 2 with an explicit blocked result. Synthetic command,
  SDK transport and browser responses do not prove provider access or wording faithfulness.

Hosted [run 34601457170](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34601457170)
on exact pushed `abe27cab8ff323a2d15a090022b721153e6f283f` completed with **all five jobs green**:
4,098 unit tests, typecheck and boundaries; all 549 PostgreSQL integration cases, migrations
and populated upgrades; all container checks; all **195 browser/accessibility tests with no
failures or skips** plus 8 focused cases; and all 29 guard mutations detected. The full suite
now proves the corrected real review navigation and persisted mobile save.

The late-response accounting correction has tree `029b7a0542b2b748d9667b4109a39748c74b5257`
(local original `3158d1b4457cbb56f199737b7978601ae802cbda`). All 38 authoring command
tests and the pinned typecheck passed. The strengthened rejection test verifies known usage
in the receipt/audit, no retained proposal, exact unchanged procedure content, no plan job
and refused acceptance. It changes metadata accounting only.

Earlier runs found historical fixtures using new columns too early, obsolete UI locators,
pre-hydration input races and an inconsistent completed-receipt assertion. These were corrected
without loosening preservation, dirty-state, focus or acceptance guards. Cancelled intermediate
browser jobs are not counted as passing. Full historical details remain in prior log revisions.

## Isolated browser cleanup correction

A previous PostgreSQL job on `e7e786e…` exposed an existing native-timeout race: Playwright
can time out just before the outer action deadline, leaving the page open. The correction
recognises the installed Playwright TimeoutError and disposes that page. Existing
40ms/500ms/300ms integration assertions, execution policy and model settings are unchanged.
A deterministic unit forces the native timeout while the outer budget still has time.

Local commit `e8e3cf8a702adbc103a5ba1fdbbe7bd64efba2c2`, tree
`e14f73f16c5bb7181db0b7e92ac50694d275b00e`, passed all 37 focused browser-execution
units and root test typechecking. Equivalent remote object
`ab41d7bbc47d2e7b8f75f9f53ee41042aba3aaf0` has the identical verified tree.

## Decisions and remaining review

- Review acknowledgements record the human and saved revision/content basis; generation and
  saving never imply review. Conservative dependency invalidation is explicit, preserving
  safe unrelated reviews. Submission keeps the existing whole-version auditor assent,
  required fields and plan readiness; no historical approved version gains new prerequisites.
- AI acceptance uses the existing authorised, concurrency-checked draft command and records
  the human, including an identical-wording acceptance. Unknown authorship cannot bypass
  independent approval. Receipt identity includes lifecycle history, so submit/reject cannot
  revive an old suggestion. Rejected and stale suggestions never overwrite newer content.
- Only Objective, Scope note and per-system Audit instructions have writing assistance.
  The compiler remains authoritative. No new approval state, activation path or Run shortcut.
- Migrations 48/49 preserve missing historical context and approved definitions. Template
  edits do not retroactively change versions. References stay unset when not supplied.
- Configure `AUTHORING_OPENAI_API_KEY` only as a web-service server secret, with access to
  `gpt-5.6-terra`; see [secure setup and six-case live review](guided-authoring-openai.md).
  Plan-check and Run model settings are independent. Manual writing works with no key.
- Bounded suggestion receipts currently remain until their version is deleted. Acceptance
  expiry is not retention deletion. Recognised-secret checks are bounded, not general DLP.
- Stories 2.11–2.14 remain subsequent work: broader improvements, full dependency tooling,
  manager section comments and reference-document capabilities. No ingestion or scheduler.

Six original hosted PNGs were inspected and retained with SHA-256 hashes, dimensions and
source commit/job in `guided-authoring-screenshots/manifest.json`. They show the actual
proposal, stale and clarification states, mobile layout, auditor review and manager review.
The refreshed captures come from fully passing `abe27cab…` and include the wrapping/copy
corrections. The subsequent usage-accounting patch does not change these UI surfaces.

Next for the independent reviewer: inspect the exact tested head and complete hosted gate
results pinned in PR #30, then review the application acceptance/author identity transaction,
conservative acknowledgement invalidation and migrations. Live provider quality requires
secure configuration and human review of the six synthetic cases. Do not claim compiler-proven
semantic equivalence. Do not merge or deploy as part of this assignment.
