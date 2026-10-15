# Zobba qualification environment — operator runbook

Status: **written and verified offline only (Story 20.7a).** Nothing here has
been applied to AWS. No live deployment is qualified. The live proof, including
restore and reconciliation, is Story 20.7b.

This runbook covers the code in `zobba/deploy/`:

| Path | What it is |
|------|------------|
| `Containerfile` | One image with `zobba-api`, `zobba-worker`, `zobba-cli` (no default process; ECS selects the binary). |
| `qualification/` | Terraform for the isolated two-zone environment (pinned Terraform 1.16.3, AWS provider 6.65.0, random 3.9.1, committed `.terraform.lock.hcl`). |
| `qualification/bootstrap-roles.sh` | Role bootstrap run as a one-off ECS task. |
| `../../.github/workflows/zobba-qualification-release.yml` | Manual release (build → migrate → deploy → web). |

Every step below names its **command**, the **owner gate** it needs, and what it
**costs or retains**. Do not skip a gate: a missing gate means stop.

## 0. Owner gates (all required before step 2)

| Gate | Decision the owner records | Why |
|------|----------------------------|-----|
| G1 Account | A dedicated AWS account for qualification only (startup credits applied). | Isolation; the budget is account-wide. |
| G2 Region | The `region` variable value. | Cost and data location. There is no default. |
| G3 Budget | `budget_monthly_limit_usd` and `budget_alert_email`. | Alerts at 50 % / 80 % actual and 100 % forecast. **An alert does not stop spending.** |
| G4 Spend approval | Approval of the estimated monthly cost below. | Startup credits are not yet granted. |
| G5 Data | Only synthetic data until a separate owner decision. | No real customer evidence in qualification. |
| G6 GitHub | Who may approve the `qualification` GitHub environment. | Each release run waits for that approval. |
| G7 Destroy | Explicit written approval for any destroy (section 9). | Backups and evidence are retained by design. |

Cost profile (smallest Multi-AZ; **estimate only**, on-demand list prices, check
in the AWS Pricing Calculator for the chosen region before G4):

| Item | Approx. USD / month |
|------|--------------------:|
| RDS PostgreSQL 18 `db.t4g.micro` Multi-AZ + 20 GiB gp3 | 30–35 |
| 1 NAT gateway (+ data processing) | 35–45 |
| 4 interface VPC endpoints × 2 zones (ECR API, ECR DKR, Secrets Manager, Logs) | 55–60 |
| Internal ALB | 18–22 |
| Fargate: 2 API + 1 worker tasks (0.25 vCPU / 0.5 GiB) | 25–30 |
| CloudFront, S3, KMS, Secrets Manager, CloudWatch Logs, Cognito (low use) | 5–15 |
| **Total** | **≈ 170–210** |

Cost changes that need a new owner decision ("Ask First"): a second NAT gateway
(`nat_gateway_count = 2`, ≈ +35), a larger `db_instance_class`, more tasks,
WAF, Performance Insights, Container Insights, access logging, longer log
retention. The checkov suppressions in the Terraform record each of these as an
owner decision.

## 1. Tools (operator workstation)

- Terraform **1.16.3** exactly, AWS CLI v2, `jq`, Docker (only for local image checks).
- Credentials: an AWS SSO / IAM Identity Center session for an administrator in
  the qualification account. Never create IAM access keys. Never put
  credentials in files under the repository.

```sh
aws sts get-caller-identity   # confirm the account is the qualification account (G1)
```

Costs nothing. Retains nothing.

## 2. State backend (once)

Gate: G1–G4. Creates a KMS key and an S3 bucket for Terraform state (versioned,
encrypted, public access blocked, TLS-only). Cost: ≈ 1 USD/month. Retained
until manually deleted. Terraform locks state with an S3 lock file
(`use_lockfile = true`); no DynamoDB table is needed.

```sh
REGION=<G2 region>
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
STATE_BUCKET=zobba-qualification-tfstate-$ACCOUNT
KEY_ID=$(aws kms create-key --region "$REGION" --description "zobba qualification terraform state" \
  --tags TagKey=Project,TagValue=zobba TagKey=Environment,TagValue=qualification --query KeyMetadata.KeyId --output text)
aws kms enable-key-rotation --region "$REGION" --key-id "$KEY_ID"
aws kms create-alias --region "$REGION" --alias-name alias/zobba-qualification-tfstate --target-key-id "$KEY_ID"
aws s3api create-bucket --region "$REGION" --bucket "$STATE_BUCKET" \
  --create-bucket-configuration LocationConstraint="$REGION"   # omit this flag in us-east-1
aws s3api put-public-access-block --bucket "$STATE_BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$STATE_BUCKET" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$STATE_BUCKET" --server-side-encryption-configuration \
  "{\"Rules\":[{\"ApplyServerSideEncryptionByDefault\":{\"SSEAlgorithm\":\"aws:kms\",\"KMSMasterKeyID\":\"$KEY_ID\"},\"BucketKeyEnabled\":true}]}"
# Only the administrator role(s) may touch state. ADMIN_ROLE_PATTERN is the
# IAM role ARN of your administrator SSO permission set, for example
# arn:aws:iam::$ACCOUNT:role/aws-reserved/sso.amazonaws.com/*/AWSReservedSSO_AdministratorAccess_*
ADMIN_ROLE_PATTERN='<administrator role ARN pattern>'
aws s3api put-bucket-policy --bucket "$STATE_BUCKET" --policy "$(jq -n \
  --arg b "arn:aws:s3:::$STATE_BUCKET" --arg admin "$ADMIN_ROLE_PATTERN" --arg root "arn:aws:iam::$ACCOUNT:root" '{
  Version: "2012-10-17",
  Statement: [
    {Sid: "DenyInsecureTransport", Effect: "Deny", Principal: "*", Action: "s3:*",
     Resource: [$b, "\($b)/*"], Condition: {Bool: {"aws:SecureTransport": "false"}}},
    {Sid: "OnlyAdministrators", Effect: "Deny", Principal: "*", Action: "s3:*",
     Resource: [$b, "\($b)/*"], Condition: {StringNotLike: {"aws:PrincipalArn": [$admin, $root]}}}
  ]}')"
aws s3api put-bucket-tagging --bucket "$STATE_BUCKET" --tagging \
  'TagSet=[{Key=Project,Value=zobba},{Key=Environment,Value=qualification}]'
```

Write the backend configuration to the ignored file
`zobba/deploy/qualification/backend.hcl` (template: `backend.example.hcl`) with
your bucket, region and `kms_key_id = "alias/zobba-qualification-tfstate"`.
Write owner-approved variables to the ignored `terraform.tfvars` (template:
`example.tfvars`). Neither file is committed.

The release role has no access to the state bucket: releases never run
Terraform.

State contents: resource identifiers and the Cognito app client secret (the
provider reads it back from Cognito). Database passwords are **not** in state:
they are ephemeral values written with write-only Secrets Manager arguments.
Only administrators may read the state bucket.

## 3. First apply

Gate: G1–G5. Starts the monthly cost in section 0. Retains: RDS (deletion
protection, final snapshot), evidence bucket, KMS key, Cognito pool (deletion
protection), secrets (30-day recovery window).

```sh
cd zobba/deploy/qualification
terraform init -backend-config=backend.hcl -lockfile=readonly
terraform plan -out=qualification.tfplan        # review: no public ALB, no public DB, image_digest unset
terraform apply qualification.tfplan
terraform output -json github_environment_variables
```

Before the first release `image_digest` is unset, so both services run **0
tasks** and the task definitions name a placeholder tag that is never pulled.
RDS Multi-AZ creation takes about 20–40 minutes.

If the account already has a GitHub OIDC provider, set
`create_github_oidc_provider = false`.

**Second apply (restrict the ALB to CloudFront VPC origins).** AWS documents
two ways to admit CloudFront VPC-origin traffic to the internal ALB: the
CloudFront origin-facing managed prefix list (works before the VPC origin
exists, so the first apply uses it), or the service-managed security group
`CloudFront-VPCOrigins-Service-SG`, which CloudFront creates in the VPC only
when the VPC origin is created and which admits only CloudFront VPC-origin
traffic. After the first apply succeeds:

```sh
aws ec2 describe-security-groups --filters Name=vpc-id,Values=<vpc id> \
  Name=group-name,Values='CloudFront-VPCOrigins-Service-SG*' --query 'SecurityGroups[].GroupId'   # exactly one
terraform apply -var restrict_alb_to_vpc_origin_sg=true    # or set it in terraform.tfvars
```

This replaces the prefix-list rule with a rule referencing that group. Keep
`restrict_alb_to_vpc_origin_sg = true` from then on. Neither option opens
0.0.0.0/0 or the VPC CIDR.

## 4. Role bootstrap (once, and after any password rotation)

Gate: G5. Cost: one short Fargate task (cents). Uses the RDS-managed master
secret. Readers of that secret: this task's execution role and account
administrators (IAM delegation through the key policy); no application role
and not the release role. Creates
`zobba_migrator` (owner of database `zobba`) and `zobba_app`, both `LOGIN
NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`, with no role
memberships (so neither is in `rds_superuser`), sets their passwords from the
two URL secrets, revokes `PUBLIC` on the database and grants `CONNECT` to
`zobba_app`. It is idempotent and refuses to finish if any of this is not true.
It prints no secret value.

```sh
CLUSTER=$(terraform output -raw ecs_cluster)
NETWORK=$(terraform output -raw task_network_configuration)
TASK=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$(terraform output -raw bootstrap_task_definition)" \
  --network-configuration "$NETWORK" --started-by operator-bootstrap \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" \
  --query "tasks[0].containers[0].exitCode"          # must be 0
aws logs tail /zobba-qualification/bootstrap --since 30m   # expect "bootstrap: roles_ready"
```

The release role cannot run this task; only an administrator can.

**Any new password version requires this bootstrap again.** The URL secrets
are rewritten (with new passwords) when `database_password_version` increases
**and when the RDS address or port changes** (the write-only version folds in
a hash of `address:port`). Each rewrite leaves the database on the old
passwords until the bootstrap runs. Order:

1. `terraform apply` (writes new URL secrets).
2. Rerun this bootstrap task at once (sets the new passwords).
3. Force a new deployment of both services
   (`aws ecs update-service --cluster ... --service ... --force-new-deployment`).

Rotation window: between steps 1 and 2, any task that starts (scale-out,
replacement) reads the new URL and cannot connect; between steps 2 and 3,
running tasks keep their open connections but any new connection with the old
password fails, so readiness can fail until step 3 completes. Rotate in a
quiet period and finish all three steps together.

## 5. GitHub environment (once)

Gate: G6. Costs nothing.

1. Create the GitHub environment `qualification` with required reviewers (G6)
   and a **deployment branch rule** that allows only `release_branch`
   (default `main`; Settings → Environments → qualification → Deployment
   branches and tags → Selected branches). The workflow also refuses any ref
   other than `refs/heads/$RELEASE_BRANCH`, and the AWS role trusts only the
   OIDC subject `repo:<owner>/<repo>:environment:qualification`, so only a job
   that passed this environment's rules can assume it.
2. Add each key/value from `terraform output -json github_environment_variables`
   as an environment **variable** (none is secret).
3. Add no AWS keys. The workflow assumes `AWS_RELEASE_ROLE_ARN` through GitHub
   OIDC; the role trusts only `repo:<owner>/<repo>:environment:qualification`.

## 6. Release

Gate: G6 approval of the run. Cost: one build, one migration task, a rolling
service update, one CloudFront invalidation. Retains: the image in ECR (30
most recent kept), every task definition revision.

Run **Actions → Zobba qualification release → Run workflow**. It never runs on
push. Order, each step stopping the run on failure:

1. Build and push the image (tag `<sha>-<run id>-<attempt>`; everything after
   uses the digest). Smoke: `zobba-cli openapi` must equal `zobba/openapi.json`.
2. `zobba/deploy/release/migrate.sh`: refuse if an earlier release migration
   is still RUNNING/PENDING; register a migration revision with the new digest;
   run `zobba-cli migrate --runtime-role zobba_app` (the only use of the
   migrator URL); poll with a 15-minute deadline. **Any exit code other than 0
   (including none) fails the job before any service changes.** On timeout the
   task is stopped and the run summary says "migration outcome unknown": check
   the schema (`/api/health/ready` of the running release, or a manual
   migration task) before retrying.
3. `zobba/deploy/release/deploy-services.sh`: update the API, then the worker.
   Each must end with the new revision as the PRIMARY deployment and
   `rolloutState = COMPLETED`. If either fails, **both** services are returned
   to the revisions they had before the release and the job fails without
   syncing the web shell.

Task definition revisions: `register-revision.sh` bases every new revision on
the **latest revision Terraform registered** for the same family (revisions
without a `ReleasedBy` tag) and changes only the image; it removes read-only
fields and carries the tags over, adding `ReleasedBy`, `ReleaseRun` and
`ReleaseBase`. Consequences:

- Terraform changes to a task's environment, secrets, roles or size reach the
  running services **only at the next release** (services ignore
  `task_definition` so the release owns which revision runs). After such an
  apply, run a release.
- Residual risk: `ecs:RegisterTaskDefinition` cannot be scoped, and
  `iam:PassRole` limits *which* roles a revision can carry (the API, worker and
  migration execution roles and the API task role, never the bootstrap role)
  but cannot bind a role to a family. A compromised release run could
  therefore register, for example, an API revision with the migration execution
  role. The mitigations are the environment approval (G6), the branch rule, the
  workflow taking roles only from Terraform's revision, and review of
  `ReleaseBase` tags; treat a revision whose roles differ from Terraform's as an
  incident.
4. Build `zobba/web`, sync `web/dist` to the web bucket, invalidate CloudFront.

There are no startup migrations: the API and worker refuse an unmigrated or
mismatched schema (`/health/ready` returns 503).

### First release

The first release migrates, deploys revisions to services that still have 0
desired tasks, and publishes the web shell. Then set `image_digest` to the
digest in the run summary and apply:

```sh
terraform apply -var image_digest=sha256:<digest from the run summary>   # or set it in terraform.tfvars
```

This scales the API to `api_desired_count` (≥ 2, both zones) and the worker to
`worker_desired_count`. Later releases need no Terraform change; keep
`image_digest` roughly current so a future apply does not register an old
digest as the Terraform-owned revision (services ignore it either way).

Then create the first administrator user (synthetic data only, G5):

```sh
aws cognito-idp admin-create-user --user-pool-id "$(terraform output -raw cognito_user_pool_id)" \
  --username <owner email> --user-attributes Name=email,Value=<owner email> Name=email_verified,Value=true
```

Cognito establishes identity only; Zobba access still comes from Zobba's own
membership records. Keep the `User.Attributes` value named `sub` from that
command's output: it is the OIDC subject for the next step (or read it later
with `aws cognito-idp admin-get-user ... --query "UserAttributes[?Name=='sub'].Value | [0]"`).

Then create the first organisation and make that user its Admin (G5). This is a
one-off run of the latest released migration task definition with only the
container command changed; the task definition's entry point is already
`/usr/local/bin/zobba-cli`, and ECS overrides cannot replace an entry point, so
the override command holds the subcommand and its options only. The image must
come from a release that includes `provision-organisation`.

The issuer must be exactly the API's `ZOBBA_OIDC_ISSUER`
(`https://cognito-idp.<region>.amazonaws.com/<user pool id>`, from
`local.oidc_issuer` in `main.tf`), with no trailing slash:

```sh
CLUSTER=$(terraform output -raw ecs_cluster)
NETWORK=$(terraform output -raw task_network_configuration)
POOL=$(terraform output -raw cognito_user_pool_id)
ISSUER="https://cognito-idp.${POOL%%_*}.amazonaws.com/$POOL"   # the pool ID's prefix is its region
SUBJECT=<sub from admin-create-user>
OVERRIDES=$(jq -nc --arg issuer "$ISSUER" --arg subject "$SUBJECT" '{containerOverrides:[{name:"migrate",
  command:["provision-organisation","--organisation-id","<organisation id>","--organisation-name","<organisation name>",
    "--issuer",$issuer,"--subject",$subject,"--display-name","<owner display name>"]}]}')
TASK=$(aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition zobba-qualification-migrate \
  --network-configuration "$NETWORK" --overrides "$OVERRIDES" \
  --started-by operator-provision --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK"
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" \
  --query "tasks[0].containers[?name=='migrate'].exitCode | [0]"   # must be 0
aws logs tail /zobba-qualification/migrate --since 30m
```

`--task-definition` with the family only selects the latest ACTIVE revision,
which is the one the last release registered. `--started-by operator-provision`
keeps the release's "earlier migration still running" check (it only counts
`release-*` tasks) from treating this task as a release migration.

Expected log lines (fixed codes and opaque IDs only):

- `cli: organisation_provisioned organisation_id=<id> identity_id=<id>`: the
  organisation, the identity (or the existing identity for this issuer/subject,
  for example after an earlier sign-in) and an active, non-expiring Admin
  membership were committed in one READ COMMITTED transaction.
- `cli: already_provisioned organisation_id=<id> identity_id=<id>`, exit 0:
  an exact retry; nothing changed.
- Non-zero exit with `cli: organisation_conflict` (the organisation exists with
  a different name, a different Admin, or a widened/expiring/inactive
  membership), `cli: identity_inactive` (the issuer/subject identity exists but
  is inactive), `cli: identity_conflict`, `cli: invalid_<field>` or
  `cli: schema_mismatch` (the schema is not exactly current): nothing changed.
  The command never promotes, reactivates or clears an expiry; resolve the
  conflict through the product's membership Save or authorised owner action. The pool uses Cognito's default email sender, which has a
low daily sending limit (on the order of 50 messages per day) and a Cognito
sender address; invitations and recovery mails beyond it fail. Configuring
Amazon SES is an owner decision outside 20.7a.

Check: open `terraform output -raw public_origin`, sign in, and
`curl -fsS "$(terraform output -raw public_origin)/api/health/ready"`.

## 6a. Analysis image (Story 22.4, optional)

Analysis stays disabled until `analysis_image_digest` is set: the worker then
composes no sandbox. No production entry point admits analysis jobs yet (a
later model-tool story adds admission), so enabling it only lets the worker run
and recover jobs. To enable it:

1. Build the one allowlisted general image reproducibly and push it to the
   analysis ECR repository (`terraform output analysis_ecr_repository_url`):
   `deploy/qualification/analysis/general/build.sh <repository>:22.5` fetches
   the hash-pinned wheels (pandas, openpyxl, python-docx, pypdfium2) and builds
   with `SOURCE_DATE_EPOCH=0` and rewritten layer timestamps, then prints the
   manifest digest. The script pins every input: the base by index digest
   (pulled through `mirror.gcr.io`, override with `ZOBBA_BASE_MIRROR`), pip
   25.2 by hash in a temporary virtual environment, and buildx v0.37.1 (it
   refuses another release; override with `ZOBBA_BUILDX_VERSION` only to
   investigate a difference). It removes its working files on exit, including
   on failure. The digest must equal `GENERAL_IMAGE_DIGEST` in
   `crates/domain/src/analysis.rs`
   (`sha256:8241deca19d20b576c0d4b2ad75deac753492d335de45d284766df3d5666ea5f`,
   Story 22.5); Terraform refuses any other value. The base is
   `python:3.13-slim@sha256:70729b46…` (`GENERAL_BASE_IMAGE_DIGEST`). If the
   digest differs, do not change the allowlist: report it (a changed wheel or
   build tool is an owner decision).
2. Set `analysis_image_digest` in the reviewed tfvars and apply. The worker task
   definition gains its task role and exactly the environment names in
   `analysis/worker-environment.json`; the next release carries them.
3. No other image or library may be added without the owner (spec Ask First),
   and no limit above 2 vCPU / 4 GiB / 15 minutes / 100 MiB. The Story 22.5
   trusted document program runs in this image too (render and locate jobs,
   1 vCPU / 1 GiB / 120 s / 80 MiB); native page reading also needs a qualified
   profile with `image_input`, which production does not compose yet.

What isolates a job: a dedicated analysis VPC (`analysis_vpc_cidr`) with no
internet route and no peering; a S3 gateway endpoint whose policy admits only
the job's staging prefix and the ECR layer bucket; ECR API, ECR registry and
Logs interface endpoints reachable only from the analysis security group; a
Route 53 Resolver DNS Firewall that answers only those endpoint, staging and
layer names, returns NXDOMAIN for everything else and fails closed; no task
role; the program container has no environment and no log configuration. The
worker's task role may run only the analysis family, tag only at RunTask,
describe and stop only tasks tagged `zobba:analysis=1`, pass only the analysis
execution role, and write only staging objects and `evidence/analysis-*`.

Residual risks, verified only offline until Story 20.7b:

- A RunTask that ECS accepts after the worker lost its reply cannot be fenced.
  A task that cannot be found (and was never recorded) is therefore `unknown`,
  never `absent`: no automatic retry and no outputs. There is no operator
  reconciliation command yet.
- Fargate does not enforce a kernel file-size or PID limit or a sized `/tmp`;
  the trusted collector and the worker's validator enforce the output limits,
  and the task's ephemeral storage bounds the rest.
- The wall limit is enforced inside the task (`timeout -s KILL`); the worker's
  own StopTask after the grace stops the collector too, so such a job is closed
  `limit_exceeded:wall_time` with `collection_unavailable` and no outputs.
- DNS: the allowed names still resolve, so a program can encode data in queries
  for them; those queries go only to AWS's resolvers for AWS-owned names, not to
  a resolver the program chooses. The rules and the redirection-trust setting
  are untested against live AWS behaviour.
- The ECS task metadata endpoint (`169.254.170.2`) is reachable from the job and
  discloses task metadata, but no credentials (there is no task role).
- The `ecs:TagResource`/`aws:ResourceTag` conditions and the S3 endpoint policy
  are checked only by `terraform test` against a mocked provider.

## 7. Rollback limits

- **Application**: redeploy an earlier image by updating both services to an
  earlier task definition revision
  (`aws ecs update-service --cluster ... --service ... --task-definition <family>:<revision>`).
  This is safe **only if no migration ran since that image**. Migrations are
  forward-only; an older binary refuses a newer schema (readiness 503), which
  is the intended fail-closed behaviour, not a bug to work around.
- **Schema**: there is no down migration. Reverting a schema means a restore
  (section 10), which loses writes after the restore point.
- **Web shell**: rerun the release from the earlier commit, or restore earlier
  object versions in the versioned web bucket and invalidate.
- **Database minor version**: `auto_minor_version_upgrade` is off. Upgrade by
  changing `db_engine_version` (an exact `18.x` that RDS lists:
  `aws rds describe-db-engine-versions --engine postgres --engine-version 18`)
  in a reviewed change, applying in the maintenance window (Multi-AZ fails
  over once), then checking `/api/health/ready`. A minor version cannot be
  downgraded in place; going back means a restore (section 10).
- **Infrastructure**: revert the Terraform commit and apply. Some changes
  (RDS engine major version, KMS key, bucket names, region, Cognito pool) cannot
  be reverted in place.

## 8. What is retained (and why)

| Resource | Retention |
|----------|-----------|
| RDS automated backups / PITR | `backup_retention_days` (default 7, minimum 7). Kept after deletion (`delete_automated_backups = false`). |
| RDS final snapshot | `zobba-qualification-final-g<deployment_generation>`, created on delete, kept until manually deleted. |
| Evidence bucket | All object versions; no expiry rule. Terraform cannot delete a non-empty bucket (`force_destroy = false`). The bucket name, region and default endpoint are the evidence namespace fingerprint: never change them for this environment. |
| Web bucket | Non-current versions expire after 30 days. |
| KMS key | 30-day deletion window; while pending deletion, data encrypted with it cannot be read. |
| Secrets | `secret_recovery_window_days` (default 30) recovery window after deletion. |
| Logs | `log_retention_days` (default 30), including the declared RDS `postgresql` and `upgrade` groups; all encrypted with the environment key. Statement text is never logged (`log_statement = none`, `log_min_error_statement = panic`), so `ALTER ROLE ... PASSWORD` from the bootstrap never reaches logs. Audit records are in PostgreSQL, not logs. |
| Cognito pool | Deletion protection on. |

## 9. Destroy boundaries

Gate: G7, in writing, naming what may be lost. Never run a plain
`terraform destroy` against this environment.

- RDS has deletion protection; the ALB has deletion protection; the Cognito
  pool has deletion protection. Each must be turned off by an explicit,
  reviewed Terraform change first.
- The evidence bucket must be emptied by a person on purpose (all versions)
  before it can be deleted; Terraform will not do it.
- Scheduling the KMS key for deletion makes every snapshot and evidence object
  encrypted with it unreadable after the window. Do not schedule it while any
  retained snapshot or evidence must stay readable.
- Re-applying after a destroy: increase `deployment_generation` so the new
  final snapshot name does not collide with the retained one; deleted secrets
  keep their names for the recovery window, so either restore them
  (`aws secretsmanager restore-secret`) and import them, or wait out the
  window. Set `secret_recovery_window_days = 0` only for a deliberate,
  approved (G7) teardown where the secrets must not be recoverable.
- To stop spend without losing data: set the services to 0 tasks
  (`image_digest = null` and apply), stop the database
  (`aws rds stop-db-instance`, auto-restarts after 7 days), and remove the NAT
  gateway only with a reviewed change. Interface endpoints, storage and
  backups continue to cost.

## 10. Restore and reconciliation — Story 20.7b, exercised 2026-10-15

**Exercised once (2026-10-15):** steps 1 and the verification below were run
and passed; steps 2–3 (switching services to a restored instance) were not,
because nothing needed recovering. Record: `qualification-20-7b-log.md`, Step 6.

Drill that was run (CloudShell, about 30 minutes, under USD 1):

- Restore with `--use-latest-restorable-time`, the source's class, subnet group,
  parameter group and the existing database security group (no service is
  pointed at the copy), `--no-multi-az --no-publicly-accessible
  --no-deletion-protection`, tag `purpose=restore-drill`. It took about 20 minutes;
  the copy was encrypted and not public.
- Verify with one bootstrap one-off task (command and `ORIG_HOST`/`REST_HOST`
  overrides) that, for both hosts, prints `max(version)`, the count and an md5 of
  the `_sqlx_migrations` (version, checksum) list, the public table count, and an
  md5 of `pg_dump --schema-only --no-owner`. The dump must drop comment lines
  **and** the `\restrict` / `\unrestrict` lines (`grep -v -E '^(--|\\(un)?restrict)'`):
  pg_dump 17.6+/18 writes a random key there, so the hash otherwise never matches.
  Pass: all three values equal on both hosts.
- Row counts are not compared: the tables use FORCE RLS, so a count without an
  actor context does not mean anything.
- Delete the copy: `aws rds delete-db-instance --skip-final-snapshot --delete-automated-backups`.
- CloudShell may lose its credentials during the long wait (metadata `500`):
  restart CloudShell and run the whole block again (`/tmp` is cleared).

Full procedure for a real recovery:

1. Restore to a new, isolated instance (never over the original):
   `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier zobba-qualification --target-db-instance-identifier zobba-qualification-restore-<date> --restore-time <UTC> ...`
   with the same subnet group, a security group reachable only from a one-off
   task, encryption with the environment key, and no application services
   pointed at it.
2. Keep services pointed at the restored database **stopped** until
   reconciliation: possible effects consumed after the restore horizon (operation
   claims, dispatched attempts, evidence written to S3) are not in the restored
   database. Compare consumed operations and evidence object versions after
   the restore time with the restored records before resuming any Task.
3. Only then point the runtime/migrator URL secrets at the restored instance,
   rerun the role bootstrap if needed, and redeploy.

## 11. Spend check (weekly, and before any change in section 0)

```sh
aws ce get-cost-and-usage --time-period Start=$(date -u +%Y-%m-01),End=$(date -u -d tomorrow +%F) \
  --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE
aws budgets describe-budget --account-id "$ACCOUNT" --budget-name zobba-qualification-monthly
```

Costs: Cost Explorer API calls are ≈ 0.01 USD each. Compare with section 0;
an unexpected NAT data or endpoint line is the usual surprise.

## 12. Secret handling

- Secrets exist only in Secrets Manager, encrypted with the environment key:
  `zobba-qualification/database/migrator-url`, `.../runtime-url`,
  `.../oidc/client-secret`, and the RDS-managed master secret.
- Each task has its own execution role and can read only its own secrets:
  API → runtime URL + OIDC client secret; worker → runtime URL; migration →
  migrator URL; bootstrap → master secret + both URLs. No task definition
  `environment` contains a secret, and no Terraform output does.
- Never print, copy or paste secret values (including into issues, chat or
  logs). To inspect, check metadata only:
  `aws secretsmanager describe-secret --secret-id <name>`.
- The environment never contains `seed-local`, `ZOBBA_LOCAL_FIXTURES`,
  `ZOBBA_OIDC_CA_FILE`, model API keys, or test-only S3/OIDC switches. The
  offline tests fail if a task definition gains one.
