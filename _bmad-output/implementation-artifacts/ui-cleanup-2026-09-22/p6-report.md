# Package 6 — Administration — report

Branch `ui/p6`. Commits: `aa8dfdb` (inherited), `adcc816`, `ebbea4d`, `5931a0a`.

Most of this package's implementation was already written and uncommitted when this
session started (by an earlier agent). This session read the whole diff against every
finding below, found and fixed three real defects the earlier work had not caught (the
`RoleControl` select, two missing `revalidatePath` calls, and one piece of dead copy),
committed the work in coherent pieces, and ran the full verification list.

## Findings owned

**UX-41 — tabbed Administration, exact route names.** `AdministrationTabs` (new,
`apps/web/src/admin/AdministrationTabs.tsx`) renders the three areas — Users, Population
sources, Systems — as `<nav aria-label="Administration areas">` links with `aria-current`,
on every administration page. The labels are imported from `administration-words.ts`
(`ADMINISTRATION_TABS`), not retyped, and pinned against the breadcrumb labels
`breadcrumb-rules.ts` already registers
(`administration-words.test.ts` → `'names the areas exactly as the trail names them'`).
Page titles: `/administration` = "Administration" (the summary), `/administration/users` =
"Users", `/administration/registrations` = "Systems" (was "Target systems";
`registrations.spec.ts` line 106 asserts the new H1), `/administration/sources` =
"Population sources". Proven by `tests/e2e/{administration,registrations,sources}.spec.ts`
and `administration-words.test.ts`.

**UX-37 — the landing states exact counts and true health.** `apps/web/app/administration/page.tsx`
reads six `count(*)` queries (never `rows.length` of a bounded list) through the new
`countUsers`/`countRegistrations`/`countBindings` filters and renders them via
`AdministrationSummary` (new): three area cards with exact totals
(`countNoun` — never a raw number with no unit) and four configuration-health lines
(accounts with no role, administrator cover, sources with nothing confirming their count,
systems never checked) that render a "clear" sentence when the count is zero rather than
disappearing — the "an empty state is a statement about the environment" rule applied to
a health check. `ADMINISTRATION_NOT_AVAILABLE` states what this release does not do as one
caption, never per-page refusal-shaped prose. Proven by `administration-words.test.ts`
("the configuration health lines" describe block) and
`administration.spec.ts` → `'the landing summary has no WCAG 2.1 AA violation'`.

**UX-38 — a searchable, paged, exact-total user directory.** New route
`/administration/users` (`apps/web/app/administration/users/{page,actions}.tsx`).
`user-directory-query.ts` reads/writes the filter (search, role including `'none'`, page)
as a GET query string; `searchUsersAction` is a Server Action that authorizes first and
lands the browser on that GET URL, so the search works with no JavaScript and survives the
back button. `DrizzleUserDirectory.pageUsers`/`countUsers` apply the filter in SQL (never a
slice of a bounded list), with `%`/`_` escaped in the search term. The exact total is stated
beside the bounded page (`userPageSentence`). "Add a user" is a `<details>` disclosure at
the foot, alongside the onboarding block (UX-40, below), so the directory is what a reader
meets first. Proven by `tests/integration/administration-reads.test.ts` (search, role
filter, `'none'`, escaping) and `administration.spec.ts`.

**UX-39 — one "Change" disclosure per row, guardrails stated in place.** Each row's role
select and "Change role" button sit inside a `<details className="ls-row-change">`
disclosure, summary "Change" with a visually-hidden per-person name
(`changeUserLabel`). `ROLE_GUARDRAILS` states both refusals (self-change, last
administrator) beside the control, not only when it fires. **Fixed during verification**: the
select carried `aria-disabled="true"` whenever the current selection equalled the stored
role — which is the state every row starts in, since the control's `choice` state
initialises to the rendered value — so on first render every role select in the whole
directory told assistive technology (and Playwright, which treats `aria-disabled` as
not-enabled) that it could not be operated, even though picking a different value is
exactly how the guard resolves. Only `isSelf` is now allowed to mark the select
`aria-disabled` (the one reason no choice changes); the button still carries all three
reasons as before. See `apps/web/src/admin/RoleControl.tsx`. Proven by mutation in
practice: the browser suite failed with "element is not enabled" against the unfixed code
and passes against the fix (`administration.spec.ts` → `'changes a role, confirming first
and reporting the outcome'`, `'removes a role, and says the account and its sessions
survive'`, `'an opened "Change" disclosure has no violation'`); the self-row case stays
pinned by the pre-existing `'cannot change their own role, and the reason is on the page'`.

**UX-40 — the supported onboarding, stated where "Add a user" is.** `ONBOARDING_STEPS`
(three sentences: the administrator hands the password over directly with no email; the
person signs in with it immediately; there is no reset link, no password-change screen and
no invented remedy — a lost password means a new account and the role moved to it) renders
above the create form inside the same disclosure. Proven by `administration-words.test.ts`
→ `'the onboarding block'`.

**UX-42 — guided field-list input with a live, numbered preview.** `BindingForm`'s "Fields
this source provides" textarea keeps one-name-per-line, but now renders a live numbered
preview of what will actually save (`FIELD_LIST_PREVIEW_TITLE`), a duplicate-name warning
(`fieldListDuplicateWarning`, before a save can be refused for it) and a blank-line note,
plus `FIELD_ORDER_SENTENCE` stating the order must match the file. The fingerprint mechanics
moved under `TechnicalDetails`; `SOURCE_NOT_VALIDATED` states plainly that this surface opens
nothing and checks nothing against the source. Proven by `administration-words.test.ts` →
`'the field list words'` and `sources.spec.ts`.

**UX-43 — inventory first, create behind a disclosure, technical detail moved off the row.**
Both `/administration/sources` and `/administration/registrations` lead with a compact,
client-filtered table (name/kind/status/last-changed/link); "Add a …" is a `<details>` at
the foot. The digest, the full origin/action/field lists and (for sources) the location all
moved to each row's own detail page under `TechnicalDetails`. Proven by
`administration-words.test.ts` → `'inventory-first sentences'` and both
`registrations.spec.ts`/`sources.spec.ts`, which now open the detail page and the Technical
details disclosure to read the digest instead of reading it off the row.

**UX-44 — two facts, never "no worker has observed this system".** The registration detail
page states `CONNECTION_CHECK_LABEL` ("Not yet run" / the probe's own word, with the
`CONNECTION_CHECK_NOT_RUN_SENTENCE` saying what the check is and who runs it) and
`AUDIT_ACTIVITY_LABEL` separately, read from the new
`DrizzleRegistrationRepository.lastAuditActivity` — the most recent TERMINAL Run whose
Procedure Version froze this registration's id in its `targets` jsonb, joined by
`target->>'registrationId' = <id>`. Neither sentence claims "no worker has observed this
system"; the now-unused literal of that sentence was removed from `registrations.ts` rather
than left as dead copy nothing renders and a later reader could mistake for live. Proven by
`administration-words.test.ts` → `'the two facts a system states'`,
`tests/integration/administration-reads.test.ts` → `lastAuditActivity` (present/absent/only-terminal
cases), and `registrations.spec.ts`.

**UX-45 — the authentication-endpoint field says what it is.** Relabelled
`AUTH_ENDPOINT_LABEL` = "Authentication endpoint (where the sign-in form sends the
credential)"; `AUTH_ENDPOINT_HELP` distinguishes it from the allowed-origins list (where the
agent may browse) and the sign-in page (one of those addresses). The credential-reference
field offers a `<datalist>` of this deployment's declared reference names via
`credentialCapabilityManifest(runtime.config)` (names only — the manifest already refuses to
return a value) when the process can read it, and states plainly
(`CREDENTIAL_REFERENCE_UNKNOWN`) when it cannot, rather than an empty list read as "none
declared". Proven by `administration-words.test.ts` → `'the authentication endpoint words'`.

**UX-46 — the confirmation names the affected Procedures.** New
`DrizzleProcedureRepository.listReferencing` (bounded, `REFERENCING_NAME_LIMIT = 10`) sits
beside the existing `countReferencing`, sharing its predicate and its "current" successor
rule, so the confirmation dialog can never name a different set than the one it counts.
`affectedProceduresSentence` lists the names, says how many more when truncated, and states
"could not be listed" (never an empty list) when the read failed. **Fixed during
verification**: neither `registrations/actions.ts` nor `sources/actions.ts` revalidated
`/administration` after a create or change — only the list and detail routes — so the
landing's exact counts and health lines (UX-37) could go stale after exactly the mutations
that move them. Both now revalidate `/administration` too, matching the dual revalidation
the users actions already had. Proven by `administration-words.test.ts` →
`'the affected-procedure sentence'` and `tests/integration/administration-reads.test.ts` →
`listReferencing`.

**UX-02 / UX-31 on these surfaces.** `Timestamp` for every instant (created/last-changed/last
audit activity), `countNoun` for every count, `Digest`+`TechnicalDetails` for
fingerprints/locators/actions, `Reference` for the Run link on the audit-activity line. No
raw ISO instant, raw UUID or bare number is rendered on an ordinary Administration surface.

**Copy renames.** "Target System registrations" → "Systems", "Population Source bindings" →
"Population sources" on these surfaces only; the domain's own names are untouched in code
and in JSDoc comments (which `plain-words.test.ts` strips before scanning, so they are not
what the test polices). `plain-words.test.ts` stays green (60/60).

## Left out and why

- **Server-side search/pagination for sources and systems (UX-43).** The two inventories
  filter client-side over the page already fetched (bounded at
  `REGISTRATION_LIST_LIMIT`/`BINDING_LIST_LIMIT`), the same shape `BindingsPanel` and
  `RegistrationsPanel` both use, with `INVENTORY_SEARCH_BOUNDED` stating honestly that a
  search does not reach past that bound. The brief's UX-43 text asks for "a compact
  searchable table", not a server-paged one, and this deployment's realistic row counts (tens
  of systems/sources, not thousands) make a full server-search pipeline the wrong size of
  fix for this pass; the honest caption is the finding closed rather than deferred silently.
- **A dedicated `RoleControl.test.ts` unit test.** Not added: the control portals nothing and
  needs no effect-driven DOM to render, but its live-region/aria-disabled interaction the fix
  addresses is exactly the class of behaviour this codebase's own notes say an SSR
  (`renderToStaticMarkup`) test cannot see reliably; it is proven in the browser instead,
  which is where the defect was actually found.

## Needs a change outside my scope

- None. Every change this package needed was inside the files it owns, plus one file
  (`tests/e2e/shell.spec.ts`) whose failing assertion was a direct, mechanical consequence of
  this package's own UX-37/UX-41 rework (the old `/administration` Users-list heading it
  pinned no longer exists there) — fixed and committed separately (`5931a0a`) rather than
  reported, since house rule 7 requires rewriting a pinned OLD-behaviour assertion rather
  than leaving it red.

## Gotchas for CLAUDE.md

- **`aria-disabled="true"` on a `<select>` must never be driven by the value CURRENTLY
  chosen in that same select.** `RoleControl`'s select was disabled whenever the selection
  equalled the stored role — true on every row's first render — which told AT and Playwright
  alike that the control could not be operated, although picking a different value is the
  only way to resolve that state. Disable the select only for a reason INVARIANT to the
  choice (here, acting on your own row); a choice-dependent reason belongs on the button that
  commits, never on the input that decides it.
- **A mutation that can move a shared summary's counts must revalidate that summary's path
  too, not only its own list/detail routes.** `registrations/actions.ts` and
  `sources/actions.ts` predate the Administration landing reading their counts (UX-37) and
  had no reason to revalidate `/administration`; adding a shared summary to three existing
  mutation surfaces means auditing every one of them for this, not only the surface the
  summary was built beside.
- **Three sequential browser-test failures with different `Date.now()` stamps in their row
  names are one root cause, not three.** `administration.spec.ts`'s `newUserName` is a
  module-level constant computed once; seeing it differ across failing tests in one run is
  the existing documented signal that Playwright restarted its worker after the FIRST
  failure and reloaded the module — read the first failure only, the rest are its shadow.
