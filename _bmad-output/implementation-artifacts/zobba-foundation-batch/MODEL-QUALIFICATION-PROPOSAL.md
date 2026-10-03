# Story 22.1 — proposed native-provider qualification

**Not approved or executed.** This is separate from the unapproved AWS us-east-1/USD300 proposal. It provisions no computer, cloud stack or deployment. Story 22.1 stays in progress until both native providers are qualified; Story 22.2 remains queued.

Recommend one synthetic qualification from this existing development workspace, using explicitly designated nonproduction OpenAI and Anthropic accounts. Public model availability does not establish account entitlement. The operator must map each non-secret account/project label to its intended key.

| Item | Proposed boundary |
| --- | --- |
| OpenAI | `gpt-4.1-2025-04-14`, HTTPS `api.openai.com/v1/responses`, `service_tier: default` |
| Anthropic | `claude-sonnet-4-6`, HTTPS `api.anthropic.com/v1/messages`, `service_tier: standard_only` |
| Processing location | Standard provider processing at those public endpoints; no new AWS region is selected and no customer-data residency qualification is claimed. Anthropic's possible US geography premium is reserved below. |
| Material | Invented audit text, synthetic identifiers and one inert tool definition/result. No customer or firm documents, repository source, passwords, images or audio. |
| Attempts | Three per provider: streamed text, an exact prepared tool proposal, then continuation with the synthetic result. Six total; one concurrent; no retries, fallback, additional calls after failure or external tool effects. |
| Per attempt | At most 16 KiB of native JSON, 1,024 generated tokens and a 60-second local deadline. A timeout does not prove provider cancellation or zero charge. |
| Proposed reservation | **USD20 of API-token usage before taxes**, covering all six possibly accepted attempts. Taxes, negotiated account terms and any all-in invoice requirement need the owner's billing context. No subscriptions, deposits, hosted tools or infrastructure purchases are included. |
| Credentials | `ZOBBA_OPENAI_API_KEY` and `ZOBBA_ANTHROPIC_API_KEY` in secure environment settings, bound to the respective hosts. No generic-key fallback or keys in chat/evidence. |
| Approval custody | Exact reviewed manifest SHA-256, named accounts, spending-evidence reference, approval ID and a retained receipt directory. The runner consumes that approval atomically before reading a key or sending a request; interruption or failure does not release it for reuse. |

The conservative reservation uses the models' entire documented context capacity for every attempt, plus the output cap. At the reviewed Standard rates, OpenAI reserves USD6.310032 and Anthropic USD10.4315904, including its 10% US processing premium: **USD16.7416224 combined before taxes**. This deliberately avoids inferring a billed-token bound from a JSON byte limit. The short probes should use far less; a USD0.10–0.20 expectation is an unmeasured planning estimate, not the ceiling. The calculation depends on the exact models and Standard tariffs and must be refreshed if the qualification date or account terms change. It is not an account-wide spending control or an invoice guarantee.

Pricing and model documentation were retrieved on **3 October 2026 UTC**; see the [research and assumptions](story-21.6-22.1/pricing-research.md) and [retrieval receipts](story-21.6-22.1/public-source-receipts/index.md). The arithmetic includes every potentially accepted attempt, even if it times out or its usage remains unknown:

| Profile | Input allowance for each attempt | Standard USD per million input / output tokens | Reservation for three attempts |
| --- | ---: | ---: | --- |
| `gpt-4.1-2025-04-14` | 1,047,576, the documented context window | 2 / 8 | `3 × (1,047,576 × 2 + 1,024 × 8) ÷ 1,000,000 = 6.310032` |
| `claude-sonnet-4-6` | 1,048,576, conservatively rounding the documented 1M up | 3 / 15, plus the 10% US geography premium | `3 × (1,048,576 × 3 + 1,024 × 15) × 1.1 ÷ 1,000,000 = 10.4315904` |

Sources: [OpenAI GPT-4.1 context and rates](https://developers.openai.com/api/docs/models/gpt-4.1.md), [OpenAI Standard pricing](https://developers.openai.com/api/docs/pricing.md), [Sonnet 4.6 model documentation](https://platform.claude.com/docs/en/models/sonnet-4-6/overview), and [Anthropic pricing, full-context rates and geography premium](https://platform.claude.com/docs/en/about-claude/pricing). The full-context allowance already covers formatting and tool input overhead; it is not a token estimate derived from the 16 KiB byte cap. No cache writes or paid hosted tools are requested. [OpenAI Services Agreement §6.3](https://openai.com/policies/services-agreement/) and [Anthropic Commercial Terms §H.2](https://www.anthropic.com/legal/commercial-terms) explain tax exclusions. Account entitlement and negotiated terms remain unverified.

The budget's `gpt-6.1-sol` and `claude-opus-5-5` are documented models but require reasoning support that this slice does not implement. The two candidates above qualify the current text/tool transport only. This is an explicit proposed choice, not a live model substitution or a revision of the launch quality target.

The runner records requested/actual model, actual processing tier, exact synthetic native bodies and hashes, attempt count, reported usage and transport completion separately from the qualification decision. Validated output records retain synthetic text, tool call identity, arguments and argument digest so the continuation can be reconstructed. Missing or unexpected tier, unknown usage, wrong text, invalid tool arguments or incomplete output stops qualification. Known charges and unknown attempts retain their reservation. Success does not install a trusted production registration, qualify an audit method or demonstrate an autonomous Task.

From `zobba/`, the credential-free inspection command is:

```sh
cargo run --locked -p zobba-infrastructure --example model_qualification -- --dry-run
```

The default account labels and spending reference are explicitly pending. Before paid execution, supply the designated account labels, reviewed pricing reference and retained receipt directory to that dry run, inspect its exact initial bodies and continuation templates, and bind the owner's approval to the resulting manifest. The only permitted continuation substitution is the validated provider call ID; the actual transmitted body hash is recorded. An environment confirmation acknowledges the reservation; it is not billing enforcement.

Remaining owner inputs are the two nonproduction account/project bindings, approval of these exact profiles and processing destinations, and whether the spending authorisation is pre-tax or must include an account-specific tax allowance. Credentials must then be supplied securely. No provider or token-counting API call is authorised by this document.
