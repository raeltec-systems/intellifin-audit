# Final LoanCore acceptance — close-out report, 2026-09-17

**Verdict: NOT ACCEPTED.** The journey now runs end to end against the deployed product,
and in doing so it found three defects in the deployed environment. One of them — the agent
never reaching a record — is the acceptance's core gate, so this cannot be signed off.

The blocker that consumed the afternoon before this was not a product defect at all, and is
described last so it is not mistaken for one.

## What is under test

| | |
| --- | --- |
| Application | `https://web-production-edded.up.railway.app` |
| Deployed revision | `ef0515efbf0c2c558c5ad0153559d7239a8652d9` |
| Proven by | Release run 35259234380 (success, 18:30–18:36) and the Railway deployments it produced: web `1db22238` 18:32:18, worker `d34a0d5b` 18:35:34, northstar `887ae00b` 18:36:48 |
| Worker configuration | `Agent Workspace mode selected mode="solari" reason="SOLARI_API_KEY is configured" recording=false`, schema 50 |
| Validation branch | `claude/relaxed-rubin-stwsfu` (PR #44). `apps/`, `packages/` and `fixtures/` byte-identical to the released revision; the workflow refuses to run otherwise |
| Acceptance run | 35281174767 |
| Clean Procedure / Run | `01a0b174-2e1e-7b27-b382-cf9ffca8bf19` / `01a0b178-320d-7977-8cda-8d89d677bffa` |
| Negative Procedure / Run | `01a0b179-feb9-715a-a557-ce959ff9ffdf` / `01a0b181-9c9f-71a6-af5c-4227b3d6db91` |

## Gate results on the deployed product

| Gate | Result | Evidence |
| --- | --- | --- |
| Workspace persistence | **Pass** | Solari session created and persisted; `sign-in` Session Step `ACQUIRED`, 1 attempt, no diagnostic |
| Session secrecy | **Pass** | `providerHandleContained` true: a known provider identity, and counted page scans taken after it became known |
| Procedure creation | **Pass** | Created through the real UI |
| Population Source | **Pass** | Bound through the UI and read back from `procedure_version.source_snapshot` |
| Target System | **Pass** | Persisted `targets[].displayName` |
| Plan derivation | **Pass** | Six section saves, each proven by its own stored value |
| Auditor submission | **Pass** | Submitted; self-approval refused with the authored-version reason |
| Manager approval | **Pass** | A different identity approved; `independentApproval` true |
| Run start | **Pass** | Run `01a0b178…` initiated through the UI |
| Population | **Pass** | `populationValid` true; three records included |
| Live channel | **Pass** | `liveConnected` true, `liveStatuses: ["live"]` |
| Watch names the record | **Pass** | `E-000102` named on the rail |
| Timeline names every record | **Pass** | |
| Negative regression | **Pass** | `INCONCLUSIVE`, `population-key-unresolved`, duplicate `E-000107`, 0 observations, 0 conclusions |
| **Inspection 3/3** | **FAIL** | Defect C — no record inspected |
| **Expected verdicts** | **FAIL** | No conclusions to compare |
| **Evidence gate** | **FAIL** | Run never reached it |
| **Watch during RUNNING** | **FAIL** | Defect B — 0 frames delivered |
| **Replay** | **FAIL** | Defect B |
| **Workspace released** | **FAIL** | Run held open by the escalation |

## Defect A — a Server Action commits and never finishes replying

Seven occurrences in one journey, each costing exactly the harness's 60-second bound:
the Period-and-scope save and all six section reviews.

`page.waitForResponse` resolves on **headers**; `Response.finished()` resolves when the
**body** completes. The body never completes. The row is written regardless — the stuck
Drafts carry two plan-derivation attempts with two *different* input digests, and an input
digest moves only when authored inputs move, so one is the creation and one is the save. A
completed journey against a local build carries seven, one per section save plus creation.

For a real auditor: they click **Save** or **Mark reviewed**, the change is written, and the
control never resolves. No banner, no error, no timeout. The product has `UnknownSaveOutcome`
for an action that *throws*; a body that never completes does not throw, so nothing catches it.

Not reproducible against `next dev`, which is why every local reproduction passed. The
suspects are the Next standalone server and the Railway edge.

## Defect B — registered Evidence frames cannot be read

`frame-read-failed status 502`, four times, `framesDelivered: 0`.

The frames exist and have real bytes: four screenshots `REGISTERED` at 48,519 bytes each and
four structural snapshots at 1,090 bytes each. The capture and registration path works; the
protected read route returns 502, which in this codebase means a store disagreement.

Consequence: **Watch shows nothing and Replay would show nothing.** This is almost certainly
the same cause as the "Replay: No frames" in the original brief.

## Defect C — the agent never reaches a record

The acceptance's core gate, and the reason this is not accepted.

```
sign-in           ACQUIRED, 1 attempt, no diagnostic
Tool Actions      5 × navigate, all HTTP 200, all on the frozen Northstar origin
                  first: POST, redirected, capture SUPPRESSED  (the credential-bearing form)
                  then:  4 × GET, capture PERMITTED
Evidence          4 screenshots, every one exactly 48,519 bytes
                  4 structural snapshots, every one exactly 1,090 bytes
Work Items        E-000102 IN_PROGRESS → AWAITING; E-000103 and E-000105 never started
Wait              retry-or-skip, opened 22:24:45
```

No `search`, no `open-record`, no `read-attribute`. Identical evidence sizes mean the same
page was captured four times: the agent signs in, walks the landing page, gets nowhere, and
stops to ask a human.

Locally the same Procedure inspects all three records correctly, so the domain logic and the
frozen plan are sound. The difference is the live model in the loop against the deployed
LoanCore. Whether the model is failing to select `search` from the offered catalogue, or the
planner is not offering it on that page, needs an investigation this close-out did not carry
out — it is named rather than guessed.

## What IS proven, against the released code

The whole journey passes on a local stack running the same revision: PostgreSQL 18.6 at
schema 50, the real web build, the real worker, the real synthetic Northstar systems.

```
create → 6 sections → 6 section reviews → submit → approval by a SECOND identity
→ Run → 3/3 leavers inspected → Watch → Replay → human confirmation
→ sealed CONTROL_FAILURE
```

Verdicts matched the fixture exactly, zero disagreements:

| Record | C1 | C2 |
| --- | --- | --- |
| E-000102 | COMPLIANT | COMPLIANT (agent-judged, confirmed) |
| E-000103 | **EXCEPTION** | COMPLIANT (agent-judged, confirmed) |
| E-000105 | COMPLIANT | COMPLIANT (agent-judged, confirmed) |

Sealed outcome `CONTROL_FAILURE`, matching
`expected_outcome_after_required_human_confirmation`. The defective 27-row source still ended
`INCONCLUSIVE` on `population-key-unresolved`. All twenty gates green except `watchDuringRun`,
which is red for an honest reason: the local agent stage finishes in about six seconds, so the
viewer sees no frame change while the state is still `RUNNING`. That is the case the check
exists for and the case a Solari Run with a real model actually exercises.

This says the product is sound and the deployment is not. It is **not** a substitute for the
deployed acceptance.

## The blocker that was not a product defect

Every attempt before this stalled in the Builder, and it was read as "the Population Source
save does not persist". It was neither.

The workflow rewrote `scripts/verify-deployed-loancore.mjs` at run time with a Python heredoc
replacing five anchored strings — the thing CLAUDE.md already forbids, "a second copy of the
command shape that only the workflow could break". One replacement narrowed a wait that an
incomplete Draft can never satisfy. The run hung for 35 minutes emitting nothing.

Underneath it, three checks could not fail:

1. All six Builder sections report the same success sentence, and the harness matched it with
   `.first()` — so a section whose save committed nothing passed while the reader was looking
   at the previous section's banner. Each section now reads its own stored value back.
2. `visibleInspection` flipped on the first frame change whatever the Run's state, so one
   frame seen *after* the Run ended satisfied the one check whose subject is watching an agent
   work. `watchDuringRun` requires two screen changes while the state is `RUNNING`.
3. Replay was opened *before* the workspace release was confirmed, so it would have passed for
   a build that reached back to the provider for its frames.

And the harness could hang in silence: `poll` checked its deadline only *between* reads, and
`acknowledged()` held an unbounded `Response.finished()`. A watchdog now writes the report and
exits non-zero after eight minutes without a new event, naming the phase — which is what
found Defect A within one run after an afternoon of not finding it.

## One product finding adjacent to this work

`apps/web/src/runs/EvaluationReview.tsx` is the only control of its kind with **no readiness
marker**. `sign-in-form`, `NewProcedureForm`, `InitiateRunForm`, `RunLifecycleActions`,
`RunCancelControl`, `RunPauseControls`, `GuidedPreparation` and `VersionActions` all carry
one; `VersionActions` got it in `cb36958`, one commit before this release. Confirm opens a
focus-trapping dialog, which cannot exist before hydration, so a click made earlier is
swallowed with the page visibly unchanged. Measured: `data-client-ready` read `false` at all
three Confirm clicks, and one local run lost that race outright.

Not fixed here: it would re-deploy and invalidate "the acceptance ran against `ef0515e`", and
it is not what blocks the acceptance.

## Cleanup

Every temporary identity this validation created has had its sessions revoked and its role
grant removed. Accounts and everything they authored are left alone — deleting audit history
to tidy an environment is the one thing this must not do.

One mistake to record: an earlier cleanup pass revoked the roles of an acceptance run that was
still executing. Its guard skipped accounts with a recent *session*, and two of a run's three
identities never sign in through a browser — the PoC Administrator registers the configuration
server-side and the Audit Manager has no session until it approves. The grants were restored
within six minutes and the guard now reads `auth_user.created_at`.

## What remains

1. Root-cause Defect A. Start with the Next standalone server and the Railway edge; the row
   commits, so it is the response, not the write.
2. Root-cause Defect B. The bytes are registered; the protected read route returns 502.
3. Root-cause Defect C. Capture the model's offered tool catalogue and its proposals on the
   deployed LoanCore landing page, and establish whether `search` is offered and not chosen,
   or not offered.
4. Fix, regression-test, run full CI, deploy, and re-run this acceptance against that revision.
