//! What happened, read back from the durable records after the worker has
//! stopped: model turns and their outcomes, every work-product draft and why
//! a refused one was refused (from the platform's feedback in the next turn
//! of the same cycle), the recorded versions, and the assessment records,
//! scored against the known truth.
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use zobba_application::model::wire::StoredOutcome;
use zobba_domain::{
    citation::CitedAnswer,
    model::{Completion, EventKind, TransportOutcome},
    work_product::Refusal,
};

use crate::meter::completion_word;
use crate::truth::Truth;

/// The firm template of the engagement: (section, required).
pub const TEMPLATE_SECTIONS: &[(&str, bool)] = &[("objective", true), ("results", false), ("conclusion", true)];

#[derive(Clone, Debug, Serialize)]
pub struct RefusalLine {
    pub block: Option<u32>,
    pub reason: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct DraftAttempt {
    pub cycle: String,
    pub turn: i32,
    pub invocation_id: String,
    pub title: String,
    pub template: String,
    pub base_version: Option<String>,
    pub blocks: usize,
    pub recorded: bool,
    pub recorded_version: Option<i32>,
    pub refusals: Vec<RefusalLine>,
    /// Whether a later turn of the same cycle carried the platform's feedback
    /// on this draft (the feedback lives only within one cycle run).
    pub feedback_seen: bool,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct VersionRow {
    pub id: String,
    pub product_id: String,
    pub version: i32,
    pub author_kind: String,
    pub invocation_id: Option<String>,
    pub claims: i32,
    pub missing_required: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SetScore {
    pub truth: usize,
    pub predicted: usize,
    pub true_positives: usize,
    pub false_positives: usize,
    pub false_negatives: usize,
    pub precision: Option<f64>,
    pub recall: Option<f64>,
    pub missed: Vec<String>,
    pub unexpected: Vec<String>,
}

fn score(predicted: &BTreeSet<String>, truth: &BTreeSet<String>) -> SetScore {
    let tp = predicted.intersection(truth).count();
    let fp = predicted.difference(truth).count();
    let fn_ = truth.difference(predicted).count();
    SetScore {
        truth: truth.len(),
        predicted: predicted.len(),
        true_positives: tp,
        false_positives: fp,
        false_negatives: fn_,
        precision: (!predicted.is_empty()).then(|| tp as f64 / predicted.len() as f64),
        recall: (!truth.is_empty()).then(|| tp as f64 / truth.len() as f64),
        missed: truth.difference(predicted).take(50).cloned().collect(),
        unexpected: predicted.difference(truth).take(50).cloned().collect(),
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct CriterionView {
    pub id: String,
    pub key: String,
    pub kind: String,
    pub assertion: String,
    /// The harness's guess of which finding the criterion tests (keywords of
    /// its key, assertion, rule and rubric): approval, approval_timing,
    /// segregation or other. A heuristic, stated as such.
    pub category: String,
    pub not_met: usize,
    pub met: usize,
    pub undetermined: usize,
}

#[derive(Debug, Default, Serialize)]
pub struct Analysis {
    pub model_turns: usize,
    pub model_turns_by_status: BTreeMap<String, usize>,
    pub invocations: usize,
    pub outcomes_by_completion: BTreeMap<String, usize>,
    pub db_input_tokens: u64,
    pub db_output_tokens: u64,
    pub db_unknown_usage: usize,
    pub drafts: Vec<DraftAttempt>,
    pub refusals_by_reason: BTreeMap<String, usize>,
    pub drafts_with_unknown_refusals: usize,
    pub drafts_until_first_recorded: Option<usize>,
    pub versions: Vec<VersionRow>,
    pub latest: Option<VersionRow>,
    pub latest_blocks: Vec<Value>,
    pub sections: Value,
    pub criteria: Vec<CriterionView>,
    pub correctness: Value,
    pub key_figures: Value,
    pub errors: Vec<String>,
    /// The failing turns' recorded labels (fixed platform words).
    pub failed_turns: Vec<String>,
}

type Pool = sqlx::PgPool;

fn sql(context: &str) -> impl Fn(sqlx::Error) -> String + '_ {
    move |error| format!("{context}: {error}")
}

/// One line of the platform's draft feedback ("block 3: unsupported_figure —
/// words (detail)" or "the draft: template_unbound — words (detail)").
pub fn parse_refusal(line: &str) -> Option<RefusalLine> {
    let line = line.trim().trim_start_matches("- ");
    let (head, rest) = line.split_once(" — ")?;
    let (target, reason) = head.rsplit_once(": ")?;
    let reason = Refusal::parse(reason.trim())?;
    let block = match target.trim() {
        "the draft" => None,
        other => Some(other.strip_prefix("block ")?.trim().parse::<u32>().ok()?),
    };
    let detail = rest
        .rfind(" (")
        .map(|i| rest[i + 2..].trim_end_matches(')').to_string())
        .unwrap_or_default();
    Some(RefusalLine {
        block,
        reason: reason.as_str().into(),
        detail,
    })
}

/// The draft lines of one feedback message: whether a version was recorded
/// (`Some(true)`), refused (`Some(false)`) or neither named, and the refusals.
pub fn parse_feedback(text: &str) -> (Option<bool>, Vec<RefusalLine>) {
    let mut recorded = None;
    let mut refusals = Vec::new();
    for raw in text.lines() {
        let line = raw.trim().trim_start_matches("- ");
        if line.starts_with("Work product ") && line.contains(") was recorded") {
            recorded = Some(true);
        } else if line.starts_with("Proposal ") && line.contains(" was recorded") {
            recorded = Some(true);
        } else if line.starts_with("The work-product draft was not recorded")
            || line.starts_with("The proposal was not recorded")
        {
            recorded = Some(false);
            if line.contains("platform's own check disagreed") {
                refusals.push(RefusalLine {
                    block: None,
                    reason: "platform_check_disagreed".into(),
                    detail: String::new(),
                });
            } else if line.contains("exceed the platform's bound") {
                refusals.push(RefusalLine {
                    block: None,
                    reason: "platform_write_bound".into(),
                    detail: String::new(),
                });
            }
        } else if let Some(refusal) = parse_refusal(line) {
            refusals.push(refusal);
        }
    }
    (recorded, refusals)
}

/// Every text of a message whose source is the assessment feedback, found
/// anywhere in a stored request document.
fn feedback_texts(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if map.get("source_id").and_then(Value::as_str) == Some("assessment-feedback")
                && let Some(text) = map.get("text").and_then(Value::as_str)
            {
                out.push(text.to_string());
            }
            for field in map.values() {
                feedback_texts(field, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|v| feedback_texts(v, out)),
        _ => {}
    }
}

fn answer_of(outcome: &TransportOutcome) -> Option<CitedAnswer> {
    if outcome.completion != Completion::Succeeded {
        return None;
    }
    outcome.events.iter().find_map(|event| match &event.kind {
        EventKind::Structured { value, .. } => CitedAnswer::from_json(value),
        _ => None,
    })
}

fn category(document: &Value) -> String {
    let text = format!(
        "{} {} {} {} {}",
        document["key"], document["assertion"], document["rule"], document["rubric"], document["required_facts"]
    )
    .to_ascii_lowercase();
    if text.contains("segregat") || text.contains("requester") || text.contains("requested") {
        "segregation"
    } else if text.contains("before") && (text.contains("payment") || text.contains("paid")) {
        "approval_timing"
    } else if text.contains("approv") {
        "approval"
    } else {
        "other"
    }
    .into()
}

/// The first array under a key `criteria` whose items name a `criterion_id`.
fn criteria_counts(value: &Value) -> Option<Vec<Value>> {
    match value {
        Value::Object(map) => {
            if let Some(Value::Array(items)) = map.get("criteria")
                && items.iter().all(|i| i.get("criterion_id").is_some())
            {
                return Some(items.clone());
            }
            map.values().find_map(criteria_counts)
        }
        Value::Array(items) => items.iter().find_map(criteria_counts),
        _ => None,
    }
}

pub async fn analyse(pool: &Pool, task_id: &str, cycles: &[String], truth: &Truth) -> Analysis {
    let mut analysis = Analysis::default();
    if let Err(error) = analyse_into(&mut analysis, pool, task_id, cycles, truth).await {
        analysis.errors.push(error);
    }
    analysis
}

async fn analyse_into(
    a: &mut Analysis,
    pool: &Pool,
    task_id: &str,
    cycles: &[String],
    truth: &Truth,
) -> Result<(), String> {
    // ---------------------------------------------------------- model turns
    let mut turns: Vec<(String, i32, String, Option<String>, String)> = sqlx::query_as(
        "SELECT cycle_id, ordinal, status, invocation_id, current_work FROM public.task_steps WHERE task_id=$1 AND kind='model_turn'",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .map_err(sql("task steps"))?;
    let cycle_rank = |cycle: &str| cycles.iter().position(|c| c == cycle).unwrap_or(usize::MAX);
    turns.sort_by(|x, y| (cycle_rank(&x.0), x.1).cmp(&(cycle_rank(&y.0), y.1)));
    a.model_turns = turns.len();
    for turn in &turns {
        *a.model_turns_by_status.entry(turn.2.clone()).or_default() += 1;
        if turn.2 == "failed" {
            a.failed_turns.push(turn.4.clone());
        }
    }

    // ------------------------------------------------- invocations, outcomes
    let rows: Vec<(String, Value, Option<Value>)> = sqlx::query_as(
        "SELECT i.id, i.request, r.document FROM public.model_invocations i LEFT JOIN public.model_results r ON r.invocation_id=i.id WHERE i.task_id=$1",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .map_err(sql("model invocations"))?;
    a.invocations = rows.len();
    let mut requests: BTreeMap<String, Value> = BTreeMap::new();
    let mut outcomes: BTreeMap<String, TransportOutcome> = BTreeMap::new();
    for (id, request, result) in rows {
        match result {
            None => *a.outcomes_by_completion.entry("no_recorded_outcome".into()).or_default() += 1,
            Some(document) => match serde_json::from_value::<StoredOutcome>(document) {
                Ok(StoredOutcome(outcome)) => {
                    *a.outcomes_by_completion
                        .entry(completion_word(&outcome.completion))
                        .or_default() += 1;
                    match (outcome.usage.input_tokens, outcome.usage.output_tokens) {
                        (Some(input), Some(output)) => {
                            a.db_input_tokens += input;
                            a.db_output_tokens += output;
                        }
                        _ => a.db_unknown_usage += 1,
                    }
                    outcomes.insert(id.clone(), outcome);
                }
                Err(error) => a.errors.push(format!("outcome of {id} could not be decoded: {error}")),
            },
        }
        requests.insert(id, request);
    }

    // ------------------------------------------------------------- versions
    let versions: Vec<(String, String, i32, String, Option<String>, i32, Vec<String>)> = sqlx::query_as(
        "SELECT id, product_id, version, author_kind, invocation_id, claims, missing_required FROM public.work_product_versions WHERE task_id=$1 ORDER BY created_us, version",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .map_err(sql("work-product versions"))?;
    a.versions = versions
        .into_iter()
        .map(|(id, product_id, version, author_kind, invocation_id, claims, missing_required)| VersionRow {
            id,
            product_id,
            version,
            author_kind,
            invocation_id,
            claims,
            missing_required,
        })
        .collect();
    a.latest = a.versions.last().cloned();

    // --------------------------------------------------------------- drafts
    for (index, turn) in turns.iter().enumerate() {
        let Some(invocation) = &turn.3 else { continue };
        let Some(answer) = outcomes.get(invocation).and_then(answer_of) else {
            continue;
        };
        for draft in &answer.draft_work_product {
            let recorded = a
                .versions
                .iter()
                .find(|v| v.invocation_id.as_deref() == Some(invocation.as_str()));
            let mut attempt = DraftAttempt {
                cycle: turn.0.clone(),
                turn: turn.1,
                invocation_id: invocation.clone(),
                title: draft.title.clone(),
                template: format!("{}:{}", draft.template_id, draft.template_version),
                base_version: draft.base_version.clone(),
                blocks: draft.blocks.len(),
                recorded: recorded.is_some(),
                recorded_version: recorded.map(|v| v.version),
                refusals: vec![],
                feedback_seen: false,
                note: None,
            };
            if !attempt.recorded {
                let next = turns[index + 1..]
                    .iter()
                    .find(|t| t.0 == turn.0 && t.3.is_some())
                    .and_then(|t| t.3.as_ref())
                    .and_then(|id| requests.get(id));
                let mut texts = Vec::new();
                if let Some(request) = next {
                    feedback_texts(request, &mut texts);
                }
                for text in &texts {
                    let (said, refusals) = parse_feedback(text);
                    if said.is_some() || !refusals.is_empty() {
                        attempt.feedback_seen = true;
                    }
                    if said == Some(true) {
                        attempt.note = Some("the feedback says something was recorded (a proposal or a version not linked to this answer)".into());
                    }
                    attempt.refusals.extend(refusals);
                }
                if !attempt.feedback_seen {
                    attempt.note = Some("no later turn of this cycle carried the platform's feedback (the cycle ended after this answer): the refusal reasons are unknown".into());
                }
            }
            a.drafts.push(attempt);
        }
    }
    for draft in &a.drafts {
        if !draft.recorded && !draft.feedback_seen {
            a.drafts_with_unknown_refusals += 1;
        }
        for refusal in &draft.refusals {
            *a.refusals_by_reason.entry(refusal.reason.clone()).or_default() += 1;
        }
    }
    a.drafts_until_first_recorded = a.drafts.iter().position(|d| d.recorded).map(|i| i + 1);

    // ---------------------------------------- latest version: blocks, claims
    let mut wp_text = String::new();
    let mut figures = json!({});
    if let Some(latest) = &a.latest {
        let blocks: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT block_id, kind, section_id, coalesce(body,'') FROM public.work_product_blocks WHERE version_id=$1 ORDER BY ordinal",
        )
        .bind(&latest.id)
        .fetch_all(pool)
        .await
        .map_err(sql("work-product blocks"))?;
        let mut with_content: BTreeSet<String> = BTreeSet::new();
        for (_, kind, section, body) in &blocks {
            if kind != "limitations" {
                with_content.insert(section.clone());
            }
            wp_text.push_str(body);
            wp_text.push('\n');
        }
        a.latest_blocks = blocks
            .iter()
            .map(|(id, kind, section, body)| json!({"block": id, "kind": kind, "section": section, "text": body}))
            .collect();
        a.sections = json!({
            "template": TEMPLATE_SECTIONS.iter().map(|(id, required)| json!({"id": id, "required": required})).collect::<Vec<_>>(),
            "with_content": with_content,
            "required_missing": latest.missing_required,
            "required_done": TEMPLATE_SECTIONS.iter().filter(|(id, required)| *required && !latest.missing_required.iter().any(|m| m.as_str() == *id)).map(|(id, _)| *id).collect::<Vec<_>>(),
        });
        let assertions: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
            "SELECT kind, coalesce(measure,''), value, coalesce(criterion_id,''), record_kind, record_id FROM public.work_product_assertions WHERE version_id=$1 ORDER BY block_id, ordinal",
        )
        .bind(&latest.id)
        .fetch_all(pool)
        .await
        .map_err(sql("work-product assertions"))?;
        let count = |measure: &str, value: &str| {
            assertions
                .iter()
                .any(|x| x.0 == "count" && x.1 == measure && x.2 == value)
        };
        let conclusions: Vec<&String> = assertions.iter().filter(|x| x.0 == "conclusion").map(|x| &x.2).collect();
        // Subjects of outcome claims, through their evaluation or revision.
        let mut outcome_claims = Vec::new();
        for x in assertions.iter().filter(|x| x.0 == "outcome") {
            let table = if x.4 == "revision" {
                "public.assessment_evaluation_revisions"
            } else {
                "public.assessment_evaluations"
            };
            let subject: Option<String> = sqlx::query_scalar(&format!("SELECT subject FROM {table} WHERE id=$1"))
                .bind(&x.5)
                .fetch_optional(pool)
                .await
                .map_err(sql("outcome subjects"))?;
            outcome_claims.push(json!({"subject": subject, "stated": x.2}));
        }
        figures = json!({
            "states_applicable_1000": count("applicable", "1000"),
            "states_not_approved_15": count("not_met", "15"),
            "states_after_payment_12": count("not_met", "12"),
            "states_undetermined_10": count("undetermined", "10"),
            "states_conclusion": conclusions,
            "outcome_claims": outcome_claims,
            "assertions": assertions.len(),
        });
    }

    // ------------------------------------------------------------- criteria
    let criteria: Vec<(String, String, Value)> = sqlx::query_as(
        "SELECT id, kind, document FROM public.assessment_criteria WHERE task_id=$1 ORDER BY created_us",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .map_err(sql("criteria"))?;
    let category_of: BTreeMap<String, String> = criteria
        .iter()
        .map(|(id, _, document)| (id.clone(), category(document)))
        .collect();

    // Effective verdicts: an evaluation's latest revision, else itself; and
    // the opportunities of every population no later version supersedes.
    let evaluations: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT e.criterion_id, e.subject, CASE WHEN r.id IS NULL THEN e.verdict ELSE r.verdict END FROM public.assessment_evaluations e LEFT JOIN LATERAL (SELECT x.id, x.verdict FROM public.assessment_evaluation_revisions x WHERE x.chain_id=e.id ORDER BY x.revision DESC LIMIT 1) r ON true WHERE e.task_id=$1",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .map_err(sql("evaluations"))?;
    let opportunities: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT o.criterion_id, o.subject, o.verdict FROM public.assessment_opportunities o WHERE o.task_id=$1 AND NOT EXISTS(SELECT 1 FROM public.assessment_populations p WHERE p.supersedes=o.population_id)",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .map_err(sql("opportunities"))?;
    let verdicts: Vec<(String, String, String)> = evaluations
        .into_iter()
        .chain(opportunities)
        .filter_map(|(criterion, subject, verdict)| verdict.map(|v| (criterion, subject, v)))
        .collect();
    a.criteria = criteria
        .iter()
        .map(|(id, kind, document)| {
            let mine = |v: &str| verdicts.iter().filter(|x| &x.0 == id && x.2 == v).count();
            CriterionView {
                id: id.clone(),
                key: document["key"].as_str().unwrap_or_default().into(),
                kind: kind.clone(),
                assertion: document["assertion"].as_str().unwrap_or_default().chars().take(300).collect(),
                category: category_of[id].clone(),
                not_met: mine("not_met"),
                met: mine("met"),
                undetermined: mine("undetermined"),
            }
        })
        .collect();

    let mut not_met: BTreeSet<String> = BTreeSet::new();
    let mut undetermined: BTreeSet<String> = BTreeSet::new();
    let mut met: BTreeSet<String> = BTreeSet::new();
    let mut by_finding: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
    for (criterion, subject, verdict) in &verdicts {
        let category = category_of.get(criterion).map(String::as_str).unwrap_or("other");
        match verdict.as_str() {
            "not_met" => {
                not_met.insert(subject.clone());
                let finding = if truth.is_population(subject) {
                    match category {
                        "approval" => Some("population_not_approved"),
                        "approval_timing" => Some("population_after_payment"),
                        _ => None,
                    }
                } else if truth.is_listing(subject) {
                    Some(if category == "segregation" {
                        "listing_segregation"
                    } else {
                        "listing_missing_approver"
                    })
                } else {
                    None
                };
                if let Some(finding) = finding {
                    by_finding.entry(finding).or_default().insert(subject.clone());
                }
            }
            "undetermined" => {
                undetermined.insert(subject.clone());
            }
            "met" => {
                met.insert(subject.clone());
            }
            _ => {}
        }
    }
    let empty = BTreeSet::new();
    let truths: [(&str, &BTreeSet<String>); 4] = [
        ("population_not_approved", &truth.population_not_approved),
        ("population_after_payment", &truth.population_after_payment),
        ("listing_missing_approver", &truth.listing_missing_approver),
        ("listing_segregation", &truth.listing_segregation),
    ];
    let findings: BTreeMap<&str, SetScore> = truths
        .iter()
        .map(|(name, set)| (*name, score(by_finding.get(name).unwrap_or(&empty), set)))
        .collect();
    let all = truth.all_exceptions();
    let overall = score(&not_met, &all);
    let unknown_subjects: Vec<&String> = not_met
        .iter()
        .filter(|s| !truth.is_population(s) && !truth.is_listing(s))
        .take(50)
        .collect();
    let exceptions: Vec<(String,)> = sqlx::query_as("SELECT subject FROM public.assessment_exceptions WHERE task_id=$1")
        .bind(task_id)
        .fetch_all(pool)
        .await
        .map_err(sql("exceptions"))?;
    let exception_subjects: BTreeSet<String> = exceptions.into_iter().map(|(s,)| s).collect();
    a.correctness = json!({
        "method": "A subject is predicted as an exception when its effective verdict (latest revision, else the evaluation; population opportunities of current populations) is not_met under any criterion. Truth comes from the fixture generator's rules. Per-finding sets use the criterion's category (a keyword heuristic over the criterion) and the subject's document.",
        "overall": overall,
        "findings": findings,
        "undetermined_items": {
            "truth": truth.population_undetermined.len(),
            "left_undetermined": truth.population_undetermined.intersection(&undetermined).count(),
            "flagged_not_met": truth.population_undetermined.intersection(&not_met).count(),
            "judged_met_only": truth.population_undetermined.iter().filter(|s| met.contains(*s) && !not_met.contains(*s) && !undetermined.contains(*s)).count(),
        },
        "false_positive_kinds": {
            "undetermined_flagged": truth.population_undetermined.intersection(&not_met).count(),
            "segregation_passes_flagged": truth.listing_segregation_pass.intersection(&not_met).count(),
            "unknown_subjects": unknown_subjects,
        },
        "exception_records": {
            "subjects": exception_subjects.len(),
            "true": exception_subjects.intersection(&all).count(),
            "false": exception_subjects.difference(&all).count(),
        },
    });

    // ------------------------------------------- key figures vs. the truth
    let populations: Vec<(String, String, String, i32, i32, i32, i32, i32, String, bool)> = sqlx::query_as(
        "SELECT p.id, coalesce(p.document->>'key',''), p.original_id, p.received_rows, p.duplicate_rows, p.distinct_subjects, p.excluded_out_of_period, p.in_scope, p.reconciliation, EXISTS(SELECT 1 FROM public.assessment_populations q WHERE q.supersedes=p.id) FROM public.assessment_populations p WHERE p.task_id=$1 ORDER BY p.created_us",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .map_err(sql("populations"))?;
    let expected = &truth.expected;
    let populations: Vec<Value> = populations
        .iter()
        .map(|p| json!({
            "id": p.0, "key": p.1, "original": p.2, "superseded": p.9,
            "received_rows": p.3, "duplicate_rows": p.4, "distinct_subjects": p.5,
            "excluded_out_of_period": p.6, "in_scope": p.7, "reconciliation": p.8,
            "matches_truth": expected["received_rows"].as_i64() == Some(p.3 as i64)
                && expected["duplicate_rows"].as_i64() == Some(p.4 as i64)
                && expected["distinct_subjects"].as_i64() == Some(p.5 as i64)
                && expected["excluded_out_of_period"].as_i64() == Some(p.6 as i64)
                && expected["in_scope"].as_i64() == Some(p.7 as i64),
        }))
        .collect();
    #[allow(clippy::type_complexity)]
    let summaries: Vec<(String, String, String, String, i32, i32, i32, i32, i32, i32, i32, i32, Value)> = sqlx::query_as(
        "SELECT id, population_id, conclusion, reconciliation, received_rows, duplicate_rows, distinct_subjects, excluded_out_of_period, in_scope, failing_subjects, unresolved_subjects, meets_every_applicable, document FROM public.assessment_summaries WHERE task_id=$1 ORDER BY created_us",
    )
    .bind(task_id)
    .fetch_all(pool)
    .await
    .map_err(sql("summaries"))?;
    let summaries: Vec<Value> = summaries
        .iter()
        .map(|s| {
            let criteria: Vec<Value> = criteria_counts(&s.12)
                .unwrap_or_default()
                .iter()
                .map(|k| {
                    let id = k["criterion_id"].as_str().unwrap_or_default();
                    let category = category_of.get(id).cloned().unwrap_or_else(|| "other".into());
                    let wanted = match category.as_str() {
                        "approval" => Some(&expected["a"]),
                        "approval_timing" => Some(&expected["b"]),
                        _ => None,
                    };
                    let matches = wanted.map(|w| {
                        k["applicable"] == expected["applicable"]
                            && k["met"] == w["met"]
                            && k["not_met"] == w["not_met"]
                            && k["undetermined"] == w["undetermined"]
                    });
                    json!({"criterion_id": id, "category": category, "applicable": k["applicable"], "met": k["met"], "not_met": k["not_met"], "undetermined": k["undetermined"], "matches_truth": matches})
                })
                .collect();
            json!({
                "id": s.0, "population_id": s.1, "conclusion": s.2, "reconciliation": s.3,
                "received_rows": s.4, "duplicate_rows": s.5, "distinct_subjects": s.6,
                "excluded_out_of_period": s.7, "in_scope": s.8, "failing_subjects": s.9,
                "unresolved_subjects": s.10, "meets_every_applicable": s.11,
                "conclusion_matches_truth": expected["conclusion"].as_str() == Some(s.2.as_str()),
                "counts_match_truth": expected["failing"].as_i64() == Some(s.9 as i64)
                    && expected["unresolved"].as_i64() == Some(s.10 as i64)
                    && expected["meets_every_applicable"].as_i64() == Some(s.11 as i64),
                "criteria": criteria,
            })
        })
        .collect();
    let lowered = wp_text.to_ascii_lowercase();
    a.key_figures = json!({
        "expected": expected,
        "populations": populations,
        "summaries": summaries,
        "work_product": figures,
        "work_product_text_mentions": truth.data_quality.iter().map(|(name, fact, words)| json!({
            "fact": name, "truth": fact,
            "mentioned": words.iter().any(|w| lowered.contains(w)),
        })).collect::<Vec<_>>(),
        "mentions_method": "Indicative keyword checks over the latest version's block texts; the version view's limitations are checked in the result as well.",
    });
    Ok(())
}

/// Keyword checks of the recorded limitations (from the version view).
pub fn limitation_mentions(truth: &Truth, limitations: &[String]) -> Value {
    let text = limitations.join("\n").to_ascii_lowercase();
    json!(truth
        .data_quality
        .iter()
        .map(|(name, _, words)| json!({"fact": name, "mentioned": words.iter().any(|w| text.contains(w))}))
        .collect::<Vec<_>>())
}
