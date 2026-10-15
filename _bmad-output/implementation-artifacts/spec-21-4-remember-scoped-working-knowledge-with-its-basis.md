---
title: '21.4 — Remember scoped working knowledge with its basis'
type: feature
created: '2026-10-02'
status: done
story_key: 21-4-remember-scoped-working-knowledge-with-its-basis
baseline_commit: d38e1daed736415ef13e7606345dac71bd1d9f01
review_loop_iteration: 0
authorization: 'Owner authorised this batch and routine engineering.'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/batch-21-2-21-4-build-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/story-21-4-knowledge-context.md'
---

<frozen-after-approval reason="owner-authorised canonical Story 21.4; verified producer checkpoints">

## Intent

**Problem:** Later Tasks lack supported, durable working context.

**Approach:** Record typed knowledge with basis, current eligibility and correction dependencies.

## Boundaries & Constraints

**Always:** Attribution, exact source/version/location, distinct personal/firm/client/engagement scope, period, certainty and validity; current source access before ranking/disclosure; immutable history and existing Task authority.

**Ask First:** Paid qualification, customer data, deployment or broader publication authority.

**Never:** Memory-approval inbox, cross-client inference, unsupported certainty, generic private-text declassification, second Task/configuration writer or model-inference claims.

## I/O & Edge-Case Matrix

| Scenario | Input / state | Required result / refusal |
| --- | --- | --- |
| Direction | Accepted Guide/retry | Atomic attributed projection; original Task/cycle and received/applied standing, not universal instruction |
| Acquisition | Supported text/asserted metadata | Automatic bounded observation and distinct assertions; exact identity/range/digest/coverage; unsupported format has an omission |
| Preference | Repeated display choices | Real owner-private learning, application, inspect/Undo; consumed observations cannot recreate it |
| Retrieval | Later Task/query/period | Filter current source/destination access and validity before ranking; return basis/status/omissions; empty is not absence |
| Correction | Knowledge/source successor | Attribution, bounded transitive invalidation, cycle refusal; originals unchanged; live direction uses Guide |
| Promotion | Own typed preference/same-client destination | Explicit exact release/reuse and current authority; retain source ACLs, no Task grant or firm publication |
| Revocation | Removed scope/session/source | Exclude protected text/provenance, previews and derived context before disclosure |
| Forget / Undo | Eligible exclusion/withdrawal | Remove future context; expose retained history; personal Undo withdraws active publications, preserving audit facts |
| Draft interruption | Unsent methodology edit/recall and actual session outage | Exact-owner memory custody; own fresh authorization before recovery; replacement/denial discards; no automatic submission |
| Retry / races | Lost reply/stale revision/concurrent correction | Exact recovery, changed-meaning conflict, atomic dependencies; receipts cannot restore invalid use |

</frozen-after-approval>

## Code Map

Paths below are relative to `zobba/`.

- `crates/infrastructure/src/task.rs:admit` — sole Guide writer; atomic projection by command identity.
- `crates/application/src/evidence.rs:{acquire,read_original}`, `infrastructure/src/evidence/mod.rs:register` — verified bytes; implement derivative recovery beyond early receipt replay.
- `crates/infrastructure/src/methodology.rs:{current_binding,binding_at_execution_epoch}`, `skills.rs:current_use` — current/historical producer basis, never cached grants.
- `crates/domain/src/task.rs:TaskSnapshot.accountable_actor`, `infrastructure/src/scope.rs` — Task consumer and separate viewer/source authority; external acceptance is not required.
- `web/src/{ConversationWorkspace,TaskMethodology,TaskSkills,EvidenceWorkspace}.tsx` — Expand/Reduce, producer inspection and source navigation; additive schema 0010.

## Tasks & Acceptance

**Execution:**
- [x] `crates/{domain,application}/src/knowledge.rs` — records, retrieval/dependencies, mutation and inference.
- [x] `crates/infrastructure/src/{knowledge,task}.rs` and `evidence/mod.rs`, schema — producers, scoped mutations and disclosure.
- [x] `crates/api/src/knowledge.rs`, `web/src` — What Zobba is using, correction/exclusion/Undo, destination reuse and the scoped batch draft repair.
- [x] `crates/*/tests`, `web/tests`, `README.md` — matrix, automatic capture/learning and upgrade/browser evidence.

**Acceptance Criteria:**
- Given recorded decisions/observations, when later Tasks retrieve them, then source, author, scope and status accompany them.
- Given an inferred harmless preference, when saved, then the owner can inspect and Undo without approval paperwork.
- Given corrected/revoked support, when queried, then stale support is invalidated and inaccessible material excluded.

## Spec Change Log

## Design Notes

Keep exact source text, assertions and decisions distinct. Learn layout from explicit controls; Undo consumes observations. Reuse preserves source/destination access; firm context stays Admin configuration. Corrections retain originals and invalidate dependents. Bounded retrieval needs exact lookup and working capture recovery. Preserve Unicode/byte boundaries and reauthorize after I/O.

## Verification

Run fmt, strict Clippy, Rust tests/build, web check/build/contracts, fixture/Python/boundaries, smoke and Chromium. Cover every matrix row, upgrade/prefix integrity, automatic capture/learning, positive reuse and isolation, correction cycles, current-authority races and capacity/recovery. Inspect narrow navigation. Record executed counts, legacy coverage, limits and independent review.

## Suggested Review Order

**Task context and immutable basis**

- Start with the Task inspector that joins methodology, skills and scoped knowledge.
  [TaskKnowledge.tsx:75](../../zobba/web/src/TaskKnowledge.tsx#L75)

- Typed records preserve source, attribution, applicability and uncertainty.
  [knowledge.rs:191](../../zobba/crates/application/src/knowledge.rs#L191)

- Dependency rules reject cycles and invalidate descendants without rewriting original facts.
  [knowledge.rs:108](../../zobba/crates/domain/src/knowledge.rs#L108)

**Authority, persistence and producers**

- Fresh source and destination checks gate disclosure and exact command recovery.
  [knowledge.rs:1060](../../zobba/crates/infrastructure/src/knowledge.rs#L1060)

- Schema ten adds durable knowledge while preserving published migrations and catalogues.
  [0010_knowledge.sql:1](../../zobba/migrations/0010_knowledge.sql#L1)

- Verified originals create bounded observations with exact immutable byte references.
  [evidence.rs:138](../../zobba/crates/application/src/evidence.rs#L138)

- Recovery revisits accepted originals without inventing historical captures or duplicating records.
  [knowledge.rs:1917](../../zobba/crates/infrastructure/src/knowledge.rs#L1917)

**Correction, preferences and interruption**

- Explicit support controls retain current authority and the original assertion basis.
  [KnowledgeSupport.tsx:20](../../zobba/web/src/KnowledgeSupport.tsx#L20)

- Private learned layout remains inspectable, reversible and separately releasable.
  [InspectionPreference.tsx:37](../../zobba/web/src/InspectionPreference.tsx#L37)

- Exact-session custody restores unsent methodology edits only after fresh organisation authority.
  [MethodologyWorkspace.tsx:20](../../zobba/web/src/MethodologyWorkspace.tsx#L20)

**Executed contracts and browser proof**

- PostgreSQL tests cover producer atomicity, dependencies, authority and idempotent recovery.
  [knowledge.rs:1](../../zobba/crates/infrastructure/tests/knowledge.rs#L1)

- Browser cases exercise correction, source withdrawal, reuse and exact-request recovery.
  [knowledge.spec.ts:1](../../zobba/web/tests/browser/knowledge.spec.ts#L1)

- A real schema-nine acquisition survives migration, API restart and current UI recovery.
  [knowledge.spec.ts:24](../../zobba/web/tests/upgrade/knowledge.spec.ts#L24)

- Draft interruption proof includes actual outages, fresh reads and account replacement.
  [methodology-custody.spec.ts:91](../../zobba/web/tests/browser/methodology-custody.spec.ts#L91)
