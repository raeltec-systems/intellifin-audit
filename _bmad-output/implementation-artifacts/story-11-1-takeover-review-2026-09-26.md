# Story 11.1 takeover review — 26 September 2026

Reviewed remote PR #54 at `9976cf0ca68e088320a7615afcf67dd672194bff`, base/main `429e08cf703fee6c5320f17b5983948709fd5bdf`. Remote state was fetched before inspection. PR remains draft and unmerged. No production change was needed from this review.

## Result and evidence

The independent read-only review and coordinating review found no new high-confidence defect within the inventory-only scope. Reviewed the story, tenancy contract, shared parser, unit/database classification tests, mutation harness and changed-file scope against repository rules and current tracking. Story specification `done` records build completion; sprint `review` records submitted review. Neither is owner acceptance of the proposals. Leave both and the draft PR intact.

Locally rerun with Node 24.20.0 and pnpm 11.25.0: `pnpm exec vitest run tests/unit/tenancy-inventory.test.ts` — **55/55 passed**. Installation used the frozen lockfile. GitHub run **36201005831** on the reviewed head was separately fetched: **all seven jobs succeeded**. Historical database and mutation results in the Story 11.1 record were not rerun here. The managed local environment rejects the OS user/group transition required to start disposable PostgreSQL; no external database was used.

These tests prove inventory/catalogue consistency. They neither install nor execute RLS. Future positive tests must assert receipts, narration, chain advancement and other side rows; a policy-hidden row can suppress those without failing the main operation. No contract proposal has been approved by this review.

## Exact prerequisites for 11.2

| Prerequisite | Required before implementation |
|---|---|
| D1/D2/D4/D5 | Confirm or supersede client-level Procedures/configuration receipts, request ownership/client scoping, and tenant role/grant ownership before choosing columns and keys. D3/D6/D7 remain proposals too. |
| O1 | Decide how global `platform` and `procedure-platform-configuration` chains and events without a tenant member receive scope; preserve historical event bytes. |
| O2/O3 | Decide bootstrap access and legacy Run engagement binding. Recommendation for O3: explicitly bind legacy Runs to a designated legacy engagement, preserving same-client engagement isolation. The alternative is an explicit isolation exception for client-level Runs; it cannot be described as meeting the current guarantee. Neither option is approved here. |
| O4 | Specify composite tenant role/grant keys and migration compatibility; keep principal resolution with its owning story. |
| Story 10.3 | Technical package rename dependency still precedes new Epic 11 product modules. No external rename is authorised. |
| Proof | Write the per-table populated backfill map and upgrade/rollback proof, plus a cross-scope composite-FK rejection test. Do not write a migration before the unresolved boundaries are settled. |

O5–O7 (maintenance roles, privileged guard functions and release authority) need explicit owner architecture decisions before their owning stories. O8/O9 require concrete privilege and maintenance-sweep designs there. None blocks independently authorised Stories 10.6–10.10.

Frozen-spec amendment for owner approval: replace the locking-read parenthesis with “a locking read, which PostgreSQL grants only with SELECT and UPDATE privileges and applies the SELECT and UPDATE policies’ USING predicates.” The frozen text is unchanged pending approval.

## Continuation

Current branch listing and recent PRs contained no pushed implementation corresponding to Stories 10.6–10.10. This does not recover or rule out Claude's unpushed work. The owner's 26 September continuation instruction and PR #54 supersede their 25 September preparation-only flags.

Next executable work: Story 10.7 on `codex/story-10-7-live-channel`, based directly on `429e08cf703fee6c5320f17b5983948709fd5bdf`. Its Run notification and trailing bell-refresh changes are independent of this PR. Do not merge, deploy, expand PR #54, or begin tenancy privilege/schema changes from this record.
