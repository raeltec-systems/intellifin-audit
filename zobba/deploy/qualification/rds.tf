resource "aws_db_subnet_group" "this" {
  name       = local.name
  subnet_ids = aws_subnet.db[*].id
  tags       = { Name = local.name }
}

resource "aws_db_parameter_group" "this" {
  name   = "${local.name}-postgres18"
  family = "postgres18"

  # Every connection must use TLS; the application connects with sslmode=require.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
    # Static in PostgreSQL 18: AWS reports pending-reboot. It is in force from
    # creation; declaring the real method stops a change on every plan.
    apply_method = "pending-reboot"
  }

  # Statement text is never logged: the role bootstrap sends
  # ALTER ROLE ... PASSWORD, and a failing statement would otherwise be logged
  # with its text (log_min_error_statement defaults to ERROR).
  parameter {
    name  = "log_statement"
    value = "none"
  }

  parameter {
    name  = "log_min_error_statement"
    value = "panic"
  }

  tags = { Name = local.name }

  depends_on = [aws_cloudwatch_log_group.rds]
}

# RDS exports to these groups; declaring them sets retention and the CMK
# instead of the never-expiring, AWS-key defaults RDS would create.
resource "aws_cloudwatch_log_group" "rds" {
  #checkov:skip=CKV_AWS_338:qualification logs keep log_retention_days (default 30) to bound cost; audit records live in PostgreSQL, not telemetry
  for_each          = toset(["postgresql", "upgrade"])
  name              = "/aws/rds/instance/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.this.arn
}

resource "aws_db_instance" "this" {
  #checkov:skip=CKV_AWS_226:minor versions are pinned (db_engine_version) and upgraded only by a reviewed change (RUNBOOK section 7), so a plan is reproducible
  #checkov:skip=CKV_AWS_353:Performance Insights is outside the smallest cost profile; owner decision
  #checkov:skip=CKV_AWS_118:enhanced monitoring is outside the smallest cost profile; owner decision
  #checkov:skip=CKV_AWS_161:the application authenticates with distinct password roles held in Secrets Manager (zobba/README.md role model)
  identifier     = local.name
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true
  kms_key_id        = aws_kms_key.this.arn

  # The master credential is created and held by RDS in Secrets Manager. It is
  # used only by the one-off role bootstrap task and never by the application.
  username                      = "zobba_admin"
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.this.arn

  # No db_name: the role bootstrap task creates the `zobba` database owned by
  # zobba_migrator, matching the ownership rule in zobba/README.md.
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = var.multi_az
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  backup_retention_period   = var.backup_retention_days
  backup_window             = "02:00-03:00"
  maintenance_window        = "sun:03:30-sun:04:30"
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-final-g${var.deployment_generation}"

  # Minor versions change only through db_engine_version (RUNBOOK section 7).
  auto_minor_version_upgrade      = false
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Performance Insights and enhanced monitoring stay off in the smallest cost
  # profile; enabling them is an owner cost decision.
  performance_insights_enabled = false
  monitoring_interval          = 0

  iam_database_authentication_enabled = false

  tags = { Name = local.name }

  depends_on = [aws_cloudwatch_log_group.rds]
}
