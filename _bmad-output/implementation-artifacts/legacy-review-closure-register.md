---
title: 'Legacy review closure register — Epic 4 and Epic 5'
type: 'register'
created: '2026-09-25'
story: '10-1-legacy-review-closure-assessment-for-the-epic-4-and-5-storie'
baseline: 'main c18ad3683d4e71d2654272e8cb95ef4559013374'
assessor: 'this session''s agent (Claude, executing Story 10.1 as a documentation-only assessment); Epic 5 sections, §3.1, §5 and §6 rebuilt by a second session (Claude) on 2026-09-25 after the unpushed commit d79bdcf was lost (§1)'
status: 'assessment complete — verdicts proposed; the owner''s dispositions of 2026-09-25 for 4.7, 4.8 (a), 4.9, 5.2 (a)–(b) and 5.4 (a) are recorded (§3.2); owner acceptance of the register is pending'
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

**Reconstruction (2026-09-25).** The first session wrote the Epic 5 sections, §5 and §6 in a
local commit, `d79bdcf`, that was never pushed. Its container was reclaimed, and GitHub cannot
resolve that commit. A second session rebuilt those parts from the pushed checkpoint `233ef7d`,
with the same rules and the same evidence tags. It downloaded the job logs of CI run 36026738508
again, and read the Epic 5 evidence, tests and code at `c18ad36`. The rebuilt text is new work,
not a copy of `d79bdcf`: only the first session read that commit. The rebuild found three points
that contradict Done verdicts that the first session proposed. It does not reverse those
verdicts; §3.1 accounts for each one and holds it for the owner. This is the version the owner
reviews.

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
| 5.1 Timeline live over SSE | review | **Done — `[COMPILER-1 PATH]`**, held (§3.1) | Every AC covered on the narrower reading of "Timeline event"; three families of Run-chain events are appended with no NOTIFY |
| 5.2 Replay asset set | review | **Residual work — PROPOSED** | Missing frames are shown on neither Replay nor the Result tab; retention and live recording legs unmet; frame role deviation; export to 14-11a |
| 5.3 Watch a Running Run in Live View | review | **Done — `[COMPILER-1 PATH]`**, held (§3.1) | AC 2's digest leg is not met: every adapter log row says "No artifact registered." The other ACs are covered on `c18ad36`, and Watch was deployed at `44fb596` |
| 5.4 Pause and resume | review | **Residual work — PROPOSED** | The Step is on no resume record, and on the pause record only when a Step Execution is in flight; the resume semantics to confirm |
| 5.5 Cancel and flag from Live View | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered; the placement and the N1 wording are owner decisions |
| 5.6 Answer an Escalation in Live View | review | **Done — `[COMPILER-1 PATH]`**, held (§3.1) | No evidence that the skip link moves focus, and a code read suggests it does not. The other ACs are covered, including the Flow 3 journey |
| 5.7 Stream drops or Run ends while open | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered |
| 5.8 Replay any terminal Run | review | **Done — `[COMPILER-1 PATH]`** | Every AC covered, with the provider blocked at the network in the browser; deployed at `44fb596`, not on `c18ad36` |

Totals for the seventeen stories in review: 12 Done — `[COMPILER-1 PATH]`, three of them held
(§3.1); 5 Residual work — PROPOSED, one of them transfer only; 0 Remains in review.

### 3.1 Done verdicts that the rebuild contradicts

The first session proposed twelve Done verdicts. On 2026-09-25 the owner asked that they are not
reversed arbitrarily, and that any point that contradicts a Done verdict is resolved or explicitly
accounted for. The rebuild read the Epic 5 evidence and the code at `c18ad36` again and found
three such points. None is resolved here: each resolution is either a code change or a reading of
an AC, and this assessment is authorised to do neither. Each is accounted for below. The verdict
stays as proposed, but it is **held**: §5 moves the story to `done` only after the owner decides
the point.

| Item | Story and AC leg | The contradicting fact (code read at `c18ad36`) | What §1's rules give | Resolution A | Resolution B |
|---|---|---|---|---|---|
| 1 | 5.1, AC1: "`NOTIFY run_timeline(run_id, seq)` fires in that same transaction" | Three families of events on a Run's chain are appended with no NOTIFY: `evidence-access.*` (web and worker), `notification.in-app-delivery` and `notification.email-delivery` (worker), and the evaluation review's `security.denied`. An open stream still sends them, in order and once, at its next heartbeat pass, at most 10 seconds later. No web surface reads these event types. `live-timeline-channel-v1.md` says that every append issues a NOTIFY | Done, if a Timeline event is an event that changes what a subscribing surface shows. Residual work — PROPOSED, if every append to a Run's chain is a Timeline event (AD-17's wording) | Accept the narrower reading. 5.1 closes as Done, and the contract sentence is corrected in a documentation change | Take the strict reading. 5.1 becomes Residual work — PROPOSED: a bounded follow-up issues the NOTIFY for every Run-aggregate append (for example once, in `appendAuditEvent`) |
| 2 | 5.3, AC 2: "the Adapter Session Steps render as log rows with counts and digests" | `apps/web/app/runs/[id]/live/page.tsx:347` passes `digest: null` for every adapter row. So every row says "No artifact registered.", also an ACQUIRED Reference Source row, which must name its Evidence (generation 29). Replay's copy of the same wiring was repaired in PR #36; Live View's copy was not. The unit test gives the component a digest, and the browser fixture seeds a step with no Evidence, so neither test can see the defect | Residual work — PROPOSED: the leg is not met, and the row states a false fact | 5.3 becomes Residual work — PROPOSED. The repair (Live View's adapter rows carry the registered digest, as Replay's do, with a browser assertion) is added to the bounded legacy follow-up | Scope amendment: the digest leg is recorded as not passed and is left out of 5.3's closure, and the defect goes to the Epic 5 retrospective. 5.3 closes as Done against the remaining scope |
| 3 | 5.6, AC 2: "a skip link 'Go to open Escalation' moves focus to the panel" | No test activates the link. Its target, `<section id="open-escalation">` (`EscalationPanel.tsx:443`), has no `tabIndex`. The shell's own skip-link target has `tabIndex={-1}`, and its comment says that without it the skip link "leaves focus on the link" (`AppShell.tsx:98`–`:100`) | Remains in review, with the missing check named: a browser test that presses Enter on the link and asserts that focus is inside `#open-escalation`. Residual work — PROPOSED, if the code read counts as evidence | 5.6 becomes Residual work — PROPOSED. The repair (`tabIndex={-1}` on the target, and the browser test) is added to the bounded legacy follow-up | 5.6 becomes Remains in review. Only the missing browser check is written first; if it fails, the repair follows |

**Recommendation.** Item 1: resolution A. No web surface shows these events, and an open stream
still sends them with no gap. Items 2 and 3: resolution A. Each is a small repair on a surface that
is already built, and the legacy follow-up already changes surfaces of the same kind.

### 3.2 Owner dispositions recorded on 2026-09-25

The owner decided five legacy exceptions before accepting the register. Each decision is recorded
in its story's section (§4) and changes no proposed verdict: every story below stays `review`
until its residual work is delivered or its scope is amended. A scope amendment may permit
closure, but the register never says that a removed requirement passed. Owner acceptance of the
register is still pending.

| Story | Owner disposition | Applied as |
|---|---|---|
| 4.7 | Prepare a bounded Epic 10 follow-up; the human-matched flag must be visible, with traceability, on the Result, review and list surfaces and on export | Residual (a): Story 10-6. Residual (b): an explicit 14-11a acceptance criterion |
| 4.8 (a) | In-app-only delivery is accepted; no mail transport is built | Scope amendment: email is unimplemented and was never delivered. (b)–(d) are still open (§6, point 3) |
| 4.9 | Transfer the Submit control obligation to 15.4, with a scope amendment | An explicit 15.4 acceptance criterion for submitting a retained compiler-1 Result. 4.9 closes as Done against its remaining scope on acceptance |
| 5.2 (a), (b) | Include in the visibility follow-up: Replay distinguishes a missing or unavailable frame from a suppressed one and states the limitation; keep the export indication | Residual (a): Story 10-6. Residual (b): an explicit 14-11a acceptance criterion. (c) and (d) are still open (§6, point 6) |
| 5.4 (a) | Accept the stored records only if they identify the exact Step and attempt; otherwise add linkage for new events in the follow-up, and never rewrite historical events | The stored records do not qualify: Story 10-6 adds the linkage for new events. (b) is still open (§6, point 7) |

Story 10-6 is prepared and not authorised for implementation. The owner authorised documentation,
decision recording, tracking corrections, design completion and story preparation on 2026-09-25,
and not application implementation.

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

**Owner disposition (2026-09-25).** Prepare a bounded Epic 10 follow-up. Human-selected matching
must stay visible on the relevant Result, review and list surfaces, and on the export surface,
with traceability to the matching decision. The missing distinction is not accepted as completed
behaviour. Applied: residual scope (a) is Story 10-6
(`10-6-legacy-visibility-follow-up-human-matched-provenance-missing.md`); residual scope (b) is
an explicit acceptance criterion of 14-11a in `epics.md`. Both stay explicit residual work of
this story: 4.7 stays `review` until they are delivered, or until the owner amends the scope.

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

**Owner disposition (2026-09-25), residual (a).** In-app-only delivery is accepted for the
retained compiler-1 scope. No mail transport is built to close this legacy story. **Scope
amendment:** email delivery is unimplemented and unconfigured. Every email outcome on the Audit
Trail reads `unconfigured` or `superseded`, and no email was ever delivered. This register does
not say the email leg passed: closure is against the remaining accepted scope. Residuals (b), (c)
and (d) have no owner decision yet; they are open point 3 in §6. 4.8 stays `review` until they
are decided and the register is accepted.

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

**Owner disposition (2026-09-25).** Transfer the Submit control obligation to 15.4 and record the
scope amendment. The evaluation confirmation, rejection and sealing obligations stay in 4.9, and
the evidence above covers them. Applied: 15.4 in `epics.md` now carries an explicit acceptance
criterion for submitting a retained compiler-1 Result (Submit available for a sealed `COMPLETED`
Result; disabled with "Submission is unavailable while the Result is unsealed." and the other
exact reasons), so generic artifact review is not assumed to cover it. **Scope amendment:** the
disabled Submit control is not on `main` and did not pass; it is 15.4's. With this amendment, 4.9
closes as **Done — `[COMPILER-1 PATH]`** against its remaining scope when the owner accepts the
register.

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

### Story 5.1 — Stream the Execution Timeline live over SSE

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]. `3a426a4` [CI-E5 34318755939]: the Story 5.1 commit, on PR #25, `success`. `1e7869c` [CI-E5 34417260412]: the final head of PR #25 (5.1–5.3), `success`. `82a7622` [CI-E5 34605206181] (PR #29) and `8c1fc69` [CI-E5 34994575889] (PR #36): the same suites again, both `success`. `44fb596` [DEP]: the deployed observer's Watch checks (visible acceptance 35340181283, job 105584051742) |
| Evidence relied on | `spec-5-1-stream-the-execution-timeline-live-over-sse.md` (Verification status: 24 unit tests in 5 files, 6 integration cases, 3 browser journeys with axe) and `epic-5-story-status.md` (5.1 row) [LOCAL]; `docs/contracts/live-timeline-channel-v1.md`; `epic-5-context.md`. Integration in [CI-c18] (job 107725083134): `tests/integration/run-timeline-channel.test.ts` (6: "replays the chain from the cursor, then delivers what the real commands append, in order and once", "ends itself at the lifetime with a planned end frame, and releases its listener", "tears the listener down when the request is aborted, with no end frame", "forwards every Run on the list stream, read from the chain, without a cursor", "says unavailable, and ends, when the chain cannot be read", "counts a listener per stream and releases every one") and `tests/integration/audit-events.test.ts` (8, including "serializes concurrent first appends under the head lock and matches independent golden hashes" and "rolls back both the event and advanced head when work fails"). Unit in [CI-c18] (job 107725082758): `packages/infrastructure/src/runs/run-timeline-channel.test.ts` (6, including "is the channel every writer in this package notifies on" and "keep the cadence inside AD-17 and the lifetime under the proxy cap"); `apps/web/app/api/runs/[id]/events/route.test.ts` (7); `apps/web/app/api/runs/events/route.test.ts` (2); `apps/web/src/runs/live-status.test.ts` (23); `apps/web/src/runs/LiveBanner.test.ts` (2, including "names the escalation events, the flag and the two ways a Run ends, and nothing else"). Browser in [CI-c18] (job 107725083111): `tests/e2e/live-timeline.spec.ts:98`, `:124`, `:142`; `live-view.spec.ts:469`; `live-escalation.spec.ts:211`; `selected-replay.spec.ts:257`; `escalations.spec.ts:406`. [DEP] job 105584051742 (`acceptance-result` line): `liveConnected: true` and `watchChangingWhileRunning: true`. That observer was built from `scripts/verify-deployed-loancore.mjs` at `44fb596` by the workflow's patch scripts (`final-loancore-visible-closeout.yml` at `1b9ee96`; for example `strict-loancore-patch.py` and `final-loancore-observer-patch.py` at `ab78abb`). `liveConnected` is set when Watch's `[data-live-status]` reads `live` (`scripts/verify-deployed-loancore.mjs:456` at `44fb596`; the patches read do not change it). `watchChangingWhileRunning` is set when at least two different images were delivered to, and shown on, the open Watch page while the Run was `RUNNING`; the observer's loop never reloads Watch. `CLAUDE.md:40`, `:681`, `:930`, `:2361` |
| Runtime and environment | [CI-c18] and [CI-E5]: hosted Linux, Node 24.20.0, PostgreSQL 18.6 over TLS, local headless Chromium with axe. The browser suite serves the web app with `next dev`, never a production build (`CLAUDE.md:2686`). The channel specs append events through the real `initiateRun` and `cancelRun` commands, or seed Run rows with held checkpoints; no worker drives those Runs. `live-view.spec.ts` and `selected-replay.spec.ts` start the real worker, to sign frame grants. [DEP]: as in §2 (production Railway at `44fb596`, schema 50, Solari worker with recording off; the observer is headless Chromium on a GitHub Actions runner). `CLAUDE.md:930` records a production-mode check (`next start`, read with curl) that this assessment did not reproduce |
| Unresolved limitations (already named) | (1) The heartbeat is an SSE event (`event: heartbeat`) every 10 seconds, not the "heartbeat comment" that AD-17 and the AC name. The reason is recorded: a comment is invisible to `EventSource`, and the 15-second stale rule needs a signal the page can observe (`CLAUDE.md:2361`; spec-5-1, Boundaries). The AC's bound is met: `HEARTBEAT_MS` is 10,000 (`run-timeline-channel.ts:103`), and the unit test pins it at or below 30,000 and below 15,000. The contract says the heartbeat is sent "while no Timeline event is sent"; code read at `c18ad36` sends it on a fixed interval, whatever else is sent (`run-timeline-channel.ts:263`). The integration cases run the cadence and the 14-minute lifetime at millisecond settings; `CLAUDE.md:930` records the real cadence in production mode (heartbeats at +10.04 s, +20.04 s and +30.04 s). (2) The route is `GET /api/runs/<id>/events[?after=<seq>]`, under `/api`. The AC names `/runs/<run-id>/events?after=<seq>`. The contract records the `/api` path. (3) The Overview has no subscription of its own. Code read at `c18ad36`: `apps/web/app/page.tsx:187-189` renders the plain `Updated {time}. Refresh.` banner and opens no stream. Without a navigation, its counts are read again only when the shell's `BellLive` calls `router.refresh()`, which re-renders the open page; no other shell, design or Overview component calls it. `BellLive` does that for four event kinds only: `execution.escalation-*`, `lifecycle.run-flagged`, `lifecycle.result-sealed` and `lifecycle.run-canceled` (`apps/web/src/shell/BellLive.tsx:21-43`). So a new Run (`lifecycle.run-queued`) does not re-read the Overview. `BellLive` drops a second such event that arrives within one second of its last re-read and schedules no later re-read (`BellLive.tsx:38`), unlike `useThrottledRefresh` (`LiveBanner.tsx:63-74`). `AppShell.tsx:95` mounts `BellLive` only when the unread count was read. The channel contract names four consumers and not the Overview (`live-timeline-channel-v1.md:4-5`). spec-5-1 deferred the Overview because it had no counts then; the counts arrived on 2026-09-16 (`CLAUDE.md:681`), and no subscription was added. (4) No test asserts that the bell's count or the Overview's counts change on screen without a reload. The bell's event filter has a unit test. `escalations.spec.ts` compares the bell with the inbox after a navigation to `/notifications`. The `BellLive` re-read itself is observed in a browser by `selected-replay.spec.ts:257`: a real `cancelRun` of another Run makes the open Replay page re-read (its "Read at" time moves) with the same viewer node (`CLAUDE.md:40`). spec-5-1 named the gap: "Not proven in a browser here: the bell count changing on a wait". (5) The 5-second bound is asserted in a browser on Run Detail (`live-timeline.spec.ts:98`) and on the Runs list (`:142`). On Live View the browser assertions allow 10 seconds (the flip to REPLAY, `live-view.spec.ts:469`) and 30 seconds (the Escalation arriving, `live-escalation.spec.ts:211`). The stale indicator is asserted in a browser on Run Detail only. Live View uses the same hook, the same one-second refresh throttle and the same `LiveBannerView` (`LiveGate.tsx:159-176`). (6) The reconnect guarantee is proven in two halves: the server's replay from a cursor, against real PostgreSQL, and the client's `seq > lastSeq` rule, as a pure function. No test drops a real stream and checks what arrives after the reconnect (see Story 5.7, AC3). spec-5-1 lists "an event committed during the replay is neither skipped nor duplicated" as proven by integration; no integration case commits an event during a replay. The order that prevents that gap (the LISTEN is armed before the replay, `run-timeline-channel.ts:248-261`) is a code read, and the pass at each heartbeat (`:263`) is the backstop. (7) Code read at `c18ad36`: not every append to a Run's chain issues the NOTIFY. Each writer issues it through its `notifyTimeline` port, and `appendAuditEvent` issues one itself only for an event that the Run conversation narrates (`packages/infrastructure/src/db/audit-events.ts:130-146`). At least three families are appended to a Run's aggregate with no NOTIFY in their transaction: `evidence-access.*` from the web's frame and inspector reads (`packages/infrastructure/src/runs/evidence-read-grant-repository.ts:354`, `:377`, `:416`, `:430`) and from the worker's grant decisions (`packages/application/src/runs/evidence-read-grant.ts:309-330`); `notification.in-app-delivery` and `notification.email-delivery` from the worker (`packages/infrastructure/src/notifications/notification-delivery.ts:128`); and the `security.denied` refusal in the evaluation review (`packages/application/src/runs/evaluation-review.ts:296`). An open stream still sends these events in order and once, at the latest at its next heartbeat pass, at most 10 seconds later, so no gap arises. But the contract's sentence "Every append issues `NOTIFY run_timeline` … in the appending transaction" is not true for them. No evidence file names this. (8) No deployed journey has run on `c18ad36` (§2). The [DEP] checks ran on `44fb596`, before the Auditor Workspace v1.1 merge put Live View's header and controls inside the gate (`LiveGate.tsx:106-114`) |

**Acceptance criteria and the evidence for each**

1. *When the transaction that appends a Timeline event, from the worker or the web, commits,
   `NOTIFY run_timeline(run_id, seq)` fires in that same transaction; `seq` is the chain sequence
   allocated under the Run head row lock, gapless and commit-ordered across writers (AD-17).*
   **Covered, except for at least three families of Run-chain events that are appended with no
   NOTIFY (limitation 7).**
   - Code read at `c18ad36`: `appendAuditEvent` (`packages/infrastructure/src/db/audit-events.ts:62-149`)
     takes `KEY SHARE` on the Run row, locks the aggregate's `audit_event_heads` row `FOR UPDATE`,
     sets `sequence = lastSequence + 1`, and then inserts the event and advances the head in the
     same transaction. All 18 `pg_notify(` calls in `packages/infrastructure/src` name
     `run_timeline`. Each runs on the transaction handle of the unit of work that appends the
     event, for example `runs-unit-of-work.ts:30`, `:75` and `:116`. PostgreSQL delivers a NOTIFY
     only when its transaction commits. No migration adds a NOTIFY trigger.
   - `audit-events.test.ts`: "serializes concurrent first appends under the head lock and matches
     independent golden hashes". The second writer waits for the open first transaction and gets
     sequence 2. The test uses the `platform` aggregate; a Run's chain goes through the same
     function. Also "rolls back both the event and advanced head when work fails".
   - `run-timeline-channel.test.ts` (unit): "is the channel every writer in this package notifies
     on". It walks the source tree and requires at least 8 sites, all on the channel constant.
   - `run-timeline-channel.test.ts` (integration): "replays the chain from the cursor, then delivers
     what the real commands append, in order and once". The real `initiateRun` and `cancelRun`
     transactions wake a real LISTEN, and ids 1 to 4 arrive in order.
2. *A request to `/runs/<run-id>/events?after=<seq>` replays every Timeline event with `seq` above
   the cursor, in order, before it streams new ones; the route sends a heartbeat comment at most
   every 30 seconds and caps its own lifetime under 15 minutes. Live View, the active Run Detail,
   the Runs list, Overview counts and the notification badge each subscribe to this one channel,
   and no WebSocket, Redis or provider stream is a source of truth (AD-17).* **Covered, with
   limitations (1) to (4).**
   - **The route.** `GET /api/runs/<id>/events[?after=<seq>]` authorizes before it resolves the
     Run. `route.test.ts`: "answers 401 before it resolves the Run, so a probe learns nothing from
     a missing one", "answers 403 with the denial reason", "answers 404 for a Run that is not
     there, after authorization", "answers 400 for a cursor that is not a non-negative integer"
     and "streams SSE for the Run, from the cursor, with the request signal".
   - **Replay, then live.** The integration case above. The replay sends sequence 1, and the live
     stream then sends 2 to 4. A stream opened at cursor 2 with a page size of 1 sends exactly 3
     and 4. A stream opened at the head sends only the keepalive.
   - **Heartbeat and lifetime.** 10 seconds and 14 minutes (`run-timeline-channel.ts:103-105`),
     pinned by "keep the cadence inside AD-17 and the lifetime under the proxy cap". The
     integration cases "ends itself at the lifetime with a planned end frame, and releases its
     listener" and "tears the listener down when the request is aborted, with no end frame".
     Limitation (1).
   - **Subscribers, code read at `c18ad36`.** Live View: `LiveGate` opens one `EventSource` on the
     per-Run stream while the Run is active (`apps/web/app/runs/[id]/live/page.tsx:245-249`,
     `LiveGate.tsx:149-168`). Active Run Detail: `LiveBanner` on the per-Run stream, only while the
     Run is active (`apps/web/src/runs/detail.tsx:229-231`, `:297-299`). Runs list: `LiveBanner`
     on the list stream `/api/runs/events`, which re-reads the page on every event
     (`apps/web/app/runs/page.tsx:70`). Notification badge: `BellLive` on the list stream
     (`apps/web/src/shell/BellLive.tsx:33-43`, mounted at `AppShell.tsx:95`). Overview counts: by
     composition only, through `BellLive`'s re-read (limitations 3 and 4). The Auditor Workspace
     page also subscribes, through `LiveGate` (`apps/web/app/runs/[id]/workspace/page.tsx:83`).
   - **Subscribers, in a browser.** Run Detail: `live-timeline.spec.ts:98`. Runs list:
     `live-timeline.spec.ts:142`. Live View: `live-view.spec.ts:469`, and
     `live-escalation.spec.ts:211`, where the Escalation arrives with no reload. The `BellLive`
     re-read: `selected-replay.spec.ts:257`. [DEP]: `liveConnected: true` on Watch, through the
     production proxy.
   - **Source of truth, code read at `c18ad36`.** Both streams LISTEN on PostgreSQL through
     postgres.js, and every frame they send is a row read from `audit_events`. No package in the
     workspace depends on Redis or on a WebSocket server library (every `package.json` read).
     Live View's frames are registered Evidence read through the Run's own route, not a provider
     stream; the [DEP] `watch-observed` event records "platform-owned sequential screen captures;
     not live video". The Auditor Workspace v1.1 near-live preview is a separate display, on the
     Auditor Workspace page only. It is enabled only with `WORKSPACE_PREVIEW_MODE=synthetic-local`
     outside production (`CLAUDE.md:4505`), it is labelled "Live preview, a few seconds behind. Not
     saved as evidence." (`apps/web/src/runs/workspace-words.ts:51`), and it carries no Run state.
3. *A client that reconnects with its last-seen `seq` as cursor misses no event and receives none
   twice (AD-17, NFR7). Live View reflects Run state within 5 seconds, and a stale indicator
   appears after 15 seconds without an update (FR24, UX-DR35, NFR7).* **Covered, with limitations
   (5) and (6).**
   - **No gap and no duplicate.** Server: the integration resume from cursor 2 sends exactly 3 and
     4, and none twice after further wake-ups. The cursor is `Last-Event-ID` first and `?after=`
     second: `route.test.ts` "prefers Last-Event-ID over the query on a reconnect" and
     `live-status.test.ts` "reads Last-Event-ID, then after, then 0". Client: `useLiveTimeline`
     renders a per-Run frame only when `acceptsLiveSeq(lastSeq, seq)` holds
     (`useLiveTimeline.ts:84-89`). The six cases of "a reconnect replays every missed event, in
     order, with no gap and no duplicate" in `live-status.test.ts` prove that rule.
   - **Within 5 seconds.** `live-timeline.spec.ts:98` "Run Detail follows a committed event within
     5 seconds, with no reload, and stops following a terminal Run" (a window marker proves no
     reload; axe clean). `:142` "the Runs list gains a Run initiated elsewhere without a reload".
     On Live View: `live-view.spec.ts:469` and `live-escalation.spec.ts:211` (limitation 5). [DEP]:
     `watchChangingWhileRunning: true`, with no reload of Watch. The `watch-observed` event records
     `runningScreens: 14` (different frame sources shown while `RUNNING`) and `distinctScreens: 8`
     (different images).
   - **Stale after 15 seconds.** `live-status.test.ts` "is live under 15 seconds of silence, stale
     from 15, lost from 60". `live-timeline.spec.ts:124` "says stale after 15 seconds without a
     frame, and live again once the stream is back". A heartbeat counts as an update, so a quiet
     but healthy stream stays `live`. `CLAUDE.md:930` records that the owner saw the stale sentence
     ("No update for 24 seconds") in production on 2026-09-16, and reads it as a real gap on the
     owner's own connection.

**Verdict: Done — `[COMPILER-1 PATH]`, held (§3.1, item 1).** AC1 is covered on the reading that
limits a Timeline event to an event that changes what a subscribing surface shows. Limitation (7)
contradicts the stricter reading, in which every append to a Run's chain is a Timeline event. The
owner decides which reading applies, and §5 moves this story only after that decision. Limitations
(3) and (4) are items for the Epic 5 retrospective (§6, point 15).

### Story 5.2 — Capture the platform-owned Replay asset set during execution

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]. `1e7869c` [CI-E5 34417260412], the PR #25 head that delivered 5.1–5.3. `9da4df6` and `07f79e2` [LIVE]: 5 Structural Snapshots and 5 screenshots registered through Solari, with provider recording off. `44fb596` [DEP]: after the workspace release, 15 of 15 Replay frames load, decode and match their registered hashes and sizes; credential-entry capture is suppressed; provider recording is off (issue #45, comments of 2026-09-18). Superseded: 35323749627 on `ef0515e` failed on frame delivery (Watch frames answered HTTP 502 and the first Replay image did not load), but its database facts show 15 registered screenshots and 15 capture/action joins in production (issue #45) |
| Evidence relied on | `docs/contracts/replay-asset-set-v1.md`; `epic-5-context.md` (lines 45–59); `epic-5-story-status.md` (5.2 row [LOCAL]: 3,764 unit tests, 9 integration tests on generation 44, both migration paths compared at 526/751/40, 3 mutations killed; `CLAUDE.md:2287` names two of them: a permissive credential guard, and "nothing resolved" treated as clean); `epic-5-implementation-report.md` §3.2 and §5 item 3; `review-epic-5-stories.md` ("`failure.frame-missing` is never flagged on Replay"); migrations `0043_replay_asset_role.sql` and `0044_replay_recording.sql`. Tests in [CI-c18]: `tests/integration/replay-assets.test.ts` (9); `tests/unit/replay-asset-set.test.ts` (9); `packages/application/src/runs/complete-run.test.ts` (32, four of them under "a frame the Run should have and does not"); `copy-recording.test.ts` (7); `agent-capture.test.ts` (10); `seal-package.test.ts` (17); `evidence-package.test.ts` (4); `packages/domain/src/runs/evidence.test.ts` (30, including "the artifact role"); `tests/integration/schema-compat.test.ts` (18; it lists `run_replay_recording` and the `role` column); `tests/integration/agent-journey.test.ts` (16); `tests/e2e/agent-sign-in.spec.ts:329`; `tests/e2e/workspace-preview.spec.ts:98` (preview job). `CLAUDE.md:1187`, `:1194`, `:2253`, `:2263`, `:2269`, `:2280`, `:2287`, `:2299`, `:2321`, `:3715` |
| Runtime and environment | [CI-c18]: hosted Linux, Node 24.20.0, PostgreSQL 18.6, local-mode Chromium, synthetic S3. `replay-assets.test.ts` seeds `run_tool_action` and `run_evidence_capture` rows and reads through the same context that the terminal transaction uses. Every recording case runs against a synthetic provider stub and an in-memory store. [LIVE] and [DEP]: real Solari with provider recording off, so the copy path never met a real recording |
| Unresolved limitations (already named) | (1) Provider retention is not set to minimum. `@solarisdk/browser@0.1.3` has no retention control, so this is an owner action against the provider account, not code (`CLAUDE.md:2299`; `replay-asset-set-v1.md`, "Two things this build does NOT do"; `epic-5-implementation-report.md` §5 item 3). (2) The live recording leg is unproven: every recording case runs against a synthetic provider (`CLAUDE.md:2303`). Recording is off in every live and deployed environment. `.railway/railway.ts:124` declares `SOLARI_RECORDING: 'false'` as a literal, because Solari records typed input and the sign-in types a credential (`CLAUDE.md:1187`, `:1194`). So no real recording has ever been copied. (3) Frame role deviation: a screenshot bound to a Tool Action keeps `role = 'evidence'` (`replay-asset-set-v1.md`, "Roles"; `CLAUDE.md:2263`). Code read at `c18ad36`: **no artifact is written with `role = 'replay'`**. The three `reserveArtifact` callers (`acquire-population.ts:183`, `execute-adapter-steps.ts:973`, `agent-capture.ts:42`) pass no role, and `evidence-package.ts:95` defaults it to `evidence`. The only `role: 'replay'` values in the code are fixtures in `packages/domain/src/runs/evidence.test.ts`. The session recording is stored in `run_replay_recording`, which has no role column. So the replay-role guards (the forced `required: false` in `reserveArtifact`, the seal filter, and the CHECK `run_evidence_replay_never_required`) serve no producer; only the seal filter has a test. (4) The sanitized action and the Observation delta are PostgreSQL rows by contract (`run_tool_action`, and the `execution.observations-registered` event in `audit_events`), not uploaded objects. No reservation, object key, size or digest applies to them (`replay-asset-set-v1.md`, "What an asset is"; `epic-5-context.md` lines 45–50). An adapter Run writes no `run_tool_action` row (Story 4.2, limitation (1)). (5) `failure.frame-missing` and `publication.evidence.framesMissing` have no reader in `apps/web`. Neither Replay nor the Result tab shows them (code read at `c18ad36`; named in `review-epic-5-stories.md`, "Wider than a repair"). (6) No export exists on `main`. The Workpaper Bundle is old story 6-7, now 14-11a. (7) The Escalation question is not in `run_wait`. It is the matching model turn's rationale in `run_agent_turn.response` (`waits.ts:185`; `replay-asset-set-v1.md` lines 40–43), and the pinned asset table does not list that table. The Session Step end time (`run_step_execution.completed_at`) is not in the table either. Code read at `c18ad36`: Replay shows none of the question, options, answer or actor, and no Session Step times |

**Acceptance criteria and the evidence for each**

1. *When a Tool Action completes, the platform captures a timestamped frame, the sanitized action
   and the Observation delta as Replay assets. Each is reserved with an idempotency key and a
   unique object key before upload, and verified by size and digest before it is marked Registered
   with `role = replay`.*
   - **Covered for the frame's reservation, upload, verification and registration.** Code read at
     `c18ad36`: each agent Tool Action asks for a Structural Snapshot and a screenshot
     (`requestedCapture` at `execute-agent-work-item.ts:1370`, `:1461` and `:1758`).
     `freezeAgentCapture` (`agent-capture.ts`) reserves each artifact through `reserveArtifact`,
     so the Evidence id and the object key derive from the Run, the kind and the Tool Action. It
     commits the `RESERVED` row, uploads and checks size and SHA-256 through `freezeArtifact`,
     registers the artifact with a measured `captured_at`, binds it to its action, and appends
     `execution.capture-registered`.
   - Tests: `agent-capture.test.ts` "re-reads frozen bytes and binds registered evidence to the
     actual action", "names the registered screenshot as the frame in the capture event" and
     "retains a reservation and refuses a read-back integrity mismatch"; `seal-package.test.ts`
     "reuses one reservation and one object when the same artifact is produced twice" and
     "refuses bytes that disagree with what a previous attempt registered";
     `evidence-package.test.ts` "stamps the measured capture provenance, and says the instant was
     measured"; `agent-journey.test.ts` "searches, captures and registers a grounded found
     Observation through the real shared writer" (the SHA-256 of each stored object equals its
     registered digest). [LIVE] and [DEP] as in the table.
   - The sanitized action is the `run_tool_action` row, and the Observation delta is the
     `execution.observations-registered` event (limitation 4).
   - **Not met as worded: `role = replay`.** Frames are registered with `role = 'evidence'`
     (limitation 3). The contract makes this choice on purpose: the screenshot is also the
     Evidence that `required-evidence` reads, so a missing screenshot leaves its Observation
     `UNEVALUATED` (`CLAUDE.md:3715`). The seal itself is not gated, because no Template lists
     `screenshot` as a required kind (`REQUIRED_EVIDENCE_KINDS`,
     `packages/domain/src/runs/evidence.ts:181`).
2. *When an Escalation is raised and answered, or a Session Step starts and ends, the Escalation's
   question, options, answer, actor and time, and the Session Step's start, end and outcome, are
   captured as Replay assets.* **Covered as the contract defines an asset, with limitation (7).**
   - The contract defines an asset as a row that PostgreSQL holds, and it lists each table and
     column (`replay-asset-set-v1.md`, "What an asset is"). `tests/unit/replay-asset-set.test.ts`
     reads that table off disk and requires each named column to exist in the schema: "names every
     asset the story delivers", and "%s reads %s, and every column it names exists" for each of
     the eight assets (9 tests in [CI-c18]).
   - Escalation: `run_wait` holds `options`, `opened_at`, `deadline`, `closed_at`,
     `closure_kind`, `answer_option_id` and `actor` (`packages/infrastructure/src/db/schema.ts`),
     and the CHECK `run_wait_closure` ties the actor to the closure kind. The question is the model turn's rationale,
     which Run Detail reads (`agentQuestion`, `wait-repository.ts:180`).
   - Session Step: the outcome is `run_session_step.state` and `diagnostic`. The start and end are
     `started_at` and `completed_at` on the Step Execution that runs the Session Step.
   - The rows are durable: `tests/integration/run-waits.test.ts` (8) and
     `packages/application/src/runs/waits.test.ts` (9), both from Story 4.7. `replay.spec.ts` raises its Escalation through the real `raiseEscalation` command, and
     Replay then lists it.
3. *When a frame capture fails or is missing, a Timeline `frame_missing` event is recorded when the
   package is sealed, and it is flagged on Replay and export. The seal is not blocked, because
   `replay`-role artifacts never gate `SealPackage`. A frame suppressed during a credential-entry
   Tool Action is recorded as suppressed, never as `frame_missing`.*
   - **Covered: the event, the unblocked seal and the suppression.** Code read at `c18ad36`:
     `readMissingFrames` (`result-repository.ts:312`) counts each `performed` Tool Action with
     capture `PERMITTED` and no `REGISTERED` screenshot bound to it. `completeRun` reads it after
     `sealPackage` has returned (`complete-run.ts:247`), puts the total on
     `publication.evidence.framesMissing` (`:293`), and appends one `failure.frame-missing` event
     with the exact total and a bounded sample (`:394`). A credential-entry action is
     `SUPPRESSED`, so the predicate excludes it. The event name is the closed-family spelling of
     `frame_missing`.
   - `replay-assets.test.ts` (PostgreSQL): "names the performed actions that left no registered
     frame, and no others" (a suppressed action and a denied action are not gaps); "records one
     failure event and flags the Result, without blocking the seal" (package `SEALED`,
     `framesMissing` 1, `missingRequired` 0); "counts EVERY gap while sampling at most the bound";
     "cannot be given a capture bound to Evidence that is not registered".
   - `complete-run.test.ts`: "records one event carrying the exact total and the bounded sample,
     and still seals a Pass"; "does not repeat itself when a human review seals the pending
     Result later".
   - The suppression is visible: `agent-sign-in.spec.ts:329` "the Timeline shows the Tool Action
     and says its capture was suppressed". [DEP]: credential-entry capture suppressed.
   - **Not met: "flagged on Replay".** Code read at `c18ad36`: nothing under `apps/web` reads
     `failure.frame-missing` or `framesMissing`. The Replay page
     (`apps/web/app/runs/[id]/replay/page.tsx`) reads no Result, and the only chain events it reads
     are Observation registrations (`readObservationDeltas`). The Result tab
     (`EvidencePackageSection`, `ResultSections.tsx:229`) shows the package state, the counts and
     the artifacts, but not `framesMissing` (limitation 5).
   - **Not met (forward dependency): "flagged on export".** No export exists on `main`. The Result
     publication carries `framesMissing` for a later export reader (`complete-run.ts:290`).
4. *When the Workspace Provider recorded the session, the recording is copied into platform
   storage at Run end and provider retention is set to minimum. Replay never depends on the
   provider afterward.*
   - **Covered against a synthetic provider only: the copy.** Code read at `c18ad36`: at the
     terminal release, `releaseWorkspace` calls `copyRecording` after the provider release
     (`provision-workspace.ts:772`). `copyRecording` scans the bytes for every credential that the
     frozen plan names, stores and verifies them through `freezeArtifact`, and writes
     `run_replay_recording` with a `lifecycle.replay-recording-copied` event. Tests:
     `copy-recording.test.ts` (7), including "stores it, verifies it, and says so on the
     Timeline", "REFUSES a recording that discloses a credential, and stores nothing" and "says
     "not enabled" when the provider recorded nothing, which is the ordinary case";
     `replay-assets.test.ts` "stores a verified copy, and the row says what it holds", "refuses one
     that discloses a credential, and stores nothing at all", "answers once per Run, so a reaper
     retry cannot buy a second recording" and "refuses a row that says it is stored and has nothing
     behind it". The only real-adapter call on record is in local mode, where `downloadRecording`
     returns `null` (`workspace-preview.spec.ts:98`, preview job). Limitation (2) applies.
   - **Not met: "provider retention is set to minimum".** It is not built (limitation 1).
     `browser-execution.ts:675` states that this SDK cannot express it.
   - **Covered: Replay never depends on the provider.** Nothing on the Replay path reads a provider
     recording (`replay-v1.md`, "What this contract does not cover"). Story 5.8's blocked-network
     test renders the whole Run.

**Verdict: Residual work — PROPOSED, awaiting owner.**

- Residual scope (a): flag missing frames on Replay. Read `publication.evidence.framesMissing` on
  the Replay page (and on the Result tab), and say "not recorded" for an older Result that has no
  such key, as the contract asks. This is a bounded compiler-1 follow-up on surfaces that are
  already built. Proposed owner: a small follow-up story the owner would add under Epic 10; no
  current story carries it.
- Residual scope (b): the export leg. Proposed transfer to 14-11a, the successor of 6-7 in
  `course-correction-dispositions.yaml`, so that the engagement export carries `framesMissing`.
- Residual scope (c): provider retention and the live recording copy. Owner decision: either
  accept the recorded state as the compiler-1 closure (the copy path is built and tested against a
  synthetic provider, and recording stays off by the 2026-09-15 decision, so no provider
  recording exists to retain or copy), or keep both legs open until provider input masking and
  minimum retention are verified against the account. Proposed owner: the product owner. Minimum
  retention is an action against the provider account, not a code change.
- Residual scope (d): the frame role deviation. Owner decision: accept the contract's reading of
  AC1 (a frame keeps `role = 'evidence'`; the sanitized action and the Observation delta are rows),
  or ask for a replay-role artifact path. Proposed owner: the product owner; no code change if
  accepted.

If the owner accepts (c) and (d) as recorded and (b) as a transfer, (a) is the only code change
left.

**Owner disposition (2026-09-25), residuals (a) and (b).** Include (a) in the bounded legacy
visibility follow-up. Replay must distinguish a frame that is missing or unavailable from a frame
suppressed on purpose during credential entry, and state the limitation instead of implying
complete playback. Keep the export indication. The missing indication is not accepted as
completed behaviour. Applied: (a) is Story 10-6 on Replay; the Result tab, which the AC does not
name, is not added. (b) is an explicit acceptance criterion of 14-11a in `epics.md`. Both stay
explicit residual work of this story. Residuals (c) and (d) have no owner decision yet; they are
open point 6 in §6. 5.2 stays `review`.

### Story 5.3 — Watch a Running Run in Live View

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]: `tests/e2e/live-view.spec.ts`, 8 of 8 passed. `1e7869c` [CI-E5 34417260412], the PR #25 head that delivered 5.1–5.3. `82a7622` [CI-E5 34605206181] (PR #29) and `8c1fc69` [CI-E5 34994575889] (PR #36). `aa108e0` [CI-E5 35328629164], the PR #47 candidate that repaired frame delivery. `b79f76f` [CI-E5 35335573874], the PR #48 head that repaired the Watch framing; 214 of 214 browser tests (both SHAs are from issue #45). `44fb596` [DEP]: visible acceptance 35340181283, 36 of 36 checks; 15 frames delivered, 14 fully visible captures while the same Run was RUNNING, eight distinct screens, all three records followed (issue #45, comments of 2026-09-18). Superseded: 35323749627 on `ef0515e` (16 Watch frame responses were HTTP 502 and no frame was shown) and 35333706645 on `816d6b5` (the automated checks passed; the visual review rejected the Watch framing) |
| Evidence relied on | `spec-5-3-watch-a-running-run-in-live-view.md` (Verification status [LOCAL]: 42 unit tests, 5 integration cases on generation 42, 9 browser cases with axe, 2 mutations killed); `docs/contracts/live-view-v1.md`; `epic-5-story-status.md` (5.3 row); `epic-5-evidence-delivery-repair-2026-09-18.md` (the 502 frames were a response MIME declaration; PR #47 binds the registered media type when the worker signs); `epic-5-watch-viewport-repair-2026-09-18.md` (the stage stretched with the rail; PR #48 top-aligns it); `ui-cleanup-2026-09-22/p5-report.md` (UX-28, UX-29, UX-47, UX-48). Tests in [CI-c18]: `tests/e2e/live-view.spec.ts` (8); `apps/web/src/runs/LiveViewer.test.ts` (25); `live-view.test.ts` (17); `live-status.test.ts` (23); `LiveGate.test.ts` (4); `apps/web/app/api/runs/[id]/frames/[evidenceId]/route.test.ts` (18); `apps/web/src/design/copy.test.ts` (51); `tokens.test.ts` (the nine `session-viewer.*` values, eight of them added by 5.3); `packages/application/src/runs/agent-capture.test.ts` (10); `tests/unit/evidence-s3-delivery.test.ts` (6); `tests/integration/evidence-read-grant.test.ts` (14, four of them on frames); `run-timeline-channel.test.ts` (6); `logical-step-progress.test.ts` (4); `tests/e2e/live-escalation.spec.ts:211`; `pause-resume.spec.ts:130`; `flag-run.spec.ts:113`; `owner-walkthrough.spec.ts:400`. The [DEP] checks `liveConnected`, `visibleInspection` and `watchNamesTheRecord` (`scripts/verify-deployed-loancore.mjs`, phase `watch-inspection`). `CLAUDE.md:23`, `:345`, `:381`, `:1806`, `:2350` |
| Runtime and environment | [CI-c18]: hosted Linux, Node 24.20.0, PostgreSQL 18.6, local Chromium with axe (WCAG 2.1 AA, no allowlist). `live-view.spec.ts` seeds its Run rows. It spawns the real compiled worker only to sign the frame grants, over a synthetic S3; no agent executes. [DEP]: production at `44fb596`, Solari with recording off, OpenAI `gpt-5.6`, an observer Chromium at 1440×1000, and an AI-assisted visual review. No deployed journey has run on `c18ad36` |
| Unresolved limitations (already named) | (1) No browser fixture seeds a Work Item on Live View. The rail's Work Item line is proven by unit test and by the [DEP] check `watchNamesTheRecord` (`CLAUDE.md:381`). (2) Watch shows action-linked captured frames, not continuous video. At [DEP] the median gap between frames was about 8 s and the largest 14 s (issue #45). CI proves that the frame element is visible within 5 s of opening the page. No test measures the delay from capture to display on a live Run. (3) The deployed evidence predates the UI cleanup and Auditor Workspace v1.1. At `c18ad36` Live View has one header row that carries Pause/Resume, Cancel and Flag (UX-48), the Evidence inventory behind a disclosure, and the Run controller panel in the rail. The current Step is read by `readLatestStepExecution`; at `44fb596` it came from the bounded Timeline page (`CLAUDE.md:23`). (4) Code read at `c18ad36`: the adapter log rows never carry a digest. `apps/web/app/runs/[id]/live/page.tsx:347` passes `digest: null` for every row, so `LiveViewer.tsx:366` renders "No artifact registered.". Replay's copy of the same wiring was repaired in PR #36 (`review-epic-5-stories.md` F16, `digestByEvidence`). Live View's copy was not; it passes `null` at `8c1fc69`, `44fb596` and `c18ad36`. An API extraction is a Work Item, not a `run_session_step` row (`execute-adapter-steps.ts:551` and `:567`), so it gets no log row at all. (5) No test renders a non-empty "Evidence as registered" list on Live View. `LiveViewer.test.ts` covers only the empty sentence. The page reads the same `readEvidenceItems` as the Evidence tab. (6) No test closes a Live View tab during a Run. The evidence for AC 3 is structural. (7) At a terminal transition `LiveGate` swaps `SubscribedGate` for `TerminalGate`, and that remounts the viewer (code read; the remount is named in `review-epic-5-stories.md`). The REPLAY state sentence therefore arrives in a new node. No test asserts what a screen reader hears at that change. (8) Below 1024 px the Run controller panel's mutating buttons read the same gate (code read, `RunControllerLease.tsx:343`–`:369`), but the 900 px test asserts only Pause, Cancel Run and Flag to Audit Manager. The panel's `Refresh control` button, which only reads, is not gated. The 1024 px floor is two copies of one number (`review-epic-5-stories.md`) |

**Acceptance criteria and the evidence for each**

1. *When an Auditor opens Live View on a Running Run, the session viewer renders in a navy chrome
   strip with the state dot and the word LIVE. The workspace screen streams from the captured
   frames within 5 seconds. The current Step, Work Item, Observations and Evidence as registered
   are shown. The natural-language Audit Instructions for the agent-driven Target System being
   worked are shown verbatim.* **Covered, with limitations (1), (2) and (5).**
   - Chrome: code read at `c18ad36`, `.ls-session__chrome` sets `background: var(--color-navy)`
     (`apps/web/app/globals.css:1901`–`:1907`). `tokens.test.ts` "%s is written into globals.css
     with the documented value" pins `session-viewer.chrome-background` and the four dot colours.
     `LiveViewer.test.ts` "announces the state as a sentence and shows the dot and word to
     everyone else". `live-view.spec.ts:230` sees the word `LIVE`.
   - Frames: `live-view.spec.ts:230` "streams the captured frame through the Run’s own protected
     route, and names the session". The frame element is visible within 5,000 ms of opening the
     page and then decodes. Its `src` is `/api/runs/<id>/frames/<id>`, and the route answers the
     exact PNG bytes with the registered digest as its ETag, through a grant the real worker
     signed. `evidence-read-grant.test.ts` "issues a frame grant over a registered screenshot and
     yields the verified PNG bytes" and "reads a frame only through its capture binding, and never
     a loose screenshot". `agent-capture.test.ts` "names the registered screenshot as the frame in
     the capture event" (the capture notifies the live channel). `evidence-s3-delivery.test.ts`
     "reproduces the unsigned-response MIME failure, then reads historical PNG bytes with no
     rewrite". `live-view.spec.ts:293` and `:381` keep the screen at the top and inside the first
     viewport at 1366×768. [DEP] as in Tested revisions.
   - Step, Work Item, Observations and Evidence: `live-view.spec.ts:230` (the rail's Step
     narration). `LiveViewer.test.ts` "names the record the Agent is inspecting, then the system",
     "keeps the system name alone for a Work Item that inspects no record" and "states an absent
     Step, Work Item and Evidence in words, never as a gap". `logical-step-progress.test.ts`
     "reads the step a long Run is on now, beyond the first page, and one step by id (UI cleanup
     2026-09-23)". [DEP] `watchNamesTheRecord`.
   - Audit Instructions: `LiveViewer.test.ts` "shows the auditor’s own Audit Instructions verbatim
     and inert". Code read at `c18ad36`: the page passes every instruction in the frozen plan, each
     under its Target System's name (`page.tsx:336`–`:339`). It does not single out the system
     being worked. With one agent-driven system (P-1, P-4) the two are the same.
2. *On an adapter-only Run, Live View shows no workspace screen, and the Adapter Session Steps
   render as log rows with counts and digests.*
   - **Covered: no screen, and log rows with a state word and an attempt count.**
     `live-view.spec.ts:362` "says why there is no screen on an adapter-only Run, and lists its
     Session Steps". `LiveViewer.test.ts` "says why there is no frame rather than showing an empty
     stage".
   - **Not met: "with … digests".** Limitation (4). The stage sentence says the steps are "listed
     below with their counts and integrity digests" (`LIVE_VIEW_STAGE.adapterOnly`), and each row
     says "No artifact registered.". An ACQUIRED `extract-adapter` row must name its Evidence
     (`run_session_step_acquired`, generation 29, `0029_calm_spectrum.sql:58`), so the row's
     sentence is false for every acquired Reference Source. `LiveViewer.test.ts` "lists an adapter
     Run’s Session Steps as log rows with their digests" hands the component a digest directly.
     `live-view.spec.ts:362` seeds an in-progress step with no Evidence. Neither test can see the
     page's `null`.
3. *When the Auditor closes the tab, the Run continues unaffected.* **Covered, with limitation
   (6).** Code read at `c18ad36`: Live View reads on the server and holds one `EventSource`
   (`LiveGate`); the worker executes the Run from the durable queue. `run-timeline-channel.test.ts`
   "tears the listener down when the request is aborted, with no end frame".
   `owner-walkthrough.spec.ts:400` runs a Run to its sealed Result through the real worker, with no
   Live View open at all.
4. *When a frame is shown or the Run state changes, the frame's `alt` equals the Step narration,
   `aria-live="polite"` announces the state change, and Live View passes automated WCAG 2.1 AA
   checks.* **Covered, with limitation (7).**
   - `live-view.test.ts` "gives the frame the SAME narration string as its Step row, in audit
     words". `LiveViewer.test.ts` "narrates the frame with its Step’s sentence (UX-DR37)".
     `live-view.spec.ts:230` asserts that the rail's narration equals the frame's `alt`.
   - `LiveViewer.test.ts` "announces the state as a sentence and shows the dot and word to everyone
     else". `live-escalation.spec.ts:211` sees the polite sentence change from "Session LIVE." to
     "Session AWAITING." and back to "Session LIVE." with no reload.
   - axe, with no allowlist, on Live View: `live-view.spec.ts:230` (Running, with a frame),
     `flag-run.spec.ts:113` (the flag panel open), `live-escalation.spec.ts:211` (Awaiting Auditor,
     then Paused) and `pause-resume.spec.ts:130` (Paused).
5. *Below 1024 px, Live View renders read-only with "Open on a desktop browser to supervise this
   Run." and every control disabled.* **Covered, with limitation (8).** `live-view.spec.ts:434`
   "renders read-only below 1024px — the floor sentence, and the controls withdrawn": at 900 px the
   sentence shows and Pause, Cancel Run and Flag to Audit Manager are `aria-disabled`; at 1280 px
   all three are live again. `copy.test.ts` "is EXPERIENCE.md's responsive floor for Live View,
   character for character". `live-status.test.ts` "closes on a narrow viewport, above every other
   reason" and "falls back to the legacy addListener pair (Safari 13), so a rotation still re-reads
   the gate". The Escalation panel's answers and note read the same gate (code read,
   `EscalationPanel.tsx:297` and `:324`).

**Verdict: Done — `[COMPILER-1 PATH]`, held (§3.1, item 2).** This is the verdict that the first
session proposed. The rebuild found that AC 2's digest leg is not met on Live View at `c18ad36`
(limitation (4)). Under §1's rules, that fact gives Residual work — PROPOSED. The verdict is not
reversed here: §3.1 states the contradiction and the two resolutions, and the owner decides. §5
moves this story only after that decision. Limitations (1), (2), (5) and (6) are items for the
Epic 5 retrospective (§6, point 15).

### Story 5.4 — Pause and resume a Running Run

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]: the unit, integration and browser jobs, and the preview job (`workspace-preview-worker.spec.ts:168`). `8c1fc69` [CI-E5 34994575889] (PR #36): browser job 104467471878 passed `pause-resume.spec.ts:124` and `:196` and `live-escalation.spec.ts:199`; integration job 104467472088 passed `pause-run.test.ts` (20 tests) and `run-waits.test.ts` (8). `82a7622` [CI-E5 34605206181] (PR #29): browser job 103281831226 passed `pause-resume.spec.ts:122` and `:192` and `live-escalation.spec.ts:199` (193 passed); integration job 103281831040 passed `pause-run.test.ts` (20) and `run-waits.test.ts` (8). The per-test lines for both [CI-E5] runs were read from their downloaded job logs. [LOCAL]: a developer host at generations 45–47 (`epic-5-story-status.md`, 5.4 row: 16 unit tests on the commands, 4 on the stage boundaries, 2 mutations killed, 17 integration tests, 2 browser journeys) and the reviewer's machine at generation 49 (`review-epic-5-stories.md`, Verification). No [LIVE] or [DEP] run exercised a pause (limitation (6)) |
| Evidence relied on | `docs/contracts/run-pause-v1.md`; `review-epic-5-stories.md` (F1–F6; "Named, NOT fixed here", lines 112–122 and 140); `epic-5-story-status.md` (lines 20 and 33–47); `epic-5-implementation-report.md` (§3.2, §4, §5 item 4); the PR #36 body ("What is deliberately not in this PR"). Browser tests in [CI-c18]: `tests/e2e/pause-resume.spec.ts` (3); `live-escalation.spec.ts:211`; `prodconsole-agent-journey.spec.ts:321` (the compiled worker pauses and resumes a real P-4 Run); `live-view.spec.ts:469`; `run-controller-lease.spec.ts:606` and `:858`; `deferred-pause.spec.ts` (4); preview job `workspace-preview-worker.spec.ts:168`. Integration tests in [CI-c18]: `tests/integration/pause-run.test.ts` (22), `run-waits.test.ts` (8), `deferred-pause.test.ts` (5), `agent-journey.test.ts` (the four "executes a confirmed deferred pause through real PostgreSQL and Chromium (…)" cases), `agent-workspace.test.ts` (19), `run-surfaces.test.ts` (11), `logical-step-progress.test.ts` (4). Unit tests in [CI-c18]: `packages/application/src/runs/pause-run.test.ts` (34), `execute-agent-work-item.test.ts` (52), `execute-agent-steps.test.ts` (50), `provision-workspace.test.ts` (30), `complete-run.test.ts` (32), `waits.test.ts` (9); `apps/web/src/runs/PauseBanners.test.ts` (7), `stop-reason.test.ts` (17), `live-view.test.ts` (17); `apps/web/src/design/copy.test.ts`. `CLAUDE.md:79`, `:143`, `:906`, `:990`, `:1006`, `:1397`, `:1407`, `:1515`, `:1616`, `:1991`–`:2036`, `:3675`, `:4188`, `:4196`, `:4233`, `:4301` |
| Runtime and environment | [CI-c18] and [CI-E5]: hosted Linux, Node 24.20.0, PostgreSQL 18.6, local-mode Chromium, a synthetic model HTTP fixture and synthetic S3. The preview job runs `WORKSPACE_PREVIEW_MODE=synthetic-local`, with web and one worker on the same loopback host. The two surface journeys (`pause-resume.spec.ts`, `live-escalation.spec.ts`) start no worker: they call `performPause` through `PostgresWaitRepository` in place of the worker boundary. [LOCAL]: real PostgreSQL 18, real Chromium and the compiled worker on a developer host; the reviewer ran browser specs only. No Solari session and no production Run was paused |
| Unresolved limitations (already named) | (1) The worker boundary in the two surface journeys is simulated: they call the same `performPause` and pass no Step Execution (spec headers; `epic-5-story-status.md:33`: "Story 5.4's worker-boundary leg is proven below the browser, not in it"). At `c18ad36`, two compiled-worker journeys add real boundaries: `prodconsole-agent-journey.spec.ts:321` (the P-4 response boundary) and `workspace-preview-worker.spec.ts:168` (preview job). (2) The adapter-stage pause arm is driven by no test, and `pauseRunAction`/`resumeRunAction` have no unit test of their own (`review-epic-5-stories.md:140`). Both are still true at `c18ad36`: `execute-adapter-steps.test.ts` declares `pauseWaits` and no case sets a `pauseRequest`; `apps/web/app/runs/actions.test.ts` has no pause or resume case. The browser journeys exercise the two actions. (3) Resume semantics differ between the planning artifacts. epics.md Story 5.4 and AD-16 (`ARCHITECTURE-SPINE.md:278`) restart the current Step Execution from its first Tool Action as a new attempt. EXPERIENCE.md's Flow 3 alternate says "on resume the agent continues from the next Tool Action" (line 295 at `c18ad36`, line 297 on this branch; the 2026-09-10 records cite line 292). The code follows epics.md. This was reported to the owner on 2026-09-10 and is not settled (`CLAUDE.md:2028`; `run-pause-v1.md`, "This follows the story spec over EXPERIENCE.md"; `epic-5-implementation-report.md` §5 item 4, which recommends keeping the restart). Proposal 5 §1b (`proposal-5-epics.md:85`) asks that it be recorded as a limitation. (4) The resume marker has a different name and place. epics.md says "a new attempt marked `superseded_by_resume`". AD-16 says the earlier attempt's Tool Actions stay on the Timeline "marked `superseded_by_resume`". The code marks the EARLIER Step Execution: `state = 'SUPERSEDED'` and `superseded_by = 'resume'` (generation 45, CHECK `run_step_execution_superseded`). The new attempt carries no marker. No web surface reads `superseded_by`; the Timeline shows the word "Superseded" (`apps/web/src/runs/labels.ts:195`) with the earlier attempt's Tool Actions nested under it. (5) Workspace lease. Code read at `c18ad36`: `runIsOver` (`provision-workspace.ts:325`) treats `PAUSED` as bound, so a paused Run keeps its workspace, and the reaper selects terminal Runs only. Nothing extends a lease to the pause deadline; the provider's hard session expiry bounds it (Story 4.1 limitation (4)). A resume after expiry takes the replacement path with a fresh sign-in. No test forces a lost workspace between a pause and its resume; `workspace-preview-worker.spec.ts:168` accepts either a reattach or a replacement. (6) No live Solari or deployed evidence of a pause or a resume exists. `loancore-final-acceptance-2026-09-18.md` (branch `validation/loancore-watch-closeout-20260918`, commit `5092153`), `live-auditor-verification-2026-09-17.md` and `loancore-acceptance-2026-09-17.md` contain no pause, resume or `PAUSED`. (7) Whether pause and resume events carry the Step is an owner decision open since PR #36 (`review-epic-5-stories.md:120`: "`lifecycle.run-resumed` records no Step, and `run-paused` records none at two of three boundaries. 5.4's AC says 'resume records actor, time, and Step'. A payload shape decision on an immutable chain, not a review repair."; the PR #36 body lists it as "whether pause/resume events should carry the Step"). The facts are in the block below. (8) Not named before this assessment: `lifecycle.pause-superseded` is written to the Run's audit chain with a `run_timeline` notification, but the Execution Timeline tab renders Session Steps, Work Items, Step Executions and Tool Actions, not events, so no Run Detail row shows it. The Auditor Workspace conversation shows it only as the receipt of a conversational pause. (9) Not named before this assessment: no pause-timeout test seeds registered Evidence and reads it back after the wake. "Evidence preserved" rests on the shared `completeRun` seal; `run-waits.test.ts` proves that seal on the same `wakeEscalation` path for an Escalation. (10) Not named before this assessment: "last frame held" is not asserted in a browser. Code read at `c18ad36`: Live View reads the newest registered frame whatever the Run state (`readLatestFrame` in `apps/web/app/runs/[id]/live/page.tsx`). `live-view.spec.ts:469` seeds a `PAUSED` Run with a frame and asserts the word "PAUSED", not the image |

**The Step on the pause and resume records (code read at `c18ad36`)**

The owner stated the rule for limitation (7) on 2026-09-25: accept the stored records only if they
identify the exact Step and attempt of each pause and each resume, also after the Run advances
or resumes repeatedly. A Run's current Step alone is not enough. These are the facts.

Where a pause is honoured, and what the pause record names:

| Boundary | In flight | `lifecycle.run-paused` payload names | Step and attempt durably recorded? |
|---|---|---|---|
| Work Item stage, six in-flight boundaries: `lifecycleBoundary({ item, execution })` in `execute-agent-work-item.ts` at lines 1141 (after the evaluation turn), 1351 (before the bootstrap navigation), 1530 (after the P-4 page read), 1581 (before a model turn), 1693 (after a model response) and 1746 (before a browser action) | The current Step Execution | `stepExecutionId` and `workItemId` | Yes, by reference. The payload names the Step Execution. In the same transaction, its `run_step_execution` row is written with `state = 'SUPERSEDED'` and `superseded_by = 'resume'`; the row holds `plan_step_id`, `attempt`, `work_item_id` and `action = 'inspect-record'`. The payload has no plan step key. `run_step_execution` has no immutability trigger |
| Work Item stage, between Work Items: `lifecycleBoundary()` with no pair, line 1236 | Nothing | Neither key | No. `run_agent_work.work_item_id` is a mutable pointer that the next claim overwrites |
| Work Item stage, deferred "pause after inspection" (Auditor Workspace v1.1): `deferredBoundary`, line 792, called at line 1241 | Nothing; the named Work Item has settled | `workItemId`, `subjectKey`, `registrationId`, `pauseMode: 'after-inspection'` | The settled Work Item is named, also on the retained `run_deferred_pause` row; its plan step is on `run_work_item.step_id`. No Step Execution and no attempt is named. The unit that runs next is not named |
| Agent Session Step (sign-in) stage: `canceledAtBoundary`, `execute-agent-steps.ts:790`, called at line 837 | Nothing | Neither key | No. `run_agent_execution` has no step column |
| Adapter stage: `canceledAtBoundary`, `execute-adapter-steps.ts:709`, called at lines 787 and 846 | Nothing | Neither key | No. `run_execution` has no step column |

At every boundary, the `run_wait` row (`wait_id`, `kind`, `options`, `opened_at`, `opened_by`,
`deadline` and the closure columns) names no Step. `lifecycle.run-pause-requested` carries
`state`, `requestedAt`, `performedBy` and, when present, `commandId`. It names no Step either.

What the resume record names:

- The wait closure (`closed_at`, `closure_kind = 'resume'`, `answer_option_id = 'resume'`,
  `actor`) names no Step. `lifecycle.run-resumed` (`pause-run.ts:457`–`477`) carries `waitId`,
  `pausedAt`, `closureKind`, `occurredAt` and, when present, `controlEpoch`, `commandId`,
  `planDigest`, `expectedRunRevision` and `deadline`. It names no Step, Step Execution, Work
  Item or attempt. The conversational Resume anchor (`run_interaction_command.resume_anchor`)
  holds only `waitId`, `pausedAt`, `deadline` and `controlEpoch`.
- A resume reaches the attempt it interrupted only through ids: `lifecycle.run-resumed.waitId`
  → the `lifecycle.run-paused` event with that `waitId` → its `stepExecutionId` → the
  `run_step_execution` row. This works only for a pause honoured at one of the six in-flight
  boundaries. Each pause opens a new wait, so the chain stays exact over repeated pauses and
  after the Run advances.
- The new attempt that a resume starts is linked by no id. `superseded_by` holds the closed word
  `'resume'`, not a pointer. The new `run_step_execution` row and its `lifecycle.agent-work`
  event (diagnostic `work-item-attempt-started`) carry no wait or resume reference.
- The `attempt` number does not identify an attempt across a pause. The pause gives the attempt
  back (`lifecycleBoundary` decrements `item.attempts`), and the next start increments it, so the
  replacement carries the same `attempt` value as the attempt it replaces. The unit test "holds a
  P-4 page model read at its response boundary, then resumes with a fresh attempt" ends with
  Step Execution states `['SUPERSEDED', 'SUCCEEDED']` and `attempts: 1`. Two test fixtures model
  the replacement as attempt 2, which the code does not write (`pause-resume.spec.ts:224`;
  `live-view.test.ts`, "Superseded by a pause, then restarted as attempt 2").
- Only the order of the Run's chain, or timestamps, can tie a resume to the attempt it started,
  or give a Step to a pause at any other boundary. That is inference.
- The Step that Live View shows is the Run's current Step (`readLatestStepExecution`;
  `logical-step-progress.test.ts`, "reads the step a long Run is on now, beyond the first page,
  and one step by id (UI cleanup 2026-09-23)"). It moves as the Run advances.
- The key `stepExecutionId` on a paused event is asserted only in the unit test "opens the
  wait, clears the marker and records who paused it", with the key supplied as input. No test
  reads it back from a real paused event. No test pauses and resumes the same Run twice.
- A precedent exists for a step-bearing wait event: `execution.escalation-raised` carries
  `stepId`, and the worker uses it to bind an answer to its Step
  (`packages/infrastructure/src/runs/agent-work-repository.ts`).

So: for a pause honoured at an in-flight Work Item boundary, the stored records identify the
interrupted Step and the exact attempt by id, but not the attempt the resume started. For a
pause at any other boundary, they identify no Step for the pause or for its resume; the
deferred pause names only the Work Item that finished before it. The stored records do not
meet the owner's rule.

**Acceptance criteria and the evidence for each**

1. *An Auditor presses Pause on a Running Run in Live View. The pause takes effect at the next
   Tool Action boundary. The Run persists as `PAUSED` with a checkpoint, an open wait record
   `{kind, options, deadline}` and a workspace lease. The pause records actor, time and Step
   (FR25, AD-16).*
   - **Covered: the next boundary.** `execute-agent-work-item.test.ts`: "holds BEFORE a Work
     Item starts, with no attempt to supersede", "holds MID-ITEM: supersedes the attempt in
     flight and gives the attempt back", "holds a P-4 page model read at its response boundary,
     then resumes with a fresh attempt" and "holds AFTER the evaluation turn, supersedes that
     attempt, and asks for no redelivery". `execute-agent-steps.test.ts`: "holds it at the phase
     boundary, opens ONE pause wait and clears the marker" and "lets a CANCELLATION win: ending
     is stronger than holding". Compiled worker: `prodconsole-agent-journey.spec.ts:321` (the
     worker honours the marker at its response boundary and writes `lifecycle.run-paused` from
     `worker`); `workspace-preview-worker.spec.ts:168`. Pause pressed in Live View:
     `live-escalation.spec.ts:211` and `pause-resume.spec.ts:224`. Limitations (1) and (2).
   - **Covered: `PAUSED`, the checkpoint and the wait.** `pause-run.test.ts` (integration):
     "opens ONE wait at the pause window, clears the marker and enqueues one wake" (kind `pause`,
     `opened_by`, a 30-minute deadline, one wake job) and "cannot open a second wait while one is
     open". `pause-run.test.ts` (unit): "names the auditor who asked for it and carries the one
     Resume option" and "is thirty minutes from when the pause TOOK EFFECT, not from the
     request". The stage checkpoint goes to `RETRY` in the unit tests above.
   - **Covered, with limitation (5): the workspace lease.** Code read at `c18ad36` (`runIsOver`,
     the reaper's terminal-state predicate). `provision-workspace.test.ts`: "keeps the workspace
     while the Run can still act". `agent-workspace.test.ts`: "reaps a workspace whose Run has
     ended and leaves one whose Run can still act".
   - **Covered: actor and time.** `run_wait.opened_by` and `opened_at`; `lifecycle.run-paused`
     has the requester as its actor and carries `requestedAt` and `occurredAt`. Unit: "opens the
     wait, clears the marker and records who paused it". `pause-resume.spec.ts:130` reads
     `opened_by`, `opened_at` and `deadline` back from PostgreSQL.
   - **Not met: "the pause records … Step" at every boundary.** The Step Execution is named
     only at the six in-flight Work Item boundaries. It is not named at the between-Work-Item,
     sign-in and adapter boundaries, nor by the deferred pause (see the block above).
2. *Chrome shows PAUSED with the last frame held, and a countdown banner names who paused the
   Run and when it ends Inconclusive (UX-DR25).* **Covered, with limitation (10).**
   - `pause-resume.spec.ts:130`: "Session PAUSED.", "Paused by {name} at" and "Resumes on your
     action; ends Inconclusive at"; the user id is absent; Resume replaces Pause; axe on Run
     Detail and Live View. Also `live-escalation.spec.ts:211`.
   - `PauseBanners.test.ts`: "names the PERSON who paused the Run, never their user id", "shows
     a countdown, not only two absolute timestamps" and "says a PAUSED Run whose wait cannot be
     read is paused, rather than rendering nothing". `copy.test.ts`: "states the contract
     sentence verbatim once its placeholders are filled" (EXPERIENCE.md line 151 at `c18ad36`).
   - `live-view.test.ts`: "maps every Run state the domain has, and gives a Queued Run no session
     word" (`PAUSED` → `PAUSED`). `live-view.spec.ts:469` shows the word on a paused Run.
3. *A pause requested when no further Tool Action boundary occurs is recorded as superseded on
   the Timeline, and the Run proceeds to its terminal state (AD-16).* **Covered, with limitation
   (8).** `pause-run.test.ts` (integration): "is recorded as superseded when the Run ends, and the
   outcome stands" and "is NOT recorded when the pause really was honoured". `complete-run.test.ts`:
   "carries the server command id onto the exact pause-superseded event" and "leaves the command
   id absent for a legacy pause marker". Code: `complete-run.ts:450`–`480`.
4. *A Run Awaiting Auditor: Pause is disabled with "A Run waiting on an answer cannot be
   paused." (AD-16).* **Covered.** `pause-resume.spec.ts:292` (`aria-disabled`, the visible
   sentence, a forced click writes no marker, axe); `live-escalation.spec.ts:211`. Unit: "refuses
   an Awaiting Auditor Run with the contract's own sentence". Integration: "refuses an Awaiting
   Auditor Run and writes nothing". `copy.test.ts`: "keeps the contract's pause, note and timeout
   wording verbatim" pins the sentence against EXPERIENCE.md (line 152 at `c18ad36`).
5. *A Paused Run with no resume for 30 minutes: the wait's durable job wakes on
   `startAfter = deadline`, the Run ends `INCONCLUSIVE` with Evidence preserved, and the reason
   is recorded (FR25, AD-16).* **Covered, with limitation (9).**
   - `pause-run.test.ts` (integration): "opens ONE wait at the pause window, clears the marker and
     enqueues one wake" (`start_after` equals the deadline); "is found by the recovery read and
     ends the Run Inconclusive with a Result" (`execution.pause-timeout` by `pause-wake`,
     `priorState: 'PAUSED'`, Result `run_state` `INCONCLUSIVE`); "is thirty minutes and not the
     Escalation window, on the durable row".
   - `run-waits.test.ts`: "times out an open wait into Inconclusive, seals the Result, and skips
     a replayed wake" (the same `wakeEscalation`; the package is `SEALED`).
   - The reason: `run-surfaces.test.ts`, "reads why a stopped Run stopped from the checkpoint that
     ended it, and the Gate tally beside it" (`stage: 'wait'`, `pause-timeout`); `stop-reason.test.ts`,
     "says a pause nobody resumed, or a question nobody answered, ran out its deadline". Unit:
     "refuses a resume whose deadline has passed by saying THAT, and nothing the wake has not
     written".
6. *An Auditor presses Resume. The closure command locks the wait row under the expected Run
   revision. The worker reattaches to the leased workspace via `attach(WorkspaceRef)`. It restarts
   the current Step Execution from its first Tool Action as a new attempt marked
   `superseded_by_resume`, while the earlier attempt's Tool Actions remain on the Timeline. The
   model is re-briefed from the frozen plan and the Work Item with no carried conversation state
   (AD-16).* **Covered, with limitations (3) and (4).**
   - The closure: `pause-run.test.ts` (integration), "closes the wait by RESUME under the expected
     revision and returns the Run to RUNNING", "refuses a revision the person did not read,
     leaving the pause open" and "refuses an open Escalation, and AnswerEscalation refuses an open
     pause". `run-controller-lease.spec.ts:858`, "serializes Resume across contexts, fences stale
     requests, and leaves eligible controls lease-free", and `:606`, "recovers the same
     conversational Resume after the response is lost". At `c18ad36`, Resume also requires the
     current controller lease (Auditor Workspace v1.1; `CLAUDE.md:4233`, `:4301`).
   - The reattach: code read at `c18ad36`. Resume enqueues nothing. The recovery sweep re-claims
     the `RUNNING` Run and calls `provision(job)` first (`apps/worker/src/main.ts:404`), which calls
     `deps.browser.attach(ref)` for a recorded identity (`provision-workspace.ts:486`).
     `agent-workspace.test.ts`: "reattaches by the stored identity rather than creating a second
     workspace". `provision-workspace.test.ts`: "reattaches to the workspace it left rather than
     making a second one". `workspace-preview-worker.spec.ts:168` resumes a real paused Run.
   - The new attempt: `execute-agent-work-item.test.ts`, "holds MID-ITEM: supersedes the attempt
     in flight and gives the attempt back" (the Tool Actions stay; the attempt is given back to the
     Work Item's retry budget, and the Run-level Step Execution limit still counts it, per
     `CLAUDE.md:2021`). `prodconsole-agent-journey.spec.ts:321`:
     exactly one read turn on the `SUPERSEDED` Step Execution and one on the `SUCCEEDED` one; the
     Resume dialog says "Interrupted work restarts as a new attempt". Integration: "pairs a
     SUPERSEDED Step Execution with its reason, in both directions". Code read: `ExecutionTimeline`
     (`apps/web/src/runs/Timeline.tsx`) renders every Step Execution, "Superseded" included, with
     its Tool Actions nested.
   - The re-brief: code read. `AgentModelRequest` (`agent-ports.ts:85`) has no conversation field,
     and each new attempt starts from a new bootstrap navigation. `prodconsole-agent-journey.spec.ts:321`
     rebuilds the tool catalogue from the frozen plan and the stored capture and matches the
     successful read turn to it.
7. *Resume records actor, time and Step, and Live View chrome returns to LIVE (FR25, UX-DR25).*
   - **Covered: actor and time.** `run_wait.actor` and `closed_at`; `lifecycle.run-resumed` has
     the person as its actor and carries `occurredAt` and `pausedAt`. `pause-resume.spec.ts:130`
     reads `closure_kind = 'resume'` and `actor` back, with the event order. Unit: "closes the
     pause by RESUME and puts the Run back to RUNNING".
   - **Covered: back to LIVE.** `pause-resume.spec.ts:130` and `live-escalation.spec.ts:211` read
     the settled Running page after Resume (Pause offered again, no Paused banner, state
     `RUNNING`). `live-view.test.ts` maps `RUNNING` to `LIVE`. The word "LIVE" itself is not
     asserted again after Resume in a browser.
   - **Not met: Step.** The resume event, the wait closure and the conversational Resume anchor
     name no Step, Step Execution or attempt (see the block above).
8. *The leased workspace is gone at resume: the worker re-runs the sign-in Session Steps for the
   current Target System under the Session Step retry budget and records the reattach on the
   Timeline; exhaustion is `RUN_FAILED` (AD-16).* **Covered, with limitation (5).**
   - `agent-workspace.test.ts`: "releases the stale identity and makes one replacement when the
     worker has restarted" (`lifecycle.agent-workspace` with `workspace-reattach-failed`, which the
     Timeline's workspace row states in words) and "fails the Run when provisioning is exhausted,
     and seals a Result for it".
   - `provision-workspace.test.ts`: "releases the stale identity before replacing a workspace it
     cannot reattach to", "treats a session past the provider deadline as gone, not as an outage"
     and "retries an outage under the Session Step budget and fails the Run when it is spent".
   - `execute-agent-steps.test.ts`: "forces a fresh positive sign-in after a workspace replacement
     while preserving history", "does not trust SIGNED_IN when forced reauthentication is refused"
     (`RUN_FAILED`) and "fails the Run once the Session Step budget is spent".
   - Code read at `c18ad36`: `recover` passes `workspaceReplaced` to `executeAgentSteps` as
     `forceReauthentication` (`apps/worker/src/main.ts:404`–`407`; `CLAUDE.md:3675`).

**Verdict: Residual work — PROPOSED, awaiting owner.**

- Residual scope (a): the Step on the pause and resume records (AC1 and AC7; limitation (7)).
  The facts above do not meet the owner's rule. The stored records identify the exact interrupted
  attempt only for a pause at one of the six in-flight Work Item boundaries. They link a resume to
  the attempt it starts only by chain order. They name no Step for a pause at the adapter, sign-in
  or between-Work-Item boundaries. Under the rule, the follow-up adds linkage for new events only:
  `lifecycle.run-paused` names the plan step at every boundary, with the Step Execution when one is
  in flight and a defined meaning for a pause between units; `lifecycle.run-resumed`, or the first
  attempt after it, names the interrupted Step Execution and the new attempt. Historical events stay
  as written, and a reader shows their absence as "not recorded". Proposed owner: the product owner
  decides under the stated rule; the work is a bounded compiler-1 follow-up story that the owner
  would add under Epic 10. No current story carries it.
- Residual scope (b): the resume semantics (limitation (3)). The owner confirms that a resume
  restarts the current Step Execution from its first Tool Action (epics.md, AD-16 and the code),
  not "continues from the next Tool Action" (EXPERIENCE.md line 295 at `c18ad36`). The
  implementation report recommends keeping the restart. If it is confirmed, EXPERIENCE.md is
  corrected in a planning change. Proposed owner: the product owner.

If the owner confirms (b), and (a) is delivered or accepted as a transfer to the named follow-up,
the story closes as Done.

**Owner disposition (2026-09-25), residual (a).** Accept the stored records only if they identify
the exact Step and attempt of each pause and each resume. They do not (above), so the follow-up
adds the linkage for new events only and never rewrites a historical event. Applied: Story 10-6
carries it, and a historical record without the linkage says that its Step was not recorded.
Residual (b), the resume semantics, has no owner decision yet; it is open point 7 in §6. 5.4 stays
`review` until 10-6 delivers the linkage and (b) is confirmed.

### Story 5.5 — Cancel a Run and flag it to Audit Managers from Live View

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]: `tests/e2e/flag-run.spec.ts` 6 of 6, `tests/integration/flag-run.test.ts` 17 of 17, `tests/integration/cancel-run.test.ts` 8 of 8. `82a7622` [CI-E5 34605206181], the PR #29 head that delivered 5.4–5.8. `8c1fc69` [CI-E5 34994575889], the PR #36 head, which repaired the inbox bound (F7) and gated the flag note (F8). No live or deployed Run was cancelled or flagged from Live View |
| Evidence relied on | `docs/contracts/run-flag-v1.md`; `review-epic-5-stories.md` (F7, F8, N1 and the Flag placement item); the PR #36 description ("three owner decisions"); `epic-5-story-status.md` (5.5 row [LOCAL]: 3 mutations killed); `epic-5-implementation-report.md` §1 and §4; `ui-cleanup-2026-09-22/p5-report.md` (UX-48, UX-49). Tests in [CI-c18]: `tests/e2e/flag-run.spec.ts` (6); `tests/integration/flag-run.test.ts` (17); `tests/integration/cancel-run.test.ts` (8); `tests/integration/pause-run.test.ts` (22); `packages/application/src/runs/flag-run.test.ts` (27); `cancel-run.test.ts` (8); `execute-agent-steps.test.ts` (50); `execute-adapter-steps.test.ts`; `tests/unit/gate-vocabulary.test.ts` (9); `apps/web/src/runs/RunFlagControl.test.ts` (13); `tests/e2e/runs.spec.ts:391`; `live-view.spec.ts:381`, `:434` and `:469`; `escalations.spec.ts:406`; `prodconsole-agent-journey.spec.ts:705`; `workspace-preview-worker.spec.ts:168` (preview job). `CLAUDE.md:1439`, `:2066`, `:3140`, `:3193`, `:3200`, `:3204`, `:3205` |
| Runtime and environment | [CI-c18] only: hosted Linux, Node 24.20.0, PostgreSQL 18.6, local Chromium with axe. `flag-run.spec.ts` seeds Running and Queued Runs with held checkpoints and runs no worker. The worker's move to `CANCELED` is proven by compiled-worker journeys with a synthetic model provider. No database-backed flag test seeds an Audit Manager. No mail transport exists in any environment |
| Unresolved limitations (already named) | (1) N1: after a lost acknowledgement, the route boundary says "Couldn't load this page. Nothing was changed." over a flag that committed and notified. `apps/web/app/error.tsx:37` still renders it at `c18ad36`. `flag-run.spec.ts:184` asserts the boundary's heading and exactly one `run_flag` row and one notification. This is product wording, named and not fixed (`review-epic-5-stories.md` N1; `CLAUDE.md:1439`). (2) Placement. At `c18ad36` Pause/Resume, Cancel and Flag are the three actions of Live View's one `PageHeader`, inside `LiveGate` (UX-48; code read, `page.tsx:178`–`:222`). That row is outside the session viewer's navy chrome strip (`.ls-session`). No test asserts the order or the adjacency of the three controls. At the deployed `44fb596`, Flag sat after the viewer, with Pause/Resume and Cancel above it (code read of that revision; the Flag placement item in `review-epic-5-stories.md`). The owner has to confirm that the header row meets UX-DR24. (3) No database-backed test flags a Run with an Audit Manager seeded. `tests/integration/flag-run.test.ts` says "The initiator is the only recipient here: this file adds no Audit Manager", and `flag-run.spec.ts:113` expects one notification (named in `review-epic-5-stories.md`). (4) A flag's email outcome is `unconfigured`, as for Story 4.8 (limitation (1) there). (5) The Live View Cancel journey covers a Running Run, where the command only records the request. Cancelling a Queued, Paused or Awaiting Auditor Run is proven at the command, from Run Detail, or by a direct `cancelRun` call, not by pressing Cancel on Live View in those states. The worker's move to `CANCELED` is proven after a Stop from the Workspace conversation, which calls the same `cancelRun` (code read: `run-conversation-repository.ts:953`; Live View reaches it through `apps/web/app/runs/actions.ts:83`). (6) When the Run ends, `LiveGate` remounts its subtree, so a typed flag note is lost (named in `review-epic-5-stories.md`) |

**Acceptance criteria and the evidence for each**

1. *For any active Run (Queued, Running, Paused, Awaiting Auditor), Cancel in Live View opens a
   routine confirmation that restates the consequence. `cancel_requested` is written. The worker
   moves the Run to `CANCELED` at the next Tool Action boundary, with Evidence preserved. `CANCELED`
   is reserved for this explicit human cancellation.* **Covered, with limitation (5).**
   - Live View: `flag-run.spec.ts:270` "cancels a Running Run from Live View, through the same
     control Run Detail carries". The routine dialog says "Evidence already collected is
     preserved", `cancel_requested_by` is set, and the Run stays `RUNNING`. Code read at
     `c18ad36`: the page renders `RunCancelControl` for every active state (`isActiveRunState`).
   - Command: `cancel-run.test.ts` (application) "cancels from every active state and refuses
     every terminal one, on the domain table". Integration: "cancels a queued Run and removes its
     dispatch job in one transaction" and "records a request for a Run a worker owns and performs
     no transition". `pause-run.test.ts` "closes a paused Run’s wait when the Run is cancelled, and
     says so in the chain". `live-view.spec.ts:469` cancels a PAUSED Run through the command, and
     Live View flips to REPLAY with "This Run has ended: CANCELED.". By design,
     `RUN_CANCEL_TRANSITIONS` gives a Queued, Paused or Awaiting Auditor Run to the command, not to
     the worker (`CLAUDE.md:3193`).
   - Worker boundary: code read at `c18ad36`, `lifecycleBoundary` checks the cancellation first at
     each Tool Action boundary (`execute-agent-work-item.ts:706`). `execute-agent-steps.test.ts`
     "honours the cancellation at the phase boundary, before anything is claimed" and "lets a
     CANCELLATION win: ending is stronger than holding". `execute-adapter-steps.test.ts` "honours a
     cancellation at the claim, before any Target System work". Compiled worker:
     `prodconsole-agent-journey.spec.ts:705` "recovers accepted conversational Stop after worker
     process loss and preserves captured evidence" (`lifecycle.run-canceled` from source `worker`,
     the screenshot still `REGISTERED`, the package sealed, the Result `CANCELED`), and
     `workspace-preview-worker.spec.ts:168` (preview job). Evidence already frozen survives
     (`CLAUDE.md:3204`, `:3205`).
   - Reserved: `gate-vocabulary.test.ts` "never produces CANCELED, from any cause";
     `execute-adapter-steps.test.ts` "never produces CANCELED from a limit: the same Run without a
     request is Inconclusive" (`CLAUDE.md:3140`).
2. *For a Canceled Run, starting a new Run creates one linked to it without changing the prior
   Run.* **Covered.** `runs.spec.ts:391` "cancels a queued Run from Run Detail, and reruns the
   terminal Run it leaves". `cancel-run.test.ts` (integration) "reruns a terminal Run into a new
   linked Run and leaves the predecessor unchanged" (`CLAUDE.md:3200`). Rerun is on Run Detail,
   because a terminal Run's Live View shows REPLAY (the `RunCancelControl.tsx` header comment).
3. *On a Running, Paused or Awaiting Auditor Run, Flag to Audit Manager takes an optional note,
   notifies every Audit Manager, has no effect on execution, and is recorded on the Audit Trail.*
   **Covered, with limitations (3) and (4).**
   - Browser: `flag-run.spec.ts:113` "flags a Running Run with a note, notifies, and changes nothing
     about the Run" (the whole `audit_run` row is unchanged, revision included; axe clean); `:156`
     "submits the flag with JavaScript disabled"; `:223` "offers no flag form on a Queued Run, and
     says so rather than showing nothing"; `:233` "shows a flagged Run in the inbox with no
     countdown, and drops it when the Run ends".
   - Integration: "stores one flag, its notifications and its event in one transaction"
     (`lifecycle.run-flagged` carries the note's length and digest only); "changes nothing about the
     Run"; "flags a %s Run" for RUNNING, PAUSED and AWAITING_AUDITOR; "refuses a QUEUED Run and
     writes nothing at all"; "refuses a blank note and an over-long one, while allowing an absent
     one"; "delivers a flag on both channels and records each on the Audit Trail".
   - Recipients: `flag-run.test.ts` (application) "records one flag, notifies the initiator and
     every Audit Manager, and chains the note by digest", "deduplicates an Audit Manager who
     initiated the Run" and "has no way to change the Run: the context carries no state writer".
     Code read at `c18ad36`: the flag path reads the managers through
     `DrizzleNotificationRecipientReader.auditManagerIds()` (`runs-unit-of-work.ts:104`), the same
     reader the Escalation path uses. `escalations.spec.ts:406` proves that reader with real Audit
     Managers.
4. *Flag to Audit Manager sits in the session viewer's live controls, beside Pause/Resume and
   Cancel.* **Covered at `c18ad36`, with limitation (2).** Code read: `RunPauseControls`,
   `RunCancelControl` and `RunFlagControl` are one row of actions in Live View's header, inside the
   live gate. `live-view.spec.ts:381` (the flag form is one closed opener in that row) and
   `live-view.spec.ts:434` (the three are withdrawn and restored together).

**Verdict: Done — `[COMPILER-1 PATH]`.** Limitations (1) and (2) are owner decisions that do not
change the verdict (§6, point 9).

### Story 5.6 — Answer an Escalation without leaving Live View

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]: `live-escalation.spec.ts:211` passed (11.3 s); `escalations.spec.ts` 3 of 3; `pause-resume.spec.ts` 3 of 3. `82a7622` [CI-E5 34605206181], the PR #29 head that delivered 5.4–5.8. `8c1fc69` [CI-E5 34994575889], the PR #36 head (F9: the note field became `readOnly` with `aria-disabled`). No live or deployed run answers an Escalation on Live View: the [DEP] positive Run raised none |
| Evidence relied on | `docs/contracts/live-view-v1.md` ("The Escalation, answered in place"); `review-epic-5-stories.md` (F9, and the `LiveGate` remount); `epic-5-story-status.md` (5.6 row [LOCAL]); `epic-5-implementation-report.md` §3.1. Tests in [CI-c18]: `tests/e2e/live-escalation.spec.ts` (1); `escalations.spec.ts` (3); `pause-resume.spec.ts` (3); `agent-credential-containment.spec.ts:375`; `live-view.spec.ts:469`; `apps/web/src/runs/EscalationPanel.test.ts` (16); `OpenEscalationSection.test.ts` (3); `EscalationOutcome.test.ts` (4); `PauseBanners.test.ts` (7); `apps/web/src/design/copy.test.ts` (51); `packages/application/src/runs/waits.test.ts` (9); `tests/integration/pause-run.test.ts` (22); `run-waits.test.ts` (8). `CLAUDE.md:58`, `:143`, `:217`, `:1390`, `:1753` |
| Runtime and environment | [CI-c18]: hosted Linux, Node 24.20.0, PostgreSQL 18.6, local Chromium with axe. The Flow 3 journey runs no worker. `claimAsWorker` seeds the checkpoints of a held Run, the test calls the real `raiseEscalation`, and the pause boundary calls `performPause`, the function the stages call. Auditor Workspace v1.1 requires Acquire control before Resume; the journey uses `acquireControl` and `resumeWithControl` |
| Unresolved limitations (already named) | (1) No worker runs in Flow 3 (above). The worker's pause boundary is proven below the browser (`epic-5-story-status.md`, the note on 5.4). (2) The Flow 3 fixture seeds no `run_workspace` row and no frame. The session viewer that stays visible shows its stage sentence, not a screen. No test shows a frame and the panel together on Live View. (3) The one-minute rung is proven by unit test only; the browser asserts the `open` and `ten-minutes` rungs (`CLAUDE.md:1390`). (4) Code read at `c18ad36`: the skip link is `<a href="#open-escalation">` (`EscalationPanel.tsx:442`), and its target `<section id="open-escalation">` (`:443`) has no `tabIndex`. The shell's own skip-link target has `tabIndex={-1}`, with the comment that without it "the skip link moves the scroll position and leaves focus on the link" (`apps/web/src/shell/AppShell.tsx:98`–`:100`). No test activates the Escalation skip link. (5) No test aborts from the panel on Live View. Abort is proven on Run Detail through the same panel, and Live View's flip to REPLAY is proven on a command cancellation. (6) The answered Escalation is an `execution.escalation-answered` event on the Run's chain. The Execution Timeline tab has no Escalation row at `c18ad36` (code read: `RunTimelineRead` and `Timeline.tsx` read and render no waits), although `EXPERIENCE.md:94` (the 2026-09-01 UX handoff) says Escalations "stay expanded inline" there. Replay lists the Escalation as a jump target. The register reads the chain event as "a Timeline entry", as for Story 4.8, AC 4. (7) The countdown is the panel's `role="timer"` clock above the viewer. The chrome strip carries the word AWAITING and no clock |

**Acceptance criteria and the evidence for each**

1. *When a Run enters Awaiting Auditor while Live View is open, the chrome flips from LIVE to
   AWAITING with a countdown. The Escalation panel renders in place with the kind, the Step, the
   agent-generated question rendered inert and labelled as such, the supporting Evidence (for
   choose candidate, the captured result rows with grounded keys), the closed answers in FR-27
   order with no recommendation, and the optional note "Recorded, not sent to the agent". The
   workspace screen stays visible.* **Covered, with limitations (2) and (7).**
   - `live-escalation.spec.ts:211`: after `raiseEscalation`, with no reload, "Open Escalation"
     appears and "Session AWAITING." replaces "Session LIVE.". The kind reads "Choose candidate".
     The "AGENT-GENERATED question" shows `<script>` as text, and the panel holds no `script` or `b`
     element. The answers are exactly "Select candidate 1", "Select candidate 2" and "Mark record
     ambiguous", with "The platform expresses no recommendation.". The note label is present. The
     session viewer is visible, no dialog is open, and the panel comes before the viewer in the
     document. The clock is one `role="timer"` element. axe is clean.
   - Step and supporting Evidence, on the same component: `escalations.spec.ts:406` "delivers to
     Auditor and Managers, opens grounded metadata, confirms once, and contains the note" (Step
     `agent-step-1`, the supporting Evidence link, the candidates "Alice A" and "Bob B", and the note
     kept out of the agent's turns). `EscalationPanel.test.ts` "renders real metadata while keeping
     model text inert and fixed labels platform-owned", "keeps answer buttons in the persisted FR-27
     order and states that there is no recommendation" and "normalizes fixed answer order and
     leaves the candidate order grounded in the wait". Code read at `c18ad36`: a choose-candidate
     option's label is the captured row's secondary key or identity value (`agent-tool-planner.ts`
     `candidateLabel`), and the captured snapshot is its supporting Evidence
     (`execute-agent-work-item.ts:1653`–`:1656`).
   - One mount on both surfaces: `OpenEscalationSection.test.ts` "renders the panel when the wait
     and its revision read" and "says the wait could not be read rather than rendering nothing".
2. *When the panel is present, a skip link "Go to open Escalation" moves focus to the panel. The
   panel's appearance, and the 10-minute and 1-minute countdown milestones, are announced through
   `aria-live="polite"`.*
   - **Covered: the link and the announcements.** `copy.test.ts` "names the skip link the
     Accessibility rules name (Story 5.6)". `EscalationPanel.test.ts` "reaches the panel by the
     skip link the contract names". `live-escalation.spec.ts:211`: the link is in the page; the
     polite region reads the `open` rung, and then the `ten-minutes` rung on a second Escalation
     opened nine minutes from its deadline; the clock carries no `aria-live`.
     `EscalationPanel.test.ts` "climbs one rung at a time and never goes back up" and "renders the
     polite region EMPTY on the server and the clock with no live region".
   - **No evidence found for "moves focus to the panel".** Limitation (4).
3. *When an answer or an abort is confirmed, the panel becomes a Timeline entry, and Live View
   returns to LIVE, or reflects Canceled on abort. Pause stays disabled with "A Run waiting on an
   answer cannot be paused." until the answer is confirmed.* **Covered, with limitations (5) and
   (6).**
   - `live-escalation.spec.ts:211`: while the Escalation is open, Pause is `aria-disabled` and the
     sentence is visible. After "Record answer", "Escalation answered." outlives the panel
     (`[data-escalation-outcome]`, `CLAUDE.md:217`), the panel is gone, "Session LIVE." returns, the
     wait is closed as `answer`, `execution.escalation-answered` is on the chain, and Pause is
     enabled again.
   - Abort: `waits.test.ts` "routes abort through the cancellation seam and records the fixed
     reason". `agent-credential-containment.spec.ts:375` aborts from the panel on Run Detail, and
     the real worker reaches `CANCELED`. `live-view.spec.ts:469` "flips to REPLAY and names the
     terminal state when the Run ends while it is open" ("This Run has ended: CANCELED.").
   - The command refuses too: `pause-run.test.ts` "refuses an Awaiting Auditor Run and writes
     nothing"; `pause-resume.spec.ts:292` "disables Pause on a Run waiting on an answer, and says
     why in words" (Run Detail; a forced click writes nothing).
4. *The acceptance suite drives Flow 3 in Playwright: Initiate Run, a choose-candidate Escalation
   answered in place, and a pause with a 30-minute countdown before resume.* **Covered, with
   limitation (1).** `live-escalation.spec.ts:211` "initiates a Run, answers its Escalation in
   place, then pauses and resumes it": Initiate Run from Procedure Detail; the Escalation answered
   in place; the pause dialog says the Run "ends Inconclusive if it is still paused after 30
   minutes"; the pause wait's deadline is exactly 30 minutes after it opened, measured on the row;
   the Paused banner says "Resumes on your action; ends Inconclusive at"; Acquire control, Resume,
   and Pause offered again; the exact event list. The visible countdown on the Paused banner is
   `PauseBanners.test.ts` "shows a countdown, not only two absolute timestamps".

**Verdict: Done — `[COMPILER-1 PATH]`, held (§3.1, item 3).** This is the verdict that the first
session proposed. The rebuild found no evidence that the skip link moves focus, and a code read
that suggests it does not (limitation (4)). Under §1's rules, a leg with no evidence gives at least
Remains in review, and Residual work — PROPOSED if the code read is taken as evidence. The verdict
is not reversed here: §3.1 states the contradiction and the two resolutions, and the owner decides.
§5 moves this story only after that decision. Limitation (6) reads the chain event as a Timeline
entry, as Story 4.8, AC 4 does (§6, point 3).

### Story 5.7 — Live View when the stream drops or the Run ends while open

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]: `live-drop.spec.ts` 5 of 5 and `live-view.spec.ts:469` passed. `82a7622` [CI-E5 34605206181]: PR #29, where Story 5.7 shipped with four `live-drop.spec.ts` cases, `success`. `8c1fc69` [CI-E5 34994575889]: PR #36, which added the fifth case (review finding F10) and the Safari 13 viewport fallback (F18), `success`. `1e7869c` [CI-E5 34417260412]: PR #25, where the flip to REPLAY shipped with Story 5.3, `success` |
| Evidence relied on | `epic-5-story-status.md` (5.7 row: 3,918 unit tests, 19 of them on `live-status`, 4 SSR renders of the gate, 4 `live-drop.spec.ts` cases) and `epic-5-implementation-report.md` [LOCAL]; `review-epic-5-stories.md` (F10, F12 and F18; the items named and not fixed: "`LiveGate` swaps `TerminalGate` for `SubscribedGate`…" and "`RUN_ENDING_EVENTS` is pinned against retyped literals…"; Verification: the F10 mutation killed); `docs/contracts/live-view-v1.md` ("The live controls, and the gate over them (Story 5.7)", "A reconnect resumes from the last frame the page SAW"); `epic-5-context.md` (the revised order); `spec-5-3-watch-a-running-run-in-live-view.md` (Acceptance 8). Browser in [CI-c18] (job 107725083111): `tests/e2e/live-drop.spec.ts:110`, `:153`, `:197`, `:250`, `:295`; `live-view.spec.ts:469`; `live-timeline.spec.ts:124`. Unit in [CI-c18] (job 107725082758): `apps/web/src/runs/live-status.test.ts` (23), `LiveGate.test.ts` (4), `live-view.test.ts` (17). Integration in [CI-c18] (job 107725083134): `tests/integration/run-timeline-channel.test.ts` (6). `CLAUDE.md:1025`, `:1081`, `:1601`, `:1643`, `:1656`, `:1806` |
| Runtime and environment | [CI-c18] and [CI-E5]: as in Story 5.1. `live-drop.spec.ts` seeds `RUNNING` or `PAUSED` Run rows with held population and execution checkpoints, so that no recovery sweep claims them, and it starts no worker. The drop is made by refusing every request to the events route from the first load (`page.route`). The terminal event comes from the real `cancelRun` command on a `PAUSED` Run, which the command itself ends. The two 60-second cases run on the real clock (1.0 minute each in [CI-c18]). [LOCAL]: as in §2; the review's browser runs used generation 49 |
| Unresolved limitations (already named) | (1) In a browser, the controls asserted under `lost` are Pause, Cancel Run and "Flag to Audit Manager", plus an open confirmation dialog; under `runEnded` they are Resume, Cancel Run and "Flag to Audit Manager". The Escalation answers, the Escalation and flag notes, and the controller controls ("Acquire control", "Release control", "Transfer control to me") read the same gate (code read at `c18ad36`: `EscalationPanel.tsx:168`, `RunControllerLease.tsx:28`). No test at `c18ad36` renders them under a closed gate; a search of the unit and browser tests found none. `review-epic-5-stories.md` says the same of the Escalation panel and the flag note: their withdrawal in a live browser "is not separately re-asserted here". No browser test lets a `lost` Live View recover. The return to `live` is shown on Run Detail, from `stale` (`live-timeline.spec.ts:124`); that the gate reopens for `live` is the unit-tested rule. (2) Code read at `c18ad36`: `useLiveTimeline` restarts the silence clock each time its effect runs (`useLiveTimeline.ts:72`), and the effect runs again whenever a server re-read gives the page a new cursor (`:113`). So a re-read that lands during a drop, after this Run's chain has moved on, makes the page say `live` for up to 15 seconds and reopens the gate for up to 60 seconds, although the stream has not resumed. `BellLive` can start such a re-read on another Run's event. `CLAUDE.md:1081` refers to "the 5.7 edge finding about reconnects resetting the clock"; no evidence file records its disposition. (3) Every browser case reaches the terminal state by cancelling a `PAUSED` Run. So PAUSED to REPLAY is proven in a browser. LIVE to REPLAY, AWAITING to REPLAY, and a latch set by `lifecycle.result-sealed` alone (Completed, Inconclusive, Run Failed) rest on the unit tests and the shared code path. `RUN_ENDING_EVENTS` is pinned against literals, not against the producers' constants (`review-epic-5-stories.md`, named, not fixed). (4) When the re-read makes the cursor `null`, `LiveGate` renders `TerminalGate` in place of `SubscribedGate` and remounts its children. A typed flag note and a lost-response recovery banner therefore vanish when the Run ends (`review-epic-5-stories.md`, named, not fixed; left out of PR #36 on purpose). The code is unchanged at `c18ad36` (`LiveGate.tsx:117-121`). (5) AC3 is proven in two halves (see AC3). No test drops a real stream mid-Run and checks the events that the reconnect replays. Code read at `c18ad36`: a re-read that moves the cursor also makes the hook close its stream and open a new one from the last sequence it saw (`useLiveTimeline.ts:63`, `:73`, `:113`). So the resume path also runs in normal operation, but no test inspects what that path delivers in a browser. (6) No deployed evidence exercises a drop or the flip to REPLAY. The deployed Run reached `COMPLETED` while the observer's Watch page was open, but no deployed check asserts the flip (job 105584051742). No deployed journey has run on `c18ad36` (§2). The v1.1 merge moved the controls into Live View's header, inside the gate; [CI-c18] proved the gate again there |

**Acceptance criteria and the evidence for each**

1. *With Live View open and no Timeline update for 15 seconds, the stale indicator appears (AD-17,
   NFR7). After 60 seconds without an update, a Banner "Connection to the Run lost. Reconnecting."
   appears, and every control stays disabled until the stream resumes (UX-DR25).* **Covered, with
   limitations (1) and (2).**
   - **The words.** `LIVE_SENTENCES.lost` is `'Connection to the Run lost. Reconnecting.'`
     (`apps/web/src/runs/live-status.ts:48`), the AC's own sentence. It is the visible body of the
     warning Banner that `LiveBannerView` renders (`LiveBanner.tsx:33-54`); the Banner's title
     keeps "Updated {time}.", and its "Refresh." link works without script. Screen readers hear
     the status word "Connection lost" from a polite region, because the sentence beside it is
     `aria-hidden` by design (`CLAUDE.md:2361`). The stale sentence is "No update for {seconds}
     seconds. The page may be behind the Run."
   - **The thresholds.** `LIVE_STALE_MS` is 15,000 and `LIVE_LOST_MS` is 60,000
     (`live-status.ts:14-15`). `live-status.test.ts`: "is live under 15 seconds of silence, stale
     from 15, lost from 60", and "has a sentence for every status, and the stale one names the
     seconds", which asserts that `liveSentence('lost', 90)` is the AC sentence. In a browser, the
     stale state is asserted on Run Detail (`live-timeline.spec.ts:124`), which renders the same
     `LiveBannerView` from the same hook as Live View.
   - **The gate.** `liveGateReason` closes on `lost` and on `ended` and stays open on `stale`
     (`live-status.ts:116-122`): "is OPEN while the page is connecting, live, or merely stale" and
     "closes on a lost stream and on an ended one". Every Live View control reads this one gate.
     Code read at `c18ad36`: `RunPauseControls`, `RunCancelControl`, `RunFlagControl` and
     `RunControllerLease` read it through `useLiveGate`; `EscalationPanel` and `ConfirmDialog` read
     it through `useActionGate`.
   - **In a browser.** `live-drop.spec.ts:110` "names the lost connection and withdraws every live
     control, with the reason". Pause is live before the threshold. After 60 seconds the status is
     `lost` and the sentence is visible. Pause, Cancel Run and "Flag to Audit Manager" carry
     `aria-disabled` with `LIVE_GATE_REASONS.lost`. A forced click on Cancel Run opens no dialog and
     leaves `state = RUNNING` and `cancel_requested_by` null. `live-drop.spec.ts:153` "dismisses a
     confirmation that was already open, and refuses its confirm in words": the open Cancel dialog
     goes away at `lost`, and nothing is committed (review finding F10; the mutation that deletes
     the dismissal effect was killed, `review-epic-5-stories.md`, Verification).
   - **Until the stream resumes.** The gate reopens when a frame arrives, because the status
     returns to `live`. `live-timeline.spec.ts:124` shows that return in a browser, from `stale`,
     on Run Detail.
2. *When a Run reaches a terminal state while Live View is open and the terminal Timeline event
   streams in, the chrome flips from LIVE, PAUSED or AWAITING to REPLAY, every live control
   disables, and a Banner names the terminal state with a link to Run Detail (UX-DR25).*
   **Covered, with limitations (3) and (4).**
   - **Code read at `c18ad36`.** The gate latches `runEnded` on the first `lifecycle.result-sealed`
     or `lifecycle.run-canceled` and asks for a server re-read (`LiveGate.tsx:160-168`;
     `RUN_ENDING_EVENTS`, `live-status.ts:65`). The re-read maps every terminal state to `REPLAY`
     (`live-view.ts:24-41`). It renders `TerminalGate` with `EndedBanner`, whose title is "This Run
     has ended: {state}." and whose body links "Open Run Detail" (`LiveViewer.tsx:377-387`).
   - **In a browser.** `live-view.spec.ts:469` "flips to REPLAY and names the terminal state when
     the Run ends while it is open": PAUSED to REPLAY after a real `cancelRun`, "This Run has ended:
     CANCELED.", the "Open Run Detail" link inside the Banner, and a window marker that proves no
     reload. `live-drop.spec.ts:250` "closes every live control on the terminal event, before the
     page has re-read": the re-read is held for 25 seconds, and Resume, Cancel Run and "Flag to
     Audit Manager" carry `aria-disabled` with `LIVE_GATE_REASONS.runEnded`. `live-drop.spec.ts:295`
     "replaces the live controls with the ended Banner once the page re-reads": no Resume, Cancel
     Run or flag submit remains, hidden ones included.
   - **Unit.** `live-view.test.ts` "gives every active state but Queued a live session word, and
     every terminal state REPLAY". `LiveGate.test.ts` "leaves a Run that has already ended with no
     live control to disable" (Inconclusive) and "shows the ended Banner instead of the live one,
     and opens no stream" (Completed, with "Open Run Detail"). `live-status.test.ts` "names the one
     event every terminal transition appends, and the cancellation beside it" and "is not fooled by
     an event that only sounds terminal".
3. *When the stream reconnects after a drop and the client resumes with its last-seen `seq`, every
   missed event is replayed in order, with no gap and no duplicate, before live rendering returns
   (AD-17).* **Covered, with limitation (5).** Which evidence covers which leg:
   - **No gap and no duplicate, on the client.** The rule is `acceptsLiveSeq(lastSeq, seq)`, that
     is `seq > lastSeq` (`live-status.ts:137-139`). `useLiveTimeline` applies it to every per-Run
     frame (`useLiveTimeline.ts:84-89`). The six cases of "a reconnect replays every missed event,
     in order, with no gap and no duplicate" in `live-status.test.ts` prove it deterministically: a
     first connection, an overlapping resume, a long gap, a resume that carries only frames already
     seen, an out-of-order frame, and a sequence that is not a safe integer.
   - **In order, from the cursor, before live, on the server.** `run-timeline-channel.test.ts`
     (integration) "replays the chain from the cursor, then delivers what the real commands append,
     in order and once": a stream resumed at cursor 2 sends exactly 3 and 4, and nothing twice. The
     cursor is the `Last-Event-ID` that `EventSource` sends on its own reconnect, before `?after=`:
     `route.test.ts` "prefers Last-Event-ID over the query on a reconnect".
   - **In a browser, only the wiring.** `live-drop.spec.ts:197` "re-subscribes with a cursor it
     could hold, and never one ahead of the chain". The page subscribes with a cursor, subscribes
     again after the stream ends, and never sends a cursor above the last frame it was given. Its
     frames carry synthetic sequences that the chain never held. CI failed the first form of this
     test twice. It was renamed to what it can prove, and the resume rule stays in
     `live-status.test.ts` (`CLAUDE.md:1643`, `:1656`).

**Verdict: Done — `[COMPILER-1 PATH]`.** Limitations (1) to (4) are items for the Epic 5
retrospective (§6, point 15).

### Story 5.8 — Replay any terminal Run from the platform-owned asset set

**Status on `main`:** review.

| Fact | Record |
|---|---|
| Tested revisions | `c18ad36` [CI-c18]. `82a7622` [CI-E5 34605206181], PR #29, which delivered 5.8. `8c1fc69` [CI-E5 34994575889], PR #36, the review repairs F13–F17 and F19. PR #47 [CI-E5 35328629164], the MIME repair of the shared frame delivery path. PR #48 [CI-E5 35335573874], the top-aligned shared `SessionStage`, 214 of 214 passed. `44fb596` [DEP]: the final acceptance records Replay after the workspace release: 15 of 15 frames load, decode, match their registered hashes and sizes and stay in order; playback advances; a historical Run's 15 frames also load. The visible acceptance 35340181283 passed 36 of 36 checks. The strict fresh-login and Replay reload 35342862535 passed 7 of 7: each selected frame had to match its retained Evidence id before decode, and the probe recorded zero console errors and zero page exceptions (issue #45, comments of 2026-09-18). Superseded: 35323749627 on `ef0515e` (the first Replay image did not load, because of the MIME defect in the shared delivery path that PR #47 repaired) and 35333706645 on `816d6b5` (Replay decoded all 15 frames; the visual review rejected the Watch framing only) |
| Evidence relied on | `docs/contracts/replay-v1.md`; `epic-5-story-status.md` (5.8 row [LOCAL]: 3,955 unit tests, 531 integration tests, 145 browser tests with axe, 7 of them in `replay.spec.ts`); `epic-5-implementation-report.md` §3; `review-epic-5-stories.md` (5.8 findings F13–F17 and F19; the unit mutations for the Replay plain-words fix and for F19 were killed; `replay.spec.ts` passed 7 of 7 at generation 49 [LOCAL]); `spec-aw-selected-replay.md` (status done); `loancore-acceptance-2026-09-17.md` (the jump list and the frame `alt` name the record); issue #45. Tests in [CI-c18]: `tests/e2e/replay.spec.ts` (6); `tests/e2e/selected-replay.spec.ts` (2); `tests/integration/selected-replay.test.ts` (5); unit `apps/web/src/runs/ReplayViewer.test.ts` (19), `replay.test.ts` (22), `selected-replay.test.ts` (17), `live-view.test.ts` (17), `apps/web/app/runs/[id]/replay/page.selected-replay.test.ts` (10) and `apps/web/app/api/runs/[id]/frames/[evidenceId]/route.test.ts` (18); `tests/integration/evidence-read-grant.test.ts` (14); `tests/unit/boundaries.test.ts` ("fires 'no-browser-execution-in-web' when 'apps/web/src' imports …"); `pnpm boundaries` clean over 801 modules. `CLAUDE.md:40`, `:282`, `:1037`, `:1062`, `:1691`, `:4105`, `:4262` |
| Runtime and environment | [CI-c18]: hosted Linux, Node 24.20.0, PostgreSQL 18.6, local headless Chromium with axe (WCAG 2.1 AA, no allowlist). Each Replay spec spawns the compiled worker to sign frame grants, with no provider or model keys (`SOLARI_API_KEY` empty), and uses a synthetic S3. The network block is Playwright request interception in the browser. [DEP]: production at `44fb596`, Solari mode with provider recording off, OpenAI `gpt-5.6`; the observer is headless Chromium at 1440×1000; the visual review was AI-assisted. [LOCAL]: a developer host (`epic-5-story-status.md`) and the reviewer's machine at generation 49 with Node 24.20.0 (`review-epic-5-stories.md`) |
| Unresolved limitations (already named) | (1) The network block is in the browser only. Server and worker network calls are not measured (`replay-v1.md` lines 158–160; `CLAUDE.md:282`). "No provider call" on the server rests on the code: there is no provider client, workspace port or outbound fetch on the Replay path, and the `no-browser-execution-in-web` boundary rule holds. In CI the worker had no provider key, so a provider call could not succeed anyway. (2) The default view shows the first 500 frames (`REPLAY_FRAME_LIMIT`) and says so when it binds; a later capture opens through an inspection page (`spec-aw-selected-replay.md`). On the default view, `readWaits` and `readObservationDeltas` stop at 500 rows with no total and no "bound" sentence (`review-epic-5-stories.md`, "Wider than a repair"). Code read at `c18ad36`: this is unchanged, and the page also uses only the first 500 Exceptions (`exceptions.rows`). So on the default view the Observation count beside a frame can be too low after 500 registration events; the inspection page counts the full history in SQL (`CLAUDE.md:282`). (3) The arrow, Home and End keys ignore modifier keys, so Alt+ArrowLeft on the focused viewer steps a frame and cancels the browser's Back shortcut (`review-epic-5-stories.md`, tidy-up list; code read at `c18ad36`: `onKeyDown` in `ReplayViewer.tsx` checks no modifier). The same review item's "dead Space guard" no longer applies: the UI cleanup (UX-29) moved the scrubber inside the keyed viewer, and `replay.spec.ts` proves that Space on a pill does not toggle playback. (4) Replay shows every Audit Instruction that the version froze, each under its Target System's name. It does not narrow them to the system of the frame shown (code read at `c18ad36`: `apps/web/app/runs/[id]/replay/page.tsx`, `ReplayViewer.tsx:386`). (5) No deployed journey has run on `c18ad36`. Auditor Workspace v1.1 added `?workItem=` inspection pages and record links (`spec-aw-selected-replay.md`; `CLAUDE.md:4262`), and the 2026-09-23 repair keys the viewer by the Run and the request (`replayViewerKey`, `CLAUDE.md:40`). Only [CI-c18] covers these |

**Acceptance criteria and the evidence for each**

1. *For any terminal Run, an authorized user opens Replay: the chrome shows REPLAY, playback starts
   paused at the first frame, a jump list lets them jump to any Work Item, Exception or
   Escalation, and the Audit Instructions for the relevant agent-driven Target System are shown
   verbatim.* **Covered, with limitation (4).**
   - `replay.spec.ts` "renders the whole Run from platform-owned assets, and reaches nothing
     else": the REPLAY chrome; Play offered and "Frame 1 of 3"; the first frame decoded through
     the protected route; jump buttons for two Work Items, one Exception and one Escalation; the
     "Audit Instructions" heading with the frozen text.
   - `replay.spec.ts` "offers Replay from a terminal Run’s rail, and says a live Run has none
     yet"; "authorizes for ITSELF, before any Run fact reaches the page".
   - `ReplayViewer.test.ts`: "starts PAUSED at the first frame", "shows REPLAY chrome and never a
     live one", "renders the auditor’s frozen Audit Instructions verbatim and inert".
   - `replay.test.ts`: "takes a Work Item to its FIRST frame, so a jump starts at it", "takes an
     Escalation to the last frame BEFORE it was raised", "labels an Exception by the record it was
     raised against", "names the question, never the stored key".
   - `page.selected-replay.test.ts`: "keeps active Runs on Live View without reading a replay".
     `live-view.test.ts`: "gives every active state but Queued a live session word, and every
     terminal state REPLAY".
   - Record links (Auditor Workspace v1.1): `replay.spec.ts` "opens a requested inspection on its
     own stored frame and preserves it on reload"; `selected-replay.spec.ts` "follows the actual
     record-review inspection link and distinguishes its empty retained capture set";
     `tests/integration/selected-replay.test.ts` "keeps the 500-frame prefix while selecting the
     exact late capture and full context".
   - [DEP]: Replay 15 of 15 frames after the release, and playback advances.
2. *Frames, sanitized actions and Observation deltas render only from the platform-owned Replay
   asset set, aligned to Steps, and no action is ever re-executed.* **Covered, with limitation
   (2).**
   - Code read at `c18ad36`: the page reads only PostgreSQL rows (`readTimeline`, `readFrames`,
     `readWaits`, `readObservationDeltas`, `readExceptions`, `readEvidenceItems` and the frozen
     plan), and `replay.ts` is pure. Each frame comes through `/api/runs/<id>/frames/<id>`, which
     consumes a worker-signed read grant and checks the registered digest.
   - `ReplayViewer.test.ts` "fetches every frame through the Run’s own route and never an object
     store"; the frames route unit test (18); `evidence-read-grant.test.ts` (14).
   - Nothing is re-executed: `replay.spec.ts` "opens a requested inspection on its own stored frame
     and preserves it on reload" and `selected-replay.spec.ts` "decodes the exact protected late
     frame, reloads and pages paused, refuses foreign identity and failed bytes" both assert that
     the Run's `state` and `revision` and every chain event other than `evidence-access.*` are
     unchanged.
   - Aligned to Steps: `replay.test.ts` "is matched through the Step Execution that captured it"
     and "counts only what was registered by the time the frame was captured";
     `selected-replay.test.ts` (integration) "keeps interleaved pages honest and resolves
     action-only and conflicting Step-first owners" and "counts a larger distinct-timestamp history
     once while retaining a bounded frame page".
3. *With the Workspace Provider blocked at the network, or its retention expired, Replay renders
   the full Run with no provider call and no error. An automated test exercises Replay with the
   provider blocked at the network.* **Covered, with limitation (1).**
   - `replay.spec.ts` "renders the whole Run from platform-owned assets, and reaches nothing
     else" aborts and counts each request to another origin, requires the count to be zero, and
     passes axe. `selected-replay.spec.ts` "decodes the exact protected late frame…" also requires
     zero off-origin requests and zero page errors.
   - Expired retention cannot change Replay: nothing on the Replay path reads a provider recording
     (`replay-v1.md`, "What this contract does not cover").
   - The web cannot import the browser execution or the evidence store: `no-browser-execution-in-web`
     and `no-evidence-store-in-web` hold in [CI-c18], and `boundaries.test.ts` fires both rules on a
     planted import.
   - [DEP]: Replay ran after the workspace release, in Solari mode with recording off; 35342862535
     recorded zero console errors and zero page exceptions.
4. *In Replay mode, Space or Enter on scrubber pills and Step rows jumps Replay, the arrow keys step
   frames when the viewer has focus, Space toggles play or pause, and a frame's `alt` narration
   equals the Step narration.* **Covered, with limitation (3).**
   - `replay.spec.ts` "steps, plays and jumps from the keyboard alone": ArrowRight, ArrowLeft, End
     and Home step frames; Space plays and pauses; Space on a pill jumps and does not toggle
     playback; Enter on a pill jumps; Enter on the Escalation jump row lands on the second frame.
   - The "Step rows" are the jump-list rows (`replay-v1.md`, keyboard table). They are native
     buttons, so Space activates them as well; the spec presses Enter on one.
   - `alt`: code read at `c18ad36`: the stage sets `alt={frame.narration}` (`LiveViewer.tsx:174`),
     and the page builds `narration` and `stepNarration` from the same `stepNarration(step, …)`.
     Tests: `ReplayViewer.test.ts` "gives the frame the SAME sentence as its Step (UX-DR37)" and
     "offers one scrubber pill per frame, with the current one marked"; `live-view.test.ts` "gives
     the frame the SAME narration string as its Step row, in audit words"; `replay.spec.ts` finds
     the `alt` text on the rail.
   - A re-read keeps the reader's frame: `page.selected-replay.test.ts` "keys the viewer by the
     request and never by the read, so a re-read keeps the reader's frame", and the keyboard walk in
     `selected-replay.spec.ts` survives a real cancel of another Run.

**Verdict: Done — `[COMPILER-1 PATH]`.** Limitations (2), (3) and (5) are items for the Epic 5
retrospective (§6, points 13 and 15).

## 5. Status changes that follow from the register

Nothing in this section is applied yet. D-7-4 makes this register the only source of Epic 4 and
Epic 5 status changes, and the owner accepts the verdicts first. On acceptance, Story 10.1's
three remaining tasks apply them (§6, point 16), with the sprint-planning tooling's `validate`
before and after.

| Key | Status now | Verdict (§3) | Status on the owner's acceptance |
|---|---|---|---|
| `4-1-provision-an-isolated-agent-workspace-per-run` | done | Already done | `done`, unchanged; evidence registered |
| `4-2-sign-in-to-loancore-and-enforce-read-only-allowlisted-action` | done | Already done | `done`, unchanged; evidence registered |
| `4-3-supply-credentials-just-in-time-and-suppress-capture-during` | done | Already done | `done`, unchanged; evidence registered |
| `4-4-locate-a-record-capture-evidence-and-register-a-grounded-obs` | review | Done — `[COMPILER-1 PATH]` | `done` |
| `4-5-prove-absence-for-an-employee-with-no-account` | review | Done — `[COMPILER-1 PATH]` | `done` |
| `4-6-bound-agent-execution-and-render-retrieved-content-inert` | review | Done — `[COMPILER-1 PATH]` | `done` |
| `4-7-raise-typed-escalations-as-durable-waits` | review | Residual work — PROPOSED | stays `review` until Story 10-6 and 14-11a deliver residuals (a) and (b), or the owner amends the scope (point 1; §3.2) |
| `4-8-answer-an-escalation-from-run-detail-and-notify-audit-manage` | review | Residual work — PROPOSED | `done` if the owner confirms (b)–(d) (point 3); (a) is decided by a scope amendment (point 2; §3.2). Otherwise stays `review` |
| `4-9-confirm-or-reject-agent-judged-evaluations-to-seal-the-resul` | review | Residual work — PROPOSED (transfer only) | `done`: the transfer to 15-4 and the scope amendment are decided (point 4; §3.2) |
| `4-10-prove-the-agent-path-on-prodconsole-with-one-observation-per` | review | Done — `[COMPILER-1 PATH]` | `done` |
| `4-11-prove-abuse-resistance-and-workspace-isolation-with-negative` | review | Done — `[COMPILER-1 PATH]` | `done` |
| `4-12-evaluate-the-24-hour-disablement-window-through-the-complete` | review | Done — `[COMPILER-1 PATH]` | `done` |
| `5-1-stream-the-execution-timeline-live-over-sse` | review | Done — `[COMPILER-1 PATH]`, held (§3.1) | `done` if the owner takes resolution A of §3.1, item 1 (point 8); otherwise stays `review` |
| `5-2-capture-the-platform-owned-replay-asset-set-during-execution` | review | Residual work — PROPOSED | stays `review` until Story 10-6 and 14-11a deliver (a) and (b), and the owner decides (c) and (d) (points 5 and 6; §3.2) |
| `5-3-watch-a-running-run-in-live-view` | review | Done — `[COMPILER-1 PATH]`, held (§3.1) | `done` only if the owner takes resolution B of §3.1, item 2, a scope amendment (point 9); otherwise stays `review` |
| `5-4-pause-and-resume-a-running-run` | review | Residual work — PROPOSED | stays `review` until Story 10-6 delivers the linkage and the owner confirms (b) (point 7; §3.2) |
| `5-5-cancel-a-run-and-flag-it-to-audit-managers-from-live-view` | review | Done — `[COMPILER-1 PATH]` | `done` |
| `5-6-answer-an-escalation-without-leaving-live-view` | review | Done — `[COMPILER-1 PATH]`, held (§3.1) | stays `review` under either resolution of §3.1, item 3 (point 10), until the missing check or the repair is delivered |
| `5-7-live-view-when-the-stream-drops-or-the-run-ends-while-open` | review | Done — `[COMPILER-1 PATH]` | `done` |
| `5-8-replay-any-terminal-run-from-the-platform-owned-asset-set` | review | Done — `[COMPILER-1 PATH]` | `done` |

- **Epics.** `epic-4` and `epic-5` stay `in-progress` while any of their stories is in `review`.
  They become `done` only when every story is `done`.
- **Retrospectives.** `course-correction-dispositions.yaml` records `retrospective_required: once
  verdicts land` for both epics. The retrospective keys keep the sprint-status value `optional`,
  because the vocabulary has no "required"; the requirement lives in the disposition record.
- **Disposition record.** On acceptance, each story that closes Done is recorded with
  `compiler_1_path: true` and `retrospective_required: true`. The record already lists all
  twenty stories under `compiler_1_path_stories`. The `[COMPILER-1 PATH]` note never goes into a
  status value.
- **Memlog.** One decision entry in the PRD workspace memlog summarises the accepted verdicts,
  through `memlog.py`.

As proposed, acceptance moves ten stories to `done` at once: 4.4, 4.5, 4.6, 4.9, 4.10, 4.11,
4.12, 5.5, 5.7 and 5.8 (4.9 by the owner's transfer and scope amendment). 5.1 and 5.3 follow, or
not, with the owner's decisions in §3.1. 4.8 follows if the owner confirms its residuals (b)–(d).
4.7, 5.2, 5.4 and 5.6 stay in `review` until their residual work is delivered.

## 6. Open points

Sixteen points stay open when the assessment ends. This list is the rebuild's (§1). It replaces
the list in the lost commit `d79bdcf`, which only the first session read.

- Points 1–7 settle a residual verdict. On 2026-09-25 the owner decided points 1, 2, 4 and 5,
  and gave the rule that decides point 7 (a) (§3.2). §6.1 shows what is still open.
- Points 8–10 contradict a proposed Done verdict. §3.1 holds those verdicts.
- Points 11 and 12 are owner decisions and confirmations that do not change a proposed verdict.
- Points 13–15 are evidence limitations that the verdicts already account for. Each names where
  it goes.
- Point 16 is the rest of Story 10.1.

1. **4.7 — the human-matched flag.** A record that a person chose through a secondary key is
   flagged on its Observation only. The Result, the record review queue and inspector, and the
   Exceptions list do not show it, and no export exists. Decided on 2026-09-25 (§3.2): residual
   scope (a) is Story 10-6, and (b), the export leg, is an explicit criterion of 14-11a. (§4, Story
   4.7.)
2. **4.8 (a) — email.** No mail transport exists. Every email outcome is recorded `unconfigured`
   or `superseded`, and no email was ever delivered. Decided on 2026-09-25 (§3.2): in-app delivery
   is the compiler-1 closure, by a scope amendment, and no mail transport is built. The same scope
   applies to the email outcome of a flag (Story 5.5, limitation (4)).
3. **4.8 (b)–(d).** (b) The Workpaper Bundle leg goes to 14-11a. (c) The scheduled-Run author goes
   to 19-4. (d) The Auditor Workspace v1.1 compact Evidence tab replaces the panel "at the top of
   every tab" with a disclosure. Needs: owner confirmation of the two transfers and of the later
   design.
4. **4.9 — the Submit control.** `main` shows the sentence "Submission is unavailable while the
   Result is unsealed." as a statement, with no control. Result submission is old story 6-3, now
   15-4. Decided on 2026-09-25 (§3.2): the obligation moves to 15-4, which now has an explicit
   criterion for it, and a scope amendment records that the control did not pass here.
5. **5.2 (a) and (b) — missing frames are not flagged.** The platform records
   `failure.frame-missing` and `publication.evidence.framesMissing`, but nothing in `apps/web`
   reads either: Replay and the Result tab do not show a missing frame, so playback with a gap
   looks complete. The export leg has nothing to test on `main`. Decided on 2026-09-25 (§3.2): (a)
   is Story 10-6, on Replay, and (b) is an explicit criterion of 14-11a.
6. **5.2 (c) and (d) — retention, the live recording and the frame role.** (c) Provider retention
   is not set to minimum, because the SDK has no control for it, and no real recording was ever
   copied, because recording stays off by the 2026-09-15 decision (`CLAUDE.md:1187`). (d) A frame
   keeps `role = 'evidence'`, and no artifact is written with `role = 'replay'`, so the replay-role
   guards serve no producer. Needs: an owner decision — accept both as the compiler-1 closure, or
   keep them open. Minimum retention is an action against the provider account, not code.
7. **5.4 (a) and (b) — the Step on the pause and resume records, and the resume semantics.**
   (a) A pause record names the Step Execution only when one is in flight (six Work Item
   boundaries). It names no Step at the sign-in, adapter or between-Work-Item boundaries. No
   resume record names a Step or the attempt that the resume starts; only chain order or time
   links them, and that is inference. Under the owner's rule of 2026-09-25, the stored records
   therefore do not qualify, and the linkage is added for new events only, in a bounded follow-up
   (§4, Story 5.4). (b) epics.md and AD-16 restart the interrupted Step Execution as a new
   attempt; the 2026-09-01 EXPERIENCE.md (line 295) says the agent continues from the next Tool
   Action. The code follows epics.md. Needs: owner confirmation of (b); (a) follows the rule.
8. **5.1, AC1 — Run-chain events with no NOTIFY (§3.1, item 1).** Contradicts a proposed Done
   verdict. Needs: the owner's reading of "Timeline event".
9. **5.3, AC 2 — Live View's adapter rows show no digest (§3.1, item 2).** Contradicts a proposed
   Done verdict. Needs: the owner's choice between a repair in the follow-up and a scope
   amendment.
10. **5.6, AC 2 — the skip link does not move focus (§3.1, item 3).** Contradicts a proposed Done
    verdict. Needs: the owner's choice between a repair in the follow-up and a check first.
11. **Readings that the register relies on.** The register counts these legs as covered on a
    reading that the owner has not yet confirmed. If a reading is rejected, the leg is not met.
    (i) "The panel becomes a Timeline entry" (4.8, AC 4; 5.6, AC 3) is read as the
    `execution.escalation-answered` event on the Run's chain. The Execution Timeline tab has no
    Escalation row, although EXPERIENCE.md line 94 says that Escalations "stay expanded inline"
    there. (ii) "Recorded as superseded on the Timeline" (5.4, AC 3) is read as the
    `lifecycle.pause-superseded` event on the chain and the live channel; the Timeline tab has no
    row for it. (iii) The resume marker (5.4, AC 6): the code marks the earlier Step Execution
    `SUPERSEDED` with `superseded_by = 'resume'`, while epics.md names `superseded_by_resume` on
    the new attempt. (iv) "Overview counts … subscribe" (5.1, AC 2) is read as the Overview being
    re-read through the bell's subscription. Needs: owner confirmation of each reading.
12. **5.5 — the Flag placement and the N1 wording.** (i) At `c18ad36`, Pause/Resume, Cancel and
    Flag are the three actions of Live View's header row (UX-48), outside the navy chrome strip.
    The owner confirms that this row is "the session viewer's live controls" (UX-DR24). (ii) After
    a lost acknowledgement, the route boundary says "Couldn't load this page. Nothing was changed."
    over a flag that committed (`apps/web/app/error.tsx:37`; `CLAUDE.md:1439`). Needs: an owner
    decision on the placement and on the wording.
13. **The deployed evidence predates `c18ad36`, and its report is not on `main`.** [DEP] ran at
    `44fb596`, before the Auditor Workspace v1.1 merge changed the Live View header, the Evidence
    tab and Replay's record links. `loancore-final-acceptance-2026-09-18.md` is on the branch
    `validation/loancore-watch-closeout-20260918` only. Accounted for: every Done verdict rests on
    [CI-c18] for each AC, and [DEP] is supplementary. Owner action, if wanted: a deployed journey on
    the current head, and the report brought to `main`.
14. **Epic 4 limitations for the retrospective.** 4.1: the provider's hard session expiry (about
    one hour) bounds the lease that should last to the four-hour wait deadline; local mode isolates
    browser state, not the worker process. 4.2: the adapter path writes no `run_tool_action` rows,
    and there is no single named `BrowserExecution` conformance suite. 4.3: the export leg is a
    forward dependency on 14-11a. 4.4: the golden seeds D7, D11 and D13 are driven by no test,
    because the full golden export's duplicate key E-000107 stops the agent stage first (goes to
    9-6 as well). 4.6: no completed Run on the default Anthropic route, and issue #50 is open. 4.10:
    no live or deployed P-4 evidence; the production P-4 that froze a second Target System is
    refused with a sentence that names the wrong page (`CLAUDE.md:610`); the snapshot-time wording
    goes to the addendum owner; P-4 cases D6, D7 and those after D9-a are not seeded. 4.11:
    isolation is proven for browser state, not for worker memory or a provider-side firewall.
    4.12: the deployed acceptance does not assert the 24-hour rule. Accounted for: none of these is
    in an AC that the verdicts count as covered. No status changes.
15. **Epic 5 limitations for the retrospective.** 5.1: the Overview has no subscription of its
    own, the bell drops a second event within one second with no later re-read, no test shows the
    bell or the Overview change without a reload, the heartbeat is an event and not a comment, and
    the integration suite has no case that commits an event during a replay. 5.2: three documents
    still give cost as the reason that recording is off, and Replay shows neither the Escalation's
    question and answer nor the Session Step times that 5.2 keeps "for Replay". 5.3: no browser
    fixture seeds a Work Item or a non-empty Evidence list on Live View, and no test closes a tab
    during a Run. 5.4: the `attempt` number repeats across a pause, two fixtures model attempt 2,
    the adapter-stage pause arm and the pause and resume Server Actions have no test of their own,
    and `run-pause-v1.md` "Where a pause can land" omits the between-Work-Item boundary. 5.5: no
    database test flags a Run with a real Audit Manager seeded. 5.6: Flow 3 runs no worker and
    shows no frame beside the panel. 5.7: the silence clock restarts on any re-read that moves the
    cursor, the terminal remount loses a typed flag note, and no test renders the Escalation
    answers or the controller controls under a closed gate. 5.8: on the default view, the reads of
    waits, Observation deltas and Exceptions stop at 500 with no "bound" sentence; the arrow keys
    ignore modifiers; the network block is in the browser only; and no Timeline row links to
    Replay, although EXPERIENCE.md line 94 says every row has "Open in Replay". Accounted for: none
    of these is in an AC that the verdicts count as covered. No status changes.
16. **Story 10.1's other three tasks.** `course-correction-dispositions.yaml`, the seventeen
    sprint-status keys and the memlog entry wait for the owner's acceptance of this register (§5).

### 6.1 Classification of the sixteen points

Classified on 2026-09-25, after the owner's dispositions (§3.2). "Owner" names who decides, and,
after the semicolon, which story delivers. The last column answers the owner's question: does the
point contradict a proposed Done verdict, and if so, how is it accounted for?

| Point | Affected obligation | Impact | Owner | Disposition | Contradicts a Done verdict? |
|---|---|---|---|---|---|
| 1 | 4.7: the human-matched flag on the Result, the record review queue and inspector, the Exceptions list, and export | A reader cannot tell a match that a person chose from a platform match on those surfaces | Product owner (decided); 10-6 and 14-11a | Decided: (a) → 10-6, (b) → an explicit 14-11a criterion. Residual work stays open | No |
| 2 | 4.8, AC1 and AC2: email delivery and the email deep link | No email notification exists; notification is in-app only | Product owner (decided) | Decided: scope amendment. Email is unimplemented and was never delivered; no mail transport is built | No |
| 3 | 4.8: the scheduled-Run author (AC1), the panel on every tab (AC3), the Workpaper Bundle (AC4) | Scheduled Runs and the Bundle do not exist on `main`; the compact Evidence tab shows a disclosure instead of the panel | Product owner; 19-4 and 14-11a | Open: confirm the two transfers and the later design | No |
| 4 | 4.9 (and old 6.3): the Submit control | No Submit control on `main`; the sentence is shown instead | Product owner (decided); 15-4 | Decided: transfer to 15-4 with an explicit criterion, and a scope amendment. 4.9 closes as Done against its remaining scope on acceptance | No |
| 5 | 5.2, AC3: missing frames flagged on Replay and on export | Replay playback with a gap looks complete | Product owner (decided); 10-6 and 14-11a | Decided: (a) → 10-6, (b) → an explicit 14-11a criterion. Residual work stays open | No |
| 6 | 5.2, AC4 (provider retention at minimum; the live recording copy) and AC1 (`role = replay`) | Retention is not at minimum, but recording is off, so no provider recording exists; the replay-role guards serve no producer | Product owner | Open: accept as the compiler-1 closure, or keep open | No |
| 7 | 5.4, AC1 and AC7 (the Step on the pause and resume records) and AC6 (the resume semantics) | Without inference, a reader cannot tie every pause and resume to its exact Step and attempt | Product owner (rule given); 10-6 | (a) Decided by the owner's rule: the records do not qualify, so 10-6 adds the linkage for new events. (b) Open: confirm the restart semantics | No |
| 8 | 5.1, AC1: `NOTIFY` in the appending transaction | None on a surface: no web surface reads these event types, and an open stream sends them within 10 seconds | Product owner | Open: resolution A (the narrower reading, and the contract sentence corrected) is recommended | Yes. Held in §3.1, item 1; `done` only after the decision |
| 9 | 5.3, AC2: digests on Live View's adapter log rows | Live View states a false fact on every adapter row | Product owner; 10-6 if resolution A | Open: resolution A (repair in 10-6) is recommended; B is a scope amendment | Yes. Held in §3.1, item 2 |
| 10 | 5.6, AC2: the skip link moves focus to the panel | A keyboard or screen-reader user is not taken to the open Escalation | Product owner; 10-6 if resolution A | Open: resolution A (repair in 10-6) is recommended; B is a check first | Yes. Held in §3.1, item 3; 5.6 stays `review` under either resolution |
| 11 | 4.8 AC4 and 5.6 AC3 ("becomes a Timeline entry"); 5.4 AC3 ("superseded on the Timeline") and AC6 (the resume marker); 5.1 AC2 (the Overview "subscribes") | If a reading is rejected, that leg is not met | Product owner | Open: confirm each reading | Only if a reading is rejected. Rejecting (iv) would contradict 5.1 (already held); rejecting (i) would affect 5.6 (already held) and 4.8 (residual); (ii) and (iii) affect 5.4 (residual) |
| 12 | 5.5, AC4 (placement) and the route boundary's wording after a lost acknowledgement | The boundary says "Nothing was changed." over a flag that committed | Product owner | Open: confirm the placement; decide the wording | Only if the placement is rejected: then 5.5, AC4 is not met, and 5.5's Done would be held like §3.1's |
| 13 | Every Done verdict that cites [DEP] as supplementary evidence | The deployed product at `c18ad36` is not re-verified | Product owner (optional action) | Accounted for: each Done verdict rests on [CI-c18]. Optional: a deployed journey on the current head, and the report brought to `main` | No |
| 14 | None of the ACs that the verdicts count as covered (Epic 4) | Limits of the evidence, not unmet legs | Epic 4 retrospective; 9-6 for the golden seeds; the addendum owner for the P-4 snapshot-time wording | Accounted for; no status change | No |
| 15 | None of the ACs that the verdicts count as covered (Epic 5) | Limits of the evidence, not unmet legs | Epic 5 retrospective | Accounted for; no status change | No |
| 16 | Story 10.1, tasks 2 to 4 | The status changes in §5 are not applied | Product owner (acceptance); then Story 10.1 | Waiting for the owner's acceptance of this register | No |
