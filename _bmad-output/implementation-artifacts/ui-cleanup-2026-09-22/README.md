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

Each package worked in its own worktree, database and ports, and wrote its own report. All
five merged into `codex/epic-2-procedure-builder` without a conflict.

| Package | Findings | What a person now sees | Report |
| --- | --- | --- | --- |
| **2** Landing pages, Reviews, lists | UX-01, 03, 04, 17, 30, 32, 35, 36, 37 (Overview) | Each role lands on its own work: an Auditor on drafts, tests needing attention and assessments to confirm; a Manager on versions awaiting approval; an Administrator on users, sources and systems. **Reviews** has Procedures and Results tabs, with real queues and an honest note that Result review is not in this release. The Procedures list is searchable, filtered and paged. The Runs table has six columns and no sideways scroll. The bell lists open items. | `p2-report.md` |
| **3** Writing a procedure | UX-05 to UX-16 | A **Procedure name**, one-click creation, one introduction. The assistant proposes the period and the scope together. A searchable source chooser, filters that wait for a source, criteria as sentences, a **Planned frequency**, and readiness lines that name the Builder's own sections and link to them. | `p3-report.md` |
| **4** Manager's version review | UX-33, 34 | A decision summary first, a sticky decision bar with Approve and Reject, "First version: nothing to compare", changes as before → after in words, and the frozen contract once, behind Technical details. | `p4-report.md` |
| **5** Results, Exceptions, Replay, Live View | UX-18 to 21, 27 to 29, 47 to 49; rules for UX-22 to 26 | The Result reads conclusion first: Execution, Assessment and Evidence checks, each with its meaning. Failed checks are open and passed ones closed. An Exception names the record, the system and the reason, and links to its evidence and replay. Replay and Live View narrate in audit words, with the screen and controls in the first viewport. The step counter never exceeds its total. | `p5-report.md` |
| **6** Administration | UX-37 (Administration), 38 to 46 | Users, Population sources and Systems tabs; a landing with exact counts and health lines; a searchable user directory; inventories before create forms; guided source and system forms; and the Procedures a change affects, named before it is saved. | `p6-report.md` |

UX-02 (readable instants) and UX-31 (references, counts, sentence case) apply on every
surface above, through the package 1 layer.

**UX-22 to UX-26 are not in this branch, by design.** They name the record queue and
inspector that exist only on PR #51's branch. `p5-report.md` states the rule each one needs,
so the fix is applied on top of that branch rather than rebuilt here and thrown away at the
merge.

## Package 7 — release checks

_Filled in when the checks run on the integrated branch._

## What this cleanup does not deliver (tracked separately, stated on the surfaces)

Result submission, manager approval and finalization; automatic scheduling; source and
connection validation; user invitation and password recovery.
