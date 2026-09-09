---
title: 'Epic 4 story status by verification level'
type: 'status'
created: '2026-09-09'
candidate: 'codex/epic-4-agent-runs @ 6237c4c (PR 24)'
---

# Epic 4 story status by verification level

The owner asked for story statuses that distinguish five levels rather than one word.
Each cell names the evidence; "no" means nothing of that kind exists yet.

| Level | Meaning |
|---|---|
| Implemented | The code and its tests are on the candidate branch. |
| Locally verified | The gates ran on a real PostgreSQL 18, the real worker and the synthetic systems on a developer host, and the counts are recorded. |
| Remotely verified | The hosted CI ran the same gates on the exact commit, or the selected live workflow ran against Solari, the model provider and the hosted Northstar. |
| Owner-reviewed | The owner read the delivery and accepted it. |
| Deployed | Released to the Railway production environment. |

Hosted evidence used below: standard CI `34225247788` (all five jobs green on `6deb1c9`,
the Codex baseline); the live audit `34223964866` (real worker, model and Solari; stopped
correctly on the undefined C2 criterion, not accepted as a Pass); the remote isolation
gate `34224743734` (passed). CI on the current candidate `6237c4c` is `34298099868` (all five jobs green); the live run `34299424112` on `07f79e2` passed the policy-bound audit, the undefined-privilege negative case and the isolation gate.

| Story | Implemented | Locally verified | Remotely verified | Owner-reviewed | Deployed |
|---|---|---|---|---|---|
| 4.1 Isolated Agent Workspace per Run | yes | yes (Story 4.1 gate; `agent-isolation` integration) | CI `34225247788`; isolation gate `34224743734` passed on Solari | no | no |
| 4.2 Sign in to LoanCore, read-only allowlisted actions | yes | yes | CI; live audit `34223964866` authenticated through the real form on the hosted Northstar | no | no |
| 4.3 Credentials just in time, capture suppressed | yes | yes (`credential-containment` browser and mutation cases) | CI including the containment mutation gate | no | no |
| 4.4 Locate a record, capture, register a grounded Observation | yes | yes (`agent-evaluation-journey`, golden P-1 cases) | CI; live audit performed navigate, search, open-record, read-attribute with corroborated roles | no | no |
| 4.5 Prove absence for an employee with no account | yes | yes (`agent-absence-journey`, absence guard upgrade regression) | CI | no | no |
| 4.6 Bound execution, retrieved content inert | yes | yes (`agent-retrieved-abuse`, `agent-worker-abuse`, mutation harnesses) | CI mutation gates green on `6237c4c` (they had been red on `db3c6d3`/`ad238db` for a stale anchor) | no | no |
| 4.7 Typed Escalations as durable waits | yes | yes (`escalations` integration and browser) | CI; live audit reached a durable `AWAITING_AUDITOR` wait and confirmed remote cleanup | no | no |
| 4.8 Answer an Escalation, notify Audit Managers | yes | yes (`agent-escalation-abuse`, notification delivery) | CI hydrated-answer mutation gate | no | no |
| 4.9 Confirm or reject Agent-Judged evaluations, seal the Result | yes | yes (`evaluation-review`, `agent-evaluation-journey` confirm and reject) | CI; live run `34299424112`: COMPLETED, PENDING_CONFIRMATION, consistent COMPLIANT proposal retained for human review | no | no |
| 4.10 ProdConsole, one Observation per parameter | yes | yes (`prodconsole-agent-journey`) | CI | no | no |
| 4.11 Abuse resistance and workspace isolation | yes | yes (mutation harnesses in a detached worktree; 10/10 unit mutations killed at `6237c4c`) | CI mutation gates green on `6237c4c`; isolation gate passed on Solari again in `34299424112` | no | no |
| 4.12 24-hour disablement window, complete evidence path | yes (`be91d3e`; Builder authoring of the window, its mapping and the `disabled_time` requirement in the hero pass) | yes (domain, application, golden case; `disablement-window-journey` on the compiled worker: PASS and Inconclusive cases) | passed in the hosted browser job of `34298099868` | no | no |
| Owner decision 1: C2 role-privilege policy binding | yes (`1dee0cb`) | yes | CI green on `6237c4c`; live policy-bound case passed in `34299424112` | no | no |
| Owner decision 4: refused Target System stays in the Result | yes (`db3c6d3`) | yes | CI static, PostgreSQL and browser jobs green | no | no |
| Owner §3: hero-workflow usability pass (editable Drafts, business-language C1, readiness, direct saves, honest recovery, agent summary, 24-hour window as a third condition) | yes (`codex/epic-4-hero-ux`, merged) | yes: typecheck, 3641 unit, boundaries, build, 34 of 34 browser tests with keyboard and axe, 16 screenshots (`epic-4-hero-workflow-report.md`) | hosted CI on the merge head: pending at the time of writing, recorded on PR 24 | no | no |

What closes the remaining gaps, in order: a green standard CI on the exact candidate;
the selected live workflow on that SHA (policy-bound audit, undefined-privilege negative
case, remote isolation); the owner's review of PR 24; the release described in
`epic-4-deployment-readiness.md`.
