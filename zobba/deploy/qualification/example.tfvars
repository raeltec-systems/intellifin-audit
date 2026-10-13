# Example only. Copy to an ignored terraform.tfvars (or pass -var-file) and set
# owner-approved values. No credentials belong in this file.

region                   = "eu-west-1" # owner decision: cost and data location
budget_monthly_limit_usd = 250         # owner-approved monthly limit (alert, not a cap)
budget_alert_email       = "owner@example.com"
github_repository        = "OWNER/intellifin-audit"

# Optional (defaults are the smallest Multi-AZ profile):
# create_github_oidc_provider = true   # false if the account already has one
# nat_gateway_count           = 1      # 2 adds a NAT per zone (extra cost)
# db_instance_class           = "db.t4g.micro"
# backup_retention_days       = 7
# api_desired_count           = 2
# worker_desired_count        = 1
# custom_domain                 = "zobba.example.com"
# custom_domain_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/..."

# Set after the first successful release (see ../RUNBOOK.md "First release"):
# image_digest = "sha256:..."
