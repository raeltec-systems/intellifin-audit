# Required values default to null and are enforced by validation, so a missing
# value fails before any plan with a message that names the variable.

variable "region" {
  description = "AWS region for the whole qualification environment. No default: the owner chooses it (cost and data location)."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.region != null && can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", var.region))
    error_message = "region is required and must be an AWS region name such as eu-west-1."
  }
}

variable "budget_monthly_limit_usd" {
  description = "Owner-approved monthly spend limit in USD for the AWS Budget alert."
  type        = number
  default     = null
  nullable    = true

  validation {
    condition     = var.budget_monthly_limit_usd != null && try(var.budget_monthly_limit_usd > 0, false)
    error_message = "budget_monthly_limit_usd is required and must be greater than 0 (the owner-approved monthly limit)."
  }
}

variable "budget_alert_email" {
  description = "Email address that receives the budget alerts."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.budget_alert_email != null && can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email is required and must be an email address."
  }
}

variable "github_repository" {
  description = "GitHub repository (owner/name) whose `qualification` environment may assume the release role."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.github_repository != null && can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository is required in owner/name form."
  }
}

variable "create_github_oidc_provider" {
  description = "Create the account's GitHub OIDC provider. Set false when the account already has one."
  type        = bool
  default     = true
}

variable "environment" {
  description = "Environment name used in resource names and tags."
  type        = string
  default     = "qualification"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.environment))
    error_message = "environment must be 2-21 lowercase letters, digits or hyphens."
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the isolated VPC."
  type        = string
  default     = "10.40.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr)) && tonumber(split("/", var.vpc_cidr)[1]) <= 20
    error_message = "vpc_cidr must be a valid IPv4 CIDR of /20 or larger."
  }
}

variable "nat_gateway_count" {
  description = "NAT gateways. 1 is the smallest cost profile (one zone's NAT is a shared egress dependency); 2 removes that dependency at extra cost."
  type        = number
  default     = 1

  validation {
    condition     = contains([1, 2], var.nat_gateway_count)
    error_message = "nat_gateway_count must be 1 or 2."
  }
}

variable "multi_az" {
  description = "RDS Multi-AZ. Must stay true: the qualification environment proves zone failure behaviour."
  type        = bool
  default     = true

  validation {
    condition     = var.multi_az == true
    error_message = "multi_az must be true: the qualification database is Multi-AZ by rule."
  }
}

variable "backup_retention_days" {
  description = "RDS automated backup retention (point-in-time recovery window), in days."
  type        = number
  default     = 7

  validation {
    condition     = var.backup_retention_days >= 7 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be at least 7 (rule: backups >= 7 days with PITR) and at most 35."
  }
}

variable "api_desired_count" {
  description = "API task count. At least 2 so both zones serve."
  type        = number
  default     = 2

  validation {
    condition     = var.api_desired_count >= 2 && floor(var.api_desired_count) == var.api_desired_count
    error_message = "api_desired_count must be a whole number of at least 2 (rule: >= 2 API tasks across both zones)."
  }
}

variable "worker_desired_count" {
  description = "Worker task count."
  type        = number
  default     = 1

  validation {
    condition     = var.worker_desired_count >= 1 && floor(var.worker_desired_count) == var.worker_desired_count
    error_message = "worker_desired_count must be a whole number of at least 1."
  }
}

variable "db_instance_class" {
  description = "RDS instance class. The default is the smallest Multi-AZ-capable class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "RDS PostgreSQL engine version. Major version 18 is required."
  type        = string
  default     = "18"

  validation {
    condition     = can(regex("^18(\\.[0-9]+)?$", var.db_engine_version))
    error_message = "db_engine_version must be PostgreSQL 18 (for example 18 or 18.4)."
  }
}

variable "db_allocated_storage_gb" {
  description = "RDS allocated storage in GiB (gp3)."
  type        = number
  default     = 20

  validation {
    condition     = var.db_allocated_storage_gb >= 20
    error_message = "db_allocated_storage_gb must be at least 20."
  }
}

variable "database_password_version" {
  description = "Increase to generate new database role passwords (then rerun the role bootstrap task). Passwords are write-only and never stored in state."
  type        = number
  default     = 1

  validation {
    condition     = var.database_password_version >= 1 && floor(var.database_password_version) == var.database_password_version
    error_message = "database_password_version must be a whole number of at least 1."
  }
}

variable "task_cpu" {
  description = "Fargate CPU units per task."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate memory (MiB) per task."
  type        = number
  default     = 512
}

variable "image_digest" {
  description = "sha256 digest of the released image in this environment's ECR repository. Null until the first release: services then run 0 tasks."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.image_digest == null || can(regex("^sha256:[0-9a-f]{64}$", var.image_digest))
    error_message = "image_digest must be null or sha256:<64 hex characters>."
  }
}

variable "bootstrap_image" {
  description = "Pinned PostgreSQL client image used only by the one-off role bootstrap task."
  type        = string
  default     = "public.ecr.aws/docker/library/postgres:18.4-trixie@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636"

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.bootstrap_image))
    error_message = "bootstrap_image must be pinned by digest (@sha256:...)."
  }
}

variable "custom_domain" {
  description = "Optional custom public domain (for example zobba.example.com). Null uses the CloudFront domain as the public origin."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.custom_domain == null || can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,}$", var.custom_domain))
    error_message = "custom_domain must be null or a lowercase DNS name."
  }
}

variable "custom_domain_certificate_arn" {
  description = "ACM certificate ARN in us-east-1 for custom_domain. Required exactly when custom_domain is set."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.custom_domain_certificate_arn == null || can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/", var.custom_domain_certificate_arn))
    error_message = "custom_domain_certificate_arn must be null or an ACM certificate ARN in us-east-1 (CloudFront requirement)."
  }

  validation {
    condition     = (var.custom_domain == null) == (var.custom_domain_certificate_arn == null)
    error_message = "custom_domain and custom_domain_certificate_arn must be set together."
  }
}

variable "cognito_domain_prefix" {
  description = "Cognito hosted domain prefix (globally unique in the region). Null derives zobba-<environment>-<account id>."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.cognito_domain_prefix == null || can(regex("^[a-z0-9](-?[a-z0-9])*$", var.cognito_domain_prefix))
    error_message = "cognito_domain_prefix must be null or lowercase letters, digits and single hyphens."
  }
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 30

  validation {
    condition     = contains([7, 14, 30, 60, 90, 180, 365], var.log_retention_days)
    error_message = "log_retention_days must be one of 7, 14, 30, 60, 90, 180 or 365."
  }
}
