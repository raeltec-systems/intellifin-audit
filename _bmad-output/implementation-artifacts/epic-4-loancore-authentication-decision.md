---
title: 'Epic 4 decision: read-only means no mutation of business data'
type: 'decision'
created: '2026-09-06'
revised: '2026-09-06'
status: 'final'
supersedes: 'the first version of this document, which defended a GET-only sign-in'
---

# Read-only means no mutation of audited business data

> **Revised after owner review, and the first version was wrong.** It argued that because
> `enforceReadOnly` refuses every method but GET and HEAD, a sign-in had to be redesigned as an
> `Authorization` header on a GET. The owner's correction: *read-only means no mutation of
> audited business data; it should not force a specially invented GET-only sign-in solely to
> satisfy an earlier fixture rule.* That is right, and the error is recorded rather than
> deleted.

## What FR-3 actually requires

> Adapters and the Audit Agent can invoke only **allowlisted read operations** within the
> Procedure Version's Population Source and Target System scope.
>
> Consequences: **Write operations**, arbitrary code or shell execution outside the Agent
> Workspace sandbox, out-of-scope systems or origins, and out-of-scope parameters are denied
> and logged.

FR-3 constrains **what the platform may invoke**, and that is enforced by `authorizeToolAction`
against the registration's frozen `permitted_actions` — which for LoanCore are `navigate`,
`search`, `open-record`, `read-attribute` and `capture-screenshot`. None of them is a write, and
none can be added at execution time.

**Nothing in FR-3 says a Target System must refuse every non-GET.** Story 1.8 added that as a
second, independent guard — "so that FR-3 is enforced by the system as well as by the
registration's permitted-action allowlist" — which was a good instinct. My error was promoting
it from a helpful redundancy to the requirement itself, and then contorting a real capability
around it.

## The mistake in one line

**I used the HTTP method as a proxy for mutation.** They are not the same thing. A sign-in POST
creates a session; it mutates no audited business data. Refusing it protects nothing, and the
GET-with-header design I invented to get around my own rule made the fixture *less* like a real
Target System — which is the one thing a synthetic fixture must not be.

## What is decided now

**The system-level guard refuses MUTATION, not methods.** It keeps every property that made the
original rule good and drops the false equivalence:

- **Still one rule, applied ONCE, ABOVE routing**, so a route added by a later story cannot
  forget it.
- **Still fail-closed**: every `Route` declares itself, and the default is mutating. A new route
  is refused until it says otherwise, which is the same forcing function the method rule had.
- **Still refuses a write to a path no route serves**, because the rule runs before routing —
  "there is nothing here" and "this system does not accept that" stay different statements to a
  Run.
- **The denial still names FR-3 and is still JSON on every surface**, so a Run can record it
  without parsing a page.

What changes is the predicate: from *"is the method GET or HEAD?"* to *"is this a declared
non-mutating operation?"*. `POST /loancore/sign-in` is declared non-mutating and permitted.
Everything that would touch business data is refused exactly as before, and now for the reason
that is actually true.

## Consequences

- **LoanCore gets a real sign-in form.** A POST, with a body, like a real application. The
  `Authorization`-header-on-GET design is dropped.
- **Story 4.3's capture suppression recovers its original meaning AND keeps the wider one.**
  "Suppress capture during credential entry" now covers a real typed form again, while the
  byte-level scanner Story 4.3 built still covers headers, snapshots, screenshots and frames.
  Both cases now exist in the fixtures, which is what the spec anticipated before I narrowed it.
- **The read-only guarantee is not weakened.** It is enforced in two independent places, as it
  always was: the platform's own gate (`authorizeToolAction`, over frozen `permitted_actions`)
  and the system's guard. Only the second one's predicate becomes honest.
- **Story 1.8's real rule is untouched and is why the credential stays synthetic**: registering
  a REAL credential is the one thing this environment must not have.

## What I am NOT doing

**Not removing the system-level guard.** The owner corrected its predicate, not its existence,
and a fixture that enforces nothing would make Story 4.11's abuse tests prove less.

**Not permitting a non-mutating POST anywhere it is not declared.** The allowlist is per route
and explicit; there is no "POST is fine if it looks like a read" heuristic, because that is the
same category error one level down.
