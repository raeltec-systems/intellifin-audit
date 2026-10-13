# Story 22.4 isolated analysis jobs. One disposable Fargate task per consumed
# attempt, started by the worker (RunTask) with no task role, in a dedicated
# analysis VPC whose only route out is a S3 gateway endpoint restricted by
# policy to the job-scoped staging prefix (and the ECR layer bucket the
# platform needs to pull the pinned image), with ECR and Logs interface
# endpoints and a resolver DNS firewall that answers only those names. The worker stages and
# collects through presigned URLs it creates outside the job. Verified offline
# only; live qualification belongs to Story 20.7b.

locals {
  analysis_enabled = local.released && var.analysis_image_digest != null
  # Before an analysis image is mirrored, the definition names a tag that is
  # never pulled and the worker composes no sandbox.
  analysis_image    = var.analysis_image_digest != null ? "${aws_ecr_repository.analysis.repository_url}@${var.analysis_image_digest}" : "${aws_ecr_repository.analysis.repository_url}:unreleased"
  analysis_volumes  = ["input", "job", "output", "tmp", "control"]
  analysis_non_root = "65534:65534"
}

resource "aws_ecr_repository" "analysis" {
  name                 = "${local.name}-analysis"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.this.arn
  }

  tags = { Name = "${local.name}-analysis" }
}

# A dedicated VPC: analysis tasks share no network, resolver, endpoint or
# security group with the application. Nothing in it routes to the internet,
# the application VPC or any peer.
resource "aws_vpc" "analysis" {
  cidr_block           = var.analysis_vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${local.name}-analysis" }
}

resource "aws_default_security_group" "analysis" {
  vpc_id = aws_vpc.analysis.id
  tags   = { Name = "${local.name}-analysis-default-deny" }
}

resource "aws_flow_log" "analysis" {
  vpc_id               = aws_vpc.analysis.id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = local.flow_log_group_arn
  iam_role_arn         = aws_iam_role.flow_logs.arn
}

resource "aws_subnet" "analysis" {
  count                   = 2
  vpc_id                  = aws_vpc.analysis.id
  availability_zone       = local.zones[count.index]
  cidr_block              = cidrsubnet(var.analysis_vpc_cidr, 2, count.index)
  map_public_ip_on_launch = false

  tags = { Name = "${local.name}-analysis-${local.zones[count.index]}", Tier = "analysis" }
}

# No routes are declared on this table. Its only non-local route is the one
# the restricted S3 gateway endpoint below installs.
resource "aws_route_table" "analysis" {
  vpc_id = aws_vpc.analysis.id
  tags   = { Name = "${local.name}-analysis" }
}

resource "aws_route_table_association" "analysis" {
  count          = 2
  subnet_id      = aws_subnet.analysis[count.index].id
  route_table_id = aws_route_table.analysis.id
}

resource "aws_vpc_endpoint" "analysis_s3" {
  vpc_id            = aws_vpc.analysis.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.analysis.id]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "JobStaging"
        Effect    = "Allow"
        Principal = "*"
        Action    = ["s3:GetObject", "s3:PutObject"]
        Resource  = "${aws_s3_bucket.analysis_staging.arn}/analysis/*"
      },
      {
        # Fargate pulls ECR image layers from this AWS-owned bucket.
        Sid       = "EcrLayers"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "arn:${local.partition}:s3:::prod-${var.region}-starport-layer-bucket/*"
      },
    ]
  })
  tags = { Name = "${local.name}-analysis-s3" }
}

locals {
  # Exactly the interface endpoints an analysis task needs: image pull (ECR API
  # and registry) and log delivery for the trusted containers.
  analysis_interface_endpoints = toset(["ecr.api", "ecr.dkr", "logs"])
  # Names an analysis task may resolve: those endpoints, the staging bucket and
  # the ECR layer bucket. Every other query is answered NXDOMAIN.
  analysis_dns_allowed = [
    "api.ecr.${var.region}.amazonaws.com.",
    "${local.account_id}.dkr.ecr.${var.region}.amazonaws.com.",
    "logs.${var.region}.amazonaws.com.",
    "${aws_s3_bucket.analysis_staging.bucket}.s3.${var.region}.amazonaws.com.",
    "prod-${var.region}-starport-layer-bucket.s3.${var.region}.amazonaws.com.",
  ]
}

resource "aws_vpc_endpoint" "analysis_interface" {
  for_each = local.analysis_interface_endpoints

  vpc_id              = aws_vpc.analysis.id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = aws_subnet.analysis[*].id
  security_group_ids  = [aws_security_group.analysis_endpoints.id]
  tags                = { Name = "${local.name}-analysis-${each.key}" }
}

resource "aws_security_group" "analysis" {
  #checkov:skip=CKV2_AWS_5:attached at run time by the worker's RunTask network configuration, not by a Terraform resource
  name        = "${local.name}-analysis"
  description = "Analysis jobs: no inbound; HTTPS only to the staging endpoint and the analysis endpoints"
  vpc_id      = aws_vpc.analysis.id
  tags        = { Name = "${local.name}-analysis" }
}

resource "aws_security_group" "analysis_endpoints" {
  name        = "${local.name}-analysis-endpoints"
  description = "Analysis VPC interface endpoints: HTTPS from analysis tasks only"
  vpc_id      = aws_vpc.analysis.id
  tags        = { Name = "${local.name}-analysis-endpoints" }
}

resource "aws_vpc_security_group_egress_rule" "analysis_s3" {
  security_group_id = aws_security_group.analysis.id
  description       = "HTTPS to the restricted S3 gateway endpoint (staging and image layers)"
  prefix_list_id    = aws_vpc_endpoint.analysis_s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "analysis_endpoints" {
  security_group_id            = aws_security_group.analysis.id
  description                  = "HTTPS to the analysis ECR and Logs endpoints only"
  referenced_security_group_id = aws_security_group.analysis_endpoints.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_ingress_rule" "analysis_endpoints_from_analysis" {
  security_group_id            = aws_security_group.analysis_endpoints.id
  description                  = "HTTPS from analysis tasks (image pull and logs only; jobs hold no credentials)"
  referenced_security_group_id = aws_security_group.analysis.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

# DNS: the VPC resolver answers only the allowlisted names; every other query
# (and so DNS-tunnelled data) is blocked. Fail closed if the firewall is
# unavailable.
resource "aws_route53_resolver_firewall_domain_list" "analysis_allowed" {
  name    = "${local.name}-analysis-allowed"
  domains = local.analysis_dns_allowed
}

resource "aws_route53_resolver_firewall_domain_list" "analysis_everything" {
  name    = "${local.name}-analysis-everything"
  domains = ["*."]
}

resource "aws_route53_resolver_firewall_rule_group" "analysis" {
  name = "${local.name}-analysis"
}

resource "aws_route53_resolver_firewall_rule" "analysis_allow" {
  name                    = "allow-required-endpoints"
  action                  = "ALLOW"
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.analysis_allowed.id
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.analysis.id
  priority                = 100
  # Private endpoint and S3 answers may be aliases of the allowed names.
  firewall_domain_redirection_action = "TRUST_REDIRECTION_DOMAIN"
}

resource "aws_route53_resolver_firewall_rule" "analysis_block" {
  name                    = "block-everything-else"
  action                  = "BLOCK"
  block_response          = "NXDOMAIN"
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.analysis_everything.id
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.analysis.id
  priority                = 200
}

resource "aws_route53_resolver_firewall_rule_group_association" "analysis" {
  name                   = "${local.name}-analysis"
  firewall_rule_group_id = aws_route53_resolver_firewall_rule_group.analysis.id
  vpc_id                 = aws_vpc.analysis.id
  priority               = 101
  mutation_protection    = "ENABLED"
}

resource "aws_route53_resolver_firewall_config" "analysis" {
  resource_id        = aws_vpc.analysis.id
  firewall_fail_open = "DISABLED"
}

# Job-scoped staging and collection objects. Private, TLS-only, KMS, and
# expired after one day: they are transport, never evidence.
resource "aws_s3_bucket" "analysis_staging" {
  #checkov:skip=CKV_AWS_18:S3 server access logs need a log bucket and are a cost decision; enable before real data
  #checkov:skip=CKV2_AWS_62:no consumer of S3 event notifications exists
  #checkov:skip=CKV_AWS_144:staging objects expire after one day and are not evidence
  #checkov:skip=CKV_AWS_21:staging objects are written once per attempt and expire; versioning adds no recovery value
  bucket        = "${local.name}-analysis-${local.account_id}"
  force_destroy = false
  tags          = { Name = "${local.name}-analysis-staging" }
}

resource "aws_s3_bucket_ownership_controls" "analysis_staging" {
  bucket = aws_s3_bucket.analysis_staging.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "analysis_staging" {
  bucket                  = aws_s3_bucket.analysis_staging.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "analysis_staging" {
  bucket = aws_s3_bucket.analysis_staging.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.this.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "analysis_staging" {
  bucket = aws_s3_bucket.analysis_staging.id
  rule {
    id     = "expire-job-objects"
    status = "Enabled"
    filter {
      prefix = "analysis/"
    }
    expiration {
      days = 1
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_policy" "analysis_staging" {
  bucket = aws_s3_bucket.analysis_staging.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.analysis_staging.arn, "${aws_s3_bucket.analysis_staging.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        # Every object request is signed by the worker's task role, directly or
        # through a presigned URL it created; no other principal is admitted.
        Sid       = "OnlyTheWorker"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.analysis_staging.arn, "${aws_s3_bucket.analysis_staging.arn}/*"]
        Condition = { ArnNotEquals = { "aws:PrincipalArn" = aws_iam_role.worker_task.arn } }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.analysis_staging]
}

# Pull and logs only. The analysis task definition has NO task role.
resource "aws_iam_role" "analysis_execution" {
  name               = "${local.name}-analysis-execution"
  assume_role_policy = local.ecs_assume_role
}

resource "aws_iam_role_policy" "analysis_execution" {
  name = "execution"
  role = aws_iam_role.analysis_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.this["analysis"].arn}:*"
      },
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid      = "EcrPull"
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = aws_ecr_repository.analysis.arn
      },
      {
        Sid      = "EcrDecrypt"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = aws_kms_key.this.arn
        Condition = {
          StringEquals = { "kms:ViaService" = "ecr.${var.region}.amazonaws.com" }
        }
      },
    ]
  })
}

locals {
  analysis_common = {
    image                  = local.analysis_image
    readonlyRootFilesystem = true
    privileged             = false
    environment            = []
    secrets                = []
  }
  # Trusted containers log only fixed closed codes. The untrusted program has
  # no log configuration: its stdout and stderr never reach CloudWatch.
  analysis_trusted_logs = { logConfiguration = local.log_options["analysis"] }
}

resource "aws_ecs_task_definition" "analysis" {
  #checkov:skip=CKV_AWS_336:every container sets readonlyRootFilesystem; scratch space is task-scoped volumes
  family                   = "${local.name}-analysis"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  # Owner ceiling: 2 vCPU, 4 GiB. RunTask overrides narrow it per job.
  cpu                = 2048
  memory             = 4096
  execution_role_arn = aws_iam_role.analysis_execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  dynamic "volume" {
    for_each = toset(local.analysis_volumes)
    content {
      name = volume.value
    }
  }

  container_definitions = jsonencode([
    merge(local.analysis_common, local.analysis_trusted_logs, {
      # Trusted: fetches the pinned inputs and program through one presigned
      # manifest URL supplied at RunTask, verifying every digest.
      name       = "stage"
      essential  = false
      user       = "0:0"
      entryPoint = ["python3", "-I", "-c"]
      command    = [file("${path.module}/analysis/stage.py")]
      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { drop = ["ALL"] }
      }
      mountPoints = [for v in local.analysis_volumes : { sourceVolume = v, containerPath = "/${v}", readOnly = false }]
    }),
    merge(local.analysis_common, {
      # The untrusted program: non-root, no capabilities, read-only inputs,
      # no environment, URL or credential, and no task role.
      name      = "analysis"
      essential = false
      user      = local.analysis_non_root
      # The wall limit is enforced in the job (the trusted collector still runs
      # afterwards); RunTask supplies the limit and the fixed interpreter argv.
      entryPoint = ["timeout", "-s", "KILL"]
      command    = ["1s", "true"]
      dependsOn  = [{ containerName = "stage", condition = "SUCCESS" }]
      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { drop = ["ALL"] }
      }
      mountPoints = [
        { sourceVolume = "input", containerPath = "/input", readOnly = true },
        { sourceVolume = "job", containerPath = "/job", readOnly = true },
        { sourceVolume = "output", containerPath = "/output", readOnly = false },
        { sourceVolume = "tmp", containerPath = "/tmp", readOnly = false },
      ]
    }),
    merge(local.analysis_common, local.analysis_trusted_logs, {
      # Trusted: after the program exits, reports lstat facts and uploads only
      # bounded regular files to presigned slots. Its exit ends the task.
      name       = "collect"
      essential  = true
      user       = local.analysis_non_root
      entryPoint = ["python3", "-I", "-c"]
      command    = [file("${path.module}/analysis/collect.py")]
      dependsOn  = [{ containerName = "analysis", condition = "COMPLETE" }]
      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { drop = ["ALL"] }
      }
      mountPoints = [
        { sourceVolume = "output", containerPath = "/output", readOnly = true },
        { sourceVolume = "control", containerPath = "/control", readOnly = true },
        { sourceVolume = "tmp", containerPath = "/tmp", readOnly = false },
      ]
    }),
  ])
}

# The worker's task role exists only for analysis custody: start, observe and
# stop analysis tasks, pass the analysis execution role (never a task role),
# stage/collect job objects, and read originals / write descendants.
resource "aws_iam_role" "worker_task" {
  name               = "${local.name}-worker-task"
  assume_role_policy = local.ecs_assume_role
}

resource "aws_iam_role_policy" "worker_task" {
  name = "analysis"
  role = aws_iam_role.worker_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RunAnalysis"
        Effect   = "Allow"
        Action   = "ecs:RunTask"
        Resource = "arn:${local.partition}:ecs:${var.region}:${local.account_id}:task-definition/${local.name}-analysis:*"
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.this.arn }
        }
      },
      {
        # RunTask tags every analysis task; tagging is allowed only as part of
        # that RunTask, so no other task can acquire the tag through this role.
        Sid      = "TagAnalysisAtRun"
        Effect   = "Allow"
        Action   = "ecs:TagResource"
        Resource = "arn:${local.partition}:ecs:${var.region}:${local.account_id}:task/${aws_ecs_cluster.this.name}/*"
        Condition = {
          StringEquals = {
            "ecs:CreateAction"              = "RunTask"
            "aws:RequestTag/zobba:analysis" = "1"
          }
        }
      },
      {
        # Only tasks this role started as analysis tasks can be read or stopped.
        Sid      = "ObserveAnalysis"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks", "ecs:StopTask"]
        Resource = "arn:${local.partition}:ecs:${var.region}:${local.account_id}:task/${aws_ecs_cluster.this.name}/*"
        Condition = {
          StringEquals = { "aws:ResourceTag/zobba:analysis" = "1" }
          ArnEquals    = { "ecs:cluster" = aws_ecs_cluster.this.arn }
        }
      },
      {
        Sid      = "FindAnalysis"
        Effect   = "Allow"
        Action   = "ecs:ListTasks"
        Resource = "*"
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.this.arn }
        }
      },
      {
        Sid      = "PassAnalysisExecutionRole"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.analysis_execution.arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      {
        Sid      = "StageAndCollect"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.analysis_staging.arn}/analysis/*"
      },
      {
        Sid      = "ReadOriginalsAndDescendants"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.evidence.arn}/evidence/*"
      },
      {
        # The worker writes only analysis descendants (IDs `analysis-...`).
        Sid      = "PutDescendants"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.evidence.arn}/evidence/analysis-*"
      },
      {
        Sid      = "ReadinessList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.evidence.arn
        Condition = {
          StringEquals = { "s3:prefix" = "__health/sentinel/" }
        }
      },
      {
        Sid      = "ObjectKey"
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.this.arn
        Condition = {
          StringEquals = { "kms:ViaService" = "s3.${var.region}.amazonaws.com" }
        }
      },
    ]
  })
}

locals {
  # Present only once both the release and the analysis image are pinned.
  worker_analysis_environment = local.analysis_enabled ? [
    { name = "ZOBBA_ANALYSIS_SANDBOX", value = "fargate" },
    { name = "ZOBBA_ANALYSIS_REGION", value = var.region },
    { name = "ZOBBA_ANALYSIS_CLUSTER", value = aws_ecs_cluster.this.arn },
    { name = "ZOBBA_ANALYSIS_TASK_DEFINITION", value = "${aws_ecs_task_definition.analysis.family}:${aws_ecs_task_definition.analysis.revision}" },
    { name = "ZOBBA_ANALYSIS_SUBNETS", value = join(",", aws_subnet.analysis[*].id) },
    { name = "ZOBBA_ANALYSIS_SECURITY_GROUPS", value = aws_security_group.analysis.id },
    { name = "ZOBBA_ANALYSIS_STAGING_BUCKET", value = aws_s3_bucket.analysis_staging.bucket },
    { name = "ZOBBA_EVIDENCE_BUCKET", value = aws_s3_bucket.evidence.bucket },
    { name = "AWS_REGION", value = var.region },
  ] : []
}
