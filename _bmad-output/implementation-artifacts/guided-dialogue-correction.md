# Guided preparation dialogue — owner correction

Baseline: `origin/main` at `615aeec319d14916ea68f77b8ba6b83bd48becff` (PR #31 merged and released).
Branch: `codex/epic-2-guided-dialogue`. Earlier branches and the parked prototype stash are preserved.

The owner rejected PR #31's experience: it still starts with editable Template fields and presents assistance as an optional writing tool. The supplied screenshot shows that failure on the first section. Passing mechanical tests did not demonstrate the intended preparation experience.

## Required interaction

1. Present the selected risk, control and objective as readable facts. Ask the auditor to confirm them. A clear confirmation records review of that saved context and moves to the next section. Missing context stays visibly missing. Adaptation and manual editing remain available on request.
2. Guide scope in a short exchange, then ask for the exact dates. Use the existing saved scope and period; do not infer dates or filters from prose.
3. Guide evidence choices one question at a time: population source, systems to inspect, and values/proof to retain. Use registered choices and existing commands. Keep advanced settings available without making them the main task.
4. Ask for the desired test approach in plain language. Show the auditor's answer, the assistant's proposed steps, and a visible reply field for precise changes. Retain prior proposals, human edits and keep/drop/add instructions. Ask one focused clarification at a time when a decision is missing.
5. Present the saved criteria and frequency for confirmation or explicit change. Show the actual compiler-produced plan before submission.

## Acceptance criteria

- The default first screen has readable risk/control/objective and a confirmation action; it has no visible context textareas or Help Me Write controls.
- The guide leads the auditor through the real preparation journey. Experienced auditors can jump between sections and questions.
- Only the current question's controls are visible. Other editors remain mounted once, preserving unsaved state and their submission guards.
- Confirming context records review of the exact saved content. Saving an answer or generating/accepting a proposal does not review another section or submit the procedure.
- Source/system/evidence settings remain explicit choices, with capability limitations visible. No connectors, policies or field values are invented.
- The drafting exchange shows the original answer, previous proposals/corrections, the current proposal and a reply composer. Replying applies precise intent through the existing bounded authoring port, rather than requesting generic paraphrases.
- A clarification can be answered through that same composer without discarding the prior question or saved context.
- Stale responses, conflicting/unsaved edits, double acceptance, uncertain responses and lifecycle changes retain their existing backend protections.
- Manual writing remains available without the provider. The current compiler, author attribution, manager independence and Run authorization gates remain unchanged.
- A browser journey begins at Template selection and uses the default guide through confirmation, choices, drafting, correction, acceptance and final review. Capture actual desktop/mobile screens and test keyboard/axe behavior. Existing lifecycle journeys still prove request-changes, resubmission, independent approval/activation and unauthorised Run refusal.

## Scope and evidence limits

This is a correction to the preparation experience. It adds no document entity, admin Template CRUD, broad dependency engine, scheduler, arbitrary model tools or second executable plan. API-only procedures retain their registered fixed comparison capabilities. Stories 2.11–2.14 remain separate.

The supplied screenshot is evidence for the first-screen mismatch, not a complete live audit. Production browser access was previously rejected by this session's URL security policy; no alternate route will be used to bypass that restriction. Hosted browser tests will supply connected workflow evidence. Live model quality is separately unverified until assessed with synthetic inputs through an authorised session.

Verification and pushed checkpoints will be recorded in the PR handoff.

## Checkpoint verification

Local pinned toolchain: Node 24.20.0, pnpm 11.25.0. `pnpm typecheck` and `pnpm boundaries` pass. The focused suite passes 100 checks (writing state, preparation, styles, provider protocol and all 26 boundary mutations). The earlier full unit run passed 4,115 checks and exposed one missing style plus a transient workspace-sync ENOENT during a boundary mutation; both affected suites pass after correction/retry. No gate was relaxed. Typechecking must run after boundary mutation tests finish, since those deliberately plant invalid imports.

Hosted CI still needs to verify the exact pushed tree, real PostgreSQL, migrations, full browser/accessibility suite and retained screenshots. No schema migration is introduced. The existing populated-upgrade and historical authoring receipt checks remain; both v1 and v2 receipt identities remain readable under v3.

This checkpoint is not a release. Return the correction for review before merging. The PR will identify its exact tested SHA and the final browser results. The reviewer should inspect the initial confirmation and guided dialogue captures first, then exercise corrections against the configured live authoring provider using synthetic content.

### Checkpoint 1 review and corrections

Pushed `515111443accfb19883777bb9a7f8c89e06cd1c2` (tree `057a3576c35f91812e76ec9128c878ac5d884c1d`) in draft PR #32, targeting main. Hosted CI 34655005514 passed all 4,119 unit checks, typechecking, boundaries, 550 PostgreSQL integration checks (including populated upgrades) and container gates. Its focused browser run exposed hidden success messages after automatic question advancement, plus a helper clicking before hydration; the full browser gate did not run after those failures.

The follow-up preserves save feedback on the destination question and waits for actual hydration in the dialogue helper. It also preserves the entire human-edited working draft across clarification responses; a question stays unapplied and cannot be accepted as a replacement. Fresh responses are limited to one question at the application boundary, while historical receipt parsing retains v1/v2 compatibility. New review acknowledgements require minimum saved section content on the server and in the UI, without restricting question jumps or changing historical approval. These presence checks are not a claim of plan readiness or semantic safety.

Local correction verification: pinned typecheck and 95 focused state/application/provider checks pass. The owner journey now uses the default objective/scope dialogue rather than opening the underlying textareas to request help. Hosted browser verification remains required before this PR is ready.

### Checkpoint 2 and fresh-Template verification

Pushed `c40f32fe89507eb89c131c16268d698166efcae5` (tree `52bb049549dfc8993734449be4fb0983ec667c59`). CI 34655885585 passed PostgreSQL and container gates. It exposed two review-invalidation fixtures that had relied on acknowledging blank sections, one remaining hidden target-save assertion, an incorrect fixture control-name assertion, and an acceptance-to-dates handoff that still needs diagnosis. The full browser suite has not yet run on this correction. The review fixtures now contain saved section content; their invalidation assertions are unchanged and all 120 focused writer/state tests pass locally.

The next checkpoint adds a fresh P-4 journey from the actual Template creation page. It seeds only valid synthetic catalogue entries, uses the real forms and OpenAI transport fixture, checks full keep/drop/add feedback and edited proposal provenance, then invokes the real plan-derivation use case with its explicitly synthetic plan-check port. It never injects a compiled plan into the version. Actual desktop/mobile captures and bounded synthetic failure context are retained for remote inspection. This closes the coverage gap between a pre-completed writing fixture and a fixed-API owner walkthrough; it does not claim live-provider wording quality.

### Checkpoint 3 browser evidence

Pushed `d8901630efd1b71aa6d455ad5c6e28b5f3d61b70` (tree `65fbb8e2bdede55b72dd74d30dbd1f349f79781a`). CI 34656806727 passed typechecking, boundaries and all 4,126 unit tests. The fresh-Template P-4 journey passed through compiler-backed review, with actual control, scope, system-choice, correction, mobile and final-plan captures inspected. Ten focused browser tests passed. Two older tests still failed: an empty-evidence fixture expected an item before adding one, and the real-worker owner helper exhausted immediate stale-row retries. Scope acceptance itself passed; no callback defect was found. The helper now observes the current worker attempt and waits for the current action response, while all deliberate concurrency tests remain unchanged. Final full browser/CI verification is still required.

### Checkpoints 4–5 and full regression findings

Pushed `f69bd2863719a86f3a3daf6b66deabbdd6fbd554`, then `56b545a293b9657b9725f26687875d5c5a806432`. CI 34657619913 passed all 12 focused browser tests, including the fresh P-4 dialogue and the real-worker owner journey through manager-requested changes, resubmission, independent approval/activation and unauthorized Run refusal. It also passed 4,126 unit tests, typechecking, boundaries, 550 PostgreSQL integration tests, migration/populated-upgrade checks, containers and all agent guard mutation gates.

The full browser run passed 188 and failed 10. Three failures shared a genuine contrast defect in expanded registration definition labels; one heading assertion matched both the page title and the new control-confirmation heading. The other six followed the legacy procedure test worker restart, which changes its timestamp namespace after a failure and loses the earlier tests' fixture lookup. The next correction uses the existing secondary-text token inside disclosures and scopes the page-title assertion to level one. No axe rule, lifecycle assertion or concurrency guard is relaxed. Final exact-commit browser verification remains required.

### Checkpoint 6 and the owner's chat correction (2026-09-12)

Pushed `5956097d731c5d46936aba3f6dab00cd288b163e` (tree `efc1f5bc38fe501f772f5baac4470762f6c6cce4`). CI 34659311959 passed all five jobs: 4,126 unit tests, 550 real PostgreSQL integration tests, populated upgrades/migrations, 12 focused and 199 full browser tests, accessibility, containers and guard mutations. The owner then rejected the conversation presentation: labelled text cards and a reply form still did not feel like chat. Mechanical success did not resolve that experience gap. PR #32 was returned to draft; main and the feature branch were fetched and unchanged. No merge or deployment occurred.

The chat correction uses the same saved procedure model and bounded authoring operation. It adds a scrollable thread with right-aligned human messages, left-aligned assistant replies, a persistent bottom composer, Enter to send, Shift+Enter for new lines, and composition-event protection. Sending shows the human message immediately and clears the visible composer. Precise corrections and full human-edited proposals remain in the existing bounded revision chain. The comparison and explicit save actions live inside the completed assistant proposal. Scrolling back pauses follow-along; Jump to latest restores it. Manual structured choices remain available.

The installed AI SDK 7.0.89 / OpenAI provider 4.0.58 streams structured output through the existing OpenAI Responses model. Official guidance: [OpenAI streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses) and the installed SDK's `docs/03-ai-sdk-core/10-generating-structured-data.mdx`. The model, prompt identity, reasoning level, independent key, no-tools policy, token/timeout/retry limits and plan/Run configurations remain unchanged. No parallel OpenAI client is introduced.

Transport acceptance criteria:

- The server authenticates before reading input, checks a same-origin JSON request against configured `BETTER_AUTH_URL`, bounds body size/time, and runs the existing concurrency/rate/authorship-checked command.
- Provider partials are projected into bounded display-only fields, validated, deduplicated/throttled, and authorized before disclosure. No raw JSON/reasoning/provider headers enter the browser. At most 128 progress snapshots and one completion frame are delivered.
- The client validates request ownership and frame/response size. A partial, malformed frame or EOF cannot become an applicable suggestion. Only the final validated receipt unlocks acceptance.
- Disconnect stops enqueueing, while bounded work finishes its receipt. A retry uses the exact original payload/request ID. There is no automatic second call or fallback.
- Acceptance/rejection continue through existing Server Actions and application commands. Staleness, review invalidation, human authorship, independent approval and Run gates remain authoritative.
- The browser must show real incomplete SDK output before completion, preserve manual editing and reading position, and retain actual desktop/mobile chat captures. Synthetic transport tests are not live-provider quality evidence.

Local focused streaming/state/boundary tests pass. Final pinned full checks and exact-commit hosted PostgreSQL/browser evidence are recorded in the PR as each checkpoint completes. The new correction introduces no persistence migration. Live authoring wording quality remains separately unverified; the secure key is configured only on the Railway web service. This correction is reviewable work on PR #32, not a deployed release.
