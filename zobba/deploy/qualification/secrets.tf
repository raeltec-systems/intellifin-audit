# Application secrets live only in Secrets Manager, encrypted with the
# environment key. Database passwords are generated ephemerally and written
# with write-only arguments, so they never enter Terraform state or plans.
# Task definitions reference the secret ARNs; values never appear in task
# `environment` or in outputs.

module "database_passwords" {
  source = "./modules/database_passwords"
}

resource "aws_secretsmanager_secret" "migration_database_url" {
  name                    = "${local.name}/database/migrator-url"
  description             = "zobba_migrator connection URL. Release migration and role bootstrap tasks only."
  kms_key_id              = aws_kms_key.this.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "migration_database_url" {
  secret_id                = aws_secretsmanager_secret.migration_database_url.id
  secret_string_wo         = "postgres://zobba_migrator:${module.database_passwords.migrator}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${local.database_name}?sslmode=require&application_name=zobba-migrate"
  secret_string_wo_version = var.database_password_version
}

resource "aws_secretsmanager_secret" "runtime_database_url" {
  name                    = "${local.name}/database/runtime-url"
  description             = "zobba_app connection URL. API and worker tasks, and the role bootstrap task."
  kms_key_id              = aws_kms_key.this.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "runtime_database_url" {
  secret_id                = aws_secretsmanager_secret.runtime_database_url.id
  secret_string_wo         = "postgres://zobba_app:${module.database_passwords.runtime}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${local.database_name}?sslmode=require&application_name=zobba-runtime"
  secret_string_wo_version = var.database_password_version
}

# Cognito generates the client secret; it is copied into Secrets Manager for the
# API task. It exists in (encrypted, access-controlled) remote state because the
# provider reads it back from Cognito; it is never an output.
resource "aws_secretsmanager_secret" "oidc_client_secret" {
  name                    = "${local.name}/oidc/client-secret"
  description             = "Cognito app client secret for the API."
  kms_key_id              = aws_kms_key.this.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "oidc_client_secret" {
  secret_id     = aws_secretsmanager_secret.oidc_client_secret.id
  secret_string = aws_cognito_user_pool_client.this.client_secret
}
