# AWS qualification budget (owner decision 2026-10-14)

- Funding: AWS Activate Founders credit, USD 1,000, active 2026-10-01, expires 2028-10-31.
- Region: eu-west-1 (owner confirmed).
- Estimated running cost of the 20.7a environment: about USD 170–210 per month (build-agent estimate, not measured). Running continuously, the credit lasts about 5 months.
- Proposed operating rule (pending owner confirmation): monthly AWS Budget alarm USD 200 with alerts at 50/80/100 %; run the environment only for the 20.7b proof and demos, destroy between uses (backups retained per RUNBOOK); one NAT gateway.
- Credits may not cover every charge (for example Marketplace or domain registration); the budget alarm is the guard.
- The AWS account ID is not recorded in the repository.
- Story 20.7b (live apply, Cognito login, restore drill, spend) is now unblocked once the owner completes the RUNBOOK prerequisites.
