---
title: 'Epic 4 context: the Audit Agent works a web Target System'
type: 'epic-context'
created: '2026-09-06'
status: 'final'
---

# Epic 4 context

## What the epic is

Epic 3 made a Run execute itself against systems that answer a request with data. Epic 4 makes
a Run execute itself against a system a **person** would have to operate: the agent signs in to
LoanCore in an isolated workspace, finds each terminated employee, captures what it sees,
registers grounded Observations, and — when it cannot proceed safely — raises a typed
Escalation that an auditor answers, so the Result can seal.

## What is already true, and must not be re-decided

Epic 3 built the spine this epic plugs into. Nothing below is open:

- **One Observation registration contract.** `registerObservations` is the only write path, and
  its context is EXTENDED by each producer rather than injected, so there is no seam a
  composition root can omit. An agent producer joins the same contract; it does not get a
  second one.
- **The invariant is a composite foreign key.** An uninspected, ambiguous or contradicted
  record cannot be Compliant, at the database. An agent Observation is bound by it identically.
- **The Gate is twenty rows decided when the last Work Item completes**, and the outcome table
  applies in order with the first match winning. Epic 4 makes two rows reachable that this
  epic could not produce: **Pending Confirmation** (Story 4.9) and, through it, the sealing
  path that follows a human decision.
- **Evidence is reserved, uploaded, verified and registered by one implementation**, and an
  adapter extraction's scope carries its attempt. An agent capture is Evidence like any other:
  same reservation, same digest, same seal.
- **Corroboration is done by the stage that froze the artifact**, over the stored Structural
  Snapshot, in the registration transaction. `web_tree` is currently **unimplemented by name**
  and fails the check — Story 4.4 is what implements it, and it must implement it as a real
  extractor over the captured tree, never as a substrate that falls through to "matched".
- **A credential has nowhere to live.** The resolved object holds a reference and a method that
  sets a header, and no field holding a value. Story 4.3 supplies a credential to a browser
  rather than to a request, which is a new shape for the same guarantee, not a relaxation.
- **Run limits are read from the frozen plan, never restated**, and the token limit is wired
  and unexercised precisely so this epic fills it rather than inventing a new one.

## The provider decision, already taken

The architecture names Solari behind a `BrowserExecution` port. It is not installed, has no
credentials here and has no verified interface. The port is implemented with **Playwright** for
the proof of concept, and Solari stays named as an alternative implementation of the same port.

`_bmad-output/implementation-artifacts/epic-4-browser-provider-decision.md` records the
evidence, and — more importantly — what is honestly delivered and what is not. Read it before
Story 4.1. Its load-bearing sentence: a browser context isolates browser STATE per Run and is
**not a sandbox**; the worker process is shared and egress is policed inside the browser rather
than at the network. Story 4.1's acceptance text says nothing crosses between Runs. That is
true of browser state and false of process memory, and the story must say so in those words.

## The four decisions taken in the main thread, before any story was implemented

Each is a full document; each was taken here rather than left to an implementer, because each
either changes something an earlier story recorded or would otherwise be settled differently by
whoever hit it first. **Read them; do not re-decide them.**

| Decision | Where | Why it was taken here |
|---|---|---|
| **Solari is the browser provider**, driven with the Playwright client API. Local Chromium is the same code path for tests and is documented as the WEAKER guarantee | `epic-4-browser-provider-decision.md` | An earlier version of that document treated Solari and Playwright as alternatives and chose Playwright, because Solari was absent from this repository. It is published and installable, and it is a managed remote browser you drive WITH Playwright. The error is recorded rather than deleted |
| **LoanCore gains authentication on GET**, through an `Authorization` header above routing. No form, no POST, the read-only rule untouched | `epic-4-loancore-authentication-decision.md` | Story 4.2 is "sign in to LoanCore" and LoanCore deliberately has no sign-in. Left open, it becomes an assertion that passes because nothing happened |
| **Email notifications are written behind configuration and record an `unconfigured` delivery outcome** rather than a send that did not happen | `spec-4-8-…` Design Notes | This deployment has no mail transport. Wiring one is an owner decision with a cost; claiming a send is a lie in an audit trail |
| **Every seeded fixture case is mapped to the story that proves it**, and the golden P-1 and P-4 Runs are INCONCLUSIVE | `epic-4-fixture-map.md` | Correcting one spec against the real fixture found the epic text and the dataset deliberately differ. A dataset that seeds every failure mode cannot also demonstrate success — the Epic 3 lesson, repeating |

The Solari lifecycle notes in the provider decision were **corrected once against the installed
`.d.ts`** after being written from the cookbook prose: `timeoutMs` is the client's HTTP timeout
and not a session idle window, and what ends a session is `Session.expiresAt`, a hard plan-tier
deadline. Read the corrected table, not a memory of the first version.

## Story order and why

1. **4.1 Workspace** — everything else runs inside it.
2. **4.2 Sign in and enforce the allowlist** — the first outbound action, and the first denial.
3. **4.3 Credentials just in time** — needed by 4.2's sign-in, split out because suppression of
   capture during entry is its own guarantee.
4. **4.4 Locate, capture, register** — the first agent Observation; implements the `web_tree`
   snapshot substrate Epic 3 refused by name.
5. **4.5 Prove absence** — the agent form of Epic 3's honest-absence rule, which is where a
   false Compliant would come from.
6. **4.6 Bound execution, render content inert** — limits, model identity, and the guarantee
   that a hostile page cannot become an instruction.
7. **4.7 Escalations as durable waits** — the Run learns to stop and wait.
8. **4.8 Answer an Escalation** — the human half of 4.7.
9. **4.9 Confirm or reject Agent-Judged evaluations** — makes Pending Confirmation reachable
   and lets a Result seal after a human decision.
10. **4.10 ProdConsole** — the second Template proven on the agent path, no adapter involved.
11. **4.11 Abuse and isolation negative tests** — proves the guarantees absent, not believed.

## The bar for "done"

The same as Epic 3's, and it is not "the tests pass":

- The **hero Procedure** (terminated users on LoanCore) and the **Production Configuration
  Deviation** Procedure both reach their declared outcome through the real worker, the real
  browser and the real synthetic services.
- **Pending Confirmation is produced by a real Run** and sealed by a real human decision.
- Every expectation is declared by hand before the Run exists, and read off disk (AD-12).
- Negative tests fail the build on a scope-widening, a secret disclosure or a cross-Run leak.
- Anything not delivered is NAMED, with the reason, rather than counted.
