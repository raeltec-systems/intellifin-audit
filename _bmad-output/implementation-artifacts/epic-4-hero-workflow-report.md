---
title: 'Hero workflow usability pass'
type: 'implementation-report'
created: '2026-09-09'
status: 'final'
branch: 'codex/epic-4-hero-ux, merged into codex/epic-4-agent-runs (PR 24)'
---

# Hero workflow usability pass

The owner's brief (§3 of the Epic 4 continuation): make the hero workflow — create a
Procedure from P-1, author it, submit it — usable by an auditor without a developer beside
them. Editable Drafts, business-language P-1 rules, readiness before paid execution, direct
saves with confirmations only where they bite, honest recovery, AI assistance only through
the existing derivation and preview, all verified in a real browser with keyboard and axe,
with screenshots. Scope was `apps/web` plus one new domain module; no new storage, no
model call, no change to the compiler or to any frozen contract.

Everything below is on the candidate and proven by the gates in section 3. The pictures
are in `hero-ux-screenshots/` (see its README for what each one shows).

## 1. What an auditor meets now

**The Draft says it is editable.** Two sections stay read-only (Control, Objective) and say
so in one sentence each; the Control section names where its editable half, the name, is.
The old "not editable yet, a later release…" sentence — written before Stories 2.2 to 2.5
made every section editable, and sitting under the very control that renames the Draft —
is gone, and a test refuses the phrase anywhere under `apps/web`.

**Ordinary saves are direct.** Period and scope, Population Source, Audit Instructions,
Compliance Rule, Evidence Requirements, Schedule and the Control name save on one click
or one Enter, with "has unsaved changes" while dirty, a saved or refused banner on the
answer, and the existing lost-response recovery. No autosave. The focus-trapping
confirmation stays only where a person cannot take the action back from that page —
submit, approve, reject, edit back to Draft, activation, cancel, rerun — and for scope
expansion: a Target Systems save that ADDS a registration widens what a Run may read, so it
still confirms, and the dialog names the systems being added. Owner decision 2026-09-08,
recorded in EXPERIENCE.md and the UX memlog.

**P-1's C1 is authored in business language.** A checkbox for "no account at all counts
as Compliant", and two lists — the values that count as Compliant and the values that
count as an Exception — write the explicit expression
(`found = false or account_status in [Disabled] else [Active]`). Simple and advanced modes
operate on ONE saved string: switching between them changes nothing, typing in the
advanced textarea pins the condition to advanced, and a text with no simple form stays in
advanced with a sentence saying why. Values are compared exactly and never case-folded;
the editor says so where the values are typed, which is how the "Disabled versus disabled"
problem is resolved — by the author choosing what their Target System displays.

**C2's role-privilege policy is readable.** Three rules instead of one dense sentence,
counts per list, and a role claimed by both lists — or an empty policy — named while it is
typed rather than met as the compiler's one refusal.

**The 24-hour disablement window is a third condition, not a swap.** The Timing controls
add it as C3 beside the account-status rule; an Active account has no disablement instant,
so C1 is what makes that account an Exception and replacing it would have dropped the
finding the Template exists to make. The added condition carries the frozen mapping that
says compiler 1's `termination_time` is the source's `termination_effective_time` column,
exactly as Story 4.12's evidence path freezes it. Readiness then names the two things the
window cannot substantiate on its own: a bound source that declares only a termination
date, and no Evidence Requirement for `disabled_time` — and Evidence Requirements offers
that exact requirement with one click. Removing the window clears both.

**Readiness before execution.** A panel on the Builder and on the version review page
answers "what would make this Run produce nothing useful?" from the Draft's own inputs:
no Target System, a desktop system this release cannot execute (named), no Population
Source (naming who can register one), an Agent-Judged roles condition with no policy,
the two window gaps above, and a model-read attribute with no grounding. It is advice:
it blocks no save, gates no submission and stores nothing, and it always says that it read
the Draft and never a Target System, so a clean list is not a promise.

**What the agent will do.** A summary derived from the frozen executable plan — how many
systems, which steps against each, what is captured, the limits the Run stops itself at —
above the full read-only plan preview. It compiles nothing and calls no model.

**Honest recovery.** A path that threw now says the change may have been saved and to
reload, never "Nothing was changed"; a creation whose response was lost blocks a second
submit and points at the list, because creation has no request token and a retry would
make a second Procedure.

**Editing an Approved or Active version** is stated per state where the rule applies, with
the New version control beside it, on the Procedure page and the version review page.

## 2. What is deliberately not built

- **Creation idempotency.** `createProcedure` mints both ids inside the command and takes no
  request token, so a retry after a lost response really makes a second Procedure. The form
  blocks the retry and says where to look; a token means storage, which the brief excluded.
  Proposed contract: the run-request-token shape (`docs/contracts/run-request-token-v1.md`),
  one row per token recording the decision.
- **Choosing the termination column in the Builder.** The Timing control freezes the
  mapping to `termination_effective_time`, the column the canonical instant-bearing source
  declares. A source that declares the instant under another name is reported by readiness
  with the column it looked for; authoring a different mapping is possible through the
  command and not yet through a control.
- **No chat, no natural-language-to-rule compiler, no model call on the authoring path.**
  AI assistance stays where it was: plan derivation and its preview.

## 3. Verification

All on the merged candidate (the hero branch with `codex/epic-4-agent-runs` merged in),
against PostgreSQL 18 at schema generation 41, Node 24.20.0, pnpm 11.25.0.

| Gate | Result |
|---|---|
| Typecheck (packages, apps, root tests) | passed |
| Unit | 3641 tests, all passed; two `session-route.test.ts` cases timed out once under CPU contention with a concurrent run and passed alone (38 of 38 in the re-run of the three touched files) |
| Boundaries | no violation, 519 modules cruised |
| Build | passed |
| Browser (`hero-workflow`, `procedures`, `version-review`, `executable-plan`, `disablement-window-journey`) | 34 passed, 0 failed, 5.4 minutes; keyboard-only operation of the simple editor and the direct save; WCAG 2.1 AA scans on the Builder before and after the window, on the scope dialog and on the completed Draft, all clean |
| Mutation anchors | every `before:` anchor in the four harnesses occurs exactly once on the merged tree |
| Screenshots | 15, one per proven state, in `hero-ux-screenshots/` |

The hosted CI result on the merge head and the live acceptance are recorded in
`epic-4-story-status.md` and on PR 24 when they complete.

## 4. Decisions recorded

CLAUDE.md (two 2026-09-09 entries: the hero workflow's rules, and `sql.json` on a
Drizzle-wrapped client), EXPERIENCE.md's confirmation table with its dated revision note,
and the UX memlog. The `sql.json` finding came out of the populated-upgrade proof: two
integration cases failed on any database that already held a published platform
configuration, and a third had been passing without reaching the CHECK it asserts; all
three are repaired in this candidate.

## 5. Try it

1. Sign in as an Auditor and open Procedures, then New Procedure. Pick P-1 (nothing is
   pre-selected) and name the control. Creation still confirms.
2. On the Builder, read "What the agent will do" and "Readiness before execution": three
   items on a fresh Draft.
3. In Compliance Rule, C1 opens in the simple editor. Type `Disabled` and `Active`, watch
   the saved rule update, switch to Advanced and back. Add the C2 policy; put a role in
   both lists and see it named. Press Enter on Save: no dialog, saved banner, focus stays.
4. Bind a Population Source; the readiness item clears. Under Timing, add the 24-hour
   window: C3 appears, readiness names the date-only source and the missing capture;
   accept the offered `disabled_time` requirement in Evidence Requirements; remove the
   window again.
5. Add a Target System and save: this one confirms, and names the system.
6. Submit stays unavailable for one stated reason, the executable plan, until the worker
   derives it.
