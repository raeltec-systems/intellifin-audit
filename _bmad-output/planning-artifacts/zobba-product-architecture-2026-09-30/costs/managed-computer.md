# Managed computer consolidation: responsive use with explicit economics

Prepared 30 September 2026. Recommendation to replace/expand the lead design's §7, preserving its AWS/Guacamole architecture and full managed-computer product. Dollar amounts are reproducible planning estimates using official list rates; no Zobba desktop or startup benchmark was run.

## Recommended product and operating policy

Keep an EC2 Linux computer with a real desktop and Chromium as the standard profile, Windows/Office as a supported optional profile, and independent Fargate analysis jobs. Keep Guacamole as the display transport. Make **quick attachment to a ready computer** the ordinary experience through a short idle grace period, early preparation when a task needs an application, scheduled preparation, and a small clean spare pool. Make a returning stopped computer visibly restore. Do not market every cold computer as instant.

Use Ubuntu 24.04 and `m6i.large` (2 vCPU, 8 GiB) for the reference Linux capacity; use Windows Server 2022 and `m6i.xlarge` (4 vCPU, 16 GiB) for the reference Windows capacity. Both are ordinary x86, shared-tenancy EC2 VMs with exclusive workspace/principal assignment; “dedicated computer” means a VM assigned exclusively to that workspace, not the separately priced EC2 Dedicated Host/tenancy product. These sizes are provisional capacity allocations that require workload qualification, not measured minimum requirements. Move oversized analytical work out of the computer. Apply normal autoscaling to shared gateways only after their concurrent-session capacity is measured.

Office LTSC **Standard** 2024 covers the usual Word/Excel/PowerPoint/Outlook requirement at the verified lower subscription price; qualify Professional Plus only when its extra applications, such as Access, are required. Keep the named-user AWS License Manager, Managed Microsoft AD and RDS SAL path. Give each subscribing organization its own Windows directory/VPC security partition; do not share an AD domain across unrelated customer firms to erase its minimum cost. Per-client credential/session boundaries still apply within that firm. Regional gateway and controlled egress-proxy services can be shared over explicitly authorized private routes; Office activation endpoints remain in the organization's partition. Native Office does not imply all Microsoft 365 features, unattended automation rights, or compatibility with every workbook macro/add-in. Qualification covers both scheduled execution and unsupervised continuation after an auditor leaves.

The user has already chosen a real managed computer. Warm retention, supported profiles and usage limits are ordinary engineering defaults below, not new approval questions about whether the product should have a computer.

## What to carry from the alternate, and what to correct

| Alternate contribution | Consolidated decision |
|---|---|
| An explicit local computer agent, preparation states and input ownership where input actually lands | Adopt. Keep a small trusted adapter inside the VM, authenticated to the gateway, that enforces current workspace/control generations before every browser/desktop input. |
| A concrete latency/capacity/cost argument rather than “stream a desktop” | Adopt the requirement and the worksheet below. Define targets against a network envelope and measure them; provider resume times are not product readiness measurements. |
| Fly 4–8 GiB microVMs with routine subsecond suspend/resume | Do not adopt as the baseline. Current Fly documentation says suspend is **not recommended above 2 GB**, snapshots are not guaranteed, and code changes/host events can force a cold start. Its “few hundred ms” is a provider resume description. It is not a signed-in Zobba desktop SLA. |
| WebRTC as the necessary route to responsive computer use | Do not adopt as a requirement. Guacamole's real display can use WSS over enterprise-friendly port 443. Current Selkies documentation itself describes plain WebSockets as the default and WebRTC as optional. Either transport needs encoding, backpressure, regional placement and an input authority. |
| $0.03–0.05/hour computers and a 300-hours-per-tenant owned-host crossover | Replace with selected SKU rates and the component worksheet. The alternate's generic shared-CPU prices do not price our qualified desktop, memory, network, warm headroom, licensing or operations. There is no universal crossover at a per-tenant number of hours. |
| Browser providers “offer no desktop/no input gateway we own” | Do not repeat this blanket market claim. Our reason for EC2 is the required OS/profile/control contract and unified operations, not a verified claim about every provider. |

Operating a Firecracker/owned-host fleet is therefore outside the recommended architecture. A future infrastructure decision would compare total capacity, headroom, host failure reserve, patching, operations, storage and data-processing obligations at fleet scale; it cannot be triggered by a borrowed 300-hour figure.

## Actual display and responsive input

Keep one underlying desktop session. Authorized viewers attach to that same Guacamole connection; they do not create independent RDP desktops. Computer display is transient and does not replay from the task-event cursor. A reattached viewer obtains a current desktop image and current control state; the conversation separately replays durable accepted guidance, decisions and results.

Use an authenticated WSS display tunnel on port 443 and a separate priority control channel. The local computer adapter owns the final epoch check for CDP/Playwright operations and desktop input. In the concrete design, Guacamole transports display/synchronization; Zobba routes human key/pointer actions through its authorized input channel to the local adapter, and rejects raw input/file/clipboard opcodes on viewer tunnels. This gives both human and agent actions the same final authority instead of letting buffered RDP/VNC inputs bypass a generation check. Windows input executes in the selected interactive user's session; it is not an unrestricted Session 0 service or an automatic UAC bypass. If an application requires a higher-integrity desktop, it needs a separately qualified profile.

The control path has capacity reserved independently of model streams, analysis jobs and image delivery. Takeover increments the epoch, cancels the complete high-level action/retry loop, releases held keys/buttons and obtains acknowledgement from the local adapter before enabling the new controller. An already-dispatched external submission may have completed; it is reconciled. An adapter that cannot quiesce is fenced and replaced, with the computer showing a transition state until control is safe. No “handover succeeded” badge precedes that acknowledgement.

Target a readable 1440×900 desktop with adaptable resolution and encoding, prioritizing sharp text when the screen is still. Sustained scroll/drag should aim at 15 or more displayed frames/second in the reference network envelope; a static spreadsheet need not consume a constant video frame rate. The worksheet's 1 Mbps is a **traffic assumption**, not a guarantee that Guacamole will deliver those pixels within that bandwidth. Track delivered bytes, freshness, frame rate and CPU together. A mouse cursor may render locally for comfort, but it must not masquerade as evidence that the remote application accepted an action.

Bound each viewer's pending display data and age. Reduce source update rate/resolution where supported; disconnect and resynchronize a slow viewer when necessary. Do not drop arbitrary incremental Guacamole drawing instructions, which can corrupt the display. A slow viewer cannot retain a worker, grow an unbounded queue or hold back the authoritative task. Suspend display encoding/delivery when there are no viewers while permitting authorized agent work to continue. Screenshots acquired for model perception and registered evidence remain separate, bounded operations.

Private sign-in suppresses computer observation, captures, recording and extraction; other watchers get a privacy cover. Never record typed key payloads. The named account owner or permitted delegate sees the real application. Local-browser OAuth remains preferred for connectors; a remote browser does not automatically forward a local passkey, hardware key, password manager or trusted-device identity. Generic clipboard file transfer, SFTP and RDP drive redirection remain disabled; authorized files pass through the artifact exchange. Disabling a UI button is insufficient if a transport still exposes the capability.

### Responsiveness criteria

These are proposed acceptance targets, **not validated observations or launch promises**. Measure timestamps at request admission, local adapter acknowledgement and browser paint. Include a representative browser, a long spreadsheet and a PDF, with model/analysis work running and multiple watchers.

| Journey | Proposed p95 target | Conditions and boundary |
|---|---:|---|
| Attach to running ready computer → first useful current frame | ≤2 seconds | Current authentication; no new OS/application launch. |
| Human input → visible remote response | ≤200 ms | Client-to-region RTT ≤80 ms, packet loss ≤1%, ≥10 Mbps down/2 Mbps up; app processing time reported separately. |
| Takeover request → fenced local acknowledgement and usable human control | ≤1 second | Cooperative driver cancellation under the same network envelope; transitions that cannot quiesce stay visibly pending/paused. |
| Allocate a ready clean Linux spare → usable desktop | ≤30 seconds | Pool hit; includes workspace binding and any necessary profile mount, not third-party sign-in. |
| Restart a preconfigured stopped Linux computer → usable desktop | ≤90 seconds | Capacity available, health checks pass; source sign-in may still be required. |
| Restart a pre-enrolled stopped Windows computer → usable desktop | ≤180 seconds | Already domain-joined/licensed profile; application initialization measured separately. |
| Cold new Linux computer → usable desktop | ≤180 seconds | A target to qualify against the selected image/region, with clear Preparing status. |
| Fresh Windows/Office enrollment | Preparation before first use | AWS documents configuration/domain-join/hardening as taking **around 20 minutes**. Do this at profile enablement, not in a promised instant task handoff. |

Also qualify degraded corporate connectivity: RTT 150–250 ms, 3 Mbps down/1 Mbps up, 1% loss. Aim for ≤500 ms visible input response for ordinary UI actions; reduce display load and show “Connection is delayed” when freshness exceeds the agreed bound. Streaming logs must never include private input or session content. Region selection is part of the performance design: a Virginia price example does not establish good latency for an auditor in Zambia or Europe. Geography, firm policy and the actual launch user's network decide placement.

If Guacamole misses the accepted experience after image, network and encoding tuning, evaluate a WebRTC media implementation behind the same display/input contracts using the same workload. This is a bounded engineering contingency. It does not reopen task authority, evidence flow or the product. Do not use a one-frame-per-second still-image fallback while presenting takeover as responsive live control; label a degraded preview and withhold unsafe interaction until a usable stream is available.

## Lifecycle that earns fast return without paying for idle days

1. **Prepare early, without inventing activity.** When a task first establishes that an application is needed, start restoring its computer while source acquisition or analytical work proceeds. Prefetching needs the task's existing Permission and budget. A scheduled task begins preparing its known computer before its due time. Never auto-run a source write merely to warm the session.
2. **Keep a ready interval.** Retain the running computer for ten minutes after the last relevant activity. Active watching, human control, a transfer, an unsaved document, a tool action or an application wait that genuinely needs the machine prevents suspension. Merely leaving the task's chat tab open does not. Auditors can choose a bounded “Keep ready” interval from their usage allowance.
3. **Suspend eligible idle computers.** Save work and receipts, quiesce input, verify a recoverable checkpoint and gracefully stop the VM. Stop/start is the baseline: EBS persists, RAM does not. Hibernation is an optimization only for a qualified AMI/instance profile. Never make memory snapshots the sole durable work record.
4. **Use a small clean spare pool.** Start with one unassigned Linux spare during 200 staffed hours/month for a shared fleet serving at least six active Linux users. Zero always-running spare is the solo default. The spare has no client credentials or retained profile. Its capacity is a budget allocation, not an assurance of an infinite pool-hit rate. Refill after assignment. During bursts, show honest preparation; prioritize existing computer resumptions over speculative helper requests.
5. **Warm named Windows sessions deliberately.** Pre-enroll the user's licensed profile before first use and predictively start that user's own computer. Do not invent anonymous Office licenses or one shared technical user for the firm. Initial directory/application preparation is product onboarding that can run while other useful work proceeds, not an execution-script wizard for the auditor.
6. **Recover on every return.** Increment generations as needed, verify current account/environment, refresh the display/DOM, reconcile uncertain operations and then continue. Retaining a cookie jar does not establish valid authentication or a correct account. User takeover disconnection pauses the computer; it does not silently hand control back.

Choose session retention separately from evidence retention. The reference costs retain one 40-GB Linux or 100-GB Windows volume all month plus the stated snapshot blocks. They are not permission to retain all cookies forever. Recommended initial session policy is seven days of recoverable idle profile retention, with tenant-approved shorter/longer policies and immediate sign-out/delete controls; repeatedly active profiles can span the month. Credentials in snapshots follow the same deletion boundary as the profile. Document/evidence retention follows the firm's audit policy and can be much longer. If a month-long idle session is removed after seven days, the worksheet's retained-idle scenario is deliberately an upper illustration; the remaining shared service and Windows subscription costs do not disappear with its disk.

## Rate card and reproducibility

Reference region: **US East (N. Virginia), `us-east-1`**. Currency: USD. Retrieval: **30 September 2026**. Reference month: **730 hours**. Use On-Demand, shared tenancy, no Savings Plan/reservation, no free trial or per-customer allocation of AWS's account-wide egress allowance. Rates include neither tax nor a vendor support plan. Windows EC2 rate includes the OS license; it is not the cheaper BYOL/infrastructure-only entry.

| Component | Verified list rate | Source evidence |
|---|---:|---|
| Linux `m6i.large`, 2 vCPU/8 GiB | $0.096/hour | AWS EC2 SKU `B8JJ44GS8MG4RPR4` |
| Windows `m6i.xlarge`, 4 vCPU/16 GiB, no SQL | $0.376/hour | AWS EC2 SKU `QV83RDMFWDU5WFFX` |
| gp3 baseline storage | $0.08/provisioned GB-month | AWS EC2 SKU `JG3KUJMBRGHV3N8G` |
| Standard incremental snapshots | $0.05/stored GB-month | AWS EC2 SKU `7U7TWP44UP36AT3R` |
| NAT | $0.045/gateway-hour + $0.045/processed GB | AWS EC2 regional offer |
| ALB | $0.0225/hour + $0.008/LCU-hour | AWS ELB regional offer |
| Public IPv4 | $0.005/address-hour | AWS VPC regional offer |
| Fargate Linux x86 | $0.04048/vCPU-hour + $0.004445/GiB-hour | AWS ECS regional offer |
| Internet outbound, first 10 TB beyond shared free tier | $0.09/GB | AWS Data Transfer regional offer |
| S3 Standard, first 50 TB | $0.023/GB-month | AWS S3 SKU `WP9ANXZGBYYSGJEA` |
| S3 PUT / GET | $0.005 / $0.0004 per 1,000 requests | AWS S3 regional offer |
| Managed AD Standard | $0.06/domain-controller-hour; minimum two | AWS Directory Service SKU `4JRCBXUEMA8C4MGV` |
| Interface endpoint | $0.01/endpoint-AZ-hour + $0.01/GB in first tier | AWS VPC regional offer |
| Office LTSC Standard / Professional Plus | $15.70 / $21.43 per named user-month | AWS Marketplace listings below |
| RDS SAL | $10 per named user-month | AWS Marketplace listing below |

`managed-computer-rates.json` contains the precise rate, unit, SKU, effective date, retrieval date and current/versioned official URL for every calculator input. EC2 rate terms are effective 1 September 2026; other terms have their own recorded effective dates. The Office listings do not publish a separate effective date; the snapshot date applies. Prices can change. Do not replace the selected Windows entry with the $0.192/h BYOL entry or use CPU counts alone to claim equivalent performance.

Run `python managed-computer-costs.py` beside `managed-computer-rates.json` and `managed-computer-assumptions.json`. It writes the summary CSV, detailed line-item CSV and Markdown table. To change workload or quantity assumptions, copy/edit the assumptions JSON and pass `--assumptions PATH`; pass `--output-dir PATH` to preserve a scenario. Rates are frozen for reproducibility; updating them is an explicit re-quote. The script refuses egress above its selected 10-TB tier instead of silently extrapolating that rate.

### Explicit scenario quantities

The 12-auditor scenario has **60 useful active computer hours per user-month**, two computer sessions per workday, 20 workdays, ten minutes grace per session and ten minutes prestart per day. That is **70 running hours per user's computer**, including ten overhead hours, before a clean spare. Twelve Linux users plus one clean spare for 200 staffed hours consume **1,040 Linux VM-hours**: 720 useful + 120 grace/prestart + 200 clean spare. Always-on is 12×730 = **8,760 VM-hours**. These quantities are estimates to replace with observed use, not claims about how auditors work.

Each active user has 20 viewing hours/month. A 1.1 viewer multiplier allows 10% additional manager viewing; the 1-Mbps traffic assumption yields 118.8 decimal GB of display traffic for the team. Add 2 GB/user of other internet delivery and 5 GB/user of source traffic processed by NAT. Source/browser internet requests traverse the egress proxy/NAT; display traffic travels between private computers, the gateway and public ALB, **not through NAT**. S3 uses a gateway endpoint where appropriate. Do not charge the same display bytes to NAT by default.

Each user retains 20 GB of S3 objects including versions; Linux/Windows disks are 40/100 GB and retained snapshot blocks 10/20 GB. Snapshot billing is based on stored incremental blocks, not full disk size multiplied by snapshot count. Each active user has 2,000 S3 writes and 20,000 reads and two hours of 2-vCPU/4-GiB analytical execution. These analysis hours include image/job startup in the budget; very short jobs also have Fargate minimum-billing effects that must be measured.

The separate two-AZ desktop/network baseline allocates two gateway/guacd replicas at 2 vCPU/4 GiB each, two small egress-proxy replicas at 0.25 vCPU/0.5 GiB, two NAT gateways, one ALB and four public IPv4 addresses (ALB two, NAT two). It costs **$258.91/month before usage charges** at these rates. These replica sizes are deployment allocations; their 12-user concurrent capacity has not been benchmarked. **The chosen shared SaaS architecture pools this regional baseline across tenants; it is not reprovisioned for every solo account.** The whole-deployment solo/idle scenarios below allocate it in full to expose the cost when there is only one customer/user to carry it. The warm spare is also regional shared capacity, not automatically one spare per firm.

ALB actually bills the greatest of its hourly capacity dimensions. The calculator conservatively budgets the byte-driven LCU-hours plus 0.25 LCU during 200 staffed hours for other dimensions; that addition is headroom, not AWS's exact max-dimension formula. Its purpose is a reviewable allowance until hourly traffic is known. Prices for NAT, ALB and egress are separate charges on different aspects of the traffic, not mutually exclusive choices.

Windows adds **$87.60/month per Windows-enabled organization** for the two-controller Standard directory, the named-user Office/RDS charges, and **$29.20/month per organization** of activation/private-endpoint capacity allowance (four endpoint-AZ units). The endpoint count is an explicit quantity allowance to replace with the actual resources created by License Manager; it is not a verified claim that every account receives exactly four such units. Endpoint traffic is budgeted at 1 GB/active Windows user. License Manager itself has no additional service fee. RDS SAL is monthly and AWS documents CAL-related continuing charges after unsubscribing, including its 60-day token rule; stopping the computer does not end this subscription. Prices here assume the license remains assigned for the full reference month. Each result row represents one organization; splitting its users into several independent Windows firms multiplies the organization-specific $116.80 floor and must be modeled explicitly.

### Results

First distinguish **adding a user/profile to an existing adequately provisioned SaaS fleet** from **running an entire deployment for one user**:

| Profile | Direct monthly profile/use cost | Regional capacity allocation | Additional organization-specific Windows floor |
|---|---:|---|---:|
| One active Linux user, 60 useful + 10 ready hours | **$12.49** | Share of actual regional desktop/network capacity, including shared spare policy | $0 |
| One retained idle Linux profile | **$4.16** | Share of retained regional service capacity | $0 |
| One active Windows user with Standard Office | **$63.10** | Share of actual regional desktop/network capacity | **$116.80 per Windows-enabled firm**, shared by its Windows users |
| One retained idle Windows profile with licenses assigned | **$35.16** | Share of retained regional service capacity | Same firm floor while retained |

These direct costs include the stated private compute, grace/prestart, disk/snapshot/artifact storage, licenses where relevant, delivered bytes, source NAT data, S3 calls and analysis quantities. They exclude new shared capacity required if the fleet reaches its limit. The active regional fixed/headroom subtotal is $259.31, or $281.71 with the one clean Linux spare. Allocate the measured regional baseline by reserved concurrent viewing capacity; bill/allocate variable computer, analysis and byte usage to the tenant that causes it. A practical cost formula is:

`tenant direct profile/use + (tenant reserved viewer capacity / total reserved viewer capacity) × regional shared desktop capacity + organization-specific Windows floor + allocated application-platform cost + actual models/connectors`.

The denominator must be actual sold/reserved capacity supported by the tested fleet, not imaginary future users. The $300 platform allowance below is also **one deployment-level placeholder**, not an added $300 cost for every solo SaaS tenant.

The following table instead assigns the full specified regional deployment to each scenario, including its shared baseline exactly once:

| Scenario | Linux h | Windows h | Costed subtotal | Per user | With separate $300 planning allowance, before models |
|---|---:|---:|---:|---:|---:|
| Solo Linux active | 70 | 0 | $271.79 | $271.79 | $571.79 |
| Solo Linux retained idle | 0 | 0 | $263.07 | $263.07 | $563.07 |
| 12 Linux active | 1,040 | 0 | $431.55 | $35.96 | $731.55 |
| 12 Linux retained idle | 0 | 0 | $308.83 | $25.74 | $608.83 |
| 12 Linux always on | 8,760 | 0 | $1,169.47 | $97.46 | $1,469.47 |
| 10 Linux + 2 Windows active | 900 | 140 | $649.57 | $54.13 | $949.57 |
| Solo Windows active | 0 | 70 | $439.20 | $439.20 | $739.20 |
| Solo Windows retained idle | 0 | 0 | $410.87 | $410.87 | $710.87 |
| 12 Windows active | 0 | 840 | $1,133.27 | $94.44 | $1,433.27 |
| 12 Windows retained idle | 0 | 0 | $797.63 | $66.47 | $1,097.63 |
| 12 Windows always on | 0 | 8,760 | $4,111.19 | $342.60 | $4,411.19 |

**Scope of the subtotal:** computer compute, stated retained disks/snapshots/S3 and requests, analytical compute, desktop gateway/egress proxy, stated network baseline and traffic, plus Windows directory/endpoint allowances and licenses when present. It is a scoped infrastructure estimate, not the full Zobba cost of service or a proposed customer price.

**The $300 column is explicitly a planning allowance, not a vendor quote.** It covers an initial allocation for the application API/workers, RDS PostgreSQL Multi-AZ and backups, identity, logs/metrics/traces, KMS/Secrets Manager operations, image registry/builds and other platform operations whose exact sizes/volumes have not been priced here. Replace it with a separately sized platform budget before a commercial commitment. It does not establish that all of those services will fit within $300. Model/provider usage, paid connector services, unusual backup/retention, cross-region or charged cross-AZ traffic, extra endpoints/IPs, deployment overage, tax, human support, security operations and margin remain additional. Prefer same-AZ machine/gateway/egress paths; do not assert cross-AZ traffic is impossible during failover. No discounts or the global 100-GB/month outbound allowance are applied; that allowance is account-wide, not per tenant.

The solo row answers the cost of carrying this shared infrastructure for a single active customer/user. A shared SaaS commercial offer can amortize it across real demand; a dedicated customer deployment must recover it. The all-idle rows retain the service deployment and subscriptions deliberately: they explain why stopping VM compute does not reduce a product's cost to zero.

### Sensitivity and the value of readiness

- The Linux team's ten minutes grace and daily prestart cost **$11.52/month** in additional VM hours. The clean spare adds **$22.40/month** including its retained 40-GB disk. A combined **$33.92/month** buys this initial readiness policy relative to stopping immediately with no spare. That is a rational first allocation; whether it delivers the target pool-hit rate is measurable.
- Keeping all 12 Linux computers continuously running raises the scoped estimate by **$737.92/month**. Windows' active-versus-always-on difference is **$2,977.92/month** for 12 users. These are quantity/rate calculations, not vendor discounts or proof every task can safely stop.
- Raising average media from 1 to 5 Mbps adds roughly **$46.57/month** to the Linux team's stated egress and ALB-byte budget at these rates, before extra encoding capacity. Continuous viewing for all 60 active hours rather than 20 adds roughly **$23.28/month** at 1 Mbps. Extra viewers multiply delivered bytes. This makes bounded, demand-driven streaming financially useful without starving the input channel.
- Office Professional Plus adds **$5.73 per Windows named user-month** over Standard. The recommendation already budgets a separate directory/activation partition per customer organization, not one per auditor or per engagement. If firms require separate directories per audited client as well, each such partition adds its own minimum floor.
- Linux `m6i.large` is priced here at almost twice the alternate's $0.05 maximum estimate, but fleet compute alone is still smaller than the shared baseline at small scale. Replacing the VM provider solely to shave a few cents/hour can leave the larger cost components unchanged while adding operating complexity.

## Consequential business choices and recommendation

1. **Launch customer profile and region:** recommend a shared SaaS regional fleet serving small audit teams, while supporting individuals on that same actual shared capacity. Choose one first customer geography and permitted data/model-processing region. Virginia is the reproducible reference quote, not a residency or latency recommendation. Re-price the same worksheet for the chosen production region; do not deploy far from the target auditors merely to reproduce this price.
2. **Session retention and paid readiness:** recommend seven days recoverable idle profile retention, ten-minute ready grace, an explicitly bounded Keep ready option and the small staffed-hours clean spare. Offer dedicated/always-ready capacity as a priced capability when a firm needs it. Audit evidence retention remains independently governed.
3. **Commercial envelope:** recommend seats plus included computer/analysis/model allowances, firm-wide concurrency and spending limits, and a separately priced named-user Windows capability. The scoped 12-user example is an input to pricing, not the sale price. Cost caps persist/checkpoint work; control/sign-out/stop and retrieval of earned results remain available.

These are the remaining business commitments. The engineering recommendation is settled: AWS/Guacamole, a local fenced adapter, real desktop viewing, limited ready capacity, and durable work independent of the machine. Performance qualification establishes release acceptance and correct capacity quantities; it is not another open-ended platform research project.

## Sources and bundle contents

Official pricing evidence is in `managed-computer-rates.json`, `aws-core-rates.csv`, `aws-core-rates.md` and `aws-evidence/aws-core-selected-evidence.json`. The main calculator bundle is `managed-computer-costs.py`, `managed-computer-assumptions.json`, `managed-computer-rates.json`, `managed-computer-costs.csv`, `managed-computer-line-items.csv` and `managed-computer-cost-table.md`. Include the compact source evidence/metadata rather than every fetched HTML page.

Behavioral and licensing sources, fetched 30 September 2026:

- Fly suspend/resume: https://fly.io/docs/reference/suspend-resume/ — current >2-GB caveat, non-guaranteed snapshots and distinction between provider resume and cold start.
- Fly pricing: https://fly.io/docs/about/pricing/ — resource billing; no alternate hourly claim adopted without a matched SKU.
- Selkies current repository: https://github.com/selkies-project/selkies — WebSockets default, WebRTC optional; not a Zobba benchmark.
- Guacamole architecture/protocol: https://guacamole.apache.org/doc/gug/guacamole-architecture.html and https://guacamole.apache.org/doc/gug/guacamole-protocol.html — display/input protocol and joining an existing connection.
- Guacamole connection controls: https://guacamole.apache.org/doc/gug/configuring-guacamole.html — VNC/RDP, clipboard/file channels and recording configuration.
- EC2 stop/start and hibernation: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html and https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/hibernating-prerequisites.html — RAM/disk and supported-profile limits.
- AWS Office/RDS setup: https://docs.aws.amazon.com/license-manager/latest/userguide/user-based-subscriptions-getting-started.html — about 20 minutes first configuration; AD, endpoint and licensing prerequisites.
- AWS Office/RDS subscriptions: https://docs.aws.amazon.com/license-manager/latest/userguide/user-based-subscriptions.html — named subscriptions, continuing RDS billing and CAL conditions.
- Office Standard listing: https://aws.amazon.com/marketplace/pp/prodview-4riznyn4eqlbw ; Office Professional Plus: https://aws.amazon.com/marketplace/pp/prodview-bh46d5p2hapns ; RDS SAL: https://aws.amazon.com/marketplace/pp/prodview-buamtl3v3xaes — current named-user list rates.
- Directory pricing/minimum controller count: https://aws.amazon.com/directoryservice/pricing/ ; License Manager service price: https://aws.amazon.com/license-manager/pricing/ .
- Microsoft unattended Office: https://learn.microsoft.com/en-us/microsoft-365-apps/licensing-activation/overview-unattended and https://learn.microsoft.com/en-us/office/client-developer/integration/considerations-unattended-automation-office-microsoft-365-for-unattended-rpa — rights/support cannot be inferred from an interactive subscription.

No latency, encoding throughput, pool-hit rate, peak concurrency, application compatibility, licensed unattended operation, regional customer connectivity or complete platform bill was validated by these document fetches. Those uncertainties are bounded by the concrete targets, explicit quantity assumptions and release acceptance above.
