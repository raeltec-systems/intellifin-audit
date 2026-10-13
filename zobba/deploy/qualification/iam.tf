# Least privilege per task. Each task has its own execution role, which is the
# only identity that can read that task's secrets, so a runtime task can never
# fetch the migrator URL or the RDS master secret. Only the API has a task role
# (evidence S3); the worker, migration and bootstrap tasks get no AWS
# credentials at all.

locals {
  ecs_assume_role = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account_id }
      }
    }]
  })

  # Secrets each task may receive. Keys are task names; values are ARNs.
  task_secret_arns = {
    api       = [aws_secretsmanager_secret.runtime_database_url.arn, aws_secretsmanager_secret.oidc_client_secret.arn]
    worker    = [aws_secretsmanager_secret.runtime_database_url.arn]
    migrate   = [aws_secretsmanager_secret.migration_database_url.arn]
    bootstrap = [aws_db_instance.this.master_user_secret[0].secret_arn, aws_secretsmanager_secret.migration_database_url.arn, aws_secretsmanager_secret.runtime_database_url.arn]
  }
}

locals {
  ecr_pull_statements = [
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
      Resource = aws_ecr_repository.this.arn
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
}

resource "aws_iam_role" "execution" {
  for_each           = local.task_secret_arns
  name               = "${local.name}-${each.key}-execution"
  assume_role_policy = local.ecs_assume_role
}

resource "aws_iam_role_policy" "execution" {
  for_each = local.task_secret_arns
  name     = "execution"
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        {
          Sid      = "Logs"
          Effect   = "Allow"
          Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
          Resource = "${aws_cloudwatch_log_group.this[each.key].arn}:*"
        },
        {
          Sid      = "Secrets"
          Effect   = "Allow"
          Action   = "secretsmanager:GetSecretValue"
          Resource = each.value
        },
        {
          Sid      = "DecryptSecrets"
          Effect   = "Allow"
          Action   = "kms:Decrypt"
          Resource = aws_kms_key.this.arn
          Condition = {
            StringEquals = { "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com" }
          }
        },
      ],
      # The bootstrap task uses a public PostgreSQL client image; the others pull
      # the Zobba image from this environment's repository only.
      slice(local.ecr_pull_statements, 0, each.key == "bootstrap" ? 0 : length(local.ecr_pull_statements)),
    )
  })
}

resource "aws_iam_role" "api_task" {
  name               = "${local.name}-api-task"
  assume_role_policy = local.ecs_assume_role
}

# Exactly the S3 actions zobba/README.md documents, plus the KMS use that
# SSE-KMS requires for those actions.
resource "aws_iam_role_policy" "api_task" {
  name = "evidence"
  role = aws_iam_role.api_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PutOriginals"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.evidence.arn}/evidence/*"
      },
      {
        Sid      = "ReadOriginals"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
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
        Sid      = "EvidenceKey"
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

resource "aws_iam_role" "flow_logs" {
  name = "${local.name}-flow-logs"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "vpc-flow-logs.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "flow_logs" {
  name = "flow-logs"
  role = aws_iam_role.flow_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
      Resource = "${local.flow_log_group_arn}:*"
    }]
  })
}

# Release: GitHub Actions in the `qualification` environment of one repository
# assumes this role through OIDC. No long-lived AWS keys exist.

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  github_oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:${local.partition}:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com"
  release_subject          = "repo:${coalesce(var.github_repository, "unset/unset")}:environment:qualification"
}

resource "aws_iam_role" "release" {
  name                 = "${local.name}-release"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = local.release_subject
        }
      }
    }]
  })
}

locals {
  release_task_families = ["api", "worker", "migrate"]
}

resource "aws_iam_role_policy" "release" {
  name = "release"
  role = aws_iam_role.release.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
          "ecr:DescribeImages", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload",
          "ecr:PutImage", "ecr:UploadLayerPart",
        ]
        Resource = aws_ecr_repository.this.arn
      },
      {
        Sid      = "EcrKey"
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.this.arn
        Condition = {
          StringEquals = { "kms:ViaService" = "ecr.${var.region}.amazonaws.com" }
        }
      },
      {
        # These ECS actions do not support resource-level scoping. PassRole
        # below limits which roles a registered revision can carry, but cannot
        # bind a role to a family (RUNBOOK "Release" residual risk).
        Sid      = "TaskDefinitions"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition", "ecs:RegisterTaskDefinition", "ecs:ListTaskDefinitions"]
        Resource = "*"
      },
      {
        Sid      = "TagReleaseRevisions"
        Effect   = "Allow"
        Action   = "ecs:TagResource"
        Resource = [for family in local.release_task_families : "arn:${local.partition}:ecs:${var.region}:${local.account_id}:task-definition/${local.name}-${family}:*"]
        Condition = {
          StringEquals = { "ecs:CreateAction" = "RegisterTaskDefinition" }
        }
      },
      {
        Sid      = "FindRunningMigrations"
        Effect   = "Allow"
        Action   = "ecs:ListTasks"
        Resource = "*"
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.this.arn }
        }
      },
      {
        # Only the release migration task can be run; never the role bootstrap.
        Sid      = "RunMigration"
        Effect   = "Allow"
        Action   = "ecs:RunTask"
        Resource = "arn:${local.partition}:ecs:${var.region}:${local.account_id}:task-definition/${local.name}-migrate:*"
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.this.arn }
        }
      },
      {
        Sid      = "ObserveMigration"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks", "ecs:StopTask"]
        Resource = "arn:${local.partition}:ecs:${var.region}:${local.account_id}:task/${aws_ecs_cluster.this.name}/*"
      },
      {
        Sid      = "DeployServices"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = [aws_ecs_service.api.id, aws_ecs_service.worker.id]
      },
      {
        Sid    = "PassTaskRoles"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = concat(
          [for family in local.release_task_families : aws_iam_role.execution[family].arn],
          [aws_iam_role.api_task.arn],
        )
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      {
        Sid      = "WebList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.web.arn
      },
      {
        Sid      = "WebSync"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.web.arn}/*"
      },
      {
        Sid      = "Invalidate"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = aws_cloudfront_distribution.this.arn
      },
    ]
  })
}
