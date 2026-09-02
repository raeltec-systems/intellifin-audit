---
title: Story 1.6 review — security, authorization and secret containment
lens: security, authorization, secret containment
date: 2026-09-02
---

# Story 1.6 — security lens

Scope reviewed (staged changes, baseline `2c692c3`):

- `packages/application/src/registrations/ports.ts`
- `packages/application/src/registrations/register-target-system.ts` and `register-target-system.test.ts`
- `packages/infrastructure/src/registrations/{credential-provider,index,probe,registration-repository,registrations-unit-of-work}.ts`
- `packages/infrastructure/src/config.ts` (the `CREDENTIAL_CAPABILITIES` addition only)
- `apps/web/app/administration/registrations/{page.tsx,actions.ts,actions.test.ts,[registrationId]/page.tsx}`

Supporting files read as evidence but **not** reviewed as scope: `apps/web/src/admin/*`,
`apps/web/src/server-session.ts`, `apps/web/src/require-role.ts`,
`packages/application/src/identity/authorize.ts`, `packages/domain/src/audit-event.ts`,
`packages/infrastructure/src/telemetry/{logger,sanitize}.ts`.

## Verdict

**No BLOCKER.** I found no path on which a secret reaches a log, an audit payload, an
HTTP response, the rendered HTML or the RSC payload; no Server Action that reads its
input before it authorizes; no branch that stores a credential which was not proven
read-only; no plain-object lookup keyed by request input; and no refusal that commits
partial work. Five SHOULD findings and six CONSIDER findings follow. The first two
SHOULDs are the ones I would fix before merge.

---

## SHOULD

### S-1 — `expectedDigest` is not a version token for the row it guards: a stale tab can silently revert a RETIREMENT

`packages/application/src/registrations/register-target-system.ts:497`
`apps/web/src/admin/RegistrationForm.tsx:143` (out of scope, cited as the only caller)

The specific attack named in the brief **is prevented**: a stale tab cannot produce a
`configuration.registration-changed` whose `priorDigest` the administrator never saw,
because the guard compares `before.digest` with the digest that tab rendered, read under
`SELECT … FOR UPDATE` inside the write transaction (`registration-repository.ts:191`).
That is correct and well built.

The gap is the other half of the row. The digest deliberately covers **six** fields
(`ports.ts:80-101` lists ten). `displayName`, `note` and `status` are outside it, and
they are exactly the fields the optimistic-concurrency token therefore cannot protect.

Failure scenario, two PoC Administrators (or one with two tabs):

1. `T0` — Admin A opens `/administration/registrations/<id>`. Status `active`, digest `D`.
2. `T1` — Admin B retires the same registration. Only `status` moved, so the digest is
   still `D`. `configuration.registration-annotated` is appended, correctly.
3. `T2` — Admin A edits the note in the stale tab and saves. The form posts
   `expectedDigest: D` (`RegistrationForm.tsx:143`) and `status: 'active'`, because that
   is what the tab rendered at `T0`.
4. `before.digest === D === input.expectedDigest`, so the guard at line 497 passes. The
   update writes `status: 'active'`. **The registration is un-retired**, and A had no
   idea a retirement existed.

Retirement is the control that stops a Target System being used, so this is a silent
revert of a security-relevant state by a caller who never saw it. It is auditable after
the fact — `changedNonDigestFields` reports `['note','status']` and the annotated event
is appended (line 516-533) — but nothing refuses it, and nothing tells either
administrator. The same applies to a rename.

Proposed patch — make the token cover the whole row rather than six-tenths of it. The
cheapest correct version reuses a value the row already has:

```ts
// ports.ts — RegistrationRecord gains the row's own version
readonly updatedAt: string;

// ChangeTargetSystemInput
/** The row version the surface rendered. Covers all ten fields, not the six. */
readonly expectedUpdatedAt: string;

// register-target-system.ts, inside the transaction, replacing the digest comparison
if (before.updatedAt !== input.expectedUpdatedAt) {
  throw new CommandRefused(REGISTRATION_REFUSALS.STALE_DIGEST);
}
```

`RegistrationEditor` already renders `registration.updatedAt` (line 75), so the surface
has the value. Keep the digest comparison as well if you want the refusal sentence to
stay accurate for the six; do not keep it *instead*. If you would rather not touch the
schema, hash the ten fields into a `rowVersion` in `toRecord` and compare that — the
point is that the concurrency token must cover every field the write replaces.

### S-2 — `RegistrationChanged` can be published with `priorDigest === newDigest`

`packages/application/src/registrations/register-target-system.ts:260`, `:264`, `:303-320`, `:505-511`

`toRecord` normalizes `permittedActions` with `[...new Set(...)].sort()` (line 263) but
normalizes `allowedOrigins` (line 260) and `attributeLabelPatterns` (line 264) with
`cleaned()` only — which trims and drops blanks and **does not deduplicate**. The domain
digest, by contrast, runs `normalizedSet` over both (`target-system.ts:138-142`), which
is duplicate-free. So the stored column and the digest input disagree about duplicates.

`changedDigestFields` compares the stored arrays, so:

1. An administrator types `https://a.invalid` twice into the origins textarea. The row
   stores `['https://a.invalid','https://a.invalid']`; the digest is computed over the
   one-element set.
2. Later they remove the duplicate. `same(before.allowedOrigins, after.allowedOrigins)`
   is false — the lengths differ — so `changed = ['allowedOrigins']`.
3. `changed.length > 0`, so the branch at line 544 appends
   `configuration.registration-changed` with `priorDigest === newDigest`.

Per this file's own contract (lines 48-55) that event is what Epic 2 turns into a
platform-authored draft for **every Procedure Version that froze the old digest** — for
a change that moved nothing the agent may touch. It is also an immutable event asserting
a transition that did not occur.

The code guards the converse and not this one: line 509 throws when
`changed.length === 0 && before.digest !== next.digest`, but nothing asserts
`changed.length > 0 ⇒ before.digest !== next.digest`. The existing test at
`register-target-system.test.ts:394` covers reordering, which `same()` handles, and not
duplication, which it does not.

Proposed patch, both halves:

```ts
// toRecord — store what the digest hashes
const setOf = (values: readonly string[]): string[] =>
  [...new Set(cleaned(values))].sort();
const allowedOrigins = kind === 'desktop' ? [] : setOf(fields.allowedOrigins);
const attributeLabelPatterns = setOf(fields.attributeLabelPatterns);

// after computing `changed`, inside the transaction
if (changed.length > 0 && before.digest === next.digest) {
  throw new Error('a digest-bearing field changed without moving the digest');
}
```

Add a test that saves `['https://a.invalid','https://a.invalid']` and then
`['https://a.invalid']` and asserts no event is appended.

### S-3 — the provider's echoed `credentialRef` is never compared with the reference asked about

`packages/application/src/registrations/register-target-system.ts:364`
`packages/application/src/registrations/ports.ts:37`

`CredentialCapabilityReport.credentialRef` is documented as "Echoed so a caller can match
the answer" (`ports.ts:37`). **No caller matches it.** `refuseUnlessReadOnly` reads
`report.capability` and discards the rest, so the read-only proof rests entirely on the
provider answering about the reference it was asked about.

`ManifestCredentialProvider` is a synchronous `Map.get` and cannot get this wrong, so
there is no live defect. The exposure arrives with the replacement the comments promise
("a real capability service replaces this class and nothing else changes",
`credential-provider.ts:19-20`): a provider that batches, caches by a normalized key, or
resolves an alias can return a report for `cred://dev-readonly` in answer to a query for
`cred://prod-write`, and the command accepts it as proof for the reference it stores.
The failure is silent and is the one direction that matters — write-capable accepted as
read-only.

Proposed patch, three lines at the point of use:

```ts
const reference = input.credentialRef;               // already trimmed by the caller
const report = await dependencies.credentials.describe(reference);
capability =
  report.credentialRef !== reference
    ? 'unknown'                                       // an answer about something else proves nothing
    : report.capability === 'read-only'
      ? 'read-only'
      : report.capability === 'write-capable'
        ? 'write-capable'
        : 'unknown';
```

The field then earns its place in the type. Add a test: a provider that echoes a
different reference is refused with `CREDENTIAL_NOT_READ_ONLY`.

### S-4 — no deadline on `credentials.describe`: a hanging provider hangs the Server Action

`packages/application/src/registrations/register-target-system.ts:364`

The brief asks about a provider that hangs. `await dependencies.credentials.describe(...)`
has no timeout, and neither the port (`ports.ts:49-51`) nor the command states one. The
storage side still fails closed — a promise that never settles never reaches
`insertRegistration` — so nothing unproven is stored. The cost is availability: every
`createRegistrationAction`/`changeRegistrationAction` invocation parks a Node request
handler and, since `dependencies()` has already been resolved but the unit of work has
not been opened, holds no PostgreSQL connection. A PoC Administrator can nonetheless
exhaust the process's concurrency with repeated submits, and there is no correlation-id
timeout log to say why.

Again: not reachable through `ManifestCredentialProvider`, reachable the day it is
replaced by anything that makes a network call — which is what the module comments say
is coming.

Proposed patch — put the deadline in the command, not in each provider, so it cannot be
forgotten by an implementer:

```ts
/** A capability check that has not answered in this long has not answered. */
export const CREDENTIAL_CHECK_TIMEOUT_MS = 5_000;

const withDeadline = async <T,>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('credential check timed out')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};
```

Wrap the `describe` call with it. The existing `catch` already maps a rejection to
`unknown`, so the refusal sentence and the audited refusal come for free.

### S-5 — the two-field guarantee is neither enforced by the type system nor covered by the test the comment names

`packages/application/src/registrations/ports.ts:30-40`
`packages/application/src/registrations/register-target-system.test.ts:502-513`

The brief asks whether `CredentialCapabilityReport` "cannot be widened by a structural
type". It can. Two things are claimed and neither holds:

1. **`ports.test.ts` does not exist.** `ls packages/application/src/registrations/`
   returns `ports.ts`, `register-target-system.ts`, `register-target-system.test.ts`.
   The comment at `ports.ts:33` — "`ports.test.ts` asserts the key set, so a third field
   cannot be added without somebody deciding to" — names a file that was never written.
2. **The test that does exist asserts a literal against itself.** Lines 502-513 build a
   two-key object inside the test and assert it has two keys. That is precisely the
   pattern CLAUDE.md forbids ("Never assert a contract against a copy of itself"). It
   would still pass if `CredentialCapabilityReport` grew a `secret` field tomorrow.

TypeScript's excess-property check fires only on a fresh object literal assigned
*directly* to an annotated type. A provider declared `implements CredentialProvider`
whose `describe` has an inferred return type is checked for assignability only, with no
freshness, so this compiles today:

```ts
class VaultCredentialProvider implements CredentialProvider {
  async describe(credentialRef: string) {
    const raw = await vault.lookup(credentialRef);   // { capability, token }
    return { credentialRef, capability: raw.capability, secret: raw.token };
  }
}
```

There is no live leak: `refuseUnlessReadOnly` destructures `report.capability` and never
logs, returns or audits `report`, and `classifyTelemetryError` (`sanitize.ts:97-108`)
emits only `error.name` and an `ErrnoException.code`. So the widened field goes nowhere
today. What is wrong is the claim — the containment is a property of *this* call site's
discipline, not of the type, and the comment tells the next author otherwise.

Proposed patch — make the call site enforce it, and write the test that was promised:

```ts
// register-target-system.ts — reconstruct the report rather than trusting its shape
const { credentialRef, capability: reported } = await dependencies.credentials.describe(reference);
```

and a real `ports.test.ts` that exercises a *hostile* provider:

```ts
it('ignores any field a provider adds beyond the two', async () => {
  const hostile: CredentialProvider = {
    async describe(credentialRef) {
      return { credentialRef, capability: 'read-only', secret: 'sk-live-hunter2' } as
        CredentialCapabilityReport;
    },
  };
  const test = harness({ credentials: hostile });
  await registerTargetSystem(test.dependencies, INPUT);
  expect(JSON.stringify(test.events)).not.toContain('sk-live-hunter2');
  expect(JSON.stringify(test.logLines)).not.toContain('sk-live-hunter2');
});
```

Either write that, or replace the comment at `ports.ts:30-34` with what is true: the
report is narrow by convention and the command reads one field from it.

---

## CONSIDER

### C-1 — the refusal event's `payload.registrationId` is unvalidated caller text

`register-target-system.ts:391`, `apps/web/app/administration/registrations/actions.ts:209`

`assertIdentifier`/`SAFE_ID_PATTERN` (`audit-event.ts:111`, `:236`) is applied to
`actor.id`, `sessionId`, `correlationId` and `aggregateId` — not to payload strings, which
only have to be JSON with no lone surrogates. `refuseUnlessReadOnly` puts
`input.registrationId` into the payload, and on the change path that value is whatever
the caller posted, bounded to 64 characters by `actions.ts:209` and matched against
nothing. A PoC Administrator can therefore write 64 arbitrary characters per refused
attempt into the immutable chain. Low severity — it needs the administration role, and
the chain is meant to record what people attempted — but the value is presented in
review as a registration id, and it may not be one. Validate it against `SAFE_ID_PATTERN`
at the action boundary, or record `registrationId: null` on the refusal path and let
`aggregateId` carry the id once it is known to exist.

### C-2 — the credential refusal is audited before the registration is known to exist

`register-target-system.ts:478`

On the change path `refuseUnlessReadOnly` runs before the transaction opens and therefore
before `findRegistration`. A submit naming a registration that does not exist, with a
credential the manifest does not know, appends `configuration.registration-refused`
against a non-existent registration and then answers `CREDENTIAL_NOT_READ_ONLY` rather
than `UNKNOWN_REGISTRATION`. Both effects are defensible (the credential really was
unproven), but the chain gains an event about nothing. Not worth restructuring the
transaction boundary for; worth a sentence in the module comment saying it is intended.

### C-3 — `expectedDigest` is optional, so the guard can be dropped by omission

`register-target-system.ts:158`, `:497`

`readonly expectedDigest?: string | undefined`, and `undefined` skips the check
entirely. The web action always supplies it and rejects a missing one with `MALFORMED`
(`actions.ts:212`), so there is no live bypass — but the command's own test at
`register-target-system.test.ts:427` already calls `changeTargetSystem` without it, which
is how an optional guard becomes an absent guard. Make it required and have the one
caller that genuinely has no baseline pass an explicit sentinel. (If S-1 is taken, this
folds into it.)

### C-4 — `kind` and `status` are shape-checked but not length-bounded

`apps/web/app/administration/registrations/actions.ts:96`, `:104`

Every other field goes through `boundedString`; these two are `typeof === 'string'` with
no ceiling. Both are rejected by `isTargetSystemKind`/`isRegistrationStatus` a few lines
later, so nothing long is stored — the cost is only the string Next has already parsed,
and Next's Server Action body limit caps that. Still, the file's stated rule is "Every
field is therefore checked for shape **and bounded for length** here" (lines 31-36), and
two fields are not. `boundedString(fields['kind'], 32)` costs nothing and makes the
comment true.

### C-5 — `isForbiddenPayloadKey` would not catch a payload key named `credentialRef`

`packages/domain/src/audit-event.ts:113-147`

The set holds `credential`/`credentials`, and the suffix regex requires the normalized
key to *end* in `credential`. `credentialRef` normalizes to `credentialref` and matches
neither. The code is right to omit the reference from every payload
(`register-target-system.ts:387-395`, asserted by the test at line 227), but that is
discipline, not a guard — the validator would accept it. Adding `credentialref` and
`credref` to `FORBIDDEN_PAYLOAD_KEYS` would turn the convention into a refusal. Out of
this review's scope (`audit-event.ts` is Story 1.2), noted because the containment claim
in scope leans on it.

### C-6 — `CREDENTIAL_CAPABILITIES` is not declared in `.railway/railway.ts`

A repository-wide grep finds the variable in `config.ts`, `config.test.ts`,
`bootstrap.ts`, `playwright.config.ts` and `tests/e2e/credentials.ts` — and nowhere under
`.railway/`. The direction is the safe one: an absent variable is an empty manifest and
every registration is refused (`config.ts:117-124`, `credentialCapabilityManifest`). But
the first production registration will be refused with `Audit credentials must be
read-only.`, which describes the credential rather than the deployment, and an operator
has no way to tell those apart from the surface. Declare it in `.railway/railway.ts`, and
consider logging once at boot when the manifest is empty (`telemetry.info` with
`configKeys`, which is already an allowlisted field).

---

## Checked and found correct

Recording these so a later reviewer does not re-derive them.

- **Server Action authorization (point 2).** `actions.ts` exports exactly two functions
  and both call `requireServerAction('administration.registrations.manage')` as their
  first statement, before any property of the argument is read (`:163`, `:205`). The
  helpers that would otherwise become POST endpoints — `dependencies`, `unavailable`,
  `boundedString`, `isRegistrationFormFields`, `toRegistrationFields` — are not exported.
  `actions.test.ts:126` pins the ordering with a body that fails every shape check and
  asserts the *role* refusal, so a refused caller learns nothing about the input contract.
  The command re-authorizes independently (`register-target-system.ts:408`, `:468`), so
  a future non-web caller is gated too.
- **Input validation at the boundary (point 2).** Shape and bounds are checked before the
  command (`actions.ts:91-106`), and the vocabulary is re-checked in
  `toRegistrationFields` (`:116-132`) — including `permittedActions`, where the
  TypeScript type is a comment and `['create-record']` would otherwise satisfy it. The
  command validates again (`validateRegistrationFields`) and the generation-5 CHECK
  constraints validate a third time. Three layers, each independent.
- **Fail-closed credential rule (point 3).** Provider throws → `catch` → `unknown`
  (`:371`). Provider returns `undefined` → `report.capability` raises a TypeError inside
  the same `try` → `unknown`. Provider returns a malformed `capability` → the ternary
  narrows anything that is not one of the two known strings to `unknown` (`:365-370`), so
  no unvalidated value reaches the audit payload. Absent manifest → empty `Map` →
  `unknown` (`config.ts` `credentialCapabilityManifest`, `credential-provider.ts:39`).
  Every one of those refuses with the verbatim `Audit credentials must be read-only.`
  and appends `configuration.registration-refused` in its **own** unit of work before the
  write transaction opens (`:379-397`) — the event commits while nothing is stored, which
  is the only ordering that satisfies both requirements. If that append itself fails, the
  exception propagates and the action answers `UNAVAILABLE` with nothing written. There
  is no branch on which an unproven credential is stored.
- **Secret containment (point 1).** No credential value exists anywhere in the reviewed
  code: the form collects a reference and has no password field, the port returns a
  reference and a verdict, and the manifest maps a reference to a verdict. The audit
  payloads carry `registrationId`, `displayName`, `kind`, digests and *field names*
  (`changedFields`, `annotatedFields`) — never a value. The telemetry path cannot leak
  either: `sanitizeTelemetryFields` is a 27-key allowlist (`sanitize.ts:1-31`),
  `classifyTelemetryError` emits only `error.name` and a matching `code`
  (`sanitize.ts:97-108`), and Pino is configured with `redact … remove: true`. `loadConfig`
  names offending keys and never values (`config.ts:183-204`). `runtime.config` is read
  only by `boot.ts` for logging and Sentry setup, never serialized to a client.
- **RSC payload.** `page.tsx` and `[registrationId]/page.tsx` pass full
  `TargetSystemRegistration` objects into client components, so `credentialRef`,
  `secondaryKey` and `digest` are in the Flight payload and the HTML. All three are
  non-secret by construction, and both pages are behind `requireServerAction`. Correct as
  designed; worth remembering if a genuinely sensitive field is ever added to that type.
- **A mis-pasted secret is refused, not stored.** If an operator pastes a real token into
  the credential-reference field, it will not be in the manifest, so it resolves to
  `unknown`, the save is refused, and the refusal event deliberately omits the reference
  (`:387-395`). The fail-closed manifest doubles as containment for the most likely human
  error on this surface. Good design; keep it.
- **Prototype-pollution lookups (point 4).** `ManifestCredentialProvider` uses
  `Map.get` (`credential-provider.ts:39`). `parseCredentialCapabilities` uses
  `Object.entries` and vocabulary-checks every value. `apps/web/src/admin/registrations.ts`
  guards all four label lookups with `Object.hasOwn`. `actions.ts` indexes only fixed
  literal keys, none of which exist on `Object.prototype`. `audit-event.ts:198-201`
  refuses a payload object whose prototype is neither `Object.prototype` nor `null`. No
  instance of the defect class.
- **Transactional refusals (point 6).** Every refusal raised after a write is `throw new
  CommandRefused(...)` inside the callback (`:496`, `:498`, `:510`) and converted outside
  it (`:575-578`), so PostgreSQL rolls back. No refusal is *returned* from inside
  `unitOfWork.execute`. `DrizzleRegistrationWriter` takes a `Transaction`, never a
  `Database` (`registration-repository.ts:181`), so there is no reachable writer outside
  the unit of work. `register-target-system.test.ts:234` and `:483` assert the rollback
  on a failing append for both commands.
- **Prior-digest integrity.** `findRegistration` on the writer selects `FOR UPDATE`
  (`registration-repository.ts:191`), so the digest an event names as prior is the one the
  write replaced, not one read a moment earlier on a pooled connection.
- **Authorization disclosure (point 7).** Both pages render the refusal branch **before**
  the lookup — `[registrationId]/page.tsx:37-44` returns before `await params`, so an
  Auditor cannot probe whether an id exists by watching the page differ. The refusal
  renders a static heading and the denial sentence: no table, no origin, no credential
  reference, no digest, no count. `metadata.title` is static on both. The actions return
  `decision.reason` and nothing else, and never reach `getRuntime()` on a refusal
  (asserted at `actions.test.ts:109`, `:123`, `:156`).
- **`registrationId` on create is server-generated** (`dependencies.ids.next()`, `:426`),
  so a caller cannot choose an id and overwrite an existing row through the create path.
- **Normalization is consistent between the check and the write.** The value passed to
  `describe` (`input.credentialRef.trim()`), the value the provider looks up (trimmed
  again), and the value `toRecord` stores (`:262`) are the same string. No TOCTOU between
  proving a reference and storing it.
- **AD-10 boundary.** `probe.ts` is outside both barrels (`registrations/index.ts:10-12`),
  has its own subpath export, and is covered by a dependency-cruiser rule — so the web
  process cannot make an outbound call to a Target System by refactor.
