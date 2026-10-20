//! The disposition request is strict at the boundary; refusals carry their
//! exact code (and the head or the reference index); a chain head's review
//! state is derived, never stored; a reference quote is withheld from a
//! viewer who cannot read its original now.
use super::*;
use zobba_application::assessment::{EvaluationRecord, revision::RevisionRecord};
use zobba_domain::{
    assessment::{Applicability, Execution, Origin, Outcome},
    revision::{Changes, RevisionCause},
};

const SHA: &str = "aa00000000000000000000000000000000000000000000000000000000000000";

fn body(kind: &str) -> DispositionCommandRequest {
    DispositionCommandRequest {
        key: "k1".into(),
        kind: kind.into(),
        concern: (kind == "needs_reconsideration").then(|| "facts".into()),
        verdict: (kind == "replaced").then(|| "not_met".into()),
        rationale: "The approver signed after payment.".into(),
        references: vec![DispositionReferenceRequest {
            original_id: "ap-policy".into(),
            locator: "bytes:0-48".into(),
            quote: "Invoices above 1,000.00 USD require an approver.".into(),
        }],
    }
}
fn rev() -> String {
    format!("eval-{}", "1".repeat(40))
}

#[test]
fn each_kind_decodes_with_its_own_fields_only() {
    for kind in ["accepted", "replaced", "needs_reconsideration"] {
        assert!(command(rev(), body(kind)).is_some(), "{kind}");
    }
    let mut b = body("accepted");
    b.kind = "waived".into();
    assert!(command(rev(), b).is_none(), "no waiver kind");
    let mut b = body("accepted");
    b.concern = Some("facts".into());
    assert!(
        command(rev(), b).is_none(),
        "a concern only for reconsideration"
    );
    let mut b = body("needs_reconsideration");
    b.concern = Some("mood".into());
    assert!(command(rev(), b).is_none(), "a closed concern");
    let mut b = body("replaced");
    b.verdict = Some("passed".into());
    assert!(command(rev(), b).is_none(), "a closed verdict");
}

#[test]
fn a_rationale_over_two_thousand_bytes_and_a_non_canonical_locator_are_refused() {
    let mut b = body("accepted");
    b.rationale = "é".repeat(1_001);
    assert!(command(rev(), b).is_none(), "2,002 bytes");
    let mut b = body("accepted");
    b.references[0].locator = "bytes:00-48".into();
    assert!(command(rev(), b).is_none(), "not canonical");
    let mut b = body("accepted");
    b.references = (0..9)
        .map(|i| DispositionReferenceRequest {
            original_id: "ap-policy".into(),
            locator: format!("bytes:{i}-{}", i + 1),
            quote: "I".into(),
        })
        .collect();
    assert!(command(rev(), b).is_none(), "nine references");
}

#[test]
fn a_disposition_body_refuses_unknown_fields() {
    let parsed: Result<DispositionCommandRequest, _> = serde_json::from_str(
        r#"{"key":"k1","kind":"accepted","concern":null,"verdict":null,"rationale":"x","references":[],"confidence":"0.9"}"#,
    );
    assert!(parsed.is_err());
}

async fn status_and_body(response: Response) -> (u16, serde_json::Value) {
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 16)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn each_refusal_has_its_status_code_and_detail() {
    let head = format!("rev-{}", "2".repeat(40));
    let cases = [
        (DispositionError::Invalid, 400, "disposition_invalid"),
        (DispositionError::NotReplaceable, 400, "not_replaceable"),
        (DispositionError::NotDecidable, 400, "verdict_not_decidable"),
        (DispositionError::Capacity, 409, "disposition_capacity"),
        (
            DispositionError::ReferenceUnverified(3),
            409,
            "reference_unverified",
        ),
        (
            DispositionError::RevisionSuperseded(head.clone()),
            409,
            "revision_superseded",
        ),
        (DispositionError::NotFound, 404, "revision_not_found"),
        (DispositionError::Denied, 403, "access_denied"),
        (DispositionError::Conflict, 409, "disposition_conflict"),
        (
            DispositionError::Unavailable,
            503,
            "disposition_unavailable",
        ),
    ];
    for (error, status, code) in cases {
        let (got, value) = status_and_body(refusal(error)).await;
        assert_eq!((got, value["error"].as_str()), (status, Some(code)));
    }
    let (_, value) = status_and_body(refusal(DispositionError::ReferenceUnverified(3))).await;
    assert_eq!(value["index"], 3);
    let (_, value) =
        status_and_body(refusal(DispositionError::RevisionSuperseded(head.clone()))).await;
    assert_eq!(value["head_id"], head.as_str());
}

fn outcome(origin: Origin) -> Outcome {
    Outcome {
        applicability: Applicability::Applicable,
        execution: Execution::Completed,
        verdict: Some(Verdict::Met),
        reason: None,
        origin,
        inputs: vec![(format!("fact-{}", "3".repeat(40)), SHA.into())],
    }
}
fn first(origin: Origin) -> EvaluationRecord {
    let mut e = EvaluationRecord {
        id: rev(),
        task_id: "task-1".into(),
        cycle_id: "cycle-1".into(),
        invocation_id: "inv-1".into(),
        ordinal: 0,
        methodology_binding_id: "binding-1".into(),
        execution_epoch: 1,
        basis_id: format!("basis-{}", "4".repeat(40)),
        criterion_id: format!("crit-{}", "5".repeat(40)),
        subject: "INV-0042".into(),
        outcome: outcome(origin),
        judgment: (origin == Origin::ModelProposal).then(|| {
            zobba_application::assessment::JudgmentDetail {
                rubric_criterion_id: format!("crit-{}", "5".repeat(40)),
                supporting: vec![],
                contrary: vec![],
                rationale: "Different managers.".into(),
                uncertainty: String::new(),
            }
        }),
        output_digest: String::new(),
        recorded_us: Some(1),
    };
    e.output_digest = e.computed_digest();
    e
}
fn disposition(kind: DispositionKind, revision_id: &str) -> DispositionRecord {
    let request = DispositionRequest {
        key: "k1".into(),
        revision_id: revision_id.into(),
        kind,
        concern: (kind == DispositionKind::NeedsReconsideration).then_some(Concern::Rule),
        verdict: (kind == DispositionKind::Replaced).then_some(Verdict::NotMet),
        rationale: "Reason.".into(),
        references: vec![CitationSource {
            original_id: "ap-policy".into(),
            locator: Locator::parse("bytes:0-6"),
            quote: "Invoic".into(),
        }],
    };
    DispositionRecord {
        id: format!("disp-{}", "6".repeat(40)),
        task_id: "task-1".into(),
        actor_id: "auditor-7".into(),
        chain_id: rev(),
        revision: 1,
        references: vec![(request.references[0].clone(), SHA.into())],
        request,
        digest: String::new(),
        recorded_us: Some(2),
    }
}

#[test]
fn a_replaced_model_proposal_shows_the_human_verdict_and_keeps_the_model_one() {
    let head = ChainHead {
        first: first(Origin::ModelProposal),
        head: None,
        disposition: Some(disposition(DispositionKind::Replaced, &rev())),
    };
    let c = chain_response(&head, Some("Alex".into()), false, &Originals::new());
    assert_eq!(
        c.verdict.as_deref(),
        Some("met"),
        "the revision is unchanged"
    );
    assert_eq!(c.effective_verdict.as_deref(), Some("not_met"));
    assert_eq!(
        (c.effective_origin.as_str(), c.review.as_str()),
        ("human", "replaced")
    );
    let d = c.disposition.unwrap();
    assert_eq!(d.actor_label.as_deref(), Some("Alex"));
    // The viewer cannot read the referenced original: its quote is withheld.
    assert!(!d.references[0].readable);
    assert_eq!(d.references[0].quote, None);
}

#[test]
fn a_reference_quote_is_shown_to_a_viewer_who_can_read_the_original() {
    let head = ChainHead {
        first: first(Origin::Deterministic),
        head: None,
        disposition: Some(disposition(DispositionKind::Accepted, &rev())),
    };
    let originals = Originals::from([(
        "ap-policy".to_string(),
        ViewerOriginal {
            filename: Some("AP policy.txt".into()),
            version: "v1".into(),
            sha256: SHA.into(),
        },
    )]);
    let c = chain_response(&head, None, false, &originals);
    assert_eq!(c.review, "accepted");
    assert_eq!(c.effective_origin, "deterministic");
    let d = c.disposition.unwrap();
    assert!(d.references[0].readable);
    assert_eq!(d.references[0].quote.as_deref(), Some("Invoic"));
}

#[test]
fn a_new_revision_after_an_accepted_one_is_unreviewed_and_says_so() {
    let mut r = RevisionRecord {
        id: format!("rev-{}", "7".repeat(40)),
        task_id: "task-1".into(),
        cycle_id: "cycle-1".into(),
        invocation_id: "inv-2".into(),
        ordinal: 0,
        methodology_binding_id: "binding-1".into(),
        execution_epoch: 1,
        chain_id: rev(),
        revision: 2,
        predecessor_id: rev(),
        basis_id: format!("basis-{}", "4".repeat(40)),
        criterion_id: format!("crit-{}", "5".repeat(40)),
        subject: "INV-0042".into(),
        outcome: outcome(Origin::Deterministic),
        judgment: None,
        output_digest: String::new(),
        causes: vec![RevisionCause::InputsChanged],
        changes: Changes {
            added: vec![format!("fact-{}", "3".repeat(40))],
            ..Default::default()
        },
        revision_digest: String::new(),
        recorded_us: Some(3),
    };
    r.output_digest = r.computed_digest();
    r.revision_digest = r.computed_revision_digest();
    let head = ChainHead {
        first: first(Origin::Deterministic),
        head: Some(r.clone()),
        disposition: None,
    };
    let c = chain_response(&head, None, true, &Originals::new());
    assert_eq!(
        (c.revision.as_str(), c.head_id.as_str()),
        ("2", r.id.as_str())
    );
    assert_eq!(c.review, "unreviewed");
    assert!(c.earlier_accepted);
    assert_eq!(c.causes, vec!["inputs_changed"]);
}

#[test]
fn a_history_page_withholds_values_and_quotes_the_viewer_cannot_read_now() {
    use zobba_application::assessment::revision::{HistoryEntry, HistoryPage};
    let first = first(Origin::Deterministic);
    let page = HistoryPage {
        chain_id: first.id.clone(),
        subject: first.subject.clone(),
        total: 1,
        head_id: first.id.clone(),
        entries: vec![HistoryEntry::first(
            &first,
            vec![(
                disposition(DispositionKind::Accepted, &rev()),
                "Alex".into(),
            )],
        )],
        next: None,
        facts: vec![crate::work::tests::fact()],
    };
    // A viewer who cannot read either original: the fact value and the
    // reference quote are withheld.
    let hidden = history_response(&page, &Originals::new());
    assert!(hidden.facts[0].value_withheld);
    assert!(hidden.facts[0].value.is_none());
    let reference = &hidden.entries[0].dispositions[0].references[0];
    assert!(!reference.readable && reference.quote.is_none());
    let text = serde_json::to_string(&hidden).unwrap();
    assert!(
        !text.contains("1,250.00") && !text.contains("Invoic"),
        "{text}"
    );
    // The exact originals, readable now: both are shown.
    let readable = Originals::from([
        (
            "ap-invoices".to_string(),
            ViewerOriginal {
                filename: Some("AP invoices.xlsx".into()),
                version: "v1".into(),
                sha256: "a".repeat(64),
            },
        ),
        (
            "ap-policy".to_string(),
            ViewerOriginal {
                filename: Some("AP policy.txt".into()),
                version: "v1".into(),
                sha256: SHA.into(),
            },
        ),
    ]);
    let shown = history_response(&page, &readable);
    assert!(!shown.facts[0].value_withheld);
    assert_eq!(
        shown.entries[0].dispositions[0].references[0]
            .quote
            .as_deref(),
        Some("Invoic")
    );
}
