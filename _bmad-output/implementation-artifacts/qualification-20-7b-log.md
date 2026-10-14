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

## Step 4 — first full apply, two errors (2026-10-14)

- Most resources were created. Two failed:
  - ECS worker service: ECS refuses AZ rebalancing when `deployment_maximum_percent`
    is 100 or less. The worker keeps 100% so two workers never overlap; rebalancing
    is now DISABLED for the worker only. A tftest guards the combination.
  - NAT gateway: the interrupted first apply had already created a NAT gateway that
    holds the Elastic IP but is not in state. The new one failed. Recovery: remove
    the failed one from state and import the existing one.
- Second policy defect: the narrowed deny still listed `s3:ListBucket*`. HeadBucket
  needs `s3:ListBucket`, so administrators got 403 and Terraform planned to create
  the existing bucket. `ListBucket` is removed from the deny (object bytes stay
  worker-only); the test now asserts HeadBucket stays allowed. The admin user removes
  the applied policy with `delete-bucket-policy` (no root needed this time).

## Step 5 — infrastructure complete; two plan drifts fixed (2026-10-14)

- Imported the NAT gateway and both NAT routes left by the interrupted apply; the
  remaining apply succeeded.
- Two changes reappeared on every plan: task-definition volumes (`configure_at_launch`
  read back as false) and `rds.force_ssl` (`apply_method` read back as pending-reboot,
  the parameter is static in PostgreSQL 18). Both are now declared as AWS reports them.
- Fixed one more drift (ECS default container fields). Final plan: **No changes.**
  First apply of the qualification infrastructure is complete (2026-10-14).
- Second apply: ALB ingress now references only the CloudFront VPC-origin service
  security group (`restrict_alb_to_vpc_origin_sg = true` kept in tfvars). Plan: no changes.
- Role bootstrap: one-off task exit 0, log `bootstrap: roles_ready` (2026-10-14).
- First release run failed at "Assume the release role": GitHub sent the immutable-ID
  OIDC subject (`repo:owner@id/name@id:environment:qualification`, seen in CloudTrail).
  The release role now also trusts that exact subject (`github_repository_ids`).
- First release: run 38577970876 attempt 2 (commit bba77ef) succeeded. Image digest
  `sha256:ecc772d07f38b9abee6f5563978103b707c462f9cefcd0380c7b35d0a4d33b13`; smoke
  `openapi` matched; migration exited 0; API/worker revisions deployed (0 desired
  tasks, as expected before `image_digest` is set); web synced, CloudFront invalidated.
  The release workflow file was registered on `main` by the owner with `[skip ci]`
  (workflow_dispatch needs the default branch); releases run from the release branch.
- `image_digest` set and applied: API 2/2, worker 1/1, services stable;
  `GET <public origin>/api/health/ready` returned 200 through CloudFront (2026-10-14).
