# Review 24.3a — Edge Case Hunter

Scope: `git diff 437c737 cc64fa9 -- zobba` (Story 24.3a: revision chains,
carried facts, dispositions), against
`spec-24-3-revise-evaluations-without-overwriting-facts-or-exceptions.md`.
Read-only review; every finding below was checked by reading the code paths
named. Lessons from the 24.1/24.2 reviews applied: replays must recheck
authority, JS/Rust text-rule parity, a bounded page/outline must never be
mistaken for the whole, model-controllable input must never fail a cycle.

Counts: **High 3 · Medium 8 · Low 12**.

---

## High

### H1 — A reachable chain state makes the web refuse the whole assessment response
- **Where:** `zobba/web/src/revision.ts:106` (`(c.review !== 'unreviewed' && c.earlier_accepted)) invalid()`) versus `zobba/crates/infrastructure/src/assessment/revision.rs:737-755` (`earlier = max(accepted revision) < head revision`, independent of the head's own disposition).
- **Input/state:** r1 accepted by an auditor → late evidence or a reconsideration produces r2 → an auditor saves `needs_reconsideration` (or `replaced`) on r2. Server sends `review: "pending_reconsideration"`, `earlier_accepted: true`.
- **Wrong output:** `parseChain` throws; `parseEvaluation` → the whole `AssessmentResponse` parse fails, so the work panel's assessment section (all evaluations, coverage, review forms) is unavailable for that Task until the chain changes again. The reconsideration loop the story exists for reaches this state routinely.
- **Fix:** compute `earlier_accepted` only when the head has no disposition (`earlier && h.disposition.is_none()`), or drop the parser rule and show "an earlier revision was accepted" beside any review state. Add a fixture with r1 accepted and r2 reviewed.

### H2 — 24.1 data with a successor-basis re-evaluation turns every later cycle into `Unavailable`
- **Where:** `zobba/crates/infrastructure/src/assessment/revision.rs:266-269` (`heads` returns `Unavailable` when two chains of one lineage share a subject); callers `application/src/assessment.rs:1899` and `:2120` propagate with `?`; `work.rs` maps it to `CycleEnd::Unavailable`.
- **Input/state:** a database evaluated under 24.1 rules, which told the model "Propose a new basis version to evaluate again" (removed text, `assessment.rs` diff) — so subject S has a 24.1 evaluation under b1 and another under b2 (b2 supersedes b1). Migration 0020 adds `revision_first` for new rows only; nothing checks or reconciles existing duplicates.
- **Wrong output:** any `evaluate` or `judgments` on that basis/criterion lineage fails the step with `ReadingError::Unavailable`; the cycle ends Unavailable and is retried on every reclaim with the same answer — the Task can never progress past that answer. The matrix row "Old records … decode" is not met for this legal 24.1 shape.
- **Fix:** define the legacy case (e.g. treat the newest legacy revision-1 per subject as head and the others as closed historical chains, or have the migration refuse/flag such data explicitly); at minimum turn the duplicate into per-subject feedback instead of a step error. Add a populated-upgrade test with two 24.1 evaluations in one lineage.

### H3 — Pending reconsiderations can be dropped from the outline; they then can never be answered and every turn asks for another
- **Where:** `application/src/assessment.rs:2432` (`push` silently drops lines past `MAX_ASSESSMENT_OUTLINE_BYTES - 128`), revision lines appended **last** (`:2512`) after up to 64 basis, 64 criterion, 64 evaluation and all coverage lines; `shown_reconsideration` (`assessment/revision.rs:429-436`) and the SQL guard (`0020…sql:363-366`) both require the mark in the request; `unseen` at `assessment.rs:2226-2232`.
- **Input/state:** a Task with enough recorded criteria (assertions up to 160 bytes plus fact lists), bases and evaluations to fill 16 KiB; a person saves `needs_reconsideration`.
- **Wrong output:** the reconsideration line (and its mark) is not in the request, so (a) no revision can ever carry `reconsideration_requested` — a re-judgment is refused as "nothing it reads has changed", a rule re-evaluation records nothing; (b) `unseen` is true after every answer (the snapshot's top-8 list still contains it), so each cycle runs all 16 turns (`MAX_TURNS_PER_CYCLE`) and ends `Bounded`, paying for turns that cannot address it. The person's request is effectively lost while the Task burns budget.
- **Fix:** place pending reconsiderations in tier-2 ahead of the bounded record lists (or reserve outline bytes for them), and compute `unseen` from what was actually rendered, not from the snapshot. Test with a full outline.

---

## Medium

### M1 — An exact replay returns 200 without the authority or session recheck
- **Where:** `application/src/disposition.rs:260-266` (`disposition_by_key` before `revision_target`/fence); `infrastructure/src/assessment/revision.rs:537-552` (plain scoped read, no `knowledge_audit`, no session hash). The API (`api/src/revisions.rs` `dispose`) does no role check before calling.
- **Input/state:** auditor saves with key K, is then unassigned (or left with Admin only, or signs in on a new session); retries the same POST.
- **Wrong output:** 200 with the stored disposition, where the matrix row "Unauthorised → 403" and the 20.5/20.6 rule ("fresh session, actor and membership check before idempotency lookup") require a refusal. `record_disposition` already does it in the right order (fence, then key lookup); the application short-cut bypasses it.
- **Fix:** remove the pre-lookup in `save_disposition` (let `record_disposition` answer replays after its fence), or run the fence inside `disposition_by_key`.

### M2 — Rust and the SQL guard read different parts of the request for "reconsideration shown"
- **Where:** `assessment/revision.rs:429-436` checks only `invocation.request.messages[].text`; `0020…sql:363-366` searches `i.request::text` (whole stored request: history items, prior assistant answers, tool results, read texts).
- **Input/state:** head X pending; its mark is not in this turn's fixed messages (outline truncated per H3, or not listed) but appears in history — e.g. the model's earlier answer echoed "reconsideration requested of eval-… ", or a read original contains that text. The model then revises X for another cause (late evidence).
- **Wrong output:** Rust derives `[inputs_changed]`, the guard expects `[inputs_changed, reconsideration_requested]`; the insert is refused, feedback says "the chain changed meanwhile. Ask again" — and the same refusal repeats every turn. Conversely untrusted text in history can make the guard demand a cause the model never saw.
- **Fix:** make both read the same, trusted location (e.g. store the shown head IDs as a structured field of the invocation request and compare that exactly in Rust and SQL).

### M3 — A human `replaced` verdict bypasses the 24.1 outcome invariants
- **Where:** `domain/src/revision.rs:355-363` (`check` tests only origin), `:397-404` (`effective` applies any replaced verdict), guard `0020…sql:406-408`.
- **Input/state:** a model_proposal head whose criterion authority is unverified (`undetermined authority_unverified`), or `not_applicable`, or `execution failed analysis_failed`; auditor saves `replaced{met}`.
- **Wrong output:** effective verdict `met`, origin human, on a record the platform says cannot yield met/not_met (unverified authority) or does not apply / was never analysed. This is the one path by which "an unverified authority cannot yield met or not_met" becomes false in the effective view.
- **Fix:** decide explicitly (owner question) and enforce in `check` and the guard: e.g. refuse `replaced` with met/not_met unless the head is applicable, completed and the criterion authority verified.

### M4 — Partial-value quotes are accepted as disposition evidence
- **Where:** `application/src/disposition.rs:298-311` uses only `verification`; the whole-value context returned by `verify_sources` for byte ranges (`citation.rs` `decide_one` bytes branch) is discarded; non-exact structured locators verify by containment (`domain/src/citation.rs:1077-1083`).
- **Input/state:** reference `bytes:120-128` quoting `2,500.00` from `12,500.00`; or a paragraph locator quoting one word.
- **Wrong output:** saved as a verified reference. Spec Design Notes: "disposition references are whole-value verified quotes".
- **Fix:** apply the 24.1 whole-value rule (`Role::Value { whole }` / context check) to byte-range references, and require exact equality for structured ones.

### M5 — A forked basis or criterion lineage can never be evaluated, with misleading feedback
- **Where:** no UNIQUE on `supersedes` (`0018…sql:67,26`); `revision_first` (`0020…sql:494-520`) treats every descendant of the root as one lineage; `plan_revision` / `revision_guard` require the target to descend from the head's version (`assessment/revision.rs:876-898`, `0020…sql:310-328`).
- **Input/state:** b2 and b3 both supersede b1 (the model corrected two facts in two answers, each time superseding b1). S is chained under b2. `evaluate {basis: b3}`.
- **Wrong output:** revision-1 refused (lineage), revision refused (b3 does not descend from b2); feedback says b2 is "a later version", which is false. b3's facts for S are unreachable for evaluation forever. Same for sibling criterion versions.
- **Fix:** refuse a second successor of a version at `propose_basis`/`propose_criteria` time (or a unique index on `supersedes`), with feedback naming the existing successor; correct the wording.

### M6 — Population judgments read revision 1 and own facts only
- **Where:** `application/src/assessment/coverage.rs:1423-1430` (`evaluations_of(target.id, criterion.id)` and `store.facts(...)`), unchanged by 24.3a.
- **Input/state:** (a) judgment r1 `met`, revised to r2 `not_met`, then `evaluate_population`; (b) a population on successor b2 whose judgments are revisions (revision_first forbids revision-1 rows under b2) or whose subject facts are carried.
- **Wrong output:** (a) the immutable opportunity records r1's superseded verdict and digest; (b) no judgment is found / unit mapping fails, so the opportunity is "not evaluated". 24.3b's effective overlay cannot repair the 24.2 summaries already recorded from these.
- **Fix:** use chain heads (`RevisionStore::heads`) and `effective_facts` in this step, or refuse population evaluation of a judgment criterion whose chains have revisions until 24.3b lands.

### M7 — A refused carry does not stop the same answer from evaluating the uncarried successor
- **Where:** `assessment/revision.rs:980-990` (whole carry refused when any `except` pair is not a fact of the predecessor), `:957-970`; the answer then continues to steps 3–5 (`assessment.rs:1609` onward).
- **Input/state:** successor b2 + `carry_facts except [{INV-0042, approver}]` where `approver` was never recorded on b1 (the agent excepts what it is about to add) + record the new fact + `evaluate {basis: b2}`.
- **Wrong output:** carry refused with feedback, but the evaluate step revises every subject under b2 with only its own facts: revisions with mass `removed` changes and `undetermined missing_fact`, i.e. regressions recorded as the new heads. Model-controllable over-specification produces wrong immutable records.
- **Fix:** ignore an except pair that is absent (it excludes nothing), and/or skip evaluation of a successor basis in the answer whose carry was refused, with feedback.

### M8 — Web label bound is bytes, server label bound is scalars
- **Where:** `web/src/revision.ts:57` (`text(item, 200)` = 200 UTF-8 bytes) vs identity labels of 1–200 Unicode scalars (20.2) used for `actor_label` (`api/src/revisions.rs` history label and save response; `conversation.ts:75` correctly counts scalars).
- **Input/state:** an auditor named with 70+ CJK or accented characters (>200 bytes) saves a disposition.
- **Wrong output:** `parseDisposition` throws → chain parse fails → whole assessment response refused (same blast radius as H1); history page refused.
- **Fix:** reuse the scalar-counting label parser.

---

## Low

1. **Stale carry after a later carry upstream** — a carry may be added to b2 in a later answer (`carry_step` accepts a basis by ID) after b3 already carried from b2; b3's immutable carry no longer holds "every effective fact" of b2. Refuse a carry into a basis that already has a successor or evaluations.
2. **Shadowed carried pairs count toward 1,024** — a successor that records a pair it also carried (no `except`) keeps the carried row; `assessment.rs` fact bound and `assessment_guard` count rows, not effective facts.
3. **Reconsideration silently consumed** — a revision recorded for another cause by an answer that never saw the request moves the head; the request leaves "pending" without the model having addressed it, and nothing records that.
4. **Judgment refusal wording** — `assessment.rs` judgments branch maps every `plan_revision` `Err` (including "older basis/criterion") to "nothing it reads has changed".
5. **Two references in one answer to one lineage** — `evaluate [{b1,c},{b2,c}]`: the second sees a head written by this invocation and is skipped with the first's line (`head.invocation_id() == invocation.id`), so the b2 evaluation is silently not done.
6. **Lineage deeper than 64 versions** — `revision_first`, `LINEAGE` and the guards stop at 64 hops; a 66-deep lineage gets two roots and a second revision-1 chain.
7. **Refusal mapping** — DB reference refusals always report index 0 (`revision.rs:645-646`); CHECK violations fall through to 503 `disposition_unavailable`.
8. **Outline counts** — `revision_snapshot` per-basis lines are capped at 64 bases with no "further bases" line; basis fact counts exclude carried facts and there is no carry line, so the model cannot see what a successor carries.
9. **Web blank rule** — `EvaluationReview.tsx:126` uses JS `trim()` (strips U+FEFF, which Rust keeps); a malformed `head_id` in a 409 body turns a definite refusal into "may not have been saved".
10. **Page-locator chips** — the form offers verified page-locator sources (`EvaluationReview.tsx:111-113`) that `save_disposition` always refuses (`page_only`), giving a guaranteed 409.
11. **Document-job reuse** — `reading.rs:1343-1358`: if the newest job ends not `Collected` (e.g. collection unavailable), an ordinary read starts a new job, contrary to "keeps its collected outcome"; a wall-time `limit_exceeded` is now permanent for that document within the Task (as before, but now stated as intended).
12. **Panel freshness** — after a successful save the chain prop and an open history are not refreshed; history pages are not reset when `chain.head_id` changes.

---

## Checked and found correct
- Cause derivation order and set equality agree between `domain::revision::causes` and `revision_guard`; `changes` by fact name agrees with the SQL CTE (C order, from/to).
- No-op rerun records nothing and does not fail the cycle; empty-cause/different-digest gives feedback.
- Fork of one head: `UNIQUE(predecessor_id)`, `UNIQUE(chain_id, revision)` and the per-chain advisory lock; the loser becomes feedback.
- Disposition: deterministic `replaced` refused in Rust and SQL (400); superseded head refused naming the head (409), including the race via the guard message; 16-per-revision cap under the chain lock; rationale exactly 2,000 bytes accepted, 2,001 refused, Rust/SQL control-character and blank rules agree; 8 references accepted, 9 refused; quote not at its location refused naming its index; same key + different body → 409; Admin-only and unassigned (non-replay) → 403 via `knowledge_audit`.
- `needs_reconsideration` resumes only `waiting`/`confirmed`; paused/stopped stay so; the wake is recorded.
- History paging: empty-after-end, exactly 50 (one page, no cursor), 51 (cursor 50, second page [51]), cursor `0`, malformed cursor → 400, head on a later page (`head_id` given).
- `carry_facts` decode: absent field decodes to empty (old answers), excess dropped and counted; 1,024 bound with carried facts consistent between Rust (`>`/`>=`) and SQL at the boundary.
