---
title: Story 1.6 review — the user-facing surface
lens: surface (markup, forms, accessibility, copy fidelity)
date: 2026-09-02
---

# Story 1.6 — surface review

Scope: `apps/web/src/admin/RegistrationForm.tsx`, `RegistrationEditor.tsx`,
`RegistrationsPanel.tsx`, `registrations.ts`; `apps/web/app/administration/registrations/**`;
`apps/web/app/administration/page.tsx`; `apps/web/app/globals.css`;
`apps/web/src/shell/breadcrumb-rules.ts` and its test; `tests/e2e/registrations.spec.ts`,
`tests/e2e/credentials.ts`, `playwright.config.ts`.

Baseline `2c692c3`, staged changes on `claude/codebase-architecture-overview-pv0nt7`.
No source file was modified by this review.

## What is right, said plainly

These were the five things I was sent to break, and four of them hold.

1. **No new JavaScript-only mutating control.** There is exactly one `<form>` in the new
   surface — `RegistrationForm.tsx:195` — and it carries `method="post"`. Every mutating
   control is that form's `type="submit"` button (`RegistrationForm.tsx:380`) or a button
   inside `ConfirmDialog`, which is the pattern Story 1.5 accepted and recorded. A
   submission that beats hydration POSTs the fields in a body to a page route with no POST
   handler, gets 405, and fails visibly — not silently, which was the sign-out defect.
   There is no `onClick`-only control anywhere in the four new components.
2. **`apps/web/src/form-method.test.ts` really does cover the new file.** `WEB_ROOT` is
   `apps/web/` and `sourceFiles` walks it recursively, so `src/admin/RegistrationForm.tsx`
   is in the `it.each(files)` list with no change needed. I confirmed the walk reaches
   `src/admin/`, that `.test.` files are the only exclusion, and that
   `declaresPostMethod` requires `post` rather than any method.
3. **`Audit credentials must be read-only.` is verbatim, to the character.**
   `packages/application/src/registrations/register-target-system.ts:101` and
   `tests/e2e/credentials.ts:30` both match EXPERIENCE.md:256 exactly, full stop included.
   See SHOULD-1 for the guard that is missing, not the string.
4. **"for 0 Procedures" cannot appear.** `RegistrationForm.tsx:180-185` builds the warning
   only when `referencingProcedures > 0`, the panel hard-codes `0`
   (`RegistrationsPanel.tsx:74`), the detail page asks the port
   (`[registrationId]/page.tsx:53`), and the browser spec asserts the negative
   (`registrations.spec.ts:109`). Singular and plural are both handled. This one is done
   properly.
5. **The never-probed connectivity cell is a real sentence.** "Never probed" plus
   `NEVER_PROBED_SENTENCE` — "No worker has observed this system yet. This page never
   contacts a Target System." (`registrations.ts:88`) — never a dash, never an empty cell.
   Its wording is ours, not the contract's, and it says why. See CONSIDER-1 for its
   repetition.

Also correct and worth recording so nobody re-checks: every control has a real label
(`htmlFor`/`id` from `useId`, implicit `<label>` on each checkbox, `<legend>` on the
fieldset); every hint is bound with `aria-describedby`; `ConfirmDialog` traps focus, marks
`#ls-app` inert, binds Escape to `document`, and restores focus to the invoker on close;
`aria-current="page"` is on the last breadcrumb; `subsectionLabel` is `Object.hasOwn`-guarded
and its test plants `constructor` and `toString`; every new class name has a rule in
`globals.css`.

---

## BLOCKER

### BLOCKER-1 — The platform-authored-draft warning is not the sentence the contract fixes, and nothing pins it

`apps/web/src/admin/RegistrationForm.tsx:180-185`

EXPERIENCE.md:177 states the sentence normatively and cites FR-14:

> Saving a Target System registration warns: "This change creates a platform-authored draft for {n} Procedures and requires approval."

The code writes:

```
` This creates a platform-authored draft for ${referencingProcedures} ${
  referencingProcedures === 1 ? 'Procedure' : 'Procedures'
}, which an Audit Manager must approve.`
```

Three deviations: "This creates" for "This change creates"; ", which an Audit Manager must
approve" for "and requires approval"; and the sentence is typed inline in a component
rather than in `apps/web/src/design/copy.ts`, which is the one place CLAUDE.md says
contract copy may live, guarded by `copy.test.ts` reading EXPERIENCE.md off disk.

**What a person would experience.** Nothing today — `referencingProcedures` is always 0, so
the string is unreachable. That is exactly why this is a blocker rather than a defect: the
sentence ships now, is checked by nothing, and the first time Epic 2 returns a non-zero
count an administrator is warned in words the contract does not authorise, on the one
dialog whose whole job is to state a consequence that reaches other people's approval
queues. Dead code is where copy drift hides, and this repository has already paid for
"a test comparing a file with itself proves only that the file agrees with itself".

**Proposed patch.** Move the sentence into `copy.ts` as a template with the count
substituted, and extend `copy.test.ts` to assert the template against EXPERIENCE.md:

```ts
// apps/web/src/design/copy.ts
/** EXPERIENCE.md → Per-surface states → Administration / Registration change (FR-14). */
export const REGISTRATION_DRAFT_WARNING = (n: number): string =>
  `This change creates a platform-authored draft for ${n} Procedures and requires approval.`;
/** The literal the contract writes, with its placeholder. Pinned by copy.test.ts. */
export const REGISTRATION_DRAFT_WARNING_TEMPLATE =
  'This change creates a platform-authored draft for {n} Procedures and requires approval.';
```

```ts
// apps/web/src/design/copy.test.ts
it('reproduces the registration draft warning from EXPERIENCE.md', () => {
  expect(experience).toContain(REGISTRATION_DRAFT_WARNING_TEMPLATE);
});
it('substitutes the count into the same sentence', () => {
  expect(REGISTRATION_DRAFT_WARNING(3)).toBe(
    REGISTRATION_DRAFT_WARNING_TEMPLATE.replace('{n}', '3'),
  );
});
```

and in `RegistrationForm.tsx`:

```tsx
const referencesWarning =
  referencingProcedures > 0 ? ` ${REGISTRATION_DRAFT_WARNING(referencingProcedures)}` : '';
```

The contract writes "Procedures" for every `{n}`, so drop the singular branch rather than
inventing a form the contract does not have; if the singular is wanted, it is a change to
EXPERIENCE.md first.

---

## SHOULD

### SHOULD-1 — The read-only refusal is verbatim but pinned against nothing on disk

`packages/application/src/registrations/register-target-system.ts:101`,
`tests/e2e/credentials.ts:30`, `packages/application/src/registrations/register-target-system.test.ts:198`

The string is correct today. It exists as three independent literals that must agree, and
none of them is compared with EXPERIENCE.md:256. This repository already built the guard
for exactly this shape of risk twice — `tests/unit/denial-strings.test.ts` reads the gating
table off disk, `copy.test.ts` reads both artifacts — and the one string Story 1.6's own
spec calls normative was left out of both.

**What a person would experience.** Today, nothing. After a reword by anyone who does not
know the string is normative, an administrator is told something FR-3 did not authorise, and
the whole suite stays green because the unit test, the browser test and the production
string were all retyped together.

**Proposed patch.** Add to `tests/unit/` beside `denial-strings.test.ts`:

```ts
import { REGISTRATION_REFUSALS } from '@intellifin/application';
// ...read EXPERIENCE.md as denial-strings.test.ts does...
it('reproduces the read-only refusal verbatim from EXPERIENCE.md', () => {
  expect(experience).toContain(`"${REGISTRATION_REFUSALS.CREDENTIAL_NOT_READ_ONLY}"`);
});
it('is the string the browser suite holds the surface to', () => {
  expect(READ_ONLY_REFUSAL).toBe(REGISTRATION_REFUSALS.CREDENTIAL_NOT_READ_ONLY);
});
```

The second assertion collapses `tests/e2e/credentials.ts:30` into the same string rather
than a fourth copy of it.

### SHOULD-2 — The registrations table omits the Credential reference column the contract lists

`apps/web/src/admin/RegistrationsPanel.tsx:92-142`

EXPERIENCE.md:101 fixes the columns:

> Administration registrations: System · Kind · Origin or application · Credential reference · Permitted actions · Registration digest · Connectivity.

The table renders System · Kind · Origin or application · **Permitted read actions** ·
**Status** · Registration digest · Connectivity. "Credential reference" is gone, "Permitted
actions" was renamed, and "Status" was added. The page's own prose
(`registrations/page.tsx:59-62`) and the table caption (`RegistrationsPanel.tsx:83`) both
list the columns as implemented, so the omission is self-consistent and invisible.

**What a person would experience.** A PoC Administrator scanning the list cannot see which
credential each system uses. The reference is not a secret — the whole design turns on that
— and it is the field the read-only rule is about, so the one column that says "which
credential is this system reading with" is the one missing. Finding it means opening each
registration in turn and reading it out of a form input.

Renaming to "Permitted read actions" and adding "Status" are defensible strengthenings
(retirement is a state, and only read actions exist); dropping a specified column is not,
and no comment records a decision.

**Proposed patch.** Restore the column between "Origin or application" and the actions
column, and align the caption:

```tsx
{
  key: 'credential',
  header: 'Credential reference',
  render: (row) => <span className="ls-mono">{row.credentialRef}</span>,
},
```

`credentialRef` is already on `TargetSystemRegistration` and already reaches the browser
through the edit form, so nothing new is exposed. If the omission is deliberate, record the
reason in the component doc comment and in the PRD/UX memlog, because a later reader will
otherwise restore it.

### SHOULD-3 — Two browser assertions cannot fail, including "nothing is registered until it is confirmed"

`tests/e2e/registrations.spec.ts:112-114`, `:143-145`, `:160-161`

Each of these asserts `toHaveCount(0)` for a row on a table that was rendered by the
`page.goto` at the top of the test, before the row could have existed. After a cancelled
dialog no action runs at all, so no re-render happens; after a refused action the command
returns before `revalidatePath`. In both cases the assertion is true no matter what the
server did.

**What a person would experience.** A regression in which the mutation fires on dialog
*open* rather than on confirm, or in which a write-capable credential is stored and only
then refused, ships with the suite green. The comments above these lines ("Nothing is
registered until it is confirmed", "Nothing was stored") describe a check the code does not
make.

**Proposed patch.** Reload before asserting the absence, so the claim is about the database
and not about a stale render:

```ts
await dialog.getByRole('button', { name: 'Cancel' }).click();
await expect(page.getByRole('dialog')).toHaveCount(0);
await page.reload();                                    // ask the server again
await expect(page.getByRole('rowheader', { name: systemName })).toHaveCount(0);
```

and the same two lines after each refusal, at `:145` and `:161`.

### SHOULD-4 — The "an origin change moves it" assertion matches the outcome it exists to exclude

`tests/e2e/registrations.spec.ts:187`

`await expect(page.getByRole('status')).toContainText('recorded in the audit chain')`.
Both messages built in `registrations/actions.ts:236-238` contain that phrase — the
`published` one and the `annotated` one. So the assertion passes whether or not
`configuration.registration-changed` was published, which is the single behaviour the test
is named after. The following digest comparison catches a digest that did not move, but not
a digest that moved without publishing the event.

**Proposed patch.** Assert the half that is unique to publication:

```ts
await expect(page.getByRole('status')).toContainText('The digest is now');
```

and, for the name-change case at `:179`, keep `'The digest did not change'` — that one is
already unique.

### SHOULD-5 — A 64-character digest is unusable to a screen-reader user, and one is read aloud in a live region

`apps/web/src/admin/RegistrationsPanel.tsx:119`, `RegistrationEditor.tsx:61`,
`apps/web/app/administration/registrations/actions.ts:184`

The digest is rendered as one 64-character run inside a `<span>`, with no alternative
presentation and no copy affordance. On success the surface additionally announces
`Registered X. Its digest is <64 hex characters>.` through a polite live region
(`Banner` → `role="status"`).

**What a person would experience.** A screen reader reads the run as a stream of syllables —
some of it as words, because hex spells `face`, `dead`, `beef` — with no pauses and no way
to slow it down. EXPERIENCE.md's floor requires long identifiers to wrap and Evidence values
never to be truncated, which the CSS honours, but the panel doc comment claims the full
value is shown because "it is the value an auditor compares", and a non-sighted auditor
cannot compare it. Worse, the success banner spends the announcement on the hash rather than
on the outcome, so the sentence that matters is buried behind sixty-four characters of noise.

**Proposed patch.** Two independent changes.

Drop the digest from the announcement — the table beside it already carries the value:

```ts
message: `Registered ${typed.displayName.trim()}. Its registration digest is shown in the table below.`,
```

and give the digest a grouped accessible name so it is read in eight-character chunks, while
the visible and copyable text stays exactly the 64 characters:

```tsx
// apps/web/src/admin/registrations.ts
/** Groups of eight, for an accessible name only. The visible text is never changed. */
export function spokenDigest(digest: string): string {
  return (digest.match(/.{1,8}/g) ?? [digest]).join(' ');
}
```

```tsx
<span className="ls-mono ls-digest" aria-label={`Registration digest ${spokenDigest(row.digest)}`}>
  {row.digest}
</span>
```

### SHOULD-6 — `.ls-definition dt` references a token that does not exist

`apps/web/app/globals.css:935`

```css
font-size: var(--font-size-sm, 0.875rem);
```

`--font-size-sm` is defined nowhere — `tokens.css` names type sizes `--type-<role>-font-size`
— so every reader gets the hardcoded `0.875rem` (14px). It is the only `--font-size-*`
reference in the whole stylesheet, and `tokens.test.ts` does not check that referenced
variables are defined, so nothing fails.

**What a person would experience.** The metadata labels on the registration detail page
render at body size instead of the caption size every other label in the product uses, and
at a value that is not in the token scale at all (the scale is 12/13/14px, in px). It reads
as a slightly different design language on one page. CLAUDE.md is explicit that token values
live in `tokens.css` and nowhere else.

**Proposed patch.** Use the pattern `.ls-dialog__field label` already uses at `:776-780`:

```css
.ls-definition dt {
  font-size: var(--type-caption-font-size);
  line-height: var(--type-caption-line-height);
  color: var(--color-text-secondary);
}
```

`text-secondary` rather than `text-muted` also removes the need to reason about which
surface the list happens to sit on. Worth adding to `tokens.test.ts` while you are there: a
check that every `var(--…)` used in `globals.css` is declared in `tokens.css` or in
`globals.css` itself, which would have caught this mechanically.

---

## CONSIDER

### CONSIDER-1 — "Never probed" and its sentence repeat on every row

`apps/web/src/admin/RegistrationsPanel.tsx:125-129`

The caption "No worker has observed this system yet. This page never contacts a Target
System." renders inside each connectivity cell. With the list limit at 200 that is 200
repetitions of the same 15 words, read aloud once per row. Say it once, above the table,
when every row is never-probed, and leave "Never probed" in the cell.

### CONSIDER-2 — The confirmation dialog never names the system

`apps/web/src/admin/RegistrationForm.tsx:393`

"Save this registration?" / "Register this Target System?" with a consequence that names no
system. On the detail page the `<h1>` behind the dialog carries the name, but `#ls-app` is
`inert` while the dialog is open, so a screen-reader user cannot go back and read it. Put
the display name in the title: `Save ${displayName}?` / `Register ${displayName}?`.

### CONSIDER-3 — `apps/web/src/admin/registrations.ts` has no unit test

Four `Object.hasOwn` guards, `linesToList` and `listToLines` are covered by nothing;
`vitest.config.ts` would pick up `apps/web/src/admin/registrations.test.ts` today. The file's
own comment says the inherited-property bug "has now appeared five times in this
repository", and the sibling change in `breadcrumb-rules.ts` got exactly such a test in this
same diff. Add one: `kindLabel('constructor')`, `actionLabel('toString')`,
`statusLabel('__proto__')`, `connectivityLabel('valueOf')` all returning `UNKNOWN_LABEL`,
and `linesToList(' a \n\n b ')` returning `['a','b']`.

### CONSIDER-4 — `shortDigest` is dead code and its comment contradicts it

`apps/web/src/admin/registrations.ts:122-125`

Nothing imports it. Its doc says "The first eight characters of a digest" and it returns
twelve. Delete it — the surface deliberately shows the digest in full, so a truncating
helper sitting in the module invites exactly the change the design rejects.

### CONSIDER-5 — The two textareas use `.ls-input`, not `.ls-textarea`

`apps/web/src/admin/RegistrationForm.tsx:252`, `:303`

They therefore miss `min-height: 88px` and `resize: vertical` (`globals.css:807-810`) and
default to `resize: both`, which lets a person drag them wider than the field grid. The
`rows` attribute covers the height; the resize axis is the real difference. Use
`className="ls-textarea"`, as `ConfirmDialog` does.

### CONSIDER-6 — The checkbox group is announced twice

`apps/web/src/admin/RegistrationForm.tsx:341-347`

`<fieldset>` takes its accessible name from `<legend>`, and the inner
`<div role="group" aria-labelledby={actionsId}>` names itself from the same legend — two
nested groups called "Permitted read actions". The `role="group"` is not needed; the
`<fieldset>` already is one. Drop the role and the `aria-labelledby`, and keep the div for
the grid. While there, the caption "Only read actions exist…" is not referenced by anything;
bind it with `aria-describedby` on the fieldset.

### CONSIDER-7 — A developer sentence can reach a user-facing Banner

`apps/web/src/admin/RegistrationForm.tsx:147`

`{ ok: false, reason: 'This form is not wired to an action.' }` is rendered in a danger
Banner if neither handler is supplied. Both call sites supply one, so it is unreachable —
but it is the only string in the surface that speaks to a developer. Make it a thrown
`Error` instead, so a wiring mistake fails at the boundary rather than becoming copy.

### CONSIDER-8 — A fourth copy of the failure sentence

`apps/web/src/admin/RegistrationForm.tsx:165` repeats
`'The change could not be saved. Nothing was changed.'`, which also lives at
`RoleControl.tsx:88`, `UserForm.tsx:82`, `administration/actions.ts:51` and
`administration/registrations/actions.ts:47`. Five literals that must agree. Export it once
(from `copy.ts`, alongside the note that it is ours and not the contract's — EXPERIENCE.md
writes "Couldn't {action}. Nothing was changed.") and import it.

### CONSIDER-9 — The detail page drops the observation time

`apps/web/src/admin/RegistrationEditor.tsx:65-71`

The list shows "Observed &lt;time&gt; UTC" under a reachable or unreachable state; the detail
page shows only the word. The detail surface should not carry less than the list.

### CONSIDER-10 — The breadcrumb for one registration is a raw UUID

`apps/web/src/shell/breadcrumb-rules.ts:74-84`

`/administration/registrations/018f…` reads as "Administration / Target System
registrations / 018f0000-0000-7000-8000-000000000001" while the `<h1>` beside it says the
display name. EXPERIENCE.md's example is "Runs / RUN-2437 / Live" — a human identifier.
There is no per-route name source in `crumbsFor` today, so this needs a mechanism (a crumb
override passed from the page) rather than a one-line fix; worth a note in the decision log
before the next detail surface repeats it.

### CONSIDER-11 — A server-side field refusal is not tied to the field

`apps/web/src/admin/RegistrationsPanel.tsx:62-68`, `RegistrationEditor.tsx:46-52`

Refusals such as "Choose at least one permitted read action." arrive in the surface Banner
with no `aria-invalid` on the offending control and no focus move. After the dialog closes,
focus is on the submit button and the person must search upward for the message and then
downward for the field. The Banner is announced, so this is not a violation — but the
checkbox group in particular has no `required` and no client-side check, so it is the most
likely refusal on the surface. Consider marking the fieldset `aria-invalid` and moving focus
to it when the reason names it.

### CONSIDER-12 — Old rows survive a failed browser run

`tests/e2e/registrations.spec.ts:44-55`

`afterAll` deletes only this run's `stamp`. A run that crashes before `afterAll`, or one
whose stamp differs, leaves rows behind for good — there is no delete on the surface by
design. CI gets a fresh database, so this bites only local runs, where it eventually pushes
the list past `REGISTRATION_LIST_LIMIT`. Widening the predicate to `display_name LIKE 'E2E %'`
under the same `assertThrowawayDatabase` guard removes the accumulation.

### CONSIDER-13 — The empty-state sentence is hard to parse

`apps/web/src/admin/RegistrationsPanel.tsx:145-146`

"An empty list does not mean the agent is restricted to nothing safely; it means no
Procedure can run at all." The clause "restricted to nothing safely" has to be read twice.
The intent — an empty list is not a safe state — survives a plainer sentence: "An empty list
is not a safe state. It means no Procedure can run at all." This copy is ours, not the
contract's, so it can be changed freely.

---

## Not findings, recorded so they are not re-raised

- The create and change flows require JavaScript. This is the Story 1.5 decision, recorded
  in CLAUDE.md: both fail safe and visibly, and EXPERIENCE.md requires a focus-trapping
  confirmation dialog on every administration mutation, which cannot be built without
  script. Unchanged here.
- `'The change could not be saved. Nothing was changed.'` deviates from EXPERIENCE.md's
  "Couldn't {action}. Nothing was changed." That deviation predates this story (Story 1.5)
  and is out of this diff's scope; see CONSIDER-8 for the part that is in scope.
- `UNKNOWN_LABEL` ("Unrecognized value") is unreachable through the repository, which drops
  a row whose kind, status or action it cannot interpret. Defence in depth, correctly built.
- `<time dateTime={… ?? undefined}>` in the connectivity cell can never take the `undefined`
  branch: `toConnectivity` returns `never-probed` whenever `observedAt` is null.
