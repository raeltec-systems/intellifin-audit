# The deployed LoanCore acceptance journey — 2026-09-17

**Status:** repairs landed; the deployed run is what settles the gate.
**Owner's gate:** one unbroken journey — create a Procedure in the browser, configure it,
submit it, have a SECOND person approve it, activate it, start the Run, watch it inspect
records, check every conclusion against the predetermined truth, replay it, and then repeat
the whole thing with the defective population and require a refusal.

This report is the repair record. The results of the deployed run are appended at the end.

---

## 1. Two product defects stopped the journey, and both were in the surface

Driving the journey locally against the real build — a copy of the acceptance harness pointed
at a local web server — found two defects that no suite in the repository had. Neither is in
the domain.

### A controlled input discards what was typed before React attached

The Procedure form was repaired for this in `7efb284`. The same shape was still live one page
earlier, on **sign-in**, where the cost is a CREDENTIAL. Fill the fields while the bundle is
still loading and React's initial empty state replaces them on hydrate, so the POST carries
`{"email":"","password":""}`, Better Auth answers **400**, and the person is told
**"Check your email address and password."** about a credential they typed correctly.

It is intermittent by construction: it depends on whether the person types faster than the
bundle loads — which a fast operator and a cold deploy both reach.

The repair is the Procedure form's: a native `<fieldset disabled>`, which is the only guard
that holds BEFORE handlers exist; a `data-signin-ready` marker; and the two sentences in
ordinary markup, never `<noscript>`.

**The decisive assertion is what was SENT.** `tests/e2e/sign-in-readiness.spec.ts` blocks the
scripts, types, releases them, submits, and reads the request body: `sent.email` and
`sent.password` must be what was typed. An assertion that the sign-in *succeeded* passes on a
build with no guard at all, because a browser quick enough to be tested is usually quick
enough to hydrate first.

### A successful save declared a conflict, and blocked every section review

`compileComplianceDraft` trims, deduplicates and SORTS a role-privilege policy's lists.
`useSection.begin()` recorded the edit AS TYPED, so the next server snapshot differed from it
and `observe()` flagged `conflict`. Every "Mark reviewed" control then refused with
**"Resolve the saved-value conflict in Compliance Rule before submitting."** — naming a
conflict with nothing on screen to resolve — and submission was blocked until reload.

`storedComplianceInput` now ASKS the compiler what will be stored rather than restating its
rules. A second copy of a normalisation diverges on the first edge nobody tried, which is why
this is a call into the compiler and not a `sort()` in the form.

An input the compiler REFUSES is returned unchanged, deliberately: the command refuses that
save too, so the section reports the refusal; normalising a refused input would compare the
server's snapshot against something no save could ever produce.

**The journey is the test that finds this class.** Six saves and six section reviews pass
individually in `procedures.spec.ts`; what fails is saving one section and then reviewing
ANOTHER, which only a journey does.

---

## 2. The acceptance was checking the wrong things, in five places

The harness is what produces the proof, so a check that cannot fail is a proof that is not one.

1. **An aggregate count of Exceptions is true of a build that flagged the WRONG leaver.**
   The old check asserted six evaluations, one C1 Exception and three C2 Compliant — all of
   which hold if E-000102 were reported as retaining access and E-000103 as disabled.
   `scripts/acceptance-truth.mjs` now compares PER RECORD and PER CONDITION against
   `p-1-live-acceptance.json` read off disk, and has its own tests
   (`tests/unit/acceptance-truth.test.ts`) — including a swap case that asserts the totals are
   IDENTICAL before asserting the comparison catches it.
2. **`providerHandleContained = true` was a literal.** The containment is real, but the check
   could not fail. It now requires a known provider identity and a counted number of page
   scans taken AFTER it became known.
3. **The Execution Timeline could not say WHICH record a Work Item inspected.** See §3.
4. **The workflow's `push` trigger RACED the release**, so the previous run drove the PREVIOUS
   build. The trigger is gone; the workflow refuses to start unless `/sign-in` server-renders
   the hydration marker, which one public request settles before any identity is created.
5. **The Evidence-link check looked for phrases no page renders**, so a link showing the
   inspector's failure banner was reported as opened. It now matches
   `Snapshot cell unavailable` and `Couldn't load this page. Nothing was changed.`, both pinned
   by `tests/unit/acceptance-sentences.test.ts`, which reads the pages off disk.

The workflow also patched the harness's source at run time to add a repository — a second copy
of a command shape only the workflow could break. Folded into the script.

---

## 3. Four surfaces named the system where they should have named the record

`display_name` is the TARGET SYSTEM's name and is **identical on every Work Item of a Run**.
A three-leaver Run therefore rendered three rows, three pills and one rail that all said
"LoanCore" — on the surfaces whose whole job is to let a person follow ONE record from the
screen that was captured to the conclusion drawn from it.

| Surface | What it showed | Now |
|---|---|---|
| Execution Timeline row | three rows reading `LoanCore` | `E-000103`, with the system beside the counts |
| Live View rail (**Watch**) | `LoanCore · RUNNING · 1 Observations`, whichever leaver was being inspected — the page hard-coded `subjectKey: null` | `E-000103 · LoanCore · RUNNING · 1 Observations` |
| Replay jump list | three pills reading `LoanCore`, beside an Exception pill that already named its record | `E-000102 · LoanCore`, `E-000103 · LoanCore`, … |
| Frame `alt` and every Replay scrubber pill | `…on LoanCore…` — a screen-reader user heard three indistinguishable labels | `…for E-000103 on LoanCore…` |

`workItemLabel` lives in `apps/web/src/runs/labels.ts`, where the other stored-value-to-word
rules are, because three surfaces say it; the Timeline keeps its two-span title/detail layout
and implements the same rule. `subjectKey` is REQUIRED on `ReplayWorkItem`, which is what found
both Replay call sites.

**The replay browser fixture gave each Work Item its own `display_name`** — a row no Run can
produce, since both named registration `loancore`. That is why the suite could not see any of
this. Both are `LoanCore` now and the spec asserts two distinct pills.

**`[NAMED, NOT BUILT]`** `live-view.spec.ts` seeds neither `run_work_item` nor `run_agent_work`,
so the rail's Work Item line is covered by nothing in CI. The deployed acceptance requires
`watchNamesTheRecord` on the real surface; the fixture a later story should add is written down
rather than papered over.

---

## 4. A Result that waits for a person is not a conclusion

The acceptance stopped at `PENDING_CONFIRMATION` with `sealed` false and called the journey
proven. C2 is Agent-Judged, so Story 4.9 holds the Result open until a person confirms or
rejects each machine proposal. A Run that produced findings and no conclusion had completed the
agent's half of the journey and none of the auditor's.

`confirmAgentJudged()` drives the real **Confirm evaluation** control and then checks what the
platform stored:

- one row per page load, because the component calls `router.refresh()` and the list re-renders
  under the control that was just used;
- `aria-disabled` rather than Playwright's enabled check, because a control with a reason stays
  focusable so its reason is reachable;
- the STORED `run_result`, never the banner — the decision is queued to the worker;
- the expected outcome is the oracle's own
  `expected_outcome_after_required_human_confirmation`, never a literal typed beside it;
- the per-record comparison is repeated after sealing, because confirming a proposal is a write.

It runs only when the Run really is waiting on a person. On any other Result the two checks stay
absent, which leaves `accepted` false — the honest answer for a journey that did not get there.

---

## 5. What the deployed run is required to prove

`report.required` — every one must be `true` or the job fails:

`selfApprovalRefused`, `independentApproval`, `liveConnected`, `visibleInspection`,
`watchNamesTheRecord`, `threeRecordsInspected`, `populationValid`, `gatePassed`,
`expectedEvaluations`, `conclusionsMatchTruth`, `evidencePerConclusion`,
`timelineNamesEveryRecord`, `evidenceLinksOpen`, `replayPlayback`, `replayNamesEveryRecord`,
`workspaceReleased`, `providerHandleContained`, `expectedPendingReview`,
`humanConfirmationSeals`, `sealedConclusionsMatchTruth`, and — with the negative case —
`defectivePopulationRefused`.

The predetermined truth (`fixtures/northstar/expectations/p-1-live-acceptance.json`, never shown
to the agent):

| Record | LoanCore status | C1 | C2 |
|---|---|---|---|
| E-000102 | Disabled | Compliant | Compliant |
| E-000103 | **Active** | **Exception** | Compliant |
| E-000105 | Disabled (exactly 24h) | Compliant | Compliant |

Overall outcome after the required human confirmation: **Control Failure**.

The negative case binds the unchanged defective 27-row export, which declares `E-000107` twice.
It must stop, issue no conclusion about ANY record, and name that key on the Gate. "The Run
failed" alone would pass for a Run that failed for any other reason.

---

## 6. Results of the deployed run

_Appended when the run completes._

---

## 7. Production state at the time of the run

- Schema generation **50**; web and worker both report `supportedSchemaRange 50..50`.
- Worker: `Agent Workspace mode selected · mode=solari · recording=false`.
- Recording stays OFF: Solari records input values by default and the sign-in TYPES a
  credential into a form field, so an ON session puts a working credential on a third party's
  servers permanently. Replay does not depend on it.
- The deployed acceptance population is byte-identical to `leavers-live-acceptance.csv` in this
  repository, checked by digest before any identity is created.
