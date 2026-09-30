# Model API budget evidence and workload assumptions

**As of 30 September 2026.** Use the public first-party API rates below for the accepted revision 3 §6 native OpenAI Responses and Anthropic Messages adapters. These are independently fetched API model pages and pricing tables, not Dots/ChatGPT/Claude subscriptions or inferred prices for marketing names. Documentation availability does not verify a customer's entitlement, throughput, residency eligibility or contract.

Recommended launch budgeting profile: **`gpt-6.1-sol` for task coordination, substantial work and computer perception; `gpt-6-luna` for bounded extraction/classification with evidence/schema checks; `claude-opus-5-5` for a limited consequential-claim challenge.** Qualification on Zobba's audit cases must confirm quality before admitting the profile. A challenge is additional model assistance, never human independent review. Routing to Anthropic is visible and Admin-approved; it is not a hidden fallback. `claude-sonnet-5-5` is a viable alternative general/vision candidate at the same uncached input/output tariff as Sol. Astra/Fable are priced escalation candidates, not defaults.

## Current rates

USD per million tokens, standard global first-party API processing. Cache-write rates replace the ordinary input rate for those tokens; do not add both.

| Exact API model ID | Uncached input | Cache read | Cache write | Output, including reasoning | Evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| `gpt-6.1-sol` | 2.00 | 0.10 | 2.50 | 10.00 | [Model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [API pricing](https://developers.openai.com/api/docs/pricing) |
| `gpt-6-luna` | 0.10 | 0.01 | 0.125 | 0.50 | [Model page](https://developers.openai.com/api/docs/models/gpt-6-luna), API pricing |
| `gpt-6-astra` | 10.00 | 1.00 | 12.50 | 50.00 | [Model page](https://developers.openai.com/api/docs/models/gpt-6-astra), API pricing |
| `claude-opus-5-5` | 4.00 | 0.20 | 5.00 / 8.00 | 20.00 | [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), [model IDs](https://platform.claude.com/docs/en/models/overview) |
| `claude-sonnet-5-5` | 2.00 | 0.20 | 2.50 / 4.00 | 10.00 | Claude pricing and model IDs |
| `claude-haiku-4-5-20251001` | 1.00 | 0.10 | 1.25 / 2.00 | 5.00 | Claude pricing and model IDs |
| `claude-fable-5-1` | 10.00 | 0.25 | 12.50 / 20.00 | 50.00 | Claude pricing and model IDs |

Claude cache writes show **5-minute / 1-hour** durations. Anthropic documents the newer dateless IDs as pinned snapshots, not evergreen aliases; Haiku uses the dated ID above. Both providers' current model pages support text/image input and tools for these candidates. OpenAI Sol tool calling requires Responses, which matches the design.

`text-embedding-3-small` costs **$0.02 per million input tokens** ([model page](https://developers.openai.com/api/docs/models/text-embedding-3-small), API pricing). At the infrastructure owner's assumption of 1M newly embedded tokens per active person per month, add **$0.02/person/month** separately. Initial 10M/100M-token ingest costs $0.20/$2.00 in embedding API fees; parsing, chunking, retrieval/storage and any re-embedding/query tokens are separate. These embedding fees are not included in the conversational totals below.

## Explicit per-auditor workload

The calculator uses **60 useful computer hours per active auditor per month** in all scenarios to align with the infrastructure workbook. Different observation rates express different computer-intensive workloads; they are planning averages, not polling intervals, latency promises or measured task throughput. Human interaction, waiting and many structured API/file operations do not require continuous model screenshots.

| Billable work before redo | Light | Base | Heavy |
| --- | --- | --- | --- |
| Interactive coordination, Sol | 100 calls × 8k input / 1k output | 400 × 12k / 2k | 800 × 20k / 3k |
| Nonvisual substantial-task work, Sol | 8 Tasks × 20 cycles × 16k / 2.5k | 20 Tasks × 40 cycles × 30k / 5k | 60 Tasks × 80 cycles × 50k / 8k |
| Computer observation and next-action proposal, Sol | 300 calls × (8k text + 2k image) / 0.75k output | 1,200 × (12k + 3k) / 1k | 3,600 × (20k + 6k) / 1.5k |
| Validated extraction/classification, Luna | 200 × 5k / 0.75k | 800 × 8k / 1k | 3,000 × 12k / 1.5k |
| Consequential-claim challenge, Opus | 8 × 25k / 4k | 20 × 40k / 8k | 60 × 60k / 12k |
| Scheduled/event-check wakeups, Sol | 20 × 6k / 0.75k | 80 × 10k / 1k | 400 × 20k / 2k |
| Extra billable volume for retries, rebasing and checkpoint redo | 10% | 20% | 35% |

Each category is disjoint. Nonvisual task cycles exclude separately counted computer observations, extraction and review calls. Context/input figures include developer instructions, methodology/skill material, selected evidence, tool schemas, tool results and repeated selected history. These are totals per call, not newly added text. Output includes hidden reasoning, visible text and tool proposals. The base profile therefore assumes **65.76M input tokens including 4.32M image tokens, and 8.448M output tokens per active auditor per month after redo**.

No cache savings, batch discounts, promotional credits, free allowances or negotiated rates are assumed. In the explicit no-cache comparison, OpenAI uses explicit cache mode with no breakpoints and Anthropic omits cache control. Production can cache reusable prefixes after measuring write/read economics; default implicit writes with few hits can increase cost. A sensitivity with 50% of text input read from cache, 10% written and 40% uncached—fresh image tokens remain uncached—reduces base usage from **$196.13 to $146.55/person/month**. This hit mix is an illustration, not observed performance.

| Active auditors | Light API usage/month | Base API usage/month | Heavy API usage/month |
| ---: | ---: | ---: | ---: |
| 1 | $24.17 | $196.13 | $1,646.80 |
| 5 | $120.86 | $980.64 | $8,233.99 |
| 20 | $483.45 | $3,922.56 | $32,935.95 |

These are workload estimates, not subscription recommendations or expected real-user averages. The wide range is intentional: long contexts, reasoning and many action cycles dominate more than screenshot pixels alone. At base rates, every additional 1M Sol output tokens costs $10 and every additional 1M uncached input tokens costs $2.

Add **$182.40/month once per shared deployment** for an illustrative recurring quality suite: 200 cases/month × four Sol work calls (30k input/5k output each) plus one Opus challenge (40k/8k), with 20% redo. This can represent 50 cases weekly across the qualified audit methods, but is a cost allowance, not a statistically sufficient reliability claim. Customer-specific method qualification, larger regression suites and human expert adjudication require separate actual budgets. The model does not grade its own work into proven audit reliability; record accepted/rejected outcomes, evidence fidelity, coverage, unsupported conclusions, human corrections and cost distribution.

## Pricing edges that materially change the total

- **Long context:** the selected GPT-6 models charge 2× input/cache and 1.5× output for the whole request above 272k input tokens. None of this workbook's assumed calls crosses that threshold. Current Claude 4.6+ models include their full 1M context at normal per-token rates; Haiku 4.5 has a 200k context limit. Larger context is still more tokens, and Anthropic notes its newer tokenizer produces approximately 30% more tokens than earlier Claude versions for the same text. Count with each provider, not a shared character heuristic.
- **Images:** screenshots are billed input tokens, not free attachments. OpenAI documents model/detail-dependent patches; Claude documents image patches and resolution limits. The Sol 2k/3k/6k image quantities above are explicit allowances for the images actually submitted per observation, **not a claimed exact pixel-to-token formula for Sol**. The fetched OpenAI general image table did not yet list Sol's multiplier. Measure provider usage for the qualified screen sizes, crops and retained screenshots. Already-budgeted vision tokens must not be charged again as an independent tool line.
- **Tools:** own Rust tool executors use input/output tokens and infrastructure. This baseline does not buy provider-hosted code/container/vector-store sessions. Both providers list web search at $10/1,000 searches/calls plus model tokens for returned content; initial web profile assumes zero paid search calls. OCR vendors, specialist software, paid connectors, realtime audio/voice calls and image generation remain separate choices; submitted speech transcription is explicitly priced below. Claude's documented computer toolset adds roughly 4,500 input tokens with default members; browser toolset roughly 6,600. Such provider-specific schemas/system overhead must fit within the call input allowance or be added when qualifying that adapter.
- **Reasoning and incomplete work:** OpenAI and Anthropic bill internal reasoning as output even when the returned visible answer is short. A max-output termination can consume paid work without a usable answer. The redo percentage is extra billable volume, not a failure probability or success-rate claim. Reserve per-call and per-task ceilings; reconcile actual usage for cancellations/timeouts instead of assuming the provider charged nothing. Means in this workbook are not token caps.
- **Residency and speed:** qualifying regional OpenAI endpoints have a 10% uplift; first-party Claude US-only inference on supported 4.6+ models has a 10% uplift. Base with a uniform supported 10% uplift is **$215.74/person/month**. Eligibility and approved destination still need confirmation. AWS `us-east-1` infrastructure does **not** imply API inference or retained data stays in that region. Fast/Ultrafast/provisioned throughput are excluded; their higher prices are not required to assume an unmeasured responsiveness target.

## Submitted speech input

The operating budget separately includes `gpt-transcribe` for submitted speech: 60 captured minutes per person/month plus 20% billable retry allowance  = 72 billed minutes × $0.0045  = **$0.324/person/month**. The [official model page](https://developers.openai.com/api/docs/models/gpt-transcribe) specifies billing by audio duration, so no token conversion is inferred. Its transcript fits the existing coordination-input allowance. Provider/destination approval, private-sign-in capture suppression and review of consequential transcriptions still apply. This does not enable always-listening or realtime voice calls. These fees, like embeddings, are outside the conversational goldens above but included in the integrated cash totals.

## Reproduction and evidence

The package's [calculate_budget.py](calculate_budget.py) consumes [model-rates.json](model-rates.json) and [model-quantities.json](model-quantities.json), with the infrastructure inputs. Run [verify_budget.py](verify_budget.py) for independent Decimal checks of the important totals. [Model source receipt](sources/model-source-receipt.json) records official source URLs, retrieval times and hashes of the original inspected captures; it does not claim those full captures are bundled. Selected price facts are in the rate file. No account API calls or model performance benchmarks were run.

Other authoritative detail: [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching), [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning), [OpenAI vision](https://developers.openai.com/api/docs/guides/images-vision), [Claude thinking cost](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost), [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision), [Claude model versioning](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions).
