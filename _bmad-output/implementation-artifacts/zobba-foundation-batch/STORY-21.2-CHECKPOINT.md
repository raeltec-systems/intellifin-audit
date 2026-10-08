# Story 21.2 — firm methodology checkpoint

**Story 21.2 is implemented and independently reviewed on `codex/zobba-foundation-batch`.** Baseline: `38d76b019db1e5cb637f8c66e6cde3947c3415b2`.

Admin can save attributable, immutable methodology, templates and applicability assignments, inspect the effect on existing work, and Undo through a successor. Ordinary Save needs no additional approver. Each Task keeps its exact requirements, template content, business period, contributing sources and binding reason.

A new-only edit preserves existing bindings. An explicit active-work change becomes pending, fences unused work and waits for consumed effects to reconcile before switching the Task's binding and execution epoch. Pause and Stop remain effective. Scheduled active changes include newly created Tasks and stopped Tasks continued before the cutoff. Historical operations and attempts retain their original producing binding and receipt rights. Recall blocks affected new use without rewriting those facts.

The browser provides structured Admin authoring and Task inspection. Auditors can supply initial audit context or correct it through attributed Guide. Unknown or conflicting criteria remain visible limitations. Neutral starter contributions remain labelled even when mixed with adopted firm content. Admin configuration access grants no audit access.

## Verification

The repaired frozen Rust source passed **225 tests/doc tests across 38 result sections**, including restricted-owner populated schema 7→8, real HTTP, PostgreSQL authority and concurrency contracts. Three helper entrypoints are intentionally ignored in direct enumeration and are actually spawned by passing parent contracts. All 14 published migration/catalogue files through schema 7 remain byte-identical.

Formatting, strict all-target Clippy and Rust build passed. Web checks passed **131 tests**, including generated-contract verification, and the production build passed. Python guards passed **47** tests; the identity fixture passed **56**; dependency boundaries passed. Process smoke passed: a second restricted-owner bootstrap, two CLI migrations, exact API/worker health, real database loss and recovery by the same processes. The final Chromium run passed **107 cases in 11.8 minutes, with zero retries**. Nine unchanged backend/schema/fixture gates are retained by exact source manifests; web check/build and the full browser suite were executed afresh after the final browser repair.

The repaired 106-case browser suite passed with zero retries. Earlier repair attempts exposed history-page synchronization and held-route cleanup gaps; the strengthened assertions and independent review are preserved. Final source scrutiny then found an actual inner-disclosure retention defect despite the green suite. An old-source negative control reproduces it, and the repaired four-case file passes with real network-failure and deadline controls. Simulated tab visibility is headless lifecycle evidence, not native OS tab qualification.

The first expanded 107-case run passed 105 and failed two. One failed the conversation-withdrawal phase without recording whether the current fault had been delivered; the other reports a request handler from the preceding metadata test still running at test end. The evidence handlers now drain before teardown, and the conversation test requires an observed snapshot abort/requestfailed before asserting withdrawal. The settled seven affected cases and the final 107-case suite pass. The earlier missed-trigger causal chain remains unproved; no product fix is inferred from a rerun. Failed attempts are retained as history, never counted as passing gates; raw failed outputs containing synthetic session headers remain private.

## Independent review

Three fresh BMAD review layers identified 15 defects. All were retained as bounded implementation or verification repairs. A second independent pass closes all 15 on the repaired source and execution evidence. Two further independent reviews close the inner-disclosure repair; their scope and proof limits remain explicit. Review does not substitute for the final full gates.

The repairs cover one captured activation cutoff, future Continue enrollment, exact historical templates and recall, substantive neutral provenance, and a final consumption fence after deferred database work. Browser repairs cover exact successor lineage, historical Edit, revoked-organisation recovery, immutable successor scope, explicit inherit/value/clear controls, optional labels, pagination and preserved prose contracts. New browser/HTTP assertions distinguish initial context from defaults and exercise an actual active-task form Save.

The deferred-consumption regression confirms the exact database lock barrier, crosses the real activation cutoff and proves the whole claim/receipt/event transaction rolls back. The original claim lease remains live, ruling out lease expiry as the refusal's cause. A subsequent fresh binding successfully consumes and records its receipt.

## Limits and next consumers

This story supplies methodology and attribution; it does not invoke models, execute skills or evaluate audit conclusions. Missing criteria block only dependent conclusions.

Capacity is bounded: 128 saved versions and 512 KiB aggregate configuration per organisation; 512 engagement assignment options; 1 MiB Task binding history. Each pending binding reserves 4,096 + 16 × aggregate saved configuration bytes. **Above 65,280 aggregate configuration bytes, one reservation exceeds 1 MiB even before existing history.** Existing history and queued changes lower that threshold. The catalogue ceiling therefore does not promise active-rebinding capacity. Refusals are explicit and atomic; exact replay, recall, original receipts and ordinary context-free Guide remain available.

Stories 21.3 and 21.4 are now eligible consumers of the verified methodology contract. No merge, deployment, cloud provisioning or provider qualification is included. Early real-computer qualification remains separately owner-gated by the existing named-environment and spend-ceiling proposal.

## Review evidence

Start with the [verification package](story-21.2/README.md), [final gates](story-21.2/repair-2/final-gates.json), [matrix](story-21.2/repair-2/matrix-execution.md), and [producer contract](story-21.2/integration-contract.md). The story specification contains a Suggested Review Order. Historical attempt and review notes retain their original stage scope; final dispositions reconcile them.
