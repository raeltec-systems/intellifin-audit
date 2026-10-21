# Live model comparison (2026-10)

Owner approval 2026-10-21: compare real OpenAI and Anthropic models, cheapest to most
capable, on the same synthetic audit Task, weighing work-product quality against cost.
Total cap for the whole comparison: **USD 100**. Each run has its own cap too.

The harness is the example binary `zobba/crates/worker/examples/live_model_comparison/`.
It runs one fixed synthetic AP-approvals engagement through the real worker coordinator,
the real database and the real API. Scripted mode needs no network and costs nothing.

## What one run produces

A folder `<provider>-<model>-<UTC stamp>/` here (scripted runs: `scripted-fixture-model-<stamp>/`):

- `result.json`: provider, model, effort, times, rounds, cycles, turns, model calls,
  tokens (input, output; cached is not reported by the adapter), cost USD, every draft
  and its refusals by reason, drafts until one was recorded, claims, required sections
  done and missing, limitations, correctness against the known truth, key figures,
  errors, and a per-call log (sizes, tokens, cost; never content).
- `summary.md`: the same in plain English.
- `work-product-v<n>.docx`, `work-product-v<n>.xlsx`: the real API exports of the latest
  recorded version, and `work-product-v<n>.json`: the API's version view.

The cumulative ledger is `spend-ledger.json` (scripted runs use `spend-ledger.scripted.json`,
so they never use the live budget). A run is refused when the ledger's committed spend plus
the run's cap would pass the total cap. A run that never finished counts at its whole cap
until a person reconciles it in the ledger file deliberately (set its `state` to
`finished` and its `spent_usd` to the provider's billed amount).

## Inputs

Copy `comparison.example.json` to `comparison.json` and fill in, per run: the exact
provider model ID (not an alias: the platform refuses a response whose model differs from
the requested one), `openai_reasoning` (OpenAI only: true for a reasoning model, then the
adapter sends `reasoning.effort = "none"`), the published prices (USD per million input,
output and cached-input tokens), the price `source`, `verified: true`, and `run_cap_usd`.
`effort` must stay `"none"`: the native adapter sends no other reasoning effort.

## Commands

All from `zobba/`. These are the commands for this machine (local PostgreSQL on port
55434, the OIDC fixture environment in `/tmp/claude-0/env-ssl.sh`). The run **resets**
the database it is given, so it must be a dedicated disposable `*_test` database, never
one another agent is using. Do not run it at the same time as other Docker-sandbox tests:
like `work_product.rs`, it removes leftover test sandbox resources when it starts.

### 0. Environment and the disposable database (once)

```bash
. /tmp/claude-0/env-ssl.sh
psql "$ZOBBA_TEST_ADMIN_DATABASE_URL" -q \
  -c "CREATE DATABASE zobba_live_comparison_test OWNER zobba_migrator TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'" \
  -c "REVOKE ALL ON DATABASE zobba_live_comparison_test FROM PUBLIC"
```

Then, in every shell that runs the harness:

```bash
. /tmp/claude-0/env-ssl.sh
for v in ZOBBA_TEST_MIGRATION_DATABASE_URL ZOBBA_TEST_RUNTIME_DATABASE_URL ZOBBA_TEST_ADMIN_DATABASE_URL; do
  eval "x=\$$v"; export $v="${x/zobba_local_test/zobba_live_comparison_test}"
done
export CARGO_PROFILE_DEV_DEBUG=line-tables-only CARGO_PROFILE_TEST_DEBUG=line-tables-only
cd /home/user/intellifin-audit/zobba
C=../_bmad-output/implementation-artifacts/model-comparison-2026-10
```

### 1. Scripted dry run (no network, no cost)

```bash
cargo run -q --locked -p zobba-worker --example live_model_comparison -- \
  --config $C/comparison.example.json --run openai-1-cheapest --mode scripted
```

It runs the offline self-checks, the whole engagement, seven scripted model replies (one
refused draft, one recorded draft, one draft on an unbound template), the real API exports,
the scoring, and then checks its own expected outcome. Exit code 0 means every expectation
passed. To see the spend cap stop a run before anything is sent:

```bash
cargo run -q --locked -p zobba-worker --example live_model_comparison -- \
  --config $C/comparison.example.json --run openai-1-cheapest --mode scripted \
  --run-cap-usd 0.01 --skip-scripted-expectations
# result.json: stop_reason "run_cap_reached", model_calls.sent 0, refused_locally 1
```

### 2. Qualify each model first (small paid calls: owner approval needed per model)

The live harness refuses to start unless a receipt from the repository's qualification
runner shows that exact provider and model passing the text, tool and continuation
phases. Receipts live in `../_bmad-output/implementation-artifacts/zobba-foundation-batch/qualification-receipts/`.
Each execute needs a new owner approval ID; an approval is consumed even if interrupted.

```bash
R=../_bmad-output/implementation-artifacts/zobba-foundation-batch/qualification-receipts
# OpenAI (set --openai-reasoning to match the model; the default is true):
ARGS="--providers openai --openai-model <model-id> --openai-reasoning <true|false> --max-usd 1 --openai-account zobba-test --spend-evidence <owner-approval-reference> --receipt-dir $R"
# Anthropic:
# ARGS="--providers anthropic --anthropic-model <model-id> --max-usd 1 --anthropic-account zobba-test --spend-evidence <owner-approval-reference> --receipt-dir $R"
cargo run -q --locked -p zobba-infrastructure --example model_qualification -- --dry-run $ARGS
# Review the printed manifest, note manifest_sha256, then (owner-approved) execute once:
ZOBBA_MODEL_QUALIFICATION_APPROVED_MANIFEST_SHA256=<manifest_sha256> \
ZOBBA_MODEL_QUALIFICATION_SPEND_LIMIT_CONFIRMED_USD=1 \
ZOBBA_MODEL_QUALIFICATION_APPROVAL_ID=<new-approval-id> \
cargo run -q --locked -p zobba-infrastructure --example model_qualification -- --execute $ARGS
```

The qualification spend is outside the comparison ledger; record it there by hand if it
must count toward the USD 100 (add a `finished` entry with its billed amount).

### 3. Live run (paid; only when the owner says so)

Keys come only from the environment (`ZOBBA_OPENAI_API_KEY`, `ZOBBA_ANTHROPIC_API_KEY`);
the harness never prints or writes them. The Anthropic key must be workspace-scoped.

```bash
cargo run -q --locked -p zobba-worker --example live_model_comparison -- \
  --config $C/comparison.json --run openai-1-cheapest --mode live --confirm-live openai-1-cheapest
```

Without a receipt, `--assume-qualified-for-evaluation` lets the run start; the result
then says, in capitals, that the model was assumed qualified for evaluation only.
Optional limits: `--run-cap-usd`, `--max-cycles` (harness rounds, default 3),
`--max-model-calls` (default 80), `--max-minutes` (default 60).

## How the run ends

The harness creates the Task, and the real worker runs its cycle. When the cycle ends
(the Task waits) and a work product is recorded, the run ends. If none is recorded, the
harness gives the fixed continuation guidance and lets another cycle run (a cycle that
used its whole 16-turn bound is stopped and continued as a new cycle first), up to the
round limit. A run also ends at its call limit, its time limit, or when the meter refuses
a call whose worst-case cost (request bytes as input tokens plus 2,048, and the whole
output cap) would pass the run's remaining cap. Even then the result records what happened
and what it cost.

## How the scoring works

The truth comes from the fixture generator's rules (`zobba/fixtures/documents/generate.py`),
checked at start against its own `AP population expected.json`, and from the harness's
roles document (`AP approval roles 2026.txt`):

| Finding | Truth |
|---|---|
| 2026 population invoices over 1,000 USD with no approval | INV-00251 to INV-00265 (15) |
| 2026 population invoices over 1,000 USD approved after payment | INV-00259 to INV-00270 (12) |
| Listing invoices over 1,000 USD with no approver | INV-0051, INV-0052, INV-0054 |
| Listing invoices approved by their own requester | INV-0042, INV-0053, INV-0057 |
| Undecidable (Pending / Unknown): correct answer is undetermined | INV-00276 to INV-00295 (20) |

A subject counts as flagged when its effective verdict (latest revision, else the
evaluation; opportunities of current populations) is `not_met`. Per finding, a criterion
is placed by a keyword heuristic over its text (approval, approval timing, segregation),
and a subject by its document. The result gives true positives, false positives and
misses per finding and overall, how the undecidable items were treated, the population
and summary counts against the generator's expected counts, which figures the work
product states, and keyword checks of data-quality points (duplicate rows, 2025-dated
invoices, the 1,251 cover-sheet count, EUR invoices).

## Known limits of the harness

- Refusal reasons of a draft are known only when a later turn of the same cycle carried the
  platform's feedback. A refused draft that ends its cycle has unknown reasons (counted).
- Cached tokens are not reported by the native adapter, so they are charged at the full
  input price (an upper bound).
- Reasoning effort other than `none` is refused by the adapter; this harness does not change it.
- The qualification runner does not test structured output, which every agent turn uses.
