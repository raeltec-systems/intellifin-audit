# Example partial backend configuration (RUNBOOK "State backend"). Copy to an
# ignored backend.hcl and pass it to `terraform init -backend-config=backend.hcl`.
bucket       = "zobba-qualification-tfstate-123456789012"
key          = "qualification/terraform.tfstate"
region       = "eu-west-1"
encrypt      = true
kms_key_id   = "alias/zobba-qualification-tfstate"
use_lockfile = true
