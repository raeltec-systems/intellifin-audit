---
title: 'Epic 4 decision: how the agent signs in to a system that refuses POST'
type: 'decision'
created: '2026-09-06'
status: 'final'
---

# How the agent signs in to a system that refuses POST

**Taken in the main thread rather than left to an implementer, because it changes a decision
Story 1.8 recorded and touches an invariant that has its own test.** Flagged for the owner in the
Epic 4 report.

## The conflict

Story 4.2 is "Sign in to LoanCore". Story 4.3 supplies the credential just in time and suppresses
capture during entry. Both need a synthetic system that actually requires a credential.

LoanCore does not. Story 1.8 recorded why, and it was right at the time:

> **LoanCore has no sign-in form, deliberately.** A sign-in is a POST, and every Northstar system
> refuses a POST at the system level. The audit account is already signed in and the page says
> so. Registering the account, or a real credential, would be the one thing this environment
> must not have.

`enforceReadOnly` runs BEFORE routing in `apps/northstar/src/read-only.ts`, refuses any method
but `GET`/`HEAD` with a verbatim rule sentence, and `read-only.test.ts` walks the exported route
table so a route added later is covered the moment it exists. That is a system-level invariant
and it is not up for negotiation for one story's convenience.

## What was decided

**LoanCore gains authentication on GET, through an `Authorization` header. No form, no POST, no
relaxation of the read-only rule.**

- An unauthenticated `GET` to any `/loancore` path answers **401** with `WWW-Authenticate` and a
  JSON body, in the shape the 405 denial already uses — a refusal a Run must record should not
  need parsing out of a page.
- The agent's sign-in Session Step is a `GET` to LoanCore's session endpoint carrying the
  credential in the header. LoanCore answers with a session cookie. Every later `GET` carries the
  cookie, and the workspace holds it.
- The credential is a SYNTHETIC one, declared in the fixtures like every other synthetic value,
  and resolved through the Story 3.3 `CredentialResolver` port whose result has no field holding
  a value.

## Why not the alternatives

**Relax the read-only rule for one path.** Rejected. It breaks a system-level invariant with its
own test, for one route, and the invariant's whole point is that no route can forget it.

**A `method="get"` sign-in form.** Rejected categorically. A form with no method, or with `get`,
puts the credential in the URL, in browser history, in the Referer header and in every access
log. This repository has shipped that defect three times and now has `form-method.test.ts` to
stop it; adding it deliberately to a fixture is not a test, it is the defect.

**Leave LoanCore unauthenticated and prove the sign-in step some other way.** Rejected. The
credential path would then ship exercised only against a stub, and this project's own rule is
that a guard proven only against a stub is proven against the stub. Story 4.11 has to assert
that no credential reaches any artifact; with no credential in play, that assertion passes
against a system that has no protection at all.

## What this changes downstream

- **Story 4.2's sign-in Session Step is proved by the session being ESTABLISHED**: the credential
  resolved through the port, the retrieval audited by Target System and never by reference, a
  401 before it and a 200 after it, and the session held in the workspace. Not by "a form
  submitted", which there still is not.
- **Story 4.3's "capture during entry" becomes "capture during credential USE".** There is no
  typing, so the target of the suppression is the request header and any network artifact,
  Structural Snapshot, screenshot or frame that could carry it. That is a stronger guarantee
  than "do not screenshot while typing", not a weaker one, and it is the guarantee that matters:
  the credential must have nowhere to land, whatever the capture mechanism.
- **`apps/northstar` gains one middleware above routing, beside `enforceReadOnly`**, so
  authentication is a system-level property for the same reason read-only is. A route added
  later is authenticated before it is written.
- **The other synthetic systems stay unauthenticated.** Only LoanCore needs this, because only
  LoanCore is the browser-driven Target System of P-1. Adding it everywhere would make every
  Epic 3 adapter test carry a credential for no reason, and Epic 3's adapter path deliberately
  resolves its credential from the frozen registration rather than from a header this fixture
  invented.
- **Story 1.8's note in CLAUDE.md is superseded on this one point and must be updated in the
  same commit** as the change, with the reason. Its second sentence — that registering a REAL
  credential is the one thing this environment must not have — stands unchanged and is exactly
  why the credential here is synthetic and lives in the fixtures.
