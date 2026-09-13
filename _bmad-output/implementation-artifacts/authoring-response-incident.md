# Authoring response incident — 13 September 2026

Baseline: `origin/main` at `182d0b75d77fec2ecf26aa95a9ad6efd5e1b78d1` (merged PR #32). Correction branch: `codex/fix-authoring-response-recovery`, targeting `main`. The worktree was clean and current remote state was fetched before editing. The user has authorised merging after validation and observing the Railway release.

## Confirmed incident evidence

The user's mobile Scope note conversation showed “Suggest to me” followed by an incomplete response and recovery notice. Railway recorded `POST /api/procedures/authoring` at `2026-09-13T04:41:50.789932941Z`: HTTP 200, 3,754 ms, no upstream proxy error. The web deployment was successful and healthy. No PostgreSQL ERROR/FATAL lines appeared in the incident window. These observations do not establish that OpenAI succeeded, or that no application/transaction error occurred.

The route started HTTP 200 before generation and silently converted unexpected application errors into an `uncertain` frame. The client correctly refused to accept this as a completed suggestion. The precise production exception was not retained; the incident's underlying cause remains unconfirmed. A generic provider failure alone normally becomes a confirmed failed receipt, which the client already accepts. Do not describe this patch as proof that the production generation defect has been reproduced or resolved.

## Correction

- Preserve only closed provider failure categories through the existing AI SDK adapter: authentication, access, request configuration, usage/rate limit, timeout, unavailable and unconfirmed output. Present fixed actionable messages in confirmed failed receipts. No provider body, error cause, prompt or key crosses the port.
- Report unexpected authorisation, preparation, provider and finalisation failures through the existing minimising telemetry facade. Retain a correlation ID, procedure ID, stage and safe error kind/code; never raw error messages, stack traces or content.
- Treat explicit HTTP 400/401/403/413/429 refusals as refusals. An expired session no longer enters a lost-response recovery loop. Ignore arbitrary proxy error bodies. HTTP 500, incomplete streams and unconfirmed results remain uncertain.
- Keep exact request replay, single-call reservation, explicit acceptance, manual editing, authorship and execution gates. No automatic provider retry or fallback. No schema migration, model change or plan/Run configuration change.

## Verification and continuation

Pinned Node 24.20.0 / pnpm 11.25.0; installed AI SDK 7.0.89 and OpenAI provider 4.0.58. Official OpenAI model documentation confirms Responses streaming, structured output and low reasoning support; existing parameters remain unchanged.

New deterministic coverage includes real installed-SDK HTTP error responses; HTTP 401 through application generation, receipt validation, exact recovery and safe telemetry; preparation/finalisation rollback uncertainty; telemetry failure isolation; browser session expiry with manual saving and accessibility; and a real-PostgreSQL streaming-provider refusal receipt/recovery case. All provider responses used by these tests are explicitly synthetic.

Local typechecking (including root test types) and boundaries pass. The full local unit run passed 4,167 tests but hit three test timeouts and one setup timeout (seven skipped tests) in three unchanged Run-stream route files while typechecking ran concurrently. An isolated single-worker rerun passed 25 of the 27 tests; the list-stream file still exceeded its cold-import budget and its late first call then affected the second assertion. Test timeouts and assertions have not been relaxed; the complete hosted gate remains required. Exact pushed commits and final local/hosted results are recorded in the PR handoff.

The final focused local authoring run passes all 138 tests across adapter, application, route, client transport, assistant state and Server Actions (`pnpm test <focused files> --maxWorkers=2`).

Local live provider verification is blocked: no authoring credential is configured in this workspace. The Railway web service has the `AUTHORING_OPENAI_API_KEY` variable name present, but its secret value has not been retrieved and presence does not prove model access. Production browser access was rejected by the session URL security policy; no alternate route has been used to bypass it. Local real-PostgreSQL/browser execution is unavailable in this restricted workspace; hosted CI supplies those required gates.

After the validated release, reproduce one request from the signed-in app and correlate its time with the new `Writing assistance failed` category and stage. If it is an authentication/access/configuration failure, correct the existing web service authoring configuration securely. If it is preparation/finalisation, investigate that operation without retrieving saved prose or credentials. Live-model wording quality and the original incident remain open until a real request is confirmed. Do not claim synthetic tests as live-provider evidence.
