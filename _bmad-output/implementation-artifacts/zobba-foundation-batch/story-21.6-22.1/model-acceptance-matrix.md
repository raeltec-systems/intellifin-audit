# Story 22.1 local acceptance map

This maps the repaired source to the completed Rust, process and web checks.
Root owns command logs, source hashes and combined gate receipts. Independent
reviewers accepted all repaired findings. Final `full-rust-5` passed 371 tests
with zero failures; the complete browser run passed 159 cases with zero failures
and zero retries. No live model requests or qualification approval occurred.

Receipts in the packaged [gates directory](gates/README.md) all record unchanged source
during their respective commands:

- `full-rust-5-receipt.json`: exit 0, **371 tests passed**, including all
  **38 native tests**, the 5 operations tests and 3 bootstrap tests. Three
  parent-owned helper entries are intentionally ignored in default enumeration
  and exercised by their parent contracts.
- `native-cancellation-clean-receipt.json`: exit 0, **38 native tests passed**,
  including cancellation retention of received JSON metadata for both HTTP 200
  and error responses.
- `operations-lease-repair-receipt.json`: exit 0, **5 operations tests passed**,
  including replacement ownership, cumulative history and historical-only
  knowledge restriction; test execution took 71.89 seconds.
- `qualification-final-clean-receipt.json`: exit 0, **6 qualification example
  tests passed**. These are pure/guard checks, not live provider qualification.
- `web-check-final-clean-receipt.json`: exit 0, **183 web checks passed**.
- `fmt-final-clean-receipt.json`, `clippy-final-clean-receipt.json` and
  `web-build-final-clean-receipt.json`: exit 0 for formatting, strict all-target
  Clippy and web build.
- `process-smoke-final-receipt.json`: exit 0 for the final process smoke gate.

| Canonical matrix row | Implemented contract | Executed/pending evidence |
| --- | --- | --- |
| Native request | Portable requested profile/account, Task/cycle/claim, intent/execution, exact Send payload classification attachments, catalogue and context; durable SQL cutoff before HTTP | Both native envelope fixtures passed in native-cancellation-clean; SQL cutoff and payload/classification checks passed in operations-lease-repair |
| Streaming | Ordered portable text, tools, structured output, refusal, independently retained usage counters and exact actual provider/model/tier; complete terminal validation | Native-cancellation-clean passed all 38 cases, including terminal identity, Standard processing tier, strict structured schemas and independent usage retention |
| Framing | Incremental split UTF-8, CRLF/multiline frames; independent bytes/depth/nodes/count limits; strict duplicate keys | Boundary, malformed/deep/oversized, valid-prefix retention and strict-decoder cases passed in native-cancellation-clean |
| Tool admission | Exact prepared canonical argument schema; invocation/call/operation digest binding inside the sole Permissions owner; current catalogue/qualification repeated before consume | Domain/application checks passed in library-review-repair; substituted account, erased provenance, unknown call, replacement-owner admission/consumption and consume fences passed in operations-lease-repair |
| Current authority | Current Admin session config boundary, true Admin-only read/write; organisation and Task fences; exact knowledge and historical source dependency checks; unconsumed projection restrictions | Operations-lease-repair passed Admin-only replay/revision, payload mutation/class denial, profile/catalogue races, real Pause/Stop locks, membership races, knowledge Forget projection and historical-only dependency withdrawal with zero new invocation |
| Partial/failure | Provisional text retained; partial tools stripped; unknown usage honest; no retry/redirect/fallback; explicit unsupported effort/events | Native-cancellation-clean passed EOF/refusal/truncation, 429/5xx/auth, redirects, deadline and cancellation cases. Shared production client policy proves actual send counts; cancellation preserves complete received JSON metadata for HTTP 200/errors without releasing output |
| Recovery | Exact durable invocation replay/replacement owner recovers original without HTTP; current replacement basis admits/consumes while immutable producing basis remains unchanged | Application recovery checks passed in library-review-repair; exact key, missing result, terminal tool receipt and genuine replacement-owner recovery through admission/consumption passed in operations-lease-repair |
| Hostile content | Owned typed assistant call/tool result history; strict correlation and attribution envelope; source/tool text never becomes trusted instruction, endpoint or a new tool | Actual Responses/Messages hostile-result fixtures passed in native-cancellation-clean. Operations-lease-repair passed 23 cumulative turns (276 ancestry occurrences), conflicting duplicate rejection and historical-only knowledge restriction |
| Schema/prefix | Additive unpublished migration 11, forced scoped append-only RLS, narrow model Admin function only, exact runtime inventory/ACL and populated 10→11 upgrade | Schema capture is raw supported query in rollback transaction; old files 1–10 unchanged in root integrity receipt; final full-rust-5 passed all 3 bootstrap tests (including complete bootstrap_contract) in 307.17s |

The focused cases mapped above were also included in the completed final
`full-rust-5` run; operations passed all 5 tests in 74.71 seconds. Independent
reviewers have accepted all repaired findings, as recorded in
[review-triage.md](review-triage.md). Root also has passing architecture
boundary (`boundaries-accepted`) and credential-free dry-run
(`qualification-dry-run-review`) receipts, plus intentional missing approval
refusal (`qualification-refusal-expected`, expected exit 1).

**Browser validation passed:** `browser-full-clean` completed all 159 cases
with zero failures, zero retries and unchanged source during execution.

Earlier failed PG and stack diagnostic attempts remain failures in their receipts.
The test VerificationItem shape was repaired after two ineffective compile
attempts. Large model futures were bounded with targeted heap allocation at the
production/test seams. The cumulative history test now consumes the exact Task
claim, renews it through `current(&basis)` between bounded SQL phases, and records
completion. All history assertions and the five-second lease remain unchanged;
no global stack limit, timeout increase or background renewal was introduced.

`full-rust-4` remains a failed receipt: the legacy membership expiry save returned
Unavailable after a PostgreSQL **4000 ms statement timeout**, confirmed in the
existing server log inside the 101-scope membership fence. The delay's cause is
not established. The unchanged focused `membership-failure-diagnosis` target then
passed all 3 tests in 34.40 seconds, and `full-rust-5` passed its membership target's
3 tests in 32.37 seconds under the original deadlines. No membership code or
timeout was changed; final database and browser gates were executed sequentially.

## Deliberate limits / external blocker

- Story 22.1 stays in progress: both provider live qualifications require separate
  owner-approved credentials, exact named account/key mappings, destinations,
  model IDs and a real reviewed total spend bound. Fixtures cannot qualify live.
- The exact current proposal is
  [`MODEL-QUALIFICATION-PROPOSAL.md`](../MODEL-QUALIFICATION-PROPOSAL.md):
  `gpt-4.1-2025-04-14` and `claude-sonnet-4-6`, with **USD20 of API-token usage
  before taxes** proposed for six attempts. These text/tool profiles are not
  approved, and account entitlement remains unverified. A differing actual model
  ID fails qualification; there is no substitution. The launch-budget reasoning
  models are outside this adapter's currently supported effort capability.
- Native effort supports None only. Unsupported events/capabilities fail closed.
  Initial JSON schema supports integer numbers; fractions/exponents are refused.
- Catalogue tools are exact prepared operations. Variable-argument investigation
  tools need an owned resolver registry and exact resolved-operation admission;
  that wider resolver is not implemented or implied by these contracts.
- Trusted server composition, not public caller declarations, assembles context
  and classification. There is no raw-prompt HTTP endpoint or autonomous API/worker
  loop; Story 22.2 owns continuing execution and full context assembly.
- Native non-secret account labels are bound consistently but do not prove the
  provider account behind a key without deliberate operator mapping.
- Tool receipt disposition establishes an execution fact, not source-content truth.
- Local cancellation cannot establish provider non-execution or absence of charge.
- The synthetic runner bypasses the Task gateway solely for isolated adapter
  qualification and executes no external tool effect or trusted registration.
  It caps six sends, 16 KiB request bodies and 1,024 output tokens each. It does
  not infer billed input tokens from bytes. The proposal reserves the entire
  documented context capacity per attempt at explicit Standard rates, plus the
  output cap and Anthropic's possible US geography premium: USD16.7416224 before
  taxes, inside the proposed USD20 reservation. Its dated pricing references and
  account terms require review before approval; the environment confirmation is
  not billing enforcement or an account-wide limit.
- One-shot runner approval receipts are durable local files; the reviewed receipt
  directory must be retained. Intentional external deletion is beyond this guard.

Final Rust, qualification guard, web check/build and process gates passed.
The complete browser gate passed all 159 cases. These local results do not satisfy
the separate live qualification blocker.
