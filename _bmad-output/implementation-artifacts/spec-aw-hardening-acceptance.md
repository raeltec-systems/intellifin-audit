---
title: 'AW P5: recovery, rollback and measured combined acceptance'
type: feature
created: '2026-09-20'
status: draft
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

## Intent

Complete the remaining automated recovery, race, rollback, privacy and capacity evidence after the functional slices. Preserve an explicit distinction between implemented behavior, local synthetic proof, remote CI proof, provider acceptance and human acceptance. Passing isolated tests must not close G1–G7.

## Constraints

- Use disposable synthetic PostgreSQL 18 databases and exact worker/web builds. Never use production data or deploy as part of this slice.
- D2 must define retention, sensitive-content removal, exports, provider deletion, legal holds and incidents before implementing or claiming the real-data lifecycle. A direct SQL tombstone fixture does not prove an authorized removal workflow.
- D3 manager transfer was approved on 20 September 2026; race tests must use its implemented, separately granted permission or ordinary authorized release/acquire. Do not infer a grant from the manager role alone.
- G1 requires the specified moderated auditor study. G3 requires actual supported provider capability and private-pixel containment proof. Synthetic tests cannot substitute for either.
- Report measured observations and workload configuration; never invent capacity thresholds or declare a staging benchmark representative of an unmeasured deployment.

## Recovery matrix

Exercise real process death around authoritative transactions and queue delivery, using existing test barriers rather than arbitrary sleeps:

| Failure point | Required surviving behavior |
|---|---|
| Web commits, then exits before response or notification handoff | Retained command can be reconciled; no repeated authoritative effect |
| Worker claims queue work, exits before domain apply | Lease expiry/redelivery recovers under a new fence |
| Domain effect commits before delivery acknowledgement | Redelivery reads exact retained effect; no duplicate observation/receipt/Result |
| External dispatch outcome is unknown | Truthful uncertain outcome; stale worker completion refused; no exactly-once network claim |
| Two deliveries and an old worker complete concurrently | One fenced committed effect and consistent evidence/history |
| Stop, Pause, deferred pause, answer, revocation and lease transition race | Accepted safety holds survive; stale discretionary input cannot override them |
| Browser disconnects from live updates | Fresh server-authorized safety route remains usable under its existing authority rules |

Reuse `tests/integration/{run-conversation,agent-work-repository,population,plan-recovery}.test.ts` and real worker lifecycle helpers in `tests/e2e/{prodconsole-agent-journey,population}.spec.ts`. Add failures only at meaningful boundaries; report each actual process and exact durable assertions.

## Rollout and rollback contract

The current release workflow claims old processes continue serving across additive migrations, while runtime schema ranges are exact. Resolve this discrepancy in code and operational documentation before claiming AT-59. Prefer an explicit, tested drain-and-reconcile path for any incompatible compiler, command or authentication contract; widen schema compatibility only when old and new binaries actually pass the same shared-schema drill. Do not weaken startup refusal to make a test green.

Build the prior and candidate exact SHAs and test against a single disposable database. Cover intake disable/drain before migration, pending Stop/Pause/answer/renewal recovery, unsupported-command refusal, old/new handlers, failed startup, rollback reconciliation, retained safety holds/history and private-handoff recovery. Record which rollback images are supported and any maintenance window. Ensure the release workflow cannot silently execute a rollout that contradicts that contract. No production rollout is part of this verification.

## Complete record-query evidence

Retain actual current-schema `EXPLAIN ANALYZE` and measured timings for the full bounded review queries, including multi-target rows and selected Replay beyond the ordinary loading limit. Exercise browser paging during execution updates, stable cursor membership, expiration, role change and explicit refresh. Measure rows, locks, query latency and connections; do not infer browser usability from SQL plans.

## Capacity harness

Create a reproducible synthetic staging harness with deterministic seed/cleanup and a structured output artifact. Use the workload declared in the workspace specification: 10 concurrent Runs, five viewers each, 1,000 review rows, 20,000 transcript entries and 30 minutes of steady state. Include reconnects, model delay, evidence failures, cold/warm caches and constrained clients (150 ms / 10 Mbps). Expose smaller smoke settings without presenting them as full acceptance.

Measure p50/p95/p99 safety/control/chat/read/preview latency, errors, queue depth, database connections/locks, CPU/memory, bandwidth and capture latency. Prove one sampler per Run. Under pressure, coalesce/drop preview first and preserve admission for safety/control independently of explanation generation. Store environment, exact SHA, settings, sample counts and failed intervals with results. Run the declared workload before closing capacity evidence; CI smoke alone is insufficient.

## Combined acceptance and governance

Map AT-01–60 to exact test names, commands, SHAs and artifacts after all dependent slices. Run one composed auditor journey through conversation, exact question, safety/Resume, frozen fallback, record/history/Replay, private authentication and recovery where the synthetic capability supports it. Separately list provider-only, policy-only and moderated-study requirements. Include delayed/out-of-order event narration and two viewers without switching either viewer's historical record selection.

After approved D2, implement the authorized removal operation and exercise encrypted bodies, generation context, metadata, evidence, browser/cache layers, notifications, exports and provider data with retained audit tombstones. Until then, keep real-data handling disabled and retain the concrete proposed lifecycle as the decision surface.

## Verification and reporting

Run typecheck, dependency boundaries, unit tests, schema generation, fresh-database migrations/integration and focused then full browser suites. Re-run only checks affected by subsequent changes. Run the mixed-version drill and full workload independently of routine tests. Update the continuation report and gate register with actual results and remaining human actions; no merge or deployment.
