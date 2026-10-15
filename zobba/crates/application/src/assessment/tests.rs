//! Assessment contracts with an in-memory store and trusted reader. The real
//! PostgreSQL custody, immutability guards, sandbox and work loop are proven
//! by the worker integration suite.
use super::*;
use crate::{
    analysis::tests::{basis, run},
    citation::CitedOriginal,
    investigation::tests::{binding, invocation},
};
use zobba_domain::{
    assessment::{Comparison, MissingTreatment, ProposedJudgment},
    citation::{Located, PageFacts},
    context::open_envelope,
};

/// One spreadsheet and one text original. Cells answer their stored and
/// displayed values, as the trusted document program does.
#[derive(Default)]
struct Reader {
    cells: BTreeMap<String, Vec<String>>,
    reads: Mutex<u32>,
}
impl Reader {
    fn new() -> Self {
        let mut cells = BTreeMap::new();
        for (locator, values) in [
            ("cell:Sheet1!A2", vec!["INV-0042"]),
            ("cell:Sheet1!B2", vec!["1250", "1,250.00"]),
            ("cell:Sheet1!C2", vec!["USD"]),
            ("cell:Sheet1!D2", vec!["J. Smith"]),
            ("cell:Sheet1!E2", vec!["05/03/2026"]),
            ("cell:Sheet1!F2", vec!["2026-03-05T23:30:00-05:00"]),
            ("cell:Sheet1!A3", vec!["000123"]),
            ("cell:Sheet1!B3", vec!["980", "980.00"]),
            ("cell:Sheet1!B4", vec!["4200", "4,200.00"]),
            ("cell:Sheet1!G4", vec!["No"]),
        ] {
            cells.insert(
                locator.to_string(),
                values.into_iter().map(String::from).collect(),
            );
        }
        Self {
            cells,
            reads: Mutex::new(0),
        }
    }
}
impl CitationReader for Reader {
    async fn original(
        &self,
        _: &ClaimBasis,
        id: &str,
    ) -> Result<Option<CitedOriginal>, ReadingError> {
        Ok(
            matches!(id, "ap-invoices" | "ap-policy").then(|| CitedOriginal {
                id: id.into(),
                sha256: if id == "ap-invoices" { "a" } else { "b" }.repeat(64),
            }),
        )
    }
    async fn byte_range(
        &self,
        _: &ClaimBasis,
        _: &CitedOriginal,
        start: u64,
        end: u64,
    ) -> Result<Located, ReadingError> {
        let text = "Policy: invoices above 1,000.00 USD require approval.";
        Ok(text
            .get(start as usize..end as usize)
            .map_or(Located::Missing, |t| Located::Found(vec![t.into()])))
    }
    async fn locate(
        &self,
        _: &ClaimBasis,
        _: &CitedOriginal,
        locators: &[Locator],
        _: &ModelCancellation,
    ) -> Result<Vec<Located>, ReadingError> {
        *self.reads.lock().unwrap() += 1;
        Ok(locators
            .iter()
            .map(|l| {
                self.cells
                    .get(&l.render())
                    .map_or(Located::Missing, |values| Located::Found(values.clone()))
            })
            .collect())
    }
    async fn page(
        &self,
        _: &ClaimBasis,
        _: &CitedOriginal,
        _: u32,
        _: &ModelCancellation,
    ) -> Result<Option<PageFacts>, ReadingError> {
        Ok(None)
    }
}

#[derive(Default)]
struct State {
    criteria: Vec<CriterionRecord>,
    bases: Vec<BasisRecord>,
    facts: Vec<FactRecord>,
    evaluations: Vec<EvaluationRecord>,
    jobs: BTreeMap<String, JobState>,
    clock: i64,
}
#[derive(Default)]
struct Store {
    state: Mutex<State>,
}
fn insert<T: Clone + PartialEq>(
    list: &mut Vec<T>,
    record: &T,
    id: impl Fn(&T) -> String,
    strip: impl Fn(&T) -> T,
) -> Result<T, ReadingError> {
    if let Some(found) = list.iter().find(|r| id(r) == id(record)) {
        return if strip(found) == strip(record) {
            Ok(found.clone())
        } else {
            Err(ReadingError::Invalid)
        };
    }
    list.push(record.clone());
    Ok(record.clone())
}
impl AssessmentStore for Store {
    async fn invocation_records(
        &self,
        _: &ClaimBasis,
        invocation_id: &str,
    ) -> Result<InvocationAssessment, ReadingError> {
        let state = self.state.lock().unwrap();
        Ok(InvocationAssessment {
            criteria: state
                .criteria
                .iter()
                .filter(|r| r.invocation_id == invocation_id)
                .cloned()
                .collect(),
            bases: state
                .bases
                .iter()
                .filter(|r| r.invocation_id == invocation_id)
                .cloned()
                .collect(),
            facts: state
                .facts
                .iter()
                .filter(|r| r.invocation_id == invocation_id)
                .cloned()
                .collect(),
            evaluations: state
                .evaluations
                .iter()
                .filter(|r| r.invocation_id == invocation_id)
                .cloned()
                .collect(),
        })
    }
    async fn criteria(
        &self,
        b: &ClaimBasis,
        ids: &[String],
    ) -> Result<Vec<CriterionRecord>, ReadingError> {
        let state = self.state.lock().unwrap();
        Ok(state
            .criteria
            .iter()
            .filter(|c| c.task_id == b.task_id && ids.contains(&c.id))
            .cloned()
            .collect())
    }
    async fn basis_record(
        &self,
        b: &ClaimBasis,
        id: &str,
    ) -> Result<Option<BasisRecord>, ReadingError> {
        let state = self.state.lock().unwrap();
        Ok(state
            .bases
            .iter()
            .find(|r| r.task_id == b.task_id && r.id == id)
            .cloned())
    }
    async fn latest_basis_with(
        &self,
        b: &ClaimBasis,
        criterion_id: &str,
    ) -> Result<Option<BasisRecord>, ReadingError> {
        let state = self.state.lock().unwrap();
        Ok(state
            .bases
            .iter()
            .rev()
            .find(|r| r.task_id == b.task_id && r.basis.criteria.iter().any(|c| c == criterion_id))
            .cloned())
    }
    async fn facts(&self, _: &ClaimBasis, basis_id: &str) -> Result<Vec<FactRecord>, ReadingError> {
        let state = self.state.lock().unwrap();
        Ok(state
            .facts
            .iter()
            .filter(|f| f.basis_id == basis_id)
            .cloned()
            .collect())
    }
    async fn evaluation(
        &self,
        _: &ClaimBasis,
        basis_id: &str,
        criterion_id: &str,
        subject: &str,
    ) -> Result<Option<EvaluationRecord>, ReadingError> {
        let state = self.state.lock().unwrap();
        Ok(state
            .evaluations
            .iter()
            .find(|e| {
                e.basis_id == basis_id && e.criterion_id == criterion_id && e.subject == subject
            })
            .cloned())
    }
    async fn job_state(
        &self,
        _: &ClaimBasis,
        job_id: &str,
    ) -> Result<Option<JobState>, ReadingError> {
        Ok(self.state.lock().unwrap().jobs.get(job_id).copied())
    }
    async fn record_criterion(
        &self,
        _: &ClaimBasis,
        r: &CriterionRecord,
    ) -> Result<CriterionRecord, ReadingError> {
        assert_eq!(r.digest, document_digest(&r.document()));
        let mut state = self.state.lock().unwrap();
        state.clock += 1;
        let mut r = r.clone();
        r.recorded_us = Some(state.clock);
        insert(
            &mut state.criteria,
            &r,
            |r| r.id.clone(),
            |r| CriterionRecord {
                recorded_us: None,
                ..r.clone()
            },
        )
    }
    async fn record_basis(
        &self,
        _: &ClaimBasis,
        r: &BasisRecord,
    ) -> Result<BasisRecord, ReadingError> {
        let mut state = self.state.lock().unwrap();
        // The database guard: every listed criterion is one of this Task's.
        if !r.basis.criteria.iter().all(|c| {
            state
                .criteria
                .iter()
                .any(|k| &k.id == c && k.task_id == r.task_id)
        }) {
            return Err(ReadingError::Invalid);
        }
        insert(&mut state.bases, r, |r| r.id.clone(), Clone::clone)
    }
    async fn record_fact(
        &self,
        _: &ClaimBasis,
        r: &FactRecord,
    ) -> Result<FactRecord, ReadingError> {
        assert_eq!(r.digest, document_digest(&r.document()));
        let mut state = self.state.lock().unwrap();
        insert(&mut state.facts, r, |r| r.id.clone(), Clone::clone)
    }
    async fn record_evaluation(
        &self,
        _: &ClaimBasis,
        r: &EvaluationRecord,
    ) -> Result<EvaluationRecord, ReadingError> {
        assert!(r.outcome.is_valid());
        assert_eq!(r.output_digest, r.computed_digest());
        let mut state = self.state.lock().unwrap();
        insert(&mut state.evaluations, r, |r| r.id.clone(), Clone::clone)
    }
    async fn snapshot(&self, _: &ClaimBasis) -> Result<AssessmentSnapshot, ReadingError> {
        let state = self.state.lock().unwrap();
        Ok(AssessmentSnapshot {
            bases: state.bases.clone(),
            criteria: state.criteria.clone(),
            facts: state.facts.clone(),
            evaluations: state.evaluations.clone(),
            total_bases: state.bases.len() as u64,
            total_criteria: state.criteria.len() as u64,
            total_facts: state.facts.len() as u64,
            total_evaluations: state.evaluations.len() as u64,
        })
    }
}

fn usd() -> Measure {
    Measure::Currency("USD".into())
}
fn src(locator: &str, quote: &str) -> CitationSource {
    CitationSource {
        original_id: "ap-invoices".into(),
        locator: Locator::parse(locator),
        quote: quote.into(),
    }
}
fn required(name: &str, kind: FactType) -> RequiredFact {
    RequiredFact {
        name: name.into(),
        kind,
        measure: None,
    }
}
/// "Invoices above 1,000.00 USD require an approver" from method AP-1.
fn approval(key: &str) -> ProposedCriterion {
    ProposedCriterion {
        key: key.into(),
        supersedes: None,
        assertion: "Invoices above 1,000.00 USD require an approver".into(),
        authority: Authority::Method {
            requirement_id: "AP-1".into(),
            criterion_ordinal: 0,
        },
        effective_from: None,
        effective_to: None,
        applicability: Some(Predicate::CompareConstant {
            fact: "amount".into(),
            op: Comparison::Gt,
            constant: Decimal::parse_plain("1000.00").unwrap(),
            measure: usd(),
        }),
        required_facts: vec![
            required("amount", FactType::Decimal),
            required("approver", FactType::Identifier),
        ],
        method: CriterionMethod::Rule(Predicate::Present {
            fact: "approver".into(),
        }),
        missing: MissingTreatment::Undetermined,
    }
}
fn history(key: &str) -> ProposedCriterion {
    ProposedCriterion {
        assertion: "The approver appears in the complete approval history".into(),
        required_facts: vec![
            required("amount", FactType::Decimal),
            required("in_approval_history", FactType::Boolean),
        ],
        method: CriterionMethod::Rule(Predicate::IsTrue {
            fact: "in_approval_history".into(),
        }),
        ..approval(key)
    }
}
fn limit(key: &str) -> ProposedCriterion {
    ProposedCriterion {
        assertion: "No invoice exceeds the 5,000.00 USD limit".into(),
        applicability: None,
        required_facts: vec![required("amount", FactType::Decimal)],
        method: CriterionMethod::Rule(Predicate::CompareConstant {
            fact: "amount".into(),
            op: Comparison::Le,
            constant: Decimal::parse_plain("5000.00").unwrap(),
            measure: usd(),
        }),
        ..approval(key)
    }
}
fn ap_basis(criteria: Vec<&str>) -> ProposedBasis {
    ProposedBasis {
        key: "b1".into(),
        supersedes: None,
        objective: "Test approval of AP invoices for 2026".into(),
        criteria: criteria.into_iter().map(String::from).collect(),
        period_from: CivilDate::parse_iso("2026-01-01").unwrap(),
        period_to: CivilDate::parse_iso("2026-12-31").unwrap(),
        as_of: None,
        population: vec![PopulationReference {
            original_id: "ap-invoices".into(),
            unit: "invoice".into(),
            selection: "All invoices in the AP export".into(),
        }],
        limitations: vec!["Credit notes are out of scope".into()],
    }
}
fn value_fact(
    subject: &str,
    name: &str,
    value: FactValue,
    rule: ParseRule,
    sources: Vec<CitationSource>,
) -> ProposedFact {
    ProposedFact {
        basis: "b1".into(),
        subject: subject.into(),
        subject_unit: "invoice".into(),
        name: name.into(),
        state: FactState::Value(value),
        rule: Some(rule),
        sources,
        job_id: None,
        effective: None,
    }
}
fn decimal(text: &str, measure: Measure) -> FactValue {
    FactValue::Decimal {
        value: Decimal::parse_plain(text).unwrap(),
        measure,
    }
}
fn amount_fact(
    subject: &str,
    text: &str,
    locator: &str,
    quote: &str,
    measure: Measure,
) -> ProposedFact {
    value_fact(
        subject,
        "amount",
        decimal(text, measure),
        ParseRule::DecimalGroupedComma,
        vec![src(locator, quote)],
    )
}

fn evaluation<'a>(
    records: &'a [EvaluationRecord],
    criterion: &str,
    subject: &str,
) -> &'a EvaluationRecord {
    records
        .iter()
        .find(|e| e.criterion_id == criterion && e.subject == subject)
        .unwrap_or_else(|| panic!("no evaluation of {criterion} for {subject}"))
}

#[test]
fn the_matrix_is_recorded_as_separate_checked_records() {
    let (store, reader) = (Store::default(), Reader::new());
    store
        .state
        .lock()
        .unwrap()
        .jobs
        .insert("job-failed".into(), JobState::Failed);
    let assessment = Assessment::new(&store, &reader);
    let b = binding("binding-1");
    let cancel = ModelCancellation::new();
    let mut unverified = approval("c4");
    unverified.authority = Authority::Original(CitationSource {
        original_id: "ap-policy".into(),
        locator: Locator::parse("bytes:0-20"),
        quote: "invoices above 2,000.00".into(),
    });
    let answer = CitedAnswer {
        propose_criteria: vec![approval("c1"), history("c2"), limit("c3"), unverified],
        propose_basis: vec![ap_basis(vec!["c1", "c2", "c3", "c4"])],
        record_facts: vec![
            // Rule met: INV-0042 1,250.00 USD with an approver.
            amount_fact("INV-0042", "1250.00", "cell:Sheet1!B2", "1,250.00", usd()),
            value_fact(
                "INV-0042",
                "approver",
                FactValue::Identifier("J. Smith".into()),
                ParseRule::IdentifierExact,
                vec![src("cell:Sheet1!D2", "J. Smith")],
            ),
            value_fact(
                "INV-0042",
                "in_approval_history",
                FactValue::Boolean(true),
                ParseRule::BooleanYesNo,
                vec![],
            ),
            // Value mismatch: the model types 1280.00 over a 1,250.00 cell.
            amount_fact("INV-0050", "1280.00", "cell:Sheet1!B2", "1,250.00", usd()),
            value_fact(
                "INV-0050",
                "approver",
                FactValue::Identifier("J. Smith".into()),
                ParseRule::IdentifierExact,
                vec![src("cell:Sheet1!D2", "J. Smith")],
            ),
            // Missing input: no approver fact for INV-0051.
            amount_fact("INV-0051", "1250.00", "cell:Sheet1!B2", "1,250.00", usd()),
            // Unavailable source.
            amount_fact("INV-0052", "1250.00", "cell:Sheet1!B2", "1,250.00", usd()),
            ProposedFact {
                subject: "INV-0052".into(),
                name: "approver".into(),
                state: FactState::Unavailable(UnavailableReason::EvidenceUnavailable),
                rule: None,
                sources: vec![],
                ..value_fact(
                    "INV-0052",
                    "approver",
                    FactValue::Identifier("x".into()),
                    ParseRule::IdentifierExact,
                    vec![],
                )
            },
            // Analysis failed: the approver came from a failed 22.4 job.
            amount_fact("INV-0053", "1250.00", "cell:Sheet1!B2", "1,250.00", usd()),
            ProposedFact {
                job_id: Some("job-failed".into()),
                ..value_fact(
                    "INV-0053",
                    "approver",
                    FactValue::Identifier("J. Smith".into()),
                    ParseRule::IdentifierExact,
                    vec![src("cell:Sheet1!D2", "J. Smith")],
                )
            },
            // Observed exception: absent from the complete approval history.
            amount_fact("INV-0054", "1250.00", "cell:Sheet1!B2", "1,250.00", usd()),
            value_fact(
                "INV-0054",
                "in_approval_history",
                FactValue::Boolean(false),
                ParseRule::BooleanYesNo,
                vec![src("cell:Sheet1!G4", "No")],
            ),
            // Currency mismatch: a EUR amount against a USD limit.
            amount_fact(
                "INV-0055",
                "4200.00",
                "cell:Sheet1!B4",
                "4,200.00",
                Measure::Currency("EUR".into()),
            ),
            // Not applicable: 980.00 USD.
            amount_fact("INV-0056", "980.00", "cell:Sheet1!B3", "980.00", usd()),
            // Leading zeros, a day-first date and an instant with offset.
            value_fact(
                "000123",
                "invoice_id",
                FactValue::Identifier("000123".into()),
                ParseRule::IdentifierExact,
                vec![src("cell:Sheet1!A3", "000123")],
            ),
            value_fact(
                "000123",
                "invoice_date",
                FactValue::Date(CivilDate::parse_iso("2026-03-05").unwrap()),
                ParseRule::DateDmy,
                vec![src("cell:Sheet1!E2", "05/03/2026")],
            ),
            value_fact(
                "000123",
                "approved_at",
                FactValue::Instant(Instant::parse_rfc3339("2026-03-05T23:30:00-05:00").unwrap()),
                ParseRule::InstantRfc3339,
                vec![src("cell:Sheet1!F2", "2026-03-05T23:30:00-05:00")],
            ),
        ],
        evaluate: vec!["c1".into(), "c2".into(), "c3".into(), "c4".into()],
        ..CitedAnswer::default()
    };
    // A boolean value needs a source: that entry is invalid as proposed.
    assert!(!answer.record_facts[2].is_valid());
    let mut answer = answer;
    answer.record_facts.remove(2);
    assert!(answer.is_valid(), "the answer as decoded is valid");
    let turn = invocation("turn-1", "binding-1");
    assert!(run(assessment.after_answer(&basis("p1"), &b, &turn, &answer, &cancel)).unwrap());

    let state = store.state.lock().unwrap();
    // Criteria: method authority verified with its text digest; the original
    // quote not at its location is recorded unverified.
    assert_eq!(state.criteria.len(), 4);
    let c1 = &state.criteria[0];
    assert!(c1.authority.verified);
    assert_eq!(c1.authority.binding_id.as_deref(), Some("binding-1"));
    assert_eq!(
        c1.authority.text_sha256.as_deref(),
        Some(sha256_hex(b"Payments over 10,000 have two approvals").as_str())
    );
    assert_eq!(
        (c1.methodology_binding_id.as_str(), c1.execution_epoch),
        ("binding-1", 1)
    );
    let c4 = &state.criteria[3];
    assert!(!c4.authority.verified);
    assert_eq!(
        c4.authority.reason,
        Some(AuthorityReason::NotFoundAtLocation)
    );
    // The basis pins the criterion IDs, period and the population digest.
    let basis_record = &state.bases[0];
    assert_eq!(
        basis_record.basis.criteria,
        state
            .criteria
            .iter()
            .map(|c| c.id.clone())
            .collect::<Vec<_>>()
    );
    assert_eq!(basis_record.population_sha256, vec![Some("a".repeat(64))]);
    // Facts: the verified cell parsed to 125000/2 USD.
    let fact = |subject: &str, name: &str| {
        state
            .facts
            .iter()
            .find(|f| f.fact.subject == subject && f.fact.name == name)
            .unwrap_or_else(|| panic!("{subject}/{name}"))
            .clone()
    };
    let amount = fact("INV-0042", "amount");
    assert_eq!(amount.support, FactSupport::Supported);
    assert_eq!(
        amount.fact.state,
        FactState::Value(FactValue::Decimal {
            value: Decimal {
                mantissa: 125_000,
                scale: 2
            },
            measure: usd()
        })
    );
    assert_eq!(amount.sources[0].verification, Verification::Verified);
    assert_eq!(
        amount.sources[0].original_sha256.as_deref(),
        Some("a".repeat(64).as_str())
    );
    assert_eq!(
        fact("INV-0050", "amount").support,
        FactSupport::Unsupported(UnsupportedReason::TypeMismatch)
    );
    assert_eq!(fact("INV-0052", "approver").support, FactSupport::NoValue);
    assert_eq!(
        fact("INV-0053", "approver").support,
        FactSupport::Unsupported(UnsupportedReason::AnalysisFailed)
    );
    assert_eq!(
        fact("INV-0053", "approver").job_state,
        Some(JobState::Failed)
    );
    assert_eq!(
        fact("000123", "invoice_id").fact.state,
        FactState::Value(FactValue::Identifier("000123".into()))
    );
    assert_eq!(
        fact("000123", "invoice_date").fact.state,
        FactState::Value(FactValue::Date(CivilDate::parse_iso("2026-03-05").unwrap()))
    );
    match &fact("000123", "approved_at").fact.state {
        FactState::Value(FactValue::Instant(instant)) => {
            assert_eq!(instant.render_utc(), "2026-03-06T04:30:00Z");
            assert_eq!(instant.offset_minutes, -300);
        }
        other => panic!("{other:?}"),
    }

    let (c1, c2, c3, c4) = (
        state.criteria[0].id.clone(),
        state.criteria[1].id.clone(),
        state.criteria[2].id.clone(),
        state.criteria[3].id.clone(),
    );
    let ev = &state.evaluations;
    let row = |c: &str, s: &str| {
        let e = evaluation(ev, c, s);
        (
            e.outcome.applicability,
            e.outcome.execution,
            e.outcome.verdict,
            e.outcome.reason,
            e.outcome.origin,
        )
    };
    use Applicability as A;
    use EvaluationReason as R;
    use Execution as X;
    use Verdict as V;
    let d = Origin::Deterministic;
    assert_eq!(
        row(&c1, "INV-0042"),
        (A::Applicable, X::Completed, Some(V::Met), None, d)
    );
    // The mistyped amount cannot establish applicability.
    assert_eq!(
        row(&c1, "INV-0050"),
        (
            A::Unknown,
            X::Completed,
            Some(V::Undetermined),
            Some(R::UnknownApplicability),
            d
        )
    );
    assert_eq!(
        row(&c3, "INV-0050"),
        (
            A::Applicable,
            X::Completed,
            Some(V::Undetermined),
            Some(R::FactUnsupported),
            d
        )
    );
    assert_eq!(
        row(&c1, "INV-0051"),
        (
            A::Applicable,
            X::Completed,
            Some(V::Undetermined),
            Some(R::MissingFact),
            d
        )
    );
    assert_eq!(
        row(&c1, "INV-0052"),
        (
            A::Applicable,
            X::Completed,
            Some(V::Undetermined),
            Some(R::FactUnavailable),
            d
        )
    );
    assert_eq!(
        row(&c1, "INV-0053"),
        (A::Unknown, X::Failed, None, Some(R::AnalysisFailed), d)
    );
    assert_eq!(
        row(&c2, "INV-0054"),
        (A::Applicable, X::Completed, Some(V::NotMet), None, d)
    );
    assert_eq!(
        row(&c3, "INV-0055"),
        (
            A::Applicable,
            X::Completed,
            Some(V::Undetermined),
            Some(R::UnitMismatch),
            d
        )
    );
    assert_eq!(
        row(&c1, "INV-0056"),
        (A::NotApplicable, X::Completed, None, None, d)
    );
    assert_eq!(
        row(&c4, "INV-0042"),
        (
            A::Applicable,
            X::Completed,
            Some(V::Undetermined),
            Some(R::AuthorityUnverified),
            d
        )
    );
    // Only the supported exception is not_met.
    assert_eq!(
        ev.iter()
            .filter(|e| e.outcome.verdict == Some(V::NotMet))
            .count(),
        1
    );
    // Every input is pinned by fact ID and digest.
    let met = evaluation(ev, &c1, "INV-0042");
    let amount_id = fact("INV-0042", "amount");
    assert!(
        met.outcome
            .inputs
            .contains(&(amount_id.id.clone(), amount_id.digest.clone()))
    );
    drop(state);

    // A reclaim repeats nothing but continues the work as the first pass did;
    // asking again in a new answer gives the same output digest.
    let before = store.state.lock().unwrap().evaluations.clone();
    assert!(run(assessment.after_answer(&basis("p1"), &b, &turn, &answer, &cancel)).unwrap());
    assert_eq!(store.state.lock().unwrap().evaluations, before);
    let again = CitedAnswer {
        evaluate: vec![c1.clone()],
        ..CitedAnswer::default()
    };
    let turn2 = invocation("turn-2", "binding-1");
    assert!(!run(assessment.after_answer(&basis("p1"), &b, &turn2, &again, &cancel)).unwrap());
    let feedback = run(assessment.context(&basis("p1")))
        .unwrap()
        .feedback
        .unwrap();
    assert!(
        feedback.contains("re-evaluating gives the same output digest"),
        "{feedback}"
    );
    assert_eq!(store.state.lock().unwrap().evaluations, before);
}

#[test]
fn judgments_are_model_proposals_and_rules_are_never_model_written() {
    let (store, reader) = (Store::default(), Reader::new());
    let assessment = Assessment::new(&store, &reader);
    let b = binding("binding-1");
    let cancel = ModelCancellation::new();
    let judgment_criterion = ProposedCriterion {
        key: "seg".into(),
        assertion: "Segregation of duties is adequate given the organisation chart".into(),
        applicability: None,
        required_facts: vec![required("approver", FactType::Identifier)],
        method: CriterionMethod::Judgment {
            rubric: "Approver and requester report to different managers".into(),
        },
        ..approval("seg")
    };
    let answer = CitedAnswer {
        propose_criteria: vec![approval("c1"), judgment_criterion],
        propose_basis: vec![ap_basis(vec!["c1", "seg"])],
        record_facts: vec![value_fact(
            "INV-0042",
            "approver",
            FactValue::Identifier("J. Smith".into()),
            ParseRule::IdentifierExact,
            vec![src("cell:Sheet1!D2", "J. Smith")],
        )],
        // A judgment criterion is never evaluated by rule.
        evaluate: vec!["seg".into()],
        judgments: vec![
            ProposedJudgment {
                criterion: "seg".into(),
                basis: "b1".into(),
                subject: "INV-0042".into(),
                verdict: Verdict::Met,
                supporting: vec!["approver".into()],
                contrary: vec![],
                rationale: "The approver is outside the requester's reporting line.".into(),
                uncertainty: "The organisation chart is dated 2025.".into(),
            },
            // A judgment of a rule criterion is refused: rules are trusted code's.
            ProposedJudgment {
                criterion: "c1".into(),
                basis: "b1".into(),
                subject: "INV-0042".into(),
                verdict: Verdict::NotMet,
                supporting: vec![],
                contrary: vec![],
                rationale: "I think it fails.".into(),
                uncertainty: String::new(),
            },
        ],
        ..CitedAnswer::default()
    };
    let turn = invocation("turn-1", "binding-1");
    assert!(run(assessment.after_answer(&basis("p1"), &b, &turn, &answer, &cancel)).unwrap());
    let state = store.state.lock().unwrap();
    assert_eq!(state.evaluations.len(), 1);
    let judged = &state.evaluations[0];
    assert_eq!(judged.outcome.origin, Origin::ModelProposal);
    assert_eq!(judged.outcome.verdict, Some(Verdict::Met));
    let detail = judged.judgment.as_ref().unwrap();
    assert_eq!(detail.supporting, vec![state.facts[0].id.clone()]);
    assert_eq!(
        detail.rationale,
        "The approver is outside the requester's reporting line."
    );
    assert_eq!(judged.invocation_id, "turn-1");
    drop(state);
    let feedback = run(assessment.context(&basis("p1")))
        .unwrap()
        .feedback
        .unwrap();
    assert!(feedback.contains("is a judgment criterion: it is never evaluated by a rule"));
    assert!(feedback.contains("it is a rule criterion, decided only by trusted code"));
}

#[test]
fn a_changed_binding_and_unknown_references_are_never_guessed() {
    let (store, reader) = (Store::default(), Reader::new());
    let assessment = Assessment::new(&store, &reader);
    let cancel = ModelCancellation::new();
    // The turn was produced under binding-1; the Task now has binding-2.
    let answer = CitedAnswer {
        propose_criteria: vec![approval("c1")],
        propose_basis: vec![ap_basis(vec!["c1", "crit-unknown"])],
        record_facts: vec![amount_fact(
            "INV-0042",
            "1250.00",
            "cell:Sheet1!B2",
            "1,250.00",
            usd(),
        )],
        ..CitedAnswer::default()
    };
    let turn = invocation("turn-1", "binding-1");
    run(assessment.after_answer(&basis("p1"), &binding("binding-2"), &turn, &answer, &cancel))
        .unwrap();
    let state = store.state.lock().unwrap();
    assert_eq!(
        state.criteria[0].authority.reason,
        Some(AuthorityReason::MethodChanged)
    );
    assert!(!state.criteria[0].authority.verified);
    assert_eq!(state.criteria[0].methodology_binding_id, "binding-1");
    assert!(
        state.bases.is_empty(),
        "an unknown criterion reference is refused"
    );
    assert!(state.facts.is_empty(), "no basis, no fact");
    drop(state);
    let context = run(assessment.context(&basis("p1"))).unwrap();
    let feedback = context.feedback.unwrap();
    assert!(
        feedback.contains("crit-unknown is not criteria of this Task"),
        "{feedback}"
    );
    assert!(
        feedback.contains("b1 is not an assessment basis of this Task"),
        "{feedback}"
    );
    let (class, source, body) = open_envelope(&context.outline.unwrap()).unwrap();
    assert_eq!(
        (class, source.as_str()),
        (InputClass::ModelOutput, "assessment-outline")
    );
    assert!(body.contains("authority unverified"));
}

#[test]
fn records_round_trip_their_canonical_documents() {
    let (store, reader) = (Store::default(), Reader::new());
    let assessment = Assessment::new(&store, &reader);
    let cancel = ModelCancellation::new();
    let answer = CitedAnswer {
        propose_criteria: vec![approval("c1")],
        propose_basis: vec![ap_basis(vec!["c1"])],
        record_facts: vec![
            amount_fact("INV-0042", "1250.00", "cell:Sheet1!B2", "1,250.00", usd()),
            value_fact(
                "INV-0042",
                "approver",
                FactValue::Identifier("J. Smith".into()),
                ParseRule::IdentifierExact,
                vec![src("cell:Sheet1!D2", "J. Smith")],
            ),
        ],
        evaluate: vec!["c1".into()],
        ..CitedAnswer::default()
    };
    run(assessment.after_answer(
        &basis("p1"),
        &binding("binding-1"),
        &invocation("t", "binding-1"),
        &answer,
        &cancel,
    ))
    .unwrap();
    let state = store.state.lock().unwrap();
    let c = &state.criteria[0];
    let decoded = CriterionRecord::from_document(&c.document(), c.recorded_us).unwrap();
    assert_eq!(&decoded, c);
    let basis_record = &state.bases[0];
    assert_eq!(
        &BasisRecord::from_document(&basis_record.document(), None).unwrap(),
        basis_record
    );
    for fact in &state.facts {
        assert_eq!(
            &FactRecord::from_document(&fact.document(), None).unwrap(),
            fact
        );
    }
    let e = &state.evaluations[0];
    assert_eq!(
        &EvaluationRecord::from_document(&e.document(), None).unwrap(),
        e
    );
    // An altered document no longer matches its digest or its own fields.
    let mut altered = e.document();
    if let JsonValue::Object(map) = &mut altered {
        map.insert("verdict".into(), JsonValue::String("not_met".into()));
    }
    assert!(EvaluationRecord::from_document(&altered, None).is_none());
}

#[test]
fn an_answer_without_assessment_fields_records_nothing() {
    let (store, reader) = (Store::default(), Reader::new());
    let assessment = Assessment::new(&store, &reader);
    let answer = CitedAnswer {
        read_method: vec!["criteria/AP-1".into()],
        ..CitedAnswer::default()
    };
    assert!(
        !run(assessment.after_answer(
            &basis("p1"),
            &binding("binding-1"),
            &invocation("t", "binding-1"),
            &answer,
            &ModelCancellation::new()
        ))
        .unwrap()
    );
    let context = run(assessment.context(&basis("p1"))).unwrap();
    assert_eq!(context, AssessmentContext::default());
    assert_eq!(*reader.reads.lock().unwrap(), 0);
}
