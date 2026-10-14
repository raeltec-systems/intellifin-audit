# Story 20.7b live qualification log

Region eu-west-1. Terraform runs in AWS CloudShell as the owner's SSO admin role (owner choice 2026-10-14). The AWS account ID is not recorded here.

| Step | Date | Result |
|---|---|---|
| 1 State backend | 2026-10-14 | Created via read-checked API calls: KMS key `alias/zobba-qualification-tfstate` (rotation on), S3 bucket `zobba-qualification-tfstate-<account>` (versioning, SSE-KMS, public access blocked, TLS-only, admin-role/root-only policy). Settings read back and confirmed. Budget alarm is in Terraform (step 3). |
| 2 prep | 2026-10-14 | Owner chose release branch `codex/zobba-foundation-batch` (no merge to main; a main push would trigger the legacy Release to production Railway). Uploaded the deploy folder from verified commit `22c137e` (Terraform validate + 36/36 tests passed on that snapshot) with ignored `backend.hcl` and `terraform.tfvars` (eu-west-1, USD 200 budget) to `operator/` in the state bucket. Owner runs `terraform plan` in CloudShell. |
| 2 Plan | 2026-10-14 | CloudShell home is 1 GB; provider needs `TF_DATA_DIR=/tmp/tfdata`. `terraform plan` exit 0: 156 to add, 0 change, 0 destroy. Checked: RDS private, Multi-AZ, encrypted, deletion protection, PG 18.6, 7-day backups; ALB internal; no public task IPs; every 0.0.0.0/0 is outbound (IGW/NAT routes, task HTTPS 443 egress). |

## Step 3 — first apply interrupted (2026-10-14)

- The CloudShell apply was interrupted. A stale state lock was removed with
  `force-unlock` after confirming no apply was running.
- The new plan showed two resources that exist in AWS but not in state: the RDS
  instance `zobba-qualification` and the CloudFront VPC origin. They must be imported.
- Defect found: the analysis staging bucket policy denied `s3:*` to every principal
  except the worker task role. That also denied bucket management to administrators
  and Terraform (AccessDenied on `GetBucketPublicAccessBlock`). Fixed in code: the
  deny now covers only object data and listing actions. A tftest proves it and fails
  on the old policy. Recovery: the root user deletes the existing bucket policy once,
  then Terraform writes the corrected one.
