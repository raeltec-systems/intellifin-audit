# OpenAI gpt-6-luna qualification receipts

Owner approval (2026-10-07): OpenAI only, model `gpt-6-luna`, project label `zobba-test`,
synthetic test messages only, reservation USD 1 before taxes, paid from the existing OpenAI credit.

Reviewed dry-run manifest SHA-256 (from this exact checkout path):
`71b0c5394c1d84c55425a009c7379da2a08c23ca5304ca2a41b970b27a70f834`

The key is read from the environment variable `ZOBBA_OPENAI_API_KEY` (set in the cloud
environment settings, never committed). Run from `zobba/`:

```bash
R=../_bmad-output/implementation-artifacts/zobba-foundation-batch/qualification-receipts
ARGS="--providers openai --max-usd 1 --openai-account zobba-test --spend-evidence owner-approved-2026-10-07-usd1-openai-credit --receipt-dir $R"
# 1. Re-run the dry run and confirm the hash above is unchanged.
cargo run -q --locked -p zobba-infrastructure --example model_qualification -- --dry-run $ARGS
# 2. Execute once. The approval is consumed even if the run is interrupted.
ZOBBA_MODEL_QUALIFICATION_APPROVED_MANIFEST_SHA256=71b0c5394c1d84c55425a009c7379da2a08c23ca5304ca2a41b970b27a70f834 \
ZOBBA_MODEL_QUALIFICATION_SPEND_LIMIT_CONFIRMED_USD=1 \
ZOBBA_MODEL_QUALIFICATION_APPROVAL_ID=owner-2026-10-07-zobba-test \
cargo run -q --locked -p zobba-infrastructure --example model_qualification -- --execute $ARGS
```

The resulting `model-qualification-*.jsonl` receipt in this folder is the record to keep.

## Result of the first run (2026-10-07)

Approval `owner-2026-10-07-zobba-test` was consumed. The text request succeeded (41 input /
6 output tokens). The tool request failed with a provider HTTP error before any output, so
the result is `not_qualified` and no trusted registration was installed.

Likely cause, found by reading the retained request body: the `attachments` and `recipients`
constant-array arguments were sent as `{"type":"array","enum":[[]]}` with no `items`. OpenAI
refuses an array schema without `items`. This was an adapter defect, not a model limit, and it
would have hit GPT-4.1 as well. The adapter now gives constant arrays and objects their full
shape. The HTTP error body was not retained, so this cause is not yet proven.

A re-run needs a new owner approval. The request bytes changed, so the new dry-run manifest
SHA-256 is `bb69c378f9bd9726ae639e12264147fc1914d66a8fc4885c281a5fa702c9bca4`. Use a new approval
ID (for example `owner-2026-10-07-zobba-test-2`) in step 2 above.
