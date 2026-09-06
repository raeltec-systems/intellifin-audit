# Credential containment, version 1

Where a credential may be, where it may never be, and what happens to an artifact that
carries one anyway (Story 4.3, FR-20, AD-4). Normative for every later story in Epic 4 and
for every producer that registers Evidence.

## The one word that changed meaning

The spec says "suppress capture during **entry**". Entry is credential **USE**, not typing.
LoanCore authenticates a `GET` with an `Authorization` header and has no sign-in form —
every synthetic Northstar system refuses a POST above routing, and a `method="get"` form
would put the credential in the URL, in browser history, in the `Referer` header and in
every access log (`epic-4-loancore-authentication-decision.md`). There is therefore nothing
being typed to photograph.

What must have nowhere to land is the **request header and every artifact that could carry
it**: a network artifact, a Structural Snapshot, a screenshot, a frame. That is the
stronger guarantee, not the weaker one. If a later story adds a Target System that really
does have a form — a desktop application, say — the typing case JOINS this one; it does not
replace it.

## Where the value lives

`ResolvedCredential`, and nowhere else. It has a `reference` and three METHODS, and no
field holding a value:

| Member | What it does | What it returns |
|---|---|---|
| `authorize(headers)` | Writes the credential onto one outbound request | nothing |
| `redact(text)` | Removes every whole-value spelling of it from text | text without it |
| `discloses(bytes)` | Says whether these bytes carry it | a boolean |

`JSON.stringify` of one is `{"reference":"..."}`. The token lives in the closure
`resolvedCredential(reference, token)` captures, so there is nowhere for a checkpoint, an
audit payload, a Timeline event, a queue job, a log field or an error message to pick it up
from — the containment by SHAPE this codebase uses everywhere, and the fifth time it has
made the move (`CredentialCapabilityReport`, `ResolvedCredential`, `ExceptionFingerprinter`,
`WorkspaceRef`, this).

Neither new method widens what a holder can learn: `authorize` already writes the value into
any sink it is handed, so a method that REMOVES it from text and one that ANSWERS whether
bytes contain it add no capability. What they add is the ability to keep a credential out of
something the platform is about to keep for ever, without anything having to hold the value
to do it.

**A credential this build cannot scan for is never resolved at all.** `compileSecret` refuses
a value shorter than `MIN_SCANNED_SECRET` (12) — a four-character "secret" matches ordinary
text, so scanning for it would refuse almost every artifact, and lowering the bar to avoid
that would fail OPEN in the one guarantee this contract exists to give. The refusal is
reported as `contract`, which the stages already map to `credential-unresolved`: terminal on
the first attempt, because a manifest entry does not get longer by being asked for again.

## What counts as a disclosure

`packages/domain/src/runs/secret-redaction.ts`, over BYTES rather than over a decoded
document: a screenshot is not text and `decodePopulationUtf8` throws on the first byte
sequence that is not valid UTF-8. One rule reads a PNG, a PDF and a Structural Snapshot.

The **needle is encoded**, not the haystack decoded:

- the raw value;
- percent-encoded, HTML-escaped and JSON-string-escaped — all three are the identity on
  `[A-Za-z0-9._~-]`, so for a token spelled in those characters the raw form already covers
  them, and where a token carries `+`, `/` or `=` each is searched for separately;
- base64, standard and URL-safe, at **all three byte alignments**. That is the encoding a
  credential most plausibly reaches an artifact through — `Authorization: Basic`, a `data:`
  URL, a serialized HAR — and a value embedded in a larger base64 stream is encoded
  differently depending on whether it starts at offset 0, 1 or 2 modulo 3.

**What this does NOT catch, named rather than claimed away.** A value the artifact carries
compressed, encrypted, split across a line break, re-cased, or encoded in a form this module
does not know is not found. Detection is a wall against the paths a capture mechanism
actually produces; it is not a proof of absence, and the platform's first defence stays the
credential having nowhere to live at all.

## The guard a stage carries

`CredentialGuard` — `redact`, `discloses`, `held`. It holds resolved credentials, never
values, so serialising a guard still yields references alone.

**It is fed by wrapping the resolver, not by remembering.** `guardedCredentials(resolver)`
returns a resolver whose every answer is held, and each stage wraps ONCE at the top and
never keeps the unwrapped one. There is no "register this credential" step for a branch to
skip. `NO_CREDENTIALS` is the explicit "this stage has presented none" — the shape
`NO_CORROBORATION` and `NO_EVALUATION` already have, and for the same reason: an optional
seam defaulted inside a function would let a composition root register every artifact
unscanned for ever with nothing saying so.

The **population stage passes `NO_CREDENTIALS`, and that is the truth rather than a
convenience**: population acquisition runs BEFORE the sign-in and before any adapter
extraction, so at the moment its bytes are frozen the Run has resolved nothing to scan for.
Holding the plan's credentials there to scan for them anyway would mean resolving a secret
in a stage that must never have one.

## The registration wall

`freezeArtifact` takes the guard as a **required** argument, so every producer must decide
what it is scanning for, and the check runs **before anything is uploaded**:

```
scan → putIfAbsent → read back → compare size and digest → register
```

Before the upload rather than after the read-back, so that "nothing is stored" is literally
true rather than nearly true: the object store is immutable by design and an artifact that
reached it could not be taken back out.

**It is a REFUSAL and never a redaction.** Bytes a Target System served are Evidence, and
rewriting them to make them acceptable would be falsifying what a system answered. An
artifact this PLATFORM produced is redacted by its producer — through the same guard, before
it gets here — and if it still discloses a credential afterwards, that is a defect in the
redaction and it has to fail loudly rather than be quietly re-redacted.

`AcquisitionFailureCode` gains `credential`. It is not `integrity` — the bytes are exactly
what the system served and nothing is damaged — and it is not `contract`, because the system
honoured the contract; what happened is that the platform may not keep what it answered
with. The adapter stage records `extraction-credential-disclosed` /
`reference-credential-disclosed` and is TERMINAL for the unit on the first attempt: the same
bytes disclose the same credential every time, so seven more attempts against a live system
prove nothing and spend the Run's limits doing it (the `credential-unresolved` rule).

A Work Item failure never stops a Run. The reservation stays open, the seal abandons it, and
the Gate concludes the Run on the coverage that item never produced.

## Capture suppression

`BrowserToolAction` is a **union**, and the two arms are the whole mechanism:

- an action carrying a `credential` has **no `capture` field at all**, so asking for a
  Structural Snapshot, a screenshot or a frame while a credential is on the wire does not
  compile;
- an action carrying `credential: null` names what it captures, and today that is `[]`,
  written out rather than defaulted.

A structural type does not CONTAIN anything — TypeScript's excess-property check fires only
on a fresh literal assigned to an annotated type, and a caller that cast past the union
compiles — so `PlaywrightBrowserExecution.perform` refuses such a request as well, FIRST,
before the workspace is even looked up: it is a fact about the REQUEST rather than about the
workspace, and reporting it as `unavailable` because the browser happened to be gone would
name the wrong thing.

**`[NAMED, NOT BUILT]`: nothing in this build captures.** `BROWSER_CAPTURE_KINDS` is the
vocabulary and Story 4.4 is what implements the `web_tree` Structural Snapshot and the
screenshot. What is built here is that a credential-entry action can never ask for one.

## Suppression must not look like absence

A missing artifact with no explanation reads to an auditor as "nothing happened here", which
is the same defect class as a dash that reads as "fine", an empty Gate checklist that reads
as a passed control, and the sign-out that did nothing and looked like success.

So `run_tool_action` records it (generation 29):

| Column | Contract |
|---|---|
| `capture` | `PERMITTED` or `SUPPRESSED`, on EVERY row |
| `capture_suppression` | why, from a closed vocabulary of one (`credential-entry`), or NULL |

`run_tool_action_capture_suppressed` is ONE CHECK — `(capture='SUPPRESSED') =
(capture_suppression IS NOT NULL)` — because either half alone permits a row that reads as
the other: a SUPPRESSED row with no reason is a gap wearing a label, and a PERMITTED row with
a reason says capture was both allowed and refused. The same shape `run_tool_action_denied`
has.

The value is DERIVED by the platform from its own request (`captureStateFor` in the domain),
before the port is reached — never reported by a provider, because a fact a provider
reported is a fact a provider could get wrong.

**And the Timeline renders it.** The fourth level (`Session Step › Work Item › Step
Execution › Tool Action`) is read now rather than left as data: the action is there, and its
row says capture was suppressed and why. Collapsed under the Step Executions `<details>` by
default, because EXPERIENCE.md says "collapsed to Work Item rows by default" — a `<details>`,
so it opens with no JavaScript and is reachable by keyboard.

## Recorded destinations

`sanitizeDestination` strips the query and `user:pass@` and KEEPS the path, so a Target
System that put a token in a path segment — or a redirect that did — would otherwise put a
working credential into the immutable action log. `performToolAction` runs both the
requested destination and the location the navigation ENDED on through `guard.redact`. Same
doctrine one step along: a destination denied FOR carrying a credential must still be
recorded, and recorded without it.

## Audited by reference does not mean putting the reference in the payload

`FORBIDDEN_PAYLOAD_KEYS` refuses `credentialref`, `credentialreference` and `credref`
outright. The retrieval is audited by naming the **Target System**; the frozen plan's
`credentialReferences` entry for that system already says which reference was used. Check
that list before adding any payload key that sounds credential-shaped.

## What proves it

- `tests/unit/secret-redaction.test.ts` — the vectors are encoded by a DIFFERENT
  implementation (Node's `Buffer`, `encodeURIComponent`, `JSON.stringify`, a hand-written
  HTML escape) rather than by asking the module for its own forms and then looking for them.
  A test that seeds the value where the implementation already looks is a contract compared
  with a copy of itself. It asserts the negative half too: an ordinary artifact, a near
  miss, and the value's own SHA-256 are not disclosures.
- `packages/application/src/runs/credential-guard.test.ts` — the guard, and the wall.
- `tests/integration/adapter-execution.test.ts` and `agent-execution.test.ts` — the same,
  against a real PostgreSQL, a real Evidence store and the real stage; plus a synthetic
  system that redirects the sign-in to a path carrying the token.
- `tests/e2e/credential-containment.spec.ts` — the **seeded negative test**. A deliberately
  hostile synthetic surface, `/accessgate/credential-echo`, echoes the presented
  `Authorization` header into its own response body, and a real Run against the real worker,
  the real system, a real PostgreSQL and a real object store REFUSES to freeze it. That
  surface is bound by no Procedure this repository seeds, named in no expectation file and
  registered by no seed script; it invents no credential of its own, so this environment
  still holds none (NFR-13, and Story 1.8's rule).

Every guard above was proved by MUTATION: inverting the scan, removing the wall, making the
redaction the identity, removing the capture refusal, making every capture PERMITTED, and
having either stage keep its unwrapped resolver each fail a named test.
