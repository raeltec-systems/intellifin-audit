---
title: Story 1.7 review — the user-facing surface
lens: surface (Population Source binding UI, copy fidelity, accessibility, browser assertions)
date: 2026-09-02
---

# Story 1.7 review — the user-facing surface

Scope: `apps/web/src/admin/{BindingForm,BindingsPanel,BindingEditor}.tsx`, `apps/web/src/admin/bindings.{ts,test.ts}`,
`apps/web/app/administration/sources/page.tsx`, `apps/web/app/administration/sources/[bindingId]/page.tsx`,
`apps/web/app/administration/page.tsx`, `apps/web/src/shell/breadcrumb-rules.ts`,
`apps/web/src/design/copy.{ts,test.ts}`, `tests/e2e/sources.spec.ts`.
Diff `184ffa0..5e4513e`. Nothing was modified.

---

## What holds

Recorded first, because each of these is a class of defect this repository has shipped before and did not ship again.

- **The JavaScript-only control class does not recur, and the guard really covers the new file.** Read, not assumed:
  `apps/web/src/form-method.test.ts` resolves `WEB_ROOT` as `new URL('..', import.meta.url)` from `apps/web/src/` — that is
  `apps/web/`, so the walk reaches both `app/` and `src/`, takes `.ts` as well as `.tsx`, and drops only `.test.`
  files. `BindingForm.tsx:199` is therefore one of the `it.each(files)` cases, and `declaresPostMethod` requires the
  literal `post`, so `method="get"` fails. The tag reader is brace- and quote-aware, so `method="post"` written *after*
  `onSubmit={(event) => ...}` is still seen. The form carries `method="post"`, and `tests/e2e/sources.spec.ts:105`
  asserts it in the browser as well.
- **Both "nothing was stored" checks reload first.** `sources.spec.ts:133-136` (cancel) and `:268-269` (refusal) each
  call `page.reload()` before asserting the row is absent. Story 1.6 shipped three assertions that read a
  pre-action render; none of those three is repeated here. The `rowheader` role they assert on really exists —
  `DataTable` renders `<th scope="row" role="rowheader">` — so the `toHaveCount(0)` is a real check, not a vacuous one.
- **No assertion matches a phrase two outcomes share.** The four outcome sentences are `Registered {name}. Its digest is
  {d}.`, `Saved. The digest is now {d}, and the change is recorded in the audit chain.`, `Saved. The digest did not
  change, so no Procedure is affected. …` and `Saved. Nothing changed.`. The spec pins `The digest is now ` (`:298`) and
  `The digest did not change` (`:286`), each unique to one branch. The shared tail `recorded in the audit chain` is
  explicitly avoided, and the comment at `:296-297` says so.
- **No file input, no credential field, no masked value.** `input[type="file"]` is asserted absent (`:109`); the surface
  shows sensitive-field *names* under the header "Masked fields" and never a population value, because it holds no
  population data at all.
- **Focus management is correct.** `ConfirmDialog` sets initial focus to Cancel (never Confirm), traps `Tab`, binds
  Escape to `document`, marks `#ls-app` inert, and restores focus to the invoking control in its cleanup. The submit
  button that opened the dialog is where focus lands again.
- **Stale-row token is refreshed.** `actions.ts:238-239` revalidates both paths, so a second consecutive edit in one
  page session receives a fresh `rowVersion` prop and is not falsely refused with `STALE_ROW`.

---

## BLOCKER

### B1 — The manual-upload sentence is invented, and EXPERIENCE.md already fixes one

`apps/web/src/admin/bindings.ts:70-80`

The doc-comment states: *"It is OUR sentence, not a quotation: EXPERIENCE.md fixes the missing-count warning but says
nothing about this restriction."* That is false. EXPERIENCE.md line 144:

```
| Builder | Upload with scheduled frequency | Blocker: "A manual upload is valid only for a `once` Schedule. Bind a
versioned file or an API for weekly Runs." |
```

The shipped string is a paraphrase of it:

```
'Upload-only. A manual upload can be used only by a Schedule that runs once; the Builder refuses it for a daily,
weekly or monthly Schedule.'
```

This is precisely the failure `copy.ts`'s own header documents for the registration-change warning — *"wrong on arrival
and wrong again the day it first appears"* — repeated one story later. It is worse here because
`copy.ts:DECLARED_COUNT_MISSING_SENTENCE` gives the reason the sentence must be identical: *"the person who reads it in
the Builder later recognizes it."* In Epic 2 the same administrator will be blocked by the contract's sentence, having
been warned with a different one.

The sentence also sits in `bindings.ts` rather than `copy.ts`, so nothing reads the artifact off disk.
`bindings.test.ts:104-112` asserts it `toContain('once')`, `toContain('Upload-only')`,
`toContain('daily, weekly or monthly')` — a file compared with itself, which CLAUDE.md names as its own rule
("Never assert a contract against a copy of itself").

**A person experiences:** they register a manual upload having read one warning; weeks later the Builder refuses the
Procedure with a differently worded blocker, and there is nothing to connect the two.

**Patch.** Move it to `copy.ts` as a quotation and pin it:

```ts
// apps/web/src/design/copy.ts
/** EXPERIENCE.md → Builder / "Upload with scheduled frequency" blocker (FR-6, AD-23). */
export const UPLOAD_ONLY_BLOCKER =
  'A manual upload is valid only for a `once` Schedule. Bind a versioned file or an API for weekly Runs.';
```

```ts
// apps/web/src/design/copy.test.ts
it("is EXPERIENCE.md's blocker, character for character", () => {
  expect(experience).toContain(`"${UPLOAD_ONLY_BLOCKER}"`);
});
it('is rendered from this module and not retyped in the surface', () => {
  for (const s of ['../admin/BindingsPanel.tsx', '../admin/BindingForm.tsx', '../admin/BindingEditor.tsx']) {
    const src = readFileSync(fileURLToPath(new URL(s, import.meta.url)), 'utf8');
    expect(src, s).toContain('UPLOAD_ONLY_BLOCKER');
    expect(src, s).not.toContain('valid only for a');
  }
});
```

Keep the "Upload-only." lead-in as the Banner *title* if a short label is wanted, and put the contract sentence in the
Banner body — but the contract sentence must appear verbatim, and `bindings.ts:70-80` and its self-referential test must
go. Also correct the doc-comment: the contract is not silent.

### B2 — The 64-character digest has no announced form, and the accessibility gate cannot see it

`apps/web/src/admin/BindingsPanel.tsx:166`, `apps/web/src/admin/BindingEditor.tsx:91`
(and the Story 1.6 originals it copies, `RegistrationsPanel.tsx:134`, `RegistrationEditor.tsx:64`)

```tsx
<span className="ls-mono ls-digest" aria-label={spokenBindingDigest(row.digest)}>{row.digest}</span>
<dd  className="ls-mono ls-digest" aria-label={spokenBindingDigest(binding.digest)}>{binding.digest}</dd>
```

`aria-label` is **prohibited** on both of these. A bare `<span>` maps to role `generic`, and `<dd>` maps to
`definition`; neither supports naming from author, and Chrome and Firefox drop the label rather than expose it. The
intended mitigation — "starting a 1 b 2, ending c 3 d 4" — is therefore very likely never spoken, and a screen-reader
user gets 64 undifferentiated characters read out, once per row, seven rows of vocabulary on the list page.

The axe gate cannot catch this. Verified against the pinned `axe-core@4.13.0`: `aria-prohibited-attr` is tagged
`wcag2a`/`wcag412` so it *does* run under the spec's `TAGS`, but `ariaProhibitedAttrEvaluate`
(`axe.js:27911-27916`) returns `undefined` — **incomplete**, not a violation — whenever the element has subtree text,
which a digest always does. `scan()` at `sources.spec.ts:55-64` asserts only `results.violations`. Every other spec in
`tests/e2e/` does the same. So the one finding axe actually raises about this markup is discarded by every scan in the
suite.

**A person experiences:** using a screen reader, a minute of "three, seven, a, nine, four, b…" per digest, with no way
to tell two digests apart — on the one column the surface exists to make comparable.

**Patch.** Give the visible text to sight and the spoken text to audio, rather than relying on a prohibited attribute:

```tsx
// apps/web/src/design/Digest.tsx (new, shared by both stories)
export function Digest({ digest, spoken, as: Tag = 'span' }: {...}) {
  return (
    <Tag className="ls-mono ls-digest">
      <span aria-hidden="true">{digest}</span>
      <span className="ls-visually-hidden">{spoken}</span>
    </Tag>
  );
}
```

`.ls-visually-hidden` already needs to exist in `globals.css`; add it and a `stylesheet.test.ts` case if it does not.
Then close the gate so this class cannot hide again — in every `scan()` helper:

```ts
const review = results.incomplete.filter((r) => r.id === 'aria-prohibited-attr');
expect(review, JSON.stringify(review, null, 2)).toEqual([]);
```

Prefer that narrow filter over asserting all of `incomplete` empty, which would be noisy for colour-contrast checks axe
genuinely cannot resolve.

---

## SHOULD

### S1 — The manual-upload e2e test cannot fail from the code it tests

`tests/e2e/sources.spec.ts:188-201`

```ts
await page.getByLabel('Binding kind').selectOption('manual-upload');
await expect(page.getByLabel('Location')).toHaveCount(0);
const uploadNotice = page.locator('.ls-banner--info');
await expect(uploadNotice).toContainText('Upload-only');
```

`manual-upload` is `POPULATION_SOURCE_KINDS[0]`, and `BindingForm.tsx:73` makes `FIRST_KIND` the create form's default.
So the info Banner is on screen and the Location field is absent **before** the `selectOption` runs. Delete the
`uploadOnly` branch at `BindingForm.tsx:233` and this test still passes; invert `uploadOnly` and it still passes as long
as the default happens to sit on the branch that renders the banner. The test named for the reaction never observes a
reaction.

**Patch.** Start on a kind that is not the default and assert the flip in both directions:

```ts
await page.getByLabel('Binding kind').selectOption('versioned-file');
await expect(page.getByLabel('Location')).toHaveCount(1);
await expect(page.locator('.ls-banner--info')).toHaveCount(0);

await page.getByLabel('Binding kind').selectOption('manual-upload');
await expect(page.getByLabel('Location')).toHaveCount(0);
await expect(page.locator('.ls-banner--info')).toContainText('Upload-only');
```

The same shape applies at `:313-316`: `selectOption('manual-upload')` there is also a no-op, though the
`selectOption('none')` beside it is real.

### S2 — The create form defaults to the most restricted kind

`apps/web/src/admin/BindingForm.tsx:73, 97, 158`

`FIRST_KIND` is `manual-upload`. Every fresh load of `/administration/sources` opens with the upload-only Banner
showing, no Location field, and the least capable binding pre-selected; after a successful create the form snaps back to
it (`:158`). Two costs: the least-capable option is the path of least resistance, and a standing banner on an untouched
form is a banner people learn to look past — which is exactly the banner B1 is about.

**Patch.** Either name the default explicitly (`const DEFAULT_KIND: PopulationSourceKind = 'versioned-file'`, keeping
`BINDING_KIND_OPTIONS` derived so a new kind is still offerable), or render an unselected placeholder
`<option value="">Choose a kind</option>` and let the server's existing `KIND_INVALID` refusal handle a hand-made post.
The second forces a deliberate choice, which suits a surface whose whole subject is a frozen contract.

### S3 — The detail surface paraphrases the missing-count sentence, outside the guard

`apps/web/src/admin/BindingEditor.tsx:76-82`, guard at `apps/web/src/design/copy.test.ts:125`

The list and the form render `DECLARED_COUNT_MISSING_SENTENCE` (EXPERIENCE.md's sentence, pinned to disk). The detail
page instead writes its own: *"No Procedure Version can be submitted against this binding until the count is
declared."* The guard loop names only `BindingsPanel.tsx` and `BindingForm.tsx`, so the third surface both omits the
contract sentence and escapes the `not.toContain('must declare an expected record count')` check that exists to catch
this.

**A person experiences:** the same condition described in two different sentences depending on which page they opened.

**Patch.** Render `DECLARED_COUNT_MISSING_SENTENCE` as the statement and keep the current sentence as the consequence
beneath it — exactly the split `BindingForm.tsx:344-351` already uses — and add `'../admin/BindingEditor.tsx'` to the
`copy.test.ts:125` list.

### S4 — The new breadcrumb label has no test anywhere

`apps/web/src/shell/breadcrumb-rules.ts:26`

`'/administration/sources': 'Population Source bindings'` is the story's only change to the shell.
`breadcrumb-rules.test.ts` covers `/administration/registrations` and its detail route and never mentions `sources`; no
e2e reads a breadcrumb on this surface. Delete the line and the whole suite stays green while
`/administration/sources/<uuid>` renders `sources` in monospace, telling the reader it is an identifier.

**Patch.** Mirror the existing registrations cases:

```ts
expect(crumbsFor('/administration/sources')).toEqual([
  { href: '/administration', label: 'Administration', mono: false },
  { href: '/administration/sources', label: 'Population Source bindings', mono: false },
]);
```

and, better, drive it from the record so a future entry cannot be added untested:
`it.each(Object.entries(SUBSECTION_LABELS))(...)` asserting `mono === false` for each.

### S5 — The action-failure sentence exists as two unpinned literals, and the contract fixes a third

`apps/web/src/admin/BindingForm.tsx:166` and `apps/web/app/administration/sources/actions.ts:46`

Both files spell `'The change could not be saved. Nothing was changed.'` as their own literal. Neither is checked
against the other. EXPERIENCE.md line 180 (*Any / Action failed*) fixes the shape as
`Couldn't {action}. Nothing was changed.` — so the shipped sentence is a paraphrase of a contract line, in duplicate.
`copy.test.ts`'s header names this exact situation ("Three independent literals carried this string … each was only
ever checked against another of them").

**Patch.** One exported constant, in `copy.ts`, built from the contract shape —
`export const actionFailed = (action: string) => `Couldn't ${action}. Nothing was changed.`;` — with a `copy.test.ts`
case asserting `experience` contains `Couldn't {action}. Nothing was changed.`, and both files importing it. This is
carried forward from Story 1.6, so fixing it touches `registrations` too; that is the right scope for it.

### S6 — The Auditor case never opens the detail route

`tests/e2e/sources.spec.ts:337-355`

The Auditor visits `/administration/sources` only. `[bindingId]/page.tsx` is the surface where an ordering mistake
matters most — it authorizes at `:41` before touching `params` or the repository, and that ordering is the reason a
refused caller cannot learn whether a binding id exists. Nothing exercises it. The list-page assertions are also weaker
than they read: with the page refused, `getByText('employee_id')`, `getByText('s3://')` and the rest are all trivially
zero, and `getByText` sees rendered text only, not the RSC flight payload.

**Patch.** Add, in the Auditor block:

```ts
test('is refused one binding, and cannot tell a real id from an invented one', async ({ page }) => {
  for (const id of [knownBindingId, '018f0000-0000-7000-8000-0000000000ff']) {
    await page.goto(`/administration/sources/${id}`);
    await expect(page.locator('main#content').getByRole('alert'))
      .toHaveText('Your role does not permit this action.');
    expect(await page.content()).not.toContain('ls-digest');
  }
});
```

Capture `knownBindingId` from the administrator block (the `bindingId` is already on the create result, or read the
`href` off the row). Asserting on `page.content()` rather than `getByText` is what makes "no binding data reaches the
browser" a real claim.

---

## CONSIDER

### C1 — A Target System sentence reused for a binding, and a plural that will read wrong
`apps/web/src/admin/BindingForm.tsx:186`. `registrationChangeWarning` quotes EXPERIENCE.md line 177, which scopes it to
*"Saving a Target System registration"*. It is reused verbatim for a binding change. Line 254 of the same document
writes the singular case as *"a platform-authored draft for 1 Procedure"*, so the fixed `{n} Procedures` template will
read "for 1 Procedures" the first time Epic 2 makes the branch reachable. Both are latent (count is 0 today), which is
also why nothing will catch them. Worth a pluralizing helper and a `copy.test.ts` case pinned to line 254 now, while the
branch is cheap to change.

### C2 — `spokenBindingDigest` is `spokenDigest` retyped
`apps/web/src/admin/bindings.ts:126` vs `apps/web/src/admin/registrations.ts:132`. Identical bodies; the only
difference is the noun and a dropped clause in the doc-comment. CLAUDE.md's canonicalizer rule applies in spirit: two
copies agree on everything anybody tries. Parameterize —
`spokenDigest(digest: string, noun: 'Registration' | 'Binding')` — and let both surfaces import it. (Fold this into
B2's shared `Digest` component and it costs nothing extra.)

### C3 — Three e2e tests depend on an earlier test's row
`sources.spec.ts:162-186` and `:272-301` both need the binding created at `:97-160`; `:272` also renames it. Safe today
(`playwright.config.ts` sets `fullyParallel: false, workers: 1`), but `--grep` on a single test fails, and one failure
cascades into three. A `beforeAll` that registers the fixture rows — or a per-test create — removes the coupling.

### C4 — `BINDING_STATUS_OPTIONS` is not pinned to its vocabulary
`bindings.test.ts:69-77` asserts `BINDING_KIND_OPTIONS` and `MECHANISM_OPTIONS` equal their source lists, and omits the
status one. The `it.each(BINDING_STATUSES)` case above it only proves each status has a label, not that each is offered.

### C5 — "masked in list views" understates the contract
`BindingForm.tsx:308`. EXPERIENCE.md line 172 scopes masking as `••••` with *"Masked by the Population Source binding"*,
*"unmasked in Exception Detail for Auditor and Audit Manager only"*. "Masked in list views" is narrower than what the
administrator is actually designating.

### C6 — The no-JavaScript path is a 405, and is not recorded for this surface
`BindingForm.tsx:199` has `method="post"` and no `action`, and always prevents the native submission, so a submit that
beats hydration posts to the page route and gets a framework 405. That is fail-safe (nothing is stored) and matches the
Story 1.5 decision that administration mutations require script because EXPERIENCE.md mandates a focus-trapping
confirmation. It is a bigger visible break than the 1.5 case ("no Banner and no changed row") because the person leaves
the surface. Worth one line in the story's Design Notes and in CLAUDE.md's accepted-risk entry so the next reviewer does
not re-derive it.

### C7 — The new Administration link is unasserted
`apps/web/app/administration/page.tsx:61` adds the "Population Source bindings" link; every e2e navigates by URL, so
removing the link breaks no test and the surface becomes reachable only by typing the path.
