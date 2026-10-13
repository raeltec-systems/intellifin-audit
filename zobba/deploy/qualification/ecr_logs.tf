resource "aws_ecr_repository" "this" {
  name                 = local.name
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.this.arn
  }

  tags = { Name = local.name }
}

# Keep the most recent releases; deployed task definitions name digests, so
# keep enough history for a rollback to a recent release.
resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 30 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 30
      }
      action = { type = "expire" }
    }]
  })
}

locals {
  log_groups = toset(["api", "worker", "migrate", "bootstrap", "vpc-flow"])
}

resource "aws_cloudwatch_log_group" "this" {
  #checkov:skip=CKV_AWS_338:qualification logs keep log_retention_days (default 30) to bound cost; audit records live in PostgreSQL, not telemetry
  for_each          = local.log_groups
  name              = "/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.this.arn
}

# Readable alias for the flow log destination.
locals {
  flow_log_group_arn = aws_cloudwatch_log_group.this["vpc-flow"].arn
}
