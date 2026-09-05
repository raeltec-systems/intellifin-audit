# Epic 2 delivery report

**Epic 2 complete — 5 September 2026. Implementation and CI verified.** All eight stories are complete and pushed. [PR 21](https://github.com/raeltec-systems/intellifin-audit/pull/21) contains the delivery. The [HTML report](epic-2-delivery-report.html) is a standalone version of this overview.

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

**[Final implementation CI run 52 passed](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33956593754)** at commit `b432741fc3498239ee0cbd0c4036b9ccb821db51`: all four jobs succeeded, covering types/unit/boundaries, fresh migration/integration, browser/accessibility, and built-container startup checks. This report's later documentation update does not change the tested implementation.

Earlier delivered checkpoints also passed: [Story 2.5, run 48](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33921238170), [Story 2.6, run 50](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33929302513), and [Story 2.7, run 51](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33948294403).

## Independent review after CI green

A second review of the whole PR diff — correctness, verification gaps and security — plus the automated Codex review found seven defects after run 53 was green. Six were fixed in the initial review pass, and each fix carries a test that fails when the fix is reverted:

- The Builder's Population Source picker inherited the administration list's 200-row cap, so a source past the cap could not be bound (Codex finding). The picker read is unpaged and active-only now.
- The worker-backed review journey started its fixture worker even against an external web server, where it cannot pass (Codex finding). It skips itself there and says why.
- The ripple count and the platform-Draft fan-out ignored activated succession: an administrator confirmed "1 Procedure" and two Drafts appeared, one copied from the superseded definition. Both now apply the same "current version" rule as the Active-version read.
- A configuration publication that left the model unchanged moved `@current` with nothing in the audit chain. Every first publication is appended now; a replay appends nothing.
- The platform-configuration script's entry-point guard would report success having done nothing when invoked through a symlink — the Story 1.8 defect. It uses `import.meta.main`, and the entry-point test covers it.
- The plan-derivation retry action could answer a framework 500 instead of a sentence. It fails like its sibling actions.
- Raw-SQL immutability of recorded activation metadata and succession edges, and the platform-change trigger branches, gained the integration tests nothing had exercised.

The owner subsequently requested the remaining forced-evidence fix. Requirements now record the auditor's capture choices separately from the platform overlay. Removing the last agent-driven Target clears platform additions and preserves authored values, including after reload and unrelated edits. If grounding becomes empty, the Draft remains editable but cannot derive a plan or be submitted until corrected. Legacy rows without capture provenance retain their values because authorship cannot safely be inferred. See the [follow-up verification report](epic-2-capture-fix-report.md). Smaller hardening follow-ups remain: a dependency rule keeping plan derivation out of web requests, a trigger for the APPROVED-to-ACTIVE progression without lifecycle metadata, and plain-form fallbacks on the New version, decision and retry controls.

Verification before the capture follow-up on a fresh PostgreSQL 18.4 at generation 14: 1,950 unit tests, 214 integration tests, typecheck, boundaries, build, and the 31 browser tests of the three touched specs. [CI run 55](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33961248848) passed on `0dcc594`, which differs from the last code change `26fd0e8` only by this report. Run 54 on `26fd0e8` had passed its typecheck/unit, integration and container jobs when the report push cancelled its browser job, as the workflow's concurrency rule requires. The run on this final commit is linked from the PR.

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

Reusable details and the report/PR delivery rule are recorded in [CLAUDE.md](../../CLAUDE.md). The earlier editor-concurrency audit is closed; the forced-evidence follow-up is implemented with the legacy-data boundary described above.

## What needs you

Remaining release considerations:

- **Where to merge.** There is no `develop` branch. The PR targets `main`, and a merge to `main` is the production release: the release workflow migrates the production database from generation 7 to 14 and deploys web, worker and Northstar to Railway. Merging to a new `develop` branch deploys nothing until the release workflow is changed to read it.
- **Live model proof.** The Anthropic account answers "credit balance is too low" and OpenAI is unreachable from the review environment, so the model path is proven only through synthetic provider HTTP. The production worker has no `MODEL_*` variables, so the release derives plans deterministically. To run a model live: fund the account, set `MODEL_PROVIDER`, `MODEL_ID`, `MODEL_PROMPT_VERSION`, `MODEL_MAX_OUTPUT_TOKENS` and `MODEL_API_KEY` on the worker service, and publish a model revision with the configuration script.
