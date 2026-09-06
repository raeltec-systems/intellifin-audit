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
- `apps/northstar/src/` — LoanCore serves the audit account as ALREADY SIGNED IN, deliberately:
  a sign-in is a POST and every synthetic system refuses one at the system level. So this
  story's sign-in Session Step must be provable against a system that has no sign-in form. Say
  how you resolved that — it is the most likely place to write a test that cannot fail.

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

**LoanCore had no sign-in form, and this story adds authentication rather than a form.** The
decision is settled in `epic-4-loancore-authentication-decision.md` and is NOT an open question:
LoanCore gains an `Authorization` header on GET, above routing beside `enforceReadOnly`, so an
unauthenticated GET to any `/loancore` path answers **401** with `WWW-Authenticate` and a JSON
body in the shape the 405 denial already uses, and the sign-in Session Step is a GET carrying
the credential that returns a session cookie the workspace then holds.

The read-only rule is UNTOUCHED — no POST, no relaxation, no route exempted. A `method="get"`
form was rejected categorically: it puts the credential in the URL, in history, in the Referer
header and in every access log, which is the defect this repository has shipped three times and
now has `form-method.test.ts` against. Leaving LoanCore unauthenticated was rejected because
Story 4.11 then asserts that no credential reaches an artifact against a system that has no
credential at all.

**So the sign-in Session Step is proved by the SESSION BEING ESTABLISHED**: the credential
resolved through the port, the retrieval audited by Target System and never by reference, a 401
before and a 200 after, and the session held in the workspace. Never by "a form submitted",
which there still is not. The credential is SYNTHETIC and lives in the fixtures — Story 1.8's
rule that a REAL credential is the one thing this environment must not have is unchanged, and is
exactly why.

**Update CLAUDE.md's Story 1.8 note in the same commit**, with the reason. It currently says
LoanCore has no sign-in form because a sign-in is a POST; that is superseded on this one point.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: all pass against PostgreSQL 18.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no
  accessibility violations.

## Auto Run Result
