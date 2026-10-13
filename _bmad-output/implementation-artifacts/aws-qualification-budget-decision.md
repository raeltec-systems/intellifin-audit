# AWS qualification budget (owner decision 2026-10-14)

- Funding: AWS Activate Founders credit, USD 1,000, active 2026-10-01, expires 2028-10-31.
- Region: eu-west-1 Ireland (owner confirmed 2026-10-14 after comparing af-south-1 Cape Town: Cape Town has Cognito and PostgreSQL 18, but CloudFront VPC origin support was not confirmed and prices are higher; Ireland chosen for the first proof).
- Estimated running cost of the 20.7a environment: about USD 170–210 per month (build-agent estimate, not measured). Running continuously, the credit lasts about 5 months.
- Operating rule (owner confirmed 2026-10-14): monthly AWS Budget alarm USD 200 with alerts at 50/80/100 %; run the environment only for the 20.7b proof and demos, destroy between uses (backups retained per RUNBOOK); one NAT gateway.
- Credits may not cover every charge (for example Marketplace or domain registration); the budget alarm is the guard.
- The AWS account ID is not recorded in the repository.
- Story 20.7b (live apply, Cognito login, restore drill, spend) is now unblocked once the owner completes the RUNBOOK prerequisites.
- Credit coverage (owner supplied the eligible-service list 2026-10-14): ECS/Fargate, RDS, S3, KMS, Secrets Manager, Cognito, CloudFront, VPC, Elastic Load Balancing, ECR, CloudWatch, Route 53, Budgets and Data Transfer are all eligible, so the 20.7a environment is covered.
- Option for later (not decided): Amazon Bedrock is also eligible, so Claude models via Bedrock could be paid from the credit. Zobba has no Bedrock adapter; it would be a new provider with its own qualification run.
