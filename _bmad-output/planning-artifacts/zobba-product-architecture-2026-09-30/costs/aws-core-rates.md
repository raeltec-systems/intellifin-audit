# AWS core price evidence for Zobba managed computers

Verified **30 September 2026**, using public AWS offer files and AWS documentation. Region: **US East (N. Virginia), `us-east-1`**. Currency: **USD**. These are published On-Demand list rates, before applicable taxes, credits, negotiated discounts or Savings Plans. They are rates, not a complete deployment estimate. No Office or directory subscription rates are included in this note.

[Machine-readable rates](aws-core-rates.csv) contain exact SKUs, rate codes, units, tier boundaries, term effective dates, offer publication dates and both current and versioned source URLs. [Trimmed source evidence](aws-evidence/aws-core-selected-evidence.json) preserves each selected AWS product and term. The [source manifest](aws-evidence/source-manifest.json) records retrieval timestamps and file checksums. The EC2 catalogue was streamed; its 481 MB full catalogue is not retained. [Selected EC2 source](aws-evidence/ec2-selected.json) retains the relevant entries, including the similarly named Windows alternatives that must not be confused with the selected price.

| Item | Published USD rate | Billing unit | SKU | Term effective date |
| --- | ---: | --- | --- | --- |
| EC2 `m6i.large`, Linux, shared tenancy, no preinstalled software | 0.096 | Instance-hour | `B8JJ44GS8MG4RPR4` | 2026-09-01 |
| EC2 `m6i.xlarge`, Windows, shared tenancy, no SQL | 0.376 | Instance-hour | `QV83RDMFWDU5WFFX` | 2026-09-01 |
| EBS gp3 provisioned volume storage | 0.08 | GB-month | `JG3KUJMBRGHV3N8G` | 2026-09-01 |
| EBS standard incremental snapshot storage | 0.05 | Stored GB-month | `7U7TWP44UP36AT3R` | 2026-09-01 |
| Standard NAT gateway provisioned time | 0.045 | Gateway-hour | `M2YSHUBETB3JX4M4` | 2026-09-01 |
| Standard NAT gateway processed data | 0.045 | GB processed | `59S5R83GFPUAGVR5` | 2026-09-01 |
| Application Load Balancer provisioned time | 0.0225 | ALB-hour or partial hour | `37CUWUT8GSNQEPUV` | 2026-08-01 |
| Application Load Balancer used capacity | 0.008 | LCU-hour or partial hour | `P2XGEJ8N3KU52WA8` | 2026-08-01 |
| Fargate Linux x86 CPU | 0.04048 | vCPU-hour | `8CESGAFWKAJ98PME` | 2026-07-01 |
| Fargate Linux x86 memory | 0.004445 | GB-hour | `PBZNQUSEXZUC34C9` | 2026-07-01 |
| Fargate extra ephemeral storage | 0.000111 | Additional GB-hour | `7KPDPTDSCT4J3Z64` | 2026-07-01 |
| In-use public IPv4 address | 0.005 | Address-hour | `4GQUNXTFWVSGPUZK` | 2026-09-01 |
| Idle public IPv4 address | 0.005 | Address-hour | `T6YDQKTMVWKNJFJ8` | 2026-09-01 |

The catalogue calls Fargate CPU and memory units `hours`; the associated product attributes identify them as `perCPU` and `perGB`. The CSV retains both the raw catalogue unit and the explicit quantity unit above. Term effective dates describe the returned offer terms; they do not establish when a price was first introduced.

**Internet data transfer out** uses SKU `HQEH3ZWJVT46JHRG`, with terms effective 2026-06-01. The separate global free-tier SKU is `PB257JUQ8U6E6UPM`.

| Monthly band | Published USD/GB | Catalogue range, GB beyond free tier |
| --- | ---: | --- |
| Global free tier | 0 | 100 GB shared across AWS services and regions, excluding China and GovCloud |
| First 10 TB beyond global free tier | 0.09 | 0–10,240 |
| Next 40 TB | 0.085 | 10,240–51,200 |
| Next 100 TB | 0.07 | 51,200–153,600 |
| Beyond 150 TB | 0.05 | 153,600–unlimited |

Do not give each computer its own 100 GB allowance. For a Zobba cost model, either model the remaining account-wide allowance explicitly or assume it is already consumed. NAT data processing, ALB LCUs and internet egress are different charge dimensions and can apply to the same overall workload; charge NAT only for traffic that actually traverses a NAT gateway. Browser desktop traffic through an internet-facing ALB to private targets does not thereby traverse NAT.

**Instance selection.** The Linux rate is for 2 vCPU and 8 GiB RAM. The Windows rate is for 4 vCPU and 16 GiB RAM, `operatingSystem=Windows`, `tenancy=Shared`, `preInstalledSw=NA`, `capacitystatus=Used`, `operation=RunInstances:0002`. The AWS catalogue also contains Windows BYOL (`RunInstances:0800`) and Windows infrastructure without licenses (`RunInstances:0002:box`) at $0.192/hour. Neither is the $0.376/hour Windows rate selected here. Selecting a Windows rate does not include Office, application subscriptions or remote desktop user access licenses. [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/) says Linux and Windows partial hours are billed per second, with compute charges until termination or stop; retained volumes and other resources continue to have their own charges.

**Storage and snapshots.** [EBS pricing](https://aws.amazon.com/ebs/pricing/) charges for provisioned volume GB until released, even while a computer is stopped. gp3 includes baseline 3,000 IOPS and 125 MB/s as described on that pricing page. Extra IOPS is $0.005/IOPS-month (`7Q58NR58VQEASA4W`); raw catalogue throughput pricing is $40.96/GiBps-month (`SQUFRQX4K92S4SBB`), equivalent to $0.04 per MiB/s-month. The catalogue units are preserved in the CSV. gp3 storage, provisioned IOPS and provisioned throughput are billed per second with a 60-second minimum. Standard snapshot storage is based on actual saved data: the first snapshot saves written data, subsequent snapshots save changed blocks, and empty blocks are not stored. A model should use retained chargeable snapshot GB, not multiply provisioned disk size by the number of snapshots. The $0.05 rate excludes snapshot archive, cross-region copying and optional Fast Snapshot Restore.

**Fargate.** [Fargate pricing](https://aws.amazon.com/fargate/pricing/) bills requested resources from image-download start until task termination, per second with a one-minute minimum for Linux. Twenty GB of ephemeral storage is included; the extra-storage rate applies to additional requested storage. This note selects Linux x86 On-Demand, not ARM, Spot or Windows. Network transfers, public IPv4 addresses, logging and other services are additional.

**Two-AZ public IPv4 baseline.** An ordinary regional internet-facing IPv4 ALB requires at least two AZ subnets and has one IP address per enabled AZ; the [ALB guide](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html) states both requirements. [Creating a public NAT gateway](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-working-with.html) requires an Elastic IP address, and secondary addresses are optional. Thus a two-AZ design with one public IPv4 ALB and one standard public NAT gateway in each AZ has an initial **four public IPv4 addresses**: two ALB addresses plus two NAT addresses. At $0.005/address-hour, this is **$0.02/hour**, or **$14.60 for an illustrative 730-hour month**. Those two figures are arithmetic derived from the verified rate and the stated topology, not separate AWS prices. Count any additional addresses actually consumed or retained. The eight free private subnet addresses recommended for ALB scaling are subnet capacity; they are not eight billable public IPv4 addresses per AZ. IPv6-only public ALBs and BYOIP have different implications and are not the baseline used here.

[NAT documentation](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html) recommends one NAT gateway in each AZ for resiliency. [VPC pricing](https://aws.amazon.com/vpc/pricing/) also identifies potential inter-AZ transfer charges when a workload uses a NAT gateway in another AZ, as well as ordinary internet egress where applicable. Public IPv4 is billed separately for addresses consumed by NAT and ALB. [ELB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) charges ALB LCUs using the largest of its connection, active-connection, processed-byte and rule-evaluation dimensions. Do not add those four LCU quantities together. These rates are for ordinary usage, without optional capacity reservation or trust-store charges.

The relevant immutable offer URLs are:

- [EC2, EBS, NAT: offer published 2026-09-25 17:45:21 UTC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/20260925174521/us-east-1/index.json).
- [Fargate: offer published 2026-09-11 12:44:25 UTC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/20260911124425/us-east-1/index.json).
- [ALB: offer published 2026-09-11 12:45:44 UTC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20260911124544/us-east-1/index.json).
- [Data transfer: offer published 2026-09-16 13:22:08 UTC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSDataTransfer/20260916132208/us-east-1/index.json).
- [Public IPv4: offer published 2026-09-17 19:05:28 UTC](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20260917190528/us-east-1/index.json).

Published list prices can change. A final deployment estimate also needs actual runtime, warm capacity, stop grace, allocated storage, snapshot retention, network traffic and shared-service consumption. This note establishes the rate inputs and their scope; it does not assume those quantities.
