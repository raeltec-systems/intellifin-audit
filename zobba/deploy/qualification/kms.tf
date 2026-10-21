# One customer-managed key for the environment's data at rest: database,
# database master secret, application secrets, evidence bucket, logs and ECR.
# The key is retained for its full deletion window after a destroy.

resource "aws_kms_key" "this" {
  description             = "${local.name} data at rest"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = jsonencode(local.kms_policy)

  tags = { Name = local.name }
}

resource "aws_kms_alias" "this" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.this.key_id
}

locals {
  kms_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        # Account administration is delegated to IAM; no principal is granted
        # use of the key by the key policy alone.
        Sid       = "AccountAdministration"
        Effect    = "Allow"
        Principal = { AWS = "arn:${local.partition}:iam::${local.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CloudWatchLogs"
        Effect    = "Allow"
        Principal = { Service = "logs.${var.region}.amazonaws.com" }
        Action    = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = [
              "arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:/${local.name}/*",
              "arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:/aws/rds/instance/${local.name}/*",
            ]
          }
        }
      },
    ]
  }
}
