---
title: '21.3 — Install and select trusted skills'
type: feature
created: '2026-10-02'
status: done
story_key: 21-3-install-and-select-trusted-skills
baseline_commit: 643ed095314d42f576106effd287703824003c73
review_loop_iteration: 0
authorization: 'Owner authorised the 21.2–21.4 batch and routine engineering choices.'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/batch-21-2-21-4-build-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/story-21-3-capability-context.md'
---

<frozen-after-approval reason="owner-authorised canonical Story 21.3; verified producer checkpoint">

## Intent

**Problem:** Tasks cannot discover and select attributable firm techniques.

**Approach:** Admin installs versioned skills; scoped discovery and selection respect exact methodology and current Permissions.

## Boundaries & Constraints

**Always:** Explicit installation, immutable manifests/resources/digests, current authority, exact retries, inspectable selection and retained history. Preserve published schema prefixes and foundation controls. Admin configuration grants no audit access.

**Ask First:** Paid qualification, customer data, deployment or new authority policy.

**Never:** Evidence auto-installation, skill-provided privileges, fabricated permission probes, executable resource launch, model invocation or claims of execution.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Required result / refusal |
| --- | --- | --- |
| Catalog | Current Admin installs/edits/enables valid manifest | Atomic immutable version/resources, source/license/revision, scope, applicability and receipt; invalid input leaves prior state intact |
| Retry | Lost reply, changed meaning or stale revision | Exact replay; conflicts change nothing; recheck authority |
| Hostile source | Acquired instruction-like document/archive | Remains untrusted evidence; no catalog change or execution |
| Selection | Current audit actor, compatible exact method and skill | Record version/digest/reason and binding; optional selection never erases required methodology |
| Capabilities | Declared needs and accepted/current authority | Forbidden/unavailable needs refuse selection; compatible possibilities still require exact operation admission and any decision |
| Disable / recall | Older Task context or selection | Current restrictions prevent new selection/use; recall identifies affected selections; retain history and consumed receipts |
| Race | Concurrent selection, restriction, method or session change | Fresh serialized checks; stale expected basis refuses; prior receipt never grants current use |
| Scope | Foreign client, Admin-only or replaced identity | No audit disclosure or private-draft retention; catalog installation grants no source access |

</frozen-after-approval>

## Code Map

All code paths below are relative to `zobba/`; dependency: canonical Story 21.2.

- `crates/domain/src/{methodology,permissions}.rs` — version references and policy predicates.
- `crates/infrastructure/src/{methodology,operation,task}.rs` — current binding, accepted authority loaders and ordered locks; expose transaction-local inspection.
- `crates/application/src/{methodology,operation}.rs` — separate Admin/audit ports and operation gates.
- `web/src/{MethodologyWorkspace,TaskMethodology,ConversationWorkspace}.tsx` — Settings, inspection and recovery.
- New `skills.rs` modules, next migration/catalogue, API generation and bootstrap fixtures.

## Tasks & Acceptance

**Execution:**
- [x] `crates/{domain,application}/src/skills.rs`, `crates/domain/src/permissions.rs` — manifests, selection and capability inspection.
- [x] `crates/infrastructure/src/{skills,operation}.rs`, schema — catalog/status/selection and current-use transactions.
- [x] `crates/api/src/skills.rs`, `web/src` — structured authoring, discovery/selection and recovery.
- [x] `crates/*/tests`, `web/tests`, `README.md` — matrix, upgrade and browser evidence; consumer contract.

**Acceptance Criteria:**
- Given an installed vetted package, when Admin enables it, then scoped discovery exposes inputs, provenance, needs and applicable methods.
- Given instruction-like evidence, when acquired, then it remains untrusted and never installs automatically.
- Given disabled or forbidden needs, when selection/current-use eligibility runs, then it refuses despite old context; history remains inspectable.

## Spec Change Log

## Design Notes

Retain bounded UTF-8 resources/digests; scripts are inert. Use `TaskBasis.current`, its binding/epoch and requirement provenance, never latest assignments. Use server-owned tool/effect vocabulary; unqualified tools are unavailable. Record the actual selector; inspect needs against the Task's accepted actor/snapshot, never the viewer's substitute policy. Pure techniques need no operation acceptance.

Permissions intersects whole rule tuples and correlated recipient/classification alternatives across accepted/current hard bounds, delegation and source restrictions. Empty standing coverage is not denial. Bound regions/work; exhaustion is unavailable. Share predicates with exact evaluation. Compatibility needs exact details; selection creates no operation, decision or claim. Invocation must recheck eligibility and exact-operation gates.

Disable/recall work at capacity. Selection binds exact method/catalog revisions; no silent substitution. Distinguish selected from executed; preserve focus/drafts and exact retry.

## Verification

Run fmt, strict Clippy, Rust tests/build, web check/build/contracts, fixture/Python/boundaries, smoke and Chromium. Prove populated upgrade/prefix preservation, manifest/digest/Unicode/hostile fixtures, tuple/correlation/standing/widening/delegation/expiry/capacity, both restriction/selection race orders, actor separation, sessions, isolation and receipts. Browser-install/select/disable/recall with an old open view; inspect narrow layout. Record counts, limits and independent review.

All eleven verification gate families passed: 280 Rust tests/doc tests, 156 web tests, 56 fixture tests, 47 Python tests and 123 Chromium cases with zero retries, plus formatting, strict Clippy, builds, boundaries and process smoke. Three fresh review layers and independent repair/evidence closure are complete. Source manifests establish final coverage while preserving earlier failed and interrupted runs. See the [checkpoint and evidence](zobba-foundation-batch/STORY-21.3-CHECKPOINT.md). The separate methodology-draft follow-up remains assigned to Story 21.4 within this batch.

## Suggested Review Order

**Entry and provenance**

- Trace separate Admin configuration and scoped Task routes.
  [skills.rs:33](../../zobba/crates/api/src/skills.rs#L33)

- Preserve exact immutable resources and source attribution in the canonical manifest.
  [skills.rs:254](../../zobba/crates/domain/src/skills.rs#L254)

**Current authority and storage**

- Intersect complete permission tuples without fabricating an exact operation.
  [permissions.rs:716](../../zobba/crates/domain/src/permissions.rs#L716)

- Fence methodology, accepted authority, viewer and time after blocking reads.
  [skills.rs:229](../../zobba/crates/infrastructure/src/skills.rs#L229)

- Keep versions immutable and exact retries available at capacity.
  [0009_skills.sql:147](../../zobba/migrations/0009_skills.sql#L147)

- Recheck selection eligibility after staged writes and on historical receipt recovery.
  [skills.rs:702](../../zobba/crates/infrastructure/src/skills.rs#L702)

**Browser custody and workflow**

- Retain private drafts in bounded memory under exact actor and session ownership.
  [skills.ts:245](../../zobba/web/src/skills.ts#L245)

- Require fresh authorization for each activation before revealing retained content.
  [useSkillInspection.ts:6](../../zobba/web/src/useSkillInspection.ts#L6)

- Expose structured installation and immutable Edit with field-specific feedback.
  [SkillCatalog.tsx:16](../../zobba/web/src/SkillCatalog.tsx#L16)

- Find affected selections within the current engagement and open their exact Tasks.
  [TaskSkills.tsx:78](../../zobba/web/src/TaskSkills.tsx#L78)

**Verification**

- Exercise tuple correlation and explicit denials after shared comparison-budget exhaustion.
  [capability_tests.rs:234](../../zobba/crates/domain/src/permissions/capability_tests.rs#L234), [capability_tests.rs:864](../../zobba/crates/domain/src/permissions/capability_tests.rs#L864)

- Prove staged selection serializes policy and logout, with expiry rollback.
  [skills.rs:2190](../../zobba/crates/infrastructure/tests/skills.rs#L2190), [skills.rs:1111](../../zobba/crates/infrastructure/tests/skills.rs#L1111)

- Verify real-browser custody, current authorization and narrow navigation against the running foundation.
  [skills.spec.ts:1027](../../zobba/web/tests/browser/skills.spec.ts#L1027), [skills.spec.ts:871](../../zobba/web/tests/browser/skills.spec.ts#L871)
