---
title: Owner walkthrough of 2026-09-16 — findings, root causes, repairs and verification
status: draft
date: 2026-09-16
---

# Owner walkthrough of 2026-09-16

The owner walked a P-1 Procedure through production end to end: created through the
interface, approved by a second account, activated, started by hand, and rerun once. Both
Runs failed about five seconds after they started. The report filed seventeen UX findings
and thirteen RUN findings. This document records, per finding, what was true, what was
changed, and how each change was verified — and what is deliberately left for a decision.

**Two things the owner's report got exactly right and this document should not bury.** The
platform refused to dress a failure as a pass: the Result said no conclusion was issued, the
Gate said it had not been evaluated, and the Exceptions page said an empty list proves
nothing. And the thing that was missing was not a guarantee — it was a SENTENCE. The
platform knew why both Runs stopped and no surface said it.

## The blocker: RUN-01, and why the surfaces could not say why

**What the owner saw.** Both Runs: population acquired (27 rows, 19 included, 4 excluded,
4 indeterminate), one population artifact registered and sealed, no Step Execution, no
Observation, `Run Failed`, the Result saying "The Run failed before any Session Step
recorded a diagnostic", the Timeline listing workspace creation and population acquisition
with "0 of 0 Step Executions", and nothing in the worker's Railway log about either Run.

**What happened.** The population recovery sweep (`recoverableRunIds`, every five seconds)
selects a `RUNNING` Run that has no `population_execution` row — the Story 5.3 definition
of an abandoned Run, which was right until Story 4.1 put the workspace stage BEFORE
acquisition. Creating a Solari session takes seconds, and for those seconds a healthy Run
is exactly "RUNNING with no population row". The queue's delivery held the workspace lease;
the sweep's handler lost that claim, received the same `null` an adapter-only Run receives,
carried on to acquire the population, and reached the agent claim first — which found a
workspace that was not yet `OPEN` and ended the Run `workspace-missing` (`RUN_FAILED`, a
diagnostic recorded on the agent checkpoint, which the Result panel did not read). The
winner's `OPEN` commit was then refused (the Run was no longer `RUNNING`) and its provider
session leaked until the provider's own timer. A local Chromium launches in under a second,
so in every test the workspace was `OPEN` long before the population was acquired and the
race was invisible. The deployment switched to Solari mode on 2026-09-15 at 20:50 UTC;
these were its first two Runs.

**A `null` that meant two things is the whole defect.** It meant both "this Run needs no
workspace" and "somebody else is provisioning it", and only the first is safe to carry past.

**Repairs** (each proven by mutation):

- `provisionWorkspace` answers `deferred: true` when another claimant holds a live
  `PROVISIONING` lease, and the worker's queue handler and recovery handler stop there.
- The agent claim WAITS on a `PROVISIONING` or `RETRY` workspace (`workspacePending`)
  instead of failing the Run; `workspace-missing` now means no row, or a `FAILED` or
  `RELEASED` one under a `RUNNING` Run.
- The population sweep excludes a Run whose workspace is under a live provisioning lease.
- The worker logs `Run ended` — Run id, terminal state, stage, closed diagnostic — for every
  Run that ends under it, from the same stop facts the Runs list reads. An operator with
  only the Railway log had nothing at all to read.

**What names the failure on the surfaces now.** PR 39 (merged 2026-09-16) reads the stop
facts for the list and the Run header; this batch adds the same facts to the Result tab's
execution-failure panel and to the Timeline's stage rows. The two old Runs will read
"workspace missing" in words; a new Run will not reach that state.

## What is fixed

| ID | What was true | What changed |
|---|---|---|
| RUN-01 · Critical | See above. Both Runs failed five seconds in with no actionable diagnostic. | The three-rule race repair, plus a `Run ended` worker log line carrying the stage and the closed diagnostic. |
| RUN-02 · Medium | The Evidence tab said "Target checks are pending" from the population status alone, on a Run that had already ended. | The sentence is derived from the Run's own state, and an indeterminate population row is explained rather than left as a code. |
| RUN-03 · High | Replay linked to `/runs/<id>/observations`, a route that does not exist. | The link points at the Evidence tab, where Observations are listed, and says so. |
| RUN-04 · Critical | The Overview said "Nothing needs attention", "none is Inconclusive or Run Failed" and "No Runs yet" while the register held one Run Failed and two Inconclusive Runs — and said it again after every reload, because it was a Story 1.4 placeholder that rendered both empty states unconditionally and read nothing. | It reads: open Escalations and flags, Procedure Versions awaiting approval, and stopped Runs with the reason each one stopped, then the ten most recent Runs. Empty or not is decided by EXACT counts, never by the length of a bounded page. |
| RUN-05 · High | The Procedures list showed "No Runs yet" and "No outcome" beside a Procedure that had two Runs. | Each Procedure card shows its last Run's time, lifecycle state and stop reason, distinguishes "no conclusion issued" from "no Run has been started", and says "Runs start by hand in this release; no Run is scheduled" instead of claiming no history. |
| RUN-06 · Medium | UUID links wrapped every few characters and the Runs table overflowed. | PR 39: an identifier wraps only at its hyphens, with a 20-character minimum, and the period never wraps. |
| RUN-07 · High | Breadcrumbs, run links, evidence links, the coverage system and the initiator all printed raw UUIDs. | PR 39 names the initiator, the canceller and the rerun starter. This batch names the auditor on each section review record in the Builder, the author and decider on the version review, and gives every Run stage a name instead of a code. Object keys and digests stay, behind the fingerprint word and its explanation. |
| RUN-09 · High | "Safe next action" cited "Addendum §E.1, row run-failed" at an auditor. | Plain words: what the Evidence state is, and where the reason for the stop is stated. |
| RUN-10 · Medium | The Timeline said "0 of 0 Step Executions" while listing workspace creation and population acquisition, and named no failed unit. | It says no record was tested because the Run ended during session preparation, and names the stage that failed. |
| RUN-12 · Medium | Replay with no frames still said "0 Observations had been registered when this frame was captured." | An empty-state sentence that does not imply a frame exists. |
| UX-01 · Medium | The shell showed Sign out and never said who was signed in or with what role. | The signed-in person's name and role sit beside Sign out. |
| UX-05 · High | The Template caption said LedgerDesk cannot run here and should be left out, while a warning four elements below demanded a desktop system be added. | One statement, in the direction that is true: this release runs web, API and file systems, so a Template's desktop default is left out and the selection is complete without it. The contradicting warning is gone, and `targetCoverageMissing` is narrowed at its SIGNATURE so a caller asking for the desktop sentence does not compile. |
| UX-09 · Medium | "Frequency and handling" promised stop-and-ask controls that are not in that step. | The step is named for what it takes, and the handling facts the compiler froze (stop-after limits, retries, when a person is asked) are shown read-only beside it. |
| UX-11 · High | Decision history printed the author's opaque identifier. | Names, decision words and readable UTC timestamps, on the version review and on the Builder's section review records. |
| UX-13 · Medium | The submitted version review had no breadcrumb and no way back to the Procedure. | A trail and a back-to-Procedure link. |
| UX-14 · Medium | The plan said "exact normalized employee ID" in one place and "never trim, normalize" in another. | One statement above the steps that carry both phrases: identity keys are compared exactly, character for character. The frozen compiler bytes are NOT edited — see below. |
| UX-15 · To validate | "Model: Not set" on the version review, with no explanation. | It says what it means: no plan-check model is configured, so the plan was worked out from the saved sections alone, and the writing assistant is a separate model that this version does not freeze. |
| UX-17 · Medium | The approval dialog said only "Approve?" with a generic consequence. | It names the Procedure and version and says what approval does. |

## Left for a decision, with a recommendation

Each of these reproduced. None is fixed in this batch, and each says why.

- **UX-02 · Medium — the Builder's first viewport.** Real, and it is a layout pass over the
  guided outline rather than a defect with a single cause. **Recommendation:** do it with
  UX-03 and UX-04 as one authoring-flow story, so the three are designed together.
- **UX-03 · High — the scope assistant asks for the population before the dates, refuses to
  draft until the period is saved elsewhere, and names a "Period preparation section" that
  the screen calls "2. Choose dates".** The wrong-label half is cheap; the ordering half is
  a change to the guided script and to what the assistant may propose. **Recommendation:**
  one story — propose dates from ordinary language, confirm them inline, and take every
  screen name from the surface rather than from the prompt.
- **UX-04 · Medium — the evidence chat lists every registered source as unclickable text
  and asks the auditor to type "select <name>".** **Recommendation:** clickable
  recommendations filtered by the control, with the full registry behind a search. The chat
  command path already accepts a named selection, so this is a surface change.
- **UX-06 · High — saving a later section resets earlier section reviews, and the stale
  success banner still said a section was reviewed.** The invalidation itself is deliberate
  (a conservative dependency projection, recorded 2026-09-11) and is the safe direction. Two
  halves are not: the banner is stale, and nothing says WHICH change invalidated WHICH
  review. **Recommendation:** fix the banner and name the cause now; narrow the dependency
  projection only with a story that can show the diff.
- **UX-07 · High — P-1 ships C2 ("roles look privileged") with no role list, so the
  assistant cannot finish.** This is the same gap the 2026-09-08 owner decision named:
  privilege is never inferred from a role's name, and a `RolePrivilegePolicy` is an explicit
  frozen binding — but nothing in the Builder can author one. **Recommendation:** a story
  that adds the role-policy editor. Until then the honest alternative is to remove C2, which
  is what the owner did.
- **UX-08 · Medium — evidence field names and status values need exact technical spelling.**
  Connected to the finding below about `[disabled]`. **Recommendation:** offer the declared
  fields and observed values from the registration's own metadata, with readable labels, and
  keep a free-text escape that explains itself.
- **UX-10 · High — the final plan shows a raw population UUID, credential references and
  compiled expressions.** **Recommendation:** lead with the auditor-readable work plan and
  put identifiers, references and predicates in a closed diagnostics disclosure. Same shape
  as UX-12 and best done with it.
- **UX-12 · High — the version review is a technical dump and repeats the plan and the
  instructions in several places.** **Recommendation:** a concise approval brief — risk,
  scope and period, population, systems, test, criteria, evidence, limitations, changes —
  with every technical fact still reachable in a closed disclosure. Nothing is deleted;
  what changes is the order and what is open by default.
- **UX-16 · High — the manager's Review page says no Result awaits a decision while a
  Procedure is waiting for that manager's approval.** `apps/web/app/review/page.tsx` is a
  Story 1.4 placeholder that renders one empty state and reads nothing — the RUN-04 defect,
  on a second page. **Recommendation:** fix it next, with the reader the Overview already
  uses. It is small and it is High. Until then the Overview's attention list and the
  notification deep link both show the waiting version.
- **RUN-08 · Medium — the Evidence page shows metadata with no way to open the artifact.**
  The read path exists (a worker-signed, actor-bound grant, consumed on the server) and the
  Structural Snapshot inspector uses it. **Recommendation:** a story that extends the same
  grant to the population artifact with masking applied, because the population is the one
  artifact that can carry personal data and the masking rule has to be designed, not
  assumed.
- **RUN-11 · Limitation — Run Review says result submission is a later release.** Correct
  and deliberate: submitting a Result is Story 6.3, in Epic 6. The surface states it rather
  than offering a control that does not work.
- **RUN-13 · Critical acceptance gap — the live Solari experience has not been
  demonstrated.** Unchanged by this batch and unverifiable from here: this environment holds
  no provider key and must not. What this batch does is remove the reason both Runs died
  before inspection, and add a browser journey that drives the owner's exact P-1 path
  through the interface and the real worker to a sealed Result with Observations, in a local
  browser. **The demonstration itself is the owner's to run** against the deployment once
  this release lands.

## Three findings the P-1 journey met, and did not hide

Writing the end-to-end journey found three facts worth a decision. None is fixed here; each
is a comment in `tests/e2e/owner-walkthrough-p1.spec.ts` beside the code it explains.

1. **A duplicate lookup key costs the Run every other record's inspection.** The golden
   Leavers export carries `E-000107` twice, both Terminated and both inside August, and
   `includePopulation` maps one row to one record without deduplicating. The agent stage
   then writes a terminal `population-key-unresolved` checkpoint and creates NO Work Item at
   all. The adapter path over the same shape deduplicates and reports
   `duplicate-record-keys`; §H treats a duplicate Source key as a finding; and the
   expectation file declares `E-000107` alone Unevaluated while still declaring per-record
   outcomes for the other eighteen. The Run outcome is Inconclusive either way, so what is
   lost is the coverage of every clean record. **Recommendation:** make the agent path match
   the adapter path — mark the duplicated record uninspected, report it on the Gate, and
   inspect the rest.
2. **The golden population is designed to escalate, so it cannot demonstrate success.** It
   seeds an unnamed status value (`Suspended`) and a two-candidate name search, each opening
   a wait that holds the Run `AWAITING_AUDITOR` for thirty minutes. That is the dataset
   working; a dataset that seeds every failure mode at once cannot also be the one that
   shows a clean pass. The journey therefore binds a declared single-record source and
   leaves the full export seeded but unbound, so the choice is visible.
3. **P-1's Template default for C1 does not match what LoanCore displays.** The Template
   freezes `[disabled]` / `[active]`; the system shows `Disabled` / `Active`; compiler-1
   compares named values exactly and corroboration permits no case-folding. So an auditor
   who accepts the default gets an unnamed-value Escalation on every record. The journey
   types the values the system actually shows, and asserts the default first so the mismatch
   is pinned rather than papered over. **Recommendation:** decide whether the Template
   default or the synthetic system's display is wrong, and fix the one that is.

## Two things deliberately not edited

- **The frozen compiler bytes (UX-14).** `makePlan` writes "exact normalized" and "never
  trim, normalize" inside the canonical plan text that every ACTIVE version has frozen.
  Editing it would change what those versions say they were testing. The contradiction is
  resolved by a statement above the steps instead, on both surfaces that render them.
- **`procedure_version.sections` key names and the frozen review shape.** Both are validated
  stored payloads. What a reader sees above one can change; the key cannot.

## Verification record

Run on this machine against PostgreSQL 18 at schema generation 49, Node 24.20.0,
pnpm 11.25.0. Two database-backed suites are never run at once.

| Gate | Result |
|---|---|
| `pnpm -r typecheck` | green (4 packages) |
| `tsc -p tsconfig.root-tests.json` | green |
| `pnpm boundaries` | green |
| `pnpm test` (unit) | green |
| `pnpm test:integration` | 47 files, 565 tests, green |
| `pnpm exec playwright test` | see below |
| Migration chain | fresh install and upgrade both reach 49 |

**Every new guard is proven by mutation.** The source line is removed, the named test is
required to FAIL, and the file is restored from a copy taken with `cp` — never
`git checkout --`, which has twice reverted an uncommitted fix along with the mutation.
The deferral rule's proof: deleting
`if (prior?.status === 'PROVISIONING' && Date.parse(prior.leaseUntil) > now.getTime())`
fails `agent-workspace.test.ts`'s new case, and only that case.

### What the first full browser run found

202 passed, 7 failed. Two of the seven were specs this batch had already repaired after
that run started, so the run read the old files. Of the remaining five, **one was a real
defect and four were its shadow** — a failed test restarts the Playwright worker, which
runs `afterAll` early, and every later test in the file then meets an empty list.

The one real finding was mine: RUN-05 fills the Procedure card's Next Run and Last outcome
cells from facts, so two members of `PROCEDURE_CARD_ABSENT` were left rendering nowhere
while `copy.test.ts` went on pinning them and `procedures.spec.ts` went on waiting for
them. The constant now holds the two cells that really are absent, and the "never a dash"
rule is asserted over all four together — the two here and the two in `last-run-words.ts`
— so moving a cell's home cannot move it out of the rule's reach.

### What the rerun found, which nothing else could

With the journey passing, `owner-walkthrough-p1.spec.ts`'s TEARDOWN failed for the first
time: `Evidence for Run … is frozen: its package is sealed`. Generation 32 puts the same
`run_evidence_frozen_after_seal` trigger on `run_evidence_capture` that generation 27 put
on `run_evidence` and `population_evidence`, and the teardown deleted captures with the
other Tool Action rows — before the seal. **Unreachable until now, because the journey had
never before reached a sealed Run.** The seal and its three siblings, which reference only
`audit_run`, are deleted first. Replayed against the real sealed Run left behind by the
failure: the old order is refused at `run_evidence_capture`, the new order removes all
twenty-eight tables cleanly.

Then 35/35 in the three affected specs, and a full suite re-run on the fixed tree:
**210 passed, 0 failed.**

### The Codex review of this branch

Six findings, every one reproduced against the code and fixed in `d1b5a58`, each proven by
mutation. Two were P1 and both were in the seeding workflow this batch added: a dispatch
input reaching the shell as part of the program rather than as data, and an extra-account
path whose comment claimed it refused an existing address while `seed-identity` upserts the
role — an elevation path against an account whose password is already in an earlier run
summary. Four were P2: the stop reader bounded below its widest caller, so Procedure cards
past the twenty-sixth lost their stop reason; the Overview's stopped Runs ordered by time
instead of by EXPERIENCE.md's Inconclusive-then-Run-Failed order; the Target Systems step
calling a selection complete beside the list of what was missing; and a Timeline sentence
naming a preparation stage for every zero-step Run, including Runs that stopped after it.

**A review that finds two security defects in a file added to make a walkthrough possible
is a review earning its place.** The full reply is on the pull request.
