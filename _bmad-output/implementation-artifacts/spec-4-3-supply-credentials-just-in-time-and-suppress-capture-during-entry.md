---
title: 'Story 4.3: Supply credentials just in time and suppress capture during entry'
type: 'feature'
created: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-loancore-authentication-decision.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 4.2 signs in, which means a secret is present in a browser for the first time
in this product's history — and this platform captures everything a Run sees. A Structural
Snapshot, a screenshot or a frame taken during credential entry would put a working credential
into immutable Evidence, where it can never be taken out again.

**Approach:** The credential is supplied at the moment it is needed and nowhere else, its
retrieval is audited without its value, and capture is SUPPRESSED for the duration of a
credential-entry Tool Action. Any artifact that nonetheless contains a credential-shaped value
FAILS registration rather than being stored, and a seeded negative test proves it.

## Boundaries & Constraints

**Always:** The credential is resolved just in time, from the opaque reference on the frozen
registration, through the resolver port whose result has NO field holding a value — a reference
and a method that sets a header or fills a field, so serialising it yields the reference alone
(FR-20, AD-4). Its retrieval is audited, naming the Target System and never the reference or the
secret, because the chain is immutable and anything credential-shaped that enters it can never
be removed. Capture is suppressed for a credential-entry Tool Action: no Structural Snapshot, no
screenshot, no frame. Any secret-typed input value is redacted from every captured artifact
BEFORE registration, and an artifact found to contain a credential value fails registration
rather than being stored. The Tool Action itself still appears on the Timeline — the action
happened and must be visible; only its content is withheld, and the Timeline says capture was
suppressed rather than showing a gap a reader would take for nothing having occurred.

**Block If:** Suppression cannot be guaranteed for a capture path the provider owns — say which
path and why, rather than asserting it is covered.

**Never:** Do not put a credential value, or a value derived from one, into a checkpoint, an
audit payload, a Timeline event, an Evidence artifact, a log line, an export or an error
message. Do not write a redaction that only removes values it was told about: the check must
catch a credential that reached an artifact by a path nobody predicted, because that is the case
that matters. Do not suppress the Tool Action itself, only its capture.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Just-in-time supply | The opaque reference on the frozen registration | Resolved at the sign-in Tool Action, not before | Unresolvable is terminal for the unit |
| Audited retrieval | A resolution | Audited, naming the Target System, never the reference or value | — |
| Credential-entry action | Typing a username or password | Capture suppressed; the action still appears on the Timeline | Marked suppressed, never a gap |
| Secret in an artifact | A captured artifact containing a credential value | Registration FAILS; nothing is stored | Loud, not silent |
| Redaction before registration | A secret-typed input in a snapshot | Redacted before the artifact is registered | — |
| Seeded negative test | A captured sign-in sequence | No credential-shaped value survives into any snapshot, screenshot, frame, log or export | Fails the build |
| Serialisation | The resolved credential passed to `JSON.stringify` | Yields the reference alone | By shape, not by discipline |
| Error path | A failure during sign-in | The message names no credential and no reference | — |

</intent-contract>

## Code Map

- `packages/application/src/runs/execution-ports.ts` — `CredentialResolver` and
  `ResolvedCredential` already exist from Epic 3 and already have the right shape: a reference
  and an `authorize(headers)` method, and NO field holding the token. This story adds the
  browser form of the same guarantee. Extend that shape; do not add a second one that returns a
  value.
- `packages/infrastructure/src/runs/credential-resolver.ts` and the `./credentials` subpath —
  composed only by the worker, with `no-credential-resolver-in-web` failing the build on an
  import from `apps/web`. A browser-facing resolver belongs behind the same wall.
- `packages/domain/src/audit-event.ts` — `FORBIDDEN_PAYLOAD_KEYS` refuses `credentialref`,
  `credentialreference` and `credref`. "Audited by reference" therefore CANNOT mean putting the
  reference in the payload; Epic 3 resolved this by naming the Target System instead, and the
  frozen plan already carries which reference that system uses.
- `packages/infrastructure/src/telemetry/sentry.ts` — `TELEMETRY_MESSAGES` and
  `TELEMETRY_FIELD_KEYS` are closed allowlists, and an undocumented field is dropped SILENTLY.
  A new log line needs a new entry, and the silence is exactly what would hide a leak.
- `packages/application/src/runs/evidence-package.ts` — `freezeArtifact` is where every artifact
  is verified and registered. The credential check belongs where nothing can register without
  passing it, not at each producer's call site.
- `tests/e2e/` and `fixtures/northstar/` — NFR-13's synthetic marker walk starts at the fixture
  root and subtracts an allowlist of tooling files, deliberately, so a new folder is covered the
  moment it exists. The seeded negative test for redaction belongs in that spirit: it must catch
  a path nobody listed.

## Tasks & Acceptance

**Execution:**
- The browser-facing credential supply, extending the existing containment-by-shape rather than
  returning a value.
- Capture suppression for credential-entry Tool Actions, with the action still on the Timeline
  and marked suppressed.
- Redaction before registration, and a registration refusal for any artifact containing a
  credential-shaped value.
- The seeded negative test, proving no credential survives into a snapshot, screenshot, frame,
  log line or export.
- Tests — domain and application tests for the shape and the refusal; an integration test that
  the retrieval event carries no reference; the negative test in the browser suite against a
  real captured sequence.

**Acceptance Criteria:**
- Given the opaque reference on the frozen registration, when the sign-in Tool Action needs it,
  then it is supplied just in time, its retrieval is audited without the value, and it never
  appears in Timeline, Evidence, logs or exports.
- Given a credential-entry Tool Action, when the platform captures, then capture is suppressed
  for that action and any secret-typed input is redacted from every artifact before registration.
- Given an artifact found to contain a credential value, when it is registered, then registration
  FAILS and nothing is stored.
- Given the seeded negative test, when it runs against a captured sign-in sequence, then no
  credential-shaped value survives anywhere, and the build fails if one does.

## Design Notes

**"Entry" is credential USE, not typing — settled in `epic-4-loancore-authentication-decision.md`.**
LoanCore authenticates by an `Authorization` header on GET, not by a form, because every
synthetic system refuses a POST above routing and a `method="get"` form would put the credential
in the URL. So there is no typing to suppress capture around, and the target of the suppression
is the REQUEST HEADER and every artifact that could carry it: a network artifact, a Structural
Snapshot, a screenshot, a frame. That is the stronger guarantee, not the weaker one — the
credential must have nowhere to land, whatever the capture mechanism, rather than merely not
being photographed while it is typed. Everything else in this story is unchanged: the resolver
port whose result has no field holding a value, the audit that names the Target System and never
the reference, the redaction BEFORE registration, and the artifact that FAILS registration
rather than being stored. The Tool Action still appears on the Timeline saying capture was
suppressed, because a gap is something a reader takes for nothing having happened.

If a later story adds a Target System that really does have a form — a desktop application, say —
the typing case joins this one; it does not replace it.


**Containment by shape, not by discipline.** This is the fourth time this codebase has made the
same move: the capability report has two fields so a secret has nowhere to travel; the resolved
credential closes over its token so serialising it yields the reference; the fingerprint key
reaches the evaluator as a port with no field holding it. Each works because the wrong thing is
UNREPRESENTABLE, not because every call site remembers. Do the same here.

**A redaction that only removes what it was told about proves nothing.** The interesting case is
a credential that reached an artifact by a path nobody predicted — a page that echoed it, a form
that serialised it into a URL, an error the site rendered. So the check runs over the artifact
as it will be stored, looking for the value, and REFUSES. A test that seeds the value where the
implementation already looks is a contract compared with a copy of itself.

**Suppression must not look like absence.** A missing snapshot with no explanation reads to an
auditor as "nothing happened here", which is the same defect class as a dash that reads as
"fine" and an empty Gate checklist that reads as a passed control. The Timeline says the action
occurred and that its capture was suppressed, and why.

**The synthetic environment has no real credential and must not gain one.** LoanCore serves the
audit account as already signed in precisely so this environment never holds a working secret.
So the negative test seeds a credential-shaped value into the capture path deliberately, rather
than using a real one — and the seeded value must be recognisable as synthetic under NFR-13.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: all pass against PostgreSQL 18.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no
  accessibility violations.

## Auto Run Result
