# Story 22.6 review fixes (patch list, 2026-10-14)

Source: Blind Hunter, Edge Case Hunter, Verification Gap reviews of the uncommitted 22.6 diff.
All are patches (no intent/spec loopback). Keep everything that works; fix only these.

## Investigation (application/infrastructure/migration)
1. `Investigation::script`: distinguish "no sandbox composed" (explicit NoScripts marker) from transient `ReadingError::Capacity`. Capacity must propagate (retryable, not recorded), never become an immutable `tool_unavailable` fact.
2. `record_use` refuse path after a script already ran: keep the real `job_id` on the fact (outcome unavailable/failed with job), never drop the link to a job that ran.
3. Migration guard `jsonb_agg(... ORDER BY x->>'original_id')`: add `COLLATE "C"` so SQL order equals Rust byte order.
4. Platform gaps uncapped: cap agent+platform notes so ordinal ≤ 63 and record ≤ 64 gaps/questions/statements; count the rest as omitted (no failed cycle). Bound record `skills`, `method_version_ids`, `tools` to 64 and the record document under its CHECK size before insert.
5. `InvestigationRecord` provenance: take method status and version IDs from the turn's binding (or skip when turn binding != current); filter skills by binding AND execution epoch and only uses of that turn/invocation.
6. `cycle_uses`/`cycle_notes`/`fetches` LIMIT caps: do idempotency/loaded/first-of-kind checks by exact invocation/version queries, not the capped list; return exact totals and an omission count to `view` so the panel can say it is truncated.
7. Include `execution_epoch` in first-of-kind and fetch `first` comparisons.
8. `context`: deduplicate fetched parts by part_id and resources by (version, resource); fix "newest load first" (iterate newest first or fix comment consistently); drop the earlier-binding reload notice when a current load exists; drop stale refusal lines once a later success exists; keep the NEWEST feedback lines when capping `MAX_FEEDBACK_LINES`.
9. Script output in context only while the version is still in `gated` (same rule as loaded resources).
10. `outline`: apply the byte budget to every section (versions, sources, issues, brief_only, templates) and count omitted parts; also bound the skill listing so the never-dropped tier cannot by itself cause `context_budget`.
11. `bounded()`: result must be ≤ max bytes including the ellipsis.
12. `record_use`: refuse as Unavailable (fixed reason) if an allowed gate has an empty dependency fingerprint, instead of hitting the CHECK.
13. `record_notes`/`record_investigation`/`record_fetch`: on an existing row, compare content; a non-identical retry is a refusal, not silent acceptance.
14. `skills_work`: it takes advisory 205 after Task row locks (inverts documented order). Make it a non-locking read, or take advisory 205 before any engagement/Task lock in the claimed transaction. Prove no deadlock with skill status writers (test or reasoning in a comment).
15. Immutability triggers: also refuse DELETE and TRUNCATE on the five new tables (owner included), matching existing immutable fact tables.

## Answer schema / work loop
16. `CitedAnswer`: normalize (sort/dedup) `read_method`, `use_skills`, segments; drop individually invalid notes/requests (counted) instead of rejecting the whole answer.
17. When investigation is not composed, use a schema without the 22.6 fields and do not widen `requests_reading()` for them.

## API
18. `get_work`: an `investigations.view` error leaves `investigation` absent (with a fixed unavailable marker), not a failed whole response.
19. `open_questions`: resolve the question's ordinal from the note's invocation via the store, not the paged `work.steps`; document the same-ordinal boundary.
20. Proposals: the 14 s request timeout must not drop the future after disclosure — run the propose work detached (or cancel through ModelCancellation and record a failed result), and return the recorded status; show "in progress" (not "uncertain") while within the send window.
21. Separate concurrency limits for POST propose and GET list/read (reads never 429 because drafts are in flight).
22. Exact retry: return the `by_key` result before requiring an object store.
23. Object key derived from the document digest (content-addressed) so retries do not leave orphan copies; mint the proposal id from the request key, not a fresh random per POST.
24. Model request key from the proposal id/request key, not document digest alone.
25. Disclosure `expires_at` from database time; no `unwrap_or(1)` fallback.
26. Bound the drafted result under the 1 MiB column (cap citations/quotes, count omissions) or record a failed result with a fixed reason on 23514 — never stuck uncertain.
27. Citations/unverified bounds consistent between Rust draft and `web/src/proposal.ts` (both 4096, draft enforces).
28. `Verifier::values`: values beyond MAX_FIELD_VALUES go to `unverified`, never vanish.
29. Name: run `valid_scope_label` before keeping its citation.
30. `locate`: minimum quote length (e.g. 12 bytes or ≥3 words) and report ambiguity when the quote occurs more than once (cite all occurrences or mark ambiguous); document in README that a verified quote proves the source text exists, not that the value is correct — the Admin reviews before Save.
31. Request schema: byte limit (not chars) documented; body limit large enough for a 200,000-byte document after JSON escaping, or a specific `document_too_large` refusal.

## Web
32. `work.ts shortText`: count code points (`[...value].length`), not UTF-16 units.
33. `proposal.ts text()`: byte limits equal the server's (no `* 4`).
34. `MethodologyProposal.tsx`: read the file as bytes and refuse non-UTF-8 (TextDecoder fatal, keep BOM as-is) instead of `file.text()`; client-side label/control validation; a definite 400 is shown as a refusal, not "unconfirmed"; failed list read shows an error, not "no proposals"; map every failure reason code to words; byte range reachable by keyboard/screen reader (not title-only).
35. `TaskWorkPanel MethodAndSkills`: label uses by their actual outcome; while answers are loading/failed or outside the page, say "citation not loaded", never "no citation"; render sources when citations undefined; mark questions open vs answered (from `open_questions`).

## Tests to add
36. Work loop with a small `ContextBudget`: one oversized and one small skill-tier item → big one absent, `skills_budget: 1` in omissions, step succeeds.
37. PostgreSQL worker test: a skill script that fails and one that exceeds limits → `failed` rows with job IDs, "did not produce outputs" in the next turn.
38. Capacity refusal from the sandbox is not recorded and is retried.
39. Proposal: timeout/in-flight read, over-limit document, retry of a failed key without resend, result over 1 MiB.
40. Investigation caps (notes > 64, uses > 512) do not fail the cycle.

## Bookkeeping
41. Add a dated `CLAUDE.md` decision entry for Story 22.6 (progressive disclosure tiers, skill listing tier, platform-gap rules, proposal custody, no production proposal transport, text/Markdown only).
42. Record in the spec which verification commands actually ran and their results.

## Deferred (not this story)
- Proposal list pagination / N+1 read (20 recent is acceptable for now).
