---
title: 'Epic 4 independent verification of the Codex continuation'
type: 'report'
created: '2026-09-08'
status: 'final'
---

> **Verified, not accepted, nothing merged.** Between 2026-09-07 and 2026-09-08 the Codex agent
> pushed 128 commits to `codex/epic-4-agent-runs` on top of my `b6bcd46`. This report is my
> own check of that work before anything is built on it: what they did, what I proved myself,
> what they changed in mine, what is still open, and the decisions only the owner can make.

## 1. Where the work is

| | |
|---|---|
| Branch | `codex/epic-4-agent-runs`, `b6bcd46` → `6deb1c9`. Codex continued on MY branch; there is nothing to merge |
| Side branch | `codex/northstar-acceptance-deploy` — three ops commits that add a one-shot Railway deploy workflow and then remove it. Its final tree EQUALS `70497eb` on the main branch. It is spent and can be deleted |
| Pull request | [#24](https://github.com/raeltec-systems/intellifin-audit/pull/24), draft, `mergeable_state: clean`, 200 commits against `main`. **It contains every Epic 3 commit as well**, so merging it alone delivers Epics 3 and 4 together and would leave [#23](https://github.com/raeltec-systems/intellifin-audit/pull/23) empty |
| Schema | 32 → **41**. Ten migrations; `SUPPORTED_SCHEMA_MIN = MAX = 41` |
| Size | 288 files, +98,794 / −1,322 lines |
| Sprint status | Stories 4.4–4.11 marked `in-progress` by Codex, not `done`. That is honest and it stays that way until the owner accepts |

## 2. What Codex built, story by story

Each row names what exists in the tree now and how it is proven. "Proven" here means a
test I can point at that ran green under my own gate AND in CI on the final commit.

| Story | What is there | Proven by |
|---|---|---|
| 4.4 Locate, capture, register | `web_tree` structural snapshots and PNG screenshots captured at approved search actions, frozen through the existing `freezeArtifact`, registered through the existing `registerObservations`; a read-grant path lets the web inspector open a stored snapshot without ever holding S3 credentials | `agent-journey.test.ts`, `web-tree-capture.test.ts`, `evidence-read-grant.test.ts`, `evidence-inspector.spec.ts`, Python-produced `web-tree-golden.json` |
| 4.5 Prove absence | Both identity keys searched, the empty result captured and frozen, immutable absence provenance (`run_observation_absence`, generation 40) | `agent-absence-golden.test.ts`, `absence-provenance.test.ts`, `agent-absence-journey.spec.ts` |
| 4.6 Bounded agent, inert content | Real Anthropic/OpenAI SDK gateway with a closed request shape; the model picks an opaque tool id and the platform binds the frozen value; measured token usage reserved BEFORE provider I/O; retrieved page text in a separate data field, never merged into instructions | `execute-agent-model-turn.test.ts`, `agent-abuse-golden.test.ts`, mutation `golden-retrieved-objective-separation` |
| 4.7 Durable waits | `run_wait` (generation 34), one transactional wake job, leased checkpoints, restart recovery | `run-waits.test.ts` with a held-open transaction race |
| 4.8 Answer an Escalation | Server Action with revision and closure guards, timeout sealing, initiator and manager notifications | `escalations.spec.ts`, `notification-delivery.test.ts`, two hydrated-answer mutations |
| 4.9 Confirm or reject | Machine proposal retained beside an immutable human decision; `sealResult` shares `publishResult` with `completeRun`; generation 25's one-update guard still holds | `evaluation-review.test.ts`, `evaluation-review.spec.ts`, mutation `agent-review-threshold-strict` |
| 4.10 ProdConsole | One page Work Item, one Observation per baseline key, the shared reconciliation and Gate | `prodconsole-agent-journey.test.ts` and `.spec.ts`, mutations `p4-d2b`, `p4-d5` |
| 4.11 Abuse and isolation | 29 named guard mutations killed in CI; hydrated closed answers; real-worker SDK denial; **overlapping remote Solari workspace isolation passed live** | `agent-abuse.test.ts`, `agent-isolation.test.ts`, `solari-workspace-isolation.spec.ts` (live run 34224743734) |

## 3. What I verified myself

**Not from their report.** Every number below is from a run I made or a log I read.

### CI on the final commit

Five jobs on `6deb1c9`, each read at the JOB level, not the step level:

| Job | Conclusion |
|---|---|
| Typecheck, boundaries, unit tests | success |
| Migrations and integration tests (PostgreSQL 18), including the 22-mutation harness | success |
| Agent abuse mutations (hydrated UI and worker), 7 mutations, 34 case pairs | success |
| Accessibility and shell (Playwright, WCAG 2.1 AA) | success |
| Container images build and refuse to start unmigrated | success |

### My local gate, CI's environment

Node 24.20.0, pnpm 11.25.0, PostgreSQL 18.4, **no provider key and no Solari key in the
environment** (so synthetic providers and local Chromium, exactly as CI). My first attempt
started under Node 22 because `nvm` does not take effect inside `nohup`; the version line I
write into every log caught it, the run was killed, and the script now refuses to start on
the wrong version.

| Step | Result |
|---|---|
| typecheck | PASS |
| boundaries | PASS, 510 modules cruised |
| **fresh install** empty → 41 | PASS, `schema_meta` has 41 rows, max 41, 50 tables |
| **upgrade** 32 → 41 | PASS, 50 tables |
| schema parity fresh = upgraded | PASS, 516 columns, 737 constraints, 40 triggers on both |
| unit | PASS, 3,549 tests |
| integration | PASS, 476 tests in 39 files, real PostgreSQL 18 and local Chromium |
| drift | PASS, no schema drift |
| build, web build | PASS, both |
| browser + WCAG scan | PASS, 162 tests, zero WCAG 2.1 AA violations, 13.1 minutes |
| mutation harness, default mode, disposable worktree | PASS, 10 of 10 guard mutations killed on `6deb1c9` (baselines green, every mutant failed its named assertion); CI additionally killed the 12 database-and-Chromium mutations and the 7 worker/hydrated ones on this same commit |

### The seams that matter, read by me and by a read-only mapping agent

- **One path from model output to the browser.** A model response carries only a `toolId`; `targetTool` resolves it to the platform's own frozen tool; `performToolAction` calls `authorizeToolAction` before `browser.perform`, which has exactly one production call site. A model cannot name an action, a destination or a locator.
- **One writer of Observations.** `registerObservations` is the only caller of `saveObservations`; the agent path reuses the adapter repository's transaction context.
- **One writer of Results.** `writeResult` (insert) and `sealPendingResult` (the single permitted update) are both reached only from `complete-run.ts`. Every terminal transition — Gate, cancellation, limits, wait timeout, review sealing, unexecutable Run — calls `completeRun` or `performCancellation`.
- **Credentials.** The model request is a closed, key-validated shape with no field for a credential or a resolved credential. The outbound request and the inbound response are both scanned by the guard; a disclosing response is stored `FAILED` with the text omitted. Captures are scanned before upload.
- **No shortcuts.** No `TODO`, `as any`, `@ts-ignore`, or production import from `tests/` or `fixtures/` anywhere in the new code.

### Tests were not weakened

- No test file deleted.
- One `test.skip` added, conditional on `PLAYWRIGHT_BASE_URL` (an external server), with a stated reason; CI never sets it.
- 15 `expect` lines removed from pre-existing tests against 436 added. I read all 15: each is replaced by a stronger or updated assertion (the `agent-driven-target` refusal that Stories 4.4+ deliberately remove, `web_tree` joining the implemented substrates, the P-1 coverage rule below, and stricter Northstar and startup assertions).

### Secrets

A scan of every added line for Solari, Anthropic, OpenAI, AWS, GitHub and Slack key shapes found nothing. `.env` is untracked. The live workflow reads keys only from Actions secrets.

### The live provider, from the authoritative log

I read the CI job log of the last full live attempt (run 34223964866), not the report:
a real worker on Solari `us-west` with OpenAI `gpt-5.6-luna` against the hosted Northstar
signed in, navigated, searched, opened the record, read three attributes, captured a
screenshot, and then in its evaluation turn answered `ambiguous`: **"The condition does not
define which roles are privileged."** The Run went to `AWAITING_AUDITOR`, the test threw
"Live agent requires an auditor decision; unattended acceptance cannot confirm the journey",
and the workspace was released 59 minutes before its provider deadline. That is the platform
refusing to guess, which is the behaviour the contracts require. The separate isolation gate
(run 34224743734) passed.

### Northstar is hosted now

Railway deployment `65c63c65` of the `northstar` service is `SUCCESS`; `/health` answers 200
and `/loancore` serves the real sign-in form. The deployed source `70497eb` is identical to
HEAD's `apps/northstar` and `fixtures/northstar`. This closes the loopback boundary I
recorded on 2026-09-06: a remote browser can now reach the synthetic systems.

## 4. What Codex changed in MY work, and what it changed that you should know about

1. **My generation-32 migration was patched, correctly.** Ten lines added, none removed: a
   `LOCK TABLE` and a suspend/restore of the two `*_frozen_after_seal` triggers around my
   backfill. Without it my migration FAILS on a database holding a sealed Run, because
   generation 21 refuses an `UPDATE` to sealed Evidence. Codex found it with a populated
   upgrade test. The transformation is byte-for-byte what I wrote. No database has run 32
   yet, production is at 14.
2. **A race in the workspace path I wrote (owner item 2) was found and fixed.** A worker that
   LOST its claim released the workspace handle even when the handle was a reattach to the
   durable identity — revoking the winning worker's live session. Codex reproduced it with a
   real PostgreSQL race and now releases only a handle the losing claim itself created.
3. **The P-1 desktop coverage blocker is gone.** `targetBlockersFor('P-1', [web])` used to
   return `desktop-coverage-missing` and block submission; it now returns nothing. Codex's
   reason: Addendum C names LoanCore and LedgerDesk as DEFAULTS, not a mandate, and the
   desktop path is Epic 7. I agree, but this is an Epic 2 acceptance rule changed by an
   agent, so it is listed here for your confirmation.
4. **The AD-2 registration envelope gained an optional seventh key.** `authentication_destination`
   is digest-bearing when configured and ABSENT otherwise, so every existing digest is
   unchanged. The Python golden generator carries the new vector. The Story 1.6 note saying
   "exactly six keys" is marked extended in this commit.
5. **`sealResult` is exported from `complete-run.ts`.** A second updater of `run_result`,
   but through the same `publishResult`, called from one place, and still under generation
   25's one-update trigger. Story 3.9's note argued against such an export; the trigger is
   the backstop and I accept it.
6. **The CI gate grew.** The PostgreSQL job now runs 22 guard mutations in a detached
   worktree, and a new job runs 7 worker/hydrated mutations. Together about 20 minutes more
   per pull request. That is the strongest evidence type this project uses, so it stays.
7. **The live acceptance workflow costs money when triggered.** Adding the label
   `solari-live-acceptance` or `solari-isolation-acceptance` to PR 24 runs a paid Solari
   session (and, for the audit scope, real model turns). Both labels are on the PR now; that
   consumes nothing by itself, but removing and re-adding one starts a run.
8. **Three decision-log notes were left stale** by the changes above (six-key envelope,
   coverage blockers, the deferred Northstar service). Marked in this commit.
9. **No contract document was written for Stories 4.4–4.11.** Stories 4.1–4.3 each left a
   `docs/contracts/*-v1.md`; the agent loop, durable waits and human review have none. The
   rules live in code and in CLAUDE.md sections. A gap, not a defect.

## 5. What is not done, and not claimed

- **The full live audit is not accepted.** It stops, correctly, at the C2 question below.
- **D3, the 24-hour disablement variant, is unproven.** It needs a termination TIME, which only the PeopleHub binding carries, and the compiled field name (`termination_time`) does not match PeopleHub's (`termination_effective_time`). No alias exists in compiler 1 and inventing one would be a contract change.
- **Production cannot run it yet.** The Railway worker has no `SOLARI_API_KEY`, `CREDENTIAL_TOKENS`, `EXCEPTION_FINGERPRINT_KEY` or `EVIDENCE_S3_*`, and there is no private bucket. Model keys exist but the Luna model override does not.
- **Email is unconfigured by design**; notifications are in-app.
- **Desktop execution stays in Epic 7.**

## 6. Decisions only you can make

**1. What "privileged" means for C2.** The P-1 default says *"Treat any account whose roles
look privileged as an Exception even if disabled"* and names no roles. LoanCore's synthetic
roles are `LOAN_VIEWER`, `LOAN_OFFICER`, `COLLECTIONS_AGENT`, `TREASURY_ANALYST`,
`SERVICING_CLERK`, `RISK_ANALYST`, `OPS_CLERK`. The model stopped and asked, which is right.

| Option | What it means |
|---|---|
| **A. Name the privileged roles in the Procedure's C2 guidance (recommended)** | The auditor authors the list. The unattended live gate can then finish. Runtime unchanged |
| B. Keep C2 as is and answer the Escalation by hand | Already works. The live gate stays a manual step forever |

**2. D3.** Option A: a small story adding a frozen field-mapping extension so the compiled
`termination_time` can bind to PeopleHub's `termination_effective_time` (recommended, it is
the only honest way). Option B: record D3 as out of scope for Epic 4.

**3. Merge shape.** Option A: merge PR 23 (Epic 3) first, then PR 24 (recommended, it keeps
two reviewable releases). Option B: merge PR 24 alone, which carries both and closes 23 as
empty.

**4. Confirm the P-1 rule change** in §4 item 3, or ask me to restore the blocker.

**5. Deployment inputs**, an action list rather than a decision: the four worker variables
above, a private S3-compatible bucket, and the model override.

## 7. My verdict

The work is real, disciplined and green under my own gate. It is built the way this codebase
demands: single writers, fail-closed diagnostics, mutation-proven guards, contracts frozen
in the plan. I will build on it. It is not accepted as a delivered epic until the owner
answers the C2 question and the live gate completes.
