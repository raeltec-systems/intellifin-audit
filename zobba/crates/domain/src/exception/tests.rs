use super::*;
use crate::assessment::{Applicability, EvaluationReason};
use crate::coverage::{Completeness, IncompleteReason, PopulationCounts, Reconciliation};

fn digests(items: &[&str]) -> Vec<String> {
    items.iter().map(|d| (*d).into()).collect()
}
fn occurrence(seq: i64, at: i64, evidence: &[&str]) -> Occurrence {
    Occurrence {
        seq,
        at_us: at,
        criterion_id: "crit-a".into(),
        evidence: digests(evidence),
    }
}
fn chain(
    at: i64,
    verdict: Option<Verdict>,
    causes: &[RevisionCause],
    evidence: &[&str],
) -> Observation {
    Observation {
        kind: ObservationKind::Chain,
        id: format!("rev-{at}"),
        at_us: at,
        verdict,
        execution: Some(Execution::Completed),
        origin: Some(EffectiveOrigin::ModelProposal),
        review: ReviewState::Unreviewed,
        causes: causes.to_vec(),
        criterion_id: Some("crit-a".into()),
        evidence: digests(evidence),
    }
}
/// A deterministic chain head (a rule evaluated per subject).
fn rule_chain(
    at: i64,
    verdict: Option<Verdict>,
    causes: &[RevisionCause],
    evidence: &[&str],
) -> Observation {
    Observation {
        origin: Some(EffectiveOrigin::Deterministic),
        ..chain(at, verdict, causes, evidence)
    }
}
fn accepted(mut o: Observation) -> Observation {
    o.review = ReviewState::Accepted;
    o
}
fn person(mut o: Observation, verdict: Verdict) -> Observation {
    o.verdict = Some(verdict);
    o.origin = Some(EffectiveOrigin::Human);
    o.review = ReviewState::Replaced;
    o
}
fn opportunity(
    at: i64,
    verdict: Option<Verdict>,
    criterion: &str,
    evidence: &[&str],
) -> Observation {
    Observation {
        kind: ObservationKind::Opportunity,
        id: format!("pop-{at}#{criterion}#0"),
        at_us: at,
        verdict,
        execution: Some(Execution::Completed),
        origin: Some(EffectiveOrigin::Deterministic),
        review: ReviewState::Unreviewed,
        causes: vec![],
        criterion_id: Some(criterion.into()),
        evidence: digests(evidence),
    }
}
fn absent(at: i64) -> Observation {
    Observation {
        kind: ObservationKind::Absent,
        id: format!("pop-{at}"),
        at_us: at,
        verdict: None,
        execution: None,
        origin: None,
        review: ReviewState::Unreviewed,
        causes: vec![],
        criterion_id: None,
        evidence: vec![],
    }
}
fn facts(occurrence: Occurrence, observations: Vec<Observation>) -> ExceptionFacts {
    ExceptionFacts {
        occurrences: vec![occurrence],
        decision: None,
        observations,
    }
}
use ExceptionStatus as S;
use LatestObserved as L;
use RevisionCause as C;

#[test]
fn a_failing_latest_observation_keeps_the_exception_open() {
    let f = facts(
        occurrence(1, 10, &["d1"]),
        vec![chain(10, Some(Verdict::NotMet), &[], &["d1"])],
    );
    assert_eq!(exception_status(&f), (S::Open, L::NotMet));
    assert_eq!(
        status_words(S::Open, L::NotMet),
        "Open: a current observation does not meet the criterion."
    );
}

#[test]
fn an_unobserved_latest_revision_keeps_it_open_and_is_not_remediation() {
    let failing = occurrence(1, 10, &["d1"]);
    // Undetermined, failed, not applicable or absent: never a resolution.
    let undetermined = chain(
        20,
        Some(Verdict::Undetermined),
        &[C::InputsChanged],
        &["d2"],
    );
    let mut failed = chain(21, None, &[C::InputsChanged], &["d2"]);
    failed.execution = Some(Execution::Failed);
    let not_applicable = chain(22, None, &[C::InputsChanged], &["d2"]);
    for latest in [undetermined, failed, not_applicable, absent(23)] {
        let f = facts(failing.clone(), vec![latest.clone()]);
        assert_eq!(
            exception_status(&f),
            (S::Open, L::NotObserved),
            "{latest:?}"
        );
    }
    // No observation at all (a lineage not yet read): still open.
    assert_eq!(
        exception_status(&facts(failing, vec![])),
        (S::Open, L::NotObserved)
    );
    let words = status_words(S::Open, L::NotObserved);
    assert!(words.contains(NOT_REMEDIATION), "{words}");
    assert_eq!(
        NOT_REMEDIATION,
        "not observed in the latest revision; this is not evidence of remediation"
    );
}

#[test]
fn a_later_deterministic_met_from_changed_inputs_resolves_it_by_evidence() {
    let failing = occurrence(1, 10, &["d1"]);
    for cause in [C::InputsChanged, C::BasisRevised] {
        let f = facts(
            failing.clone(),
            vec![rule_chain(20, Some(Verdict::Met), &[cause], &["d1", "d2"])],
        );
        assert_eq!(
            exception_status(&f),
            (S::ResolvedByEvidence, L::NotObserved),
            "{cause:?}"
        );
    }
}

/// Owner decision 2026-10-21: an unreviewed model proposal of `met` never
/// resolves an exception; a person's acceptance of it does.
#[test]
fn an_unreviewed_model_proposal_of_met_awaits_human_review() {
    let failing = occurrence(1, 10, &["d1"]);
    let proposal = chain(20, Some(Verdict::Met), &[C::InputsChanged], &["d1", "d2"]);
    assert_eq!(
        exception_status(&facts(failing.clone(), vec![proposal.clone()])),
        (S::Open, L::ProposedMet)
    );
    assert_eq!(
        status_words(S::Open, L::ProposedMet),
        "Open: a model proposal suggests this is met; awaiting human review."
    );
    // A pending reconsideration is not an acceptance either.
    let mut pending = proposal.clone();
    pending.review = ReviewState::PendingReconsideration;
    assert_eq!(
        exception_status(&facts(failing.clone(), vec![pending])),
        (S::Open, L::ProposedMet)
    );
    assert_eq!(
        exception_status(&facts(failing.clone(), vec![accepted(proposal)])),
        (S::ResolvedByEvidence, L::NotObserved)
    );
    // A proposal that would not resolve it even once accepted says only that
    // it was not observed failing.
    let same = chain(20, Some(Verdict::Met), &[C::InputsChanged], &["d1"]);
    assert_eq!(
        exception_status(&facts(failing, vec![same])),
        (S::Open, L::NotObserved)
    );
}

#[test]
fn a_met_that_is_not_new_evidence_never_resolves_it() {
    let failing = occurrence(1, 10, &["d1"]);
    // Only a revised criterion (the rule changed, not the evidence).
    let rule_only = rule_chain(20, Some(Verdict::Met), &[C::CriterionRevised], &["d2"]);
    // The same evidence read again.
    let same = rule_chain(20, Some(Verdict::Met), &[C::InputsChanged], &["d1"]);
    // Before the failing occurrence.
    let earlier = rule_chain(9, Some(Verdict::Met), &[C::InputsChanged], &["d2"]);
    // A first revision (no cause) of another chain.
    let first = rule_chain(20, Some(Verdict::Met), &[], &["d2"]);
    // Only a reconsideration or a completed retry.
    let asked = rule_chain(
        20,
        Some(Verdict::Met),
        &[C::ReconsiderationRequested, C::PriorExecutionFailed],
        &["d2"],
    );
    for latest in [rule_only, same, earlier, first, asked] {
        let f = facts(failing.clone(), vec![latest.clone()]);
        assert_eq!(exception_status(&f).0, S::Open, "{latest:?}");
        assert!(!resolves(&latest, &failing), "{latest:?}");
    }
    // A met whose execution failed cannot be read (never a resolution).
    let mut failed = rule_chain(20, Some(Verdict::Met), &[C::InputsChanged], &["d2"]);
    failed.execution = Some(Execution::Failed);
    assert!(!resolves(&failed, &failing));
}

/// A disposition saved later never makes an older result newer than the
/// failing occurrence (BH M1): the observation's time is its own.
#[test]
fn an_acceptance_saved_after_a_newer_failure_never_resolves_it() {
    // R2 met at 10 (deterministic, inputs changed); a later population read
    // fails at 20 (the newest occurrence); an acceptance of R2 at 30 leaves
    // R2's observation at 10.
    let r2 = accepted(rule_chain(
        10,
        Some(Verdict::Met),
        &[C::InputsChanged],
        &["d2"],
    ));
    let failing = occurrence(2, 20, &["m1"]);
    // The population read is no longer current (a later version holds no
    // rule observation for the subject): only R2 is observed.
    let f = facts(failing, vec![r2]);
    assert_eq!(exception_status(&f), (S::Open, L::NotObserved));
}

/// Every current observation counts (BH M2): a current deterministic
/// not_met keeps the exception open whatever the latest observation shows.
#[test]
fn any_current_failure_keeps_it_open() {
    let failing = occurrence(1, 10, &["d1"]);
    let still = opportunity(10, Some(Verdict::NotMet), "crit-a", &["d1"]);
    for latest in [
        rule_chain(20, Some(Verdict::Met), &[C::InputsChanged], &["d2"]),
        accepted(chain(20, Some(Verdict::Met), &[C::InputsChanged], &["d2"])),
        person(chain(20, None, &[], &["d2"]), Verdict::Met),
    ] {
        let f = facts(failing.clone(), vec![still.clone(), latest.clone()]);
        assert_eq!(exception_status(&f), (S::Open, L::NotMet), "{latest:?}");
    }
}

#[test]
fn a_later_population_read_of_the_same_criterion_resolves_it() {
    let failing = occurrence(1, 10, &["member-v1"]);
    let v2 = opportunity(30, Some(Verdict::Met), "crit-a", &["member-v2"]);
    let f = facts(failing.clone(), vec![v2]);
    assert_eq!(
        exception_status(&f),
        (S::ResolvedByEvidence, L::NotObserved)
    );
    // Another criterion version of the lineage is a changed rule, not evidence.
    let other = opportunity(30, Some(Verdict::Met), "crit-b", &["member-v2"]);
    assert_eq!(
        exception_status(&facts(failing.clone(), vec![other])).0,
        S::Open
    );
    // The same member digests again.
    let same = opportunity(30, Some(Verdict::Met), "crit-a", &["member-v1"]);
    assert_eq!(exception_status(&facts(failing, vec![same])).0, S::Open);
}

/// Owner decision 2026-10-21: only a person's `met` replaces the failing
/// judgment; a person's `undetermined` keeps it open.
#[test]
fn only_a_person_replacing_the_judgment_with_met_is_human_judgment() {
    let failing = occurrence(1, 10, &["d1"]);
    let met = person(chain(20, None, &[], &["d1"]), Verdict::Met);
    assert_eq!(
        exception_status(&facts(failing.clone(), vec![met])),
        (S::ReplacedByHumanJudgment, L::NotObserved)
    );
    let undetermined = person(chain(20, None, &[], &["d1"]), Verdict::Undetermined);
    assert_eq!(
        exception_status(&facts(failing.clone(), vec![undetermined])),
        (S::Open, L::PersonUndetermined)
    );
    assert_eq!(
        status_words(S::Open, L::PersonUndetermined),
        "Open: a person marked this undetermined; this is not evidence of remediation."
    );
    let not_met = person(chain(20, None, &[], &["d1"]), Verdict::NotMet);
    assert_eq!(
        exception_status(&facts(failing.clone(), vec![not_met])),
        (S::Open, L::NotMet)
    );
    // A person's met is never "new evidence".
    let met = person(chain(20, None, &[C::InputsChanged], &["d2"]), Verdict::Met);
    assert!(!resolves(&met, &failing));
}

#[test]
fn a_closure_stands_until_an_unseen_failure_reopens_it() {
    let observations = vec![chain(10, Some(Verdict::NotMet), &[], &["d1"])];
    let mut f = facts(occurrence(1, 10, &["d1"]), observations.clone());
    f.decision = Some((ExceptionDispositionKind::Closed, 2));
    assert_eq!(exception_status(&f), (S::ClosedByDisposition, L::NotMet));
    // A later failure on new evidence reopens it (derived, nothing stored).
    let mut later = f.clone();
    later.occurrences.push(occurrence(3, 5, &["d9"]));
    assert_eq!(exception_status(&later), (S::Open, L::NotMet));
    // Ordered by place, never by clock: a later occurrence with an earlier
    // time reopens it too (ECH M3).
    assert_eq!(later.occurrences[1].at_us, 5);
    // The same failure read again over identical evidence (a new population
    // version of an unchanged row) is one the closer saw: it stands (ECH M4).
    let mut again = f.clone();
    again.occurrences.push(occurrence(3, 30, &["d1"]));
    assert_eq!(exception_status(&again).0, S::ClosedByDisposition);
    // ...unless its criterion version changed.
    let mut revised = f.clone();
    let mut other = occurrence(3, 30, &["d1"]);
    other.criterion_id = "crit-b".into();
    revised.occurrences.push(other);
    assert_eq!(exception_status(&revised).0, S::Open);
    // A reopening is derived like no disposition at all.
    let mut reopened = facts(occurrence(1, 10, &["d1"]), observations);
    reopened.decision = Some((ExceptionDispositionKind::Reopened, 2));
    assert_eq!(exception_status(&reopened), (S::Open, L::NotMet));
    assert!(closure_stands(&[occurrence(1, 1, &["a"])], 2));
    assert!(!closure_stands(
        &[occurrence(1, 1, &["a"]), occurrence(3, 1, &["b"])],
        2
    ));
}

#[test]
fn the_latest_observation_is_the_greatest_time_then_id_in_byte_order() {
    let mut a = chain(20, Some(Verdict::Undetermined), &[], &["d1"]);
    a.id = "rev-B".into();
    let mut b = rule_chain(20, Some(Verdict::Met), &[C::InputsChanged], &["d2"]);
    b.id = "rev-a".into();
    // "rev-a" > "rev-B" in byte order: the met is the latest.
    assert_eq!(
        latest_observation(&[a.clone(), b.clone()]).unwrap().id,
        "rev-a"
    );
    assert_eq!(
        latest_observation(&[b.clone(), a.clone()]).unwrap().id,
        "rev-a"
    );
    assert!(latest_observation(&[]).is_none());
    let f = facts(occurrence(1, 10, &["d1"]), vec![a, b]);
    assert_eq!(exception_status(&f).0, S::ResolvedByEvidence);
}

#[test]
fn an_exception_id_is_derived_from_its_identity_and_the_database_agrees() {
    let root = format!("crit-{}", "a".repeat(40));
    let id = exception_id(
        "org-a",
        "client-a",
        "engagement-a",
        "task-1",
        &root,
        "INV-0042",
    );
    // sha256("exc|org-a|client-a|engagement-a|task-1|<root>|criterion_not_met|INV-0042"),
    // computed independently with Python's hashlib.
    assert_eq!(id, "exc-156827a7d813f2042702f78532dc208dff613e87");
    assert!(valid_exception_id(&id));
    assert_ne!(
        id,
        exception_id(
            "org-a",
            "client-a",
            "engagement-a",
            "task-1",
            &root,
            "INV-0043"
        ),
        "another subject is another exception"
    );
    // A subject is kept exactly: case and leading zeros matter.
    assert_ne!(
        exception_id(
            "org-a",
            "client-a",
            "engagement-a",
            "task-1",
            &root,
            "000123"
        ),
        exception_id("org-a", "client-a", "engagement-a", "task-1", &root, "123"),
    );
    assert!(!valid_exception_id("exc-ABCDEF"));
    assert!(!valid_exception_id(&format!("exc-{}", "g".repeat(40))));
}

fn reference() -> CitationSource {
    CitationSource {
        original_id: "ap-policy".into(),
        locator: Locator::parse("bytes:0-48"),
        quote: "Invoices above 1,000.00 USD require an approver.".into(),
    }
}
fn request(
    kind: ExceptionDispositionKind,
    references: Vec<CitationSource>,
) -> ExceptionDispositionRequest {
    ExceptionDispositionRequest {
        key: "close-1".into(),
        exception_id: format!("exc-{}", "0".repeat(40)),
        kind,
        rationale: "The approver signed the paper voucher.".into(),
        references,
    }
}

#[test]
fn a_closure_needs_rationale_and_at_least_one_reference() {
    use ExceptionDispositionKind as K;
    assert!(request(K::Closed, vec![reference()]).is_valid());
    assert!(
        !request(K::Closed, vec![]).is_valid(),
        "a closure cites evidence"
    );
    assert!(
        request(K::Reopened, vec![]).is_valid(),
        "a reopening needs none"
    );
    let mut blank = request(K::Reopened, vec![]);
    blank.rationale = " \n\t".into();
    assert!(!blank.is_valid(), "blank rationale");
    let mut long = request(K::Reopened, vec![]);
    long.rationale = "x".repeat(MAX_DISPOSITION_RATIONALE_BYTES + 1);
    assert!(!long.is_valid(), "over 2,000 bytes");
    long.rationale = "é".repeat(MAX_DISPOSITION_RATIONALE_BYTES / 2);
    assert!(long.is_valid(), "exactly 2,000 bytes");
    let doubled = request(K::Closed, vec![reference(), reference()]);
    assert!(!doubled.is_valid(), "a repeated reference");
    let many = request(
        K::Closed,
        (0..9)
            .map(|i| CitationSource {
                quote: format!("quote {i}"),
                ..reference()
            })
            .collect(),
    );
    assert!(!many.is_valid(), "more than 8 references");
    let mut page = request(K::Closed, vec![reference()]);
    page.references[0].locator = None;
    assert!(!page.is_valid(), "a reference names its locator");
    let mut id = request(K::Reopened, vec![]);
    id.exception_id = "eval-1".into();
    assert!(!id.is_valid(), "an exception ID");
}

#[test]
fn close_only_what_is_not_closed_and_reopen_only_what_is() {
    use ExceptionDispositionKind as K;
    let close = request(K::Closed, vec![reference()]);
    let reopen = request(K::Reopened, vec![]);
    for status in [S::Open, S::ResolvedByEvidence, S::ReplacedByHumanJudgment] {
        assert_eq!(close.check(status), Ok(()), "{status:?}");
        assert_eq!(
            reopen.check(status),
            Err(ExceptionRefusal::NotClosed),
            "{status:?}"
        );
    }
    assert_eq!(
        close.check(S::ClosedByDisposition),
        Err(ExceptionRefusal::AlreadyClosed)
    );
    assert_eq!(reopen.check(S::ClosedByDisposition), Ok(()));
    assert_eq!(
        request(K::Closed, vec![]).check(S::Open),
        Err(ExceptionRefusal::Invalid)
    );
}

#[test]
fn an_exception_disposition_document_decodes_to_its_request() {
    let r = request(ExceptionDispositionKind::Closed, vec![reference()]);
    let sha = "a".repeat(64);
    let document = exception_disposition_document(
        "xdisp-1",
        "task-1",
        "actor-manager",
        &r,
        &[(reference(), sha.clone())],
    );
    let (decoded, references) = exception_disposition_from(&document).unwrap();
    assert_eq!(decoded, r);
    assert_eq!(references, vec![(reference(), sha)]);
    // An unverified reference is never decoded as one.
    let JsonValue::Object(mut map) = document else {
        unreachable!()
    };
    let JsonValue::Array(mut items) = map.remove("references").unwrap() else {
        unreachable!()
    };
    let JsonValue::Object(mut first) = items.remove(0) else {
        unreachable!()
    };
    first.insert("verification".into(), s("unverified"));
    map.insert(
        "references".into(),
        JsonValue::Array(vec![JsonValue::Object(first)]),
    );
    assert!(exception_disposition_from(&JsonValue::Object(map)).is_none());
}

// ------------------------------------------------------ effective summary

fn counts(in_scope: u64) -> PopulationCounts {
    PopulationCounts {
        received_rows: in_scope,
        unkeyed: 0,
        duplicate_rows: 0,
        distinct_subjects: in_scope,
        excluded_out_of_period: 0,
        scope_unknown_period_unparsed: 0,
        scope_unknown_period_missing: 0,
        scope_unknown_conflicting_duplicate: 0,
        in_scope,
    }
}
fn population(in_scope: u64, complete: bool) -> PopulationFacts {
    PopulationFacts {
        completeness: if complete {
            Completeness::Complete
        } else {
            Completeness::Incomplete(IncompleteReason::NotExhaustive)
        },
        reconciliation: Reconciliation::NotDeclared,
        counts: counts(in_scope),
        period_checked: true,
        naive_date_times: 0,
    }
}
fn effective(
    subject: &str,
    verdict: Option<Verdict>,
    origin: EffectiveOrigin,
    review: ReviewState,
) -> EffectiveOpportunity {
    EffectiveOpportunity {
        subject: subject.into(),
        verdict,
        applicability: Applicability::Applicable,
        execution: Execution::Completed,
        reason: (verdict == Some(Verdict::Undetermined)
            && origin != EffectiveOrigin::ModelProposal)
            .then_some(EvaluationReason::MissingFact),
        origin,
        review,
        superseded: false,
    }
}
fn subjects(n: usize) -> BTreeSet<String> {
    (0..n).map(|i| format!("INV-{i:02}")).collect()
}
fn entry(subject: &str, status: ExceptionStatus) -> ExceptionEntry {
    ExceptionEntry {
        id: exception_id(
            "org-a",
            "client-a",
            "engagement-a",
            "task-1",
            "crit-a",
            subject,
        ),
        subject: subject.into(),
        criterion_root: "crit-a".into(),
        status,
        latest_observed: if status == S::Open {
            L::NotMet
        } else {
            L::NotObserved
        },
    }
}

/// Five failing judgments: two revised to met, one a person's met, one
/// pending reconsideration (still failing) and one unchanged; three met
/// model proposals nobody reviewed; one subject never judged.
fn scenario() -> (
    PopulationFacts,
    BTreeSet<String>,
    Vec<EffectiveCriterion>,
    Vec<ExceptionEntry>,
) {
    use EffectiveOrigin as O;
    use ReviewState as R;
    let all = subjects(9);
    let s = |i: usize| format!("INV-{i:02}");
    let opportunities = vec![
        effective(&s(0), Some(Verdict::Met), O::ModelProposal, R::Unreviewed),
        effective(&s(1), Some(Verdict::Met), O::ModelProposal, R::Unreviewed),
        effective(&s(2), Some(Verdict::Met), O::Human, R::Replaced),
        effective(
            &s(3),
            Some(Verdict::NotMet),
            O::ModelProposal,
            R::PendingReconsideration,
        ),
        effective(&s(4), Some(Verdict::NotMet), O::ModelProposal, R::Accepted),
        effective(&s(5), Some(Verdict::Met), O::ModelProposal, R::Unreviewed),
        effective(&s(6), Some(Verdict::Met), O::ModelProposal, R::Accepted),
        effective(&s(7), Some(Verdict::Met), O::ModelProposal, R::Unreviewed),
        // Not judged: a judgment opportunity with no recorded judgment.
        effective(&s(8), None, O::Deterministic, R::Unreviewed),
    ];
    let criteria = vec![EffectiveCriterion {
        criterion_id: "crit-a".into(),
        judgment: true,
        opportunities,
    }];
    let exceptions = vec![
        entry(&s(0), S::ResolvedByEvidence),
        entry(&s(1), S::ResolvedByEvidence),
        entry(&s(2), S::ReplacedByHumanJudgment),
        entry(&s(3), S::Open),
        entry(&s(4), S::Open),
    ];
    (population(9, true), all, criteria, exceptions)
}

#[test]
fn the_effective_summary_recounts_failing_over_heads_and_dispositions() {
    let (p, in_scope, criteria, exceptions) = scenario();
    let e = summarise_effective(&p, &in_scope, &criteria, None, &exceptions);
    // Two failing (pending and accepted not_met); the person's met and the
    // revised mets meet; the never judged subject is unresolved.
    assert_eq!(e.summary.partition.failing, 2);
    assert_eq!(e.summary.partition.meets_every_applicable, 6);
    assert_eq!(e.summary.partition.unresolved, 1);
    assert_eq!(e.summary.criteria[0].met, 6);
    // A person's met is decided, never an unreviewed model proposal.
    assert_eq!(e.summary.criteria[0].met_unreviewed, 5);
    assert_eq!(
        e.criteria[0],
        EffectiveCounts {
            criterion_id: "crit-a".into(),
            human_replaced: 1,
            pending_reconsideration: 1,
            undisposed: 4,
            superseded: 0,
        }
    );
    assert_eq!(
        e.exceptions,
        ExceptionCounts {
            total: 5,
            open: 2,
            resolved_by_evidence: 2,
            replaced_by_human_judgment: 1,
            closed_by_disposition: 0,
            subjects: 5
        }
    );
    // The 24.2 denominators are unchanged.
    assert_eq!(e.summary.counts.in_scope, 9);
    assert_eq!(
        e.summary.conclusion,
        crate::coverage::Conclusion::ExceptionsFoundInconclusive
    );
    let codes: Vec<_> = e.limitations.iter().map(|l| (l.code, l.count)).collect();
    use EffectiveLimitationCode as X;
    assert_eq!(
        codes,
        vec![
            (X::UnresolvedSubjects, Some(1)),
            (X::PendingReconsideration, Some(1)),
            (X::UnreviewedModelProposals, Some(4)),
            (X::OpenExceptions, Some(2)),
        ]
    );
    assert_eq!(e.conclusion, e.summary.conclusion);
    assert!(e.is_consistent());
    // Determinism: the same inputs give the same digest.
    assert_eq!(
        e.digest(),
        summarise_effective(&p, &in_scope, &criteria, None, &exceptions).digest()
    );
}

#[test]
fn a_forged_count_or_limitation_is_not_consistent() {
    let (p, in_scope, criteria, exceptions) = scenario();
    let good = summarise_effective(&p, &in_scope, &criteria, None, &exceptions);
    let mut forged = good.clone();
    forged.exceptions.open -= 1;
    assert!(!forged.is_consistent(), "status counts add up to the total");
    let mut forged = good.clone();
    forged.limitations.pop();
    assert!(
        !forged.is_consistent(),
        "every derived limitation is stated"
    );
    let mut forged = good.clone();
    forged.limitations[0].count = Some(5);
    assert!(
        !forged.is_consistent(),
        "a limitation's count is the derived one"
    );
    let mut forged = good.clone();
    forged.criteria[0].criterion_id = "crit-z".into();
    assert!(!forged.is_consistent(), "the criteria are the summary's");
    let mut forged = good;
    forged.listed.reverse();
    assert!(
        !forged.is_consistent(),
        "the listed exceptions are in byte order"
    );
}

#[test]
fn exceptions_are_listed_fifty_with_the_exact_total() {
    let (_, _, criteria, _) = scenario();
    let in_scope: BTreeSet<String> = (0..53).map(|i| format!("S-{i:03}")).collect();
    let many: Vec<ExceptionEntry> = (0..53)
        .rev()
        .map(|i| entry(&format!("S-{i:03}"), S::Open))
        .collect();
    let e = summarise_effective(&population(53, true), &in_scope, &criteria, None, &many);
    assert_eq!(e.exceptions.total, 53);
    assert_eq!(e.exceptions.subjects, 53);
    assert_eq!(e.listed.len(), MAX_LISTED_EXCEPTIONS);
    assert_eq!(e.listed[0].subject, "S-000");
    assert_eq!(e.listed[49].subject, "S-049");
    assert!(e.is_consistent());
    let mut forged = e.clone();
    forged.listed.pop();
    assert!(!forged.is_consistent(), "fifty are listed when more exist");
    // Two criterion lineages of one subject are two exceptions, one subject.
    let mut two = vec![entry("INV-1", S::Open), entry("INV-1", S::Open)];
    two[1].criterion_root = "crit-b".into();
    two[1].id = "exc-b".into();
    assert_eq!(ExceptionCounts::of(&two).subjects, 1);
    assert_eq!(ExceptionCounts::of(&two).total, 2);
}

#[test]
fn an_incomplete_population_or_a_sample_says_so_in_words() {
    let (_, in_scope, criteria, exceptions) = scenario();
    let e = summarise_effective(
        &population(9, false),
        &in_scope,
        &criteria,
        None,
        &exceptions,
    );
    assert_eq!(
        e.limitations[0].code,
        EffectiveLimitationCode::PopulationIncomplete
    );
    assert!(!e.exact());
    let words = e.limitations[1].words(e.exact());
    assert!(
        words.starts_with("at least 1 subjects are unresolved"),
        "{words}"
    );
    let selected: BTreeSet<String> = ["INV-03", "INV-05"].into_iter().map(String::from).collect();
    let sampled = summarise_effective(
        &population(9, true),
        &in_scope,
        &criteria,
        Some(&selected),
        &exceptions,
    );
    assert_eq!(
        sampled.limitations.last().map(|l| (l.code, l.count)),
        Some((EffectiveLimitationCode::SampleOnly, Some(2)))
    );
    // Only the selected subjects are counted.
    assert_eq!(sampled.criteria[0].pending_reconsideration, 1);
    assert_eq!(sampled.criteria[0].undisposed, 1);
    assert_eq!(sampled.summary.partition.failing, 1);
    assert!(sampled.is_consistent());
}

#[test]
fn superseded_inputs_are_counted_and_limited() {
    let (p, in_scope, mut criteria, exceptions) = scenario();
    criteria[0].opportunities[3].superseded = true;
    let e = summarise_effective(&p, &in_scope, &criteria, None, &exceptions);
    assert_eq!(e.criteria[0].superseded, 1);
    assert!(e.limitations.iter().any(|l| l.code
        == EffectiveLimitationCode::SupersededInputsNotReevaluated
        && l.count == Some(1)));
}

#[test]
fn an_effective_summary_document_decodes_only_to_itself() {
    let (p, in_scope, criteria, exceptions) = scenario();
    let e = summarise_effective(&p, &in_scope, &criteria, None, &exceptions);
    let JsonValue::Object(map) = e.document() else {
        unreachable!()
    };
    assert_eq!(effective_from(&map, e.summary.clone()), Some(e.clone()));
    let mut forged = map.clone();
    forged.insert("aggregation".into(), s("subject_partition_v1"));
    assert!(effective_from(&forged, e.summary.clone()).is_none());
    let mut forged = map;
    if let Some(JsonValue::Object(x)) = forged.get_mut("exceptions") {
        x.insert("open".into(), JsonValue::Integer(9));
    }
    assert!(effective_from(&forged, e.summary.clone()).is_none());
}

#[test]
fn summarise_effective_is_a_bounded_answer_field() {
    let fields = answer_fields();
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].0, "summarise_effective");
    let ArgumentSchema::Array { max_items, .. } = &fields[0].1 else {
        panic!("an array");
    };
    assert_eq!(*max_items, 2);
    let ok = object(vec![
        ("basis", s("basis-1")),
        ("population", s("pop-1")),
        ("sample", s("")),
    ]);
    assert_eq!(
        decode_summarise_effective(&ok).map(|r| r.sample),
        Some(None)
    );
    let bad = object(vec![
        ("basis", s("not an id")),
        ("population", s("pop-1")),
        ("sample", s("")),
    ]);
    assert!(decode_summarise_effective(&bad).is_none());
}

/// An effective summary counts only the exceptions of its own subjects (BH
/// M4, ECH M2): an exception of a subject outside its population or sample
/// is never counted or listed, so a change elsewhere in the Task never moves
/// its digest.
#[test]
fn only_the_summarys_own_subjects_exceptions_are_counted() {
    let (p, in_scope, criteria, mut exceptions) = scenario();
    let before = summarise_effective(&p, &in_scope, &criteria, None, &exceptions);
    exceptions.push(entry("OUT-1", S::Open));
    let after = summarise_effective(&p, &in_scope, &criteria, None, &exceptions);
    assert_eq!(after, before, "an exception elsewhere changes nothing");
    assert_eq!(after.digest(), before.digest());
    let selected: BTreeSet<String> = ["INV-03"].into_iter().map(String::from).collect();
    let sampled = summarise_effective(&p, &in_scope, &criteria, Some(&selected), &exceptions);
    assert_eq!(sampled.exceptions.total, 1);
    assert_eq!(sampled.listed.len(), 1);
    assert_eq!(sampled.listed[0].subject, "INV-03");
    assert!(sampled.is_consistent());
    let mut forged = sampled.clone();
    forged.exceptions.subjects = 2;
    forged.exceptions.total = 2;
    forged.exceptions.open = 2;
    assert!(
        !forged.is_consistent(),
        "never more exception subjects than selected"
    );
}

/// An effective summary never concludes that no exception was found while
/// one of its subjects' exceptions is open (ECH M1): it is inconclusive and
/// says why.
#[test]
fn an_open_exception_caps_no_exception_found_at_inconclusive() {
    use EffectiveOrigin as O;
    use ReviewState as R;
    let in_scope = subjects(2);
    let criteria = vec![EffectiveCriterion {
        criterion_id: "crit-a".into(),
        judgment: false,
        opportunities: vec![
            effective(
                "INV-00",
                Some(Verdict::Met),
                O::Deterministic,
                R::Unreviewed,
            ),
            effective(
                "INV-01",
                Some(Verdict::Met),
                O::Deterministic,
                R::Unreviewed,
            ),
        ],
    }];
    let clean = summarise_effective(&population(2, true), &in_scope, &criteria, None, &[]);
    assert_eq!(clean.conclusion, Conclusion::NoExceptionFound);
    let mut open = entry("INV-01", S::Open);
    open.latest_observed = L::NotObserved;
    let capped = summarise_effective(&population(2, true), &in_scope, &criteria, None, &[open]);
    assert_eq!(capped.summary.conclusion, Conclusion::NoExceptionFound);
    assert_eq!(capped.conclusion, Conclusion::Inconclusive);
    assert_eq!(
        capped
            .limitations
            .iter()
            .map(|l| (l.code, l.count))
            .collect::<Vec<_>>(),
        vec![(EffectiveLimitationCode::OpenExceptions, Some(1))]
    );
    assert!(capped.is_consistent());
    let mut forged = capped.clone();
    forged.conclusion = Conclusion::NoExceptionFound;
    assert!(!forged.is_consistent());
    // A resolved exception does not cap it.
    let resolved = summarise_effective(
        &population(2, true),
        &in_scope,
        &criteria,
        None,
        &[entry("INV-01", S::ResolvedByEvidence)],
    );
    assert_eq!(resolved.conclusion, Conclusion::NoExceptionFound);
}
