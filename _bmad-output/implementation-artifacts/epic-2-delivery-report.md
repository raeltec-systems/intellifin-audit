# Epic 2 delivery report

**Implemented and verified locally — 5 September 2026. Final branch CI is pending.** All eight stories are complete. [PR 21](https://github.com/raeltec-systems/intellifin-audit/pull/21) contains the delivery. The [HTML report](epic-2-delivery-report.html) is a standalone version of this overview.

## What you can do

- Create an Audit Procedure from any of four Templates and author its period, scope, population, Target Systems, instructions and Compliance Rule.
- Define evidence and grounding requirements and a UTC Schedule. The Builder explains incompatible upload/frequency choices and protects unsaved work during refreshes.
- Read the executable plan produced by the queued worker, including its model/compiler identity, derivation status and limits. Interrupted derivation has durable recovery.
- Submit for independent approval, compare previous and submitted values, reject with a rationale, edit and resubmit, or approve the exact stored review. Actual contributors cannot approve their own edits.
- Read private in-app notifications and page through older deliveries. Decision, audit and notification records commit together.
- Create a new editable version while preserving the Active definition. Reviewed definitions are protected by database rules, including after retirement; history remains accessible beyond 100 versions.
- See platform-authored Drafts after relevant Target or Population Source changes, with the cause and required approval. Administrators confirm the number of affected Procedures before saving.

## How activation works

The first approved version activates immediately. A successor with the same model, prompt, tool configuration and registration digests also activates immediately. A changed configuration stays Approved with a visible regression requirement and saved predecessor relationship.

**Your handover decision is implemented:** a regression-gated successor has no activation or handover date until regression passes and it actually activates. Immediate activation records the next UTC period start, strictly after activation. Once has no automatic boundary. Prior succession boundaries remain intact when further versions activate.

Actual audit execution, Regression Run execution and scheduler handover belong to later epics. This delivery supplies their approved, versioned inputs and displays execution as unavailable rather than inventing scheduled work.

## How it was verified

| Final local check | Result |
|---|---|
| Unit tests | **1,950 passed** in 81 files |
| PostgreSQL integration tests | **209 passed** in 14 files, PostgreSQL 18.6 over TLS |
| Browser tests | **96 passed**, no skips or failures; includes keyboard and WCAG checks |
| Type checking and dependency boundaries | Passed; 307 modules checked |
| Migration and schema drift | Generation 14 confirmed; no schema changes |
| Package and production web builds | Passed, including TypeScript and route generation |
| Formal review | Four review layers, twelve repairs, independent follow-up cleared all twelve |

The browser proof authors the P-1 hero Procedure, uses the actual worker and installed provider SDK, then exercises rejection, Edit, resubmission and approval. Additional browser checks cover the real ripple dialogs, lifecycle states, history past version 100, new-version creation and a lost response after the database committed. Database checks exercise raw-SQL immutability, rollback, simultaneous actions, role revocation while waiting for a lock, exact changed snapshots, stored calendar boundaries, replay and upgrading existing approvals.

Provider HTTP is synthetic: this proves wiring and contract enforcement, not live credentials or model quality. Final evidence is mapped in the [acceptance audit](epic-2-acceptance-audit.md) and [Story 2.8 evidence map](review-2-8-matrix.md). Failed or interrupted attempts are retained as diagnostics and are not counted as passes.

CI passed for earlier delivered checkpoints: [Story 2.5, run 48](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33921238170), [Story 2.6, run 50](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33929302513), and [Story 2.7, run 51](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33948294403). Final Story 2.8 branch CI will be recorded here after push.

## Decisions and gotchas

- **Review is a saved record.** Background work cannot change what the Manager sees or approves. Definitions, provenance and previous values remain fixed.
- **A lost response is an unknown outcome.** Creation and decision controls block another attempt until reload reveals the saved state; a synchronous guard also prevents duplicate clicks.
- **Configuration changes are atomic and replay-safe.** Relevant owner changes and their Drafts commit together. Renames/notes create no Drafts. Historical replay cannot mint against versions activated later.
- **Published configuration governs new creation.** New Procedures read the current published model and revision inside their transaction, so a stale web process cannot silently use its old model setting.
- **Publication is an explicit release operation.** After migration/build, use `node scripts/apply-platform-configuration.mts <configuration.json>` with `DATABASE_URL`. This build accepts model publication under prompt 1 and `executable-plan-v1`; unsupported prompt/tool publications are refused. New executable meaning requires a supported versioned compiler contract first. Secrets remain in the worker environment; startup never publishes changes.
- **Write serialization is deliberate.** Procedure/configuration commands share a transaction lock to preserve exact ripple counts and avoid conflicting lock order. This limits PoC write throughput; model calls and credential probes remain outside it.
- **Migration does not activate old approvals.** Existing generation-13 approvals stay Approved with no invented activation date.
- **Native PostgreSQL bypassed Docker's startup failure.** Verification used an isolated test database. Disk-full and stale Next-cache interruptions were recovered; the final passes above are from completed runs.
- **Correlated SQL must qualify its outer reference.** Browser testing caught another Procedure's name appearing in a list; the query and a persisted two-Procedure regression now protect against that mistake.

Reusable details and the report/PR delivery rule are recorded in [CLAUDE.md](../../CLAUDE.md). The earlier editor-concurrency audit is closed; no review repair remains deferred.

## What needs you

No product decision remains open. After final CI is green, review this report and approve the PR when satisfied. Deployment is a separate action: configure the intended environment and provider credentials, use the release migration workflow, and apply a model revision if changing the published configuration. Live provider acceptance has not been claimed by the synthetic tests.
