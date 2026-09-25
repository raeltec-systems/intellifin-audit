---
title: 'Legacy review closure register — Epic 4 and Epic 5'
type: 'register'
created: '2026-09-25'
story: '10-1-legacy-review-closure-assessment-for-the-epic-4-and-5-storie'
baseline: 'main c18ad3683d4e71d2654272e8cb95ef4559013374'
assessor: 'this session''s agent (Claude, executing Story 10.1 as a documentation-only assessment)'
status: 'assessment complete — verdicts proposed; nothing is recorded until the owner accepts'
---

# Legacy review closure register — Epic 4 and Epic 5

## 1. Purpose, baseline and rules

**Purpose.** This is the register that Proposal 5 §1b asks for
(`_bmad-output/planning-artifacts/course-correction-2026-09-24/proposal-5-epics.md`, D-5-1), and
that Proposal 7 D-7-4 makes the only source of Epic 4 and Epic 5 status changes. For each of
the twenty stories it records: the tested revision, the evidence relied on, the runtime and
environment in which that evidence was produced, the unresolved limitations already named, and
one verdict. Each acceptance criterion (AC) in `_bmad-output/planning-artifacts/epics.md`
(`## Epic 4:`, `## Epic 5:`) is listed with the evidence that covers it.

**Baseline.** `main` at `c18ad36` ("Merge PR #51: Auditor Workspace v1.1 (includes PR #52 UI
cleanup)"). This register is written on branch `claude/ecstatic-turing-mxntoc` at `3d3be03`. That
branch carries tracking and planning commits only:
`git diff --stat c18ad36 HEAD -- apps packages tests scripts` is empty. The implementation that is
read here is therefore the implementation at `c18ad36`.

**Date.** 2026-09-25. **Assessor.** This session's agent (Claude), running Story 10.1
(`_bmad-output/implementation-artifacts/10-1-legacy-review-closure-assessment-for-the-epic-4-and-5-storie.md`).

**Rules (restated from D-5-1, D-7-4 and Story 10.1).**

- **Done — `[COMPILER-1 PATH]`**: named evidence covers every AC. **Remains in review**: at
  least one AC has no evidence; the missing check is named. **Residual work — PROPOSED, awaiting
  owner**: evidence shows that an AC is not met; the residual scope and a proposed owner are named.
  A residual verdict here is a proposal. The owner decides. Nothing in this register is recorded as
  decided.
- A classification as compiler-1 does not make a story complete. A Done verdict closes the
  compiler-1 story against its compiler-1 ACs only. It proves nothing about the compiler-2
  capability that replaces the story.
- Valid existing evidence is reused as it stands. Nothing is rerun for its own sake.
- The `[COMPILER-1 PATH]` note goes in `course-correction-dispositions.yaml`. It never goes in a
  sprint-status value.
- An environment caveat (for example Node 22 instead of 24.20.0) is recorded as a limitation. It
  does not disqualify the evidence by itself.

**Verdict category used for forward dependencies.** Some ACs name an artifact that a later story
owns and that does not exist on `main`: the Workpaper Bundle or export (old story 6-7, now
14-11a), Result submission (old story 6-3, now 15-4), and scheduled Runs (Epic 8, now 19-4 and
19-10). No evidence for such a leg can exist on `main`, so the leg is not covered. When a story's
only uncovered legs are of this kind, the verdict is **Residual work — PROPOSED (transfer only)**.
The owner can accept the transfer, and the story then closes as Done.

**What this assessment did.**

- It read the evidence files listed in §2 and the per-story spec files
  `_bmad-output/implementation-artifacts/spec-4-*.md`, `spec-5-1-*.md` and `spec-5-3-*.md`.
- It read the dated entries in `CLAUDE.md` (line numbers are cited as `CLAUDE.md:<line>`).
- It used the GitHub API to read the CI, live and deployed workflow runs cited below, at job
  level. It downloaded the logs of CI run 36026738508 (`c18ad36`) and parsed per-test and
  per-mutation results from them.
- It read GitHub issues #45, #49 and #50, and PRs #24, #25, #29 and #36.
- It read the source code at `c18ad36` to confirm the specific facts that decide some ACs. Each
  such fact is labelled "code read at `c18ad36`".

**What this assessment did not do.**

- **It ran no test suite.** This container has Node v22.22.2, a `psql` client but no PostgreSQL
  server, and no Playwright browser. Every run cited below was produced elsewhere and carries its
  own environment.
- Story 10.1 asks that a cheap reproducible run on `c18ad36` be recorded once where it is the only
  missing evidence. That case did not arise: CI run 36026738508 already ran the complete unit,
  integration, browser and mutation suites on `c18ad36` itself.
- It did not change `sprint-status.yaml`, `course-correction-dispositions.yaml`, the PRD memlog,
  any application code or any test. The caller restricted this assessment to this one file. The
  other three tasks of Story 10.1 are still open (see §6, point 16).

## 2. Evidence sets

Each story section cites these tags. Each tag carries its own environment, so that a caveat
stays attached to the evidence it qualifies.

**[CI-c18] — CI run 36026738508 on `c18ad36`** (push to `main`, 2026-09-24, all seven jobs
`success`, read at job level and from downloaded job logs).

- Environment: GitHub-hosted `ubuntu-latest` runners; Node v24.20.0 and pnpm 11.25.0 (printed in
  each job log); PostgreSQL 18.6 in the `postgres-ssl:18` service container, over TLS; Playwright
  Chromium, local and headless, with axe (WCAG 2.1 AA, no allowlist); Northstar served locally.
- Providers: model traffic is a synthetic HTTP fixture and S3 is a synthetic fixture. There is
  **no live model and no Solari**. Agent workspaces run in **local mode**, which isolates browser
  state per Run but does not isolate the worker process.

| Job | Result |
|---|---|
| Unit | 293 files, 5,389 tests passed; boundaries clean over 801 modules |
| Integration | 57 files, 780 tests passed (the files cited per story below) |
| Guard mutations (same job) | 22 killed (green baseline, red mutant); artifact 10820886048: 15 agent-guard (5 in browser mode), 2 ProdConsole, 5 escalation and review |
| Agent abuse mutations | 7 worker and hydrated-UI mutations, 34 baseline/removed-guard case pairs, all killed. Includes `model-response-credential-containment` with three credential lifecycles |
| Browser | Focused step 17 passed. Full suite 296 tests: 284 passed, 12 skipped. The skipped 12 are `workspace-preview*.spec.ts`, which the preview job runs (15 passed there) |
| Container images | Pass, including "The worker image can launch its own browser" |
| Auditor Workspace P0 design checks | Pass |

**[REL-c18] — Release run 36030967869 on `c18ad36`.** Migrations and the deploy jobs for web,
worker and Northstar all concluded `success` at Actions job level. This assessment did not re-read
Railway deployment status or `/api/health`.

**[CI-E4] — Epic 4 candidate CI (PR #24, merged 2026-09-09).**

- 34316930519 on `9da4df6`: the final candidate, five jobs success.
- 34298099868 on `6237c4c`: includes `disablement-window-journey.spec.ts` in the hosted browser
  job.
- 34205126512 on `82adb83`: 162 browser cases; seven worker mutations with 34 case pairs,
  including three credential lifecycles.
- 34199194303 on `f4892c9` (merge `ef9334e`): 22 guard mutations and 7 worker mutations. The
  per-case JSON is on disk as `epic-4-hosted-guard-mutations.json` and
  `epic-4-hosted-worker-mutations.json`.
- 34217326851 on `70497eb`: five jobs green.
- 34203072973 on `04f2a3e`: **failed**. The credential-containment mutation baseline reached
  `RUN_FAILED` instead of the wait (`epic-4-credential-baseline-failure.json`). Later green runs
  superseded it.
- 34138046009 on `a24c5d9`: **failed** on a stale schema-inventory test (`CLAUDE.md:2419`).
  Superseded.

Environment: the same hosted runner shape as [CI-c18], with local Chromium and synthetic
providers.

**[LIVE] — Live Solari acceptance workflow** (`.github/workflows/solari-acceptance.yml`,
`epic-4-solari-acceptance-runbook.md`).

- 34317015975 on `9da4df6`: success; artifact 10090483703.
- 34299424112 on `07f79e2`: success. Its three secret-free reports are on disk in
  `epic-4-live-acceptance-07f79e2/`.
- 34224743734 on `8eafbfb`: isolation only, success
  (`epic-4-live-provider-verification.json`).
- 34223964866 on `0c118a8`: **not accepted**. The model asked what "privileged" means because C2
  was undefined at that point.

Environment: hosted runner and the real compiled worker. The browser is real Solari (`us-west`)
with provider recording **off**. The model is OpenAI `gpt-5.6-luna` with prompt version 4. The
target is the hosted Northstar at `https://northstar-production-b312.up.railway.app` (deployment
`65c63c65` from `70497eb`). The database is a disposable CI PostgreSQL, and S3 is synthetic,
reached through the production AWS adapter. The population is a worker-local, independently
declared single-leaver source (E-000102), so deployed HR integration is not asserted.

**[DEP] — Deployed LoanCore acceptance at `44fb596`** (issue #45, closed 2026-09-18 as ACCEPTED).

- Normal release 35339527945; main CI 35337577678.
- Visible acceptance 35340181283: 36 of 36 checks passed.
- Independent read-only readback 35340470537: 7 of 7 passed.
- Strict fresh-login and Replay reload 35342862535: 7 of 7 passed.
- Report: `_bmad-output/implementation-artifacts/loancore-final-acceptance-2026-09-18.md` at commit
  `5092153` on branch `validation/loancore-watch-closeout-20260918`. **That report is not on
  `main`.**

Environment: production Railway (web `155833e3`, worker `a685f9f2`, Northstar `8fa0fd14`). The
worker runs in Solari mode with recording off and uses OpenAI `gpt-5.6`, after the owner approved
the provider change on 2026-09-18 and reconfirmed it on 2026-09-19 in issue #45. PostgreSQL 18,
schema 50. The observer is headless Chromium on a GitHub Actions runner at 1440×1000. Auditor and
manager sessions were scripted. The visual review was AI-assisted and is not a human product-owner
signature.

Earlier deployed attempts, now superseded:

- 35323749627 on `ef0515e`: Watch frames answered HTTP 502. `epic-5-evidence-delivery-repair-2026-09-18.md` diagnoses the cause.
- 35333706645 on `816d6b5`: the automated checks passed, but the visual review rejected the Watch framing (`epic-5-watch-viewport-repair-2026-09-18.md`).
- `live-auditor-verification-2026-09-17.md`: not accepted.

**No deployed journey has run on `c18ad36`.** The deployed evidence predates the Auditor
Workspace v1.1 merge. That merge changed the Live View header, the Evidence tab and Replay record
links.

**[CI-E5] — Epic 5 CI.**

| Run | Revision | Scope and result |
|---|---|---|
| 34318755939 | `3a426a4` | Story 5.1 commit |
| 34417260412 | `1e7869c` | PR #25 final head (5.1–5.3); five jobs success |
| 34605206181 | `82a7622` | PR #29 (5.4–5.8, merged 2026-09-11); five jobs success |
| 34994575889 | `8c1fc69` | PR #36 (review repairs, merged 2026-09-15); five jobs success |
| 35328629164 | — | PR #47, evidence MIME repair |
| 35335573874 | — | PR #48, viewport repair; 214 of 214 passed |

Environment: the same hosted runner shape as [CI-c18].

**[LOCAL] — Local verification recorded in reports.** This assessment did not reproduce any of
it.

| Report | What was verified | Environment |
|---|---|---|
| `epic-4-independent-verification.md` (2026-09-08) | 3,549 unit tests, 476 integration tests and 162 browser tests at generation 41 | Node 24.20.0, pnpm 11.25.0, PostgreSQL 18.4. The first attempt started under **Node 22.22.2** because `nvm` does not apply inside `nohup`. It was killed; the recorded figures are from Node 24.20.0 (`CLAUDE.md:3523`) |
| `epic-4-engineering-report.md` | Codex continuation, run locally | Node 24.20.0 and pnpm 11.25.0. Host OS not stated. PostgreSQL and browser gates ran on hosted CI only |
| `epic-4-hero-workflow-report.md` | Hero workflow report | Node 24.20.0, pnpm 11.25.0, PostgreSQL 18 at generation 41 |
| `epic-5-story-status.md` and `epic-5-implementation-report.md` | Local Epic 5 verification | Developer host with a real PostgreSQL 18 at generations 42–47, real Chromium and the compiled worker |
| `review-epic-5-stories.md` | Gates run on the reviewer's own machine | Node 24.20.0, pnpm 11.25.0. Browser specs at generation 49. The integration suite was **not** run there |

The planning-consistency checks that Proposal 5 §1b mentions ran under Node 22. They are evidence
about the planning documents only, and this register does not use them.

## 3. Summary

| Story | Status on `main` `c18ad36` | Verdict | In one line |
|---|---|---|---|
| 4.1 Isolated Agent Workspace per Run | done | Already done: evidence registered, no status change | Limitations registered (browser-state isolation in local mode; provider-bounded lease) |
| 4.2 Sign in to LoanCore, read-only allowlisted actions | done | Already done: evidence registered, no status change | AC3 has two named gaps: no adapter Tool Action rows, and no single named conformance suite |
| 4.3 Credentials just in time, capture suppressed | done | Already done: evidence registered, no status change | The export leg has nothing to test on `main` |
| 4.4 Locate, capture, register a grounded Observation | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered |
| 4.5 Prove absence | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered, including golden D12 and D14 |
| 4.6 Bounded execution, inert content | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered; production runs OpenAI by owner decision |
| 4.7 Typed Escalations as durable waits | review | **Residual work — PROPOSED** | The human-matched flag is missing from the Result, record review and Exceptions list; the export leg goes to 14-11a |
| 4.8 Answer an Escalation, notify Audit Managers | review | **Residual work — PROPOSED** | Email is not built (it records `unconfigured`); Bundle leg to 14-11a; scheduled-Run author to 19-4; compact Evidence tab to confirm |
| 4.9 Confirm or reject Agent-Judged evaluations | review | **Residual work — PROPOSED (transfer only)** | No Submit control exists; the sentence is shown instead. Transfer to 15-4 (Story 3.11 precedent) |
| 4.10 ProdConsole, one Observation per parameter | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered; CI evidence only (no live or deployed P-4) |
| 4.11 Abuse resistance and isolation | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered: 29 mutations on `c18ad36` and live isolation on Solari |
| 4.12 24-hour disablement window | review | **Done — `[COMPILER-1 PATH]`** | The AC is covered on `c18ad36` and on `6237c4c` and `9da4df6` |
| 5.1 Timeline live over SSE | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered; the Overview and bell refresh by composition (see limitation) |
| 5.2 Replay asset set | review | **Residual work — PROPOSED** | Frame-missing is never shown on Replay; retention and live recording legs unmet; frame role deviation; export to 14-11a |
| 5.3 Watch a Running Run in Live View | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered on `c18ad36` and deployed at `44fb596` |
| 5.4 Pause and resume | review | **Residual work — PROPOSED** | The Step is not on the resume record, nor on the pause record at 2 of 3 boundaries (owner decision open since PR #36) |
| 5.5 Cancel and flag from Live View | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered; placement and N1 wording are open points |
| 5.6 Answer an Escalation in Live View | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered, including the Flow 3 journey |
| 5.7 Stream drops or Run ends while open | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered |
| 5.8 Replay any terminal Run | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered, with the provider blocked at the network, and deployed |

Totals for the seventeen stories in review: 12 Done — `[COMPILER-1 PATH]`, 5 Residual work —
PROPOSED (one of them transfer only), 0 Remains in review.

## 4. The register, story by story

### Story 4.1 — Provision an isolated Agent Workspace per Run

**Status on `main`:** done. The evidence is registered here; the status does not change.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]; `9da4df6` [CI-E4 34316930519, LIVE 34317015975]; `07f79e2` [LIVE 34299424112]; `8eafbfb` [LIVE 34224743734, isolation]; `44fb596` [DEP]; production at schema generation 50 on 2026-09-16 (the owner's two live Runs, `CLAUDE.md:610`; that entry names no revision) |
| Evidence relied on | `spec-4-1-provision-an-isolated-agent-workspace-per-run.md` (Verification: 2,784 unit, 350 integration and 124 browser tests at generation 27, local mode only); `epic-4-browser-provider-decision.md`; `epic-4-engineering-report.md` and `epic-4-story-status.md` (4.1 rows); `packages/application/src/runs/provision-workspace.test.ts`; `tests/integration/agent-workspace.test.ts` (19 tests in [CI-c18]); `tests/integration/agent-isolation.test.ts` (3); `tests/integration/agent-abuse.test.ts` (6). Guard mutations killed in [CI-c18]: `browser-context-separation`, `browser-cross-run-reference`, `browser-workspace-egress` and `browser-ended-workspace-state` (job 107725083134); `terminal-worker-workspace-closure` (6/6, job 107725083139). Also `tests/e2e/live-view.spec.ts:362` (adapter-only Run); `epic-4-live-acceptance-07f79e2/solari-workspace-isolation.json`; `epic-4-live-provider-verification.json`; `CLAUDE.md:610`, `:644`, `:664`, `:3274`, `:3441` |
| Runtime and environment | [CI-c18]: hosted Linux, Node 24.20.0, PostgreSQL 18.6, local-mode Chromium, so browser-state isolation only. [LIVE]: real Solari `us-west`, recording off. [DEP]: production Solari mode, recording off. The story's own verification ran with no `SOLARI_API_KEY` (local mode only) |
| Unresolved limitations (already named) | (1) Local mode isolates browser state, not the worker process; no evidence asserts worker-memory isolation or a provider-side firewall (`epic-4-solari-acceptance-runbook.md`). (2) A Solari session cannot be reattached across a worker restart with `@solarisdk/browser@0.1.3`. The worker releases, recreates and records `workspace-reattach-failed` (spec-4-1, "What could NOT be proved"). (3) A session created just before the process dies, before its identity commits, cannot be released by the platform. The provider's grace timer bounds it (`CLAUDE.md:3274`). (4) The provider's hard session expiry is about one hour in the live reports (for example, created at 01:30, expiring at 02:30). The Escalation deadline is 4 hours. So "kept alive under a lease to the wait's deadline" is bounded by the provider, and a resume replaces an expired workspace with fresh authentication (`CLAUDE.md:3675`, `epic-5-context.md`). (5) Two production defects found on 2026-09-16 were fixed and recorded: the 200-character identity CHECK, fixed in generation 50, and the recovery-sweep race (`CLAUDE.md:644`, `:664`, `:830`) |

**Acceptance criteria and the evidence for each**

1. *A fresh Solari-backed workspace per Run, bound to it for the Run's lifetime, destroyed at Run
   end, with nothing persisted into a later Run.* **Covered.**
   - `provision-workspace.test.ts`: "creates exactly one workspace, bound to the Run…" and
     "releases it once the Run has ended, and is idempotent".
   - `agent-workspace.test.ts`: "provisions one workspace, bound to the Run…" and "keeps two
     concurrent Runs from seeing each other cookies, storage or session".
   - `agent-abuse.test.ts`: "removes credential-bearing browser state…".
   - [LIVE]: two overlapping Solari sessions, both released before expiry. [DEP]: both
     workspaces released.
2. *An adapter-only Run needs no workspace, and its Live View shows Adapter Session Steps.*
   **Covered.** `agent-workspace.test.ts` "provisions nothing at all for an adapter-only Run";
   `live-view.spec.ts:362`.
3. *Egress reaches only the allowed origins; every other destination is denied and logged as a
   security event.* **Covered.**
   - `agent-workspace.test.ts`: "lets a request inside the frozen origins through and denies every
     other destination".
   - `provision-workspace.test.ts`: "records every denied destination as a security event".
   - The `browser-workspace-egress` mutation.
   - [LIVE] `07f79e2` isolation report: `security.action-denied` with
     `workspace-egress-denied`.
4. *A workspace creation failure is a Session Step exhaustion that yields `RUN_FAILED`.*
   **Covered.** `agent-workspace.test.ts` "fails the Run when provisioning is exhausted, and seals a
   Result for it"; `provision-workspace.test.ts` "retries an outage under the Session Step budget
   and fails the Run when it is spent".
5. *When a wait opens, the workspace is kept alive under a lease to the wait's deadline.*
   **Covered, with limitation (4).** `provision-workspace.test.ts` "keeps the workspace while the
   Run can still act"; `agent-workspace.test.ts` "reaps a workspace whose Run has ended and leaves
   one whose Run can still act".
6. *Every terminal transition and a periodic sweep reap orphaned workspaces and revoke
   credentials, shown by a negative test that no workspace outlives its Run.* **Covered.**
   - `agent-workspace.test.ts`: "reaps a FAILED workspace that still names a session nothing
     could give back".
   - `provision-workspace.test.ts`: "still names the workspace once the budget is spent, so the
     reaper can find it".
   - The `terminal-worker-workspace-closure` and `browser-ended-workspace-state` mutations.

**Verdict:** Already done. The evidence is registered and the status does not change.
Limitation (4) is an item for the Epic 4 retrospective.

### Story 4.2 — Sign in to LoanCore and enforce read-only, allowlisted actions

**Status on `main`:** done. The evidence is registered here; the status does not change.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]; `9da4df6` and `07f79e2` [LIVE] (real form sign-in on the hosted Northstar); `44fb596` [DEP] |
| Evidence relied on | `spec-4-2-sign-in-to-loancore-and-enforce-read-only-allowlisted-actions.md` (Verified: 2,879 unit, 359 integration and 128 browser tests at generation 28); `epic-4-loancore-authentication-decision.md`; `epic-4-engineering-report.md`; `epic-4-agent-guard-mutations.md` and `.json` (10 historical mutations at `10b7d56`, labelled "not complete Story 4.11 acceptance"). Tests in [CI-c18]: `tests/e2e/agent-sign-in.spec.ts` (5), `tests/integration/agent-execution.test.ts` (15), `browser-authentication.test.ts` (11), `browser-method-policy.test.ts` (4), `tests/unit/scope-widening.test.ts`, `tests/e2e/agent-worker-abuse.spec.ts` (SW-1..3), `agent-retrieved-abuse.spec.ts` (6). Mutations killed in [CI-c18]: `seeded-write-action-gate`, `seeded-origin-action-gate`, `stored-frozen-objective-scope-rule`, `golden-retrieved-objective-separation`. `CLAUDE.md:3242`, `:3450`, `:3745` |
| Runtime and environment | As in [CI-c18], [LIVE] and [DEP] |
| Unresolved limitations (already named) | (1) The adapter path writes no `run_tool_action` rows. The "sanitized action schema shared with Adapter Actions" exists as a shape (the `adapter` surface is in the CHECK), but no adapter row is written. Code read at `c18ad36`: no writer sets `surface: 'adapter'` (spec-4-2, "Not delivered, named"). (2) There is no single, named `BrowserExecution` conformance suite. The redirect, download, cancellation, timeout and ordering cases are spread across `agent-execution`, `browser-authentication`, `browser-method-policy` and `web-tree-capture` integration tests. (3) A desktop Target fails sign-in by name; desktop support is Epic 7, deferred |

**Acceptance criteria and the evidence for each**

1. *Sign-in with request interception that enforces the allowed origins; only permitted read
   actions; a write, an out-of-scope origin or an out-of-scope parameter is denied before it
   reaches LoanCore and is logged.* **Covered.**
   - `agent-sign-in.spec.ts`.
   - `agent-execution.test.ts`: "DENIES a destination outside the frozen origins…", "aborts an
     out-of-scope destination inside the browser even with the gate bypassed", "REFUSES a sign-in
     form that is method=get…" and "…posts to another origin…".
   - `browser-method-policy.test.ts`.
   - The two seeded action-gate mutations.
2. *A seeded scope-widening instruction is denied at execution and recorded as a security event;
   retrieved content cannot change the objective, permissions, tool scope or rule.* **Covered.**
   `agent-worker-abuse.spec.ts` (SW-1, SW-2, SW-3); `agent-retrieved-abuse.spec.ts`; the
   `stored-frozen-objective-scope-rule` and `golden-retrieved-objective-separation` mutations.
3. *`BrowserExecution` conformance: redirects, downloads, cancellation acknowledgement, timeout
   accounting and trace ordering; every Tool Action logged with a sanitized schema shared with
   Adapter Actions; a shared conformance suite in CI.* **Covered for the agent surface:**
   - `agent-execution.test.ts`: "records the action in the shared log…".
   - `web-tree-capture.test.ts`: "applies one absolute deadline…".
   - `browser-authentication.test.ts`.
   - `CLAUDE.md` "Native browser timeout cleanup".
   
   Limitations (1) and (2) apply to this AC.

**Verdict:** Already done; the status does not change. The two AC3 gaps are items for the Epic 4
retrospective.

### Story 4.3 — Supply credentials just in time and suppress capture during entry

**Status on `main`:** done. The evidence is registered here; the status does not change.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]; `82adb83` [CI-E4 34205126512] (three credential lifecycles); `f4892c9` [CI-E4 34199194303]; `04f2a3e` [CI-E4 34203072973] (**failed** credential baseline, since superseded); `9da4df6` and `07f79e2` [LIVE] (secret-scanned reports); `44fb596` [DEP] (credential-entry capture suppressed) |
| Evidence relied on | `spec-4-3-supply-credentials-just-in-time-and-suppress-capture-during-entry.md` (Verified: 2,926 unit, 362 integration and 133 browser tests at generation 29; eight mutations); `epic-4-credential-baseline-failure.json`; `epic-4-hosted-guard-mutations.md` (`credential-before-artifact-storage`); `epic-4-hosted-worker-mutations.json` (`model-response-credential-containment`). Tests in [CI-c18]: `tests/e2e/credential-containment.spec.ts` (4); `agent-credential-containment.spec.ts` (1, mutation 3/3); `agent-sign-in.spec.ts` ("the credential appears in nothing the Run stored, and not in the worker log", "the Timeline shows the Tool Action and says its capture was suppressed"); `tests/integration/agent-isolation.test.ts` ("refuses reflected credentials before screenshot capture…"); `agent-execution.test.ts` ("records the sign-in as a credential-entry action whose capture was SUPPRESSED", "redacts the credential out of a destination…"). `CLAUDE.md:3409`, `:3919`, `:3943` |
| Runtime and environment | As in [CI-c18], [CI-E4], [LIVE] and [DEP] |
| Unresolved limitations (already named) | (1) Detection is not proof of absence. A value that is compressed, encrypted, re-cased or split is not found; the unit suite asserts that the split case fails to detect. (2) The PNG byte scan is not OCR (runbook). (3) No export exists on `main`, so "never appears in … exports" has nothing to test. The Workpaper Bundle is old story 6-7, now 14-11a. (4) In local mode, the browser's own out-of-band traffic is not policed. (5) The specific cause of the `04f2a3e` baseline failure was never established. A related reattachment race was reproduced at `e55c001` and fixed at `d50e424` and `5944e6f` (`epic-4-engineering-continuation.md`). The mutation has been green since, including three lifecycles on `c18ad36` |

**Acceptance criteria and the evidence for each**

1. *The credential is supplied just in time; its retrieval is audited without the secret; it never
   appears in the Timeline, Evidence, logs or exports.* **Covered, except exports:** there is no
   export on `main` (limitation 3).
2. *Capture is suppressed during credential entry; a secret-typed input is redacted; an artifact
   that contains a credential fails registration.* **Covered.** `agent-sign-in.spec.ts`;
   `credential-before-artifact-storage` mutation; `agent-isolation.test.ts`; [DEP].
3. *A seeded negative test proves that no credential-shaped value survives into a snapshot,
   screenshot, frame, log line or export.* **Covered** for snapshot, screenshot, frame and log:
   `credential-containment.spec.ts` "the credential is in NO object, NO row and NO log line". The
   export leg has nothing to test.

**Verdict:** Already done; the status does not change. The export leg is registered as a forward
dependency on 14-11a.

### Story 4.4 — Locate a record, capture Evidence, and register a grounded Observation

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]. `f4892c9` [CI-E4 34199194303]: canonical compiled-worker capture, registration, inspector, and confirm/reject journeys. `9da4df6` and `07f79e2` [LIVE]: navigate, search, open-record and read-attribute through Solari; 5 Structural Snapshots and 5 screenshots registered; one Observation. `44fb596` [DEP]: 3 of 3 records inspected, exact username, status and roles, Gate 20/20 |
| Evidence relied on | `epic-4-independent-verification.md` §2 (4.4 row); `epic-4-fixture-map.md`; `epic-4-story-status.md`; `epic-4-hero-workflow-report.md`; `epic-4-inspector-access-conflict.md`; `spec-4-4-…md`. Tests in [CI-c18]: `tests/integration/agent-journey.test.ts` (16, including "searches, captures and registers a grounded found Observation through the real shared writer"); `web-tree-capture.test.ts` (9); `evidence-read-grant.test.ts` (14); `tests/e2e/evidence-inspector.spec.ts` (4, with WCAG 2.1 AA); `agent-evaluation-journey.spec.ts` (2); `run-surfaces.spec.ts:320`, `:329` ("Platform key match"); `apps/web/src/runs/GroundingInspector.test.ts`. Mutations killed in [CI-c18]: `identity-single-snapshot`, `missing-screenshot-evidence`. `CLAUDE.md:3715`, `:3775`, `:3865`, `:3927`, `:3979` |
| Runtime and environment | As in [CI-c18], [CI-E4], [LIVE] and [DEP] |
| Unresolved limitations (already named) | (1) No test on disk drives the fixture map's agent-path golden seeds D7 (E-000108), D11 (E-000112) and D13 (E-000114); no test file names them. The rule behind D10 is covered by the wrong-employee case in `execute-agent-work-item.test.ts`. The full golden P-1 export cannot reach these seeds in a real Run, because its duplicate key E-000107 stops the agent stage first (`live-auditor-verification-2026-09-17.md`, `CLAUDE.md:610`). (2) The key-match provenance is stored inside the identity attribute (grounding locator, normalized key, `matchOrigin`), not as a fourteenth envelope key. The inspector renders it as its own "Platform key match" node. The §B.1 envelope is frozen (spec-4-4 Design Notes). (3) Watch in the deployed evidence is per-action captured frames, not continuous video. (4) LoanCore's capitalized statuses need the explicit C1 expression, because case is never folded (`epic-4-solari-acceptance-runbook.md`) |

**Acceptance criteria and the evidence for each**

1. *Search by employee ID, falling back to full name, and open the record. A `web_tree` snapshot
   and a screenshot are captured at the reading Tool Action, bound to it with LoanCore's URL.
   Every declared attribute is grounded in the snapshot, never in the screenshot.* **Covered.**
   - `agent-journey.test.ts`: the grounded found Observation, and "proves both search keys…".
   - `web-tree-capture.test.ts`.
   - `evidence-inspector.spec.ts`: "shows both actual search keys…".
   - [LIVE]: 5 snapshots and 5 screenshots. [DEP]: exact username, status and roles.
2. *A `found = true` Observation's identity is grounded in the same snapshot; the platform key
   match is recorded as a match provenance node; per-Observation Gate checks and the deterministic
   evaluator run in the registration transaction.* **Covered.**
   - The `identity-single-snapshot` mutation.
   - `GroundingInspector.test.ts`: "re-reads a stored web_tree cell, shows match provenance…".
   - `run-surfaces.spec.ts:329`.
   - `agent-journey.test.ts`: through the real shared writer.
   - `CLAUDE.md:3680` (the P-4 path uses the shared evaluator).
3. *The grounding inspector shows the original value, the normalized value, the snapshot at the
   locator, and the locator and label in mono, with a corroboration badge that explains a
   mismatch. A record with no Observation for a required Target System is `UNINSPECTED`; the agent
   stops and reports rather than guessing.* **Covered.**
   - `GroundingInspector.test.ts`: "explains a corroboration contradiction…".
   - `evidence-inspector.spec.ts`: with WCAG 2.1 AA.
   - `agent-absence-golden.test.ts` D14: `UNINSPECTED`.
   - `execute-agent-work-item.test.ts`: "fails required-evidence when the page has no Disabled
     time…".
   - [LIVE] undefined-privilege case: the model asked instead of guessing.

**Verdict: Done — `[COMPILER-1 PATH]`.** Limitation (1) is open point 11 in §6.

### Story 4.5 — Prove absence for an employee with no account

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]; `f4892c9` [CI-E4 34199194303] (canonical absence journey through the compiled worker); `9da4df6` [CI-E4] |
| Evidence relied on | `epic-4-independent-verification.md` (4.5 row); `epic-4-story-status.md`; `spec-4-5-…md`. Tests in [CI-c18]: `tests/e2e/agent-absence-journey.spec.ts` ("searches every key, seals a covered absence and opens its protected empty capture"); `tests/integration/agent-absence-golden.test.ts` (3 tests: "D14: real canonical partial page becomes UNINSPECTED and INCONCLUSIVE…", "D12 stronger prevention…", "D12 downstream fault injection…"); `absence-provenance.test.ts` (5); `agent-journey.test.ts` ("proves both search keys against registered complete empty pages…", "does not turn an incomplete empty search into a compliant absence"); `evidence-inspector.spec.ts` ("…opens the entire linked empty-result snapshot without inventing a row locator"); `GroundingInspector.test.ts` ("shows all recorded absence proof legs…"); `absence-guard-upgrade.test.ts`. The `absence-first-declared-search-key-only` mutation was killed in [CI-c18]; it is recorded in `epic-4-hosted-guard-mutations.json`, not in the worker JSON that Proposal 5 §1b names. `CLAUDE.md:3810`, `:3815`, `:3820`, `:3825`, `:3895`, `:3910` |
| Runtime and environment | As in [CI-c18] and [CI-E4] (local Chromium, synthetic provider) |
| Unresolved limitations (already named) | (1) The canonical D12 mistype is stopped earlier: model-authored search values are refused before browser I/O. So the downstream `UNINSPECTED` path is proven by a labelled fault injection (`CLAUDE.md` "Canonical negative journeys and stricter prevention"). (2) Absence proofs recorded before generation 40 stay explicitly unrecorded; they are not backfilled. (3) There is no live or deployed absence case: the deployed three-record population has no absent employee |

**Acceptance criteria and the evidence for each**

1. *Every declared search key is searched. The sanitized search action's query value is compared
   with the record's key for each declared key; compiler-1 identity keys are opaque, exact
   strings. The empty-result page is captured as a Structural Snapshot.* **Covered.**
   `agent-absence-journey.spec.ts`; `agent-journey.test.ts`; `absence-provenance.test.ts`; the
   first-key-only mutation.
2. *An absence claim that misses a leg (query match, grounded empty snapshot, or full-page
   consumption) is `UNINSPECTED`, never a Compliant absence. The partial-pagination golden case
   (D14) and the mistyped-key case (D12) give `UNINSPECTED` and an Inconclusive Run.* **Covered.**
   `agent-absence-golden.test.ts` (all three cases); `agent-journey.test.ts`;
   `GroundingInspector.test.ts`.

**Verdict: Done — `[COMPILER-1 PATH]`.**

### Story 4.6 — Bound agent execution and render retrieved content inert

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]; `f4892c9` [CI-E4 34199194303]; `9da4df6` and `07f79e2` [LIVE] (real OpenAI `gpt-5.6-luna` turns, prompt version 4); `44fb596` [DEP] (OpenAI `gpt-5.6`) |
| Evidence relied on | `epic-4-hosted-guard-mutations.md`: `golden-retrieved-objective-separation`, `golden-invented-tool-refusal`, `unknown-tool-security-event`, `invalid-provider-security-event`, `agent-measured-token-accounting-removed`. The token mutation is in this file, not in the worker JSON that Proposal 5 §1b names. `epic-4-hosted-worker-mutations.json`: `retrieved-worker-security-denial`, `stored-frozen-objective-scope-rule`, `worker-malformed-proposal-security-event`. All are killed again in [CI-c18]. Unit tests: `packages/infrastructure/src/runs/agent-model-gateway.test.ts` (both SDK adapters; "agent model cancellation and fallback"); `packages/application/src/runs/execute-agent-model-turn.test.ts` ("reserves before I/O and records real usage after the response"). `tests/integration/agent-journey.test.ts` "records the shared Gate and seals %s with partial Evidence unchanged on replay", run for `run-step-execution-limit`, `run-time-limit` and `run-token-limit`. Browser tests: `agent-retrieved-abuse.spec.ts` (6), `agent-escalation-abuse.spec.ts` (5), `agent-worker-abuse.spec.ts` (3). `apps/web/src/runs/agent-escalation-golden.test.ts`; `EvaluationReview.test.ts` ("AGENT-GENERATED evaluation rationale"). Code read at `c18ad36`: `agent-model-gateway.ts:49` `DEFAULT_AGENT_ANTHROPIC_MODEL = 'claude-sonnet-5'`, and `FallbackAgentModelGateway`. The live reports' `modelIdentities` give provider, model, build version, configuration and prompt version for every turn. `CLAUDE.md:2419`, `:2436`, `:3720`, `:3915`, `:3963`–`:3979` |
| Runtime and environment | As in [CI-c18] (synthetic provider HTTP), [LIVE] (real OpenAI) and [DEP] (real OpenAI) |
| Unresolved limitations (already named) | (1) Every live and deployed agent Run in the evidence used OpenAI. The owner approved the provider change on 2026-09-18 and reconfirmed it in issue #45. The one deployed attempt on the default Anthropic route (`claude-sonnet-5`) was refused by the provider for billing or quota (issue #45; workflow 35320045514). So **no completed Run on the default route exists**. (2) Issue #50 is open: the selected reasoning model warns that `temperature` is unsupported. (3) Rejected model output is not retained, by design; only closed diagnostic categories are kept |

**Acceptance criteria and the evidence for each**

1. *One conformance contract for ordered tool calls, cancellation, timeout, token accounting and
   structured uncertainty. Tools, model identity, configuration and prompt version are recorded per
   Run, and retrieved content cannot change them.* **Covered.** Gateway conformance suites; the
   token-accounting and objective-separation mutations; [LIVE] per-turn identities.
2. *When a Step Execution's retries are exhausted, a retry-or-skip Escalation is raised.
   Run-level exhaustion of Step Executions, time or tokens stops the Run `INCONCLUSIVE` with
   partial Evidence preserved. No path fabricates an Observation.* **Covered.** The three
   Run-limit cases in `agent-journey.test.ts`; the retry path in `agent-retrieved-abuse.spec.ts`
   (`CLAUDE.md:3830`).
3. *A seeded injection string is stored as untrusted and rendered inert, in a warning-bordered
   untrusted block. Agent narration is labelled agent-generated and kept distinct from platform
   narration.* **Covered.** `agent-retrieved-abuse.spec.ts`; `agent-escalation-golden.test.ts`
   (label mutation); `EvaluationReview.test.ts`; `LiveViewer.test.ts` (platform frame narration).
4. *The default model is `claude-sonnet-5` through the Anthropic adapter, with OpenAI as the
   fallback. Provider route, model identity, model configuration, prompt version, build version
   and terminal reason are persisted on the Run.* **Covered.** Code default and fallback tests.
   The persisted identity is read back in the [LIVE] reports and by the [DEP]
   `approvedOpenAIProvider` assertion. The terminal reason comes from the Run stop reader
   (`CLAUDE.md:878`). Limitation (1) applies.

**Verdict: Done — `[COMPILER-1 PATH]`.** Limitation (1) is open point 13 in §6.

### Story 4.7 — Raise typed Escalations as durable waits

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]; `f4892c9` [CI-E4 34199194303] (real PostgreSQL waits, restart and competing transactions; single-grounded-match mutation); `9da4df6` and `07f79e2` [LIVE] (a durable `AWAITING_AUDITOR` wait in the undefined-privilege case, cancelled and released); `a24c5d9` [CI-E4 34138046009], which Proposal 5 §1b names, **failed** on a stale schema-inventory test and was later superseded |
| Evidence relied on | `spec-4-7-…md`; `epic-4-engineering-report.md`; `packages/application/src/runs/waits.test.ts` ("keeps the FR-27 fixed answer sets closed and ordered", "resolves only one grounded key match and escalates every other non-empty result", "raises one wait, enters Awaiting Auditor, and computes the four-hour deadline", "times out an open wait once and rejects a wake job with extra payload"); `escalation-kind.ts` (`AWAITING_AUDITOR_TIMEOUT_MS` is 4 hours; closed option ids). Tests in [CI-c18]: `tests/integration/run-waits.test.ts` (8, including "refuses a duplicate singleton wake while the first enqueue is uncommitted"); `tests/e2e/escalations.spec.ts` (3); `conversation-answer-worker.spec.ts` (1); `agent-retrieved-abuse.spec.ts` (Retry, resumed denial, Abort; the answer note is excluded from the next model payload); `agent-escalation-abuse.spec.ts`. Mutations killed in [CI-c18]: `single-grounded-match-escalates`, `closed-wait-repeat-closure-guard`, `hydrated-no-preselected-answer`, `hydrated-closed-answer-selection`. `CLAUDE.md:2415`, `:3765`, `:3805`, `:3830`, `:3845` |
| Runtime and environment | As in [CI-c18], [CI-E4] and [LIVE] |
| Unresolved limitations (already named) | (1) The application adds Abort to every kind (Story 4.8's "abort on any Escalation kind"), so each stored answer set is its FR-27 set plus Abort (`CLAUDE.md:3765`). (2) Code read at `c18ad36`: the human-matched flag is recorded on the Observation (`matchOrigin: 'human-matched'`, `packages/application/src/runs/agent-human-decision.ts:76`). Only `apps/web/src/runs/EvidenceCards.tsx` (on the technical page `apps/web/app/runs/[id]/evidence/technical/artifacts/page.tsx`) and the grounding inspector read it |

**Acceptance criteria and the evidence for each**

1. *Choose candidate: the Run enters `AWAITING_AUDITOR`; a kind-agnostic wait record holds the
   candidate rows as supporting Evidence; exactly one durable job is created in the same
   transaction, with `startAfter = deadline` (4 hours), singleton key `wait:<id>` and payload
   `{schemaVersion, runId, waitId}`.* **Covered.** `waits.test.ts`; `run-waits.test.ts`;
   `escalations.spec.ts` ("opens grounded metadata").
2. *Closed answer set (choose by the declared secondary key, or mark the record ambiguous). One
   grounded match resolves without an Escalation; two rows with one key raise choose candidate;
   zero rows take the absence path.* **Covered.** `waits.test.ts`;
   `single-grounded-match-escalates`; `conversation-answer-worker.spec.ts`.
   **Leg not met on `c18ad36`: "a record chosen by secondary key is flagged human-matched in every
   Result, list, and export".** The Result publication (`packages/domain/src/runs/result.ts`), the
   Result tab, the record review queue and inspector (`apps/web/src/runs/RecordReview.tsx`) and the
   Exceptions list (`apps/web/app/runs/[id]/exceptions/page.tsx`) carry no human-matched flag. No
   export exists on `main`.
3. *Unnamed value: the condition is recorded Unevaluated with `rule does not name value <v>`,
   and the closed set is "mark Unevaluated and continue" or "abort".* **Covered.**
   `waits.test.ts`; `escalation-kind.ts`; `CLAUDE.md:2415`.
4. *Retry or skip: the closed set is retry, skip or abort; the Work Item is `AWAITING` while the
   wait is open; a second exhaustion after retry marks it `FAILED` and the Run continues.*
   **Covered.** `CLAUDE.md:3765` and `:3830`; `agent-retrieved-abuse.spec.ts`;
   `execute-agent-work-item.test.ts`.
5. *The agent receives only the chosen option identifier; no answer evaluates a record or
   changes scope, credentials, tools or the rule; the question is labelled agent-generated and
   inert.* **Covered.** `agent-retrieved-abuse.spec.ts` (answer note excluded, frozen definition
   unchanged); the escalation label mutation; the hydrated closed-answer mutations.

**Verdict: Residual work — PROPOSED, awaiting owner.**

- Residual scope (a): show the human-matched flag on the Result (publication and Result tab), on
  the record review queue and inspector, and on the Exceptions list. This is a bounded compiler-1
  follow-up on surfaces that are already built. Proposed owner: a small follow-up story the owner
  would add under Epic 10; no current story carries it.
- Residual scope (b): the export leg. Proposed transfer to 14-11a, the successor of 6-7 in
  `course-correction-dispositions.yaml`, so that the engagement export carries the flag.

### Story 4.8 — Answer an Escalation from Run Detail and notify Audit Managers

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]; `f4892c9` [CI-E4 34199194303] (browser answer, notification and timeout journeys; PostgreSQL races; hydrated-answer mutations); `9da4df6` [CI-E4] |
| Evidence relied on | `spec-4-8-…md`; `epic-4-engineering-report.md`; `epic-4-story-status.md`. Tests in [CI-c18]: `tests/e2e/escalations.spec.ts` (3 tests: "delivers to Auditor and Managers, opens grounded metadata, confirms once, and contains the note", "shows the compare-and-set refusal after the Run changes", "refuses a late answer, then the restarted worker consumes the durable wake and seals Inconclusive"); `tests/integration/notification-delivery.test.ts` (2, including "delivers in-app, records email unconfigured, and does not duplicate outcomes on replay"); `run-waits.test.ts` (8); `tests/integration/flag-run.test.ts` ("shows an open flag in the inbox and the bell…"); `tests/e2e/pause-resume.spec.ts:292`. Unit tests: `packages/application/src/notifications/ports.test.ts` (containment: no question, Evidence value or secret in the body); `packages/application/src/runs/waits.test.ts` ("routes abort through the cancellation seam and records the fixed reason", `Escalation answer: abort`). Mutations killed in [CI-c18]: `closed-wait-repeat-closure-guard`, `hydrated-no-preselected-answer`, `hydrated-closed-answer-selection`. `apps/web/src/design/copy.ts` (`notificationsEmpty`, `answerNoteLabel`, `pauseUnavailable`, `timeoutTemplate`, all pinned to the UX artifacts by the copy tests). `CLAUDE.md:1753`, `:2415`, `:3875`, `:3959` |
| Runtime and environment | As in [CI-c18] and [CI-E4]. No mail transport exists in any environment |
| Unresolved limitations (already named) | (1) Email is unconfigured by design (`epic-4-context.md` decision table; spec-4-8 Design Notes: "Wiring a real transport is an owner decision with a cost"). Epics 11 and 18 list email and push notifications under "Blocked after". (2) There are no scheduled Runs; Epic 8 is absorbed into 19-4 and 19-10. (3) There is no Workpaper Bundle; 6-7 is now 14-11a. (4) The compact Evidence tab from Auditor Workspace v1.1 (`CLAUDE.md:4174`) |

Code read at `c18ad36`:

- `packages/infrastructure/src/notifications/email-notification-sender.ts` is "Email's explicit
  no-transport implementation". It records only `unconfigured` or `superseded`.
- `packages/application/src/notifications/ports.ts`: `runNotificationRecipients(initiatorId,
  auditManagerIds)` has no scheduled-Run author.
- `apps/web/src/runs/detail.tsx`: on the compact Evidence tab
  (`apps/web/app/runs/[id]/evidence/page.tsx`), the frame renders `CompactOpenEscalationDisclosure`
  ("Open auditor decision", which links to the Workspace or to Run Detail) instead of the full
  panel.

**Acceptance criteria and the evidence for each**

1. *Notification records are created in the state-change transaction for the initiator (or the
   Procedure author for a scheduled Run) and every Audit Manager, delivered in-app and by email
   with idempotent send keys, with each outcome on the Audit Trail. The content has no Evidence
   value, question text or secret.*
   - **Covered:** in-app delivery, idempotency, outcomes on the Audit Trail, and content
     containment.
   - **Not met: email delivery.** No message is ever composed or sent; the outcome is recorded as
     `unconfigured`.
   - **Not met (forward dependency): "or the Procedure author for a scheduled Run".** Scheduled
     Runs do not exist.
2. *Notifications surface and bell: one row per Awaiting Auditor or flagged Run, with Procedure,
   Run, kind and time remaining; the bell's unread count; each row opens the Run; the empty
   state.*
   - **Covered.** `escalations.spec.ts` (bell and inbox agree; panel rows link to `/runs/<id>`);
     `flag-run.spec.ts`; pinned `notificationsEmpty`.
   - **Not met: "an email link deep-links to the same Run".** No email is composed.
3. *The Escalation panel on Run Detail shows kind, Step, the inert agent-generated question,
   supporting Evidence, the closed answers in FR27 order with no recommendation, the note
   "Recorded, not sent to the agent" and a countdown. It is at the top of every tab while Awaiting
   Auditor, and Pause is disabled with its sentence.*
   - **Covered** on the Result, Exceptions, Timeline and Review tabs: `escalations.spec.ts`,
     `EscalationPanel.test.ts`, `pause-resume.spec.ts:292` and the hydrated mutations.
   - **On the compact Evidence tab at `c18ad36`, the panel is replaced by the Auditor Workspace
     v1.1 "Open auditor decision" disclosure.** This is a later design, merged in PR #51. The owner
     needs to confirm that it supersedes "every tab".
4. *A routine confirmation; one locked, revision-guarded closing command; a second closure
   refused; the answer scoped to this Run, on the Execution Timeline and in the Workpaper Bundle;
   the panel then becomes a Timeline entry.*
   - **Covered**, except for the Bundle: `closed-wait-repeat-closure-guard`, `run-waits.test.ts`,
     `escalations.spec.ts` and `live-escalation.spec.ts` (Timeline entry).
   - **Not met (forward dependency): the Workpaper Bundle.** It does not exist on `main`.
5. *Abort ends the Run `CANCELED` with the reason "Escalation answer: abort".* **Covered.**
   `waits.test.ts`; `EscalationPanel.tsx` confirmation text.
6. *An Escalation unanswered for 4 hours wakes, the Run becomes `INCONCLUSIVE` with Evidence
   preserved, and the notification is superseded if the wait closed first. A late answer is
   refused with the timeout sentence.* **Covered.** `run-waits.test.ts` "times out an open wait
   into Inconclusive, seals the Result, and skips a replayed wake"; `escalations.spec.ts:527`;
   the email sender records `superseded`.

**Verdict: Residual work — PROPOSED, awaiting owner.**

- (a) **Email.** Owner decision. Either accept the recorded `unconfigured` outcome as the
  compiler-1 closure, with email transport named and deferred as in Epics 11 and 18, or fund a
  mail transport. No current story carries one.
- (b) Transfer the Workpaper Bundle leg to 14-11a.
- (c) Transfer the scheduled-Run-author recipient to 19-4.
- (d) Confirm that the Auditor Workspace v1.1 compact Evidence tab supersedes "at the top of every
  tab".

Proposed owner: the product owner for (a) and (d); stories 14-11a and 19-4 for (b) and (c). If
the owner accepts (a) as recorded, and (b), (c) and (d) as stated, the story closes as Done.

### Story 4.9 — Confirm or reject Agent-Judged evaluations to seal the Result

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]. `f4892c9` [CI-E4 34199194303]. `9da4df6` and `07f79e2` [LIVE]: `COMPLETED`, `PENDING_CONFIRMATION`, and a consistent C2 proposal retained; the harness does not impersonate a reviewer. `44fb596` [DEP]: three UI confirmations, sealed `CONTROL_FAILURE` version 2, original proposals unchanged, independent readback 7/7 |
| Evidence relied on | `epic-4-independent-verification.md` (4.9 row); `spec-4-9-…md`. Tests in [CI-c18]: `tests/e2e/agent-evaluation-journey.spec.ts` (2: confirm, and reject from the record inspector with a worker-signed Exception); `evaluation-review.spec.ts` (2: asserts version 2, sealed and `INCONCLUSIVE` after a rejection); `tests/integration/evaluation-review.test.ts` (6: concurrent answers, refused rationale or revoked role, durable worker command, refusal history). Unit tests: `packages/application/src/runs/evaluation-review.test.ts`; `apps/web/src/runs/EvaluationReview.test.ts` (count sentence; below-threshold card with no controls; Rule-Classified with no controls; "Submission is unavailable while the Result is unsealed."); `agent-model-gateway.test.ts` ("out-of-range confidence" refused as `invalid-response`; the strict schema requires `confidence`). The `agent-review-threshold-strict` mutation is killed in [CI-c18]. `disablement-window-journey.spec.ts` (confirmation seals PASS). `CLAUDE.md:2398`, `:2402`, `:3645`, `:3653`, `:3735`, `:3860` |
| Runtime and environment | As in [CI-c18], [CI-E4], [LIVE] and [DEP]. The deployed confirmations were scripted sessions, and the visual review was AI-assisted |
| Unresolved limitations (already named) | (1) Code read at `c18ad36`: `apps/web/src/runs/EvaluationReview.tsx` renders the sentence "Submission is unavailable while the Result is unsealed." as a statement. There is no Submit control on `main`. Result submission is Story 6.3, now 15-4. The decision not to render a dead control is recorded under Story 3.11 in `CLAUDE.md`. (2) A missing confidence has no named test; the strict schema requires the field, and the out-of-range case is tested. (3) The live harness stops at Pending Confirmation by design |

**Acceptance criteria and the evidence for each**

1. *The registration envelope carries the Agent-Judged evaluation (origin `AGENT_JUDGED`,
   pending, confidence and rationale) in the Observation's transaction.* **Covered.**
2. *Below the threshold: `UNEVALUATED`, confidence kept, no confirmation. Equal to the
   threshold: pending. A missing or out-of-range confidence fails schema validation and is
   retried.* **Covered.** The threshold mutation; the gateway tests; limitation (2).
3. *Pending Confirmation with the count sentence, **and Submit disabled with the sentence**; the
   cards show origin, value, rationale and confidence in mono, with Confirm and Reject; a
   below-threshold card and Rule-Classified cards have no controls.* **Covered, except the
   disabled Submit control, which does not exist on `main`.** That leg is a forward dependency on
   15-4.
4. *`ConfirmEvaluation` is refused unless the Run is `COMPLETED` and the Result unsealed; it locks
   the Result under the expected revision, increments the revision and evaluates the seal inside
   the lock.* **Covered.** `evaluation-review.test.ts` (serialized concurrent answers); the durable
   worker review command (`CLAUDE.md:3735`).
5. *`RejectEvaluation` records a replacement with a rationale and origin `HUMAN`, keeps the
   rejected proposal as history, and evaluates the seal under the same lock.* **Covered.**
   `evaluation-review.spec.ts`; `EvaluationReview.test.ts` ("keeps a rejection history
   visible…").
6. *The last resolution seals once, increments the Result version, and refuses later mutations. A
   rejection that leaves Unevaluated with no Exception moves the Run from `COMPLETED` to
   `INCONCLUSIVE`.* **Covered.** `evaluation-review.spec.ts:307`;
   `tests/integration/evaluation-review.test.ts:135`; [DEP] version 2.

**Verdict: Residual work — PROPOSED (transfer only), awaiting owner.** Residual scope: transfer the
"Submit is disabled" control leg to 15-4, the successor of 6-3. There is a precedent: Story 3.11
was accepted as done with the same recorded decision not to render a Submit control before Result
submission exists. If the owner applies that precedent, 4.9 closes as Done, with no other gap.

### Story 4.10 — Prove the agent path on ProdConsole with one Observation per parameter

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]; `f4892c9` [CI-E4 34199194303] (canonical P-4 on PostgreSQL; D2-b and D5 mutations); `04f2a3e` [CI-E4 34203072973] (browser job green with the corrected persisted-read proof; that run failed on a different job); `82adb83` [CI-E4 34205126512]; `9da4df6` [CI-E4] |
| Evidence relied on | `spec-4-10-…md`; `epic-4-fixture-map.md` (P-4 cases); `epic-4-prodconsole-snapshot-time-contract.md`; `epic-4-independent-verification.md`. Tests in [CI-c18]: `tests/e2e/prodconsole-agent-journey.spec.ts` (2). One of them is "reconciles every baseline parameter and seals the golden Inconclusive Result". It asserts the failing §H set before the outcome, and asserts the `execution.agent-page-declaration` event with `snapshotIdentifier` and `expectedParameterCount`. `tests/integration/prodconsole-agent-journey.test.ts` (2: "runs the real P-4 page and registers one Observation per distinct baseline key", "authorizes the served snapshot timestamp…"). Mutations killed in [CI-c18]: `p4-d2b-prohibited-baseline`, `p4-d5-duplicate-baseline-first-wins`. `CLAUDE.md:3680`, `:3690`, `:3705`, `:3730`, `:3750`, `:3905`, `:3935`, `:4196` |
| Runtime and environment | Hosted CI only: local Chromium and a synthetic provider ([CI-c18], [CI-E4]) |
| Unresolved limitations (already named) | (1) There is no live Solari or deployed P-4 evidence. (2) The owner's production P-4 on 2026-09-16 froze a second Target System. The agent claim refuses it with a sentence that names the wrong page. This is named, not fixed (`CLAUDE.md:610`). (3) The addendum's wording about the snapshot timestamp (§A.2 and §H against §C) is unresolved; `epic-4-prodconsole-snapshot-time-contract.md` asks the addendum owner. (4) P-4 cases D6, D7 and those after D9-a are named but not seeded |

**Acceptance criteria and the evidence for each**

1. *One Observation per baseline parameter, each grounded in the page's snapshot, with the
   parameter name as its identity attribute.* **Covered.** `prodconsole-agent-journey.test.ts` and
   `prodconsole-agent-journey.spec.ts`. The golden `production_debug_mode` is deliberately absent
   from the page, so it has no fabricated grounding and evaluates to `UNEVALUATED` (D4).
2. *The agent-extracted signed snapshot identifier and expected count are reconciled by the Gate
   against the Observations registered.* **Covered.** The declaration assertions in the spec; the
   `count-reconciliation-file` failure with `declared-count-mismatch`.
3. *The golden run end to end: a parameter that is absent or partly readable gives
   `INCONCLUSIVE`, never a silent Compliant.* **Covered.** The golden Inconclusive with its exact
   failing Gate set; the D2-b and D5 mutations.

**Verdict: Done — `[COMPILER-1 PATH]`.**

### Story 4.11 — Prove abuse resistance and workspace isolation with negative tests

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18] (22 guard and 7 worker mutations); `f4892c9` and `82adb83` [CI-E4]; `9da4df6` [LIVE 34317015975]; `07f79e2` [LIVE 34299424112]; `8eafbfb` [LIVE 34224743734] |
| Evidence relied on | `epic-4-hosted-guard-mutations.md` and `.json`; `epic-4-hosted-worker-mutations.json`; `epic-4-agent-guard-mutations.md` and `.json` (historical: 10 at `10b7d56`); `epic-4-live-provider-verification.json`; `epic-4-live-acceptance-07f79e2/solari-workspace-isolation.json`; `epic-4-solari-acceptance-runbook.md`; the mutation log in `spec-4-11-…md`. Tests in [CI-c18]: `tests/e2e/agent-retrieved-abuse.spec.ts` (6: D9-a and D9-b for P-1, the D9-a cases for P-2, P-3 and P-4, and a scope, objective, rule and secret attack); `agent-escalation-abuse.spec.ts` (5); `agent-worker-abuse.spec.ts` (3); `agent-credential-containment.spec.ts` (1); `tests/integration/agent-isolation.test.ts` (3); `agent-abuse.test.ts` (6); `tests/unit/agent-abuse-golden.test.ts`; `tests/unit/scope-widening.test.ts`. The [CI-c18] logs show the green-baseline and red-mutant result of all 29 mutations |
| Runtime and environment | [CI-c18]: local Chromium and a synthetic provider. [LIVE]: real Solari, two overlapping sessions, zero model requests in the isolation case |
| Unresolved limitations (already named) | (1) Isolation is proven for browser state and for the adapter's request interception. It is not proven for worker memory or for a provider-side firewall. (2) The web-app boundary was tested against a synthetic web-app origin; no deployed private service was contacted. (3) The remote mutation repetitions were not executed live; the runbook only maps them. (4) Local mode is the weaker guarantee in hosted CI |

**Acceptance criteria and the evidence for each**

1. *Retrieved content, including content surfaced through an Escalation question, cannot expand
   scope, invoke a denied tool, disclose a secret, alter the rule or modify the objective. The two
   seeded injection strings (one of them shaping an Escalation) fail to affect Run state.*
   **Covered.** `agent-retrieved-abuse.spec.ts`; `agent-escalation-abuse.spec.ts`; the
   `retrieved-worker-security-denial`, `stored-frozen-objective-scope-rule`,
   `golden-retrieved-objective-separation`, `golden-invented-tool-refusal` and hydrated-answer
   mutations.
2. *Two concurrent Runs: each workspace is isolated from the other Run and from the web app,
   holds no credential once its Run ends, and reaches only its own allowlisted destinations.*
   **Covered, with limitations (1) and (2).** `agent-isolation.test.ts`; the browser mutations;
   `browser-ended-workspace-state`; [LIVE] isolation ×3.
3. *The three seeded scope-widening Audit Instructions are all denied at execution and logged as
   security events, meeting the 100% denial bar.* **Covered.** `agent-worker-abuse.spec.ts` (SW-1,
   SW-2, SW-3); `scope-widening.test.ts`; the seeded action-gate mutations;
   `worker-malformed-proposal-security-event`.

**Verdict: Done — `[COMPILER-1 PATH]`.**

### Story 4.12 — Evaluate the 24-hour disablement window through the complete journey

**Status on `main`:** review. The key was renamed by Story 10.2, from `…-through-the-complet` to
`…-through-the-complete`, with its status carried over (`course-correction-dispositions.yaml`,
`renamed_keys`).

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18] (`disablement-window-journey.spec.ts`, 2 passed); `6237c4c` [CI-E4 34298099868] (hosted browser job); `9da4df6` [CI-E4 34316930519]; implementation at `be91d3e`; a local compiled-worker run recorded in `epic-4-engineering-continuation.md` ("D3: the 24-hour disablement window…") |
| Evidence relied on | `spec-4-12-…md` (its "Acceptance" table maps each owner requirement to its proof); `epic-4-story-status.md` (4.12 row). `tests/e2e/disablement-window-journey.spec.ts` (E-000105): "acquires both instants, grounds the disablement time by its label, and seals exactly 24 hours as a Pass", and "cannot substantiate the window from a date-only source…". `packages/application/src/runs/execute-agent-work-item.test.ts`: "captures Disabled time by its label, maps the population instant, and registers the exact 24-hour boundary as Compliant", and "captures a variant attribute only when the version asked for it…". `packages/domain/src/procedures/disablement-window.test.ts`; `tests/unit/canonical-loancore-compliance.test.ts`. `CLAUDE.md:2378` |
| Runtime and environment | As in [CI-c18] and [CI-E4]. The local run used PostgreSQL 18 at generation 41, the compiled worker, the rebuilt synthetic LoanCore and a real object store |
| Unresolved limitations (already named) | (1) The deployed acceptance does not assert the 24-hour rule (`loancore-final-acceptance-2026-09-18.md`: "no 24-hour revocation rule is asserted"). (2) A deployed LoanCore registration needs the `Disabled time` label through the authorized configuration flow (the spec-4-12 deferred list). (3) The Builder's Timing control freezes `termination_effective_time` only (`epic-4-hero-workflow-report.md` §2) |

**Acceptance criteria and the evidence for each**

1. *E-000105's exactly-24-hour case is Compliant under the inclusive boundary, and the variant
   `disabled_time` is captured only when the version's Evidence Requirements name it.* **Covered.**
   The journey spec's first case, and both unit cases above.

**Verdict: Done — `[COMPILER-1 PATH]`.**

