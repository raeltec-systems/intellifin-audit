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
