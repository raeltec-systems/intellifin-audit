# Generates the two database role passwords as ephemeral values. They are
# consumed only by write-only Secrets Manager arguments, so they never enter
# Terraform state or plan files. Alphanumeric only, so they can appear in a
# PostgreSQL URL without percent-encoding. The random provider runs locally
# and makes no network call.

terraform {
  required_providers {
    random = {
      source = "hashicorp/random"
    }
  }
}

ephemeral "random_password" "migrator" {
  length  = 40
  special = false
}

ephemeral "random_password" "runtime" {
  length  = 40
  special = false
}

output "migrator" {
  value     = ephemeral.random_password.migrator.result
  ephemeral = true
  sensitive = true
}

output "runtime" {
  value     = ephemeral.random_password.runtime.result
  ephemeral = true
  sensitive = true
}
