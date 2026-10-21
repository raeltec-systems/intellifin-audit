//! Offline checks of the harness's own spending and parsing rules. They run
//! before every run (scripted or live) and need no network, no database and
//! no key. A failure refuses the run.
use crate::{
    analysis::{parse_feedback, parse_refusal},
    ledger::{Entry, LedgerFile},
    meter::{Meter, Rates, StopReason},
    qualification::receipt_qualifies,
};
use zobba_domain::model::Provider;

fn entry(state: &str, cap: f64, spent: f64) -> Entry {
    Entry {
        entry_id: format!("check-{state}-{cap}-{spent}"),
        run_id: "check".into(),
        mode: "live".into(),
        provider: "openai".into(),
        model: "check-model".into(),
        output_dir: String::new(),
        started_at: String::new(),
        ended_at: None,
        state: state.into(),
        run_cap_usd: cap,
        spent_usd: spent,
        calls_sent: 0,
        input_tokens: 0,
        output_tokens: 0,
        unknown_usage_calls: 0,
        stop_reason: None,
    }
}

fn check(ok: bool, name: &str, passed: &mut Vec<String>) -> Result<(), String> {
    if ok {
        passed.push(name.into());
        Ok(())
    } else {
        Err(format!("harness self-check failed: {name}"))
    }
}

pub fn run() -> Result<Vec<String>, String> {
    let mut passed = Vec::new();

    // Ledger: a finished run counts its spend; an unfinished one its cap.
    let mut ledger = LedgerFile::new("check", 100.0);
    ledger.entries.push(entry("finished", 20.0, 12.5));
    ledger.entries.push(entry("finished", 30.0, 47.5));
    ledger.entries.push(entry("reserved", 30.0, 1.0));
    check(
        (ledger.committed() - 90.0).abs() < 1e-9,
        "ledger: finished runs count their spend, an unfinished run its whole cap",
        &mut passed,
    )?;
    check(ledger.admission(10.0).is_ok(), "ledger: a run that fits the total cap is admitted", &mut passed)?;
    check(
        ledger.admission(10.01).is_err(),
        "ledger: a run whose cap would pass the total cap is refused",
        &mut passed,
    )?;

    // Meter: worst cases are reserved before sending; the cap is never passed.
    let rates = Rates {
        input: 1.0,
        output: 2.0,
        cached_input: 0.5,
    };
    check(
        (rates.cost(1_000_000, 500_000) - 2.0).abs() < 1e-9,
        "meter: cost is tokens times USD per million",
        &mut passed,
    )?;
    let meter = Meter::new(rates, 1.0, 10, None);
    check(meter.admit(0.6).is_ok(), "meter: a call within the cap is admitted", &mut passed)?;
    check(
        meter.admit(0.5) == Err(StopReason::RunCap),
        "meter: a call whose worst case passes the remaining cap is refused before sending",
        &mut passed,
    )?;
    check(
        meter.admit(0.01) == Err(StopReason::RunCap),
        "meter: once refused, every later call is refused",
        &mut passed,
    )?;
    let calls = Meter::new(rates, 1_000.0, 2, None);
    let _ = calls.admit(0.0);
    let _ = calls.admit(0.0);
    check(
        calls.admit(0.0) == Err(StopReason::CallLimit),
        "meter: the call limit refuses the next call",
        &mut passed,
    )?;
    check(
        meter.worst_case(10_000, 4_096) > meter.worst_case(1_000, 4_096),
        "meter: a larger request has a larger worst case",
        &mut passed,
    )?;

    // Feedback parsing: the platform's own line shapes.
    let refusal = parse_refusal("- block 3: unsupported_figure — a figure of the sentence is not one of the claim's checked values (14 is not a checked value)");
    check(
        refusal.as_ref().is_some_and(|r| r.block == Some(3) && r.reason == "unsupported_figure"),
        "feedback: a block refusal is parsed",
        &mut passed,
    )?;
    check(
        parse_refusal("the draft: template_unbound — the template is not one of the Task's current method binding (other:1 is not a template)")
            .is_some_and(|r| r.block.is_none() && r.reason == "template_unbound"),
        "feedback: a whole-draft refusal is parsed",
        &mut passed,
    )?;
    check(
        parse_refusal("Criterion crit-x was recorded: rule — something (else)").is_none(),
        "feedback: other lines are not refusals",
        &mut passed,
    )?;
    let (said, refusals) = parse_feedback(
        "What trusted code did:\n- The work-product draft was not recorded; nothing was recorded. Fix every block named here and draft again:\n- block 1: count_mismatch — the stated count is not the summary's stored count (14)\n- block 2: section_unknown — the section is not one of the template's sections (nowhere)",
    );
    check(
        said == Some(false) && refusals.len() == 2,
        "feedback: a refused draft and its two refusals are read",
        &mut passed,
    )?;
    let (said, _) = parse_feedback("- Work product wp-1 version 1 (wpv-1) was recorded: 11 blocks, 5 claims, every claim checked against its records.");
    check(said == Some(true), "feedback: a recorded draft is read", &mut passed)?;

    // Qualification receipts: only a finished run passing every phase counts.
    let line = |kind: &str, phase: &str| {
        format!(
            "{{\"kind\":\"{kind}\",\"phase\":\"{phase}\",\"provider\":\"openai\",\"requested_model\":\"m-1\",\"actual_model\":\"m-1\",\"transport_completion\":\"Succeeded\"}}\n"
        )
    };
    let mut good = String::new();
    for phase in ["text", "tool", "continuation"] {
        good.push_str(&line("observed", phase));
        good.push_str(&line("validated_synthetic_output", phase));
    }
    let finished = format!("{good}{{\"kind\":\"finished\",\"result\":\"adapter_qualification_evidence_only\"}}\n");
    check(
        receipt_qualifies(&finished, Provider::OpenAi, "m-1"),
        "qualification: a finished receipt for the exact model qualifies",
        &mut passed,
    )?;
    check(
        !receipt_qualifies(&finished, Provider::OpenAi, "m-2")
            && !receipt_qualifies(&finished, Provider::Anthropic, "m-1"),
        "qualification: another model or provider does not",
        &mut passed,
    )?;
    check(
        !receipt_qualifies(&good, Provider::OpenAi, "m-1"),
        "qualification: an unfinished receipt does not",
        &mut passed,
    )?;
    let stopped = format!("{finished}{{\"kind\":\"qualification_stopped\"}}\n");
    check(
        !receipt_qualifies(&stopped, Provider::OpenAi, "m-1"),
        "qualification: a stopped receipt does not",
        &mut passed,
    )?;
    Ok(passed)
}
