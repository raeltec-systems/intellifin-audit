terraform {
  # Exact pins: a plan reviewed with one release must apply with the same one.
  required_version = "= 1.16.3"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.65.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "= 3.9.1"
    }
  }

  # Partial configuration. Bucket, key, region, KMS key and `use_lockfile = true`
  # are supplied at `terraform init -backend-config=...` (see ../RUNBOOK.md), so no
  # account-specific value is committed.
  backend "s3" {}
}
