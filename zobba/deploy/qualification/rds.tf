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
  }

  tags = { Name = local.name }
}

resource "aws_db_instance" "this" {
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
  final_snapshot_identifier = "${local.name}-final"

  auto_minor_version_upgrade      = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Performance Insights and enhanced monitoring stay off in the smallest cost
  # profile; enabling them is an owner cost decision.
  performance_insights_enabled = false
  monitoring_interval          = 0

  iam_database_authentication_enabled = false

  tags = { Name = local.name }
}
