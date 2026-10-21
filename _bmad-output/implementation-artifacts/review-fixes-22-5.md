# Story 22.5 review fixes (step-04 patch findings, 2026-10-14)

Apply on top of the current branch. A first fix agent was interrupted by a container restart after partly applying these (WIP commit dc085b4): inspect the current code and finish every item; do not assume any is done.

## A. Transient failures must never become permanent facts
1. read_page: render() Unreadable because the job ended Unknown/Stopped/unsettled (job_unknown, job_stopped, no_manifest from an unsettled job) → return Unavailable, record nothing. run_job: not Collected/Stopped/Unknown after bounded polls → Unavailable, not a no_manifest/job_unsettled fact.
2. models.invoke Capacity/Unavailable during a page read must not consume one of the 3 attempts.
3. run_program: run_job Capacity/Unavailable → propagate, record no ProgramRun.
4. Verification: Capacity/Unavailable from reader.original/locate/page → propagate (no record_citations; retry on reclaim); only definite unreadability is source_unreadable. Trusted program `unsupported` for a mismatched locator family → not_found_at_location (or closed `wrong_location_kind`).
5. work.rs: reading.context Capacity → CycleEnd::Unavailable (not Failed). Check `self.cited()` before reading the invocation on the NoReading path.
6. read_after: other errors must not silently drop an answer; record a visible "verification failed" state the API returns (or retry).

## B. Context and loop correctness
7. Reused page reads from an earlier cycle: include their transcription in the current context when the model depends on them; never tell the model nothing.
8. reading_context: order by the max pushed key or real creation time; trimming keeps newest; an oversized single reading is skipped (continue), not break; explicit omission line when bounds trim.
9. after_answer true only when ≥1 request produced a new read or program run; refused/settled requests reported back to the model with a closed reason.
10. Next-turn context includes per cited source verified/unverified + reason.
11. Intermediate turns with no answer segments are not listed as answers; domain and web agree; web unit test parses the exact API JSON from the worker test.
12. Page cap is a COUNT: page numbers up to a sane bound (e.g. 10,000); at most 200 distinct pages read per document per Task, in code and the task_page_reads CHECK/migration.
13. Offer read_pages only when the profile has image_input and the encoder supports it; page-read requests use an empty tool catalogue.
14. Thread caller cancellation into CitationReader::locate/page and document jobs.
15. No silent truncation in page_reads/program_runs/job_outputs; query exactly (by original+page, invocation+ordinal) or page to the end; cap counts exact.
16. record_program_run: differing existing row → Invalid; ProgramRun::is_valid; reading_guard trigger for task_program_runs.
17. document_renders guard requires program_sha256 == trusted document program SHA.
18. image/png output only for the trusted document program, not model programs.

## C. Security and API
19. answers.rs: no recorded original_sha256 → not navigable/readable (is_some_and); unreadable sources also withhold locator, location and byte offsets.
20. Batch original lookups per request; invocations.get errors other than Denied → error; ReadingError::Invalid → server error, not 403.
21. Deterministic oldest-first answer order (sub-second or sequence).
22. NULL filename handled; missing descendant row in load_batch → explicit Unavailable.
23. Web parseSource uses the evidence filename bound; one bad answer is skipped with a notice, not blanking all.

## D. document.py hardening
24. parse_ref, message.get_all, render_pdf page loop in try/except → closed reasons (bad_reference, malformed_message, render_failed); render exception never page_too_large.
25. PNG/JPEG: refuse width*height > MAX_PIXELS before sending.
26. safe_zip: stream with an actual decompressed byte budget; zero compress_size is not a bypass.
27. Email detection needs real RFC 5322 header structure, not any "Token:" first line.
28. Document in citation instructions: part:N, paragraph:N, header:Name, and range-quote joining rules.
29. Remove the dead first assignment in bind_disclosure.

## E. Tests (each fails if its guarded code is removed)
30. history_authority: forged/edited transcription, wrong role, no matching page read → Conflict.
31. ModelRequest::validate: image on System/Assistant, User without source_id, in history → Invalid.
32. run_program outcomes: program_failed (sys.exit(1)), program_limit, input_not_registered, omitted/binary outputs, output bound.
33. Register Receipt photo.jpg and Macro workbook.xlsm: JPEG read, macro workbook citation (macro not run), cell-range citation, oversized page.
34. Two-cycle page read; reading_context ordering/truncation; byte_range/page/locate error paths; viewer with the Task but no access to a registered original → withheld.
35. CI: registry by digest and removed after; build.sh uses the mirror or a digest-pinned base; pin pip and buildx; trap cleanup.
36. Citation card: Escape only when focus is in chip/card; card positioned against its chip; clear sourceNotice on change.

## Environment note
After a container restart the test cluster is down: `pg_ctlcluster 18 zobba start` (config in /etc/postgresql/18/zobba, port 55434), then `. /tmp/zobba-env.sh`. Use `?sslmode=disable` on local test URLs where the bootstrap/proxy tests need it.
