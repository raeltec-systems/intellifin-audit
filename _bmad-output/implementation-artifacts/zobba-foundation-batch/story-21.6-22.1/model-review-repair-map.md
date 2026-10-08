# Formal Story 22.1 repair map

Source-to-evidence map; independent reviewers accepted all repaired findings.
Root owns focused and final execution receipts. `native-cancellation-clean`
passed 38 native tests, `operations-lease-repair` passed 5 operations tests, and
`qualification-final-clean` passed 6 qualification example tests. Final
`full-rust-5` passed **371 tests with zero failures**, including all 38 native
cases and the operations, membership and bootstrap targets. Three parent-owned
helper entries are intentionally ignored in default enumeration and exercised
by their parent contracts. Each completed receipt records exit 0 and unchanged
source during its command.

Final formatting, strict all-target Clippy, web build, 183 web checks
(`web-check-final-clean`) and process smoke (`process-smoke-final`) also passed.
**Browser-full-clean passed:** 159 cases, zero failures, zero retries and unchanged
source during execution.
The formal-review repairs introduced no further schema migration. No live
provider requests, live-qualification approval or paid qualification occurred. Receipts are in the packaged [gates directory](gates/README.md).

1. Replacement ownership: ModelStore::admit_tool now accepts the current
   ClaimBasis. ModelRepository forwards it into the sole operation owner, whose
   locked admission validates it against the immutable invocation intent/cycle/
   execution basis. The real PG replacement scenario rejects the stale owner and
   changed intent, then admits and consumes with the new owner, asserting the
   invocation's producing basis remains unchanged.
2. Cumulative history: history_authority memoizes exact exchanges by invocation
   and call identity, checks whole-content equality on repeats, and verifies
   identical current-normalized knowledge dependency sets once per transaction.
   It bounds unique exchanges/nodes to 256 and unique graph edges to 256×64;
   Kahn traversal rejects true cycles and missing nodes. Two graph unit tests
   distinguish shared ancestors from cycles. PG cumulative_history completes
   23 real proposals and consumed receipts, then admits their cumulative history
   (276 ancestry occurrences), and rejects changed duplicate content with no new
   invocation.
   Focused execution exposed a test lease lapse during these 23 SQL rounds.
   The scenario now consumes its exact Task claim once, asserts the existing
   TaskRepository::current renewal before each bounded dispatch/admission/
   consumption phase and before the final/conflicting preparations, and records
   the Task observation afterward. The five-second lease, history assertions and
   production code remain unchanged; no background renewal or timeout increase.
   The resulting operations-lease-repair run passed all 5 tests, including this
   scenario, in 71.89 seconds of test execution; the failed Fenced receipt remains
   retained separately. The final full-rust-5 operations target also passed all
   5 tests in 74.71 seconds.
3. Historical-only knowledge: PG model-forgotten-context includes a real assertion
   in the original invocation and completes a distinct tool receipt. Its next
   request has no direct knowledge reference. Before Forget it can prepare;
   afterward a fresh continuation key is refused with unchanged invocation count.
   The completed historical operation remains Completed.
4. OpenAI strict schema: openai_incompatible_strict_schemas_are_refused_before_any_send.
   Scalars and optional object properties (including nested shapes) fail local
   preflight before the loopback server receives anything.
5. HTTP status: json_labelled_http_errors_keep_status_for_malformed_and_truncated_bodies,
   http_errors_preserve_valid_usage_and_nonstandard_tier_without_replacing_status,
   optional_http_error_metadata_deadline_keeps_the_already_observed_status.
   Optional metadata cannot replace observed 429/503 classification. Bounded
   nonstandard tier evidence is permitted on Failed outcomes; success stays strict.
6. Usage: valid_usage_counter_survives_a_malformed_counter_in_real_terminal_events,
   later_error_omitting_output_usage_preserves_the_known_counter,
   usage_fields_are_independent_and_omission_never_erases_known_counts.
   Independently valid counters survive malformed siblings and missing later fields.
   Deadline error-body retention extends the existing deadline case. The final
   cancellation_retains_complete_received_json_usage_without_releasing_output
   regression covers both providers and HTTP 200/error responses: complete bounded
   JSON metadata already received survives cancellation, cancellation remains the
   outcome, and no text/tool output is released. The complete native suite passed
   38 tests in native-cancellation-clean.
7. Client policy: loopback and production share the actual ClientBuilder policy;
   loopback changes only HTTPS enforcement and proxy bypass. Existing redirect/
   HTTP-error send-count assertions plus
   shared_production_client_policy_never_replays_a_post_after_connection_loss
   exercise the shared no-redirect/no-retry policy.

The current independent adjudication and retained failures are in
[review-triage.md](review-triage.md). The failed full-rust-4 membership
save was a server-confirmed **4000 ms statement timeout** in the 101-scope fence,
not an expiry-validation rejection; the cause of the delay is unestablished.
The unchanged focused membership target passed all 3 tests, followed by all
3 membership tests passing in full-rust-5 under the same 4000 ms deadlines.
No membership code or timeout was changed. The failed receipt remains retained.

The separate qualification runner's 6 passing pure/guard tests include exact
continuation reconstruction from retained tool identity/arguments. They do not
qualify either provider. The current unapproved
[`MODEL-QUALIFICATION-PROPOSAL.md`](../MODEL-QUALIFICATION-PROPOSAL.md)
names `gpt-4.1-2025-04-14` and `claude-sonnet-4-6`, with a proposed USD20 API-token
reservation before taxes. Named account/key mapping, entitlement, exact manifest
approval and reviewed spending evidence remain prerequisites; no live sends or
approval have occurred.
