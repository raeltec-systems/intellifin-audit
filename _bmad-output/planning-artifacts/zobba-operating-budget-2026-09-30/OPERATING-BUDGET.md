# Zobba operating budget

**30 September 2026 · USD/month · Proposed region: US East (N. Virginia), `us-east-1` · Separate operating addendum to the accepted revision 3 design**

Budget **$1,341/month for an initial one-person, one-firm pilot; $2,231 for five active people; and $5,618 for twenty**, at the explicit base workload below. Hold **$1,542 / $2,567 / $6,461** respectively as cash envelopes rounded upward to whole dollars including a separately identified 15% contingency. This replaces the previous $300 platform allowance with sized, priced services. It includes model consumption, ongoing quality evaluation, AWS support and a small separate test environment. It does not change the accepted architecture or constitute deployment approval.

The main result is that the persistent platform dominates a single-user launch; by twenty people, model usage is the largest expense. Launch on the shared regional platform, meter actual model usage, and sell bounded included usage. A seat is not a promise of an always-running computer or unlimited model work.

“Initial” means **one active auditor in one firm**, assumed for this budget. The five- and twenty-person headline cases also each contain **one firm**, with the platform provisioned once. These are alternative scale points, not three environments bought simultaneously. Region remains a commercial proposal: the existing US East reference keeps the comparison reproducible, but does not settle customer residency or imply OpenAI/Anthropic processing takes place in that AWS region.

## Monthly cash requirement

| Active people | Shared regional platform + quality | Nonproduction/CI | Organisation custody | Customer consumption | Monthly operating cash | With 15% planning contingency |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | $983.29 | $142.74 | $1.80 | $212.97 | $1,340.80 | $1,541.92 |
| 5 | $1,022.57 | $142.74 | $1.80 | $1,064.22 | $2,231.33 | $2,566.03 |
| 20 | $1,217.02 | $142.74 | $1.80 | $4,256.38 | $5,617.93 | $6,460.62 |


Totals use unrounded line amounts; displayed rounded components can differ by a cent. The contingency is a planning reserve, not a provider fee, measured uncertainty interval or second application allowance. Fully allocated base service cost is **$1,340.80 / $446.27 / $280.90 per active person** at these three launch scales. Those amounts are neither the marginal cost of adding a person nor a proposed selling price.

Within already-provisioned capacity, another active Linux auditor adds approximately **$212.81/month** at the base workload, including model APIs, computer time, retained data, traffic and the incremental AWS support fee. Another organisation adds **$1.96/month** for its selected KMS key/connection-secret custody and associated support at this scale, before any Windows or paid application entitlement. Capacity steps, customer-specific support and different retention remain additional. For many solo firms, shared platform allocation is **regional overhead × the firm's agreed allocation weight**, where all weights sum to one. Do not charge each firm the whole regional floor. Twenty solo firms with twenty total active people cost **$5,655.21**, versus **$5,617.93** for one twenty-person firm under the same resource limits; the difference is custody, not twenty copies of AWS infrastructure.

## What is provisioned

Retain the accepted two-AZ production topology and RDS Multi-AZ for all three cases. Reducing the pilot to a single-AZ production system would change the agreed resilience posture; this budget does not silently take that saving.

| Shared production component | Initial: 1 | 5 people | 20 people |
|---|---|---|---|
| Rust API/control | 2 tasks × 0.5 vCPU / 1 GiB | Same | 2 × 1 vCPU / 2 GiB |
| Rust task workers | 2 × 0.5 vCPU / 1 GiB | 2 × 1 vCPU / 2 GiB | 4 × 1 vCPU / 2 GiB |
| Restricted connection brokers | 2 × 0.25 vCPU / 0.5 GiB | Same | 2 × 0.5 vCPU / 1 GiB |
| Guacamole gateway/guacd | 2 × 2 vCPU / 4 GiB | Same | Same; load qualification required |
| Controlled egress proxies | 2 × 0.25 vCPU / 0.5 GiB | Same | Same |
| PostgreSQL 18.1+, `db.m9g.large` | Multi-AZ primary/standby, 2 vCPU / 8 GiB per instance; 50 GB gp3 | Same | Same class, 100 GB gp3 |
| Network | 1 ALB, 2 NAT gateways, 4 public IPv4; ECR API, ECR DKR and Logs endpoints in each AZ; S3 gateway endpoint | Same | Same |
| Clean Linux spare | None dedicated | None dedicated | 1 clean computer for 200 staffed hours/month |
| Intended simultaneous customer computer admission | 1 | 5 | 20 |
| Concurrent model request admission budget | 4 | 12 | 32 |

API and worker processes share the Rust domain modules; these deployments do not introduce new execution authorities. The broker, computer and analytical processes retain their distinct security boundaries. Selected Fargate allocations are valid Linux x86 combinations and are billed for 730 hours/month. Their sufficiency for a given concurrency is an **engineering sizing hypothesis**, not a performance measurement or provider guarantee. Awaiting I/O is not assigned a permanent worker thread or database connection. Admission remains bounded, with interactive control capacity reserved and provider rate limits checked before contracting concurrency.

The RDS selection avoids burst-credit uncertainty. AWS's current instance-class table explicitly lists PostgreSQL 18.1+ for `db.m9g.large`; older cheaper class rows did not explicitly confirm 18 when inspected. The official price is **$0.366/hour for the Multi-AZ pair**, not per member; gp3 is **$0.23/GB-month** for that deployment. Neither is multiplied by two again. Confirm exact minor-version orderability in the deployment account before provisioning. Database storage is a provisioned platform amount; tenant table-byte metering later supports fair allocation without pretending unused allocated disk is free.

Nonproduction is a separate account using Basic Support, synthetic data, one-AZ RDS `db.m9g.large` for **160 scheduled hours**, 20 GB retained gp3 and excess backup; scheduled API, worker, broker/proxy and test gateway capacity; 40 Linux test-computer hours; 20 analysis hours; and **2,000 CodeBuild Linux medium minutes** (4 vCPU / 7 GB). Its NAT, public IP and three interface endpoints are charged for **all 730 hours**, since they cannot simply be stopped with the compute. The scheduled database is started/stopped on the twenty workdays; any automatic restart or failed shutdown is billable. CodeBuild performs the private test access, so no extra public staging ALB is assumed. This **$142.74/month** test environment and the quality suite below are allocated once across the product, not per customer. Founder-operated development/support labor is excluded as stated below.

## Customer workload and storage

Each active person has **60 useful computer hours/month**, plus **10 billable preparation/grace hours**: twenty workdays, two sessions/day with ten-minute grace, and ten-minute prestart/day. A Linux computer is an EC2 `m6i.large` at $0.096/hour with 40 GB gp3 and 10 GB of stored incremental snapshots. Stopped disks/snapshots remain billed. This is **70 paid instance-hours/person**, not 730. The clean spare at twenty people is separate platform overhead and contains no customer sessions.

The worksheet also allows, per person:

- **20 GB of accumulated primary evidence/work products**, multiplied by two for retained versions and an independently controlled recovery copy; 4,000 writes and 20,000 reads/month. This is a first-month capacity assumption, not a retention commitment. Twelve months accumulating another 20 GB/person/month raises the twenty-person bill by **$220.62/month**, including support. No lifecycle discount or deletion of required evidence is assumed.
- **2 billed hours of isolated analysis/OCR/conversion** at 2 vCPU / 4 GiB, including startup/collection overhead. Local document/OCR tools are included in this compute assumption; no paid OCR API is silently free. Large scans or long conversion jobs increase measured job duration. RDS/pgvector handles retrieval; 1M embedding input tokens/person/month adds $0.02 API cost.
- **20 watched hours at an assumed 1 Mbps average**, with 1.1 viewer multiplier: 9.9 GB display output/person. Another 2 GB covers other internet output; source/API NAT processing and endpoint/cross-AZ bytes are additional explicit lines. A static view need not continuously encode video. Agent observation tokens are counted in models, not counted again as a separate vision tool fee.
- **2 GB of application/security logs retained for one month**, 4 GB queried, attributable CloudTrail evidence events, KMS/secret calls, identity, DNS, notifications and source-use security monitoring. Screenshots, secrets and whole provider transcripts are not indiscriminately copied into those logs.

The live display still shows the **actual computer**, with scoped human/agent input ownership and private sign-in. A current frame within two seconds for a ready computer, ordinary input response within 200 ms on the design's reference network, and stated restore targets remain **acceptance targets awaiting measurement**. Model observation frequency and desktop frame/input responsiveness are different. Warm preparation/grace reduces perceived waiting while stop/start limits paid idle time; neither guarantees instantaneous recovery. The budget reserves one clean staffed spare only after the regional fleet reaches six users, so a solo firm does not fund a private always-ready fleet.

## Sized cost breakdown

| Monthly cost category | 1 person | 5 people | 20 people |
|---|---:|---:|---:|
| Application compute | $90.10 | $126.14 | $252.28 |
| Computer platform | $162.18 | $162.18 | $162.18 |
| Network platform | $141.97 | $141.97 | $141.97 |
| Database and durable storage | $281.54 | $281.54 | $293.04 |
| Observability and operations | $29.90 | $29.90 | $47.90 |
| Security | $28.47 | $28.47 | $28.47 |
| Identity and delivery | $0.59 | $0.59 | $0.59 |
| Warm computer capacity | $0.00 | $0.00 | $22.75 |
| Organisation custody | $1.80 | $1.80 | $1.80 |
| Active computers | $6.72 | $33.60 | $134.40 |
| Persistent customer data | $4.65 | $23.24 | $92.96 |
| Analysis and conversion | $0.20 | $0.99 | $3.95 |
| Customer traffic | $1.55 | $7.73 | $30.92 |
| Customer operations | $1.88 | $9.39 | $37.56 |
| AWS support | $67.64 | $76.28 | $112.57 |
| Customer model APIs | $196.47 | $982.36 | $3,929.44 |
| Shared quality evaluation | $182.40 | $182.40 | $182.40 |
| Nonproduction and CI | $142.74 | $142.74 | $142.74 |


[Line-items.csv](line-items.csv) contains quantities, units, exact rate keys, amount and source URL for every row. It is the source for these totals; the old desktop subtotal is **not** added a second time. In particular, the two gateways/proxies, NAT, ALB, public IPs, desktop storage, display bandwidth and analysis each occur once. **$0 incremental connector subscriptions** means the launch profile uses customer-owned source applications through direct API/MCP/native tools; it is not a quote for universal free connectors. Source application seats, paid datasets, premium connector services or extra Microsoft 365 seats must be added before that customer is sold such a profile.

Observability is concrete: 60 custom metric series initially/five users and 120 at twenty, 20 standard alarm metrics, one dashboard, bounded ingest/storage/query/API usage. Security includes WAF (one ACL, six rules and metered requests), GuardDuty foundational management/flow/DNS analysis, Inspector image initial/rescans and active desktop scanning, KMS, Secrets Manager and evidence data events. The service's included first copy of CloudTrail management events is used; there is no paid CloudTrail Lake or Insights deployment. RDS has 25 GB of budgeted **excess** backup beyond the included provisioned-storage allocation. S3 versioning/recovery storage and requests are charged, not conflated with database backups.

Business Support+ uses the **current product page's max($29/account, tiered usage percentage)**, including 9% of the first $10,000 eligible production AWS charges. The older pricing-offer catalogue still exposes the previous Business plan's $100/10%; that is recorded as a source conflict rather than silently mixed into the new plan. Model APIs, nonproduction on Basic Support and Marketplace software subscriptions are outside that support base. AWS support is provider technical support, not Zobba customer onboarding, incident staffing or an auditor's professional review.

Network quantities are conservative planning inputs. ALB invoices use the highest capacity dimension in each hour; the worksheet budgets total estimated outgoing bytes plus a small nonbyte allowance, so it can overstate actual ALB LCUs (some non-display output bypasses it). Cross-AZ bytes are explicit charged-side allowances; RDS standby replication is not separately charged again. Interface endpoints provide ECR/Logs access for the isolated execution network, S3 uses the included gateway endpoint, and remaining approved service/API calls use the already-counted NAT. No blanket per-endpoint charge is added for every AWS service.

## Model workload and sensitivity

The proposed budget routing profile uses `gpt-6.1-sol` for coordination, substantive work and computer perception; `gpt-6-luna` for bounded, validated extraction/classification; and a limited `claude-opus-5-5` challenge for consequential claims. These are verified public API tariffs, not Dots or ChatGPT subscriptions. Actual audit-quality qualification, provider entitlement, rate limits and permitted processing destinations still govern admission. A model challenge does not replace human independent review.

The base has **400 coordination calls; 20 substantial Tasks × 40 nonvisual cycles; 1,200 computer observations/action proposals; 800 extraction calls; 20 challenge calls; and 80 scheduled/event wakeups per active person/month**. Token quantities include repeated context, method/skill/tool material, image tokens and hidden reasoning output; another 20% billable redo covers retries/rebasing/recovery. This is **65.76M input and 8.448M output tokens/person/month**, across the chosen models. Total conversational API cost is **$196.128/person**, plus $0.02 embeddings. No cache, Batch, free-tier or negotiated discount is assumed.

Submitted speech input is also priced: **60 captured audio minutes/person/month** (three minutes per workday), plus 20% billable retry volume, uses `gpt-transcribe` at the official **$0.0045 per audio minute**. This adds **$0.324/person/month**, already included in the totals; this is duration billing, not an inferred token conversion. The transcript then uses the existing coordination-call token allowance. The provider/destination must be permitted by the firm, protected sign-in suppresses capture, and consequential transcriptions remain reviewable. This is speech entry, not an always-listening or realtime voice-call subscription.

A shared recurring quality suite costs **$182.40/month**: 200 synthetic cases, four lead-model work calls and one challenge each, with 20% redo. This prices ongoing qualification activity once; it does not prove that 200 cases are statistically sufficient, nor include human expert time. Customer-specific methodology qualification adds its actual usage.

The following are **whole-service monthly cash totals**, holding infrastructure and the shared quality suite fixed while varying the explicitly defined customer model workloads:

| Active people | Light model workload | Base model workload | Heavy model workload |
|---:|---:|---:|---:|
| 1 | $1,168.85 | $1,340.80 | $2,791.47 |
| 5 | $1,371.55 | $2,231.33 | $9,484.67 |
| 20 | $2,178.82 | $5,617.93 | $34,631.32 |


These are illustrative low/base/high workloads, **not P50/P95 measurements**. [MODEL-USAGE.md](MODEL-USAGE.md) gives every call and token assumption, current rates, cache/long-context/reasoning behavior and official source links. The heavy case is not a hard cap: sixty hours of dense visual work at one observation every ten seconds, with otherwise base tokens, produces a twenty-person cash estimate of **$25,201.93/month**. A continuously visual loop can be expensive even when computer runtime is inexpensive. Measure real action frequency, per-provider input/image/reasoning tokens, cancellation charges and repeat work; reduce unnecessary visual calls through stable APIs, structured evidence and local analytical tools without inventing completed work.

For twenty people, an **illustrative** 50% text-cache-hit / 10% cache-write mix lowers the base by $1,034.69 including the shared quality suite; a uniform eligible 10% model regional-processing uplift adds $410.50. Neither is assumed in the main total. Cache write prices replace ordinary input rates for those tokens, rather than being added on top. Long requests above the documented model thresholds require their applicable higher tariff; no base call crosses the selected threshold. More visual calls can also increase network/logging and provider concurrency beyond the isolated token sensitivity; that row is not a complete capacity forecast.

## Windows option and cost limits

The main scenarios are Linux/browser. A qualified profile replacing two Linux users with Windows/Office in the twenty-person firm adds **$312.59/month** in this budget, including its incremental AWS support; see [windows-option.csv](windows-option.csv). The additional Windows instances remain active for 70 hours/user rather than always on. Named-user Office Standard and RDS SAL subscriptions remain monthly even while the instances are stopped. Office Standard and RDS SAL for both named users cost $51.40/month together.

The organisation's own AD/licence-endpoint floor is still **$116.80/month**. This full operating option additionally budgets **$73/month** for two NAT gateways/public IPs in the required separate Windows VPC, so Windows' non-HTTP/OS traffic does not rely on unsupported direct routing through a NAT in a peered VPC. The shared viewer gateway is not duplicated; private routing and the authoritative local input gateway are retained. An explicitly engineered shared application proxy could reduce that network increment after qualification. A different organisation needs its own AD/VPC/floor. Native application compatibility, passkeys/MFA and unattended Office rights still require qualification; these subscription prices alone do not grant every unattended workflow.

This is a complete **monthly service operating-cash estimate for the specified profile**, not an all-company burn rate. It includes the selected AWS, model, support, security, nonproduction/CI and quality-evaluation charges. It explicitly assumes an existing domain/source repository and customer-owned source-app entitlements. It excludes founder/employee labor, paid on-call/customer-success staffing, professional audit review, sales/marketing, accounting/legal, insurance, payment processing, taxes, one-time build/migration expenditure, external penetration tests/certifications, and customer-requested premium software/datasets. No unsupported zero-cost estimate is implied for those items. Product voice calls, paid web-search APIs, provider-hosted code/vector-store sessions, cross-region disaster recovery and dedicated customer deployments are not enabled in this launch profile. Optional components require their own scoped amendment.

There are no credits, reservations, Savings Plans, Spot or assumed account free-tier offsets. Normal included features, such as basic AWS Support, 20 GiB Fargate ephemeral storage, S3 gateway endpoints, integrated ACM certificates and the RDS backup allowance, are service properties rather than promotional discounts. Usage, prices, geography, storage growth and licensed account count can change the bill. The proposed cash envelopes are therefore budgets with explicit workload limits, not fixed vendor quotes.

## Decisions and verification

Use the reference region and base routing/capacity profile for planning. The owner still needs to settle **launch region/processing destinations and retention, the supported application/authentication/concurrency promise, and the commercial usage envelope**. US East is recommended only as the reproducible current baseline; rerate Cape Town or another selected region rather than translating the currency alone. Do not approve unlimited model use merely because a twelve-user computer-only illustration was inexpensive.

For the pilot, record active computer hours, readiness distributions, viewed GB, analysis duration, retained primary/version/recovery bytes, every model's billed input/cache/output tokens, per-Task cost, customer interventions and supported audit outcomes. Revise sizing and included usage from those observations before promising service levels or margins. None of this analysis creates infrastructure or purchases a service.

Run `python calculate_budget.py`, then `python verify_budget.py` from this directory. Inputs are [assumptions.json](assumptions.json), [rates.json](rates.json), [model-rates.json](model-rates.json) and [model-quantities.json](model-quantities.json). Outputs are [results.csv](results.csv), [results.json](results.json), [line-items.csv](line-items.csv), [sensitivity.csv](sensitivity.csv) and the Windows option. Rates include source URLs, retrieval/effective dates and selected SKU/rate dimensions. [AWS evidence](sources/aws-selected-rate-evidence.json), [AWS compatibility and pricing notes](sources/aws-service-notes.md) and [model source receipts](sources/model-source-receipt.json) preserve the provenance without bundling raw web-page dumps. Validation passed: independent Decimal arithmetic checks all nine scenarios, every priced line, AWS source dimensions, support-base exclusions, model totals and shared capacity counted once; a separate reviewer checked the same material calculations and narrative scope. Local links also passed. Performance/throughput and actual cloud bills remain unmeasured.
