# OpenAI gpt-6-luna qualification receipts

Owner approval (2026-10-07): OpenAI only, model `gpt-6-luna`, project label `zobba-test`,
synthetic test messages only, reservation USD 1 before taxes, paid from the existing OpenAI credit.

## Run 1 (2026-10-07): not qualified

Approval `owner-2026-10-07-zobba-test`, manifest `71b0c5394c1d84c55425a009c7379da2a08c23ca5304ca2a41b970b27a70f834`,
is consumed. Receipt: `model-qualification-751e42ff….jsonl`. The text phase passed; the tool
phase got HTTP 400 `invalid_function_parameters` because prepared array constants were sent
as `"enum": [[]]`. Adding `items`/`minItems`/`maxItems` while keeping that `enum` still gets
HTTP 400 (tested); the `enum` itself must go. Fixed in `native.rs` (`constant_schema_json`). A manual check with the fixed
schema got HTTP 200 and a correct `qualification_probe` call. Run 1 cannot be re-run.

## Run 2 (2026-10-07): all three phases succeeded

Approval `owner-2026-10-07-zobba-test-2` (owner approved), manifest
`4b59e4830b49856ccbfd73b72ddea63cdd48a4dec8e2b308a3369c9208f66817`, is consumed.
Receipt: `model-qualification-f5c0c162….jsonl`. Text (41 in / 6 out tokens), tool call
(258 / 128) and tool-result continuation (466 / 6) all succeeded on `gpt-6-luna`, default
tier. Result `adapter_qualification_evidence_only`: native transport evidence only; no
trusted registration was installed and this is not audit-quality or production approval.

## Run 2 command (for the record)

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
ZOBBA_MODEL_QUALIFICATION_APPROVAL_ID=owner-2026-10-07-zobba-test-2 \
cargo run -q --locked -p zobba-infrastructure --example model_qualification -- --execute $ARGS
```

The resulting `model-qualification-*.jsonl` receipt in this folder is the record to keep.


# Anthropic claude-sonnet-5-5 qualification receipts

Owner approval (2026-10-08): Anthropic, model `claude-sonnet-5-5`, project label `zobba-test`,
synthetic test messages only, reservation USD 1 before taxes.

## Run 1 (2026-10-08): not qualified, no tokens used

Approval `owner-2026-10-08-zobba-anthropic-1`, manifest
`26e7e08a32668f2c9f6752053781a76502c14c66df2b7f29e4bf90978ba7c59c`, is consumed. Receipt:
`model-qualification-ffb22074….jsonl`. The first (text) request failed before any model
output: `Failed(Provider)`, no response id, no usage. A free `GET /v1/models/claude-sonnet-5-5`
with the same key returned HTTP 400: the API key is not scoped to a workspace, so every
request needs an `anthropic-workspace-id` header. The adapter sends no such header. The fix is
an owner action: replace `ZOBBA_ANTHROPIC_API_KEY` with a key created inside a workspace.
Run 1 cannot be re-run; a new run needs a new approval ID.
