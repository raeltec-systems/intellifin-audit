# IntelliFin Auditor Workspace — adversarial specification review

## Challenge log, corrections and verification record · 18 September 2026

**Reviewed:** version 1.0. **Reissued:** proposed specification version 1.1. **Reviewer:** ChatGPT in this conversation; same-author review, not an independent human or external engineering sign-off.

## 1. Decision

**Do not implement version 1.0 unchanged.** The review identified 21 specification findings: 17 high-priority and four medium-priority design issues. Version 1.1 incorporates a written correction for each. These are ambiguities, missing contracts, scope mismatches or unproven assumptions—not 21 verified production bugs.

The specification is now a stronger basis for P0 design/capability work and bounded implementation planning. The complete co-working release is not accepted or proven. It still requires the stated owner choices and real provider, integration, browser, performance and usability gates. No application source, repository branch, audit evidence or production configuration was changed in this review.

## 2. What was actually done

| Method | Work performed | Evidence limit |
|---|---|---|
| Contract comparison | Read version 1.0 and rechecked the pinned repository’s pause/wait contracts. Compared proposed scope and authority against the owner’s stated workflow. | Not a new full-repository or production audit. |
| Adversarial walkthroughs | 48 explicit scenarios, each with v1 assessment, correction and remaining proof. | Tabletop design review; not user observation or a browser test. |
| Executable protocol models | Three finite models for control/commands, wait closure and privacy epochs; depth bound eight transitions. | No application imports, SQL, browser, Solari or LLM calls. Assumes atomic protocol boundaries. |
| Mutation checks | Removed 14 mechanisms in deliberately broken model variants; all produced counterexamples under the same monitors. | Detects injected model faults, not vulnerabilities proven in production. |
| Deterministic fixtures | 22 groups, including 120 wait-race orderings, 20 shortcut utterances, 1,000-row paging correctness and analytic scaling/bandwidth examples. | Not a real concurrency, language-model, load, latency or legibility benchmark. |
| Revision audit | Replaced contradictory/underspecified text, retained old IDs, added AW-100–120 and AT-37–60, and produced a machine-readable change log/diff. | New requirements remain proposed until owner approval and actual implementation proof. |

## 3. Executed model results

| Model | Depth bound | Unique states visited | Transition attempts | Result |
|---|---:|---:|---:|---|
| control | 8 | 3,625 | 53,533 | No encoded safety violation found within the bound |
| wait | 8 | 32 | 256 | No encoded safety violation found within the bound |
| privacy | 8 | 31 | 180 | No encoded safety violation found within the bound |



**Total:** 3,688 unique model states and 53,969 transition attempts. Attempts include no-op/refused events; they are not a count of successful business actions. Control and privacy have states at the depth frontier, so this is explicitly not an unbounded proof. No fairness or liveness guarantee is established.

**Fixtures:** 22/22 groups passed. **Deliberate mutants:** 14/14 detected. Normal-control and normal-frame transitions are reachable, so the suite is not passing by refusing every action.

### Exactly what is abstracted

The control model uses one discretionary command key, two logical inspection units, two controller names, at most two epoch increments, revocation of actor A and a worker-up/down flag. Manager transfer events assume an authorized manager; full production role combinations are not modeled. The wait model has two possible request identities and a Boolean deadline boundary. The privacy model has one private interval, one capture/buffer/outbound slot and a Boolean input-owner abstraction. No real passwords or pixels are present.

These separate models do not explore their full Cartesian composition. In particular, deferred pause plus a real escalation, real worker lease fencing, provider I/O during takeover and full multi-target scheduling still require integration tests. The absence of a model violation cannot be used as evidence that those unmodeled combinations are safe.

### Reproduce

```bash
python model/review_model.py --out results/reproduced
```

The runner uses Python standard-library modules only, performs no network requests and exits nonzero if the baseline fails, a fixture fails or a deliberate mutant survives. The output records the executing script’s SHA256. Do not run it with Python optimization that disables assertions.

## 4. Counterexamples that demonstrate the checks can fail

Each line below is a shortest counterexample discovered within the respective bounded exploration of a deliberately broken model. Names are model operations, not production API endpoints.

| Broken mechanism | Counterexample trace | Failure observed |
|---|---|---|
| `reuse_key_with_different_payload` | submit_unit0 → submit_unit1 | `IDEMPOTENCY_PAYLOAD_CHANGED` |
| `trust_client_authority` | transfer_M → submit_unit0 | `UNAUTHORIZED_INTAKE` |
| `duplicate_effect` | submit_unit0 → apply → apply | `DUPLICATE_PERSISTED_COMMAND_EFFECT` |
| `ignore_controller_epoch` | submit_unit0 → transfer_M → transfer_A → apply | `STALE_OR_REVOKED_AUTHORITY_APPLIED` |
| `retarget_this_record` | submit_unit0 → finish_unit → apply | `COMMAND_RETARGETED_TO_ANOTHER_UNIT` |
| `drop_safety_on_transfer` | pause_now → transfer_M | `ACCEPTED_SAFETY_REQUEST_DROPPED_ON_TRANSFER` |
| `pause_beats_stop` | pause_now → stop → boundary | `STOP_DID_NOT_WIN_BOUNDARY` |
| `cross_deferred_pause_boundary` | pause_after_unit0 → finish_unit | `NEXT_UNIT_STARTED_PAST_DEFERRED_PAUSE` |
| `close_wait_twice` | answer_A_1 → answer_A_1 | `WAIT_CLOSED_MORE_THAN_ONCE` |
| `answer_different_request` | answer_A_2 | `ANSWER_BOUND_TO_WRONG_REQUEST` |
| `accept_expired_answer` | expire → answer_A_1 | `EXPIRED_REQUEST_ACCEPTED` |
| `concurrent_human_agent_input` | enter_private | `TWO_INPUT_OWNERS` |
| `ignore_capture_privacy_epoch` | capture_start → capture_finish → enter_private → leave_private → publish | `PRE_PRIVACY_BUFFER_PUBLISHED_IN_NEW_EPOCH` |
| `ignore_viewer_privacy_epoch` | capture_start → capture_finish → publish → enter_private → deliver | `STALE_FRAME_DISPLAYED_ACROSS_PRIVACY_BOUNDARY` |

## 5. Most consequential design decisions

**Control changes:** old discretionary directions do not inherit new authority, even when the same actor reacquires a lease. Previously accepted pause/stop requests remain safety latches. Already committed review decisions remain immutable history.

**Pause boundaries:** in the initial capability, a pause is bound to the exact subject-target inspection work item. A phrase about an employee spanning several systems needs clarification; the implementation cannot quietly reorder the scheduler or claim a barrier it does not support.

**Pagination:** a current-revision equality rule can continuously invalidate cursors. Version 1.1 uses a bounded immutable review snapshot with as-of time and explicit refresh, separate from current selected-record details.

**Privacy:** stopping a timer is not enough. Capture completion, publication and image decode also require privacy-epoch validation. Real provider and browser behavior must still prove that the logical gate corresponds to actual secret containment.

**Legibility:** a fully visible frame can be useless. The arithmetic fixture fits 14-pixel text from a 1280-pixel capture into 720 pixels: the effective text is only 7.875 pixels. That is a counterexample to visibility implying readability, not a measurement of the current application.

**Product promise:** the target co-working release must not quietly lose secure sign-in assistance or meaningful near-live viewing. An earlier limited pilot can be useful, but the owner must explicitly accept those limitations and the product must name it honestly.

## 6. Detailed findings and corrections

### F01 — The minimum product can quietly fall short of the requested experience

**Priority:** High. **Version 1.0 sections:** 1; 12; 16; 19. **Corrected rule:** AW-100.

**What failed the design review:** The specification calls the whole experience complete while treating both faster viewing and secure sign-in assistance as optional. Technical success could be signed off without the browser co-working experience the owner requested.

**Challenge:** Finish P1–P5 with sparse action captures and no human sign-in. Claim completed co-working even though a normal authentication interruption cannot be resolved in place.

**Version 1.1 correction:** Distinguish review repair, a deliberately limited conversational pilot, and the target co-working release. Recommend the target release require safe near-live viewing and secure authentication assistance for at least the first supported target flow. Do not demote either gate without explicit owner agreement to a limited pilot.

**Verification performed:** Tabletop scope/Definition-of-Done contradiction check; no provider capability is asserted.

**Proof still required:** Owner decision D1 plus actual preview and authentication capability gates.

### F02 — Queued directions need fencing when ownership changes

**Priority:** High. **Version 1.0 sections:** 4.2; 10.2; 10.3; 11.3. **Corrected rule:** AW-101.

**What failed the design review:** A lease and a revision are mentioned, but the fate of already-accepted, unapplied directions after transfer, expiry or revocation is not settled.

**Challenge:** A queues a direction; lease expires; A reacquires control; an old queued direction executes under the new session of authority.

**Version 1.1 correction:** Use a monotonically increasing control epoch. Ordinary unapplied directives must still match actor, live lease, epoch, plan and work unit at application. Otherwise supersede them. A prior committed domain decision remains history; a transfer is not a retroactive invalidation.

**Verification performed:** Control model, epoch-removal mutant, FX02 and FX07.

**Proof still required:** Real transaction/queue races, authorization revocation and all alternative command routes.

### F03 — Safety requests must not disappear with their requester

**Priority:** High. **Version 1.0 sections:** 10.2; 10.3; 14. **Corrected rule:** AW-102.

**What failed the design review:** Treating every pending instruction identically could drop a previously accepted pause or stop when a manager takes control or an auditor loses access.

**Challenge:** Pause-after-inspection is accepted; manager takes control; old lease is invalidated; generic command cleanup discards the pause; the next inspection starts.

**Version 1.1 correction:** Separate accepted safety latches from discretionary steering. Accepted pause/stop requests survive controller transfer and later actor revocation until applied, explicitly superseded by a stronger stop, or the Run ends. A revoked actor cannot create new requests. Resume requires current authority; transfer never implicitly resumes.

**Verification performed:** Control model, dropped-safety mutant, FX03, FX04 and FX08.

**Proof still required:** Boundary timing, simultaneous waits, cancellation while paused, and recovery in the real worker.

### F04 — Employee, inspection and target are not interchangeable boundaries

**Priority:** High. **Version 1.0 sections:** 5.3; 8.1; 9.1; 10.3. **Corrected rule:** AW-103.

**What failed the design review:** The document promises a record-bound pause but does not define completion across multiple target systems or a scheduler that groups work by target.

**Challenge:** E-1 is checked in LoanCore; the next scheduled work is E-2 in LoanCore; E-1 in a second system is much later. What did pause-after-E-1 authorize?

**Version 1.1 correction:** Define inspection unit as the frozen work item for one subject and one target. Initial deferred pause means after this named inspection unit. In a single-target Run it is equivalent to after this employee. In a multi-target Run clarify the target. An all-systems subject barrier requires a separate scheduler capability and is not silently implemented by reordering work.

**Verification performed:** Tabletop scheduler counterexample; FX08 and FX18 model unit boundaries and distinct totals.

**Proof still required:** Inspect actual scheduler, prove logical unit identity across retries, and test a multi-target fixture.

### F05 — Viewing earlier evidence can change the meaning of this employee

**Priority:** High. **Version 1.0 sections:** 6.3; 8; 11.8. **Corrected rule:** AW-104.

**What failed the design review:** The spec binds context, but does not prescribe precedence when the selected record differs from the current execution record or a reply card.

**Challenge:** Auditor opens yesterday’s E-1 frame while the agent works on E-2 and types: pause after this employee.

**Version 1.1 correction:** The composer must show its context. Explicit reply context wins only for that request; selected evidence context anchors questions, not execution. Execution directives show an exact current work-unit target and require clarification on any mismatch. Freeze context at ingestion and again verify it at confirmation/application. Never choose silently.

**Verification performed:** Tabletop context walkthrough; stale-target mutant, FX05 and FX19.

**Proof still required:** Hydrated UI context, navigation races and real model interpretation corpus.

### F06 — A deterministic safety shortcut can itself execute the wrong intent

**Priority:** High. **Version 1.0 sections:** 8.2; 11.2. **Corrected rule:** AW-105.

**What failed the design review:** Recognize safety controls without a model is underspecified: keyword matching can turn questions, quotations or negation into actions.

**Challenge:** The auditor asks why the source says “stop the run”; a keyword recognizer stops the Run.

**Version 1.1 correction:** Allow a documented exact-match shortcut only for unqualified safety commands. Quoted, negated, conditional or multi-intent sentences do not dispatch directly. Use the ordinary interpreter plus explicit confirmation. Stop still requires its precise confirmation; Pause does not require a redundant modal.

**Verification performed:** FX13 executes 20 specified utterances against the narrow shortcut, including negation, quotes, mixed intent and a homoglyph.

**Proof still required:** This is not an LLM accuracy test. Run a labelled held-out utterance set against the installed model before release.

### F07 — A generic yes must not authorize a changed or unseen decision

**Priority:** High. **Version 1.0 sections:** 8.2; 8.3; 9; 11.8. **Corrected rule:** AW-106.

**What failed the design review:** The spec has confirmation digests, but does not fully define the exact evidence/assessment context or distinguish a delivered response from an actual review.

**Challenge:** A C2 proposal or evidence-integrity state changes between rendering and confirmation; the old yes is accepted on a different effective target.

**Version 1.1 correction:** Bind confirmation to Run, observation, condition, interpretation digest, relevant domain revision and the current admissibility/integrity state. A reply names one request and one option. Do not equate opening evidence with reviewing it. Confirm assessment is separate from answering execution; retain original proposals and current domain eligibility.

**Verification performed:** Wait model; stale-request and expired-answer mutants; FX14 and FX19.

**Proof still required:** Existing review command integration, changing integrity findings, consent copy and human comprehension.

### F08 — Approved fallback prose is not an executable capability catalogue

**Priority:** High. **Version 1.0 sections:** 3.2; 8.1; 11.4. **Corrected rule:** AW-107.

**What failed the design review:** SELECT_LOOKUP_STRATEGY assumes the frozen plan exposes safe strategies and preconditions. That capability is not established by the baseline inspection.

**Challenge:** The auditor asks to search by name first; a loose allowlist includes full_name, so the agent skips a required employee-ID lookup.

**Version 1.1 correction:** Expose only strategies explicitly represented in a versioned frozen capability graph, with subject/target, required predecessor and maximum attempt preconditions. Old plans without the capability cannot accept steering-by-strategy. Existing autonomous fallback may continue under its original contract; do not reinterpret prose or rewrite historical plans.

**Verification performed:** FX15 checks all 16 precondition combinations and an arbitrary strategy name.

**Proof still required:** Compiler/schema compatibility and actual execution plan inspection. Gate G2.

### F09 — A new chat ledger could become a second authority

**Priority:** High. **Version 1.0 sections:** 10.1; 11.2–11.4. **Corrected rule:** AW-108.

**What failed the design review:** Message, interaction-command and transition records are proposed alongside existing waits/reviews without fully specifying the atomic bridge.

**Challenge:** The existing review command commits, the process dies before chat marks success, and recovery enqueues a second review; or chat says applied before the domain commit.

**Version 1.1 correction:** Existing domain command/decision remains the authority. Store a unique conversation-to-domain link in the same authoritative transaction or use the existing naturally idempotent command key and reconcile it. Chat receipts are projections of that result. Do not add a second queue or seal lifecycle for the same action.

**Verification performed:** Tabletop two-ledger crash walkthrough; FX01 tests only the simplified single-commit abstraction.

**Proof still required:** Actual unit-of-work adapter and process-kill tests on both sides of each commit. Gate G5.

### F10 — Idempotency needs semantic-payload binding

**Priority:** High. **Version 1.0 sections:** 11.3; 11.4; 14. **Corrected rule:** AW-109.

**What failed the design review:** Return same receipt for same key does not say what happens if the key is reused with changed record, target or operation.

**Challenge:** Submit key K for E-1; reuse K for E-2; server either silently ignores intent or applies it twice.

**Version 1.1 correction:** Namespace the client key by authorized organization boundary, Run, actor and operation. Atomically retain the canonical validated payload fingerprint and domain reference. Same key/same payload returns its original receipt; changed payload is a conflict, never a new effect. Reauthorize receipt reads. Preserve tombstones long enough to reject late commands after intake closes.

**Verification performed:** Payload-reuse and duplicate-effect mutants; FX01.

**Proof still required:** Real persistence uniqueness, retention window and retry behavior across web/worker rollout.

### F11 — Exactly-once external action and instantaneous revocation are overclaims

**Priority:** High. **Version 1.0 sections:** 11.4; 13; 14; AT-15,27. **Corrected rule:** AW-110.

**What failed the design review:** The wording can be read as a guarantee that no remote action occurs after revocation and that every action happens once despite crashes.

**Challenge:** A remote read is dispatched; its response is lost; cancellation arrives; recovery cannot know whether the target executed the request.

**Version 1.1 correction:** Guarantee at-most-one committed command effect and observation binding, not exactly-one network request. Use worker fencing/dispatch tickets and boundary checks. An already-dispatched remote request may finish; preserve its attempt truthfully. Never blindly retry an outcome-unknown target write; target writes remain prohibited. Revocation blocks new authorization and subsequent bytes, not bytes already legitimately delivered.

**Verification performed:** Tabletop distributed-boundary challenge; model assumes atomic commits and explicitly excludes network exactly-once.

**Proof still required:** Actual lease fencing, dispatch/commit failure injection and target adapter behavior.

### F12 — Capture suppression requires both producer and viewer fencing

**Priority:** High. **Version 1.0 sections:** 12.2; 12.3; 13. **Corrected rule:** AW-111.

**What failed the design review:** Stopping the sampler and clearing buffers is insufficient if a pre-privacy asynchronous capture or image decode completes late.

**Challenge:** Capture starts; private sign-in begins; capture completes; handback occurs; the stale result is published into the new public session.

**Version 1.1 correction:** Increment a privacy epoch before entering private mode and again at validated handback. Fence capture start, completion, publication and application-side decode. Discard epoch-mismatched buffers; revoke capabilities and clear stage. One input owner only. Real sensitive-page coordination, provider capture behavior and browser caches remain mandatory proof gates.

**Verification performed:** Privacy model; three privacy/input mutants; FX11 and FX12.

**Proof still required:** Real pixels, all capture channels, third-party recorder behavior and authenticated multi-viewer clients. Gate G3.

### F13 — Preserved history conflicts with secret removal unless storage is designed for it

**Priority:** High. **Version 1.0 sections:** AW-007,008; 11.3; 13. **Corrected rule:** AW-112.

**What failed the design review:** Immutable message bodies plus exceptional tombstoning leave unclear whether the original secret survives in ordinary reads, notifications, embeddings or exports.

**Challenge:** Auditor pastes a password; transcript is immutable; the UI hides it but it survives in API/export/cache/model context.

**Version 1.1 correction:** Keep immutable metadata separate from encrypted, access-controlled message content. Define audited restricted redaction, replacement/tombstone, cache and export invalidation and context exclusion; do not retain a public brute-forceable hash of a detected secret. Provider-side deletion/hold policy is an explicit data-governance dependency. Secret pattern detection is not a containment guarantee.

**Verification performed:** Tabletop data-lineage walk; no real secret was submitted and no storage deletion was tested.

**Proof still required:** Approved retention/legal-hold policy, key/content lifecycle and incident runbook before real data. Gate G4.

### F14 — Binding every page to the current revision can starve pagination

**Priority:** High. **Version 1.0 sections:** 9.1; 11.7. **Corrected rule:** AW-113.

**What failed the design review:** A cursor tied to the global live revision can become invalid before each next-page request while events keep arriving.

**Challenge:** Page 1 is revision 20; a new event makes 21; page 2 is rejected; refresh gives 21; another event makes 22; repeat.

**Version 1.1 correction:** Use a bounded server-held immutable review snapshot/versioned projection for page membership/order, with an explicit as-of time and Refresh changes. Do not hold a database transaction across user requests. Reauthorize every read; keep current selected-record detail and a changed-since-list notice. Snapshot expiry, not routine progress, restarts pagination.

**Verification performed:** FX17 reproduces 20 failed attempts under a naive rule; FX16 traverses a frozen 1,000-row projection without duplicate/omitted keys.

**Proof still required:** Actual SQL query plan, snapshot TTL/cache bounds and concurrent browser paging. Gate G6.

### F15 — Coverage totals need distinct subject, unit and assessment measures

**Priority:** High. **Version 1.0 sections:** 9.1; 11.7; AT-23. **Corrected rule:** AW-114.

**What failed the design review:** Multi-target Run totals, partial inspection and unresolved duplicate source keys are not fully defined. Counting observations can overstate coverage.

**Challenge:** Two employees require two systems each; three observations exist, but only one employee is fully inspected. A fourth source row shares an employee key.

**Version 1.1 correction:** Display source rows, fully inspected subjects, required/inspected units, exceptions and pending assessments as distinct measures. Subject complete requires every required unit accounted for at the correct evidence level. Unresolved duplicate keys retain row-level references and remain blocked; no deduplication by display label. Counts come from the full scoped read model.

**Verification performed:** FX16 and FX18 verify limited synthetic arithmetic and overlap; canonical negative-source rule retained.

**Proof still required:** Repository read-model semantics for each Procedure type and real larger/multi-target fixtures.

### F16 — Conversational narration needs events that actually exist

**Priority:** Medium. **Version 1.0 sections:** 7.1; 7.3; 11.5. **Corrected rule:** AW-115.

**What failed the design review:** A template saying “searching” is not enough if the stream only contains completed captures. Planned, requested, dispatched and completed activity are not the same fact.

**Challenge:** The UI renders a planned search as completed and gives an answer for a newer record than the evidence used to generate it.

**Version 1.1 correction:** Define the necessary event-to-message mapping, with missing-event behavior. Only committed action-start/dispatch evidence can drive an active-action sentence; outcome words need outcome evidence. Generated explanations retain their context revision and links. Corrections append; old explanations do not become new facts. Unsupported source claims are quoted, not normalized into platform truth.

**Verification performed:** Tabletop event/provenance audit; no new event emitter or summarizer tested.

**Proof still required:** Event coverage audit and delayed/out-of-order event tests. Grounded Q&A red-team corpus.

### F17 — Performance targets lack a workload and traffic isolation

**Priority:** Medium. **Version 1.0 sections:** 15; P0/P5. **Corrected rule:** AW-116.

**What failed the design review:** Latency percentiles have no concrete concurrency/network sample and Q&A/preview can compete with audit execution or safety controls.

**Challenge:** Five viewers per Run request frames; narration refreshes on every event; expensive questions consume the same quota/pool that services stop and evidence grants.

**Version 1.1 correction:** Publish a named benchmark: 10 active synthetic Runs, 5 viewers each, 1,000 review rows and 20,000 transcript entries, with stated network and cache conditions. Reserve independent admission for safety controls; bound explanation concurrency and per-Run capture work. Drop/coalesce preview before correctness. Report baseline and degraded-load results and per-Run bandwidth/cost.

**Verification performed:** FX21 calculates a transparent bandwidth scenario only; not a measured throughput test.

**Proof still required:** Staging capacity/performance benchmark and host/provider limits. Gate G7.

### F18 — Secure handoff cannot assume SSO or read-only identity verification

**Priority:** High. **Version 1.0 sections:** 12.3; P6. **Corrected rule:** AW-117.

**What failed the design review:** The spec says verify destination/read-only account without specifying how or whether the current registration can do it. Authentication redirect origins may be outside the frozen scope.

**Challenge:** A legitimate SSO redirect is blocked; a user signs in with an administrator account; the UI assumes read-only just because it was an authentication request.

**Version 1.1 correction:** Register an explicit approved authentication flow and identity/role-verification method, including allowed SSO destinations and read-only account restrictions. Broker input only within that flow; drain agent actions before lease handoff. If identity or rights cannot be verified, assistance stays disabled or execution blocked. No on-the-fly allowlist widening or cookie import.

**Verification performed:** Tabletop auth/control boundary review against existing workspace scope restrictions.

**Proof still required:** Provider/target-specific capability test and security review. Gate G3; authentication is not silently promised.

### F19 — A long chat can replace the long evidence dump

**Priority:** Medium. **Version 1.0 sections:** 6; 7.3; 17.1. **Corrected rule:** AW-118.

**What failed the design review:** Thread grouping is proposed, but urgent interaction, returning users and model-generated noise are not concretely bounded or tested.

**Challenge:** After 20,000 events an auditor returns to a scrolled transcript, misses the active request and clicks an unrelated historical approval.

**Version 1.1 correction:** Pin a current Needs your input card and an actual-state summary outside the transcript scroll. History is visibly non-actionable; one current execution question plus separate pending-result queue. Preserve context, focus, draft and list position. Test all target tasks at 1280×800 and 1440×900, including zoom, keyboard and screen-reader checks; no full-page modal hides the active workspace for routine progress.

**Verification performed:** Tabletop walkthrough and task inventory; no prototype/user study executed.

**Proof still required:** Interactive prototype and five-auditor moderated study. Gate G1.

### F20 — Rollback needs a protocol compatibility table, not only feature flags

**Priority:** Medium. **Version 1.0 sections:** 18. **Corrected rule:** AW-119.

**What failed the design review:** Disabling intake does not tell an old worker what to do with already queued new command schemas or a private input lease.

**Challenge:** New web queues a directive; deployment rolls back; an old worker retries unsupported payload forever while the conversation shows it queued.

**Version 1.1 correction:** Pin protocol and capability versions per Run/command, keep old readers, deploy compatible handlers before enablement. Drain new intake; supersede or reconcile additive unapplied directives; preserve accepted safety latches and close private leases. Never route unsupported commands as raw text. No destructive audit-history downgrade. Publish old/new producer/consumer rollout matrix and rollback drill.

**Verification performed:** FX06 checks only the simplified additive-command drain; tabletop protocol matrix.

**Proof still required:** Real mixed-version deployment/rollback tests and migration review. Gate G5.

### F21 — A fully visible screenshot may still be unreadable

**Priority:** High. **Version 1.0 sections:** 6.1; 12.2; AT-05,32. **Corrected rule:** AW-120.

**What failed the design review:** Physical visibility tests do not establish readable target text after scaling a wide browser capture into a narrow split pane.

**Challenge:** A 1280-pixel source with 14-pixel fields is fitted into 720 CSS pixels; the field text renders at 7.875 pixels although the entire image is visible.

**Version 1.1 correction:** Keep critical captured facts readable as native UI text. Provide one-action workspace focus/expand and true 100-percent evidence inspection without silently changing the active agent viewport. Test text legibility and target identification, not only visible image area. Multi-viewer resizing must not race the executor or change another viewer’s evidence.

**Verification performed:** FX22 demonstrates the scaling counterexample arithmetically; no visual usability claim.

**Proof still required:** Actual target screenshots at the chosen sizes, focus/zoom behavior and non-builder auditor review. Gate G1.

## 7. Scenario-by-scenario challenge log

All 48 scenarios below were worked through as design challenges. A linked model/fixture result is narrower than the full scenario. “Design response recorded” never means a deployed-system pass.

### S01 — Control transfer with queued direction

**Attempted failure:** A queues strategy; M takes control before consumption.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Old ordinary direction superseded; M submits a new one.

**Method and evidence:** tabletop + executable design model/fixture. control Findings: F02.

**Remaining real-world check:** Real control/queue race.

### S02 — Same actor reacquires lease

**Attempted failure:** A queues; lease expires; A reacquires; old ticket arrives.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Epoch mismatch refuses old authority even for the same person.

**Method and evidence:** tabletop + executable design model/fixture. FX02, ignore_controller_epoch Findings: F02.

**Remaining real-world check:** Database epoch and expiry clock.

### S03 — Accepted safety request survives transfer

**Attempted failure:** A requests pause; manager takes control and A is revoked.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Accepted hold persists; no implicit resume.

**Method and evidence:** tabletop + executable design model/fixture. FX03, drop_safety_on_transfer Findings: F03.

**Remaining real-world check:** Real stage boundary and revocation.

### S04 — Stop wins over pause/resume

**Attempted failure:** Pause and stop are both pending at next worker boundary.

**Version 1.0 assessment:** covered but integration unproven.

**Decision/correction:** Apply cancellation first; no later resume of a terminal Run.

**Method and evidence:** tabletop + executable design model/fixture. FX04, pause_beats_stop Findings: F03.

**Remaining real-world check:** Real worker and paused-command path.

### S05 — Revocation before versus after commit

**Attempted failure:** Revoke a role before application, then in another trace after a valid commit.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Before linearization refuse; after it preserve decision and stop subsequent unauthorized work.

**Method and evidence:** tabletop + executable design model/fixture. control, FX07 Findings: F02, F11.

**Remaining real-world check:** Authorization/dispatch cut points.

### S06 — One user, two tabs

**Attempted failure:** Two tabs use same actor but different selected record/command context.

**Version 1.0 assessment:** partially covered.

**Decision/correction:** Context and idempotency are scoped; same user is not permission to retarget.

**Method and evidence:** tabletop + executable design model/fixture. control Findings: F02, F05, F10.

**Remaining real-world check:** Multi-tab browser and request concurrency.

### S07 — Pause after one employee across systems

**Attempted failure:** Scheduler is target-major and subject has two target inspections.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Clarify one work unit; all-target subject barrier is not implied.

**Method and evidence:** tabletop + executable design model/fixture. FX18 Findings: F04.

**Remaining real-world check:** Scheduler capability/fixture.

### S08 — Pause after current inspection during an ambiguity

**Attempted failure:** A question opens after a deferred pause was accepted.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** One runtime wait; deferred latch persists and fires after unit settlement, not before answer.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F03, F04.

**Remaining real-world check:** Combined wait/pause worker test.

### S09 — Deferred pause and skip

**Attempted failure:** Auditor permits skip on the paused-target work item.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Skipped unit settles with uncovered status, then hold before next unit; never counted inspected.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F03, F04, F15.

**Remaining real-world check:** Actual coverage gate.

### S10 — Pause after final unit

**Attempted failure:** Last unit finishes while a deferred pause exists.

**Version 1.0 assessment:** partially covered.

**Decision/correction:** Finalize honestly and mark hold superseded by completion; no orphan pause wait.

**Method and evidence:** tabletop + executable design model/fixture. control Findings: F03, F04.

**Remaining real-world check:** Real completeRun ordering.

### S11 — This employee means selected historical frame

**Attempted failure:** Selection points to E1; worker acts on E2.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Question remains about E1; directive requires explicit current execution unit.

**Method and evidence:** tabletop + executable design model/fixture. FX05 Findings: F05.

**Remaining real-world check:** Real contextual interpreter and UI.

### S12 — Full-name strategy before required ID lookup

**Attempted failure:** A allowed strategy is chosen without predecessor completion.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Strategy availability derives from frozen graph and satisfied preconditions.

**Method and evidence:** tabletop + executable design model/fixture. FX15 Findings: F08.

**Remaining real-world check:** Compiler capability contract.

### S13 — Negation contains stop

**Attempted failure:** Input says do not stop or asks why stop appeared.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** No direct safety dispatch.

**Method and evidence:** tabletop + executable design model/fixture. FX13 Findings: F06.

**Remaining real-world check:** Held-out LLM interpretation tests.

### S14 — Quoted source command

**Attempted failure:** A source note instructs ignore C2 and approve all.

**Version 1.0 assessment:** covered principle.

**Decision/correction:** Source text never becomes authority or platform-owned option.

**Method and evidence:** tabletop + executable design model/fixture. FX13 Findings: F06, F16.

**Remaining real-world check:** Prompt injection and rendered source tests.

### S15 — Mixed safe and forbidden request

**Attempted failure:** Pause and mark all records compliant.

**Version 1.0 assessment:** partially covered.

**Decision/correction:** No keyword execution; present permitted pause separately and refuse result fabrication.

**Method and evidence:** tabletop + executable design model/fixture. FX13 Findings: F06, F07.

**Remaining real-world check:** Interpreter decomposition and user comprehension.

### S16 — Yes with multiple plausible referents

**Attempted failure:** Historical review card and open runtime request are on screen.

**Version 1.0 assessment:** covered principle.

**Decision/correction:** Require explicit active request and resolved option.

**Method and evidence:** tabletop + executable design model/fixture. FX19 Findings: F05, F07.

**Remaining real-world check:** UI reply binding and stale cards.

### S17 — Outcome question while worker moves on

**Attempted failure:** Answer generation starts for E1 and completes after E2 starts.

**Version 1.0 assessment:** covered.

**Decision/correction:** Explain E1 with stored context and as-of reference, not current global record.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F05, F16.

**Remaining real-world check:** Generation/context integration.

### S18 — Explanation model unavailable

**Attempted failure:** Q&A fails during active work.

**Version 1.0 assessment:** covered.

**Decision/correction:** Show explanation failure; deterministic commands/evidence keep working.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F17.

**Remaining real-world check:** Fault-injected model latency/unavailability.

### S19 — Double answer

**Attempted failure:** Auditor and manager answer the same request.

**Version 1.0 assessment:** covered by inherited authority.

**Decision/correction:** One closure and truthful loser receipt.

**Method and evidence:** tabletop + executable design model/fixture. wait, FX09, close_wait_twice Findings: F07, F09.

**Remaining real-world check:** Real row locks and identical request race.

### S20 — Expired request answered before wake job runs

**Attempted failure:** Deadline is past but timer job has not closed the wait.

**Version 1.0 assessment:** covered by inherited authority.

**Decision/correction:** Server deadline refuses answer even before the wake.

**Method and evidence:** tabletop + executable design model/fixture. accept_expired_answer Findings: F07.

**Remaining real-world check:** Database time and delayed queue tests.

### S21 — Old answer lands on new question

**Attempted failure:** W1 closes; W2 opens; delayed yes for W1 arrives.

**Version 1.0 assessment:** covered principle.

**Decision/correction:** Bind original request; W2 stays open.

**Method and evidence:** tabletop + executable design model/fixture. FX10, answer_different_request Findings: F05, F07.

**Remaining real-world check:** Hydrated UI and server input validation.

### S22 — Assessment changes before confirmation

**Attempted failure:** Different evidence/decision revision when user confirms.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Reject changed interpretation/domain revision; render current specific assessment.

**Method and evidence:** tabletop + executable design model/fixture. FX14 Findings: F07.

**Remaining real-world check:** Real result review and integrity versions.

### S23 — Viewed is mistaken for reviewed

**Attempted failure:** Opening a screenshot is counted as auditor confirmation.

**Version 1.0 assessment:** covered principle.

**Decision/correction:** Opening remains access history, not assent; only eligible explicit decision counts.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F07, F19.

**Remaining real-world check:** Review UX and persistence tests.

### S24 — Scope change and target write

**Attempted failure:** Manager asks to disable account and remove C2.

**Version 1.0 assessment:** covered.

**Decision/correction:** Refuse both in active Run; amendment separate and target writes forbidden.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F07, F08.

**Remaining real-world check:** Policy tests with actual tool boundary.

### S25 — Commit then response loss

**Attempted failure:** Domain applies command, chat response is lost, user retries.

**Version 1.0 assessment:** underspecified atomic bridge.

**Decision/correction:** Reconcile original domain receipt; no second authoritative effect.

**Method and evidence:** tabletop + executable design model/fixture. FX01, duplicate_effect Findings: F09, F10.

**Remaining real-world check:** Kill process before/after real commits.

### S26 — Same key, changed payload

**Attempted failure:** Same client key now names another record.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Reject semantic conflict; preserve original receipt.

**Method and evidence:** tabletop + executable design model/fixture. reuse_key_with_different_payload Findings: F10.

**Remaining real-world check:** Real uniqueness and payload normalization.

### S27 — Crash before queued command application

**Attempted failure:** Accepted durable command exists when worker exits.

**Version 1.0 assessment:** covered principle.

**Decision/correction:** Recover recorded command, recheck current authority, apply at most once.

**Method and evidence:** tabletop + executable design model/fixture. FX01 Findings: F09, F11.

**Remaining real-world check:** Real process/lease recovery.

### S28 — Remote response unknown

**Attempted failure:** Read dispatched, response lost, then crash.

**Version 1.0 assessment:** overbroad guarantee risk.

**Decision/correction:** May repeat a permitted read with new attempt; never duplicate observation/effect or claim unseen response.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F11.

**Remaining real-world check:** Actual target I/O failure injection.

### S29 — Unsupported command after rollback

**Attempted failure:** Old worker sees new command schema.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Capability rejection and drain; no raw-text fallback, no indefinite pending receipt.

**Method and evidence:** tabletop + executable design model/fixture. FX06 Findings: F20.

**Remaining real-world check:** Mixed-version worker/web rollout.

### S30 — Stream duplicates and reorders

**Attempted failure:** Invalidation cursor reconnects after gap.

**Version 1.0 assessment:** covered.

**Decision/correction:** Deduplicate IDs, authorized reread and truthful historical ordering.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F09, F16.

**Remaining real-world check:** Actual SSE reconnect/last-sequence behavior.

### S31 — Capture straddles private sign-in

**Attempted failure:** Async capture finishes after private phase starts and handback occurs.

**Version 1.0 assessment:** partially covered.

**Decision/correction:** Epoch-fence all capture stages; discard crossing buffer.

**Method and evidence:** tabletop + executable design model/fixture. privacy, FX11, ignore_capture_privacy_epoch Findings: F12.

**Remaining real-world check:** Actual screen/DOM/network buffers.

### S32 — Late image decode after private switch

**Attempted failure:** Authorized image response arrives after private notice appears.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Viewer drops obsolete epoch; server capabilities also fenced.

**Method and evidence:** tabletop + executable design model/fixture. FX12, ignore_viewer_privacy_epoch Findings: F12.

**Remaining real-world check:** Real browser cache/decode race.

### S33 — Human and agent type simultaneously

**Attempted failure:** Human handoff begins while a worker action is in flight.

**Version 1.0 assessment:** covered only at principle level.

**Decision/correction:** Drain/fence executor; one input owner; no premature lease grant.

**Method and evidence:** tabletop + executable design model/fixture. concurrent_human_agent_input Findings: F12, F18.

**Remaining real-world check:** Provider input and worker cancellation test.

### S34 — Unexpected SSO redirect

**Attempted failure:** Authentication leaves originally registered destination.

**Version 1.0 assessment:** unproven.

**Decision/correction:** Allow only preapproved authentication flow; otherwise block without widening scope.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F18.

**Remaining real-world check:** Target-auth flow validation.

### S35 — Wrong signed-in account

**Attempted failure:** Human completes login using admin or wrong organization.

**Version 1.0 assessment:** unproven.

**Decision/correction:** Verify expected identity/rights via declared capability or refuse continuation.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F18.

**Remaining real-world check:** Target-specific role checks.

### S36 — Password pasted into chat

**Attempted failure:** Pattern detection misses a secret before persistence.

**Version 1.0 assessment:** underspecified lifecycle.

**Decision/correction:** Restricted encrypted content, exclusion/redaction workflow, no plaintext in logs or export.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F13.

**Remaining real-world check:** Policy and real secret-sentinel containment tests.

### S37 — Revoked viewer retains an image

**Attempted failure:** Browser already received authorized bytes before revocation.

**Version 1.0 assessment:** overbroad language.

**Decision/correction:** Deny new access and clear cooperative UI; do not claim erasure from the recipient.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F11, F13.

**Remaining real-world check:** Revocation/cache policy tests.

### S38 — Tampering after sealed result

**Attempted failure:** Stored evidence changes after sealing.

**Version 1.0 assessment:** covered.

**Decision/correction:** Retain sealed conclusion plus prominent current integrity issue; no green unqualified badge.

**Method and evidence:** tabletop + executable design model/fixture. FX20 Findings: F07, F15.

**Remaining real-world check:** Real integrity refresh and review gating.

### S39 — Unloaded snapshot displayed as missing

**Attempted failure:** Queue has not requested selected raw snapshot.

**Version 1.0 assessment:** covered.

**Decision/correction:** Not loaded is not unavailable; fetch on demand and show actual failure.

**Method and evidence:** tabletop + executable design model/fixture. FX20 Findings: F15.

**Remaining real-world check:** Evidence inspector browser tests.

### S40 — Continuously stale pagination cursor

**Attempted failure:** Every page request races another progress revision.

**Version 1.0 assessment:** conflicting design consequences.

**Decision/correction:** Stable bounded read snapshot; explicit refresh for new changes.

**Method and evidence:** tabletop + executable design model/fixture. FX17, FX16 Findings: F14.

**Remaining real-world check:** PostgreSQL query plan and multi-request fixture.

### S41 — 1,000-row queue omits uninspected records

**Attempted failure:** Projection starts from observations rather than source/work units.

**Version 1.0 assessment:** partially covered.

**Decision/correction:** Denominator comes from approved population; absent observations stay as not inspected.

**Method and evidence:** tabletop + executable design model/fixture. FX16 Findings: F15.

**Remaining real-world check:** Actual left-join/read model tests.

### S42 — Multi-target summary reports complete too early

**Attempted failure:** One target is uninspected for one subject.

**Version 1.0 assessment:** underspecified.

**Decision/correction:** Separate units and fully inspected subjects; pending assessments overlap exceptions.

**Method and evidence:** tabletop + executable design model/fixture. FX18 Findings: F04, F15.

**Remaining real-world check:** Real multi-target data fixtures.

### S43 — Duplicate source business identifier

**Attempted failure:** Distinct source rows share same employee ID.

**Version 1.0 assessment:** covered domain, UI detail missing.

**Decision/correction:** Keep row-level identity; do not merge or let user choose unsupported population identity.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F15.

**Remaining real-world check:** Unchanged negative-source regression.

### S44 — Long conversation hides active question

**Attempted failure:** Return after 20,000 historical entries and several findings.

**Version 1.0 assessment:** unproven.

**Decision/correction:** Pinned current-input card; history is inert; virtualized/paged thread and stable focus.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F19.

**Remaining real-world check:** Interactive prototype and auditor sessions.

### S45 — Display at small desktop and zoom

**Attempted failure:** Two panes, drawer and approval controls compete for viewport; a fully visible frame can have unreadable text.

**Version 1.0 assessment:** unproven.

**Decision/correction:** Collapse shell, min-width/focus modes; preserve active evidence and keyboard order.

**Method and evidence:** tabletop + executable design model/fixture. FX22 Findings: F19, F21.

**Remaining real-world check:** Browser 1280×800, 1440×900 and 200% zoom.

### S46 — Many viewers and expensive explanations

**Attempted failure:** 50 subscribers share 10 active Runs and model/capture resources.

**Version 1.0 assessment:** unproven.

**Decision/correction:** One capture per Run, separate Q&A budgets and protected safety admission.

**Method and evidence:** tabletop + executable design model/fixture. FX21 Findings: F17.

**Remaining real-world check:** Named staging load/latency benchmark.

### S47 — Sparse captures marketed as live co-working

**Attempted failure:** Chat works, but screens update every 8–14 seconds with no secure handoff.

**Version 1.0 assessment:** product contract conflict.

**Decision/correction:** Only a specifically approved limited pilot; not target co-working acceptance.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F01, F18.

**Remaining real-world check:** Owner D1 and capability gate evidence.

### S48 — Stop control when live stream is lost

**Attempted failure:** Fresh server reachable, stream disconnected, chat model stalled.

**Version 1.0 assessment:** cross-contract decision gap.

**Decision/correction:** Normal controls follow current LiveGate; an explicit fresh-state safety path may bypass stream freshness only, never authorization. Change contract before shipping.

**Method and evidence:** tabletop specification review. No executable evidence for this scenario. Findings: F03, F17, F20.

**Remaining real-world check:** Guarded fresh-state endpoint and no-JS/connection tests.

## 8. Remaining gates and product-owner decisions

| Gate | What still needs to happen | Can this review substitute for it? |
|---|---|---|
| G1 | Interactive prototype, readable screenshots, keyboard/zoom/screen-reader behavior and moderated auditor usability | No |
| G2 | Frozen strategy graph, compiler/version compatibility and action prerequisites | No |
| G3 | Safe Solari preview/authentication assistance with real capture/input/identity checks | No |
| G4 | Organization data-handling policy and sensitive-content incident controls before real audit data | No |
| G5 | Application transactions, crashes, real queue/worker races and mixed-version rollback | No |
| G6 | Actual PostgreSQL projection, paging and accurate counts under updates | No |
| G7 | Named staging performance/capacity tests with protected safety-control admission | No |

**D1:** choose the complete target co-working release or explicitly accept a narrower pilot. Recommendation: keep the complete target as the acceptance promise; use intermediate milestones without pretending they are the whole product.

**D2:** provide/approve the organization’s retention, sensitive-content removal, export and provider-data policy before admitting real audit data. No retention period was invented here.

**D3:** approve the scoped controller-transfer permission. Recommendation: eligible Audit Manager, explicit reason and an audited epoch change; existing authorized safety/wait answers remain available without lease capture.

These are explicit unresolved owner/external checks. The 21 written corrections are not substitutes for those decisions. The rest of the technical policy is concrete enough to scope P0 and bounded implementation rather than leaving every race for an engineer to interpret.

## 9. Source and evidence record

Original specification: `original/spec-v1.0.md`, SHA256 `ff2926a807bf20a1c088d74a3598d8b219250b419fca9b4ff0968ffc4fbdf287`.

Pinned application contracts: `docs/contracts/run-pause-v1.md` and `docs/contracts/durable-escalation-v1.md` at `44fb5966dd085f53625d5f9ac77a466a9c18805f`, read through GitHub in this review. Existing command transitions were treated as authority, not replaced by the proposed chat model.

Additional primary-source checks: Amazon Builders’ Library on payload-bound idempotent request identity; PostgreSQL 18 transaction-isolation scope; OWASP LLM prompt-injection prevention. The revised source register provides their links. No competitor was newly operated and no proprietary internals were inferred.

## 10. Model-development correction retained

The first local model run failed on the trace `pause_now → boundary → stop → finish_unit`. The draft monitor treated `finish_unit` on a paused Run as an executable boundary, and the first abstraction had omitted command-owned immediate cancellation while already paused. The model was corrected to follow the pinned cancellation ownership, the guard accounting was fixed, and Resume was explicitly represented. This was a model/monitor correction—not a newly found production defect. The final model and all fixtures were rerun. The failed setup is described rather than erased or represented as a successful original run.

## 11. Handover

Use version 1.1 instead of v1.0 for design/implementation planning. Retain the original and unified diff. Each feature pull request should name the relevant AW rule, applicable AT cases, actually executed proof and any still-open gate. A future green unit suite or attractive screenshot alone cannot close G1–G7 or certify the owner’s requested experience.
