---
title: 'Story 1.4: Application shell and Ledger Signal tokens'
type: 'feature'
created: '2026-09-02'
status: 'in-review'
baseline_revision: 'c1f3716214748488c60d03a0d579d847b480f940'
baseline_commit: 'c1f3716214748488c60d03a0d579d847b480f940'
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

**Problem:** `apps/web` has no styling of any kind — no CSS file, no components, and a placeholder home page. Every surface in Epics 2 through 9 is specified against the Ledger Signal vocabulary, so each one would otherwise invent its own colours, status treatments and table markup, and the accessibility floor would be re-argued per story.

**Approach:** Put the DESIGN.md token set into CSS custom properties, build the eight named design-system components and the shell that composes them, encode the complete status vocabulary as data so a badge cannot be rendered without an icon and a word, and wire Playwright with axe so the WCAG 2.1 AA floor is a gate rather than an intention.

## Boundaries & Constraints

**Always:**
- Every colour, typography role, radius and spacing value in DESIGN.md is a CSS custom property with exactly the value DESIGN.md states. No literal hex or px in a component where a token exists.
- Teal `#0F766E` is the only interactive colour. The focus ring is `#0F766E`, is never `outline: none` without a visible replacement, and is never suppressed.
- Every status badge renders an icon **and** a word. Colour is never the sole carrier of meaning.
- Hiding a nav item is presentation, never authorization: Administration is removed from the sidebar for non-administrators **and** the route refuses a non-administrator on the server.
- The role comes from the session on the server, never from a client control (AD-7). No role switcher.
- Tables use `<th scope>`, a caption, and a focusable link in the first cell, with no row-level click handler.
- An empty state names what would appear and never implies a control passed.
- A disabled action keeps its position, and its reason appears both in the "Unavailable actions" panel and as the button's accessible description — never tooltip-only.
- Dialogs are `role="dialog"` with `aria-modal`, trap focus, restore it on close, and close on Escape.
- Copy specified in EXPERIENCE.md or DESIGN.md is reproduced verbatim, including the ribbon sentence.

**Block If:**
- DESIGN.md and EXPERIENCE.md disagree on a value or behaviour in a way their own precedence rule does not settle.
- Delivering this requires changing an approved requirement, an AD, or a pinned dependency major.

**Never:**
- No Procedure, Run, Evidence, Exception, Live View, Replay or administration **functionality**. This story builds the shell those surfaces will sit in, plus inert placeholder pages so the nav does not 404.
- No data fetching for counts beyond what the shell needs; the sidebar counts render from a typed input with no live query.
- No CSS framework, no component library, no CSS-in-JS runtime.
- No role switcher, no tenant picker, no global search — the top bar carries what DESIGN.md specifies and nothing invented.
- No jsdom or testing-library: component behaviour is proven in the browser Playwright already provides.
- No use of `claude/DESIGN.md`; it is the superseded pre-revision-2 prototype contract.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Auditor loads any page | Signed in, role `auditor` | Sidebar shows Overview, Procedures, Runs, Review — **no** Administration; ribbon and top bar render | No error expected |
| Administrator loads any page | Signed in, role `poc-administrator` | Sidebar additionally shows Administration | No error expected |
| Non-administrator opens `/administration` directly | Signed in, role `auditor`, nav item hidden | Refused on the server with the verbatim role reason; the page is never rendered | Hiding the link is not the control |
| Signed-in user with no role | Valid session, no `user_role` row | Shell renders with no privileged nav; every gated action refused | Default deny |
| Badge renders any state | Any of the 9 vocabulary rows | The state's exact word plus its icon, in its treatment | An unknown state is a type error, not a silent grey badge |
| "Needs a human" states | Awaiting Auditor, Pending Confirmation, Agent-Judged (pending), Work Item Awaiting | `info-solid` fill with `text-inverse` and the `user` icon | The only solid blue in the product |
| Completed run | Run lifecycle `Completed` | Neutral grey badge, `check` icon | Never green; only a Result outcome may be green |
| Empty Overview | No runs in the environment | The verbatim empty-state copy, which states that an empty Overview does not mean a control passed | Never a mutating call to action |
| Detail route | A route with a parent | Breadcrumbs render `Parent / Current`, every segment but the last a link | Lists get no breadcrumb |
| Viewport below 1024px | Narrow window | Rail stacked, layout collapses per the EXPERIENCE.md breakpoint table | Content stays reachable, never clipped |
| Axe scan | Shell, empty Overview, badge gallery | Zero WCAG 2.1 AA violations | A violation fails CI |

</intent-contract>

## Code Map

- `_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/DESIGN.md` -- **the** token source (root file, revision 2, `status: final`). Colours at lines 14-57, typography roles 58-119, `rounded` 120-124, `spacing` 125-152, the status table 301-325, component prose 359-410. Quote the path: it contains a space.
- `_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md` -- behaviour and copy authority. Its frontmatter (line 16) states the precedence rule: behaviour and copy follow EXPERIENCE.md, visual values follow DESIGN.md, and both beat the prototype. Sidebar line 42, component patterns 98-105, accessibility floor 201-203, breakpoints 212-218, empty-state copy 127-128.
- `_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/claude/DESIGN.md` -- **superseded**; 4 state families, no `info-solid`, 2 dialog weights, 2 breakpoints. Do not read it as a contract.
- `_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/claude/mockups/assets/lucide-icons.js` -- the self-hosted Lucide subset; the icon set to draw from.
- `apps/web/app/layout.tsx` -- currently `<html><body>{children}</body></html>` with metadata only. The shell composes here.
- `apps/web/app/page.tsx` -- the Story 1.1 placeholder, to be replaced by Overview.
- `apps/web/src/require-role.ts` -- `requireSession(request)` and `requireAction(request, action, context?)`. Both take a `Request`; a server component has none, so the shell reads headers via `next/headers` and passes a constructed `Request`, or the module gains a headers-based entry point. **`requireAction` currently has no production caller** — the Administration route is its first.
- `packages/domain/src/identity/roles.ts` -- `ROLES`, `GATED_ACTIONS`, `authorizeAction`, and `DENIAL_REASONS`. The sidebar's Administration visibility and the route's refusal both derive from this, never from a second copy of the rule.
- `apps/web/src/route-access.ts` -- `PROTECTED_ROUTE_FAMILIES` already names the eight families; the placeholder pages this story adds fall under them and are protected already.
- `apps/web/app/sign-in/page.tsx` -- the unstyled Story 1.3 page. Its deferred accessibility findings (`role="alert"` with `aria-live="polite"`, no `aria-describedby`, no focus management, no metadata) are this story's to fix, since this story owns the accessibility floor.
- `package.json` -- `@playwright/test` 1.62.1 is pinned with no config, script, or CI step. `tests/e2e/` holds only `.gitkeep`.
- `.github/workflows/ci.yml` -- the `verify` job runs typecheck, boundaries, unit tests; the e2e gate is added there.
- `vitest.config.ts` -- `test.environment` is node with no DOM. Unit tests here stay pure; browser behaviour goes to Playwright.

## Tasks & Acceptance

**Execution:**
- `apps/web/app/tokens.css` -- every DESIGN.md colour, typography role, radius and spacing value as a CSS custom property under `:root`, named after its DESIGN.md key -- one file is the single source so a drift test can read it.
- `apps/web/src/design/tokens.test.ts` -- parse `tokens.css` and DESIGN.md and assert every documented token exists with the documented value -- the same drift-guard pattern `schema-range.test.ts` uses for migrations; a token silently diverging from the contract is exactly the failure this prevents.
- `apps/web/app/globals.css` -- the reset, base typography, focus-visible ring at `#0F766E`, and the breakpoint media queries from the EXPERIENCE.md table -- the focus ring lives here so no component can suppress it locally.
- `apps/web/src/design/status.ts` -- the nine vocabulary rows as data: family, state word, treatment, icon. Exported as a typed lookup so an unknown state is a compile error -- the vocabulary is data, not markup, so the table can be tested against DESIGN.md.
- `apps/web/src/design/status.test.ts` -- assert every state word, treatment and icon against DESIGN.md read from disk, and assert the four `info-solid` + `user` states and that `Completed` is neutral -- proves the vocabulary matches the contract rather than itself.
- `apps/web/src/design/Icon.tsx` -- the Lucide subset as inline SVG, `aria-hidden` when decorative, named per DESIGN.md -- icons must ship with the app, not from a CDN.
- `apps/web/src/design/Button.tsx` -- primary, secondary, ghost, destructive at `control-sm`/`control-md`; a disabled button keeps its position and takes `disabledReason`, rendered as its accessible description -- the canonical disabled-action rule.
- `apps/web/src/design/StatusBadge.tsx` -- renders a state from `status.ts` at `badge-sm`/`badge-md`, always icon plus word -- it is impossible to render a badge without both.
- `apps/web/src/design/Banner.tsx`, `EmptyState.tsx`, `Tabs.tsx` -- per the DESIGN.md and EXPERIENCE.md rules; `EmptyState` takes a headline and one sentence and refuses a mutating action.
- `apps/web/src/design/EnvironmentRibbon.tsx` -- 32px, carrying the DESIGN.md sentence verbatim -- the PoC's standing disclaimer.
- `apps/web/src/design/Sidebar.tsx` -- 240px navy rail; Overview, Procedures, Runs, Review in order, Administration only when the role is `poc-administrator`; counts on Runs and Review; active-item highlighting including the detail-route rules -- Administration is removed, not disabled, per the EXPERIENCE.md exception.
- `apps/web/src/design/DataTable.tsx` -- `<th scope>`, caption, first cell a focusable link, no row click handler, numerics right-aligned in mono.
- `apps/web/src/design/ConfirmDialog.tsx` -- `role="dialog"`, `aria-modal`, focus trap and restore, Escape to cancel, the three weights Routine, Routine with rationale, Finalization; rationale validated non-empty -- named exactly as EXPERIENCE.md names them.
- `apps/web/src/design/UnavailableActions.tsx` -- the panel listing each disabled action and its reason.
- `apps/web/src/shell/AppShell.tsx` -- composes ribbon, top bar (notification bell with unread count in `info-solid`), sidebar and content; breadcrumbs on detail routes -- one shell so no later surface reinvents it.
- `apps/web/app/layout.tsx` -- resolve the session and role on the server, render `AppShell`, import the stylesheets -- the role reaches the shell from the session and nowhere else.
- `apps/web/app/page.tsx` -- Overview with the two verbatim empty-state sentences.
- `apps/web/app/procedures/page.tsx`, `runs/page.tsx`, `review/page.tsx` -- inert placeholders rendering `EmptyState`, so nav targets resolve -- a nav item that 404s is worse than one that says the surface is not built.
- `apps/web/app/administration/page.tsx` -- calls `requireAction` for an administration action and refuses a non-administrator with the verbatim reason -- the first production caller of the audited authorization path.
- `apps/web/app/badges/page.tsx` -- the badge gallery rendering every state in the vocabulary; not linked from the nav -- the AC names it as an axe target and it doubles as the visual proof of the vocabulary.
- `apps/web/app/sign-in/page.tsx` -- fix the deferred accessibility findings: one live-region role, `aria-describedby` linking the error to the fields, error before the form in DOM order, focus moved to it, and page metadata.
- `playwright.config.ts` -- projects, base URL, and a web server command; reuse the existing build -- Playwright is pinned but unwired, and this story's WCAG gate needs it.
- `tests/e2e/a11y.spec.ts` -- axe scans of the shell, the empty Overview and the badge gallery, asserting zero WCAG 2.1 AA violations.
- `tests/e2e/shell.spec.ts` -- Administration absent for an auditor and present for an administrator; keyboard traversal reaching every nav item with a visible focus ring; the dialog trapping and restoring focus and closing on Escape; the layout collapsing below 1024px.
- `package.json` -- add `@axe-core/playwright`, a `test:e2e` script, and keep Playwright pinned -- closes the deferred "wire Playwright" item.
- `.github/workflows/ci.yml` -- run the e2e suite with the browser Playwright already provides, so the WCAG floor gates the pull request.
- `CLAUDE.md` -- record: the design system is built locally under the parent's names; DESIGN.md is the token source and `claude/DESIGN.md` is superseded; hiding a nav item is never authorization.

**Acceptance Criteria:**
- Given any signed-in role, when a page renders, then the ribbon carries the DESIGN.md sentence verbatim, the sidebar shows its four items in order, and Administration appears only for a PoC Administrator.
- Given an Auditor, when they request `/administration` directly, then the server refuses with the verbatim role reason and no administration content is sent.
- Given the badge gallery, when it renders, then every state in the nine rows shows its exact word and icon, the four "needs a human" states use `info-solid` with `user`, and Completed is neutral.
- Given the shell, the empty Overview and the badge gallery, when axe runs against each, then there are zero WCAG 2.1 AA violations and the run fails CI if any appear.
- Given a keyboard alone, when a user traverses the shell, then every interactive element is reachable and shows the `#0F766E` focus ring.
- Given a confirmation dialog, when it opens, then focus is trapped, Escape cancels, and focus returns to the invoking control.
- Given the token drift test, when a DESIGN.md value changes without `tokens.css` following, then the test fails.

## Spec Change Log

## Review Triage Log

## Design Notes

**Why the design system is built here.** DESIGN.md inherits the IntelliFin Design System bundle, which lives in the Business Suite repository and is **not present here** — the UX working notes say so explicitly. DESIGN.md was written for that: it restates every token value it needs "so that `{…}` references resolve without the parent bundle", the Lucide subset is self-hosted in this repository, and the mockup is here too. So the eight components are implemented locally **under the parent's names**, against DESIGN.md's stated values, which keeps a later swap to the real bundle an import change rather than a rewrite. `[ASSUMPTION]` Confirm when the Business Suite bundle becomes reachable.

**Three unspecified points, resolved by the documents' own rules rather than invented.**
1. *Breadcrumb link colour.* The mockup renders them muted, which contradicts DESIGN.md's "teal is the only interactive colour: links". EXPERIENCE.md's precedence rule says visual values follow DESIGN.md and both beat the prototype, so breadcrumb links are teal.
2. *Top bar contents.* DESIGN.md specifies the bell with an `info-solid` unread count and nothing else. The mockup's "Signed in as" switcher is explicitly disclaimed as a prototype affordance. The top bar therefore carries the bell only; inventing a user menu here would pre-empt Story 1.5.
3. *The ribbon sentence.* The mockup's wording predates the Population Source / Target System split. DESIGN.md's sentence is the one that ships.

**Why hiding Administration is not enough.** EXPERIENCE.md makes Administration the one item removed rather than disabled, which is a presentation rule. A hidden link is not a control: anyone can type the path. So the route calls `requireAction`, which resolves the role fresh, applies the domain policy and audits the refusal. This is also the first production caller of that path, which Story 1.3 deferred for want of a gated surface.

**Why Playwright rather than jsdom.** The accessibility floor is the point of this story, and axe against a real browser is the only check that means anything; a jsdom approximation would pass things a browser fails. Playwright is already pinned, so wiring it costs one config file and closes a deferred item, while adding a DOM test environment would buy a weaker signal for a new dependency.

## Verification

**Commands:**
- `pnpm -r typecheck` -- expected: clean.
- `pnpm boundaries` -- expected: clean, non-zero module count; no vendor type reaches `domain` or `application`.
- `pnpm test` -- expected: all unit tests pass, including the token and status-vocabulary drift tests.
- `pnpm build && pnpm --filter @intellifin/web build` -- expected: both succeed.
- `pnpm test:e2e` -- expected: axe reports zero WCAG 2.1 AA violations on all three targets, and the shell, keyboard, dialog and breakpoint specs pass.
- `pnpm test:integration` -- expected: still green; this story adds no migration.

**Manual checks:**
- Sign in as each role and confirm Administration appears only for the PoC Administrator, then request `/administration` as an Auditor and confirm the refusal names the verbatim reason.
