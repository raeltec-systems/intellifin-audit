# UI cleanup package 5 — Results, Exceptions, Evidence, Replay and Live View

Branch `ui/p5`, seven commits on `7b6a695`, merged into the integration branch. The package
agents were stopped by a usage limit before they wrote this report; the integrator wrote it
from the commits, their messages and the diffs, and ran the verification on the integrated
branch (below). Nothing here claims a result that was not seen.

The walkthrough measured the completed Result page at **7,132px**, with three historical AI
assessments above the conclusion, twenty Gate rows expanded, an Exception headed by a UUID,
Replay narrating plan-step ids and HTTP facts, and a Live View whose screen started below the
fold and whose counter read "Step 7 of 6" after a pause.

---

## Findings

| Finding | What changed | Where | Proven by |
| --- | --- | --- | --- |
| **UX-18** (P1) three words, three meanings | The conclusion triptych's cells are `STATUS_COLUMN_WORDS` — Execution, Assessment, Evidence checks — each with its meaning under the badge; an unsealed Result says how many assessments need a person by exact count (`pendingAssessmentSentence`). | `Triptych.tsx`, `result-words.ts` | `RunDetail.test.ts`; `result-first.spec.ts` |
| **UX-19** (P1) conclusion first | The Result page reads: conclusion; what needs the reader (the pending confirmations, moved OUT of the frame that rendered them above every tab); the records named; coverage; the Gate; the Evidence package; Technical details. A SEALED Result's decisions are a closed "Review history". | `app/runs/[id]/page.tsx`, `ResultSections.tsx`, `detail.tsx`, `EvaluationReview.tsx` | `result-first.spec.ts` (both cases: unsealed puts the confirmations between the conclusion and the named records, open; sealed is under 3,200px, has no horizontal overflow, keeps the order, passes axe); `evaluation-review.spec.ts` opens the history before reading it |
| **UX-20** (P2) twenty open checks | Failed Gate rows lead, open, under a heading that counts them; passed rows are one summary line behind one native disclosure; the specification citation and the diagnostic code are under each row's Technical details (`gate-rows.ts` still holds the pinned transcription). | `GateChecklist.tsx` | `run-surfaces.spec.ts` (Inconclusive Result), `result-first.spec.ts` (no `§` printed), `RunDetail.test.ts` |
| **UX-21** (P1) an Exception a control owner can read | Each Exception leads with the record and the Target System's NAME (resolved through the frozen plan, the 2026-09-17 Work Item rule), says why in a sentence through `conditionSentence`, states Expected against Observed, and links in one click to the record's grounding inspector on the Evidence tab and to Replay at its Work Item. The Exception UUID, fingerprint, immutable condition set and raised-at instant are under Technical details. `MASKED_VALUE` masking is unchanged and now also covers the captured identity the Target System showed. A new bounded read, `readObservationsByIds`, gives every Exception its captured value (the paged `readObservations` stopped at fifty rows). | `ExceptionList.tsx`, `Criterion.tsx`, `app/runs/[id]/exceptions/page.tsx`, `run-detail-repository.ts` | `RunDetail.test.ts` |
| **UX-27** (P2) the policy sentence everywhere | Each surface says the untrusted-content policy ONCE, above its untrusted blocks (`UntrustedRegion` / `UntrustedPolicy`); every block keeps its short source label and stays an inert `<pre>`. `UntrustedText.tsx` still renders the pinned constant. | `UntrustedText.tsx`, Evidence cards, grounding inspector, Exceptions, Result, review list, Escalation panel | `RunDetail.test.ts`, `GroundingInspector.test.ts`, `EvaluationReview.test.ts`, `EscalationPanel.test.ts` |
| **UX-28** (P2) Replay in audit words | `session-words.ts` narrates the plan action and the Tool Action ("Searching LoanCore for E-000103", "Opening the record for E-000103 on LoanCore"); plan-step ids, ISO instants, HTTP method and status, digests and the workspace reference are under Technical details on the rail; the chrome strip carries the mode word and the pinned isolation note. The frame's `alt` is still the Step narration (UX-DR37). | `session-words.ts`, `ReplayViewer.tsx`, `LiveViewer.tsx`, `live-view.ts` | `session-words.test.ts`, `live-view.test.ts`, `ReplayViewer.test.ts`, `replay.spec.ts` |
| **UX-29** (P2) two counters, controls below the fold | One global frame counter with the selected record's own position beside it; Play, the scrubber and the frame are inside the first viewport at 1366×768 (the controls sit at the top of the rail, beside the screen). | `ReplayViewer.tsx`, CSS region | `replay.spec.ts` "puts the Play control inside the first viewport at 1366x768" |
| **UX-47** (P1) "Step 7 of 6" | The counter counts LOGICAL steps — distinct plan steps the frozen plan declares — so it cannot exceed its denominator; a retry is said beside it ("This is attempt 2"). Live View reads the exact count in SQL (`readLogicalStepProgress`), because the same rule over the bounded detail page under-reports a long Run. | `live-view.ts`, `run-detail-repository.ts` | `live-view.test.ts` (a superseded and a restarted attempt), `logical-step-progress.test.ts` (integration, held to the unit rule), `pause-resume.spec.ts` "counts logical steps, so pause, resume and completion never take the counter past its denominator" |
| **UX-48** (P2) the screen below the fold | `PageHeader` carries the title, the badge and Pause / Resume, Cancel and Flag (still inside the live gate); the frame is the first thing in the body; the Evidence inventory is behind a disclosure; the flag form opens from one native disclosure, still with no JavaScript needed. The frame keeps the column's full width, height bounded by `object-fit: contain`. | `app/runs/[id]/live/page.tsx`, `LiveViewer.tsx`, `RunFlagControl.tsx`, `LiveGate.tsx` | `live-view.spec.ts` "puts the workspace screen inside the first viewport at 1366x768", `LiveViewer.test.ts`, `flag-run.spec.ts` |
| **UX-49** (P2) stale transitional words | "Pause requested." and "Cancellation requested." are dropped once the Run state they announced has settled (`useTransitionalMessage`); the rail's no-Work-Item sentence is true of every Run state, so a finished Run is no longer told nothing is being worked "yet". | `transitional-message.ts`, `RunPauseControls.tsx`, `RunCancelControl.tsx`, `session-words.ts` | `transitional-message.test.ts`, `session-words.test.ts`, `pause-resume.spec.ts` |
| **UX-02 / UX-31** | Every instant on the Timeline, Evidence cards, grounding inspector, evaluation review, flag record and Escalation deadline is a `<Timestamp>`; every count with a noun goes through `countNoun` (`1 Observations`, `1 attempts`, `5 of 5 Step Executions` are gone). | `Timeline.tsx`, `EvidenceCards.tsx`, `EscalationPanel.tsx`, `copy.ts` (`REPLAY_COPY.observationsThrough`) | `RunDetail.test.ts`, `ExecutionFailurePanel.test.ts` |
| Stop reason | `population-key-unresolved` says what to do, generically: "A record’s reference is missing, or two records share one. Review the affected source records before running this test again." | `stop-reason.ts` | `stop-reason.test.ts` (added at integration: the package left the new sentence unpinned) |
| Review tab | The empty state is the whole statement — Result submission and review are not in this release — and points at the one review this release has: the confirmations on the Result tab. The "does not mean a control passed" clause stays. | `app/runs/[id]/review/page.tsx`, `copy.ts` | `copy.test.ts` |

## Assertions rewritten because they pinned the OLD behaviour

- The frame's `alt` containing a plan-step id; `1 Observations`; the raw `ACQUIRED` token;
  "No Work Item is being worked yet." on a finished Run.
- The Exception card's identifier heading; the "Original/Current effective Exception
  conditions" headings; `not.toContain('<a ')` on the Exceptions page (right while Exception
  Detail did not exist; both link destinations now do).
- "Pause requested." / "Run resumed." / "Cancellation requested." visible after the Run state
  settled; the flag form visible without opening its disclosure.
- `run-surfaces.spec.ts`: the heading "Failed checks", the code word and the "(§C)" citation
  on the page (UX-20 moved all three); the Step Executions summary's plural; the refresh
  strip's ISO form, which package 1 made readable, so it failed on the base commit too.
- `evaluation-review.spec.ts`: a sealed Result's stored decisions are read after opening the
  closed Review history.

## Deployed acceptance harness

`scripts/verify-deployed-loancore.mjs` still finds every Run-page control it uses: the
`Execution Timeline` and `Evidence` tabs, `Watch`, `Replay`, `Play`, `img.ls-session__frame`,
`[data-live-status]`, `li.ls-evaluation` with its `Confirm evaluation` control and the
`Review submitted.` banner. Nothing was renamed.

## The rule each PR #51-only finding needs (UX-22 to UX-26)

These name `RecordReview`, `RunWorkspaceShell` and `WorkspacePreview`, which exist only on
`feat/auditor-workspace-v1-1`. None of their wordings exists on this base. The rules, so the
fix is applied on top of that branch rather than rebuilt:

- **UX-22 — the record queue opens on records.** Counts and filters on one compact line; the
  quality/count metadata behind one closed disclosure (the `GateChecklist` pattern: failed
  items open, passed ones summarised); Exceptions first; select the first Exception so the
  inspector is never blank on arrival.
- **UX-23 — one scroll model.** Use this branch's `PageHeader`, line `Banner` and toolbar in
  `RunWorkspaceShell`; the page scrolls, the record list is `position: sticky` beside the
  inspector, and no third scrollbar is introduced.
- **UX-24 — no implementation statements.** Remove "bytes load only", "protected preview or
  snapshot route", "independently authorized", "current Result and review revision",
  "selected-record projection" and "inert presentation content". Say instead where the
  evidence came from (system name and page), when it was captured (`<Timestamp>`), which
  checks ran and what the person must decide. Anything technical goes under
  `TechnicalDetails`; the untrusted-content policy is said once per surface (UX-27's rule).
- **UX-25 — one record label everywhere.** The record key plus the best permitted display
  label — `full_name` only when the bound source does not list it in `sensitive_fields`,
  otherwise `MASKED_VALUE` — the rule `ExceptionList` now applies; use the same label on the
  list, the inspector, the Exception and Replay (`workItemLabel` in `labels.ts` is the one
  place a record becomes a word).
- **UX-26 — say which check ran.** Replace "Recorded in selected metadata", "Fingerprint
  recorded" and "No problem recorded" with the check and its result ("Screenshot matches its
  stored digest", "Not verified yet"), keep verified and unverified visibly different, and
  give the next action when a check is missing or failed.

## Left out and why

- **Mutation proofs are the integrator's, not the package's.** The package agents recorded
  none; the two the integrator ran are listed under Verification.
- **No new browser fixture seeds a Work Item on Live View.** The `[NAMED]` gap in CLAUDE.md
  (2026-09-17) is unchanged; the counter is proven by `pause-resume.spec.ts` and the unit
  and integration tests instead.

## Needs a change outside this package

None beyond the PR #51 rules above.

## Gotchas for CLAUDE.md

- **A layout rule written above a package's CSS region leaks into every surface.** The first
  session-viewer pass edited shared rules and bounded every frame at 220px; the rules belong
  in the region, and a frame keeps its column width with `object-fit: contain`.
- **A count over a bounded detail page under-reports a long Run.** The logical step counter
  reads an exact SQL aggregate, and an integration test holds it to the unit rule.
- **The shared label/value rule gives the value a content-sized column, so a sentence-long
  value overprints its own label.** A reconciliation sentence did exactly that; stack label
  and value where the value is prose, and assert no overlap in the browser.

## Verification

The suites ran on the integrated branch — see the README's package 7 section for the
commands and the results. Two mutation proofs ran in this package's own worktree, each
restored by `git checkout` against the committed fix:

| Mutation | Test run | Result |
| --- | --- | --- |
| UX-47: `logicalStepProgress` returns `started: executions.length` (attempts, the old rule) | `live-view.test.ts` | 4 failed, 13 passed; restored: 17 of 17 passed |
| UX-18: the triptych's first cell says "Run lifecycle" again | `RunDetail.test.ts` | "labels its three cells with the three QUESTIONS, in the contract’s order" failed; 61 others passed |
