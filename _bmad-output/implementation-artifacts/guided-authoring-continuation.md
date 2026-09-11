# Guided authoring continuation

## Baseline and branch

- Checked 2026-09-11: PR #29 is open, not merged; parent head is
  `2ab2995e154885e006985cf49fb43f83ec32d878`; main is
  `55b61e2d5c24aeabe804279e8d41ef6e64ed3097`.
- Clean fresh checkout; no prior feature branch or uncommitted user work.
- Branch: `codex/epic-2-guided-authoring`; draft PR base: `codex/epic-5-controls`.
- CI's PR base filter is extended to the parent for this stacked review. Its main-only
  release trigger is unchanged. No merge or deployment is authorised.

## Story 2.15 checkpoint

Implemented: source contract, labelled synthetic risk defaults, unset criterion references,
editable draft context, human attribution and plan invalidation, frozen lifecycle context,
14-row manager comparison and unchanged 12-row historical comparisons. No data migration
or historical backfill is needed for these JSON sections.

Local verification on the first checkpoint's source tree:
- Exact Node 24.20.0 and pnpm 11.25.0; frozen-lockfile install.
- `pnpm typecheck`: passed, including root test types.
- `pnpm test`: 4,002 passed across 197 files.
- `pnpm boundaries`: 575 modules, no violations.
- New PostgreSQL lifecycle and historical-review tests are written; execution pending
  the disposable PostgreSQL setup or hosted CI. Browser gates remain pending.
- An earlier unit run found one outdated reference-section count; corrected, full rerun passed.

This checkpoint is implemented and locally checked, not yet accepted as fully verified.
Commit identities and hosted/database/browser results are added at subsequent checkpoints.

## Remaining authorised work

1. Complete Story 2.15 real-PostgreSQL and browser checks; correct any failures.
2. Story 2.9: guided layout and durable saved-content acknowledgements.
3. Story 2.10: bounded OpenAI writing operation, visible suggestions, safe explicit acceptance.
4. Full final gates, screenshots and independent-review handoff.

Stories 2.11–2.14 remain subsequent work. Live OpenAI authoring is not yet tested. Installed
SDK versions: ai 7.0.89, @ai-sdk/openai 4.0.58, @ai-sdk/anthropic 4.0.47. The requested
product model is gpt-5.6-terra, independent of plan-check and audit-Run model configuration.

## Pushed first checkpoint and Story 2.9 candidate

- Published context commit `65c1615a7bda06b92f123ee5330b37f292431f44` and CI-base
  commit `22da7d0f27b07e72aef5304c0df78dfe03db66ea` in draft PR #30.
- CLI Git had no push credentials. The authenticated GitHub connector published equivalent
  atomic commits; both resulting tree SHAs were checked against the locally tested trees.
  Local original commits remain preserved under the local-first-checkpoint branch.
- CI run 34590523241: first checkpoint typecheck/unit/boundaries, real PostgreSQL18
  migrations/integration, container build/startup checks passed. Browser jobs pending.
- Story 2.9 implemented: responsive outline, separate durable review metadata, explicit
  clarification, saved revision/actor acknowledgement, conservative invalidation, no
  inherited reviews on new versions. Migration48 adds nullable metadata without backfill.
- Local candidate: typecheck and boundaries pass. 4,027/4,028 units pass; the remaining
  planted-boundary test fails because workspace synchronization creates a disappearing
  .rsync-tmp file. Rechecking the same tests outside the synchronized directory.
- Real populated47 upgrade test added; runtime DB/browser verification goes through CI.
- No authoring credentials present (AUTHORING_OPENAI_API_KEY / OPENAI_API_KEY / MODEL_API_KEY
  unset, no local env files). Live authoring verification remains blocked.
