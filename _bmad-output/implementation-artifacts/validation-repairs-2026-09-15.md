# Validation repairs — 2026-09-15

The owner asked to repair the issues found while validating the recent IntelliFin
Audit updates. This change continues PR #34 on top of main `b5e2ea6`; it preserves
the production safeguard that keeps Solari provider recording disabled.

## Repaired behavior

| Finding | Repair and regression evidence |
| --- | --- |
| Questions such as “Record that?” could save a proposal or select a source. | Question punctuation is checked before command normalization. Parser tests cover save, review, selection, rejection and navigation; browser journeys check that questions leave stored scope, selection and review unchanged. |
| Improve wording and Continue refining could execute saved/provider text as a command. | The writing session records whether the composer contains fresh human input. Opening saved text, reconciling proposals and starting generation clear command eligibility. Browser coverage sends `Open evidence` unchanged from both prefills and requires a new unapplied proposal, while a fresh navigation command still works. |
| Production sign-in requests could share one rate-limit bucket. | Railway explicitly configures its documented `X-Real-IP` header. Better Auth uses only that configured header; database storage and the existing limits remain. The PostgreSQL integration checks separate clients, spoofed forwarding headers, cross-instance counters and IPv4-mapped IPv6. |
| PR #34's context-field browser assertion counted the new chat textarea as a saved field. | The assertion now counts the four context fields inside `.ls-template-fact`. The full browser suite must pass to establish that the later failures were consequences of the earlier fixture failure. |
| Real AI authoring failed with an uninformative `UNCONFIRMED` category. | The installed SDK's post-output `StreamProviderError` is now classified alongside HTTP errors. Regression streams prove 429/503 categories, safe durable failed receipts and exact recovery without another model call. Incomplete/invalid output and local progress failures have distinct safe diagnostics. **The original live cause is not yet established.** |

No question or streamed partial can accept a proposal. Successful provider completion,
final validation, exact human acceptance, stale revision protection, scope expansion
confirmation, independent approval and execution gates retain their existing rules.
No migration, new model, API key, automatic model retry or provider recording is added.

## Verification record

Local verification uses Node 24.20.0 and pnpm 11.25.0. The implementation checkpoint
has **4,262 passing unit tests across 207 files**, passing workspace/root type checks,
a clean dependency-boundary check and focused chat/authentication/authoring regressions.
The first full unit attempt found 19
toolchain invocation failures in the boundary test file; its subprocesses had picked
up the environment's fallback pnpm. The pinned executable path was corrected, and
all 26 boundary tests then passed without changing an assertion, followed by the
fully passing unit run above. Hosted gates are required before merge; exact candidate results are recorded
in PR #34, including PostgreSQL 18/migrations, full browser/accessibility, containers
and mutation safety checks.

The independent re-review found no remaining defect in the repaired chat-consent
and composer-provenance scope. The AI audit reproduced diagnostic loss for errors
arriving after streaming starts and for exceptions raised by progress delivery.
Synthetic provider transport proves those code paths; it does not prove live model
access or semantic quality.

## Live incident and remaining verification

The approved QA draft remains a Draft:
`01a0a56c-3bfe-72f5-bbf3-05607e127845`.
Its scope request failed at `2026-09-15T14:16:13.613Z`, correlation
`fe0ab1ea-8e9a-43db-8633-bf695db2ee49`, on the earlier production build.
No scope proposal was accepted, and no approval or Run was initiated.

The browser sidecar disconnected after that attempt. Connection checks and its
supported reset operation did not return, preventing another live authenticated
request in this session. The available Railway connection exposes variable names
without secret values; a configured key name is not evidence of provider success.

After deployment, retry the approved QA draft through the normal UI. Require a
complete proposal or specific clarification, verify the full-population and
unresolved-evidence constraints, save only through explicit human acceptance, and
reload to inspect the stored scope. If it fails, use the new closed category and
correlation ID to distinguish provider rate/access/availability, incomplete/invalid
output, and local progress authorization/delivery failures. Do not mark the original
live AI incident resolved until this check passes.

References: [Railway public ingress headers](https://docs.railway.com/networking/public-networking/specs-and-limits),
[Better Auth trusted IP configuration](https://better-auth.com/docs/concepts/rate-limit).

## Follow-up: Replay fixture race exposed by main CI

PR #34 passed all five candidate CI jobs: 4,262 unit tests, 552 PostgreSQL integration
tests, 203 full browser/accessibility tests and 16 focused authoring browser tests,
plus container and guard-mutation checks. It merged as `9fc71aa812f18b552f183c152c69d504bc1b7eae`,
whose tree exactly matches the tested candidate. Railway's web sign-in header was
configured with deployment skipped so it takes effect in the next release.

Main CI run `34987342406` then passed four jobs and 202 of 203 browser tests. The Replay
administrator case failed **during fixture construction, before its page or permission
assertions**. Its real frame-grant worker's recovery sweep could claim the newly
inserted RUNNING row before the fixture supplied phase checkpoints. That worker
reserved population evidence, so the database correctly refused a sealed package
with a required unregistered artifact. Cleanup also encountered the new population
evidence foreign key. The automatic release remained blocked.

The bounded follow-up creates the Run, ready population checkpoint and unexpired
agent claim atomically. It closes the agent claim after the terminal Run transition
and removes phase/population rows during cleanup. The live-state Replay assertion
also reopens the held agent claim atomically with its temporary RUNNING transition.
This uses the held-Run pattern
already present in Live View coverage and the isolated fixture repair in PR #36;
no unrelated PR #36 changes are included. The real worker, evidence seal constraints,
authorization assertions, browser timeouts and release gates remain intact. Exact
follow-up validation and release results are recorded in the repair PRs.
