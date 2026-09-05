# Story 2.7 — formal review triage

Date: 2026-09-05. Baseline: `7e47280f292535f65bbb78522e1a4965c76bb1f4`. Complete diff captured before staging at `C:/Users/opc/AppData/Local/Temp/intellifin-story27-review.diff` (225,627 bytes). All four reviewers were launched before collection/triage; runtime capacity allowed only two simultaneous fresh reviewers, so later layers started as slots became available.

Status: all twelve repairs implemented, independently reviewed and verified. Final gates passed: 1,922 unit, 192 PostgreSQL integration and 95 browser tests; typecheck, boundaries, migration/drift and builds passed. See the story's Auto Run Result and follow-up review.

The repair was interrupted by a full host disk. Five truncated forms were restored from Git and the captured pre-review diff before work stopped. After the owner freed space, implementation resumed on 2026-09-05. Temporary review captures and the old test database were cleared during cleanup; the retained findings below and Git baseline remain authoritative. A fresh isolated PostgreSQL 18 cluster is being used for final schema verification. Earlier passing tests describe the pre-repair checkpoint, not acceptance of the repaired code.

| ID | Severity | Route | Required repair |
|---|---|---|---|
| P1 | high | patch | Gate Submit on every editor's dirty/conflict/busy/unknown state and recheck at confirmation. |
| P2 | medium | patch | Show previous/current executable plan contents meaningfully. |
| P3 | medium | patch | Render submitted and approved definitions from their exact stored review snapshot. |
| P4 | medium | patch | Refuse an invalid predecessor instead of claiming first-version absence. |
| P5 | medium | patch | Validate unique known diff sections, after-values, flags and owning snapshot identity. |
| P6 | medium | patch | Add bounded stable cursor pagination for all delivered notifications, preserving privacy. |
| P7 | medium | patch | Identify notifications by Procedure name, version and time through owned contracts. |
| P8 | medium | patch | Add an accessible explicit refresh with honest delayed-delivery feedback. |
| P9 | low | patch | Index the pending delivery filter/order. |
| P10 | medium | patch | Keep past decisions and rejection rationale inspectable after resubmission. |
| P11 | medium | patch | Prove actual successor old/new field and plan rendering. |
| P12 | medium | patch | Prove Evidence and Schedule contributors cannot approve their edits. |

Counts: intent_gap 0; bad_spec 0; patch 12 (high 1, medium 10, low 1); defer 0; reject 2. Follow-up review required: one high finding and weighted score 31.

The two rejected suggestions are duplicating every nested domain validation in SQL despite the established shallow-CHECK/strict-reader boundary, and widening mobile review visibility contrary to the explicit desktop-only UX contract. The semantic review consistency repair remains required independently of that first rejection.

Notification timing/recipient semantics are resolved by loaded context. No frozen intent, recipient, state or approval-field change is required. Repairs complete existing wiring, durable-data validation, query access and verification; they do not require re-deriving the specification.


