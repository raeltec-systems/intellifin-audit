# Review 24.4 — Verification Gap

Reviewer: Verification Gap lens (read-only). Range: `git diff 523ad5f3 a03feb80 -- zobba`.
Question asked of every rule: which test fails if the rule is broken?

Counts: **High 2 · Medium 9 · Low 7**, plus one flaky-test root cause.

The application layer (`application/src/work_product/tests.rs`) and the worker
end-to-end proof (`worker/tests/work_product.rs`) cover the happy path and the
16 closed refusal reasons well. The main gap is the database: the migration's
guards are the "layer nothing can route around", but trusted code refuses the
same faults first, so almost every SQL branch can be deleted with the suite
green. Only two forgeries are tested.

---

## High

### H1. SQL record agreement is forged for one kind only (count value) plus a quote digest
- **Rule:** migration 0022 recomputes every assertion kind in SQL (`outcome` head/effective outcome/origin/review/subject, `count` digest/superseded/kind/subject/value, `conclusion`, `exception` status/subject/identity digest, `fact` value/unit/subject/supported/superseded, `period`, same-Task).
- **Enforced:** `zobba/migrations/0022_work_products.sql` `work_product_batch()` CASE (≈lines 515–535), helpers `work_product_heads`, `work_product_summaries`, `work_product_facts`, `work_product_count`.
- **Why tests cannot catch a regression:** `database_guards_refuse_altered_work_product_records` (`worker/tests/work_product.rs:2054-2118`) forges exactly two rows: a count `value+1` (multi-row, one bad row — good) and a quote `record_digest`. Every other WHEN branch, and the digest/superseded/subject conjuncts of the count branch, can be removed or replaced by `true` with all tests green, because `application::work_product::assemble` refuses those faults before any INSERT. No test pins a record from another Task.
- **Test to add:** one table-driven SQL test, as the migration owner under `RESET`, rewriting a kept fresh assertion with exactly one bad column per case, each inside a multi-row INSERT with good rows, asserting the message names the bad `version/block/ordinal`: outcome verdict, outcome on a non-head (revision 1 after revision 2), outcome origin, outcome review, outcome subject, count on a superseded summary, count digest, count with wrong `record_kind`, conclusion code, exception status, exception subject, exception digest, fact value, fact unit, unsupported fact, superseded fact, period value, and a record ID of another Task (same engagement).

### H2. Most row/commit guards of 0022 have no test at all
- **Rules and enforcement (all in `migrations/0022_work_products.sql`):**
  - `work_product_guard` on `work_products`: invocation/cycle/actor/binding match; template current/source/name/neutral/sections; ≤16 products per Task.
  - on `work_product_versions`: agent version's invocation/binding/epoch; person's version names the current binding and epoch; product of its own Task; version follows its product's template; first version is the agent's in the creating invocation.
  - on `work_product_exports`: requester assigned in own session; version of its Task; `refresh_count ≤ claims`.
  - `work_product_batch` blocks: of its version/Task/actor, section in template, new block has the version's author; assertion is of a claim block.
  - `work_product_complete` (deferred): rows equal the document; ≤48 claims, exactly one limitations block, 1–8 assertions per claim only; coverage/exceptions records of its Task; **kept block byte-equal to its source**; **agent never changes or drops a person's block**; **person adds no block and keeps kind/section/label/record/assertions**; `missing_required` exact; ≤256 versions.
- **Why tests cannot catch a regression:** a grep of every message across `crates/*/tests` finds only "edits its product's latest version", "does not agree with its record now", "immutable", "retained" and the session guard. Each other guard can be deleted silently; the application refuses the same input first (`human_block_dropped` and keep-by-ID are proved only against the in-memory fake store and the trusted application).
- **Test to add:** owner-level forgeries, one per message, each changing one thing and committing (deferred trigger) inside `refused_in`: a kept block with a changed body; a kept block whose assertion differs; an agent version omitting the predecessor's human block; a person version adding a new block; a person version changing a claim's assertion; `missing_required` off by one; a second limitations block; a 49th claim; a block in an unknown section; a product on a non-current binding; a 17th product; an export with `refresh_count = claims+1`; an export outside a session.

---

## Medium

### M1. The concurrent-fork test cannot fail for its reason
- **Rule:** one successor per head under the per-product advisory lock; loser gets 409 `stale_base` naming the head.
- **Enforced:** `0022` `work_product_guard` (`pg_advisory_xact_lock` + head check); `UNIQUE(…,predecessor_id)`; mapping in `infrastructure/src/assessment/work_product.rs:364-374`.
- **Why:** `worker/tests/work_product.rs:1617-1631` `tokio::join!`s two posts with no held transaction (the CLAUDE.md lesson "a concurrency test that starts two calls at once proves nothing"). Usually the second sees the new head in the application pre-check (`save_edit`, `application/src/work_product.rs:2424`). Without the lock the unique constraint still fails the loser, mapped to `StaleBase(String::new())` (line 372), and the test asserts `error` only, never `head`. Removing the lock or the trigger's head check passes.
- **Test to add:** hold writer A's transaction open after its INSERT and before COMMIT, observe writer B waiting on the advisory lock in `pg_stat_activity`, release, and assert B's 409 names A's version as `head`. Also assert `head` in the existing race.

### M2. `export_scope_changed` and viewer withholding are never exercised end to end
- **Rule:** a quote the viewer cannot read now is withheld (never stale) in API, web and exports; download requires the current withheld set to equal the export's (409 `export_scope_changed`).
- **Enforced:** `application/src/work_product.rs` `download` (≈2780-2790), `export_view`; `api/src/work_products.rs:404-470, 1035`.
- **Why:** proven only against the fake store (`exports_are_deterministic_and_bound_to_the_viewers_withheld_set`, `currency_is_derived_on_read_and_withheld_quotes_are_never_stale`) and a mocked 409 in the browser spec. In the worker e2e every viewer can read every original. The variable named `scope_changed` (`worker/tests/work_product.rs:1741-1751`) actually asserts `work_product_export_conflict` (key reuse) — a test whose name promises the rule it does not check.
- **Test to add:** in the worker e2e, revoke a second viewer's access to the policy original (assignment of the source), then: version and support responses show the quote `withheld` with no value/source and the claim still current; that viewer's download of the first export answers 409 `export_scope_changed`; their own export carries "withheld for this viewer" and a different `withheld_digest`. Rename the existing variable.

### M3. Edit authority: unassigned, revoked mid-request, revoked replay, another session
- **Rule:** currently assigned Auditor/Audit manager, in their own session, rechecked in the write transaction; replay answered only to a person who may edit now.
- **Enforced:** `infrastructure/src/assessment/work_product.rs` `person_fence` in `edit_basis`, `version_by_key` (667-693) and `record_person` (694-); SQL `knowledge_audit` + `evidence_session_locked` in `work_product_guard`.
- **Why:** tests cover Admin-only (403, app `Denied`) and the SQL "no session" case only. An unassigned auditor, an assignment revoked between `edit_basis` and `record_person`, a revoked actor replaying an exact key (the `person_fence` in `version_by_key` can be deleted with all green), and a valid session hash of another actor are untested. The SQL "no session" case also cannot tell knowledge_audit from session failure.
- **Test to add:** API: unassigned auditor → 403; revoke the assignment, replay the `edit-1` key → 403 (not the stored v2). SQL: person config with another actor's session hash → refused; assigned actor whose assignment expired → refused.

### M4. Export retry can record a digest the store does not hold; store failure is untested
- **Rule:** object store failure → retryable 503, nothing recorded; recorded size/digest are the stored bytes.
- **Enforced:** `application/src/work_product.rs` `export` (≈2735-2745): on `ObjectError::AlreadyExists` it adopts `latest_version(&id)` but keeps `digest`/`size` of the bytes it just rendered.
- **Why:** `export_id(actor, key)` is deterministic. If `record_export` fails after `put_if_absent` succeeded, a retry after anything changed the render (refresh words, editor labels, withheld set) records a digest of new bytes over the old object: every download then fails `Integrity` permanently. The fake store's `put_if_absent` never fails and no test retries after a failed record. This is a probable defect, not only a gap.
- **Test to add:** fake store whose first `record_export` fails; change a record so the claim needs refresh; retry the same key; assert either the recorded digest equals the stored object's digest or the retry is refused. Plus a `put_if_absent` returning `Unavailable` → `ExportError::Unavailable` and no row.

### M5. Refresh reasons through the real SQL path
- **Rule:** six closed reasons from `work_product_current`.
- **Enforced:** `0022` `work_product_current`; `application::work_product::claim_currencies`; `domain::work_product::currency` (`domain/src/work_product.rs:1175`).
- **Why:** the worker e2e drives `summary_superseded`, `evaluation_revised`, `disposition_changed`. `exception_status_changed` and `fact_superseded` are proved only against the fake store; the SQL for exception status and successor-basis fact replacement (`work_product_facts` recursive walk) can be wrong unnoticed. `source_withdrawn` is unreachable: originals are immutable, so `o.digest` never differs from the pinned digest; it is proved only by a hand-built `Current` in the domain test. A withdrawn source is reported withheld, not `source_withdrawn`, which differs from the spec text ("quote no longer verifies").
- **Test to add:** worker e2e: a 24.3b exception status change and a successor basis replacing the cited fact, then read v1 and assert `exception_status_changed` / `fact_superseded`. Decide what `source_withdrawn` means and either test its real trigger or remove it.

### M6. Web parser: two cases break two rules, and no case checks which rule threw
- **Rule:** one rule per case (`web/tests/work-product.test.mjs` "each version rule refuses exactly its own defect").
- **Enforced:** `web/src/work-product.ts` `parseAssertion`/`parseClaim`/`parseBlock`/`parseVersion`/`parseSupport`/`parseExport`/`parseShelf`.
- **Why:** `assert.throws(fn, undefined, name)` accepts any throw. "a different version than asked" also breaks the newer-version rule; "a second limitations block" also duplicates a block ID. Rules with no case at all: every `parseAssertion` invariant (withheld non-quote, quote without `original`, source ≠ record, non-quote with source, null value not withheld), `parseClaim` (number < 1, no assertions, refresh/refresh_words length, duplicate reason, withheld claim without withheld assertion), `parseBlock` (label/narrative, text byte bound, coverage without record, claim block without claim), `parseVersion` (version 1 with predecessor, duplicate sections, 49 claims, withheld count, `not_completed` on a non-required section, `newer_version_id` ≠ head, agent version label), shelf C-order, `parseSupport` item count, `parseExport` size bounds.
- **Test to add:** have `invalid()` throw a coded error (or a distinct message per rule) and assert it; one mutation per missing rule.

### M7. The browser spec answers its own writes; success and some focus paths are never run
- **Rule:** accessible editor with focus return; refusals in words; exports.
- **Enforced:** `web/src/WorkProductDocument.tsx`, `WorkProducts.tsx`.
- **Why:** `web/tests/browser/work-products.spec.ts` fulfils every work-product read from recorded fixtures (good, pinned by `fixture()`), but the edit 409 bodies, the stale-base body and the export record are hand-written JSON, never checked against the real API. Both edit POSTs are refused, so a successful save (new version shown, focus moved, "newer version" state) is never rendered; the editor's Cancel focus return and the withheld-quote rendering ("withheld for this viewer", no Open) are untested.
- **Test to add:** record the real 409 `unsupported_figure`, `stale_base` and export response JSON in the worker e2e as fixtures and serve those; a browser case for a successful save (focus lands on the new version heading) and for Cancel (focus returns to "Edit into a new version"); a withheld fixture case.

### M8. Quote agreement is not recomputed in SQL
- **Rule:** "record agreement recomputed in SQL" for every assertion; a quote must verify.
- **Enforced:** `0022` `WHEN 'quote' THEN o.digest = f.record_digest AND f.subject IS NULL` only.
- **Why:** the quote text (`value`) and `locator` are not checked by the database; a row with the right original digest and any quote text is accepted. No test can catch a regression of the quote text check below the application, because there is none. The migration comment states the weaker rule honestly; the spec does not.
- **Test to add / decision:** either record in the spec that quote verification is application-only (bytes live in object storage), or add a forgery test that documents the accepted forged quote so the limitation is explicit.

### M9. Shelf paging, exact count and visibility are untested beyond one product
- **Rule:** exact count, C-ordered 50 page, cursor, only Tasks the viewer may see now.
- **Enforced:** `infrastructure/src/assessment/work_product.rs` shelf (`ShelfPage`, ≈896-).
- **Why:** the worker e2e has one product; no cursor, ordering, 16-per-Task cap or hidden-Task case is exercised.
- **Test to add:** seed ≥51 products over ≥4 Tasks (one Task the viewer is not assigned to), page with `cursor`, assert exact total, C order, no duplicates, the hidden Task's products absent and counted out.

---

## Low

- **L1. LibreOffice check is weaker than it reads.** `worker/tests/work_product_office.rs:208-221`: `"1200"` appears whether LibreOffice shows the SUM cell or the stored total cell, so a wrong cached SUM passes; `[1]` checks text, not a working link; footer/page field are not checked in the opened document. It does fail (not skip) without `soffice`, and CI installs it (`.github/workflows/zobba.yml:136-140`). Add: compare the SUM cell's rendered value with its own row, and assert the PDF has 2 pages or a page number.
- **L2. Every `[n]` resolves:** DOCX tests assert `citation_1` only (`domain/src/work_product/tests.rs:745`, `worker/tests/work_product.rs:1698`). Add: every `w:anchor="citation_n"` has a matching `w:name`, n = 1..claims.
- **L3. Fixture reset:** TRUNCATE under `RESET` (allowed) and the refusal in a database not named `*_test` are untested; the RLS `scoped_insert` policy (insert under another engagement) is untested.
- **L4. Determinism scope:** export bytes include current refresh words and editor display labels, so "same version + format + withheld set → identical bytes" holds only while currency and labels stay unchanged. Clarify in the spec or bind them in the identity.
- **L5. Download path:** `api/src/work_products.rs` `content` validates `product_id` format but never checks it is the export's version's product; untested.
- **L6. DB-refused agent write feedback** ("the platform's own check disagreed", `application/src/work_product.rs:1511-1513`) has no test; the TOCTOU between application check and insert is the one path where "model input never fails a cycle" depends on it.
- **L7. App refusal table:** `every_refusal_reason_names_its_block_and_records_nothing` matches with `contains`; "15 invoices failed." with `count(not_met)=14` breaks the figure rule too (15 is not an asserted value). It still kills a removed count check, but it is two faults in one case.

---

## Flaky test: `standing_permissions_exact_operations_and_transaction_cutoffs` (`Fenced` instead of `Waiting`)

**Hypothesis (high confidence):** the owner lease expires during test setup, before `owned()` starts renewing it.

- The 5-second lease (`infrastructure/src/task.rs:19`) is set by `coordinate` (`task.rs:527-528`), called inside `Fixture::case` (`infrastructure/tests/operations.rs:265-268`). `consume` (`task.rs:851-905`) does **not** renew it.
- `stale_after_withdrawal` (`infrastructure/tests/operations/work_cycle.rs:3062-3076`) calls `consumed()` and then, before the first `owned(...)`, runs `knowledge.clear("work-stale-clear")` and `knowledge.assert(...)`. `clear` (`work_cycle.rs:2686-`) pages through every current knowledge record the Task can see (up to 64 pages) and forgets each one with its own `mutate` command, each under organisation/engagement locks. The record count grows with every earlier case in the same `verify` run.
- When that setup takes more than 5 s (full suite, `--test-threads=1`, load), `owner_until` passes. `owned()` (`work_cycle.rs:2494-2530`) polls `run` first (`biased`); the loop's first boundary sees `continuation_current` false (`task.rs:1022-1029`, `owner_live`) and ends `CycleEnd::Fenced` (`application/src/work.rs:1855`). The renewal ticker never gets a chance: renewal is impossible once the lease has expired (`current` also requires `owner_live`).
- It fits the evidence: intermittent, more likely late in a long run, and it failed once "alone" because the accumulated knowledge records are created inside the same test.
- `stale_after_correction` (`work_cycle.rs:3175-`) has the same shape (clear + assert after `consumed()`).

**Fix:** do not leave a lease idle across slow setup. Either (a) do the knowledge setup before the lease is taken — split `Fixture::case` into admit/accept and a separate `coordinate`+`consume` step, and call it after `clear`/`assert`; or (b) run setup inside a helper that renews like production (the same 200 ms `f.tasks.current(&basis)` ticker `owned()` uses, started right after `consume`). Do not lengthen `OWNER_LEASE_SECONDS` (CLAUDE.md 2026-10-08). Optionally make `clear` cheaper (one bulk forget) so the window shrinks for every caller.
