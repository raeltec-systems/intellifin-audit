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

**"Entry" is credential USE, which is wider than typing and INCLUDES it — settled in
`epic-4-loancore-authentication-decision.md`.** `[REVISED 2026-09-06]` This note first read "not
typing", because LoanCore then authenticated by an `Authorization` header on a GET and had no
form: every synthetic system refused a POST above routing. The owner overturned that rule —
read-only means no mutation of audited business data, and a sign-in POST creates a session — so
LoanCore has a real form again and BOTH cases are live:

- **typed into a form**, by the agent sign-in, which navigates to the frozen origin, types the
  value into the system's own `<input type="password">` and submits a `POST`;
- **presented in a header**, by an adapter extraction, and echoed straight back by the
  deliberately hostile `/accessgate/credential-echo`.

The target of the suppression is therefore the form field, the request body, the request header
and every artifact that could carry any of them: a network artifact, a Structural Snapshot, a
screenshot, a frame. The credential must have nowhere to land, whatever the capture mechanism —
which is the guarantee this story built, and it is unchanged and undiminished by the form
arriving. So is everything else here: the resolver port whose result has no field holding a
value, the audit that names the Target System and never the reference, the redaction BEFORE
registration, and the artifact that FAILS registration rather than being stored. The Tool Action
still appears on the Timeline saying capture was suppressed, because a gap is something a reader
takes for nothing having happened.

The byte-level scanner covers both cases and none of it was removed. What the form ADDS is a
page with a working credential on it while the action runs, which is exactly the case the
original spec text meant, so the tests cover both rather than swapping one for the other.


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

**The synthetic environment has no real credential and must not gain one.** `[REVISED
2026-09-06]` This first read "LoanCore serves the audit account as already signed in"; it signs
in through its own form now, with an INVENTED credential declared in
`fixtures/northstar/datasets/systems.json`, so the rule is unchanged and the reason it is
satisfied is different: the value authenticates nothing outside this repository. The negative
test seeds a credential-shaped value into the capture path deliberately, rather than using a
real one — and the seeded value must be recognisable as synthetic under NFR-13.

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm boundaries`, `pnpm test` (alone) — expected: pass.
- `pnpm db:migrate` then `pnpm test:integration` — expected: all pass against PostgreSQL 18.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no
  accessibility violations.

## Auto Run Result

**Status:** delivered. Verified against a real PostgreSQL 18 at schema generation 29, a real
Chromium, the real worker process and the real synthetic Northstar systems. Not committed —
the owner gates and commits in the main thread.

### What was built

**1. The browser form of the same containment (`ResolvedCredential`).** The port gained two
METHODS and no field: `redact(text)` removes every whole-value spelling of the credential;
`discloses(bytes)` says whether bytes carry it. Neither returns the value, neither widens
what a holder can learn — `authorize` already writes the value into any sink it is handed —
and `JSON.stringify` of a resolved credential is still `{"reference":"..."}`. The forms are
compiled once inside the closure `resolvedCredential(reference, token)` captures.

**2. The scanner (`packages/domain/src/runs/secret-redaction.ts`).** Pure, over BYTES rather
than a decoded document, because a screenshot is not text and `decodePopulationUtf8` throws
on the first malformed sequence. The needle is encoded rather than the haystack decoded:
raw, percent-encoded, HTML-escaped, JSON-string-escaped, and base64 (standard and URL-safe)
at all three byte alignments — the encoding a credential most plausibly arrives in, inside a
`data:` URL, an `Authorization: Basic` header or a serialized HAR. What it does NOT catch —
compressed, encrypted, re-cased, split across a line break — is written into the module
rather than claimed away. A value under `MIN_SCANNED_SECRET` (12) is REFUSED rather than
given a scanner that never matches, which would fail open in the one guarantee it exists to
give.

**3. The guard, fed by wrapping the resolver.** `guardedCredentials(resolver)` returns a
resolver whose every answer is held by a `CredentialGuard`; each stage wraps once at the top
and never keeps the unwrapped one, so there is no "remember this credential" step for a
branch to skip. `NO_CREDENTIALS` is the explicit "this stage presented none".

**4. The registration wall.** `freezeArtifact` takes the guard as a REQUIRED argument and
scans BEFORE anything is uploaded, so "nothing is stored" is literal rather than nearly
true. It REFUSES (`AcquisitionFailureCode` gained `credential`) and never redacts: bytes a
Target System served are Evidence, and rewriting them would falsify what a system answered.
The adapter stage records `extraction-credential-disclosed` /
`reference-credential-disclosed`, terminal for the unit on the first attempt.

**5. Capture suppression, structurally.** `BrowserToolAction` is now a union whose
credential-carrying arm has no `capture` field at all, so asking for a Structural Snapshot,
a screenshot or a frame while a credential is on the wire does not compile; `perform`
refuses it at runtime as well, first, because a structural type does not CONTAIN anything.

**6. The suppression is RECORDED and RENDERED.** `run_tool_action` gained `capture` and
`capture_suppression` (generation 29) under one CHECK, and the Timeline's fourth level is
rendered: the Tool Action is on the Timeline, and its row says capture was suppressed and
why. Both destinations a Tool Action records — the requested one and the location the
navigation ended on — go through `guard.redact`, because `sanitizeDestination` keeps the
path.

**7. The seeded negative test.** `/accessgate/credential-echo`, a deliberately hostile
synthetic surface that echoes the presented `Authorization` header into its own response
body inside the same closed collection envelope every other endpoint serves. A real Run
against the real worker, the real system, a real PostgreSQL and a real object store refuses
to freeze it. It is bound by no Procedure this repository seeds, named in no expectation
file and registered by no seed script, and it invents no credential — so this environment
still holds none.

The whole rule is `docs/contracts/credential-containment-v1.md`; `tool-action-v1.md` and
`CLAUDE.md` were updated in the same change.

### Verified, with figures

| Gate | Result |
|---|---|
| `pnpm typecheck` (root, including `tests/`) | pass |
| `pnpm boundaries` | pass — 424 modules cruised, no violations |
| `pnpm test` (alone) | **2926 passed, 125 files**, 76s |
| `pnpm db:migrate` | generation 29 applied to PostgreSQL 18 |
| `pnpm test:integration` | **362 passed, 23 files**, 89s |
| `pnpm db:generate` | no drift |
| `pnpm build`, `pnpm --filter @intellifin/web build` | pass |
| `pnpm test:e2e` | **133 passed**, 5.6m, no WCAG 2.1 AA violation |

**The generation-29 backfill was exercised on real rows** before it was trusted: the
migrated table was empty here, so the statements were replayed in a scratch schema over two
Tool Actions, one under a `sign-in` Step Execution and one not. They became
`SUPPRESSED`/`credential-entry` and `PERMITTED`/NULL respectively, and the `SET NOT NULL`
and all three CHECKs then applied.

**Eight mutations, each caught by a named test.** The scanner always answering false (7
tests); the wall removed from `freezeArtifact` (3 tests); `redact` made the identity (4
tests); the capture refusal removed from `perform` (1 test); `captureStateFor` always
`PERMITTED` (2 tests); the agent stage keeping its unwrapped resolver (1 test); the adapter
stage keeping its unwrapped resolver (1 test); and — end to end, with a full rebuild — the
wall removed, which fails three of the four seeded negative tests in the browser suite
including "the credential is in NO object, NO row and NO log line". Files were copied aside
and restored from the copies, never `git checkout --`.

**Two browser failures were found and fixed during the run**, both in the new assertions
rather than in product code: the Timeline collapses everything below Work Item level into a
`<details>` (EXPERIENCE.md's "collapsed to Work Item rows by default"), so the spec has to
open it exactly as a reader does; the second failure was that one's shadow, because
Playwright restarts its worker after a failure and runs `afterAll` early.

### Decisions taken

1. **`redact` and `discloses` are two methods on the existing port, not a new port and not a
   field.** The spec said "extend that shape; do not add a second one that returns a value",
   and a method that answers a question about the value adds no capability `authorize` did
   not already have.
2. **The refusal is at `freezeArtifact` and covers EVERY producer**, including the Epic 3
   adapter path, which is where the guarantee is provable today. The Code Map asked for the
   check "where nothing can register without passing it".
3. **Redaction is the producer's step and refusal is the wall — two different layers, and
   `freezeArtifact` never redacts.** Rewriting bytes a Target System served to make them
   acceptable would falsify Evidence. The consequence, named: `redact` has no PRODUCTION
   caller on an artifact yet, because nothing captures until Story 4.4. Its live caller
   today is the recorded destination, which is a real hole it closes.
4. **The population stage passes `NO_CREDENTIALS`, and the reason is the ordering**, not
   convenience: it runs before the sign-in and before any extraction, so nothing has been
   resolved to scan for. Holding the plan's credentials there would mean resolving a secret
   in a stage that must never have one.
5. **A token shorter than 12 characters is refused at resolution, not at boot.** Refusing to
   boot would stop plan derivation, notification delivery and the heartbeat for a stage that
   could not run anyway — the PR 23 lesson.
6. **The Timeline's fourth level is rendered, which overturns Story 4.2's deferral.** 4.2
   left Tool Actions as data because agent rows beside no adapter rows would be "worse than
   none"; 4.3's acceptance text requires the action to be visible and to say its capture was
   suppressed, and a data-only guarantee is not that. The adapter path writing no rows is a
   gap already named rather than a new one. **Flagged for the owner** as a reversal of a
   recorded decision.
7. **`RunTimelineSessionStep` gained `action`, fixing a live defect**: every Session Step row
   said "Reference Source", which stopped being true when Story 4.2 wrote the first
   `sign-in` row.
8. **The hostile echo endpoint lives on AccessGate rather than in a new synthetic system.**
   A new system would need a `systems.json` entry, a service index, a count endpoint and a
   seed registration, all for one test; the route is covered by `read-only.test.ts` and
   `routes.test.ts` the moment it exists, because both walk the route table.

### Named, not done

- **`[NAMED, NOT BUILT]` Nothing in this build captures.** `BROWSER_CAPTURE_KINDS`
  (`structural-snapshot`, `screenshot`, `frame`) is the vocabulary and Story 4.4 owns the
  mechanism. What is built here is that a credential-entry action can never ask for one —
  the type does not permit it and the port refuses it — so the suppression is already
  structural when capture arrives rather than retrofitted around it.
- **The adapter path still writes no `run_tool_action` rows** (Story 4.2's named gap,
  unchanged). The Timeline's fourth level renders both surfaces identically; an adapter Run
  simply has none yet.
- **`verifySealedPackage` cannot scan for a credential and never will.** The Run is over, no
  credential is resolved, and there is nothing to scan for — impossible by construction
  rather than omitted.
- **Detection is not a proof of absence.** A value carried compressed, encrypted, re-cased or
  split across a line break is not found, and the unit suite asserts the split case FAILS to
  detect so that nobody later reads the scan as complete. The platform's first defence stays
  the credential having nowhere to live.
- **Under `local` mode the browser process's own out-of-band traffic is not policed**
  (Story 4.1's named limit, unchanged), so "the credential reaches nothing" is a claim about
  what this platform stores and records, not about the browser's internals.
