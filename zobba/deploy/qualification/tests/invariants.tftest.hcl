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
    condition     = length(aws_route_table.db.route) == 0
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
    condition     = aws_vpc_security_group_ingress_rule.alb_from_cloudfront.prefix_list_id == data.aws_ec2_managed_prefix_list.cloudfront_origin.id && aws_vpc_security_group_ingress_rule.alb_from_cloudfront.cidr_ipv4 == null
    error_message = "ALB ingress must come only from the CloudFront origin-facing prefix list"
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
      for td in [aws_ecs_task_definition.api, aws_ecs_task_definition.worker, aws_ecs_task_definition.migrate, aws_ecs_task_definition.bootstrap] : [
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
      aws_secretsmanager_secret_version.migration_database_url.secret_string_wo_version == 1
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
    condition     = jsondecode(aws_ecs_task_definition.worker.container_definitions)[0] != null && aws_ecs_task_definition.worker.task_role_arn == null && aws_ecs_task_definition.migrate.task_role_arn == null && aws_ecs_task_definition.bootstrap.task_role_arn == null
    error_message = "worker, migration and bootstrap tasks get no AWS task credentials"
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
