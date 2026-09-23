# Package 7 — release checks

The cleanup plan's last package: check every ordinary surface as all three roles, at the
two laptop sizes the walkthrough used, on the INTEGRATED branch — packages 2 to 6 merged
together — and not in five separate worktrees where each package only ever saw its own
change.

## What is checked, and where it lives

`tests/e2e/ui-cleanup-layout.spec.ts` runs in the ordinary browser suite, so CI runs it
on every pull request. One seed (the `run-surfaces.spec.ts` shape: one Active Procedure,
a Completed Run with a finding, an Inconclusive Run) and three roles:

| Role | Surfaces | How it signs in |
| --- | --- | --- |
| Auditor | 14: Overview, Procedures, New procedure, a Procedure, Runs, a Run's Result, Evidence, Exceptions, Review, Timeline and Replay tabs, an Inconclusive Run, Reviews, Notifications | saved state from `auth.setup.ts` |
| PoC Administrator | 4: Overview, Administration, Population sources, Systems | saved state from `auth.setup.ts` |
| Audit Manager | 7: Overview, Reviews (Procedures), Reviews (Results), a version review, Runs, a Run's Result, Notifications | a manager the spec mints and removes (`mintAuditManager`), signed in through the real form |

Each role runs at **1366×768** and **1280×720**: 25 surfaces × 2 sizes = **50 checks**.
On every one:

- a level-one heading is visible;
- the page does not scroll sideways (`scrollWidth` against `clientWidth`, root and body);
- axe finds **no** WCAG 2.1 AA violation (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`; no
  allowlist);
- a keyboard walk of 14 Tab stops: the first is **Skip to content**, and every stop has a
  size, sits inside the viewport and shows a focus ring;
- one screenshot, named `<role>-<surface>-<width>x<height>.png`.

The Audit Manager is minted rather than seeded because CI seeds only the Auditor and the
Administrator, and an extra `audit-manager` row in a shared test database changes the
recipient counts two integration files assert (`run-waits`, `flag-run`). A skipped role
would read as a checked one, so the manager test fails rather than skips when the mint did
not happen.

## What the checks found

- **No focus ring at a date or time field's own calendar or clock stop.** Chromium gives
  those inputs an inner picker button as a separate Tab stop, and matches only
  `:focus-within` on the input while that button has focus — so the global `:focus-visible`
  ring was never drawn there. Found by the keyboard walk on New procedure; proven with a
  bare Chromium page before the rule was written; fixed in `globals.css` (`c63f504`).
- **The walk must stop at the dev overlay.** `next dev` adds a `nextjs-portal` element after
  the page; it is not product and is not in a production build, so the walk ends there.
- **Ten browser specs broke only after the merge**, each because one package changed a
  surface another package's spec pinned (a column moved into Technical details, a label
  renamed, a disclosure closed by default). Each spec was updated to the new surface and
  none was weakened (`b9a105c`, `a8b8341`). One of the ten was a product gap: the Run page
  had lost the initiator's user id, which is now under the frame's Technical details
  (`927f926`).
- **Screenshot review found three sentences that were not true** on the version pages, all
  fixed with tests proven by mutation:
  - the decision bar said **"Not yet submitted for approval."** on an Active version that
    has no submission on record (one a fixture or a migration inserted, or one older than
    submission records) — it now says "No submission is recorded for this version." for
    anything past Draft;
  - an Active one-time version said **"The saved dates are 2026-08-01 to 2026-08-31."** — it
    now says "1–31 Aug 2026";
  - a scheduled version said **"Saved Schedule: monthly at 06:00 UTC."** and printed the
    first period start as a raw ISO instant — it now says "Planned: monthly (nothing runs
    by itself yet). Intended start time: 06:00 UTC." and shows the instant readably, with
    the ISO value in `datetime`.
- **Report claims checked against tests.** Two package 5 claims had no test behind them.
  The stop sentence for an unresolved record key is now pinned (`c2aa58e`); the report was
  corrected where the claim was wrong.

## Results

On `a8b8341`, against a database seeded the way CI seeds it (Auditor and Administrator
only), on one machine with nothing else running:

| Check | Result |
| --- | --- |
| Typecheck (every package and the root tests) | passed |
| Architecture boundaries | passed, 717 modules |
| Unit tests | **4,958 of 4,958** passed, 257 files |
| Integration tests (PostgreSQL 18) | **610 of 610** passed, 50 files |
| Browser tests (whole suite, one worker, no retries) | **238 of 238** passed in 22.3 minutes |

The three version-page fixes came after that run. They were checked with typecheck, the
whole unit suite and the four browser specs that show those pages (`version-review`,
`immutable-versions`, `procedures`, `ui-cleanup-layout`) — see **After the version-page
fixes** below.

### Mutation proofs

A test that cannot fail for its reason is not a test, so each of these was broken on
purpose and the named test had to fail:

| Rule | Mutation | Result |
| --- | --- | --- |
| UX-47: the step counter never exceeds its total | count attempts instead of steps | 4 failed, then 17/17 with the fix restored |
| UX-18: the Result's first cell is named Execution | make it say "Run lifecycle" again | 1 failed, 61 passed |
| A version past Draft is never "not yet submitted" | render the Draft sentence for every state | decision bar test failed |
| Saved dates are readable | print `from to to` | status test failed |
| The first period start is readable | print the raw instant | status test failed |

## Screenshots

`screenshots/` holds the 25 surfaces at **1366×768**, named `<role>-<surface>-1366x768.png`.
The 1280×720 set is not committed; point `UI_CLEANUP_SCREENSHOTS` at a folder and run the
spec to produce both sizes.

## Named and not fixed

- **"Escalation answered." can vanish within about 300 ms.** The success banner sits inside
  the Escalation panel, and the refresh that follows the answer removes the panel. The
  answer is stored and the Run moves on; only the confirmation is short-lived. It is older
  than this cleanup and passes when run alone; recorded in `CLAUDE.md` as a follow-up.
- **UX-22 to UX-26** name PR #51's record queue and inspector, which `main` does not have.
  `p5-report.md` states the rule each one needs.

## Deployment

Production (Railway `web` and `worker`) runs `feat/auditor-workspace-v1-1` (PR #51) at
schema generation 61; `main` serves generation 50 only. Merging this branch to `main`
therefore changes nothing in production by itself. A trial merge of this branch into
`feat/auditor-workspace-v1-1` conflicts in 20 files — `CLAUDE.md`, `globals.css`, the
administration page and users panel, the Run detail frame, and the Run surfaces and specs
both branches rewrote (Evidence, Live View, Replay, Escalation, evaluation review, result
sections, pause, flag, lifecycle actions, `run-detail-repository.ts`).
