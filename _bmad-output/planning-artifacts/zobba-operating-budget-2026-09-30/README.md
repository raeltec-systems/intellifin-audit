# Zobba operating budget · 30 September 2026

Start with [OPERATING-BUDGET.md](OPERATING-BUDGET.md). This is a new, reproducible operating addendum to the accepted [revision 3 design](../zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md); the accepted package is unchanged.

It costs one regional production platform and a shared test environment for 1, 5 or 20 active people, each headline case in one firm. US East is a proposed reference region, not a residency commitment. Source rates are official public list prices checked 30 September 2026; workload/capacity quantities are explicit assumptions, not measurements.

- [Main readable budget](OPERATING-BUDGET.md) and [model usage details](MODEL-USAGE.md).
- Editable [assumptions](assumptions.json), [AWS rates](rates.json), [model rates](model-rates.json) and [model quantities](model-quantities.json).
- [Results](results.csv), [detailed priced line items](line-items.csv), [sensitivities](sensitivity.csv) and [Windows option](windows-option.csv).
- [Standard-library calculator](calculate_budget.py), [independent validation](verify_budget.py) and [source notes](sources/aws-service-notes.md).

Run `python calculate_budget.py` then `python verify_budget.py` from this folder. To test edited inputs without overwriting packaged results, run `python calculate_budget.py --assumptions /path/to/assumptions.json --output /tmp/zobba-budget-check`.

No infrastructure was created and no subscription was purchased. Dollar totals cover the stated service profile; company staffing, taxes and other listed business costs are outside that scope.

The validator checks the shipped reference assumptions and source rates; edited workloads require inspecting their new line items and capacity limits. It does not certify changed deployment sizing.
