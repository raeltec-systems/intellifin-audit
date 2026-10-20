use super::*;
use crate::assessment::{Applicability, EvaluationReason};

fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
    items
        .iter()
        .map(|(n, i)| ((*n).into(), (*i).into()))
        .collect()
}
fn fact(n: u8) -> String {
    format!("fact-{}", format!("{n:02x}").repeat(20))
}
fn step<'a>(
    basis: &'a str,
    criterion: &'a str,
    execution: Execution,
    inputs: &'a [(String, String)],
) -> Step<'a> {
    Step {
        basis_id: basis,
        criterion_id: criterion,
        execution,
        inputs,
    }
}

#[test]
fn changes_name_added_removed_and_replaced_fact_ids() {
    let before = pairs(&[("amount", &fact(1)), ("currency", &fact(2))]);
    let after = pairs(&[("amount", &fact(3)), ("approver", &fact(4))]);
    let c = changes(&before, &after);
    assert_eq!(c.added, vec![fact(4)]);
    assert_eq!(c.removed, vec![fact(2)]);
    assert_eq!(c.replaced, vec![(fact(1), fact(3))]);
    assert!(c.is_valid());
    // A carried fact keeps its ID: carrying alone changes nothing.
    assert!(changes(&before, &before).is_empty());
}

#[test]
fn late_evidence_is_inputs_changed_only() {
    let before = pairs(&[("amount", &fact(1))]);
    let after = pairs(&[("amount", &fact(1)), ("approver", &fact(2))]);
    let a = step("basis-1", "crit-1", Execution::Completed, &before);
    let b = step("basis-1", "crit-1", Execution::Completed, &after);
    assert_eq!(causes(&a, &b, false), vec![RevisionCause::InputsChanged]);
}

#[test]
fn a_corrected_fact_in_a_successor_basis_is_basis_revised_and_inputs_changed() {
    let before = pairs(&[("amount", &fact(1))]);
    let after = pairs(&[("amount", &fact(2))]);
    let a = step("basis-1", "crit-1", Execution::Completed, &before);
    let b = step("basis-2", "crit-1", Execution::Completed, &after);
    assert_eq!(
        causes(&a, &b, false),
        vec![RevisionCause::InputsChanged, RevisionCause::BasisRevised]
    );
    // Carried facts and the same criterion: only the basis changed.
    let carried = step("basis-2", "crit-1", Execution::Completed, &before);
    assert_eq!(
        causes(&a, &carried, false),
        vec![RevisionCause::BasisRevised]
    );
}

#[test]
fn a_new_criterion_version_is_criterion_revised() {
    let inputs = pairs(&[("amount", &fact(1))]);
    let a = step("basis-1", "crit-1", Execution::Completed, &inputs);
    let b = step("basis-1", "crit-2", Execution::Completed, &inputs);
    assert_eq!(causes(&a, &b, false), vec![RevisionCause::CriterionRevised]);
}

#[test]
fn a_failed_execution_followed_by_a_completed_one_is_prior_execution_failed() {
    let inputs = pairs(&[("amount", &fact(1))]);
    let failed = step("basis-1", "crit-1", Execution::Failed, &inputs);
    let completed = step("basis-1", "crit-1", Execution::Completed, &inputs);
    assert_eq!(
        causes(&failed, &completed, false),
        vec![RevisionCause::PriorExecutionFailed]
    );
    // The same failure again is no cause: nothing is recorded.
    assert!(causes(&failed, &failed, false).is_empty());
}

#[test]
fn a_reconsideration_request_is_a_cause_by_itself() {
    let inputs = pairs(&[("amount", &fact(1))]);
    let a = step("basis-1", "crit-1", Execution::Completed, &inputs);
    assert_eq!(
        causes(&a, &a, true),
        vec![RevisionCause::ReconsiderationRequested]
    );
    assert!(causes(&a, &a, false).is_empty(), "no change, no cause");
}

#[test]
fn causes_are_valid_only_sorted_distinct_and_not_empty() {
    assert!(causes_valid(&[
        RevisionCause::InputsChanged,
        RevisionCause::BasisRevised
    ]));
    assert!(!causes_valid(&[]));
    assert!(!causes_valid(&[
        RevisionCause::BasisRevised,
        RevisionCause::InputsChanged
    ]));
    assert!(!causes_valid(&[
        RevisionCause::InputsChanged,
        RevisionCause::InputsChanged
    ]));
}

#[test]
fn the_revision_digest_is_deterministic_and_covers_each_part() {
    let c = Changes {
        added: vec![fact(4)],
        ..Default::default()
    };
    let base = revision_digest(
        "eval-1",
        2,
        "eval-1",
        &[RevisionCause::InputsChanged],
        &c,
        &"a".repeat(64),
    );
    assert_eq!(
        base,
        revision_digest(
            "eval-1",
            2,
            "eval-1",
            &[RevisionCause::InputsChanged],
            &c,
            &"a".repeat(64)
        )
    );
    assert_ne!(
        base,
        revision_digest(
            "eval-1",
            3,
            "eval-1",
            &[RevisionCause::InputsChanged],
            &c,
            &"a".repeat(64)
        )
    );
    assert_ne!(
        base,
        revision_digest(
            "eval-1",
            2,
            "eval-1",
            &[RevisionCause::BasisRevised],
            &c,
            &"a".repeat(64)
        )
    );
    assert_ne!(
        base,
        revision_digest(
            "eval-1",
            2,
            "eval-1",
            &[RevisionCause::InputsChanged],
            &Changes::default(),
            &"a".repeat(64)
        )
    );
    assert_ne!(
        base,
        revision_digest(
            "eval-1",
            2,
            "eval-1",
            &[RevisionCause::InputsChanged],
            &c,
            &"b".repeat(64)
        )
    );
}

#[test]
fn changes_round_trip_and_refuse_a_malformed_document() {
    let c = Changes {
        added: vec![fact(4)],
        removed: vec![fact(2)],
        replaced: vec![(fact(1), fact(3))],
    };
    assert_eq!(Changes::from_document(&c.document()), Some(c.clone()));
    let mut doc = c.document();
    if let JsonValue::Object(map) = &mut doc {
        map.insert("extra".into(), JsonValue::Null);
    }
    assert_eq!(Changes::from_document(&doc), None, "an unknown key");
    let same = Changes {
        replaced: vec![(fact(1), fact(1))],
        ..Default::default()
    };
    assert!(!same.is_valid(), "a replacement names two different facts");
}

fn outcome(origin: Origin, verdict: Verdict) -> Outcome {
    Outcome {
        applicability: Applicability::Applicable,
        execution: Execution::Completed,
        verdict: Some(verdict),
        reason: None,
        origin,
        inputs: vec![(fact(1), "a".repeat(64))],
    }
}

#[test]
fn no_disposition_is_unreviewed() {
    let e = effective(&outcome(Origin::ModelProposal, Verdict::Met), None);
    assert_eq!(e.review, ReviewState::Unreviewed);
    assert_eq!(e.verdict, Some(Verdict::Met));
    assert_eq!(e.origin, EffectiveOrigin::ModelProposal);
}

#[test]
fn a_replaced_model_proposal_takes_the_human_verdict() {
    let e = effective(
        &outcome(Origin::ModelProposal, Verdict::Met),
        Some(Decision {
            kind: DispositionKind::Replaced,
            verdict: Some(Verdict::NotMet),
        }),
    );
    assert_eq!(e.verdict, Some(Verdict::NotMet));
    assert_eq!(e.origin, EffectiveOrigin::Human);
    assert_eq!(e.review, ReviewState::Replaced);
}

#[test]
fn a_deterministic_head_is_never_replaced_even_if_a_replaced_row_existed() {
    let e = effective(
        &outcome(Origin::Deterministic, Verdict::Met),
        Some(Decision {
            kind: DispositionKind::Replaced,
            verdict: Some(Verdict::NotMet),
        }),
    );
    assert_eq!(e.verdict, Some(Verdict::Met));
    assert_eq!(e.origin, EffectiveOrigin::Deterministic);
}

#[test]
fn accepted_keeps_the_verdict_and_reconsideration_is_pending() {
    let head = outcome(Origin::Deterministic, Verdict::NotMet);
    let accepted = effective(
        &head,
        Some(Decision {
            kind: DispositionKind::Accepted,
            verdict: None,
        }),
    );
    assert_eq!(
        (accepted.verdict, accepted.review),
        (Some(Verdict::NotMet), ReviewState::Accepted)
    );
    let pending = effective(
        &head,
        Some(Decision {
            kind: DispositionKind::NeedsReconsideration,
            verdict: None,
        }),
    );
    assert_eq!(
        (pending.verdict, pending.review),
        (Some(Verdict::NotMet), ReviewState::PendingReconsideration)
    );
}

fn request(kind: DispositionKind) -> DispositionRequest {
    DispositionRequest {
        key: "key-1".into(),
        revision_id: format!("eval-{}", "a".repeat(40)),
        kind,
        concern: (kind == DispositionKind::NeedsReconsideration).then_some(Concern::Facts),
        verdict: (kind == DispositionKind::Replaced).then_some(Verdict::NotMet),
        rationale: "The approver signed after payment.".into(),
        references: vec![CitationSource {
            original_id: "ap-policy".into(),
            locator: Locator::parse("bytes:0-48"),
            quote: "Invoices above 2,000.00 USD require two approvers.".into(),
        }],
    }
}

#[test]
fn each_disposition_kind_is_valid_with_its_own_fields_only() {
    for kind in DispositionKind::ALL {
        assert!(request(*kind).is_valid(), "{kind:?}");
    }
    let mut r = request(DispositionKind::Accepted);
    r.concern = Some(Concern::Rule);
    assert!(
        !r.is_valid(),
        "a concern belongs to needs_reconsideration only"
    );
    let mut r = request(DispositionKind::NeedsReconsideration);
    r.concern = None;
    assert!(!r.is_valid(), "needs_reconsideration names its concern");
    let mut r = request(DispositionKind::Accepted);
    r.verdict = Some(Verdict::Met);
    assert!(!r.is_valid(), "only replaced carries a verdict");
    let mut r = request(DispositionKind::Replaced);
    r.verdict = None;
    assert!(!r.is_valid(), "replaced names the person's verdict");
}

#[test]
fn a_rationale_is_one_to_two_thousand_bytes() {
    let mut r = request(DispositionKind::Accepted);
    r.rationale = "é".repeat(1_000); // 2,000 bytes
    assert!(r.is_valid());
    r.rationale.push('x');
    assert!(!r.is_valid(), "2,001 bytes");
    r.rationale = "  ".into();
    assert!(!r.is_valid(), "blank");
    r.rationale = "a\u{0}b".into();
    assert!(!r.is_valid(), "a control character");
}

#[test]
fn references_are_at_most_eight_distinct_located_quotes() {
    let mut r = request(DispositionKind::Accepted);
    r.references = (0..8)
        .map(|i| CitationSource {
            original_id: "ap-policy".into(),
            locator: Locator::parse(&format!("bytes:{i}-{}", i + 4)),
            quote: "Invo".into(),
        })
        .collect();
    assert!(r.is_valid());
    r.references.push(CitationSource {
        original_id: "ap-policy".into(),
        locator: Locator::parse("bytes:20-24"),
        quote: "Invo".into(),
    });
    assert!(!r.is_valid(), "nine references");
    let mut r = request(DispositionKind::Accepted);
    r.references.push(r.references[0].clone());
    assert!(!r.is_valid(), "a repeated reference");
    let mut r = request(DispositionKind::Accepted);
    r.references[0].locator = None;
    assert!(!r.is_valid(), "a reference names its exact location");
}

#[test]
fn a_revision_id_is_an_evaluation_or_a_revision() {
    assert!(valid_revision_id(&format!("eval-{}", "0".repeat(40))));
    assert!(valid_revision_id(&format!("rev-{}", "f".repeat(40))));
    assert!(!valid_revision_id(&format!("crit-{}", "0".repeat(40))));
    assert!(!valid_revision_id(&format!("rev-{}", "F".repeat(40))));
    assert!(!valid_revision_id("rev-1"));
}

#[test]
fn a_deterministic_revision_cannot_be_replaced() {
    let r = request(DispositionKind::Replaced);
    assert_eq!(
        r.check(Origin::Deterministic),
        Err(DispositionRefusal::NotReplaceable)
    );
    assert_eq!(r.check(Origin::ModelProposal), Ok(()));
    assert_eq!(
        request(DispositionKind::Accepted).check(Origin::Deterministic),
        Ok(())
    );
    assert_eq!(
        request(DispositionKind::NeedsReconsideration).check(Origin::Deterministic),
        Ok(())
    );
}

#[test]
fn a_disposition_document_round_trips() {
    let r = request(DispositionKind::Replaced);
    let refs: Vec<(CitationSource, String)> = r
        .references
        .iter()
        .map(|s| (s.clone(), "c".repeat(64)))
        .collect();
    let doc = disposition_document("disp-1", "task-1", "actor-a", &r, "eval-x", 1, &refs);
    let (back, back_refs) = disposition_from(&doc).unwrap();
    assert_eq!(back, r);
    assert_eq!(back_refs, refs);
}

#[test]
fn carry_facts_decode_and_bound_their_exceptions() {
    let entry = |subject: &str, name: &str| {
        JsonValue::Object(BTreeMap::from([
            ("subject".into(), s(subject)),
            ("name".into(), s(name)),
        ]))
    };
    let value = |except: Vec<JsonValue>| {
        JsonValue::Object(BTreeMap::from([
            ("basis".into(), s("fy2026-v2")),
            ("except".into(), JsonValue::Array(except)),
        ]))
    };
    let carry = decode_carry(&value(vec![entry("INV-0042", "amount")])).unwrap();
    assert_eq!(carry.except, vec![("INV-0042".into(), "amount".into())]);
    assert!(
        decode_carry(&value(vec![entry("INV-0042", "Amount")])).is_none(),
        "a fact name is lower case"
    );
    assert!(
        decode_carry(&value(vec![
            entry("INV-1", "amount"),
            entry("INV-1", "amount")
        ]))
        .is_none(),
        "a repeated exception"
    );
    let many: Vec<JsonValue> = (0..65)
        .map(|i| entry(&format!("INV-{i}"), "amount"))
        .collect();
    assert!(decode_carry(&value(many)).is_none(), "65 exceptions");
    let fields = answer_fields();
    let ArgumentSchema::Array { max_items, .. } = &fields[0].1 else {
        panic!("an array");
    };
    assert_eq!(*max_items as usize, MAX_CARRIES);
}

#[test]
fn an_undetermined_head_reason_does_not_change_its_causes() {
    // Causes read inputs, versions and execution only: a reason or verdict
    // difference alone is not a cause (trusted code records nothing).
    let inputs = pairs(&[("amount", &fact(1))]);
    let a = step("basis-1", "crit-1", Execution::Completed, &inputs);
    assert!(causes(&a, &a, false).is_empty());
    let _ = EvaluationReason::MissingFact;
}
