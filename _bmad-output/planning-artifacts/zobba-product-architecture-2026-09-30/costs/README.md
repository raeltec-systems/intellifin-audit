# Managed-computer cost worksheet

This worksheet supports revision 2 of the [consolidated design](../Zobba-Product-and-Architecture-Design.md), §7. It is a scoped infrastructure estimate, not a customer price, full service quote or performance benchmark.

Start with [the scenario table](managed-computer-cost-table.md) and [the design, assumptions and limits](managed-computer.md). [Scenario CSV](managed-computer-costs.csv) separates direct profile/use cost, shared regional allocation and the Windows organisation floor. [Line items](managed-computer-line-items.csv) expose every calculation.

Run with Python 3; no packages or credentials are needed:

```sh
python3 managed-computer-costs.py
```

Change quantities in a copy of [the assumptions](managed-computer-assumptions.json), then preserve your result separately:

```sh
python3 managed-computer-costs.py --assumptions my-assumptions.json --output-dir my-scenario
```

The [rate metadata](managed-computer-rates.json) freezes USD On-Demand us-east-1 inputs retrieved on 30 September 2026, with units, official URLs, effective dates and retrieval dates. [Selected catalog evidence](aws-evidence/aws-core-selected-evidence.json) and [additional licensing/rate evidence](managed-computer-extra-source-evidence.json) support them. Updating a rate is a deliberate re-quote; the script does not fetch live prices. It refuses traffic above the selected 10-TB egress tier.

The default 12-user Linux scenario costs $431.55/month for the specified computer, storage, desktop/network and analysis resources. The separate $300 application/data/operations allowance is an unpriced planning placeholder, not proof that API/workers, PostgreSQL Multi-AZ, identity and other services fit that amount. Model use, support, tax, extra retention and unmodelled network/resources remain additional.

A solo SaaS user incurs direct use plus a share of regional capacity. The solo **whole-deployment** rows deliberately allocate the entire regional baseline to one user. Do not charge that whole baseline once per customer. Each Windows scenario assumes one organisation; separate firms each incur the $116.80 directory/endpoint floor and require their own registered-directory VPC. The shared application proxy does not imply transitive NAT routing through peering.

Rates are externally sourced; quantities, capacity allocations and response targets are design assumptions. No Zobba startup, input latency, concurrent capacity or full cloud bill was measured for this design.
