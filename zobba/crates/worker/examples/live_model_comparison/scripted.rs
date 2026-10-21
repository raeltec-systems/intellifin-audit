//! Scripted mode: a loopback OpenAI-wire provider whose reply to request `n`
//! is computed from the database, as in `crates/worker/tests/work_product.rs`
//! (copied, not shared, so that file stays untouched). It names records and
//! writes sentences; it never sends a checked value it was not shown. The
//! script records the coverage, two judgments, one refused draft, one
//! recorded draft and one draft on an unbound template, then answers.
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

pub type Responder = Arc<
    dyn Fn(usize, String) -> std::pin::Pin<Box<dyn std::future::Future<Output = Vec<u8>> + Send>>
        + Send
        + Sync,
>;

pub struct Loopback {
    pub endpoint: String,
    pub sends: Arc<AtomicUsize>,
    _task: tokio::task::JoinHandle<()>,
}
impl Loopback {
    pub async fn answering(responder: Responder) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/native", listener.local_addr().unwrap());
        let sends = Arc::new(AtomicUsize::new(0));
        let count = sends.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mut buffer = vec![0u8; 16 << 20];
                let mut total = 0;
                let mut body = String::new();
                loop {
                    let n = socket.read(&mut buffer[total..]).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    total += n;
                    let text = String::from_utf8_lossy(&buffer[..total]);
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end]
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .and_then(|v| v.parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if total >= end + 4 + length {
                            body = String::from_utf8_lossy(&buffer[end + 4..end + 4 + length])
                                .into_owned();
                            break;
                        }
                    }
                }
                let index = count.fetch_add(1, Ordering::SeqCst);
                let reply = responder(index, body).await;
                let _ = socket.write_all(&reply).await;
                let _ = socket.shutdown().await;
            }
        });
        Self {
            endpoint,
            sends,
            _task: task,
        }
    }
}

fn sse_reply(mut values: Vec<serde_json::Value>) -> Vec<u8> {
    for (sequence, value) in values.iter_mut().enumerate() {
        value["sequence_number"] = serde_json::json!(sequence);
    }
    let body: String = values
        .iter()
        .map(|v| {
            format!(
                "event: {}\r\ndata: {v}\r\n\r\n",
                v["type"].as_str().unwrap()
            )
        })
        .collect();
    format!(
        "HTTP/1.1 200 Fixture\r\nContent-Type: text/event-stream; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}
fn text_reply(text: &str) -> Vec<u8> {
    use serde_json::json;
    let part = json!({"type":"output_text","text":text});
    let item = json!({"id":"message-1","type":"message","role":"assistant","status":"completed","content":[part.clone()]});
    sse_reply(vec![
        json!({"type":"response.created","response":{"id":"response-1","model":"fixture-model","status":"in_progress"}}),
        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"message-1","type":"message","role":"assistant","status":"in_progress","content":[]}}),
        json!({"type":"response.content_part.added","output_index":0,"item_id":"message-1","content_index":0,"part":{"type":"output_text","text":""}}),
        json!({"type":"response.output_text.delta","output_index":0,"item_id":"message-1","content_index":0,"delta":text}),
        json!({"type":"response.output_text.done","output_index":0,"item_id":"message-1","content_index":0,"text":text}),
        json!({"type":"response.content_part.done","output_index":0,"item_id":"message-1","content_index":0,"part":part}),
        json!({"type":"response.output_item.done","output_index":0,"item":item.clone()}),
        json!({"type":"response.completed","response":{"id":"response-1","model":"fixture-model","status":"completed","output":[item],"usage":{"input_tokens":17,"output_tokens":4}}}),
    ])
}

/// One structured answer with every field present (strict output).
fn answer(fields: serde_json::Value) -> String {
    let mut value = serde_json::json!({
        "segments": [], "limitations": [], "read_pages": [], "programs": [],
        "read_method": [], "use_skills": [], "run_skill_script": [], "method_notes": [],
        "propose_criteria": [], "propose_basis": [], "record_facts": [], "evaluate": [], "judgments": [],
        "propose_population": [], "propose_sample": [], "evaluate_population": [], "summarise": [], "carry_facts": [],
        "summarise_effective": [], "draft_work_product": [],
    });
    for (key, field) in fields.as_object().unwrap() {
        value[key] = field.clone();
    }
    value.to_string()
}
fn predicate(kind: &str, fact: &str, op: &str, constant: &str, currency: &str) -> serde_json::Value {
    serde_json::json!({"kind": kind, "fact": fact, "op": op, "right_fact": "", "constant": constant, "unit": "", "currency": currency, "values": []})
}
fn none() -> serde_json::Value {
    predicate("", "", "", "", "")
}
fn required(name: &str, kind: &str, currency: &str) -> serde_json::Value {
    serde_json::json!({"name": name, "type": kind, "unit": "", "currency": currency})
}
#[allow(clippy::too_many_arguments)]
fn criterion(
    key: &str,
    assertion: &str,
    authority: (&str, &str, &str, &str),
    applicability: serde_json::Value,
    required_facts: Vec<serde_json::Value>,
    method: &str,
    rule: serde_json::Value,
    rubric: &str,
) -> serde_json::Value {
    let (kind, requirement, locator, quote) = authority;
    serde_json::json!({
        "key": key, "supersedes": "", "assertion": assertion,
        "authority_kind": kind, "requirement_id": if kind == "method" { requirement } else { "" },
        "criterion_ordinal": 0,
        "original_id": if kind == "original" { requirement } else { "" },
        "locator": locator, "quote": quote,
        "effective_from": "", "effective_to": "",
        "applicability": applicability, "required_facts": required_facts,
        "method": method, "rule": rule, "rubric": rubric,
    })
}
#[allow(clippy::too_many_arguments)]
fn fact(
    basis: &str,
    subject: &str,
    name: &str,
    kind: &str,
    value: &str,
    currency: &str,
    rule: &str,
    sources: Vec<(&str, &str)>,
) -> serde_json::Value {
    serde_json::json!({
        "basis": basis, "subject": subject, "subject_unit": "invoice", "name": name,
        "value_kind": kind, "value": value, "unit": "", "currency": currency,
        "reason": "", "candidates": 0, "rule": rule,
        "sources": sources.iter().map(|(locator, quote)| serde_json::json!({"original_id": "ap-invoices", "locator": locator, "quote": quote})).collect::<Vec<_>>(),
        "job_id": "", "effective": "",
    })
}
/// The rows of `AP invoices.xlsx` Sheet1 the script cites: (subject, row).
const ROWS: &[(&str, u32)] = &[
    ("INV-0042", 2),
    ("000123", 3),
    ("INV-0054", 4),
    ("INV-0055", 5),
    ("INV-0050", 6),
    ("INV-0051", 7),
    ("INV-0052", 8),
    ("INV-0053", 9),
    ("INV-0057", 10),
];
fn row(subject: &str) -> u32 {
    ROWS.iter().find(|(s, _)| *s == subject).unwrap().1
}
fn invoice(basis: &str, subject: &str) -> serde_json::Value {
    let cell = format!("cell:Sheet1!A{}", row(subject));
    fact(basis, subject, "invoice", "identifier", subject, "", "identifier_exact", vec![(&cell, subject)])
}
fn judgment(criterion: &str, basis: &str, subject: &str, verdict: &str, supporting: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "criterion": criterion, "basis": basis, "subject": subject, "verdict": verdict,
        "supporting": supporting, "contrary": [],
        "rationale": format!("The evidence for {subject} shows who approved it and who requested it."),
        "uncertainty": "The organisation chart in the evidence is dated 2025.",
    })
}
fn column(header: &str, name: &str, kind: &str, rule: &str, currency: &str, measure: &str) -> serde_json::Value {
    serde_json::json!({"header": header, "name": name, "type": kind, "rule": rule, "unit": "", "currency": currency, "measure_column": measure})
}
fn population(key: &str, basis: &str, sheet: &str, header_row: u32, exhaustive: bool, control: Option<(&str, &str)>) -> serde_json::Value {
    let (locator, quote) = control.unwrap_or(("", ""));
    serde_json::json!({
        "key": key, "basis": basis, "supersedes": "", "original_id": "ap-population",
        "sheet": sheet, "header_row": header_row, "subject_unit": "invoice", "grain": ["Invoice"],
        "period_column": "Invoice date", "period_rule": "date_iso",
        "value_columns": [
            column("Amount", "amount", "decimal", "decimal_grouped_comma", "USD", "Currency"),
            column("Approved", "approved", "boolean", "boolean_yes_no", "", ""),
            column("Approved before payment", "approved_before_payment", "boolean", "boolean_yes_no", "", ""),
        ],
        "exhaustive": exhaustive,
        "control_original_id": if control.is_some() { "ap-population" } else { "" },
        "control_locator": locator, "control_quote": quote,
        "control_rule": if control.is_some() { "decimal_grouped_comma" } else { "" },
        "selection": format!("Every invoice row of the {sheet} sheet"),
    })
}
fn assertion(kind: &str, record: &str, measure: &str, detail: &str, value: &str) -> serde_json::Value {
    serde_json::json!({"kind": kind, "record": record, "measure": measure, "detail": detail, "value": value})
}
fn block(kind: &str, section: &str, text: &str, record: &str, assertions: Vec<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({"kind": kind, "section": section, "text": text, "record": record, "assertions": assertions})
}
fn draft(title: &str, template: &str, base: &str, blocks: Vec<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({"title": title, "kind": "working_paper", "template": template, "base": base, "request": "", "blocks": blocks})
}
pub const POLICY_QUOTE: &str = "Invoices above 1,000.00 USD require an approver.";
fn quote_assertion() -> serde_json::Value {
    assertion("quote", "ap-policy", "", "bytes:0-48", POLICY_QUOTE)
}

async fn criterion_id(lookup: &sqlx::PgPool, task_id: &str, key: &str) -> String {
    sqlx::query_scalar("SELECT id FROM public.assessment_criteria WHERE task_id=$1 AND document->>'key'=$2")
        .bind(task_id)
        .bind(key)
        .fetch_one(lookup)
        .await
        .unwrap()
}
async fn basis_id(lookup: &sqlx::PgPool, task_id: &str, key: &str) -> String {
    sqlx::query_scalar("SELECT id FROM public.assessment_bases WHERE task_id=$1 AND document->>'key'=$2")
        .bind(task_id)
        .bind(key)
        .fetch_one(lookup)
        .await
        .unwrap()
}
async fn summary_id(lookup: &sqlx::PgPool, task_id: &str) -> String {
    sqlx::query_scalar("SELECT id FROM public.assessment_summaries WHERE task_id=$1 ORDER BY created_us LIMIT 1")
        .bind(task_id)
        .fetch_one(lookup)
        .await
        .unwrap()
}
async fn evaluation_of(lookup: &sqlx::PgPool, task_id: &str, subject: &str) -> String {
    sqlx::query_scalar("SELECT id FROM public.assessment_evaluations WHERE task_id=$1 AND subject=$2")
        .bind(task_id)
        .bind(subject)
        .fetch_one(lookup)
        .await
        .unwrap()
}

const C1: &str = "15 of 1,000 applicable invoices had no recorded approver.";
const C2: &str = "Segregation of duties was not met for INV-0042.";
const C3: &str = "INV-0055 did not meet the segregation criterion.";
const C4: &str = "The policy requires an approver above 1,000.00 USD.";
const C5: &str = "The coverage summary concludes that exceptions were found and the result is inconclusive.";

/// The number of model calls the script makes before its Task waits.
pub const SCRIPTED_CALLS: usize = 7;

/// What the scripted run must produce (checked in `report::scripted_expectations`).
pub const EXPECTED_REFUSALS: &[&str] = &[
    "unsupported_figure",
    "count_mismatch",
    "figure_in_narrative",
    "verdict_without_record",
    "outcome_mismatch",
    "section_unknown",
    "template_unbound",
];

pub fn responder(lookup: sqlx::PgPool, task_id: String) -> Responder {
    Arc::new(
        move |index: usize,
              _body: String|
              -> std::pin::Pin<Box<dyn std::future::Future<Output = Vec<u8>> + Send>> {
        let lookup = lookup.clone();
        let task_id = task_id.clone();
        Box::pin(async move {
            let rule = |fact: &str| predicate("is_true", fact, "", "", "");
            let over = predicate("compare_constant", "amount", "gt", "1000.00", "USD");
            match index {
                // 1: two rule criteria over the full AP population and its summary.
                0 => text_reply(&answer(serde_json::json!({
                    "propose_criteria": [
                        criterion("approver", "Invoices above 1,000.00 USD require an approver", ("method", "AP-1", "", ""),
                            over.clone(), vec![required("amount", "decimal", "USD"), required("approved", "boolean", "")],
                            "rule", rule("approved"), ""),
                        criterion("before", "Invoices above 1,000.00 USD are approved before payment", ("method", "AP-1", "", ""),
                            over.clone(), vec![required("amount", "decimal", "USD"), required("approved_before_payment", "boolean", "")],
                            "rule", rule("approved_before_payment"), ""),
                    ],
                    "propose_basis": [{
                        "key": "fy2026", "supersedes": "", "objective": "Test approval of every 2026 AP invoice",
                        "criteria": ["approver", "before"],
                        "period_from": "2026-01-01", "period_to": "2026-12-31", "as_of": "",
                        "population": [{"original_id": "ap-population", "unit": "invoice", "selection": "Every invoice in the AP export"}],
                        "limitations": [],
                    }],
                    "propose_population": [population("ap", "fy2026", "Invoices", 3, true, Some(("cell:Summary!B1", "1,250")))],
                    "evaluate_population": [{"criterion": "approver", "population": "ap"}, {"criterion": "before", "population": "ap"}],
                    "summarise": [{"basis": "fy2026", "population": "ap", "sample": ""}],
                }))),
                // 2: a judgment criterion on its own basis, and two invoice identifiers.
                1 => text_reply(&answer(serde_json::json!({
                    "propose_criteria": [
                        criterion("segregation", "Segregation of duties is adequate given the organisation chart", ("method", "AP-1", "", ""),
                            none(), vec![], "judgment", none(), "The approver and the requester report to different managers"),
                    ],
                    "propose_basis": [{
                        "key": "seg2026", "supersedes": "", "objective": "Judge segregation of duties for two invoices",
                        "criteria": ["segregation"],
                        "period_from": "2026-01-01", "period_to": "2026-12-31", "as_of": "",
                        "population": [{"original_id": "ap-invoices", "unit": "invoice", "selection": "Two invoices of the AP export"}],
                        "limitations": ["The organisation chart is dated 2025."],
                    }],
                    "record_facts": [invoice("seg2026", "INV-0042"), invoice("seg2026", "INV-0055")],
                }))),
                // 3: two judgments, each not met (INV-0042 is a true failure,
                // INV-0055 a false one, so the dry run scores both kinds).
                2 => {
                    let b = basis_id(&lookup, &task_id, "seg2026").await;
                    let s = criterion_id(&lookup, &task_id, "segregation").await;
                    text_reply(&answer(serde_json::json!({
                        "judgments": [
                            judgment(&s, &b, "INV-0042", "not_met", &["invoice"]),
                            judgment(&s, &b, "INV-0055", "not_met", &["invoice"]),
                        ],
                    })))
                }
                // 4: a draft every check refuses (nothing is recorded), beside
                // a fact so the work continues and the feedback is delivered.
                3 => {
                    let (a, s, b) = (
                        criterion_id(&lookup, &task_id, "approver").await,
                        summary_id(&lookup, &task_id).await,
                        basis_id(&lookup, &task_id, "seg2026").await,
                    );
                    let e42 = evaluation_of(&lookup, &task_id, "INV-0042").await;
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [invoice(&b, "INV-0054")],
                        "draft_work_product": [draft("AP approvals working paper", "ap-wp:1", "", vec![
                            block("heading", "objective", "Approval testing", "", vec![]),
                            block("claim", "results", "14 of 1,000 applicable invoices had no recorded approver.", "", vec![
                                assertion("count", &s, "not_met", &a, "15"),
                                assertion("count", &s, "applicable", &a, "1000"),
                            ]),
                            block("claim", "results", "15 invoices had no recorded approver.", "", vec![assertion("count", &s, "not_met", &a, "14")]),
                            block("judgment", "results", "About 20 items failed.", "", vec![]),
                            block("claim", "results", "The control passed.", "", vec![quote_assertion()]),
                            block("claim", "results", "INV-0042 met the criterion.", "", vec![assertion("outcome", &e42, "", "", "met")]),
                            block("narrative", "nowhere", "A section the template does not have.", "", vec![]),
                        ])],
                    })))
                }
                // 5: the working paper on the bound firm template (recorded).
                4 => {
                    let (a, s, f) = (
                        criterion_id(&lookup, &task_id, "approver").await,
                        summary_id(&lookup, &task_id).await,
                        basis_id(&lookup, &task_id, "fy2026").await,
                    );
                    let (e42, e55) = (
                        evaluation_of(&lookup, &task_id, "INV-0042").await,
                        evaluation_of(&lookup, &task_id, "INV-0055").await,
                    );
                    text_reply(&answer(serde_json::json!({
                        "draft_work_product": [draft("AP approvals working paper", "ap-wp:1", "", vec![
                            block("heading", "objective", "Approval testing", "", vec![]),
                            block("narrative", "objective", "Test whether every invoice above the threshold was approved.", "", vec![]),
                            block("judgment", "results", "Approvals appear weak across the population; segregation needs a closer look.", "", vec![]),
                            block("claim", "results", C1, "", vec![
                                assertion("count", &s, "not_met", &a, "15"),
                                assertion("count", &s, "applicable", &a, "1000"),
                            ]),
                            block("coverage", "results", "", &s, vec![]),
                            block("claim", "results", C2, "", vec![assertion("outcome", &e42, "", "", "not_met")]),
                            block("claim", "results", C3, "", vec![assertion("outcome", &e55, "", "", "not_met")]),
                            block("claim", "results", C4, "", vec![quote_assertion()]),
                            block("claim", "results", C5, "", vec![assertion("conclusion", &s, "", "", "exceptions_found_inconclusive")]),
                            block("exceptions", "results", "", &f, vec![]),
                        ])],
                    })))
                }
                // 6: a new work product on a template the binding does not hold.
                5 => {
                    let b = basis_id(&lookup, &task_id, "seg2026").await;
                    text_reply(&answer(serde_json::json!({
                        "record_facts": [invoice(&b, "INV-0050")],
                        "draft_work_product": [draft("Another paper", "other:1", "", vec![
                            block("heading", "objective", "Approval testing", "", vec![]),
                        ])],
                    })))
                }
                _ => text_reply(&answer(serde_json::json!({
                    "segments": [{"text": "The working paper is drafted.", "sources": []}],
                }))),
            }
        })
    },
    )
}
