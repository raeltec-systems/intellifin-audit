# OpenAI gpt-6-luna qualification receipts

Owner approval (2026-10-07): OpenAI only, model `gpt-6-luna`, project label `zobba-test`,
synthetic test messages only, reservation USD 1 before taxes, paid from the existing OpenAI credit.

## Run 1 (2026-10-07): not qualified

Approval `owner-2026-10-07-zobba-test`, manifest `71b0c5394c1d84c55425a009c7379da2a08c23ca5304ca2a41b970b27a70f834`,
is consumed. Receipt: `model-qualification-751e42ff….jsonl`. The text phase passed; the tool
phase got HTTP 400 `invalid_function_parameters` because prepared array constants were sent
as `"enum": [[]]`. Fixed in `native.rs` (`constant_schema_json`). A manual check with the fixed
schema got HTTP 200 and a correct `qualification_probe` call. Run 1 cannot be re-run.

## Run 2 (needs a NEW owner approval ID)

Dry-run manifest SHA-256 after the fix (from this exact checkout path):
`4b59e4830b49856ccbfd73b72ddea63cdd48a4dec8e2b308a3369c9208f66817`

The key is read from the environment variable `ZOBBA_OPENAI_API_KEY` (set in the cloud
environment settings, never committed). Run from `zobba/`:

```bash
R=../_bmad-output/implementation-artifacts/zobba-foundation-batch/qualification-receipts
ARGS="--providers openai --max-usd 1 --openai-account zobba-test --spend-evidence owner-approved-2026-10-07-usd1-openai-credit --receipt-dir $R"
# 1. Re-run the dry run and confirm the hash above is unchanged.
cargo run -q --locked -p zobba-infrastructure --example model_qualification -- --dry-run $ARGS
# 2. Execute once. The approval is consumed even if the run is interrupted.
ZOBBA_MODEL_QUALIFICATION_APPROVED_MANIFEST_SHA256=4b59e4830b49856ccbfd73b72ddea63cdd48a4dec8e2b308a3369c9208f66817 \
ZOBBA_MODEL_QUALIFICATION_SPEND_LIMIT_CONFIRMED_USD=1 \
ZOBBA_MODEL_QUALIFICATION_APPROVAL_ID=<new-owner-approval-id> \
cargo run -q --locked -p zobba-infrastructure --example model_qualification -- --execute $ARGS
```

The resulting `model-qualification-*.jsonl` receipt in this folder is the record to keep.
