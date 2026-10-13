# Offline proof of the environment's invariants. The AWS provider is mocked:
# no credentials are read and no AWS API is called. `apply` against mocks
# resolves every value so task definitions and policies can be inspected.

mock_provider "aws" {
  source = "./tests/mocks"
}

# Distinct identifiers for the values the secret-separation assertions compare.
override_resource {
  target = aws_secretsmanager_secret.migration_database_url
  values = { arn = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:zobba-qualification/database/migrator-url-MIGRAT" }
}

override_resource {
  target = aws_secretsmanager_secret.runtime_database_url
  values = { arn = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:zobba-qualification/database/runtime-url-RUNTIM" }
}

override_resource {
  target = aws_secretsmanager_secret.oidc_client_secret
  values = { arn = "arn:aws:secretsmanager:eu-west-1:123456789012:secret:zobba-qualification/oidc/client-secret-OIDCCS" }
}

override_resource {
  target = aws_iam_role.api_task
  values = { arn = "arn:aws:iam::123456789012:role/zobba-qualification-api-task" }
}

override_resource {
  target = aws_s3_bucket.evidence
  values = { arn = "arn:aws:s3:::zobba-qualification-evidence-123456789012", bucket = "zobba-qualification-evidence-123456789012" }
}

override_resource {
  target = aws_s3_bucket.web
  values = { arn = "arn:aws:s3:::zobba-qualification-web-123456789012", bucket = "zobba-qualification-web-123456789012" }
}

override_resource {
  target = aws_iam_role.execution["api"]
  values = { arn = "arn:aws:iam::123456789012:role/zobba-qualification-api-execution", id = "zobba-qualification-api-execution" }
}

override_resource {
  target = aws_iam_role.execution["worker"]
  values = { arn = "arn:aws:iam::123456789012:role/zobba-qualification-worker-execution", id = "zobba-qualification-worker-execution" }
}

override_resource {
  target = aws_iam_role.execution["migrate"]
  values = { arn = "arn:aws:iam::123456789012:role/zobba-qualification-migrate-execution", id = "zobba-qualification-migrate-execution" }
}

override_resource {
  target = aws_iam_role.execution["bootstrap"]
  values = { arn = "arn:aws:iam::123456789012:role/zobba-qualification-bootstrap-execution", id = "zobba-qualification-bootstrap-execution" }
}

override_resource {
  target = aws_iam_role.release
  values = { arn = "arn:aws:iam::123456789012:role/zobba-qualification-release", id = "zobba-qualification-release" }
}

override_resource {
  target = aws_iam_role.flow_logs
  values = { arn = "arn:aws:iam::123456789012:role/zobba-qualification-flow-logs", id = "zobba-qualification-flow-logs" }
}

override_resource {
  target = aws_cloudwatch_log_group.this["api"]
  values = { arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/zobba-qualification/api", name = "/zobba-qualification/api" }
}

override_resource {
  target = aws_cloudwatch_log_group.this["worker"]
  values = { arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/zobba-qualification/worker", name = "/zobba-qualification/worker" }
}

override_resource {
  target = aws_cloudwatch_log_group.this["migrate"]
  values = { arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/zobba-qualification/migrate", name = "/zobba-qualification/migrate" }
}

override_resource {
  target = aws_cloudwatch_log_group.this["bootstrap"]
  values = { arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/zobba-qualification/bootstrap", name = "/zobba-qualification/bootstrap" }
}

override_resource {
  target = aws_cloudwatch_log_group.this["vpc-flow"]
  values = { arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/zobba-qualification/vpc-flow", name = "/zobba-qualification/vpc-flow" }
}

override_resource {
  target = aws_cloudwatch_log_group.rds["postgresql"]
  values = { arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/aws/rds/instance/zobba-qualification/postgresql", name = "/aws/rds/instance/zobba-qualification/postgresql" }
}

override_resource {
  target = aws_cloudwatch_log_group.rds["upgrade"]
  values = { arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/aws/rds/instance/zobba-qualification/upgrade", name = "/aws/rds/instance/zobba-qualification/upgrade" }
}

override_resource {
  target = aws_cloudwatch_log_group.this["analysis"]
  values = { arn = "arn:aws:logs:eu-west-1:123456789012:log-group:/zobba-qualification/analysis", name = "/zobba-qualification/analysis" }
}

override_resource {
  target = aws_iam_role.worker_task
  values = { arn = "arn:aws:iam::123456789012:role/zobba-qualification-worker-task", id = "zobba-qualification-worker-task" }
}

override_resource {
  target = aws_iam_role.analysis_execution
  values = { arn = "arn:aws:iam::123456789012:role/zobba-qualification-analysis-execution", id = "zobba-qualification-analysis-execution" }
}

override_resource {
  target = aws_s3_bucket.analysis_staging
  values = { arn = "arn:aws:s3:::zobba-qualification-analysis-123456789012", bucket = "zobba-qualification-analysis-123456789012" }
}

override_resource {
  target = aws_ecr_repository.analysis
  values = { arn = "arn:aws:ecr:eu-west-1:123456789012:repository/zobba-qualification-analysis", repository_url = "123456789012.dkr.ecr.eu-west-1.amazonaws.com/zobba-qualification-analysis" }
}

override_resource {
  target = aws_ecs_cluster.this
  values = { arn = "arn:aws:ecs:eu-west-1:123456789012:cluster/zobba-qualification", name = "zobba-qualification" }
}

override_resource {
  target = aws_route_table.analysis
  values = { id = "rtb-analysis00000001" }
}

override_resource {
  target = aws_vpc.analysis
  values = { id = "vpc-analysis00000001" }
}

override_resource {
  target = aws_security_group.analysis
  values = { id = "sg-analysis000000001" }
}

override_resource {
  target = aws_security_group.analysis_endpoints
  values = { id = "sg-analysisendpoints1" }
}

override_resource {
  target = aws_vpc_endpoint.analysis_s3
  values = { prefix_list_id = "pl-6da54004" }
}

override_resource {
  target = aws_route_table.db
  values = { id = "rtb-db000000000000001" }
}

override_resource {
  target = aws_route_table.public
  values = { id = "rtb-public0000000001" }
}

variables {
  region                   = "eu-west-1"
  budget_monthly_limit_usd = 150
  budget_alert_email       = "owner@example.com"
  github_repository        = "example/intellifin-audit"
  image_digest             = "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}

run "network_is_private_and_two_zone" {
  command = apply

  assert {
    condition     = length(distinct(aws_subnet.app[*].availability_zone)) == 2 && length(distinct(aws_subnet.db[*].availability_zone)) == 2
    error_message = "app and database subnets must span exactly two zones"
  }

  assert {
    condition     = alltrue([for s in concat(aws_subnet.app, aws_subnet.db, aws_subnet.public) : s.map_public_ip_on_launch == false])
    error_message = "no subnet may assign public IPs"
  }

  assert {
    condition     = alltrue([for s in [aws_ecs_service.api, aws_ecs_service.worker] : s.network_configuration[0].assign_public_ip == false && toset(s.network_configuration[0].subnets) == toset(aws_subnet.app[*].id)])
    error_message = "services must run in the private app subnets with no public IP"
  }

  assert {
    condition     = length(aws_route.app_egress) == 2 && length(aws_nat_gateway.this) == 1
    error_message = "default profile is one NAT gateway serving both app route tables"
  }

  assert {
    condition     = toset(keys(aws_vpc_endpoint.interface)) == toset(["ecr.api", "ecr.dkr", "secretsmanager", "logs"]) && aws_vpc_endpoint.s3.vpc_endpoint_type == "Gateway"
    error_message = "VPC endpoints for S3, ECR, Secrets Manager and Logs are required"
  }

  assert {
    condition = (
      length(aws_route_table.db.route) == 0 &&
      aws_route.public_internet.route_table_id != aws_route_table.db.id &&
      alltrue([for r in aws_route.app_egress : r.route_table_id != aws_route_table.db.id]) &&
      alltrue([for a in aws_route_table_association.db : a.route_table_id == aws_route_table.db.id])
    )
    error_message = "database subnets must have no route out of the VPC"
  }
}

run "api_is_internal_behind_cloudfront" {
  command = apply

  assert {
    condition     = aws_lb.api.internal == true && toset(aws_lb.api.subnets) == toset(aws_subnet.app[*].id)
    error_message = "the ALB must be internal, in the private app subnets"
  }

  assert {
    condition = (
      length(aws_vpc_security_group_ingress_rule.alb_from_cloudfront) == 1 &&
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront[0].prefix_list_id == data.aws_ec2_managed_prefix_list.cloudfront_origin.id &&
      aws_vpc_security_group_ingress_rule.alb_from_cloudfront[0].cidr_ipv4 == null &&
      length(aws_vpc_security_group_ingress_rule.alb_from_vpc_origin_sg) == 0
    )
    error_message = "first apply: ALB ingress only from the CloudFront origin-facing prefix list"
  }

  assert {
    condition     = aws_ecs_service.api.desired_count >= 2 && aws_ecs_service.api.availability_zone_rebalancing == "ENABLED"
    error_message = "at least two API tasks, rebalanced across both zones"
  }

  assert {
    condition = anytrue([
      for o in aws_cloudfront_distribution.this.origin :
      o.origin_id == "api" && length(o.vpc_origin_config) == 1 && o.vpc_origin_config[0].vpc_origin_id == aws_cloudfront_vpc_origin.api.id
    ])
    error_message = "the api origin must be the CloudFront VPC origin"
  }

  assert {
    condition     = aws_cloudfront_vpc_origin.api.vpc_origin_endpoint_config[0].arn == aws_lb.api.arn
    error_message = "the VPC origin must point at the internal ALB"
  }

  assert {
    condition = (
      aws_cloudfront_distribution.this.ordered_cache_behavior[0].path_pattern == "/api/*" &&
      aws_cloudfront_distribution.this.ordered_cache_behavior[0].target_origin_id == "api" &&
      aws_cloudfront_distribution.this.ordered_cache_behavior[0].cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" &&
      one(aws_cloudfront_distribution.this.ordered_cache_behavior[0].function_association).function_arn == aws_cloudfront_function.strip_api_prefix.arn
    )
    error_message = "/api/* must reach the API uncached through the prefix-stripping function"
  }

  assert {
    condition     = strcontains(aws_cloudfront_function.strip_api_prefix.code, "request.uri.indexOf('/api/') === 0") && strcontains(aws_cloudfront_function.strip_api_prefix.code, "substring(4)")
    error_message = "the function must remove exactly the /api prefix"
  }

  assert {
    condition = anytrue([
      for o in aws_cloudfront_distribution.this.origin :
      o.origin_id == "web" && o.origin_access_control_id == aws_cloudfront_origin_access_control.web.id
    ]) && aws_cloudfront_distribution.this.default_cache_behavior[0].target_origin_id == "web"
    error_message = "the web shell must be served from the private bucket through OAC"
  }

  assert {
    condition     = output.public_origin == "https://d111111abcdef8.cloudfront.net"
    error_message = "without a custom domain the public origin is the CloudFront domain"
  }
}

run "database_is_multi_az_encrypted_and_retained" {
  command = apply

  assert {
    condition = (
      aws_db_instance.this.engine == "postgres" &&
      startswith(aws_db_instance.this.engine_version, "18") &&
      aws_db_instance.this.multi_az == true &&
      aws_db_instance.this.storage_encrypted == true &&
      aws_db_instance.this.kms_key_id == aws_kms_key.this.arn &&
      aws_db_instance.this.publicly_accessible == false
    )
    error_message = "RDS must be PostgreSQL 18, Multi-AZ, encrypted with the CMK and private"
  }

  assert {
    condition = (
      aws_db_instance.this.backup_retention_period >= 7 &&
      aws_db_instance.this.deletion_protection == true &&
      aws_db_instance.this.skip_final_snapshot == false &&
      aws_db_instance.this.final_snapshot_identifier != null &&
      aws_db_instance.this.delete_automated_backups == false
    )
    error_message = "backups >= 7 days, deletion protection and a final snapshot are required"
  }

  assert {
    condition     = anytrue([for p in aws_db_parameter_group.this.parameter : p.name == "rds.force_ssl" && p.value == "1"])
    error_message = "rds.force_ssl must be 1"
  }

  assert {
    condition = (
      anytrue([for p in aws_db_parameter_group.this.parameter : p.name == "log_statement" && p.value == "none"]) &&
      anytrue([for p in aws_db_parameter_group.this.parameter : p.name == "log_min_error_statement" && p.value == "panic"])
    )
    error_message = "statement text (including ALTER ROLE ... PASSWORD) must never be logged"
  }

  assert {
    condition     = aws_db_instance.this.engine_version == "18.6" && aws_db_instance.this.auto_minor_version_upgrade == false
    error_message = "an exact PostgreSQL 18 minor, upgraded only explicitly"
  }

  assert {
    condition     = aws_db_instance.this.final_snapshot_identifier == "zobba-qualification-final-g1"
    error_message = "the final snapshot name carries the deployment generation"
  }

  assert {
    condition = alltrue([
      for k in ["postgresql", "upgrade"] :
      aws_cloudwatch_log_group.rds[k].name == "/aws/rds/instance/${aws_db_instance.this.identifier}/${k}" &&
      aws_cloudwatch_log_group.rds[k].kms_key_id == aws_kms_key.this.arn &&
      aws_cloudwatch_log_group.rds[k].retention_in_days == 30
    ]) && toset(aws_db_instance.this.enabled_cloudwatch_logs_exports) == toset(["postgresql", "upgrade"])
    error_message = "RDS log groups are declared with retention and the CMK"
  }

  assert {
    condition     = aws_db_instance.this.manage_master_user_password == true && aws_db_instance.this.password == null
    error_message = "the master password must be RDS-managed in Secrets Manager"
  }

  assert {
    condition     = aws_kms_key.this.enable_key_rotation == true
    error_message = "the customer-managed key must rotate"
  }
}

run "evidence_bucket_is_versioned_kms_private_and_tls_only" {
  command = apply

  assert {
    condition     = aws_s3_bucket_versioning.evidence.versioning_configuration[0].status == "Enabled"
    error_message = "evidence versioning is required by the application"
  }

  assert {
    condition = (
      one(aws_s3_bucket_server_side_encryption_configuration.evidence.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "aws:kms" &&
      one(aws_s3_bucket_server_side_encryption_configuration.evidence.rule).apply_server_side_encryption_by_default[0].kms_master_key_id == aws_kms_key.this.arn
    )
    error_message = "evidence must be SSE-KMS with the customer-managed key"
  }

  assert {
    condition = alltrue([
      for b in [aws_s3_bucket_public_access_block.evidence, aws_s3_bucket_public_access_block.web] :
      b.block_public_acls && b.block_public_policy && b.ignore_public_acls && b.restrict_public_buckets
    ])
    error_message = "public access must be blocked on both buckets"
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_s3_bucket_policy.evidence.policy).Statement :
      s.Effect == "Deny" && s.Action == "s3:*" && s.Condition.Bool["aws:SecureTransport"] == "false"
    ])
    error_message = "the evidence bucket must refuse non-TLS requests"
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_s3_bucket_policy.web.policy).Statement :
      s.Effect == "Deny" || (s.Principal == { Service = "cloudfront.amazonaws.com" } && s.Condition.StringEquals["AWS:SourceArn"] == aws_cloudfront_distribution.this.arn)
    ])
    error_message = "only this distribution may read the web bucket"
  }

  assert {
    condition     = aws_s3_bucket.evidence.force_destroy == false && aws_s3_bucket.web.force_destroy == false
    error_message = "buckets must not be force-destroyed"
  }
}

run "task_definitions_keep_secrets_out_of_environment" {
  command = apply

  # Every container's `environment` holds only non-secret names and values.
  assert {
    condition = alltrue(flatten([
      for td in [aws_ecs_task_definition.api, aws_ecs_task_definition.worker, aws_ecs_task_definition.migrate, aws_ecs_task_definition.bootstrap, aws_ecs_task_definition.analysis] : [
        for c in jsondecode(td.container_definitions) : [
          for e in c.environment :
          length(regexall("(?i)(DATABASE_URL|SECRET|PASSWORD|PGPASS|TOKEN|KEY)", e.name)) == 0 &&
          !strcontains(e.value, "postgres://") &&
          !strcontains(e.value, "mock-client-secret-value")
        ]
      ]
    ]))
    error_message = "no secret may appear in a task definition environment"
  }

  assert {
    condition = (
      toset([for s in jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets : s.valueFrom]) ==
      toset([aws_secretsmanager_secret.runtime_database_url.arn, aws_secretsmanager_secret.oidc_client_secret.arn]) &&
      toset([for s in jsondecode(aws_ecs_task_definition.worker.container_definitions)[0].secrets : s.valueFrom]) ==
      toset([aws_secretsmanager_secret.runtime_database_url.arn])
    )
    error_message = "runtime tasks receive only the runtime URL (and the API its OIDC client secret)"
  }

  assert {
    condition = alltrue([
      for td in [aws_ecs_task_definition.api, aws_ecs_task_definition.worker] :
      !strcontains(td.container_definitions, aws_secretsmanager_secret.migration_database_url.arn) &&
      !strcontains(td.container_definitions, "ZOBBA_MIGRATION_DATABASE_URL") &&
      !strcontains(td.container_definitions, aws_db_instance.this.master_user_secret[0].secret_arn)
    ])
    error_message = "runtime tasks must never receive the migrator URL or master secret"
  }

  assert {
    condition = alltrue([
      for key in ["api", "worker"] :
      !strcontains(aws_iam_role_policy.execution[key].policy, aws_secretsmanager_secret.migration_database_url.arn) &&
      !strcontains(aws_iam_role_policy.execution[key].policy, aws_db_instance.this.master_user_secret[0].secret_arn)
    ])
    error_message = "runtime execution roles must not be able to read the migrator URL or master secret"
  }

  assert {
    condition = (
      [for s in jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].secrets : s] ==
      [{ name = "ZOBBA_MIGRATION_DATABASE_URL", valueFrom = aws_secretsmanager_secret.migration_database_url.arn }] &&
      jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].command == ["migrate", "--runtime-role", "zobba_app"] &&
      jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].entryPoint == ["/usr/local/bin/zobba-cli"]
    )
    error_message = "only the migration task gets the migrator URL and it runs zobba-cli migrate --runtime-role zobba_app"
  }

  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.worker.container_definitions)[0].entryPoint == ["/usr/local/bin/zobba-worker"] &&
      length(jsondecode(aws_ecs_task_definition.worker.container_definitions)[0].command) == 0
    )
    error_message = "the worker must start with no arguments"
  }

  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.api.container_definitions)[0].entryPoint == ["/usr/local/bin/zobba-api"] &&
      contains(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment, { name = "ZOBBA_API_BIND", value = "0.0.0.0:4310" })
    )
    error_message = "the API must bind 0.0.0.0"
  }

  assert {
    condition = alltrue([
      for td in [aws_ecs_task_definition.api, aws_ecs_task_definition.worker, aws_ecs_task_definition.migrate] :
      jsondecode(td.container_definitions)[0].image == "123456789012.dkr.ecr.eu-west-1.amazonaws.com/zobba-qualification@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ])
    error_message = "API, worker and migration share one image, pinned by digest"
  }

  # Test-only and development switches never reach the environment.
  assert {
    condition = alltrue([
      for td in [aws_ecs_task_definition.api, aws_ecs_task_definition.worker, aws_ecs_task_definition.migrate, aws_ecs_task_definition.bootstrap] :
      length(regexall("ZOBBA_LOCAL_FIXTURES|seed-local|ZOBBA_OIDC_CA_FILE|ZOBBA_TEST_|_API_KEY|AWS_ENDPOINT|AWS_ALLOW_HTTP|ZOBBA_INERT_DURATION_MS|ZOBBA_MODEL_", td.container_definitions)) == 0
    ])
    error_message = "no fixture, test, model-key or local S3 switch may be configured"
  }

  assert {
    condition     = output.github_environment_variables.ECS_MIGRATION_FAMILY == aws_ecs_task_definition.migrate.family
    error_message = "the release workflow must target the migration task definition"
  }
}

run "secrets_are_encrypted_and_never_outputs" {
  command = apply

  assert {
    condition = alltrue([
      for s in [aws_secretsmanager_secret.migration_database_url, aws_secretsmanager_secret.runtime_database_url, aws_secretsmanager_secret.oidc_client_secret] :
      s.kms_key_id == aws_kms_key.this.arn
    ])
    error_message = "secrets must use the customer-managed key"
  }

  assert {
    condition = (
      aws_secretsmanager_secret_version.migration_database_url.secret_string == null &&
      aws_secretsmanager_secret_version.runtime_database_url.secret_string == null &&
      floor(aws_secretsmanager_secret_version.migration_database_url.secret_string_wo_version / 268435456) == 1 &&
      aws_secretsmanager_secret_version.migration_database_url.secret_string_wo_version == aws_secretsmanager_secret_version.runtime_database_url.secret_string_wo_version &&
      aws_secretsmanager_secret_version.migration_database_url.secret_string_wo_version % 268435456 == parseint(substr(sha256("${aws_db_instance.this.address}:${aws_db_instance.this.port}"), 0, 7), 16)
    )
    error_message = "database URLs are write-only and never stored in state"
  }

  assert {
    condition = !anytrue([
      for v in [
        output.public_origin, output.oidc_callback_url, output.cognito_user_pool_id, output.cognito_hosted_domain,
        output.cloudfront_distribution_id, output.web_bucket, output.evidence_bucket, output.ecr_repository_url,
        output.ecs_cluster, output.database_endpoint, output.database_master_secret_arn, output.task_network_configuration,
        output.bootstrap_task_definition, output.release_role_arn, jsonencode(output.github_environment_variables),
      ] : strcontains(v, "postgres://") || strcontains(v, "mock-client-secret-value")
    ])
    error_message = "no output may contain a secret value"
  }
}

run "identity_is_admin_created_with_exact_callback" {
  command = apply

  assert {
    condition     = aws_cognito_user_pool.this.admin_create_user_config[0].allow_admin_create_user_only == true
    error_message = "self sign-up must be disabled"
  }

  assert {
    condition     = aws_cognito_user_pool_client.this.callback_urls == toset(["https://d111111abcdef8.cloudfront.net/api/auth/callback"])
    error_message = "the only callback is <public origin>/api/auth/callback"
  }

  assert {
    condition     = aws_cognito_user_pool_client.this.generate_secret == true && aws_cognito_user_pool_client.this.allowed_oauth_flows == toset(["code"])
    error_message = "confidential authorization-code client required"
  }

  assert {
    condition = (
      contains(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment, { name = "ZOBBA_OIDC_REDIRECT_URI", value = "https://d111111abcdef8.cloudfront.net/api/auth/callback" }) &&
      contains(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment, { name = "ZOBBA_OIDC_ISSUER", value = "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Mock12345" }) &&
      contains(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment, { name = "ZOBBA_OIDC_AUTHORIZATION_ORIGIN", value = "https://zobba-qualification-123456789012.auth.eu-west-1.amazoncognito.com" })
    )
    error_message = "the API OIDC configuration must match Cognito and the public origin"
  }
}

run "iam_is_least_privilege" {
  command = apply

  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.api_task.policy).Statement : s.Action if startswith(jsonencode(s.Action), "\"s3:") || startswith(jsonencode(s.Action), "[\"s3:")
    ])) == toset(["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket"])
    error_message = "the API S3 actions must be exactly those zobba/README.md documents"
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_role_policy.api_task.policy).Statement :
      s.Action == "s3:ListBucket" && s.Condition.StringEquals["s3:prefix"] == "__health/sentinel/"
    ])
    error_message = "ListBucket is limited to the readiness prefix"
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.api_task.policy).Statement :
      !contains(flatten([s.Action]), "s3:*") && !contains(flatten([s.Action]), "*")
    ])
    error_message = "no wildcard actions on the API task role"
  }

  assert {
    condition     = aws_ecs_task_definition.migrate.task_role_arn == null && aws_ecs_task_definition.bootstrap.task_role_arn == null && aws_ecs_task_definition.analysis.task_role_arn == null
    error_message = "migration, bootstrap and analysis job tasks get no AWS task credentials"
  }

  assert {
    condition     = aws_ecs_task_definition.worker.task_role_arn == aws_iam_role.worker_task.arn
    error_message = "the worker's only task role is the analysis custody role"
  }

  assert {
    condition = (
      jsondecode(aws_iam_role.release.assume_role_policy).Statement[0].Action == "sts:AssumeRoleWithWebIdentity" &&
      jsondecode(aws_iam_role.release.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == "repo:example/intellifin-audit:environment:qualification" &&
      jsondecode(aws_iam_role.release.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:aud"] == "sts.amazonaws.com"
    )
    error_message = "release uses GitHub OIDC from the qualification environment only"
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_iam_role_policy.release.policy).Statement :
      s.Action == "ecs:RunTask" && endswith(s.Resource, "task-definition/zobba-qualification-migrate:*")
    ]) && !strcontains(aws_iam_role_policy.release.policy, "bootstrap")
    error_message = "release may run only the migration task, never the role bootstrap"
  }
}

run "permissions_target_their_own_resources" {
  command = apply

  assert {
    condition = alltrue([
      for k in ["api", "worker", "migrate", "bootstrap"] :
      one([for st in jsondecode(aws_iam_role_policy.execution[k].policy).Statement : st.Resource if st.Sid == "Logs"]) == "${aws_cloudwatch_log_group.this[k].arn}:*" &&
      aws_iam_role_policy.execution[k].role == aws_iam_role.execution[k].id
    ])
    error_message = "each execution role writes only its own log group"
  }

  assert {
    condition = (
      toset(one([for st in jsondecode(aws_iam_role_policy.execution["bootstrap"].policy).Statement : st.Resource if st.Sid == "Secrets"])) ==
      toset([aws_db_instance.this.master_user_secret[0].secret_arn, aws_secretsmanager_secret.migration_database_url.arn, aws_secretsmanager_secret.runtime_database_url.arn]) &&
      toset(one([for st in jsondecode(aws_iam_role_policy.execution["migrate"].policy).Statement : st.Resource if st.Sid == "Secrets"])) ==
      toset([aws_secretsmanager_secret.migration_database_url.arn])
    )
    error_message = "migration and bootstrap execution roles read only their own secrets"
  }

  assert {
    condition = (
      aws_ecs_task_definition.api.execution_role_arn == aws_iam_role.execution["api"].arn &&
      aws_ecs_task_definition.worker.execution_role_arn == aws_iam_role.execution["worker"].arn &&
      aws_ecs_task_definition.migrate.execution_role_arn == aws_iam_role.execution["migrate"].arn &&
      aws_ecs_task_definition.bootstrap.execution_role_arn == aws_iam_role.execution["bootstrap"].arn &&
      aws_ecs_task_definition.api.task_role_arn == aws_iam_role.api_task.arn
    )
    error_message = "each task definition uses its own roles"
  }

  assert {
    condition = alltrue([
      for st in jsondecode(aws_iam_role_policy.api_task.policy).Statement :
      st.Sid == "EvidenceKey" || startswith(st.Resource, aws_s3_bucket.evidence.arn)
    ]) && !strcontains(aws_iam_role_policy.api_task.policy, aws_s3_bucket.web.arn)
    error_message = "the API task role reaches only the evidence bucket"
  }

  assert {
    condition = (
      one([for st in jsondecode(aws_iam_role_policy.release.policy).Statement : st.Resource if st.Sid == "WebSync"]) == "${aws_s3_bucket.web.arn}/*" &&
      one([for st in jsondecode(aws_iam_role_policy.release.policy).Statement : st.Resource if st.Sid == "WebList"]) == aws_s3_bucket.web.arn &&
      !strcontains(aws_iam_role_policy.release.policy, aws_s3_bucket.evidence.arn) &&
      !strcontains(aws_iam_role_policy.release.policy, aws_iam_role.execution["bootstrap"].arn)
    )
    error_message = "release syncs only the web bucket and cannot pass the bootstrap role"
  }

  assert {
    condition     = aws_flow_log.this.log_destination == aws_cloudwatch_log_group.this["vpc-flow"].arn && aws_flow_log.this.iam_role_arn == aws_iam_role.flow_logs.arn
    error_message = "flow logs go to their own group with their own role"
  }
}

run "alb_restricted_to_vpc_origin_security_group" {
  command = apply

  variables {
    restrict_alb_to_vpc_origin_sg = true
  }

  assert {
    condition = (
      length(aws_vpc_security_group_ingress_rule.alb_from_cloudfront) == 0 &&
      length(aws_vpc_security_group_ingress_rule.alb_from_vpc_origin_sg) == 1 &&
      aws_vpc_security_group_ingress_rule.alb_from_vpc_origin_sg[0].referenced_security_group_id == "sg-0cf0vpcorigin00001" &&
      aws_vpc_security_group_ingress_rule.alb_from_vpc_origin_sg[0].cidr_ipv4 == null &&
      aws_vpc_security_group_ingress_rule.alb_from_vpc_origin_sg[0].from_port == 80
    )
    error_message = "second apply: ALB ingress only from CloudFront-VPCOrigins-Service-SG"
  }

  assert {
    condition     = contains(one(data.aws_security_group.cloudfront_vpc_origin[0].filter).values, "CloudFront-VPCOrigins-Service-SG*") && data.aws_security_group.cloudfront_vpc_origin[0].vpc_id == aws_vpc.this.id
    error_message = "the service-managed group is looked up by its reserved name in this VPC"
  }
}

run "password_version_moves_the_secret_version" {
  command = apply

  variables {
    database_password_version = 2
  }

  assert {
    condition     = floor(aws_secretsmanager_secret_version.runtime_database_url.secret_string_wo_version / 268435456) == 2
    error_message = "a new password version rewrites the URL secrets"
  }
}

run "budget_and_tags" {
  command = apply

  assert {
    condition     = aws_budgets_budget.monthly.limit_amount == "150.00" && aws_budgets_budget.monthly.time_unit == "MONTHLY"
    error_message = "budget limit must be the owner-set monthly value"
  }

  assert {
    condition     = alltrue([for n in aws_budgets_budget.monthly.notification : n.subscriber_email_addresses == toset(["owner@example.com"])])
    error_message = "budget alerts go to the owner email"
  }

  assert {
    condition     = local.tags.Project == "zobba" && local.tags.Environment == "qualification" && local.tags.Qualified == "false"
    error_message = "default tags are applied to every resource"
  }
}

run "unreleased_environment_runs_no_tasks" {
  command = apply

  variables {
    image_digest = null
  }

  assert {
    condition     = aws_ecs_service.api.desired_count == 0 && aws_ecs_service.worker.desired_count == 0
    error_message = "before the first release no tasks run"
  }
}

run "optional_custom_domain_and_second_nat" {
  command = apply

  variables {
    custom_domain                 = "zobba.example.com"
    custom_domain_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/abcd"
    nat_gateway_count             = 2
  }

  assert {
    condition     = output.public_origin == "https://zobba.example.com" && aws_cognito_user_pool_client.this.callback_urls == toset(["https://zobba.example.com/api/auth/callback"])
    error_message = "a custom domain becomes the single public origin"
  }

  assert {
    condition     = aws_cloudfront_distribution.this.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021" && aws_cloudfront_distribution.this.aliases == toset(["zobba.example.com"])
    error_message = "the custom domain uses its certificate with TLS 1.2+"
  }

  assert {
    condition     = length(aws_nat_gateway.this) == 2 && aws_route.app_egress[0].nat_gateway_id != aws_route.app_egress[1].nat_gateway_id
    error_message = "two NAT gateways give each zone its own egress"
  }
}

run "analysis_jobs_are_isolated" {
  command = apply

  variables {
    analysis_image_digest = "sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f"
  }

  assert {
    condition     = aws_ecs_task_definition.analysis.task_role_arn == null && aws_ecs_task_definition.analysis.execution_role_arn == aws_iam_role.analysis_execution.arn
    error_message = "an analysis job has no task role; its execution role only pulls and logs"
  }

  assert {
    condition = alltrue([
      for c in jsondecode(aws_ecs_task_definition.analysis.container_definitions) :
      c.privileged == false && c.readonlyRootFilesystem == true && length(c.environment) == 0 && length(c.secrets) == 0 &&
      c.linuxParameters.capabilities.drop == ["ALL"] && !contains(keys(c.linuxParameters.capabilities), "add") &&
      endswith(c.image, "@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f")
    ])
    error_message = "every analysis container is unprivileged, read-only, capability-free, pinned by digest and receives no environment or secret"
  }

  assert {
    condition = alltrue([
      for c in jsondecode(aws_ecs_task_definition.analysis.container_definitions) :
      c.user == "65534:65534" && alltrue([for m in c.mountPoints : m.readOnly if contains(["/input", "/job"], m.containerPath)]) &&
      toset([for m in c.mountPoints : m.containerPath if !m.readOnly]) == toset(["/output", "/tmp"])
      if c.name == "analysis"
    ])
    error_message = "the untrusted program runs non-root with read-only inputs and only /output and /tmp writable"
  }

  assert {
    condition     = aws_ecs_task_definition.analysis.cpu == "2048" && aws_ecs_task_definition.analysis.memory == "4096"
    error_message = "the analysis ceiling is the owner's 2 vCPU / 4 GiB"
  }

  assert {
    condition = alltrue([
      for c in jsondecode(aws_ecs_task_definition.analysis.container_definitions) :
      (c.name == "analysis") == !contains(keys(c), "logConfiguration")
    ])
    error_message = "the untrusted program has no log configuration; only the trusted stage and collect containers log"
  }

  assert {
    condition = [
      for c in jsondecode(aws_ecs_task_definition.analysis.container_definitions) : c.entryPoint if c.name == "analysis"
    ] == [["timeout", "-s", "KILL"]]
    error_message = "the program runs under the in-job wall limit so collection still happens after it"
  }

  assert {
    condition = (
      aws_vpc.analysis.cidr_block == "10.250.0.0/24" &&
      alltrue([for s in aws_subnet.analysis : s.vpc_id == aws_vpc.analysis.id]) &&
      aws_route_table.analysis.vpc_id == aws_vpc.analysis.id &&
      aws_security_group.analysis.vpc_id == aws_vpc.analysis.id &&
      aws_security_group.analysis_endpoints.vpc_id == aws_vpc.analysis.id
    )
    error_message = "analysis tasks run in a dedicated VPC that shares no subnet, route table or security group with the application"
  }

  assert {
    condition     = aws_vpc_endpoint.analysis_s3.vpc_id == aws_vpc.analysis.id && aws_vpc_endpoint.analysis_s3.route_table_ids == toset([aws_route_table.analysis.id])
    error_message = "the analysis subnets reach only their own restricted S3 endpoint"
  }

  assert {
    condition = (
      toset(keys(aws_vpc_endpoint.analysis_interface)) == toset(["ecr.api", "ecr.dkr", "logs"]) &&
      alltrue([for e in aws_vpc_endpoint.analysis_interface : e.vpc_id == aws_vpc.analysis.id && e.security_group_ids == toset([aws_security_group.analysis_endpoints.id])])
    )
    error_message = "the only reachable interface endpoints are ECR API, ECR registry and Logs, behind their own security group"
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.analysis_endpoints_from_analysis.referenced_security_group_id == aws_security_group.analysis.id && aws_vpc_security_group_ingress_rule.analysis_endpoints_from_analysis.security_group_id == aws_security_group.analysis_endpoints.id && aws_vpc_security_group_egress_rule.analysis_endpoints.referenced_security_group_id == aws_security_group.analysis_endpoints.id
    error_message = "analysis tasks reach only the analysis endpoints, and those admit only analysis tasks"
  }

  assert {
    condition = (
      aws_route53_resolver_firewall_rule_group_association.analysis.vpc_id == aws_vpc.analysis.id &&
      aws_route53_resolver_firewall_config.analysis.resource_id == aws_vpc.analysis.id &&
      aws_route53_resolver_firewall_config.analysis.firewall_fail_open == "DISABLED" &&
      aws_route53_resolver_firewall_rule.analysis_allow.action == "ALLOW" &&
      aws_route53_resolver_firewall_rule.analysis_block.action == "BLOCK" &&
      aws_route53_resolver_firewall_rule.analysis_block.block_response == "NXDOMAIN" &&
      aws_route53_resolver_firewall_rule.analysis_allow.priority < aws_route53_resolver_firewall_rule.analysis_block.priority &&
      aws_route53_resolver_firewall_domain_list.analysis_everything.domains == toset(["*."]) &&
      aws_route53_resolver_firewall_domain_list.analysis_allowed.domains == toset([
        "api.ecr.eu-west-1.amazonaws.com.",
        "123456789012.dkr.ecr.eu-west-1.amazonaws.com.",
        "logs.eu-west-1.amazonaws.com.",
        "zobba-qualification-analysis-123456789012.s3.eu-west-1.amazonaws.com.",
        "prod-eu-west-1-starport-layer-bucket.s3.eu-west-1.amazonaws.com.",
      ])
    )
    error_message = "the analysis resolver answers only the endpoint, staging and layer names and blocks everything else, failing closed"
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_vpc_endpoint.analysis_s3.policy).Statement :
      s.Effect == "Allow" && !contains(flatten([s.Action]), "s3:*") && (
        s.Resource == "arn:aws:s3:::zobba-qualification-analysis-123456789012/analysis/*" ||
        s.Resource == "arn:aws:s3:::prod-eu-west-1-starport-layer-bucket/*"
      )
    ])
    error_message = "the analysis endpoint admits only job staging objects and ECR layers"
  }

  assert {
    condition     = aws_vpc_security_group_egress_rule.analysis_s3.cidr_ipv4 == null && aws_vpc_security_group_egress_rule.analysis_endpoints.cidr_ipv4 == null && aws_vpc_security_group_egress_rule.analysis_s3.prefix_list_id == "pl-6da54004"
    error_message = "analysis egress names no CIDR, only the endpoint prefix list and the endpoint security group"
  }

  assert {
    condition     = alltrue([for s in aws_subnet.analysis : s.map_public_ip_on_launch == false])
    error_message = "analysis subnets assign no public address"
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.worker_task.policy).Statement :
      !contains(flatten([s.Action]), "*") && !contains(flatten([s.Action]), "s3:*") && !contains(flatten([s.Action]), "ecs:*") &&
      (s.Action != "iam:PassRole" || s.Resource == aws_iam_role.analysis_execution.arn) &&
      (s.Action != "ecs:RunTask" || endswith(s.Resource, "task-definition/zobba-qualification-analysis:*"))
    ])
    error_message = "the worker may run only the analysis family and pass only the analysis execution role"
  }

  assert {
    condition = alltrue([
      for s in jsondecode(aws_iam_role_policy.worker_task.policy).Statement :
      s.Condition.StringEquals["aws:ResourceTag/zobba:analysis"] == "1" && s.Condition.ArnEquals["ecs:cluster"] == aws_ecs_cluster.this.arn
      if contains(flatten([s.Action]), "ecs:StopTask") || contains(flatten([s.Action]), "ecs:DescribeTasks")
    ]) && anytrue([for s in jsondecode(aws_iam_role_policy.worker_task.policy).Statement : s.Action == "ecs:TagResource" && s.Condition.StringEquals["ecs:CreateAction"] == "RunTask"])
    error_message = "the worker may describe and stop only tagged analysis tasks, and tag only at RunTask"
  }

  assert {
    condition = toset(flatten([
      for s in jsondecode(aws_iam_role_policy.worker_task.policy).Statement : s.Resource if contains(flatten([s.Action]), "s3:PutObject")
    ])) == toset(["arn:aws:s3:::zobba-qualification-analysis-123456789012/analysis/*", "arn:aws:s3:::zobba-qualification-evidence-123456789012/evidence/analysis-*"])
    error_message = "the worker writes only job staging objects and analysis descendants"
  }

  assert {
    condition     = toset([for e in jsondecode(aws_ecs_task_definition.worker.container_definitions)[0].environment : e.name]) == toset(jsondecode(file("${path.module}/analysis/worker-environment.json")))
    error_message = "the worker environment is exactly the Rust FargateConfig contract (analysis/worker-environment.json)"
  }

  assert {
    condition = (
      contains([for e in jsondecode(aws_ecs_task_definition.worker.container_definitions)[0].environment : e.name], "ZOBBA_ANALYSIS_SANDBOX") &&
      [for e in jsondecode(aws_ecs_task_definition.worker.container_definitions)[0].environment : e.value if e.name == "ZOBBA_ANALYSIS_SANDBOX"] == ["fargate"]
    )
    error_message = "a released environment with a pinned analysis image composes the Fargate sandbox"
  }
}

run "analysis_disabled_without_a_pinned_image" {
  command = apply

  assert {
    condition     = length(jsondecode(aws_ecs_task_definition.worker.container_definitions)[0].environment) == 0
    error_message = "without analysis_image_digest the worker composes no sandbox"
  }
}
