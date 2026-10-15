# Zobba first-demo priority (owner decision 2026-10-08)

The owner chose to build toward the first demo before any other work. The build order
below is a priority among existing epic stories, not a scope change. Story numbers and
the Story 25.4 gate keep their planned meaning.

## Milestone A: demo-ready, working from uploaded documents

| # | Story | Why it is here |
|---|---|---|
| 1 | 20.7 deploy a recoverable qualification environment | UAT: every later story can be clicked through there |
| 2 | 22.4 run measured analysis in an isolated workspace | Real analysis over evidence |
| 3 | 22.5 extract usable facts with stable source locations | Facts point to their sources |
| 4 | 22.6 use methods and installed skills during investigation | Firm method and skills are used |
| 5–10 | 24.1–24.6 criteria, coverage, evaluations, work products, review | The audit result a user sees |
| 11–13 | 25.1–25.3 Pair workspace, questions, digest and work shelf | The screens people use |

At the end of Milestone A, a friendly user can do an audit Task from uploaded documents in
UAT. This is a demo. It is NOT the Story 25.4 gate: 25.4's non-goals forbid calling a
file-only flow or mocked sign-in the complete product.

## Milestone B: the Story 25.4 gate (first complete audit Task)

22.7, 21.5, 23.1–23.6, 27.4, then 25.4. These add budgets and responsiveness, a firm
document connection, the real remote computer with private sign-in, and helper subtasks.

## Pending review before Milestone A

21.6, 22.2 and 22.3 are built and wait for owner review. The Claude thinking-block
follow-up to 22.1 finishes first.

## Owner decision 2026-10-15: the target is now the Story 25.4 gate

With AWS credits available, the owner added 25.4 and all of Epic 23 (the real remote
computer and private sign-in) to the critical path. The target is therefore Milestone A
followed by Milestone B, ending at the 25.4 gate. 25.4 also needs 22.7, 21.5 and 27.4
(Milestone B above); they stay on the path unless the owner removes them.

Remaining on the critical path (24.1 built, awaiting owner review):

1. Milestone A: 24.2 (in progress), 24.3, 24.4, 24.5, 24.6, 25.1, 25.2, 25.3
2. Milestone B: 22.7, 21.5, 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 27.4, then 25.4

Also on the path: UI polish (after the core work) and one live provider qualification run
(owner approval required).

## Owner decisions 2026-10-15 (later the same day)

- 27.4 helper subtasks moves to after 25.4: the 25.4 scope names a firm document
  connection and two concurrent Tasks, not helper subtasks (independent advisor review).
- 24.3 is split into 24.3a (revisions, carried facts, dispositions) and 24.3b
  (exceptions and effective summary). Custom sandbox-program criteria become Story 24.7,
  off the critical path.
- 20.7, 22.4, 22.5 and 22.6 accepted as done. 24.1 stays in review until the owner sees
  it in the app.

Remaining critical path: Milestone A — 24.2 (in progress), 24.3a, 24.3b, 24.4, 24.5,
24.6, 25.1, 25.2, 25.3; Milestone B — 22.7, 21.5, 23.1–23.6, then 25.4.
