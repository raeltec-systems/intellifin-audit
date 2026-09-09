---
title: 'Story 4.2: Sign in to LoanCore and enforce read-only, allowlisted actions'
type: 'feature'
created: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-loancore-authentication-decision.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-browser-provider-decision.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 4.1 gives a Run a workspace it cannot yet do anything in. Nothing signs in,
and nothing decides whether an action the agent is about to take is one this Procedure Version
permits. Until that decision exists, an agent-driven Target System cannot be executed at all —
which is why Epic 3 refuses one by name.

**Approach:** Make every Tool Action pass one gate before it happens. The gate reads the
version's FROZEN registration — its allowed origins and its permitted read actions — and denies
anything else BEFORE it reaches the Target System, recording the denial as a security event.
Sign-in is the first action to go through it.

## Boundaries & Constraints

**Always:** Every Tool Action is checked against the frozen registration before it executes: the
action must be one of the version's permitted READ actions, and its destination must be inside
the version's allowed origins. A write action, an out-of-scope origin, or an out-of-scope
parameter is DENIED before it reaches LoanCore and recorded as a security event (FR-3, AD-4).
The check reads the version's own frozen bytes, never a current registration and never a value
derived from anything the page said. Redirects, downloads, cancellation acknowledgement, timeout
accounting and trace ordering follow the `BrowserExecution` conformance contract, and every Tool
Action is logged with the SAME sanitized action schema Adapter Actions already use — one shape,
so a reader compares them rather than translating. Retrieved content cannot change the
objective, the permitted actions, the tool scope or the Compliance Rule for the remainder of the
Run (AD-9): a page is data, and there is no channel by which it becomes an instruction. Seeded
scope-widening language that survived authoring is denied at EXECUTION, independently of the
authoring-time flag, because the authoring warning is advisory and this is not.

**Block If:** The conformance contract cannot be satisfied for a behaviour the provider owns —
say which behaviour and why, rather than asserting the contract holds.

**Never:** Do not capture, register Observations, prove absence or raise Escalations — Stories
4.4 to 4.7. Do not let a denial be reported as a transport failure: Epic 3 already paid for that
mistake, retrying three times against a system that would go on refusing while the only durable
record was a transport count. Do not read the credential in this story's own code — it arrives
through the port Story 4.3 owns, and this story must work with a resolved credential that has
no field holding a value.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign-in | The frozen registration for LoanCore | The agent signs in through the port; the session is in the workspace | Bounded retries, then `RUN_FAILED` |
| Permitted read action | An action the version permits, inside its origins | Executes; logged in the shared sanitized schema | — |
| Write action | Any mutating action | Denied before it leaves; security event | Never attempted |
| Out-of-scope origin | A destination outside the frozen origins | Denied before it leaves; security event | Never attempted |
| Out-of-scope parameter | A permitted action with a parameter outside scope | Denied; security event names the parameter | Never attempted |
| Seeded scope-widening text | Instruction text that reached execution | Denied at execution, independent of the authoring flag | Recorded as a security event |
| Retrieved content as instruction | A page containing directive-looking text | Treated as data; nothing about the Run changes | No channel exists |
| Server-chosen redirect | A 3xx to another origin | Not followed; denied and recorded | Never silently followed |
| Download offered | The site offers a file | Handled per the conformance contract, never executed | — |
| Sign-in fails | Bad response after bounded retries | Session Step exhaustion → `RUN_FAILED` | Distinguish denial from outage |

</intent-contract>

## Code Map

- `packages/application/src/runs/execution-ports.ts` — `BrowserExecution` from Story 4.1. The
  action gate belongs where the port is invoked, not inside the provider adapter, so a second
  provider cannot skip it.
- `packages/domain/src/registrations/target-system.ts` — the six-key frozen envelope, including
  `permitted_actions` and `allowed_origins`. The gate reads the VERSION's snapshot of these, and
  `packages/domain/src/procedures/` holds that snapshot. A Draft never reads the registration
  table directly (AD-2), and neither does a Run.
- `packages/domain/src/procedures/scope-widening.ts` — `scopeWideningWarnings` is the AUTHORING
  check and is advisory by contract (FR-8). This story's execution denial is a different thing
  with a different consequence; do not reuse the advisory function as the enforcement point, and
  do not make the advisory one refuse.
- `packages/infrastructure/src/runs/adapter-extraction-http.ts` — how Epic 3 classifies a
  refusal: `denied` for a 401/403 and `scope` for a redirect, both terminal, both raising
  `security.action-denied` through `runStopFor(cause).securityEvent`. Use the same vocabulary
  and the same event rather than inventing a parallel one.
- `packages/domain/src/runs/limits.ts` — `action-denied` and `scope-violation` are already stop
  causes mapping to `RUN_FAILED` with a security event. They were written for this.
- `packages/domain/src/audit-event.ts` — `FORBIDDEN_PAYLOAD_KEYS` refuses credential-shaped
  keys outright. Check that list before adding any payload field that names a credential.
- `apps/northstar/src/` — `[REVISED 2026-09-06]` LoanCore has a real sign-in FORM. This entry
  first said the audit account was ALREADY SIGNED IN because a sign-in is a POST and every
  synthetic system refused one at the system level; the owner corrected that rule, so the guard
  refuses only what a route has not declared non-mutating and `POST /loancore/sign-in` is
  declared. The sign-in Session Step submits that form. It is still the most likely place to
  write a test that cannot fail: a suite asserting only refusals passes against a guard that
  refuses everything, sign-in included, so assert BOTH directions.

## Tasks & Acceptance

**Execution:**
- The action gate, in the application layer at the port's call site, reading the frozen version
  snapshot only.
- The sign-in Session Step, through `BrowserExecution`, under the Session Step retry budget.
- Request interception denying every destination outside the frozen origins, reporting each
  denial rather than dropping it.
- The shared sanitized Tool Action log shape, identical to the Adapter Action one.
- Tests — domain tests for the gate over permitted/forbidden actions and origins; application
  tests for the denial path and its security event; integration tests against real PostgreSQL
  that the event is in the chain; and a browser-level test driving the real synthetic system.

**Acceptance Criteria:**
- Given the frozen registration, when the agent performs the sign-in Session Step, then only the
  version's permitted read actions may be invoked and only inside its allowed origins.
- Given a write action, an out-of-scope origin or an out-of-scope parameter, when the agent
  attempts it, then it is denied before it reaches the Target System and logged as a security
  event.
- Given seeded scope-widening language that reached execution, when the agent acts on it, then
  the action is denied at execution independently of the authoring-time flag.
- Given retrieved content containing directive text, when the Run continues, then the objective,
  the permitted actions, the tool scope and the Compliance Rule are unchanged.
- Given any Tool Action, when it executes, then it is logged in the same sanitized schema as an
  Adapter Action, and redirects, downloads, cancellation, timeouts and trace ordering follow the
  conformance contract.

## Spec Change Log

## Review Triage Log

## Design Notes

**The gate lives at the call site, not in the adapter.** A provider adapter that enforced its
own allowlist would make the guarantee a property of that adapter, and the whole point of the
port is that the provider can be replaced. Put it where every implementation must pass through
it — the containment shape this codebase uses everywhere: the correct path is the only reachable
one, rather than the one everybody remembers to take.

**A denial and an outage are different words.** Epic 3's most expensive small defect was a
refusal reported as a transport failure. `denied` and `scope` already exist as causes, already
map to `RUN_FAILED`, and already carry the security event. Reuse them.

**The authoring warning and the execution denial are deliberately not the same mechanism.**
FR-8 makes the authoring check advisory — it flags and never refuses, because an auditor must be
able to save prose a checker misreads. Execution is where it becomes a refusal. If they shared
an implementation, making one strict would silently make the other strict too, and a false
positive would then block a save.

**LoanCore signs in through a REAL FORM, and the read-only rule refuses mutation rather than
methods.** `[REVISED 2026-09-06]` This section first said LoanCore had no sign-in form and that
the story added an `Authorization` header on a GET, because `enforceReadOnly` refused every
method but GET and HEAD. The owner overturned that rule: *read-only means no mutation of audited
business data; it should not force a specially invented GET-only sign-in solely to satisfy an
earlier fixture rule.* The revised decision is `epic-4-loancore-authentication-decision.md` and
is NOT an open question.

The system-level guard keeps every property it had — one rule, applied once, above routing;
fail-closed by declaration; a write to a path no route serves refused rather than 404'd; a JSON
denial naming FR-3 — and only its predicate changes, to "is this a declared non-mutating
operation?". `POST /loancore/sign-in` is declared non-mutating on its own route, because it
creates a SESSION and no audited business data, which is what FR-3 constrains. `/loancore`
serves the form to a caller with no session, so the frozen allowed origin IS the sign-in
destination and nothing guesses a path; every other `/loancore` path answers **401** with a
`WWW-Authenticate` challenge naming the form and a JSON body in the shape the 405 denial already
uses.

A `method="get"` form is still rejected categorically: it puts the credential in the URL, in
history, in the Referer header and in every access log, which is the defect this repository has
shipped three times and now has `form-method.test.ts` against. The form is `method="post"`, and
the workspace's sign-in mechanism REFUSES to type into a form that declares anything else.
Leaving LoanCore unauthenticated was rejected because Story 4.11 then asserts that no credential
reaches an artifact against a system that has no credential at all. Leaving the header sign-in
beside the form was rejected too: it would make the form decorative, and every test would pass
with the form deleted.

**So the sign-in Session Step is proved by the SESSION BEING ESTABLISHED**: the credential
resolved through the port and typed into the system's own form, the retrieval audited by Target
System and never by reference, a 401 before and a session after, and the session held in the
workspace. The credential is SYNTHETIC and lives in the fixtures — Story 1.8's rule that a REAL
credential is the one thing this environment must not have is unchanged, and is exactly why.

**Update CLAUDE.md's Story 1.8 and Story 4.2 notes in the same commit**, with the reason. Both
described the method rule and the headerless sign-in it forced.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: all pass against PostgreSQL 18.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no
  accessibility violations.

## Auto Run Result

**Status: implemented and verified against a real PostgreSQL 18, a real Chromium and the
real synthetic Northstar process.** Figures below are runs I executed; nothing is reported
that I did not see.

### What was built

**The gate — `packages/domain/src/runs/tool-action.ts`.** `authorizeToolAction(scope,
request)` reads the version's FROZEN snapshot and nothing else, in a fixed order: the
action against `permitted_actions`, the destination against `allowed_origins`, then every
parameter VALUE against the Run's frozen population. First refusal wins. The closed denial
vocabulary is `action-not-permitted`, `destination-refused`, `origin-not-allowed`,
`parameter-out-of-scope`, and `stopCauseForDenial` maps it onto §E.1's `action-denied` /
`scope-violation` — both terminal, both with a security event.

**It is invoked at the port's CALL SITE, not in the adapter.** `performToolAction` in
`packages/application/src/runs/execute-agent-steps.ts` is the only path from a stage to
`BrowserExecution.perform`; it gates first and records the sanitized action either way. The
workspace's request interception (Story 4.1) is the second boundary, and
`tests/integration/agent-execution.test.ts` calls the port DIRECTLY with the gate bypassed
to prove the second one exists.

**The origin rule now has one home.** `withinFrozenOrigin` is in the domain, over STRINGS,
because `packages/domain` and `packages/application` have no `URL` (AD-11);
`packages/infrastructure/src/runs/origin-policy.ts` became a `URL`-shaped delegation to it,
so the adapter path, the browser egress interception and the gate all ask one function.
`safeDestination` is now a rendering of the domain's `sanitizeDestination`.

**The sign-in Session Step — `executeAgentSteps`.** One `sign-in` step per agent-driven
Target, in frozen order, after population acquisition and before any Work Item. The
credential reference comes from the frozen plan, is resolved through `CredentialResolver`,
is compared against the reference the resolver echoes, is presented on that ONE navigation
and withdrawn immediately. The destination is the frozen origin itself — no path is
guessed. Budget is `sessionStepAttemptBudget`, one cycle; a denial and an unresolvable
credential are terminal on the first attempt.

**`BrowserExecution.perform`** in `packages/infrastructure/src/runs/browser-execution.ts`:
one page per workspace, `acceptDownloads: false` with a counter, the credential set through
`page.setExtraHTTPHeaders` and cleared in the `finally`, and the workspace's own denial
COUNT read before and after so a refusal by the allowlist is reported as `scope` and never
as an outage.

**Generation 28**: `run_tool_action` (the shared sanitized log, one shape for both
surfaces), `run_agent_execution` (the phase's own checkpoint and recovery read), and
`run_session_step.action` — the ACQUIRED constraint required Evidence on every ACQUIRED
step, which is right for a Reference Source acquisition and refuses exactly the row a
successful sign-in writes.

**LoanCore gained authentication on GET**, above routing beside `enforceReadOnly`
(`apps/northstar/src/authentication.ts`). 401 with `WWW-Authenticate` and a JSON body in
the 405 denial's shape; a credentialed GET is answered and granted a session cookie. The
read-only rule is untouched: read-only runs FIRST, so a write is refused as a write with or
without the credential. The credential is invented and declared in
`fixtures/northstar/datasets/systems.json` beside its reference; the seed script, the
worker manifest and the synthetic server all read that one place.

### Decisions taken

1. **`acquirePopulation` had to change, or nothing could sign in.** It asserted
   `sessionSteps[0].action === 'acquire-population'` literally, and the compiler emits
   `create-workspace` FIRST for any agent plan — so every agent Run was `RUN_FAILED` before
   the workspace was even used. `populationSessionStep(plan)` in the domain is now where the
   compiler's ordering lives, as a POSITION check rather than a search, and it also refuses
   a `create-workspace` step on a plan with no agent-driven Target.
2. **A separate phase with its own checkpoint**, rather than extending the adapter stage or
   the workspace stage. The workspace stage runs BEFORE population acquisition and the
   adapter stage refuses an agent plan by name; a phase sharing either checkpoint would have
   to answer for a status it does not produce. Its retry is NOT propagated to the queue (the
   Story 3.3 rule) and it has its own recovery sweep; the adapter sweep now excludes a Run
   whose agent phase is unfinished.
3. **"Out-of-scope parameter" is judged against the Run's frozen POPULATION**, which is
   FR-3's own example ("a search outside the declared population"), not against a list of
   allowed parameter NAMES. A name allowlist would have had to guess how `Full name` relates
   to the `name` query key LoanCore actually serves, and would have been wrong about the real
   fixture. An empty scope denies every parameter, which is fail-closed.
4. **Story 4.2's sign-in carries no parameters**, so the first PRODUCTION caller of rule 3
   is Story 4.5. It is exercised by unit, application and integration tests today rather
   than left as a branch nothing runs; `performToolAction` is exported for exactly that.
5. **A successful sign-in still ends in `RUN_FAILED`**, because the record-level steps are
   Story 4.4 and `classifyPlanTargets` still refuses an agent plan BY NAME. That is asserted
   with its diagnostic (`agent-driven-target`) rather than hidden, and the sign-in survives
   it. Honest, and exactly where Story 4.4 takes over.
6. **A 401 from a Target System is recorded `performed` with `status: 401`**, not `denied`.
   The action happened and the system said no, which is a different fact from a gate refusal
   that never left. Both are terminal and both carry `security.action-denied`.

### Verified

| Gate | Result |
|---|---|
| `pnpm typecheck` (7 projects + root tests) | pass |
| `pnpm boundaries` | pass, 421 modules cruised (was 414) |
| `pnpm test` (alone) | **123 files, 2879 tests, all passed** |
| `pnpm db:migrate` | applied, `schemaVersion: 28` |
| `pnpm db:generate` | "No schema changes, nothing to migrate" — no drift |
| `pnpm test:integration` | **23 files, 359 tests, all passed** against PostgreSQL 18 at generation 28 |
| `pnpm build`, `pnpm --filter @intellifin/web build` | both pass |
| `pnpm test:e2e` | **128 passed (5.6m), zero accessibility violations** |

**Mutation-tested, not assumed.** Removing the gate from `performToolAction` fails 3
application tests; weakening the path-boundary rule to `startsWith` fails 3 domain and
scope-widening tests.

### Failures I hit and fixed

- The first full integration run had **3 failures**, all mine: `schema-compat` (its exact
  table list), `run-surfaces` (a raw `run_session_step` insert with no `action`), and
  `population` (the test that asserted an agent plan is REFUSED at acquisition — the
  behaviour this story deliberately changes).
- The first full browser run had **3 failures**, all in `northstar.spec.ts`: LoanCore
  surfaces that now require the credential. Fixed by presenting it, with the refusal itself
  asserted in the new spec rather than deleted.
- My own integration teardown missed `population_execution`, which left 14 Procedures and
  12 Runs behind across the failed runs. Fixed, and the leftovers removed by hand.
- `agent-sign-in.spec.ts` first asserted `run_workspace.status = 'OPEN'` after the Run had
  ended; the worker releases the workspace in its `finally`, so that was a race. It now
  asserts the Run HAD a workspace and which guarantee it was.

### Two defects my own review found after the suites were green

- **The credential rode `setExtraHTTPHeaders`**, which puts a header on every request the
  page makes until it is cleared — and the workspace's egress allowlist is the UNION of
  every web Target's frozen origins, so the moment a plan names two web systems the first
  one's credential would have reached the second. It is attached by the INTERCEPTION now,
  to the destination's own frozen origin only. Proven by mutation: removing the origin check
  makes the cross-origin sub-resource arrive with the header.
- **`perform` failed a Tool Action when any SUB-RESOURCE was denied.** It compared the
  workspace's denial count before and after a successful navigation — right for a navigation
  that was aborted, wrong for a page that merely referenced a font, a beacon or an image
  off-origin, and it reported `scope` for something the platform never attempted. Adding one
  `<img>` to the test server turned three passing tests red, which is how it was found. What
  is checked after a SUCCESSFUL navigation is now where the main document ended, against the
  workspace's own allowlist; the count still separates a refusal from an outage on the
  failure path, because Chromium reports both as an aborted navigation.
- One more, from the same pass: `allowed_origins` is a normalized SET and is SORTED, so a
  registration with two origins signs in at whichever sorts first. A test that added
  `/elsewhere` beside `/loancore` therefore signed in at `/elsewhere`, silently and
  correctly. Named in `CLAUDE.md` and in the contract.

### Not delivered, named

- **The Timeline does not render Tool Actions.** Story 3.11 anticipated the fourth level;
  this story writes the rows without rendering them, because a surface showing agent Tool
  Actions beside no Adapter Actions would be worse than none. The data is complete.
- **The adapter path writes no `run_tool_action` rows yet.** The spec's "the SAME sanitized
  action schema Adapter Actions already use" was not true of the codebase — no Adapter
  Action log existed. The shared shape is built and the `adapter` surface is in the CHECK;
  retrofitting Epic 3's stage was out of this story's scope and is named here instead of
  claimed.
- **Solari is still unexercised.** There is no `SOLARI_API_KEY` in this environment, so
  everything ran in the `local` mode — browser state isolated per Run, the worker process
  not isolated at all. Unchanged from Story 4.1 and recorded on every workspace row.
- **A desktop Target System fails its sign-in by name** (`desktop-unsupported`). LedgerDesk
  stays deferred.
