---
title: 'Story 1.7: Register a Population Source binding'
type: 'feature'
created: '2026-09-02'
status: 'in-progress'
baseline_revision: '184ffa0'
baseline_commit: '184ffa0'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-register-a-target-system-with-a-read-only-credential.md'
deferred: []
---

<intent-contract>

## Intent

**Problem:** Nothing records where a population comes from, what shape it is declared to have, how its expected row count is declared independently of us, or which of its fields must be masked. Without that a Procedure cannot bind to a population, the Evidence Quality Gate has nothing to reconcile an acquisition against, and no Run can show that it tested every record it should have.

**Approach:** A `sources` domain module owning the binding vocabulary and a binding digest, an Administration surface to register and change bindings, and binding events published in the same transaction as the write. Story 1.6's shape, applied to the other half of what a Procedure Version freezes.

## Boundaries & Constraints

**Always:**
- The three binding kinds are `manual-upload`, `versioned-file` and `read-only-api` (FR-6). A `manual-upload` binding is marked upload-only and the surface says plainly that only a `once` Schedule may use it; the Builder enforces it in Epic 2 (AD-23).
- The declared-count mechanism is `cover-sheet`, `count-endpoint` or `none`. `none` is SAVEABLE and carries a visible warning that no Procedure can submit against the binding — a binding nobody can finish configuring is worse than one that says what is missing.
- The declared schema is a list of field names. Sensitive fields are a SUBSET of them; designating a field that is not in the schema is refused, because a mask over a field that does not exist masks nothing and reads as protection.
- The binding digest is SHA-256 over the RFC 8785 canonical JSON of exactly `{declared_count_mechanism, declared_schema, kind, location, sensitive_fields}`, computed by ONE domain function in the `sources` module and nowhere else. It uses the shared canonicalizer.
- A change to any of those five publishes `configuration.binding-changed` in the same unit of work as the write; a change to anything else publishes `configuration.binding-annotated`. Neither is optional and neither commits without the other half.
- The optimistic-concurrency token covers the WHOLE row, not the digest-bearing subset. Story 1.6 paid for that lesson.
- Every mutation is authorized through `requireAction('administration.sources.manage')` on the server, in the Server Action itself, before any input is read.
- When a Procedure Version references the binding, the confirmation carries EXPERIENCE.md's platform-authored-draft sentence, from `copy.ts`, rendered only above zero.
- A binding is never deleted; retirement is a status, so a version that froze a digest can still resolve it.

**Block If:**
- Delivering this requires the web process to fetch a population, contact a count endpoint, or hold a credential.
- Delivering this requires changing an approved requirement, an AD, or a pinned dependency major.

**Never:**
- No acquisition, no parsing, no upload handling, no snapshot. This story registers a BINDING; Epic 2 and the Adapters acquire against it. There is no file input on this surface.
- No inclusion rule. That is authored on the Procedure (FR-6), not on the binding.
- No Procedure, Procedure Version or Builder. This story publishes the event a later story turns into a platform-authored draft.
- No credential. A `read-only-api` binding names a location; the credential a Run uses comes from the Target System registration, and this surface must not become a second place a credential reference lives.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Versioned file binding | kind `versioned-file`, location, schema, `cover-sheet` | Stored; digest shown | Digest from the domain module alone |
| Read-only API binding | kind `read-only-api`, location, schema, `count-endpoint` | Stored; digest shown | Same five-key envelope for every kind |
| Manual upload binding | kind `manual-upload` | Stored and marked upload-only; the surface states the `once` restriction | The Builder enforces it in Epic 2 |
| No declared count | mechanism `none` | SAVED, with a visible warning naming the consequence | Not a refusal — a stated, visible limitation |
| Sensitive field not in the schema | `sensitiveFields` names a field the schema does not | Refused; nothing stored | A mask over nothing is not a mask |
| Digest-bearing change | Any of the five moves | Digest recomputed, `configuration.binding-changed` in the same transaction | Both commit or neither |
| Non-digest change | Display name, note or status moves | `configuration.binding-annotated`; digest unchanged | A rename and a retirement are both audited |
| Nothing moves | A save that changes no field | Nothing appended | An event per idle submit says a person changed nothing |
| Stale tab | Row changed since the page loaded | Refused with the Story 1.6 sentence | The token covers all ten fields |
| Non-administrator | Auditor requests the surface or invokes the action | Refused verbatim, audited, no binding data in the response | Hiding the link is never the control |
| Unstorable value | A lone surrogate in any stored string | Refused with a sentence | The canonicalizer refuses; the command translates |

</intent-contract>

## Code Map

Story 1.6 built every mechanism this story needs. Follow it, do not reinvent it:

- `packages/domain/src/registrations/target-system.ts` — the digest module to mirror. Explicit key-by-key projection, sets normalized before hashing, `canonicalJson` + `sha256Hex` from the domain.
- `packages/domain/src/canonical-json.ts` — the ONE canonicalizer. It refuses a lone surrogate and a non-finite number.
- `packages/application/src/registrations/register-target-system.ts` — the command shape: authorize, validate, then write and append inside one unit of work; `CommandRefused` thrown so a refusal rolls back; `registrationRowVersion` for optimistic concurrency; two event types.
- `packages/infrastructure/src/registrations/*` — the transaction-scoped writer and unit of work.
- `apps/web/app/administration/registrations/*` and `apps/web/src/admin/Registration*.tsx` — the surface, its Server Actions, its input bounding, and its confirmation dialog.
- `apps/web/src/design/copy.ts` — `registrationChangeWarning` already holds EXPERIENCE.md's platform-authored-draft sentence. Reuse it; do not retype it.
- `packages/infrastructure/src/db/compat.ts` — `SUPPORTED_SCHEMA_MAX` rises to 6 in the same commit as the migration.
- `tests/fixtures/registration-digest-golden.json` and `scripts/make-registration-digest-golden.py` — the independent-vector precedent. The binding digest gets its own, produced the same way.

## Tasks & Acceptance

**Execution:**
- `packages/domain/src/sources/population-source.ts` — the kinds, the declared-count mechanisms, the value types, and `bindingDigest(input)` over the exact five-key envelope.
- `packages/domain/src/sources/population-source.test.ts` — the digest against the independent vector; that every kind yields all five keys; that a non-digest field does not move it; that a sensitive field outside the schema is rejected.
- `tests/fixtures/binding-digest-golden.json` + `scripts/make-binding-digest-golden.py` — produced by Python `rfc8785` + `hashlib`, envelopes written by hand, `producer` asserted to start with `Python`.
- `packages/application/src/sources/ports.ts` — `BindingRepository`, `BindingWriter`, `SourcesUnitOfWorkContext`, and a `ReferencingProcedureCounter` reused or mirrored from registrations.
- `packages/application/src/sources/register-population-source.ts` — `registerPopulationSource`, `changePopulationSource`, `bindingRowVersion`, the refusal strings, and the two event types.
- Its `.test.ts` — the refusals, the two event types, the stale-row guard, the sensitive-field rule, and that a failed append leaves nothing written.
- `packages/infrastructure/src/db/schema.ts` + `drizzle/0006_*.sql` — `population_source_binding`, generation 6, with CHECK constraints for the kind, the mechanism, the status, the digest format, a non-empty declared schema, and `sensitive_fields <@ declared_schema`. Raise `SUPPORTED_SCHEMA_MAX`.
- `packages/infrastructure/src/sources/*.ts` — the Drizzle repository and the transaction-scoped unit of work.
- `apps/web/app/administration/sources/*` — the list, the create and edit surfaces, Server Actions authorizing for themselves and bounding their input.
- `apps/web/src/admin/BindingForm.tsx`, `BindingsPanel.tsx`, `BindingEditor.tsx`, `bindings.ts` — `method="post"`, `Object.hasOwn` on every label lookup, the routine dialog, the upload-only sentence, the missing-count warning.
- `tests/integration/sources.test.ts` — real PostgreSQL: atomicity both ways, the CHECK constraints asserted with raw SQL, and the stale-row guard exercised with one transaction held open.
- `tests/e2e/sources.spec.ts` — an administrator registers each kind and sees its digest; a binding with no declared count shows the warning; a manual upload says `once`; an Auditor is refused; axe finds no WCAG 2.1 AA violation.
- `CLAUDE.md` — record the binding digest's key set and the AD-2 note below.

**Acceptance Criteria:**
- Given a versioned-file or read-only-API binding, when it is saved, then location, declared schema, declared-count mechanism and sensitive fields are stored and the digest matches an independently produced golden vector.
- Given a binding with no declared-count mechanism, when it is saved, then it is stored AND the surface warns that no Procedure can submit against it.
- Given a manual-upload binding, when it is saved, then it is marked upload-only and the surface states that only a `once` Schedule may use it.
- Given a change to one of the five digest-bearing fields, when it is saved, then the digest is recomputed and `configuration.binding-changed` is published in the same transaction; any other change publishes `configuration.binding-annotated`; a change to nothing publishes nothing.
- Given a Procedure Version referencing the binding, when a change is confirmed, then EXPERIENCE.md's platform-authored-draft sentence appears, and never with a count of zero.
- Given an Auditor, when they request the surface or invoke either action, then they are refused verbatim, the refusal is audited, and no binding data reaches the browser.

## Spec Change Log

## Review Triage Log

## Design Notes

**AD-2 names the registration digest and not this one.** The spine fixes the six-key registration envelope by name; for the Population Source it says only that approval freezes the binding. This story therefore extends the mechanism by analogy rather than by citation: one domain function, an explicit key-by-key projection, an independently produced vector. It is recorded here so a later story reconciles the two deliberately instead of discovering that the codebase grew a second, differently-shaped freezing mechanism by accident.

**Why `sensitive_fields` is digest-bearing.** FR-6 lists location, schema and declared-count mechanism as what a version freezes, and masking is not among them. But FR-41 makes the masking designation part of the Population Source contract, and an approver who approved a version with `salary` masked has not approved one that shows it. Unmasking after approval would otherwise change what an approved Procedure displays with nothing minting a draft. The kind is in the envelope for the same reason: it decides the acquisition path.

**Why `none` is saveable.** The acceptance criterion says so, and it is right. An administrator registering a binding often does not yet know how the count will be declared; refusing the save means the binding does not exist and nobody can see what is missing. Saved-with-a-warning makes the gap visible on the surface where it can be closed.

**No credential here, deliberately.** A `read-only-api` binding names a location and nothing else. The credential a Run uses belongs to the Target System registration, which already proves it read-only. A credential field on this surface would be a second place a reference lives and a second place the read-only proof would have to be repeated.

## Verification

**Commands:**
- `pnpm typecheck` — clean, including `tests/**` now that the root config covers it.
- `pnpm boundaries` — clean.
- `pnpm test` — all pass, including the digest against the independent vector.
- `pnpm build && pnpm --filter @intellifin/web build` — both succeed.
- `pnpm db:generate` — exactly one generation-6 migration, `SUPPORTED_SCHEMA_MAX` raised in the same commit.
- `pnpm test:integration` — passes twice.
- `pnpm test:e2e` — passes twice, zero WCAG 2.1 AA violations.

**Manual checks:**
- Register one binding of each kind and confirm the three digests differ; change a display name and confirm the digest does not move.
