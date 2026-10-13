resource "aws_ecs_cluster" "this" {
  #checkov:skip=CKV_AWS_65:Container Insights is a recurring metrics cost outside the smallest profile; owner decision
  name = local.name

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = { Name = local.name }
}

locals {
  bin = "/usr/local/bin"

  log_options = {
    for key in local.log_groups : key => {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this[key].name
        awslogs-region        = var.region
        awslogs-stream-prefix = key
      }
    }
  }

  # Non-secret runtime configuration. Secrets are only ever in `secrets`
  # (Secrets Manager references), never here.
  api_environment = [
    { name = "ZOBBA_API_BIND", value = "0.0.0.0:4310" },
    { name = "ZOBBA_PUBLIC_ORIGIN", value = local.public_origin },
    { name = "ZOBBA_OIDC_ISSUER", value = local.oidc_issuer },
    { name = "ZOBBA_OIDC_CLIENT_ID", value = aws_cognito_user_pool_client.this.id },
    { name = "ZOBBA_OIDC_REDIRECT_URI", value = local.callback_url },
    { name = "ZOBBA_OIDC_AUTHORIZATION_ORIGIN", value = local.authorization_origin },
    { name = "ZOBBA_EVIDENCE_BUCKET", value = aws_s3_bucket.evidence.bucket },
    # Region is fixed explicitly: it is part of the evidence namespace fingerprint.
    { name = "AWS_REGION", value = var.region },
  ]

  api_secrets = [
    { name = "ZOBBA_RUNTIME_DATABASE_URL", valueFrom = aws_secretsmanager_secret.runtime_database_url.arn },
    { name = "ZOBBA_OIDC_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.oidc_client_secret.arn },
  ]

  worker_secrets = [
    { name = "ZOBBA_RUNTIME_DATABASE_URL", valueFrom = aws_secretsmanager_secret.runtime_database_url.arn },
  ]

  migrate_secrets = [
    { name = "ZOBBA_MIGRATION_DATABASE_URL", valueFrom = aws_secretsmanager_secret.migration_database_url.arn },
  ]

  master_secret_arn = aws_db_instance.this.master_user_secret[0].secret_arn

  bootstrap_secrets = [
    { name = "PGUSER", valueFrom = "${local.master_secret_arn}:username::" },
    { name = "PGPASSWORD", valueFrom = "${local.master_secret_arn}:password::" },
    { name = "ZOBBA_MIGRATION_DATABASE_URL", valueFrom = aws_secretsmanager_secret.migration_database_url.arn },
    { name = "ZOBBA_RUNTIME_DATABASE_URL", valueFrom = aws_secretsmanager_secret.runtime_database_url.arn },
  ]

  common_container = {
    essential              = true
    readonlyRootFilesystem = true
    linuxParameters        = { initProcessEnabled = true }
    stopTimeout            = 30
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution["api"].arn
  task_role_arn            = aws_iam_role.api_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([merge(local.common_container, {
    name             = "api"
    image            = local.image
    entryPoint       = ["${local.bin}/zobba-api"]
    command          = []
    portMappings     = [{ containerPort = 4310, protocol = "tcp" }]
    environment      = local.api_environment
    secrets          = local.api_secrets
    logConfiguration = local.log_options["api"]
  })])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution["worker"].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  # The worker is started with no arguments: any argument selects its internal
  # child-executor mode.
  container_definitions = jsonencode([merge(local.common_container, {
    name             = "worker"
    image            = local.image
    entryPoint       = ["${local.bin}/zobba-worker"]
    command          = []
    environment      = []
    secrets          = local.worker_secrets
    logConfiguration = local.log_options["worker"]
  })])
}

# One-off release migration. Only this task definition receives the migrator URL.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution["migrate"].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([merge(local.common_container, {
    name             = "migrate"
    image            = local.image
    entryPoint       = ["${local.bin}/zobba-cli"]
    command          = ["migrate", "--runtime-role", "zobba_app"]
    environment      = []
    secrets          = local.migrate_secrets
    logConfiguration = local.log_options["migrate"]
  })])
}

# One-off role bootstrap, run by an operator from the runbook. Uses the RDS
# managed master secret to create zobba_migrator, zobba_app and the zobba
# database, and to set the role passwords held in the two URL secrets.
resource "aws_ecs_task_definition" "bootstrap" {
  family                   = "${local.name}-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution["bootstrap"].arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([merge(local.common_container, {
    name                   = "bootstrap"
    image                  = var.bootstrap_image
    readonlyRootFilesystem = false
    entryPoint             = ["/bin/sh", "-c"]
    command                = [file("${path.module}/bootstrap-roles.sh")]
    environment = [
      { name = "PGHOST", value = aws_db_instance.this.address },
      { name = "PGPORT", value = tostring(aws_db_instance.this.port) },
      { name = "PGDATABASE", value = "postgres" },
      { name = "PGSSLMODE", value = "require" },
      { name = "ZOBBA_DATABASE_NAME", value = local.database_name },
    ]
    secrets          = local.bootstrap_secrets
    logConfiguration = local.log_options["bootstrap"]
  })])
}

locals {
  private_network = {
    subnets          = aws_subnet.app[*].id
    assign_public_ip = false
  }
}

resource "aws_ecs_service" "api" {
  #checkov:skip=CKV_AWS_332:the Fargate platform version is pinned (1.4.0, the current latest) so a plan is reproducible
  name                              = "${local.name}-api"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = local.released ? var.api_desired_count : 0
  launch_type                       = "FARGATE"
  platform_version                  = "1.4.0"
  availability_zone_rebalancing     = "ENABLED"
  health_check_grace_period_seconds = 60
  propagate_tags                    = "SERVICE"
  enable_execute_command            = false

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = local.private_network.subnets
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = local.private_network.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 4310
  }

  # Releases register new task definition revisions (new image digest) and
  # update the service; Terraform owns the infrastructure, not the release.
  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "worker" {
  #checkov:skip=CKV_AWS_332:the Fargate platform version is pinned (1.4.0, the current latest) so a plan is reproducible
  name                          = "${local.name}-worker"
  cluster                       = aws_ecs_cluster.this.id
  task_definition               = aws_ecs_task_definition.worker.arn
  desired_count                 = local.released ? var.worker_desired_count : 0
  launch_type                   = "FARGATE"
  platform_version              = "1.4.0"
  availability_zone_rebalancing = "ENABLED"
  propagate_tags                = "SERVICE"
  enable_execute_command        = false

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = local.private_network.subnets
    security_groups  = [aws_security_group.worker.id]
    assign_public_ip = local.private_network.assign_public_ip
  }

  lifecycle {
    ignore_changes = [task_definition]
  }
}
