# Each tier gets its own group; rules name the exact peer group and port.

data "aws_ec2_managed_prefix_list" "cloudfront_origin" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Internal ALB: reachable only from CloudFront VPC origin addresses"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${local.name}-alb" }
}

# CloudFront VPC origin ingress (AWS docs, "Restrict access with VPC origins",
# Security Group Configuration). Two documented options:
#   1. the CloudFront origin-facing managed prefix list - usable before the VPC
#      origin exists, so it is what the first apply uses;
#   2. the AWS service-managed group "CloudFront-VPCOrigins-Service-SG", which
#      CloudFront creates in this VPC when the VPC origin is created. It admits
#      only CloudFront VPC-origin traffic and is the stricter rule.
# After the first apply, set restrict_alb_to_vpc_origin_sg = true and apply
# again (RUNBOOK section 3): the prefix-list rule is then replaced by a rule
# referencing the service-managed group. Neither option opens 0.0.0.0/0 or the
# VPC CIDR.

data "aws_security_group" "cloudfront_vpc_origin" {
  count  = var.restrict_alb_to_vpc_origin_sg ? 1 : 0
  vpc_id = aws_vpc.this.id

  filter {
    name   = "group-name"
    values = ["CloudFront-VPCOrigins-Service-SG*"]
  }

  depends_on = [aws_cloudfront_vpc_origin.api]
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_cloudfront" {
  #checkov:skip=CKV_AWS_260:source is the CloudFront origin-facing managed prefix list, not 0.0.0.0/0
  count             = var.restrict_alb_to_vpc_origin_sg ? 0 : 1
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from the CloudFront origin-facing prefix list (VPC origin, first apply)"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_from_vpc_origin_sg" {
  count                        = var.restrict_alb_to_vpc_origin_sg ? 1 : 0
  security_group_id            = aws_security_group.alb.id
  description                  = "HTTP from the CloudFront service-managed VPC origin security group"
  referenced_security_group_id = data.aws_security_group.cloudfront_vpc_origin[0].id
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to API tasks"
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 4310
  to_port                      = 4310
}

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "API tasks"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${local.name}-api" }
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "API port from the internal ALB only"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 4310
  to_port                      = 4310
}

resource "aws_security_group" "worker" {
  name        = "${local.name}-worker"
  description = "Worker tasks: no inbound access"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${local.name}-worker" }
}

resource "aws_security_group" "migration" {
  #checkov:skip=CKV2_AWS_5:attached at run time by the release migration and bootstrap run-task calls (network configuration output)
  name        = "${local.name}-migration"
  description = "One-off release migration and role bootstrap tasks: no inbound access"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${local.name}-migration" }
}

# Outbound HTTPS (AWS endpoints, Cognito, image pulls) and PostgreSQL to the
# database group, for every task group.
resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  for_each = {
    api       = aws_security_group.api.id
    worker    = aws_security_group.worker.id
    migration = aws_security_group.migration.id
  }

  security_group_id = each.value
  description       = "HTTPS egress (VPC endpoints, Cognito, image registry)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "tasks_database" {
  for_each = {
    api       = aws_security_group.api.id
    worker    = aws_security_group.worker.id
    migration = aws_security_group.migration.id
  }

  security_group_id            = each.value
  description                  = "PostgreSQL to the database"
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "RDS PostgreSQL: reachable only from Zobba task groups"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${local.name}-database" }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_tasks" {
  for_each = {
    api       = aws_security_group.api.id
    worker    = aws_security_group.worker.id
    migration = aws_security_group.migration.id
  }

  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from ${each.key} tasks"
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name}-endpoints"
  description = "Interface VPC endpoints: HTTPS from the app subnets"
  vpc_id      = aws_vpc.this.id
  tags        = { Name = "${local.name}-endpoints" }
}

resource "aws_vpc_security_group_ingress_rule" "endpoints_from_app" {
  count             = 2
  security_group_id = aws_security_group.endpoints.id
  description       = "HTTPS from app subnet ${count.index}"
  cidr_ipv4         = aws_subnet.app[count.index].cidr_block
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}
