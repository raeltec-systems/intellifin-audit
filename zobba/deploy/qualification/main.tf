provider "aws" {
  region = var.region

  # Every taggable resource carries these tags; resource-level tags add a Name.
  default_tags {
    tags = local.tags
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_availability_zones" "available" {
  #checkov:skip=CKV_AWS_394:only the first two zone names are used (slice), so an added zone cannot change the subnet set
  state = "available"
}

locals {
  name       = "zobba-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  tags = {
    Project     = "zobba"
    Environment = var.environment
    ManagedBy   = "terraform"
    Story       = "20.7"
    Qualified   = "false"
  }

  # Exactly two zones: both API tasks, both database instances and both subnets
  # of every tier are spread across them.
  zones = slice(data.aws_availability_zones.available.names, 0, 2)

  public_origin = var.custom_domain != null ? "https://${var.custom_domain}" : "https://${aws_cloudfront_distribution.this.domain_name}"
  callback_url  = "${local.public_origin}/api/auth/callback"

  oidc_issuer          = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.this.id}"
  authorization_origin = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${var.region}.amazoncognito.com"

  released = var.image_digest != null
  # Before the first release no image exists; services keep 0 tasks and the
  # task definitions name a tag that is never pulled.
  image = local.released ? "${aws_ecr_repository.this.repository_url}@${var.image_digest}" : "${aws_ecr_repository.this.repository_url}:unreleased"

  database_name = "zobba"
}
