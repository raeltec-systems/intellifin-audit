#!/usr/bin/env python3
"""Reproduce the managed-computer worksheet using only Python's standard library.

Usage: python managed-computer-costs.py [--assumptions custom.json] [--output-dir dir]
Quantities are planning assumptions. Verified rates carry sources in rates.json.
The output is a scoped infrastructure estimate, not a quote or measured bill.
"""
import argparse
import csv
import json
from pathlib import Path


def main():
    base = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assumptions", type=Path, default=base / "managed-computer-assumptions.json")
    parser.add_argument("--rates", type=Path, default=base / "managed-computer-rates.json")
    parser.add_argument("--output-dir", type=Path, default=base)
    args = parser.parse_args()
    a = json.loads(args.assumptions.read_text())
    rates = json.loads(args.rates.read_text())["rates"]
    rate = lambda name: rates[name]["value"]
    rows, details = [], []
    for scenario in a["scenarios"]:
        lines = []
        def add(group, label, quantity, rate_name=None, unit_rate=None):
            r = rate(rate_name) if rate_name else unit_rate
            lines.append({"scenario":scenario["name"], "group":group, "component":label,
                          "quantity":quantity, "rate_id":rate_name or "planning_allowance",
                          "unit_rate_usd":r, "cost_usd":quantity*r})
        nl, nw = scenario["linux_users"], scenario["windows_users"]
        users = nl + nw
        assert users > 0 and nl >= 0 and nw >= 0
        active = scenario["mode"] != "idle"
        always = scenario["mode"] == "always_on"
        grace = a["work_days"]*a["sessions_per_user_day"]*a["idle_grace_minutes"]/60
        prestart = a["work_days"]*a["prestart_minutes_per_user_day"]/60
        computer_hours = a["hours_month"] if always else (a["active_hours_per_user"]+grace+prestart if active else 0)
        pool = a["linux_pool_count_for_teams"] if active and not always and nl >= a["linux_pool_threshold_users"] else 0
        pool_hours = pool*a["staffed_hours_month"]
        add("computers", "Linux running hours incl grace and prestart", nl*computer_hours, "linux_hour")
        add("computers", "Windows running hours incl grace and prestart", nw*computer_hours, "windows_hour")
        add("shared_warm_capacity", "Clean Linux spare running hours", pool_hours, "linux_hour")
        add("shared_warm_capacity", "Clean Linux spare gp3 GB-month", pool*a["linux_disk_gb"], "ebs_gb_month")
        add("storage", "Private computer gp3 provisioned GB-month", nl*a["linux_disk_gb"]+nw*a["windows_disk_gb"], "ebs_gb_month")
        add("storage", "Incremental snapshot retained GB-month", nl*a["linux_snapshot_stored_gb"]+nw*a["windows_snapshot_stored_gb"], "snapshot_gb_month")
        add("storage", "S3 Standard retained artifact GB-month", users*a["artifact_gb_per_user"], "s3_gb_month")
        add("storage", "S3 PUT/COPY/POST/LIST requests", users*a["s3_put_per_active_user"] if active else 0, "s3_put")
        add("storage", "S3 GET/other requests", users*a["s3_get_per_active_user"] if active else 0, "s3_get")
        # Decimal GB conversion from Mbps is an explicit conservative planning convention.
        view_hours = users*a["view_hours_per_user"]*a["viewer_multiplier"] if active else 0
        media_gb = view_hours*a["average_media_mbps"]*3600/8/1000
        other_out = users*a["other_internet_out_gb_per_active_user"] if active else 0
        if media_gb+other_out > 10240:
            raise ValueError("This worksheet's egress tier is only valid through 10 TB; add higher tiers for this scenario")
        add("traffic", "Internet outbound GB, gross before shared free allowance", media_gb+other_out, "egress_gb_first_10tb")
        add("traffic", "NAT processed source GB (display does not traverse NAT)", users*a["nat_source_gb_per_active_user"] if active else 0, "nat_gb")
        # ALB actually bills the maximum dimension each hour. Summing byte LCUs and
        # a non-byte headroom allowance is deliberately conservative, not exact metering.
        add("traffic", "ALB LCU-hour budget: byte dimension", media_gb+other_out, "alb_lcu_hour")
        add("shared_desktop_usage", "ALB non-byte LCU headroom budget", a["alb_other_lcu_per_staffed_hour_budget"]*a["staffed_hours_month"] if active else 0, "alb_lcu_hour")
        gateway_hours = a["gateway_replicas"]*a["hours_month"]
        add("shared_desktop", "Gateway/guacd vCPU-hours", gateway_hours*a["gateway_vcpu_each"], "fargate_cpu_hour")
        add("shared_desktop", "Gateway/guacd GiB-hours", gateway_hours*a["gateway_memory_gib_each"], "fargate_gib_hour")
        proxy_hours = a["egress_proxy_replicas"]*a["hours_month"]
        add("shared_desktop", "Egress proxy vCPU-hours", proxy_hours*a["egress_proxy_vcpu_each"], "fargate_cpu_hour")
        add("shared_desktop", "Egress proxy GiB-hours", proxy_hours*a["egress_proxy_memory_gib_each"], "fargate_gib_hour")
        add("shared_desktop", "NAT gateway-hours, two AZs", a["nat_gateways"]*a["hours_month"], "nat_hour")
        add("shared_desktop", "ALB hours", a["albs"]*a["hours_month"], "alb_hour")
        add("shared_desktop", "Public IPv4 address-hours, ALB and NAT", a["public_ipv4_addresses"]*a["hours_month"], "ipv4_hour")
        if nw:
            add("windows_licensing", "Office named-user full subscription month", nw, "office_"+a["office_edition"]+"_user_month")
            add("windows_licensing", "RDS SAL named-user month", nw, "rds_sal_user_month")
            add("windows_tenant_fixed", "Managed AD Standard domain-controller hours", a["ad_domain_controllers"]*a["hours_month"], "ad_dc_hour")
            add("windows_tenant_fixed", "Endpoint AZ-hours, provisioning-count allowance", a["windows_endpoint_az_count_allowance"]*a["hours_month"], "endpoint_az_hour")
            add("traffic", "Endpoint processed GB allowance", nw*a["windows_endpoint_gb_per_active_user"] if active else 0, "endpoint_gb")
        analysis_hours = users*a["analysis_hours_per_active_user"] if active else 0
        add("analysis", "Analysis vCPU-hours", analysis_hours*a["analysis_vcpu"], "fargate_cpu_hour")
        add("analysis", "Analysis GiB-hours", analysis_hours*a["analysis_memory_gib"], "fargate_gib_hour")
        subtotal = sum(line["cost_usd"] for line in lines)
        shared = sum(line["cost_usd"] for line in lines if line["group"] in ("shared_desktop", "shared_desktop_usage", "shared_warm_capacity"))
        windows_tenant_fixed = sum(line["cost_usd"] for line in lines if line["group"] == "windows_tenant_fixed")
        add("unpriced_allowance", "Additional application/data/operations planning allowance", 1, unit_rate=a["additional_platform_operations_allowance_usd"])
        row = {"scenario":scenario["name"], "users":users, "linux_machine_hours":nl*computer_hours+pool_hours,
               "windows_machine_hours":nw*computer_hours, "media_gb":round(media_gb,3),
               "regional_shared_desktop_allocation_usd":round(shared,2),
               "windows_organization_fixed_usd":round(windows_tenant_fixed,2),
               "direct_profile_use_usd":round(subtotal-shared-windows_tenant_fixed,2),
               "direct_profile_use_per_user_usd":round((subtotal-shared-windows_tenant_fixed)/users,2),
               "costed_subtotal_usd":round(subtotal,2),
               "costed_subtotal_per_user_usd":round(subtotal/users,2),
               "additional_unpriced_allowance_usd":a["additional_platform_operations_allowance_usd"],
               "planning_envelope_before_models_usd":round(subtotal+a["additional_platform_operations_allowance_usd"],2)}
        rows.append(row)
        details.extend(lines)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, records in [("managed-computer-costs.csv",rows), ("managed-computer-line-items.csv", details)]:
        with (args.output_dir/name).open("w",newline="") as stream:
            writer=csv.DictWriter(stream,fieldnames=records[0].keys());writer.writeheader();writer.writerows(records)
    header="| Scenario | Linux h | Windows h | Costed subtotal | Per user | + stated platform allowance, before models |\n|---|---:|---:|---:|---:|---:|\n"
    table=header+"\n".join(f'| {r["scenario"]} | {r["linux_machine_hours"]:.0f} | {r["windows_machine_hours"]:.0f} | ${r["costed_subtotal_usd"]:.2f} | ${r["costed_subtotal_per_user_usd"]:.2f} | ${r["planning_envelope_before_models_usd"]:.2f} |' for r in rows)+"\n"
    (args.output_dir/"managed-computer-cost-table.md").write_text(table)
    print(table)


if __name__ == "__main__":
    main()
