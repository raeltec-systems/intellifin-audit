# Story 22.4 isolated analysis jobs. One disposable Fargate task per consumed
# attempt, started by the worker (RunTask) with no task role, in isolated
# subnets whose only route out of the VPC is a dedicated S3 gateway endpoint
# restricted by policy to the job-scoped staging prefix (and the ECR layer
# bucket the platform needs to pull the pinned image). The worker stages and
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

resource "aws_subnet" "analysis" {
  count                   = 2
  vpc_id                  = aws_vpc.this.id
  availability_zone       = local.zones[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, 12 + count.index)
  map_public_ip_on_launch = false

  tags = { Name = "${local.name}-analysis-${local.zones[count.index]}", Tier = "analysis" }
}

# No routes are declared on this table. Its only non-local route is the one
# the dedicated S3 gateway endpoint below installs.
resource "aws_route_table" "analysis" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${local.name}-analysis" }
}

resource "aws_route_table_association" "analysis" {
  count          = 2
  subnet_id      = aws_subnet.analysis[count.index].id
  route_table_id = aws_route_table.analysis.id
}

resource "aws_vpc_endpoint" "analysis_s3" {
  vpc_id            = aws_vpc.this.id
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

resource "aws_security_group" "analysis" {
  name        = "${local.name}-analysis"
  description = "Analysis jobs: no inbound; HTTPS only to the staging endpoint and VPC interface endpoints"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${local.name}-analysis" }
}

resource "aws_vpc_security_group_egress_rule" "analysis_s3" {
  security_group_id = aws_security_group.analysis.id
  description       = "HTTPS to the dedicated S3 gateway endpoint (staging and image layers)"
  prefix_list_id    = aws_vpc_endpoint.analysis_s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "analysis_endpoints" {
  security_group_id            = aws_security_group.analysis.id
  description                  = "HTTPS to ECR and Logs interface endpoints (image pull, logs)"
  referenced_security_group_id = aws_security_group.endpoints.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_from_analysis" {
  security_group_id            = aws_security_group.endpoints.id
  description                  = "HTTPS from analysis tasks (image pull and logs only; jobs hold no credentials)"
  referenced_security_group_id = aws_security_group.analysis.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
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
    logConfiguration       = local.log_options["analysis"]
  }
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
    merge(local.analysis_common, {
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
      name       = "analysis"
      essential  = false
      user       = local.analysis_non_root
      entryPoint = ["python3", "-I", "-B", "/job/program"]
      command    = []
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
    merge(local.analysis_common, {
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
        Sid      = "ObserveAnalysis"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks", "ecs:StopTask"]
        Resource = "arn:${local.partition}:ecs:${var.region}:${local.account_id}:task/${aws_ecs_cluster.this.name}/*"
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
        Sid      = "OriginalsAndDescendants"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.evidence.arn}/evidence/*"
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
