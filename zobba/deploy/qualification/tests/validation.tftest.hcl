# Unsafe or missing inputs are refused by variable validation, before any plan.

mock_provider "aws" {
  source = "./tests/mocks"
}

variables {
  region                   = "eu-west-1"
  budget_monthly_limit_usd = 150
  budget_alert_email       = "owner@example.com"
  github_repository        = "example/intellifin-audit"
}

run "missing_region_is_refused" {
  command = plan
  variables {
    region = null
  }
  expect_failures = [var.region]
}

run "missing_budget_limit_is_refused" {
  command = plan
  variables {
    budget_monthly_limit_usd = null
  }
  expect_failures = [var.budget_monthly_limit_usd]
}

run "zero_budget_limit_is_refused" {
  command = plan
  variables {
    budget_monthly_limit_usd = 0
  }
  expect_failures = [var.budget_monthly_limit_usd]
}

run "missing_alert_email_is_refused" {
  command = plan
  variables {
    budget_alert_email = null
  }
  expect_failures = [var.budget_alert_email]
}

run "missing_github_repository_is_refused" {
  command = plan
  variables {
    github_repository = null
  }
  expect_failures = [var.github_repository]
}

run "single_az_database_is_refused" {
  command = plan
  variables {
    multi_az = false
  }
  expect_failures = [var.multi_az]
}

run "short_backup_retention_is_refused" {
  command = plan
  variables {
    backup_retention_days = 6
  }
  expect_failures = [var.backup_retention_days]
}

run "single_api_task_is_refused" {
  command = plan
  variables {
    api_desired_count = 1
  }
  expect_failures = [var.api_desired_count]
}

run "three_nat_gateways_are_refused" {
  command = plan
  variables {
    nat_gateway_count = 3
  }
  expect_failures = [var.nat_gateway_count]
}

run "non_postgres_18_is_refused" {
  command = plan
  variables {
    db_engine_version = "17.6"
  }
  expect_failures = [var.db_engine_version]
}

run "custom_domain_without_certificate_is_refused" {
  command = plan
  variables {
    custom_domain = "zobba.example.com"
  }
  expect_failures = [var.custom_domain_certificate_arn]
}

run "unpinned_image_digest_is_refused" {
  command = plan
  variables {
    image_digest = "latest"
  }
  expect_failures = [var.image_digest]
}

run "unpinned_bootstrap_image_is_refused" {
  command = plan
  variables {
    bootstrap_image = "postgres:18"
  }
  expect_failures = [var.bootstrap_image]
}

run "invalid_fargate_memory_is_refused" {
  command = plan
  variables {
    task_cpu    = 256
    task_memory = 4096
  }
  expect_failures = [var.task_memory]
}

run "invalid_fargate_cpu_is_refused" {
  command = plan
  variables {
    task_cpu = 300
  }
  expect_failures = [var.task_cpu]
}

run "major_only_engine_version_is_refused" {
  command = plan
  variables {
    db_engine_version = "18"
  }
  expect_failures = [var.db_engine_version]
}

run "short_secret_recovery_window_is_refused" {
  command = plan
  variables {
    secret_recovery_window_days = 3
  }
  expect_failures = [var.secret_recovery_window_days]
}
