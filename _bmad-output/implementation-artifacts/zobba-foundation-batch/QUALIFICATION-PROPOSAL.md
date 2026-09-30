# Bounded AWS qualification proposal

**30 September 2026 · Proposed, NOT APPROVED · No cloud spend authorised**

**Recommend:** one isolated, tagged `zobba-qualification` stack in **AWS `us-east-1`, two Availability Zones**, in an owner-designated nonproduction account. Approval must record the account ID, operator and UTC start/end. Maximum lifetime **7 days / 168 hours from first apply**; **USD $300 total authorisation ceiling**, including teardown, allowed retention and any taxes. Estimated service charges **$214.13**; headroom $85.87; no discounts. Local work remains unblocked.

**Proof and sequence.** Keep [23.1](../../planning-artifacts/epics.md#story-231-prove-the-first-real-computer-and-sign-in-profile) early: Ubuntu 24.04, Chromium, VNC/guacd, Rust gateway and Guacamole client; **one `m6i.large` Linux VM, at most 24 running hours**, two authorised viewers, actual browser input/takeover and private sign-in. Use synthetic users and an owned Cognito-backed sign-in fixture with password/TOTP; qualify only that named profile, without claiming third-party SSO/passkey support. Measure attach/input/frame, reconnect and sign-in privacy on reference/degraded networks. **Model/API inference and transcription: $0; no model-driven browsing, Windows or paid app seats.**

23.1 can precede full [20.7](../../planning-artifacts/epics.md#story-207-deploy-a-recoverable-qualification-environment) completion. Reuse pinned network/gateway/IAM components; pool infrastructure once when API/workers, fresh RDS/S3 custody and release/restore proof are ready. This allowance reserves both, including one four-hour database restore. The harness cannot pass 20.7; unfinished 20.7 must not postpone early 23.1. Neither is production qualification.

| Maximum priced allocation | USD |
|---|---:|
| Fargate: 2 API + 2 worker tasks (each 0.5 vCPU/1 GiB), 2 gateway/guacd (2/4), 2 brokers + 2 proxies (0.25/0.5); aggregate **7 vCPU/14 GiB × 168h**, at $0.04048/vCPU-h + $0.004445/GiB-h | 58.06 |
| RDS PostgreSQL 18.1+ `db.m9g.large` Multi-AZ **168h × $0.366**, 50 GB gp3 prorated at $0.23/GB-month; separate Single-AZ restore **4h × $0.183** and 50 GB storage | 64.90 |
| 2 NAT + 1 ALB + 4 public IPv4 + 6 endpoint-AZs, **168h × (2×$0.045 + $0.0225 + 4×$0.005 + 6×$0.01)** | 32.34 |
| Linux **24h × $0.096**; 40 GB gp3 for seven days; up to 10 GB stored EBS snapshots for 30 days | 3.54 |
| Up to 20 GB S3 evidence/recovery objects and 50 GB retained RDS snapshot, each budgeted for 30 days after creation | 5.21 |
| 50 GB internet output, 20 GB NAT processing, 10 GB endpoint processing, 10 GB cross-AZ traffic charged on two sides; conservative ALB byte/headroom allowance | 6.15 |
| 4 KMS key versions, 10 secrets, 4 Cognito MAUs, bounded custody/object/DNS/email requests; keys/secrets conservatively priced for a full month | 8.99 |
| 30 metric series, 10 alarms, 1 dashboard; 5 GB logs + 10 GB queries; WAF, bounded GuardDuty/Inspector/CloudTrail; 2 GB ECR, 100 CodeBuild medium minutes—full-month fixed fees budgeted conservatively | 34.94 |
| **Service estimate, using unrounded amounts** | **214.13** |

Rates/formulas: [operating-budget inputs](../../planning-artifacts/zobba-operating-budget-2026-09-30/rates.json) (official rates checked 30 September; 730-hour month). **Basic Support only.** Do not enrol in a paid plan: Business Support+ has a **$29/account-month minimum**, not a seven-day prorated $6.67; an existing paid-plan obligation or changed account scope must be reflected in the approval. This card buys neither another full test environment nor the recurring $182.40 model-quality suite.

**Enforcement and exit.** Review an allowlisted plan with these count/size caps, no autoscaling/additional regions, and an independently verified expiry job. Reserve remaining resource-hours; monitor inventory/billing; alert at $150/$200; **start shutdown at $225 accrued-plus-committed estimated cost**, earlier if commitments threaten $300. AWS Budgets/alerts lag and are **not a hard kill switch**. IAM limits, metering and expiry reduce exposure, without guaranteeing the invoice ceiling. Extensions/replacements require renewed approval.

By day seven or earlier completion/stop, export proof locally; destroy compute, databases, ALB/NAT/endpoints; release EIPs and remove paid monitoring/security. **VM stop is insufficient.** Only capped snapshots/S3 objects may remain for 30 days, with verified deletion jobs. Remove secrets, schedule KMS deletion and check residual inventory/billing. Retention/paid-plan obligations can outlive teardown. No AWS account call, purchase or deployment occurred.
