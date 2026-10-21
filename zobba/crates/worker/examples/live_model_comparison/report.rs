//! Time formatting, the result and summary files, and the checks a scripted
//! dry run must pass.
use serde_json::Value;
use std::{
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}
fn parts(time: SystemTime) -> (i64, u32, u32, u64, u64, u64) {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, m, d) = civil((seconds / 86_400) as i64);
    let rest = seconds % 86_400;
    (y, m, d, rest / 3_600, rest % 3_600 / 60, rest % 60)
}
pub fn rfc3339(time: SystemTime) -> String {
    let (y, m, d, h, mi, s) = parts(time);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}
pub fn now_rfc3339() -> String {
    rfc3339(SystemTime::now())
}
/// A folder-safe UTC stamp, for example `20261021T223000Z`.
pub fn stamp(time: SystemTime) -> String {
    let (y, m, d, h, mi, s) = parts(time);
    format!("{y:04}{m:02}{d:02}T{h:02}{mi:02}{s:02}Z")
}

pub fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    crate::ledger::write_atomic(path, &bytes)
}

fn text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => "unknown".into(),
        other => other.to_string(),
    }
}
fn usd(value: &Value) -> String {
    value
        .as_f64()
        .map(|v| format!("{v:.4} USD"))
        .unwrap_or_else(|| "unknown".into())
}

/// A short plain-English summary of one result.
pub fn summary_markdown(r: &Value) -> String {
    let mut out = String::new();
    let paid = r["paid"].as_bool().unwrap_or(false);
    out.push_str(&format!(
        "# Model comparison run: {} {}\n\n",
        text(&r["provider"]),
        text(&r["model"])
    ));
    if !paid {
        out.push_str("**Scripted dry run.** A loopback fixture answered with scripted replies. No provider was called and nothing was paid. The cost below is what the same token counts would cost at the configured (placeholder) prices.\n\n");
    }
    if let Some(warning) = r["qualification"]["warning"].as_str() {
        out.push_str(&format!("**{warning}**\n\n"));
    }
    out.push_str("## What happened\n\n");
    out.push_str(&format!(
        "- Run `{}` ({} mode) started {} and ended {} ({} s).\n",
        text(&r["run_id"]),
        text(&r["mode"]),
        text(&r["started_at"]),
        text(&r["ended_at"]),
        text(&r["duration_seconds"])
    ));
    out.push_str(&format!("- It stopped because: **{}**.\n", text(&r["stop_reason"])));
    out.push_str(&format!(
        "- Rounds: {} (cycles: {}). Model turns: {}. Model calls sent: {} (refused before sending: {}).\n",
        text(&r["rounds"]),
        r["task_cycles"].as_array().map_or(0, |c| c.len()),
        text(&r["model_turns"]),
        text(&r["model_calls"]["sent"]),
        text(&r["model_calls"]["refused_locally"])
    ));
    out.push_str(&format!(
        "- Tokens: {} in, {} out (cached tokens are not reported by the adapter). Cost: **{}** (run cap {}).\n\n",
        text(&r["tokens"]["input"]),
        text(&r["tokens"]["output"]),
        usd(&r["cost_usd"]),
        usd(&r["limits"]["run_cap_usd"])
    ));
    out.push_str("## The work product\n\n");
    let drafts = &r["drafts"];
    if r["work_product"]["recorded"].as_bool().unwrap_or(false) {
        out.push_str(&format!(
            "- A work product was **recorded** after {} draft(s) ({} drafts in all, {} recorded).\n",
            text(&drafts["until_first_recorded"]),
            text(&drafts["proposed"]),
            text(&drafts["recorded"])
        ));
        out.push_str(&format!(
            "- Latest version {} has {} checked claims. Required sections missing: {}.\n",
            text(&r["work_product"]["latest_version"]),
            text(&r["work_product"]["claims"]),
            r["work_product"]["sections"]["required_missing"]
                .as_array()
                .filter(|a| !a.is_empty())
                .map(|a| a.iter().map(text).collect::<Vec<_>>().join(", "))
                .unwrap_or_else(|| "none".into())
        ));
        for export in r["work_product"]["exports"].as_array().into_iter().flatten() {
            out.push_str(&format!(
                "- Exported `{}` ({} bytes, valid package: {}).\n",
                text(&export["file"]),
                text(&export["bytes"]),
                text(&export["valid_package"])
            ));
        }
    } else {
        out.push_str(&format!(
            "- **No work product was recorded.** The model proposed {} draft(s); none passed the platform's checks.\n",
            text(&drafts["proposed"])
        ));
    }
    if let Some(reasons) = r["refusals_by_reason"].as_object()
        && !reasons.is_empty()
    {
        out.push_str("- Draft refusals by reason: ");
        out.push_str(
            &reasons
                .iter()
                .map(|(k, v)| format!("{k} ×{v}"))
                .collect::<Vec<_>>()
                .join(", "),
        );
        out.push_str(".\n");
    }
    if drafts["with_unknown_refusal_reasons"].as_u64().unwrap_or(0) > 0 {
        out.push_str(&format!(
            "- {} refused draft(s) ended their cycle, so the platform's reasons were not shown again and are unknown.\n",
            text(&drafts["with_unknown_refusal_reasons"])
        ));
    }
    out.push_str("\n## Correctness against the known truth\n\n");
    out.push_str("| Finding | Truth | Found | Wrongly flagged | Missed |\n|---|---|---|---|---|\n");
    for (name, words) in [
        ("population_not_approved", "2026 invoices over 1,000 USD with no approval"),
        ("population_after_payment", "2026 invoices over 1,000 USD approved after payment"),
        ("listing_missing_approver", "listing invoices over 1,000 USD with no approver"),
        ("listing_segregation", "listing invoices approved by their requester"),
    ] {
        let s = &r["correctness"]["findings"][name];
        out.push_str(&format!(
            "| {words} | {} | {} | {} | {} |\n",
            text(&s["truth"]),
            text(&s["true_positives"]),
            text(&s["false_positives"]),
            text(&s["false_negatives"])
        ));
    }
    let overall = &r["correctness"]["overall"];
    out.push_str(&format!(
        "\nAll exceptions together: {} true, {} false, {} missed (precision {}, recall {}).\n",
        text(&overall["true_positives"]),
        text(&overall["false_positives"]),
        text(&overall["false_negatives"]),
        text(&overall["precision"]),
        text(&overall["recall"])
    ));
    let undetermined = &r["correctness"]["undetermined_items"];
    out.push_str(&format!(
        "Of the {} items the evidence cannot decide, {} were left undetermined and {} were wrongly flagged as exceptions.\n",
        text(&undetermined["truth"]),
        text(&undetermined["left_undetermined"]),
        text(&undetermined["flagged_not_met"])
    ));
    out.push_str("\n## Limitations the work product states\n\n");
    match r["work_product"]["limitations"].as_array() {
        Some(list) if !list.is_empty() => {
            for item in list {
                out.push_str(&format!("- {}\n", text(item)));
            }
        }
        _ => out.push_str("- none recorded\n"),
    }
    let errors = r["errors"].as_array().cloned().unwrap_or_default();
    out.push_str("\n## Errors\n\n");
    if errors.is_empty() {
        out.push_str("- none\n");
    } else {
        for error in errors {
            out.push_str(&format!("- {}\n", text(&error)));
        }
    }
    out.push_str("\nFull details: `result.json` in this folder.\n");
    out
}

/// What the scripted dry run must show; each failure is one sentence.
pub fn scripted_expectations(r: &Value, run_cap_usd: f64) -> Vec<String> {
    let mut failures = Vec::new();
    let mut expect = |ok: bool, what: &str| {
        if !ok {
            failures.push(what.to_string());
        }
    };
    expect(r["stop_reason"] == "work_product_recorded", "the run ends with a recorded work product");
    expect(
        r["model_calls"]["sent"].as_u64() == Some(crate::scripted::SCRIPTED_CALLS as u64),
        "the script makes exactly its model calls",
    );
    expect(r["drafts"]["proposed"] == 3, "three drafts are proposed");
    expect(r["drafts"]["recorded"] == 1, "one draft is recorded");
    expect(r["drafts"]["until_first_recorded"] == 2, "the second draft is the first recorded");
    for reason in crate::scripted::EXPECTED_REFUSALS {
        expect(
            r["refusals_by_reason"][reason].as_u64().unwrap_or(0) >= 1,
            &format!("the refusal {reason} is counted"),
        );
    }
    expect(r["work_product"]["recorded"] == true, "the work product is recorded");
    expect(r["work_product"]["claims"] == 5, "the recorded version has five claims");
    expect(
        r["work_product"]["sections"]["required_missing"]
            .as_array()
            .is_some_and(|a| a.iter().any(|s| s == "conclusion")),
        "the empty required conclusion is reported missing",
    );
    let exports = r["work_product"]["exports"].as_array().cloned().unwrap_or_default();
    expect(exports.len() == 2, "a DOCX and an XLSX are exported");
    expect(
        exports
            .iter()
            .all(|x| x["valid_package"] == true && x["digest_matches_api"] == true),
        "each export is a valid package whose digest matches the API's",
    );
    let finding = |name: &str, tp: u64, fp: u64, fn_: u64| {
        let s = &r["correctness"]["findings"][name];
        s["true_positives"].as_u64() == Some(tp)
            && s["false_positives"].as_u64() == Some(fp)
            && s["false_negatives"].as_u64() == Some(fn_)
    };
    expect(finding("population_not_approved", 15, 0, 0), "15 unapproved invoices are found, none wrongly");
    expect(finding("population_after_payment", 12, 0, 0), "12 late approvals are found, none wrongly");
    expect(finding("listing_segregation", 1, 1, 2), "segregation: INV-0042 found, INV-0055 wrongly flagged, two missed");
    expect(finding("listing_missing_approver", 0, 0, 3), "the three listing invoices without an approver are missed");
    expect(
        r["key_figures"]["summaries"]
            .as_array()
            .is_some_and(|s| s.iter().any(|x| x["conclusion_matches_truth"] == true)),
        "the coverage summary's conclusion matches the truth",
    );
    let cost = r["cost_usd"].as_f64().unwrap_or(-1.0);
    expect(cost > 0.0 && cost <= run_cap_usd, "the metered cost is above zero and within the run cap");
    expect(
        r["errors"].as_array().is_some_and(|e| e.is_empty()),
        "no harness error is recorded",
    );
    failures
}
