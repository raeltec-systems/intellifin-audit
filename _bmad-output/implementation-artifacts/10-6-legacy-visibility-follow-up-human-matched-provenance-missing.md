---
title: 'Legacy visibility follow-up: human-matched provenance, missing-frame indication and exact pause and resume linkage on the retained compiler-1 surfaces'
type: 'fix'
created: '2026-09-25'
status: 'in-progress'
review_loop_iteration: 0
implementation_authorised: true
baseline_commit: 429e08cf703fee6c5320f17b5983948709fd5bdf
context:
  - '_bmad-output/implementation-artifacts/legacy-review-closure-register.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - 'docs/contracts/durable-escalation-v1.md'
  - 'docs/contracts/replay-asset-set-v1.md'
  - 'docs/contracts/replay-v1.md'
  - 'docs/contracts/run-pause-v1.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The legacy review closure register (Story 10.1) found compiler-1 acceptance legs
that `main` at `c18ad36` does not meet on its retained surfaces. (1) Story 4.7: a record chosen
by a person through a secondary key is recorded on its Observation as `human-matched`, but the
Result, the record review queue and inspector and the Exceptions list do not show it, so a
reader cannot tell a human-selected match from a platform match. (2) Story 5.2: the platform
records `failure.frame-missing` and counts missing frames in the Result publication, but Replay
never shows either, so playback with a gap looks complete. (3) Story 5.4: the pause and resume
records do not durably identify the exact Step and attempt for every pause and resume. A pause
names its Step Execution only at the six in-flight Work Item boundaries, and no resume names a
Step or the attempt it starts (register §4, Story 5.4). The owner decided on 2026-09-25 to prepare
one bounded Epic 10 follow-up for these legs and not to accept the missing distinctions as
completed behaviour. On the same day the owner added two repairs from the register's §3.1: (4)
Story 5.3: Live View's adapter-only view passes `digest: null` for every Adapter Session Step row,
so each says "No artifact registered." — a wiring defect in `apps/web/app/runs/[id]/live/page.tsx`;
(5) Story 5.6: the "Go to open Escalation" skip link targets a section with no `tabIndex`, and no
evidence shows that activating it moves focus.

**Approach:** Show on the existing retained surfaces the facts the platform already records,
each traceable to the recorded decision or event that establishes it. Where the durable records
cannot establish a fact exactly, add the linkage for new records only. Never infer a link by
time, and never rewrite a historical audit event.

## Boundaries & Constraints

**Always:**
- Human-selected matching is visible on the Result, on the record review queue and inspector,
  and on the Exceptions list, and it traces to its matching decision: the answered
  choose-candidate Escalation (wait, chosen option, actor, time). The trace is read from durable
  records that establish it exactly; if they cannot, new registrations carry the link and older
  ones say the decision is not linked.
- Replay distinguishes a frame that is missing or unavailable (`failure.frame-missing`, a failed
  protected read) from a frame intentionally suppressed during credential entry
  (`capture = 'SUPPRESSED'`), and states the limitation — how many frames are missing and that
  playback is incomplete — rather than implying complete playback.
- The pause and resume records identify the exact plan step and Step Execution attempt for each
  pause and each resume, including repeated pauses and after the Run advances. The register shows
  that the stored records do not do so today, so the owner's rule of 2026-09-25 applies: new
  events only; historical events stay as written, and a surface shows their Step as not recorded.
  A pause between units (at the sign-in or adapter stage, or between Work Items) names the plan
  step at which it holds the Run and says that no Step Execution was in flight (wording: Ask
  First).
- The retained compiler-1 surfaces keep the rules of the 2026-09-01 UX spine (EXPERIENCE.md
  revision 2 §12). A new sentence is added to `copy.ts` or a words module and pinned by a test
  that reads it back, never retyped in a test.
- Live View's adapter rows carry the registered Evidence identity and digest through the real
  page read path, with three situations tested: an acquired step with Evidence, a step with no
  artifact, and an unavailable Evidence read. Never one sentence for all three.
- The Escalation skip-link test is written first: keyboard activation of "Go to open Escalation",
  the resulting focus location, and the next keyboard interaction reaching the panel's controls;
  then the smallest correction (`tabIndex={-1}` on the target, or what the test shows).
- WCAG 2.1 AA on every changed surface, with no allowlist (the retained surfaces' gate).

**Ask First:**
- Any new audit event type, schema column or migration (a generation number and
  `SUPPORTED_SCHEMA_MAX` change in the same commit).
- Any change to the Result publication shape (`isRunResultPublication`, `run-result-v1`).
- Any wording that is not already in the UX artifacts.

**Never:**
- Change the compiler-1 evaluation, the Gate, the seal or the outcome table.
- Rewrite, backfill or re-sign a historical audit event, or infer a link by nearest timestamp.
- Deliver the export legs here: they are 14-11a's explicit criteria.
- Start before explicit implementation authorisation. On 2026-09-25 the owner authorised story
  preparation only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Human-matched record | Observation `matchOrigin = 'human-matched'` with its answered choose-candidate wait | The existing word (`matchOriginWord`: "Human-matched") on the Result, the record review queue and inspector and the Exceptions list, with the answer, actor and time of the matching decision | The decision cannot be read exactly: the flag still shows, and the surface says the decision is not linked (wording: Ask First) |
| Platform match | `matchOrigin = 'platform'` | No human-matched flag | N/A |
| Missing frame | a performed, capture-`PERMITTED` action with no registered screenshot | Replay marks that position as a missing frame and states that playback is incomplete, with the count (wording: Ask First) | A failed protected read is shown as unavailable, and only that frame is retried |
| Suppressed frame | a credential-entry action, `capture = 'SUPPRESSED'` | Replay uses the existing sentence (`captureSentence`: "Capture suppressed — a credential was presented on this request"); never counted as missing | N/A |
| Pause and resume | a Run paused and resumed twice, advancing between | Each pause and each resume names its plan step and Step Execution attempt | A historical record without linkage says its Step was not recorded (wording: Ask First) |
| Adapter row, Evidence registered | an ACQUIRED `extract-adapter` Session Step with its Evidence row | The row shows the Evidence's digest (`Digest`, as Replay does) | An unavailable Evidence read says so (wording: Ask First); a step with no artifact keeps "No artifact registered." |
| Skip link | the Escalation panel present; focus on "Go to open Escalation"; Enter | Focus moves into `#open-escalation`; the next Tab reaches the panel's first control | N/A |

</frozen-after-approval>

## Code Map

- `packages/application/src/runs/agent-human-decision.ts` -- where a choose-candidate answer produces a `human-matched` Observation
- `packages/infrastructure/src/runs/run-detail-repository.ts` -- the read that already carries `matchOrigin`
- `apps/web/src/runs/RecordReview.tsx`, `apps/web/src/runs/ExceptionList.tsx`, `apps/web/src/runs/ResultSections.tsx` -- the surfaces that must show the flag
- `apps/web/src/runs/EvidenceCards.tsx`, `apps/web/src/runs/labels.ts` (`matchOriginWord`) -- the existing words and rendering to reuse
- `packages/domain/src/runs/replay.ts` (`FRAME_MISSING_EVENT`), `packages/application/src/runs/complete-run.ts` (`framesMissing`) -- the recorded facts
- `apps/web/app/runs/[id]/replay/page.tsx`, `apps/web/src/runs/ReplayViewer.tsx`, `apps/web/src/runs/replay.ts` -- Replay
- `packages/application/src/runs/pause-run.ts` (`lifecycle.run-paused`, `lifecycle.run-resumed`), `deferred-pause-run.ts` -- the pause and resume records
- `packages/application/src/runs/execute-agent-work-item.ts` (`lifecycleBoundary`: six in-flight boundaries and the between-Work-Item one), `execute-agent-steps.ts` and `execute-adapter-steps.ts` (`canceledAtBoundary`) -- where a pause is honoured (register §4, Story 5.4, lists each line)
- `packages/infrastructure/src/runs/result-repository.ts` (`readMissingFrames`) -- the missing-frame read
- `apps/web/app/runs/[id]/live/page.tsx:347` (`digest: null`), `apps/web/src/runs/LiveViewer.tsx:366`, `apps/web/app/runs/[id]/replay/page.tsx` (`digestByEvidence`, the repaired sibling) -- the adapter digest wiring
- `apps/web/src/runs/EscalationPanel.tsx:442-443` (the skip link and its target), `apps/web/src/shell/AppShell.tsx:98-100` (the shell's `tabIndex={-1}` precedent), `tests/e2e/live-escalation.spec.ts` -- the skip-link test

## Tasks & Acceptance

**Execution:**

- the read models above -- carry the matching decision, the missing-frame facts and the pause and resume linkage to the surfaces
- the three surfaces for 4.7, Replay for 5.2, the Timeline and Paused banner for 5.4 -- render them
- tests -- unit (words and branches), integration (the reads on PostgreSQL 18), browser (each surface, with WCAG 2.1 AA), and a mutation for each new guard

**Acceptance Criteria:**

- Given a Run in which a person chose a candidate by secondary key, when the Result, the record review queue and inspector, and the Exceptions list are opened, then the record shows the human-matched word with its matching decision, and a platform match shows no flag (4.7).
- Given a Run with a missing frame and a suppressed frame, when Replay is opened, then the missing frame is marked missing, the suppressed frame is marked suppressed and is not counted as missing, and Replay states that playback is incomplete with the count (5.2).
- Given a Run paused and resumed more than once, when its Timeline is read, then each pause and each resume names its exact plan step and Step Execution attempt from durable records, and a resume names the attempt it starts; a historical record without linkage says so (5.4).
- Given an adapter-only Run on Live View, when its Adapter Session Steps render, then an acquired step shows its registered Evidence digest through the page's real read path, a step with no artifact says so, and an unavailable Evidence read says that (5.3, owner decision 2026-09-25).
- Given the Escalation panel on Live View, when "Go to open Escalation" is activated from the keyboard, then focus is inside the panel and the next keyboard interaction reaches its controls; the test exists before the correction (5.6, owner decision 2026-09-25).
- No historical audit event is rewritten; `git diff --stat` shows no change to migrations already released.
- The legacy stories close only when their other legs are met: 4.7 and 5.2 also need 14-11a's export criteria, or an owner scope amendment.

## Scope added on 2026-09-25 (owner decision, register §3.1 resolutions A)

Both repairs below are part of this story since the owner's decision of 2026-09-25. They were
first listed here as proposed scope.

- **5.3, AC 2 (register §3.1, item 2).** Live View's adapter log rows pass `digest: null`
  (`apps/web/app/runs/[id]/live/page.tsx:347`), so each says "No artifact registered." Give each
  row the digest of the Evidence it registered, as Replay does (`digestByEvidence`), and add a
  browser assertion over a seeded ACQUIRED Reference Source.
- **5.6, AC 2 (register §3.1, item 3).** The Escalation skip link's target
  (`EscalationPanel.tsx:443`) has no `tabIndex`. Add `tabIndex={-1}`, as the shell's own target has
  (`AppShell.tsx:98`–`:100`), and a browser test that presses Enter on "Go to open Escalation" and
  asserts that focus is inside `#open-escalation`.

## Implementation authorisation — 2026-09-26

The owner authorised implementation of Stories 10.6–10.10, including parallel agents. This supersedes the preparation-only restriction; frozen Ask First requirements remain in force.

## Implemented checkpoint — 2026-09-26

Status remains **in-progress**, not accepted. No migration, new event type, Result publication amendment, historical event rewrite, or external rename.

- [x] New human-match registrations retain the exact answered wait in the existing registration event, bound to the Observation id and digest. Reader requires a same-Run answered choose-candidate wait and an unambiguous link; names use the existing ActorName reader. Redelivery never backfills provenance.
- [x] Result (adjacent provenance, unchanged sealed document), record queue, inspector and Exceptions show the existing Human-matched word and available exact answer, actor, time and wait identity. Platform matches show no flag.
- [x] New pauses carry exact plan step, execution/attempt or explicit no in-flight execution. Existing start events carry the exact resumed wait; a resume reader requires one causal start event agreeing with the same Run's actual execution. Timeline and Paused banner render these structured stored facts with existing labels and `None` / `Not recorded`; no guessed current step.
- [x] Live adapter rows resolve registered Evidence by exact id through the real page read, independently of the bounded Evidence overview. No-artifact and unreadable registered identity remain distinct.
- [x] Keyboard skip-link test was written before adding `tabIndex={-1}`. It checks Enter focus and the next Tab's first panel control.
- [x] Added bounded Replay capture-gap read with exact missing/suppressed counts and ordered Tool Action positions. Suppressed captures are excluded from missing count.
- [x] Wire ordered Replay gaps, approved suppression wording, exact missing/suppressed counts and per-frame protected-read failures through the real page, including scoped inspection.
- [ ] Finish accessible missing-position presentation, scrubber placeholders and incomplete/missing prose after the frozen wording decision. Data attributes are not an accessible acceptance claim.
- [ ] Explicit unlinked decision / unavailable Evidence sentences and any replacement pause narrative remain subject to the frozen wording approval. The current human flag does not invent a decision, and an unreadable adapter identity does not say no artifact exists.
- [ ] Hosted PostgreSQL 18, browser/WCAG and mutation acceptance; BMAD independent review and resolution. No completed-acceptance claim for unrun tests.

### Verification actually run

- Pause/worker targeted unit suites: 168 passed.
- Initial Live Viewer + human-decision + real Live page suites: 54 passed.
- Full unit run: 5,395 passed, 3 failed (all an accidental pause-facts insertion into CancellationBanners). Corrected that insertion; all six affected RerunLinks cases and 57 related/new targeted cases then passed (63/63).
- Boundaries passed (809 modules); `git diff --check` passed.
- Full workspace and root-tests TypeScript check passed after the full unit run. A concurrent earlier attempt saw the intentionally forbidden boundary-test fixture; no guard was weakened.
- Meaningful local mutations: removing the human/platform flag guard, hard-coding the Live adapter digest to null, and suppressing the fresh matching-decision link were each killed by their respective targeted assertion suites; all three mutations restored.
- Authored PostgreSQL cases: linked versus historical human matches, cross-Run refusal, queue projection, missing versus suppressed capture positions, repeated pause/resume, rollback and contradictory execution linkage. Not run locally: PostgreSQL unavailable in this managed environment.
- Browser test authored, not run locally. Every changed surface still requires the no-allowlist WCAG 2.1 AA gate.

### Remaining owner wording decision (concrete proposals, NOT approved)

The UX artifacts and words modules contain no semantically equivalent approved sentences for these distinctions:

1. “The matching decision is not linked to this Observation.”
2. “Playback is incomplete: {count} frames are missing.” and “Frame missing.”
3. “Evidence is unavailable.”

Recommended: approve these concise sentences, store them once in the words module, pin tests by importing them, then finish the blocked render branches. Alternative: supply preferred wording with the same facts. Pause facts currently use existing structured field labels and `None` / `Not recorded`; if a narrative is required, proposed sentences are “Step was not recorded for this pause or resume.” and “No Step Execution was in flight.” No proposal here changes the frozen intent or constitutes approval.

### Review order / continuation

1. Application registration and human-decision producer, then human-match-provenance and record/detail reads.
2. Pause boundary producers and pause-linkage's causal first-start read, then Timeline/PausedBanner.
3. Exact adapter Evidence read and keyboard regression.
4. Replay gap query and the explicit unactivated copy-dependent work above.
5. Integration/browser proofs and mutation guards.

Next: parent review of the accepted review patches, hosted acceptance, and the exact wording decision above. Keep this story separate from PR #54 and Stories 10.7–10.10.

### Accepted review patches — 2026-09-26

- Frozen binding masking now precedes immutable presentation snapshots and all four provenance surfaces. A sensitive primary or secondary lookup key, missing plan or missing sensitivity policy masks the candidate label; historical snapshots without an explicit safe marker also mask. Untrusted answer policy is visible.
- Result counts distinct source-record identities and retains each target decision. Exact source ordinals resolve records beyond the first 500 rows. Provenance renders even if the sealed publication cannot decode; queue decisions identify their target.
- Pause boundaries skip acquired/terminal work. Each adapter/sign-in/public-access producer is exercised with a real pending resume id and only the first start consumes it. Timeline exposes exact wait identity and paginates histories beyond 100 entries with `pauseBefore`, preserving unrelated query selectors.
- PostgreSQL cases cover foreign Run waits, wrong digests, duplicate/contradictory links, non-answer closures through detail and queue, multiple target Observations for one record, and Run/Step/attempt contradictions. Fixtures insert contradictory historical facts directly; they do not rewrite audit events.
- Browser/axe acceptance authored for four provenance surfaces, both sensitive lookup cases, exact record 503, unreadable publication, platform absence, acquired adapter metadata/digest states, and two real Pause/Acquire/Resume cycles with causally linked worker fixtures. Browser fixtures do not prove object-store acquisition; these browser and PostgreSQL cases remain unrun locally.
- Latest complete unit run passed **5,418 tests in 298 files**. Full workspace/root TypeScript passed after application changes; final fixture-only root check and boundary check are recorded in the parent handoff.
- CI now runs the disposable guarded mutation verifier after PostgreSQL integration tests and before the existing agent mutation check (15-minute step budget; job 35 minutes). It restores every mutation in `finally` and reports exact outcomes. The verifier contains 21 cases: 11 unit and 10 PostgreSQL. Local unit guard mutations were killed; PostgreSQL mutation outcomes require hosted CI.

This is an implementation checkpoint, not completed Story acceptance. The remaining Replay work includes accessible missing-position/scrubber rendering as well as the proposed copy switch. No owner wording, architecture, merge or deployment approval is implied.
