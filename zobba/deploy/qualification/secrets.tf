# Application secrets live only in Secrets Manager, encrypted with the
# environment key. Database passwords are generated ephemerally and written
# with write-only arguments, so they never enter Terraform state or plans.
# Task definitions reference the secret ARNs; values never appear in task
# `environment` or in outputs.

module "database_passwords" {
  source = "./modules/database_passwords"
}

locals {
  # Write-only values are rewritten only when their version changes. The
  # version folds in the password version and a hash of the database endpoint,
  # so a new RDS address or port rewrites both URLs (with new passwords). Any
  # rewrite requires rerunning the role bootstrap (RUNBOOK section 4).
  database_endpoint_hash = parseint(substr(sha256("${aws_db_instance.this.address}:${aws_db_instance.this.port}"), 0, 7), 16)
  database_url_version   = var.database_password_version * 268435456 + local.database_endpoint_hash
}

resource "aws_secretsmanager_secret" "migration_database_url" {
  #checkov:skip=CKV2_AWS_57:rotation is operator-driven (database_password_version + role bootstrap, RUNBOOK); automatic rotation needs a Lambda rotator not in 20.7a
  name                    = "${local.name}/database/migrator-url"
  description             = "zobba_migrator connection URL. Release migration and role bootstrap tasks only."
  kms_key_id              = aws_kms_key.this.arn
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "migration_database_url" {
  secret_id                = aws_secretsmanager_secret.migration_database_url.id
  secret_string_wo         = "postgres://zobba_migrator:${module.database_passwords.migrator}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${local.database_name}?sslmode=require&application_name=zobba-migrate"
  secret_string_wo_version = local.database_url_version
}

resource "aws_secretsmanager_secret" "runtime_database_url" {
  #checkov:skip=CKV2_AWS_57:rotation is operator-driven (database_password_version + role bootstrap, RUNBOOK); automatic rotation needs a Lambda rotator not in 20.7a
  name                    = "${local.name}/database/runtime-url"
  description             = "zobba_app connection URL. API and worker tasks, and the role bootstrap task."
  kms_key_id              = aws_kms_key.this.arn
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "runtime_database_url" {
  secret_id                = aws_secretsmanager_secret.runtime_database_url.id
  secret_string_wo         = "postgres://zobba_app:${module.database_passwords.runtime}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${local.database_name}?sslmode=require&application_name=zobba-runtime"
  secret_string_wo_version = local.database_url_version
}

# Cognito generates the client secret; it is copied into Secrets Manager for the
# API task. It exists in (encrypted, access-controlled) remote state because the
# provider reads it back from Cognito; it is never an output.
resource "aws_secretsmanager_secret" "oidc_client_secret" {
  #checkov:skip=CKV2_AWS_57:rotation is operator-driven (database_password_version + role bootstrap, RUNBOOK); automatic rotation needs a Lambda rotator not in 20.7a
  name                    = "${local.name}/oidc/client-secret"
  description             = "Cognito app client secret for the API."
  kms_key_id              = aws_kms_key.this.arn
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "oidc_client_secret" {
  secret_id     = aws_secretsmanager_secret.oidc_client_secret.id
  secret_string = aws_cognito_user_pool_client.this.client_secret
}
