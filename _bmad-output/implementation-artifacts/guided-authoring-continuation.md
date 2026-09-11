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
