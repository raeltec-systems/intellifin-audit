# Outputs contain identifiers only. No secret value is ever an output; the
# secrets are referenced by ARN.

output "public_origin" {
  description = "The single public origin (web shell and /api)."
  value       = local.public_origin
}

output "oidc_callback_url" {
  description = "The only registered Cognito callback."
  value       = local.callback_url
}

output "cognito_user_pool_id" {
  description = "Cognito user pool for administrator-created users."
  value       = aws_cognito_user_pool.this.id
}

output "cognito_hosted_domain" {
  description = "Cognito hosted sign-in origin."
  value       = local.authorization_origin
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "web_bucket" {
  value = aws_s3_bucket.web.bucket
}

output "evidence_bucket" {
  value = aws_s3_bucket.evidence.bucket
}

output "ecr_repository_url" {
  value = aws_ecr_repository.this.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.this.name
}

output "database_endpoint" {
  description = "Private RDS endpoint (not reachable from outside the VPC)."
  value       = aws_db_instance.this.address
}

output "database_master_secret_arn" {
  description = "ARN of the RDS-managed master secret (used only by the bootstrap task)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "task_network_configuration" {
  description = "awsvpc network configuration JSON for one-off tasks (migration, bootstrap)."
  value = jsonencode({
    awsvpcConfiguration = {
      subnets        = aws_subnet.app[*].id
      securityGroups = [aws_security_group.migration.id]
      assignPublicIp = "DISABLED"
    }
  })
}

output "bootstrap_task_definition" {
  value = aws_ecs_task_definition.bootstrap.family
}

output "release_role_arn" {
  value = aws_iam_role.release.arn
}

# Copy these into the GitHub `qualification` environment as variables
# (not secrets: none of them is secret).
output "github_environment_variables" {
  value = {
    AWS_REGION                 = var.region
    AWS_RELEASE_ROLE_ARN       = aws_iam_role.release.arn
    ECR_REPOSITORY_URL         = aws_ecr_repository.this.repository_url
    ECS_CLUSTER                = aws_ecs_cluster.this.name
    ECS_API_SERVICE            = aws_ecs_service.api.name
    ECS_WORKER_SERVICE         = aws_ecs_service.worker.name
    ECS_API_FAMILY             = aws_ecs_task_definition.api.family
    ECS_WORKER_FAMILY          = aws_ecs_task_definition.worker.family
    ECS_MIGRATION_FAMILY       = aws_ecs_task_definition.migrate.family
    ECS_TASK_NETWORK           = jsonencode({ awsvpcConfiguration = { subnets = aws_subnet.app[*].id, securityGroups = [aws_security_group.migration.id], assignPublicIp = "DISABLED" } })
    WEB_BUCKET                 = aws_s3_bucket.web.bucket
    CLOUDFRONT_DISTRIBUTION_ID = aws_cloudfront_distribution.this.id
  }
}
