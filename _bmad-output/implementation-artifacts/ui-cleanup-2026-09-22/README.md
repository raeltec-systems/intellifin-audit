# UI cleanup — 22 September 2026

The owner walked the deployed product on 21 September 2026 as all three roles and filed
forty-nine findings (seventeen P1) with a cleanup plan in eight packages. This folder is
the record of implementing it: one report per package (`p2-report.md` … `p6-report.md`),
the release checks (`p7-acceptance.md`) and this summary.

## Baseline (package 0)

- **Production runs PR #51's branch, not `main`.** Railway's `web` and `worker` services
  are connected to `feat/auditor-workspace-v1-1` at `ec673a0` (deployed 21 September
  09:51 UTC, outside the Release workflow); the production database is at schema
  generation **61**. `main` (`44fb596`) supports generation 50 only, so a `main` image
  refuses to start against production — its 21 September redeploy FAILED twice for that
  reason. Nothing merged to `main` can reach production until PR #51 (or its eleven
  migrations) lands, or Railway is pointed back at `main` against a database that can
  serve it.
- **The walkthrough was made against PR #51's build.** Its record queue and inspector
  (`RecordReview`, `RunWorkspaceShell`, `WorkspacePreview`) do not exist on `main`, so
  findings UX-22 to UX-26 name surfaces this branch does not have. The rules those
  findings need are implemented in the shared layer and on `main`'s own Evidence
  surfaces, and are named per finding in `p5-report.md` for the follow-up on top of PR #51.
- **This cleanup is based on `main`.** PR #51 is a 44-commit, 122k-line draft with red
  CI that its author is splitting into `feat/pr51-*` branches; building on it would put
  this work on a moving base. The shared-language layer is what both branches need, and
  it lives in modules PR #51's surfaces can import.
- **Contract first.** The UX contract (`EXPERIENCE.md`) was revised in place where a row
  changed (formats, information architecture, data tables, the conclusion triptych, the
  Reviews states) and the walkthrough's decisions were appended as their own section and
  logged in the UX memlog, so the copy tests keep pinning sentences against the artifact
  on disk. Packages 2–6 implement against that section and did not edit the contract.

## Package 1 — the shared language and layout layer (`290ca5f`, `7b6a695`)

| Module | What it gives every surface |
| --- | --- |
| `design/time.ts`, `Timestamp.tsx` | `21 Sep 2026, 12:24:45 UTC` on ordinary surfaces; the ISO instant in `datetime` and under Technical details; `readablePeriod` (`1–31 Aug 2026`) |
| `design/references.ts`, `Reference.tsx` | `Run bf4ea3e7` — the identifier's last eight characters beside the thing a person recognises |
| `design/TechnicalDetails.tsx` | the ONE closed disclosure for identifiers, digests, plan-step ids, HTTP facts |
| `design/status-words.ts` | Execution / Assessment / Evidence checks, with a meaning for every state of the three families |
| `design/PageHeader.tsx`, `Banner variant="line"` | the title, its badge and the page controls on one row; the "Updated" strip as one line |
| `design/words.ts` | `countNoun` — `1 Observation`, `2 Observations` |
| `procedures/condition-words.ts` | a Compliance Rule condition as "Acceptable: … Exception: … Any other … needs review." |
| `nav-rules.ts`, `breadcrumb-rules.ts` | Reviews; Users · Population sources · Systems; administration detail pages trail themselves by name |

The Run header, its banners and its action bar use the layer (`detail.tsx`,
`RunLifecycleActions.tsx`, `LiveBanner.tsx`).

## Packages 2–6

_Filled in from each package's report when it lands._

## Package 7 — release checks

_Filled in when the checks run on the integrated branch._

## What this cleanup does not deliver (tracked separately, stated on the surfaces)

Result submission, manager approval and finalization; automatic scheduling; source and
connection validation; user invitation and password recovery.
