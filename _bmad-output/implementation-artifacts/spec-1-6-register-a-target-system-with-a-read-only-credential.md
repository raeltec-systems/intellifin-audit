---
title: 'Story 1.6: Register a Target System with a read-only credential'
type: 'feature'
created: '2026-09-02'
status: 'in-progress'
baseline_revision: '191ee1bfe1b7802b7ee4826d05a5362cc7d53ba0'
baseline_commit: '191ee1bfe1b7802b7ee4826d05a5362cc7d53ba0'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** Nothing records which systems the agent may read, what it may do there, or which credential it uses. Without that, an Auditor could bind a Procedure to anything, and no later story could freeze what a Run was allowed to touch.

**Approach:** Add a `registrations` domain module that owns the AD-2 registration digest and the read-only credential rule, an Administration surface to create and change registrations, and a `RegistrationChanged` event published in the same transaction as the change. Secrets never enter the web process, and connectivity is read from rows the worker writes.

## Boundaries & Constraints

**Always:**
- The `registrations` domain module is the **only** place the digest is computed: SHA-256 over the RFC 8785 canonical JSON of exactly `{kind, allowed_origins | application_identity, credential_ref, permitted_actions, attribute_label_patterns, secondary_key}` — those keys, no others, whether or not a value is empty.
- The canonicalizer is the one the audit chain already uses. It is shared, not reimplemented; a second RFC 8785 implementation would drift from the first and both would look right.
- The digest's golden vector is produced by a **non-TypeScript** implementation and checked in, exactly as `tests/fixtures/audit-chain-golden.json` was for the audit chain. A vector produced by the code under test proves nothing.
- A credential reference whose capability check reports write access is refused with the verbatim string `Audit credentials must be read-only.` and the attempt is audited.
- `CredentialProvider` never returns a secret to the web process. It answers a capability report and a reference; secret values live outside application data and never reach a log, an audit payload, a response body or the browser.
- A change to origin, application identity, credential reference, permitted actions, attribute label patterns or secondary key publishes `RegistrationChanged` in the same unit of work as the write, or neither happens.
- Every mutation is authorized through `requireAction('administration.registrations.manage')` on the server and confirmed with a routine dialog.
- The web process never probes a Target System. The connectivity column reads rows the worker writes (AD-10), and a dependency-cruiser rule makes reaching a probe module from `apps/` a build failure.
- A registration is never deleted while anything references it; retirement is a state, so the digest a Run froze stays resolvable.

**Block If:**
- Delivering this requires the web process to hold a secret or contact a Target System.
- Delivering this requires changing an approved requirement, an AD, or a pinned dependency major.

**Never:**
- No Population Source bindings — Story 1.7 owns those.
- No Procedure, Procedure Version, or Builder. This story publishes the event that a later story turns into a platform-authored draft; it does not create drafts.
- No secret storage, no vault integration, no credential rotation. The reference is opaque and the provider is behind a port.
- No worker probing loop: there is nothing to probe until the synthetic Northstar systems exist in Story 1.8. This story delivers the table, the read path, the empty state and the boundary guarantee.
- No write actions in `permitted_actions`, ever, for any kind.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register a web system | kind `web`, allowed origins, credential ref, read actions, label patterns | Stored; the digest appears in the table | Digest computed by the domain module alone |
| Register a desktop system | kind `desktop`, application identity instead of origins | Stored; the digest covers application identity in the origins slot | The envelope always has all six keys |
| Register an API or versioned file | kind `api` / `versioned-file` | Stored with the same six-key envelope | Same digest function for every kind |
| Write-capable credential | Capability check reports write access | Refused with `Audit credentials must be read-only.`; the attempt is audited; nothing is stored | The exact string, verbatim |
| Capability check unavailable | The provider cannot answer | Refused; nothing is stored | Fail closed: unproven read-only is not read-only |
| Secret handling | Any registration operation | No secret value in any response, log, audit payload or rendered page | The provider returns a report and a reference only |
| Change a digest-bearing field | Origin, identity, credential ref, actions, labels or secondary key changes | Digest recomputed, `RegistrationChanged` published in the same transaction | Both commit or neither |
| Change a non-digest field | A display name or note changes | Digest unchanged; no `RegistrationChanged` | The digest covers exactly six fields |
| Referenced by Procedures | A change while `n` Procedure Versions reference it | The confirmation warns that it creates a platform-authored draft for `n` Procedures and requires approval | `n` comes from a port; no Procedures exist yet, so it is 0 and the warning does not appear |
| Connectivity, never probed | No worker row for a registration | The column says so plainly | The web never probes to fill it |
| Non-administrator | Auditor requests the surface or invokes the action | Refused with the verbatim reason, audited, no registration data in the response | Hiding the link is never the control |

</intent-contract>

## Code Map

- `packages/domain/src/audit-event.ts:271` -- `canonicalize(value: JsonValue)` is the RFC 8785 implementation, currently **private**; only `canonicalizeAuditEvent` is exported. Export the primitive (as a shared `canonicalJson`) and have both the audit envelope and the registration digest use it. Two implementations would drift and both would look right.
- `packages/domain/src/audit-event.ts:293` -- `canonicalizeAuditEvent` shows the pattern: project the exact keys explicitly, then canonicalize. The registration digest does the same for its six.
- `tests/fixtures/audit-chain-golden.json` -- the precedent for an independently produced vector; CLAUDE.md records that it was made with Python `rfc8785` + `hashlib`. Do the same for the registration digest and say in the fixture how it was produced.
- `packages/domain/src/identity/roles.ts` -- `administration.registrations.manage` already exists and is administrator-only. No new policy.
- `packages/application/src/identity/manage-users.ts` -- the shape to copy: authorize first, then write and append inside one unit of work, with a refusal that cannot commit. Story 1.5 learned that a refusal returned from inside a transaction would commit; it throws and converts outside.
- `packages/infrastructure/src/identity/identity-unit-of-work.ts` -- the transaction-scoped context pattern; the registrations context extends it with its own writer.
- `packages/infrastructure/src/db/schema.ts` -- generation 4 is applied. New tables here are generation 5, and `SUPPORTED_SCHEMA_MAX` rises in the same commit or `schema-range.test.ts` fails.
- `apps/web/app/administration/page.tsx` -- the surface, currently users only. Registrations is a second section; the refusal branch is unchanged.
- `apps/web/app/administration/actions.ts` -- Server Actions authorize for themselves before reading input, and validate their shape at the boundary. Both rules are now in CLAUDE.md.
- `apps/web/src/design/{DataTable,ConfirmDialog,Banner}.tsx` -- the primitives. The registrations table follows the same rules; every mutation is a routine dialog.
- `.dependency-cruiser.cjs:92` -- `no-migrator-in-apps` is the reachability-rule precedent for keeping something out of `apps/`. Add the same shape for any probe module.
- `apps/web/src/form-method.test.ts` -- every form declares `method="post"`; a new form is covered automatically.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/canonical-json.ts` -- move the private canonicalizer here and export it; `audit-event.ts` imports it -- one RFC 8785 implementation, shared, so the two digests cannot disagree.
- `packages/domain/src/registrations/target-system.ts` -- the kinds, the permitted read actions, the value types, and `registrationDigest(input)` computing SHA-256 over the exact six-key canonical envelope -- AD-2 gives this module sole ownership of the digest.
- `packages/domain/src/registrations/target-system.test.ts` -- the digest against the independently produced golden vector; that every kind yields all six keys; that a changed non-digest field does not move it; and that a write action is rejected by the type, not only by a check.
- `tests/fixtures/registration-digest-golden.json` -- produced with a non-TypeScript RFC 8785 implementation, recording in the file how it was made.
- `packages/application/src/registrations/ports.ts` -- `RegistrationRepository`, `CredentialProvider` (a capability report and a reference, never a secret), and `ReferencingProcedureCounter` (returns 0 until Epic 2) -- the counter exists now so the warning is wired rather than invented later.
- `packages/application/src/registrations/register-target-system.ts` -- authorize, check the credential capability, refuse a write-capable or unproven credential with the verbatim string and audit the refusal, compute the digest, write, and publish `RegistrationChanged` on a digest-bearing change, all in one unit of work.
- `packages/application/src/registrations/register-target-system.test.ts` -- the refusal strings, the fail-closed unavailable-provider case, that a non-digest change publishes nothing, and that a failed append leaves nothing written.
- `packages/infrastructure/src/db/schema.ts` + `drizzle/0005_*.sql` -- `target_system_registration` and `target_system_probe`, generation 5, with `SUPPORTED_SCHEMA_MAX` raised in the same commit.
- `packages/infrastructure/src/registrations/*.ts` -- the Drizzle repository over the transaction handle, and the `CredentialProvider` adapter whose return type cannot carry a secret.
- `apps/web/app/administration/registrations/*` -- the list with the digest and connectivity columns, the create and edit forms, each Server Action authorizing for itself and validating its input shape.
- `apps/web/src/admin/RegistrationForm.tsx` -- the form, with `method="post"`, the routine dialog, and the referencing-Procedures warning rendered only when the count is above zero.
- `.dependency-cruiser.cjs` -- a reachability rule forbidding anything under `apps/` from reaching a Target System probe module -- AD-10 says the web never probes, so make it a build failure rather than a convention.
- `tests/unit/boundaries.test.ts` -- a case that plants the violation and asserts the new rule fires.
- `tests/integration/registrations.test.ts` -- against real PostgreSQL: a digest-bearing change writes the registration and its event atomically; a non-digest change writes neither event; a write-capable credential stores nothing; and a forced append failure leaves the table untouched.
- `tests/e2e/registrations.spec.ts` -- an administrator registers a system and sees its digest; the write-capable refusal shows the verbatim sentence; an Auditor is refused; axe finds no WCAG 2.1 AA violation.
- `CLAUDE.md` -- record that the canonicalizer is shared and that the registrations module alone computes the digest.

**Acceptance Criteria:**
- Given any of the four kinds, when a registration is saved, then the digest is SHA-256 over the RFC 8785 canonical JSON of exactly the six named keys, and it matches an independently produced golden vector.
- Given a credential whose capability check reports write access, or cannot be checked, when a save is attempted, then it is refused with `Audit credentials must be read-only.`, the attempt is audited, and nothing is stored.
- Given any registration operation, when it completes or fails, then no secret value appears in a response, a log, an audit payload or the rendered page.
- Given a change to one of the six digest-bearing fields, when it is saved, then the digest is recomputed and `RegistrationChanged` is published in the same transaction; a change to any other field publishes nothing.
- Given `apps/` code, when `pnpm boundaries` runs, then reaching a Target System probe module is a violation.
- Given a registration the worker has never probed, when the list renders, then the connectivity column says so and the web made no outbound call.

## Spec Change Log

**2026-09-02 — A non-digest change is audited after all.** The spec said, in three
places, that a change to a field outside the six "publishes nothing". That was written
about `RegistrationChanged`, whose only consumer is Epic 2's draft minting. Taken
literally it left a real hole: renaming — or RETIRING — a registration wrote a row and
appended no audit event at all, so a configuration change reached the database with
nothing in the chain naming who made it. FR-45 records configuration activity, and a
retirement is exactly the change an independent reviewer would ask about.

The fix keeps both properties. A non-digest change now appends
`configuration.registration-annotated`, an event type Epic 2 does not read and therefore
cannot mint a draft from; `RegistrationChanged` stays reserved for the six. A save that
moves one of the six AND a display name carries both halves in the one event
(`changedFields` and `annotatedFields`), because it is one change. A save that moves
nothing at all still appends nothing: an event per idle submit would fill the chain with
entries saying a person changed nothing.

This was raised by the implementer against the spec, not found in review. The spec was
wrong; the code is right.

## Review Triage Log

## Design Notes

**One canonicalizer, two digests.** `canonicalize` is already implemented and already proven against an independent vector for the audit chain. The registration digest needs the same function over a different envelope. Copying it would create two implementations that agree today and diverge on the first edge case — an escaped surrogate, a `-0`, a large integer — and both would look correct in isolation. It moves to its own module and both callers import it.

**Why the golden vector must come from elsewhere.** The audit chain's fixture was produced with Python `rfc8785` and `hashlib` precisely so that a mistake in our canonicalizer could not hide behind a fixture our canonicalizer produced. The registration digest is the value that later freezes what a Run was allowed to touch, so it gets the same treatment. This is the same lesson as "never assert a contract against a copy of itself", applied to a hash.

**Fail closed on the capability check.** A credential that cannot be checked is not a credential proven read-only. The refusal is the same for "reports write access" and "cannot be determined", because from the auditor's position they carry the same risk, and a story that treats "unknown" as "safe" is how a write-capable credential reaches production.

**The referencing count is wired, not invented.** The confirmation warning names `n` Procedures. No Procedure exists until Epic 2, so `ReferencingProcedureCounter` returns 0 and the warning does not render. It exists now so that the surface gains the behaviour the moment Procedures do, and the test drives it with a fake reporting a non-zero count. Rendering "for 0 Procedures" would be a sentence that cannot be true.

`[ASSUMPTION]` No worker probing loop. AD-10 fixes the direction — the worker writes, the web reads — and this story delivers the table, the read path and the boundary rule. There is nothing to probe until the synthetic Northstar systems arrive in Story 1.8, so the probe writer belongs there and the column shows a never-probed state until then.

## Verification

**Commands:**
- `pnpm typecheck` and `pnpm -r typecheck` -- expected: clean.
- `pnpm boundaries` -- expected: clean, and the new probe rule fires when planted.
- `pnpm test` -- expected: all pass, including the digest against the independent vector.
- `pnpm build && pnpm --filter @intellifin/web build` -- expected: both succeed.
- `pnpm db:generate` -- expected: exactly one generation-5 migration with `SUPPORTED_SCHEMA_MAX` raised in the same commit.
- `pnpm test:integration` -- expected: passes twice in a row.
- `pnpm test:e2e` -- expected: passes twice, zero WCAG 2.1 AA violations.

**Manual checks:**
- Register one system of each kind and confirm the four digests differ, then change a display name and confirm the digest does not move.
