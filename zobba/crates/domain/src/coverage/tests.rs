use super::*;
use crate::assessment::{
    Comparison, CriterionMethod, Decimal, EvaluationContext, MissingTreatment, Predicate,
    ProposedCriterion, RequiredFact, evaluate,
};
use crate::citation::CellRange;

fn usd() -> Measure {
    Measure::Currency("USD".into())
}
fn spec() -> ProposedPopulation {
    let boolean = |header: &str, name: &str| ValueColumn {
        header: header.into(),
        name: name.into(),
        kind: FactType::Boolean,
        rule: ParseRule::BooleanYesNo,
        measure: None,
        measure_column: None,
    };
    ProposedPopulation {
        key: "ap".into(),
        basis: "fy2026".into(),
        supersedes: None,
        original_id: "ap-population".into(),
        sheet: Some("Invoices".into()),
        header_row: 3,
        subject_unit: "invoice".into(),
        grain: vec!["Invoice".into()],
        period: Some(("Invoice date".into(), ParseRule::DateIso)),
        values: vec![
            ValueColumn {
                header: "Amount".into(),
                name: "amount".into(),
                kind: FactType::Decimal,
                rule: ParseRule::DecimalGroupedComma,
                measure: Some(usd()),
                measure_column: Some("Currency".into()),
            },
            boolean("Approved", "approved"),
            boolean("Approved before payment", "approved_before_paid"),
        ],
        exhaustive: true,
        control: None,
        selection: "Every invoice of the AP export".into(),
    }
}
fn cell(text: &str, column: u32, row: u32) -> CellRead {
    CellRead {
        texts: Some(vec![text.into()]),
        locator: Some(Locator::Cell {
            sheet: "Invoices".into(),
            range: CellRange {
                first_column: column,
                first_row: row,
                last_column: column,
                last_row: row,
            },
        }),
        kind: CellKind::Text,
    }
}
fn row(row_number: u32, values: [&str; 6]) -> RowRead {
    RowRead {
        row: row_number,
        cells: values
            .iter()
            .enumerate()
            .map(|(i, v)| cell(v, i as u32 + 1, row_number))
            .collect(),
    }
}
fn enumeration(rows: Vec<[String; 6]>) -> Enumeration {
    let header_row = 3;
    let n = rows.len() as u32;
    Enumeration {
        header_row,
        last_row: header_row + n,
        rows_read: n,
        truncated: false,
        rows: rows
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let refs: [&str; 6] = std::array::from_fn(|k| r[k].as_str());
                row(header_row + 1 + i as u32, refs)
            })
            .collect(),
    }
}
fn date(text: &str) -> CivilDate {
    CivilDate::parse_iso(text).unwrap()
}

/// The AC1/AC2 population: 1,250 invoices and 6 exact duplicate rows.
/// 1–50 are dated in 2025; 51–250 are 500.00 USD; 251–1250 are 1,500.00 USD.
/// A (approved) is No for 251–265 and Pending for 276–285; B (approved
/// before payment) is No for 259–270 and Unknown for 286–295.
fn ap_rows() -> Vec<[String; 6]> {
    let mut rows: Vec<[String; 6]> = (1..=1250u32)
        .map(|i| {
            let date = if i <= 50 { "2025-12-15" } else { "2026-03-05" };
            let amount = if i <= 250 { "500" } else { "1,500.00" };
            let a = match i {
                251..=265 => "No",
                276..=285 => "Pending",
                _ => "Yes",
            };
            let b = match i {
                259..=270 => "No",
                286..=295 => "Unknown",
                _ => "Yes",
            };
            [
                format!("INV-{i:05}"),
                date.into(),
                amount.into(),
                a.into(),
                b.into(),
                "USD".into(),
            ]
        })
        .collect();
    for i in 1000..1006 {
        rows.push(rows[i - 1].clone());
    }
    rows
}

fn criterion(key: &str, fact: &str) -> ProposedCriterion {
    ProposedCriterion {
        key: key.into(),
        supersedes: None,
        assertion: "An approval is recorded".into(),
        authority: crate::assessment::Authority::Method {
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
            RequiredFact {
                name: "amount".into(),
                kind: FactType::Decimal,
                measure: Some(usd()),
            },
            RequiredFact {
                name: fact.into(),
                kind: FactType::Boolean,
                measure: None,
            },
        ],
        method: CriterionMethod::Rule(Predicate::IsTrue { fact: fact.into() }),
        missing: MissingTreatment::Undetermined,
    }
}

/// Evaluate each criterion over every in-scope member with the 24.1 pure
/// evaluator, as trusted code does.
fn opportunities(
    members: &[Member],
    criteria: &[(&str, ProposedCriterion)],
) -> Vec<CriterionOpportunities> {
    let spec = spec();
    criteria
        .iter()
        .map(|(id, c)| CriterionOpportunities {
            criterion_id: (*id).into(),
            judgment: false,
            opportunities: members
                .iter()
                .filter(|m| m.disposition == Disposition::InScope)
                .map(|m| {
                    let facts = m.facts("pop-x", "d", &spec);
                    let outcome = evaluate(
                        c,
                        &EvaluationContext {
                            period_from: date("2026-01-01"),
                            period_to: date("2026-12-31"),
                            authority_verified: true,
                            facts: &facts,
                        },
                    );
                    OpportunityFacts {
                        subject: m.subject.clone().unwrap(),
                        origin: outcome.origin,
                        applicability: outcome.applicability,
                        execution: outcome.execution,
                        verdict: outcome.verdict,
                        reason: outcome.reason,
                    }
                })
                .collect(),
        })
        .collect()
}
fn in_scope(members: &[Member]) -> BTreeSet<String> {
    members
        .iter()
        .filter(|m| m.disposition == Disposition::InScope)
        .filter_map(|m| m.subject.clone())
        .collect()
}
fn facts_of(
    members: &[Member],
    exhaustive: bool,
    e: &Enumeration,
    declared: Option<u64>,
) -> PopulationFacts {
    let pairs: Vec<(Option<&str>, Disposition)> = members
        .iter()
        .map(|m| (m.subject.as_deref(), m.disposition))
        .collect();
    let counts = PopulationCounts::of(&pairs);
    let (completeness, reconciliation) =
        completeness(exhaustive, e, declared, counts.distinct_subjects);
    PopulationFacts {
        completeness,
        reconciliation,
        counts,
        period_checked: true,
        naive_date_times: 0,
    }
}

#[test]
fn ac1_period_duplicates_and_applicability_are_exact() {
    let e = enumeration(ap_rows());
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let facts = facts_of(&members, true, &e, Some(1250));
    let c = facts.counts;
    assert_eq!(
        (
            c.received_rows,
            c.duplicate_rows,
            c.distinct_subjects,
            c.excluded_out_of_period,
            c.in_scope,
            c.unkeyed
        ),
        (1256, 6, 1250, 50, 1200, 0)
    );
    assert_eq!(facts.completeness, Completeness::Complete);
    assert_eq!(facts.reconciliation, Reconciliation::Matched);
    // The duplicates point at the first row of their key.
    assert_eq!(
        members[1250].disposition,
        Disposition::DuplicateRow { first: 999 }
    );
    assert_eq!(
        members[0].disposition,
        Disposition::Excluded(DispositionReason::OutOfPeriod)
    );
    let opportunities = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    let summary = summarise(&facts, &in_scope(&members), &opportunities, None);
    let a = &summary.criteria[0];
    assert_eq!(
        (a.applicable, a.not_applicable, a.applicability_unknown),
        (1000, 200, 0)
    );
    assert!(summary.is_consistent());
}

#[test]
fn ac2_overlap_counts_subjects_and_opportunities_separately() {
    let e = enumeration(ap_rows());
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let facts = facts_of(&members, true, &e, None);
    let opportunities = opportunities(
        &members,
        &[
            ("crit-a", criterion("a", "approved")),
            ("crit-b", criterion("b", "approved_before_paid")),
        ],
    );
    let summary = summarise(&facts, &in_scope(&members), &opportunities, None);
    let (a, b) = (&summary.criteria[0], &summary.criteria[1]);
    assert_eq!((a.met, a.not_met, a.undetermined), (975, 15, 10));
    assert_eq!((b.met, b.not_met, b.undetermined), (978, 12, 10));
    assert_eq!(
        a.undetermined_by_reason,
        BTreeMap::from([("fact_unsupported".to_string(), 10)])
    );
    assert_eq!(
        summary.partition,
        Partition {
            failing: 20,
            meets_every_applicable: 960,
            unresolved: 20,
            not_applicable_to_any: 200,
        }
    );
    // 27 failing opportunities; 20 failing subjects. Never summed as records.
    assert_eq!(summary.failing_opportunities, 27);
    assert_eq!(summary.conclusion, Conclusion::ExceptionsFoundInconclusive);
    assert!(summary.is_consistent());
    // Pure: the same inputs give the same canonical digest.
    let again = summarise(&facts, &in_scope(&members), &opportunities, None);
    assert_eq!(summary.digest(), again.digest());
    assert_eq!(summary.document(), again.document());
    // No percentage, no inference, no confidence in the document.
    let text = canonical_json(&summary.document());
    assert!(!text.contains('%') && !text.contains("confiden") && !text.contains("percent"));
    assert!(text.contains("\"statistical_inference\":false"));
}

#[test]
fn zero_applicable_is_no_eligible_items_never_a_pass() {
    let rows: Vec<[String; 6]> = (1..=20u32)
        .map(|i| {
            [
                format!("INV-{i:05}"),
                "2026-02-01".into(),
                "1,000.00".into(),
                "No".into(),
                "Yes".into(),
                "USD".into(),
            ]
        })
        .collect();
    let e = enumeration(rows);
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let facts = facts_of(&members, true, &e, None);
    let ops = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    let summary = summarise(&facts, &in_scope(&members), &ops, None);
    assert_eq!(
        summary.partition.not_applicable_to_any,
        summary.counts.in_scope
    );
    assert_eq!(summary.conclusion, Conclusion::NoEligibleItems);
    assert_ne!(summary.conclusion, Conclusion::NoExceptionFound);
}

#[test]
fn a_non_exhaustive_empty_export_proves_no_absence() {
    let e = enumeration(vec![]);
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let facts = facts_of(&members, false, &e, None);
    assert_eq!(
        facts.completeness,
        Completeness::Incomplete(IncompleteReason::NotExhaustive)
    );
    let summary = summarise(
        &facts,
        &in_scope(&members),
        &opportunities(&members, &[("crit-a", criterion("a", "approved"))]),
        None,
    );
    assert_eq!(summary.counts.received_rows, 0);
    assert_eq!(summary.conclusion, Conclusion::NoItemsFoundAbsenceNotProven);
    // The same empty file, stated exhaustive, has no eligible items.
    let exhaustive = facts_of(&members, true, &e, None);
    assert_eq!(
        summarise(&exhaustive, &BTreeSet::new(), &[], None).conclusion,
        Conclusion::NoEligibleItems
    );
}

#[test]
fn a_truncated_read_is_incomplete_row_bound_and_never_a_pass() {
    let mut e = enumeration(
        (1..=4u32)
            .map(|i| {
                [
                    format!("INV-{i:05}"),
                    "2026-02-01".into(),
                    "1,500.00".into(),
                    "Yes".into(),
                    "Yes".into(),
                    "USD".into(),
                ]
            })
            .collect(),
    );
    // The bound was reached before the sheet's last row.
    e.truncated = true;
    e.last_row = e.header_row + MAX_POPULATION_ROWS + 1;
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let facts = facts_of(&members, true, &e, None);
    assert_eq!(
        facts.completeness,
        Completeness::Incomplete(IncompleteReason::RowBound)
    );
    let ops = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    let summary = summarise(&facts, &in_scope(&members), &ops, None);
    assert_eq!(summary.partition.meets_every_applicable, 4);
    assert_eq!(summary.conclusion, Conclusion::Inconclusive);
    // Read every row, but a row went missing: also row_bound.
    let mut short = enumeration(vec![]);
    short.last_row = short.header_row + 1;
    assert_eq!(
        completeness(true, &short, None, 0).0,
        Completeness::Incomplete(IncompleteReason::RowBound)
    );
}

#[test]
fn a_control_count_mismatch_is_incomplete_with_both_numbers() {
    let e = enumeration(ap_rows());
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let facts = facts_of(&members, true, &e, Some(1251));
    assert_eq!(
        facts.completeness,
        Completeness::Incomplete(IncompleteReason::CountMismatch)
    );
    assert_eq!(
        facts.reconciliation,
        Reconciliation::Mismatch {
            declared: 1251,
            distinct: 1250
        }
    );
    // A not-exhaustive source states the first reason; the mismatch is
    // still reported.
    let other = facts_of(&members, false, &e, Some(1251));
    assert_eq!(
        other.completeness,
        Completeness::Incomplete(IncompleteReason::NotExhaustive)
    );
    assert!(matches!(
        other.reconciliation,
        Reconciliation::Mismatch { .. }
    ));
}

#[test]
fn a_cited_control_count_is_a_whole_number() {
    let count = |quote: &str, rule| {
        ControlCount {
            source: CitationSource {
                original_id: "ap".into(),
                locator: None,
                quote: quote.into(),
            },
            rule,
        }
        .parse()
    };
    assert_eq!(count("1,250", ParseRule::DecimalGroupedComma), Some(1250));
    assert_eq!(count("1250", ParseRule::DecimalPlain), Some(1250));
    assert_eq!(
        count("1,250.00", ParseRule::DecimalGroupedComma),
        None,
        "scale 0 only"
    );
    assert_eq!(count("-3", ParseRule::DecimalPlain), None);
    assert_eq!(count("1,250", ParseRule::DecimalPlain), None);
}

#[test]
fn conflicting_duplicates_unparsed_and_missing_periods_are_scope_unknown() {
    let r = |key: &str, date: &str, amount: &str| -> [String; 6] {
        [
            key.into(),
            date.into(),
            amount.into(),
            "Yes".into(),
            "Yes".into(),
            "USD".into(),
        ]
    };
    let mut s = spec();
    s.period = Some(("Invoice date".into(), ParseRule::DateDmy));
    let e = enumeration(vec![
        r("000123", "05/03/2026", "1,500.00"),
        r("000123", "05/03/2026", "1,600.00"),
        r("INV-1", "31/02/2026", "1,500.00"),
        r("INV-2", "", "1,500.00"),
        r("", "05/03/2026", "1,500.00"),
        r("INV-3", "05/03/2026", "1,500.00"),
    ]);
    let members = build_members(&s, &e, date("2026-01-01"), date("2026-12-31"));
    let d: Vec<Disposition> = members.iter().map(|m| m.disposition).collect();
    use DispositionReason as R;
    assert_eq!(
        d,
        [
            Disposition::ScopeUnknown(R::ConflictingDuplicate),
            Disposition::ScopeUnknown(R::ConflictingDuplicate),
            Disposition::ScopeUnknown(R::PeriodUnparsed),
            Disposition::ScopeUnknown(R::PeriodMissing),
            Disposition::Unkeyed,
            Disposition::InScope,
        ]
    );
    // The key is kept exactly, leading zeros included.
    assert_eq!(members[0].subject.as_deref(), Some("000123"));
    let pairs: Vec<(Option<&str>, Disposition)> = members
        .iter()
        .map(|m| (m.subject.as_deref(), m.disposition))
        .collect();
    let counts = PopulationCounts::of(&pairs);
    assert_eq!(
        (
            counts.received_rows,
            counts.distinct_subjects,
            counts.scope_unknown_conflicting_duplicate,
            counts.scope_unknown_period_unparsed,
            counts.scope_unknown_period_missing,
            counts.unkeyed,
            counts.in_scope
        ),
        (6, 4, 1, 1, 1, 1, 1)
    );
    assert!(counts.is_consistent());
    // Scope-unknown subjects keep the conclusion from a clean pass.
    let facts = PopulationFacts {
        completeness: Completeness::Complete,
        reconciliation: Reconciliation::NotDeclared,
        counts,
        period_checked: true,
        naive_date_times: 0,
    };
    let s = spec();
    let ops = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    let _ = s;
    let summary = summarise(&facts, &in_scope(&members), &ops, None);
    assert_eq!(summary.partition.meets_every_applicable, 1);
    assert_eq!(summary.conclusion, Conclusion::Inconclusive);
    assert!(
        summary
            .limitations
            .iter()
            .any(|l| l.words().contains("3 subjects have an unknown scope"))
    );
}

#[test]
fn a_typed_cell_that_does_not_parse_is_unsupported_and_visible() {
    let e = enumeration(vec![[
        "INV-9".into(),
        "2026-02-01".into(),
        "about 1500".into(),
        "Yes".into(),
        "Yes".into(),
        "".into(),
    ]]);
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    assert_eq!(members[0].values[0], MemberValue::Unsupported);
    assert_eq!(members[0].cells[2].text.as_deref(), Some("about 1500"));
    let facts = members[0].facts("pop-x", "d", &spec());
    let amount = facts.iter().find(|f| f.name == "amount").unwrap();
    assert_eq!(
        amount.support,
        FactSupport::Unsupported(UnsupportedReason::TypeMismatch)
    );
    // An amount without a currency cell keeps the declared currency, which
    // is then only claimed.
    let e = enumeration(vec![[
        "INV-9".into(),
        "2026-02-01".into(),
        "1,500.00".into(),
        "Yes".into(),
        "Yes".into(),
        "".into(),
    ]]);
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    match &members[0].values[0] {
        MemberValue::Value {
            measure_grounded, ..
        } => assert_eq!(*measure_grounded, Some(false)),
        other => panic!("{other:?}"),
    }
    let ops = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    assert_eq!(
        ops[0].opportunities[0].reason,
        Some(EvaluationReason::UnitUnverified)
    );
    // A EUR row is a unit mismatch, never compared as USD.
    let e = enumeration(vec![[
        "INV-9".into(),
        "2026-02-01".into(),
        "1,500.00".into(),
        "Yes".into(),
        "Yes".into(),
        "EUR".into(),
    ]]);
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let ops = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    assert_eq!(
        ops[0].opportunities[0].reason,
        Some(EvaluationReason::UnitMismatch)
    );
    assert_eq!(
        ops[0].opportunities[0].applicability,
        Applicability::Unknown
    );
}

#[test]
fn subject_keys_are_exact_and_injective() {
    assert_eq!(subject_key(&["000123"]).as_deref(), Some("000123"));
    assert_eq!(
        subject_key(&["a|b"]).as_deref(),
        Some("a|b"),
        "one column needs no escape"
    );
    assert_ne!(subject_key(&["a|b", "c"]), subject_key(&["a", "b|c"]));
    assert_eq!(subject_key(&["INV-1", "2"]).as_deref(), Some("INV-1|2"));
    assert_eq!(subject_key(&["INV-1", " "]), None);
    assert_eq!(subject_key(&[&"x".repeat(129)]), None);
}

#[test]
fn a_changed_grain_stands_alone_and_says_why_judgments_are_not_counted() {
    let facts = PopulationFacts {
        completeness: Completeness::Complete,
        reconciliation: Reconciliation::NotDeclared,
        counts: PopulationCounts {
            received_rows: 2,
            distinct_subjects: 2,
            in_scope: 2,
            ..PopulationCounts::default()
        },
        period_checked: true,
        naive_date_times: 0,
    };
    let subjects: BTreeSet<String> = ["INV-1|1", "INV-1|2"].map(String::from).into();
    let pending = |subject: &str| OpportunityFacts {
        subject: subject.into(),
        origin: Origin::Deterministic,
        applicability: Applicability::Applicable,
        execution: Execution::Completed,
        verdict: None,
        reason: None,
    };
    let summary = summarise(
        &facts,
        &subjects,
        &[CriterionOpportunities {
            criterion_id: "crit-j".into(),
            judgment: true,
            opportunities: vec![pending("INV-1|1"), pending("INV-1|2")],
        }],
        None,
    );
    assert_eq!(summary.criteria[0].not_evaluated, 2);
    assert_eq!(summary.partition.unresolved, 2);
    assert_eq!(summary.conclusion, Conclusion::Inconclusive);
    assert!(
        summary
            .limitations
            .iter()
            .any(|l| l.words().contains("judgments recorded at another unit"))
    );
    // A criterion with no opportunity at all is not evaluated for those items.
    let none = summarise(
        &facts,
        &subjects,
        &[CriterionOpportunities {
            criterion_id: "crit-r".into(),
            judgment: false,
            opportunities: vec![],
        }],
        None,
    );
    assert_eq!(none.criteria[0].applicability_unknown, 2);
    assert_eq!(none.partition.unresolved, 2);
    assert!(none.is_consistent());
}

#[test]
fn the_conclusion_table_is_closed() {
    let p = |failing, meets, unresolved, na| Partition {
        failing,
        meets_every_applicable: meets,
        unresolved,
        not_applicable_to_any: na,
    };
    use Conclusion as C;
    for (complete, sample, received, partition, scope, expected) in [
        (true, false, 10, p(0, 10, 0, 0), 0, C::NoExceptionFound),
        (true, false, 10, p(0, 10, 0, 0), 1, C::Inconclusive),
        (true, false, 10, p(0, 9, 1, 0), 0, C::Inconclusive),
        (true, false, 10, p(1, 9, 0, 0), 0, C::ExceptionsFound),
        (
            true,
            false,
            10,
            p(1, 8, 1, 0),
            0,
            C::ExceptionsFoundInconclusive,
        ),
        (
            false,
            false,
            10,
            p(1, 9, 0, 0),
            0,
            C::ExceptionsFoundInconclusive,
        ),
        (false, false, 10, p(0, 10, 0, 0), 0, C::Inconclusive),
        (true, false, 10, p(0, 0, 0, 10), 0, C::NoEligibleItems),
        (false, false, 10, p(0, 0, 0, 10), 0, C::Inconclusive),
        (
            false,
            false,
            0,
            p(0, 0, 0, 0),
            0,
            C::NoItemsFoundAbsenceNotProven,
        ),
        (true, false, 0, p(0, 0, 0, 0), 0, C::NoEligibleItems),
        // A sample never yields no exception found for the population.
        (true, true, 10, p(0, 5, 0, 0), 0, C::Inconclusive),
        (true, true, 10, p(1, 4, 0, 0), 0, C::ExceptionsFound),
    ] {
        assert_eq!(
            conclusion(
                complete,
                sample,
                received,
                &partition,
                Unproven {
                    scope_unknown: scope,
                    ..Unproven::default()
                }
            ),
            expected
        );
    }
}

#[test]
fn a_seeded_sample_is_recomputed_and_a_mismatch_refused() {
    // SplitMix64 reference vectors (seed 0 and 1234567).
    let mut state = 0;
    assert_eq!(splitmix64(&mut state), 0xE220_A839_7B1D_CDAF);
    let mut state = 1_234_567;
    assert_eq!(splitmix64(&mut state), 6_457_827_717_110_365_317);
    assert_eq!(splitmix64(&mut state), 3_203_168_211_198_807_973);
    let keys: BTreeSet<String> = (1..=10u32).map(|i| format!("INV-{i:02}")).collect();
    let ordered: Vec<String> = keys.iter().cloned().collect();
    // Independently computed with Python's integers (same algorithm).
    assert_eq!(
        seeded_selection(&ordered, 42, 3),
        ["INV-04", "INV-03", "INV-05"]
    );
    let chosen = seeded_selection(&ordered, 42, 3);
    let sample = |keys: Vec<String>, substitutions: Vec<Substitution>| ProposedSample {
        key: "s1".into(),
        population: "ap".into(),
        method: SampleMethod::SeededRandom { seed: 42 },
        size: 3,
        strata: String::new(),
        justification: "Seeded selection over in-scope invoices".into(),
        keys,
        substitutions,
    };
    let ok = sample(chosen.clone(), vec![]);
    assert!(ok.is_valid());
    let mut expected = chosen.clone();
    expected.sort();
    assert_eq!(check_sample(&ok, &keys), Ok(expected));
    // Another key set is refused, even when every key is in scope.
    let wrong = sample(
        vec!["INV-01".into(), "INV-03".into(), "INV-05".into()],
        vec![],
    );
    assert_eq!(
        check_sample(&wrong, &keys),
        Err(SampleRefusal::SelectionMismatch)
    );
    // A documented substitution replaces a selected key.
    let mut substituted = chosen.clone();
    substituted[0] = "INV-10".into();
    let swap = sample(
        substituted,
        vec![Substitution {
            replaced: chosen[0].clone(),
            substitute: "INV-10".into(),
            reason: "The original invoice was voided".into(),
        }],
    );
    assert!(check_sample(&swap, &keys).is_ok());
    // A key outside the in-scope subjects is refused.
    let outside = sample(
        vec!["INV-99".into(), chosen[1].clone(), chosen[2].clone()],
        vec![],
    );
    assert_eq!(
        check_sample(&outside, &keys),
        Err(SampleRefusal::NotInScope("INV-99".into()))
    );
}

#[test]
fn a_sample_summary_covers_the_selected_items_only() {
    let e = enumeration(ap_rows());
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let facts = facts_of(&members, true, &e, None);
    let scope = in_scope(&members);
    let ordered: Vec<String> = scope.iter().cloned().collect();
    let selected: BTreeSet<String> = seeded_selection(&ordered, 42, 25).into_iter().collect();
    let ops = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    let summary = summarise(&facts, &scope, &ops, Some(&selected));
    assert_eq!(summary.selected, Some(25));
    let p = summary.partition;
    assert_eq!(
        p.failing + p.meets_every_applicable + p.unresolved + p.not_applicable_to_any,
        25
    );
    assert_ne!(summary.conclusion, Conclusion::NoExceptionFound);
    assert!(
        summary
            .limitations
            .iter()
            .any(|l| l.words().contains("selected items only"))
    );
    assert!(summary.is_consistent());
}

#[test]
fn a_summary_whose_counts_disagree_is_not_consistent() {
    let e = enumeration(ap_rows());
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let facts = facts_of(&members, true, &e, None);
    let ops = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    let summary = summarise(&facts, &in_scope(&members), &ops, None);
    assert!(summary.is_consistent());
    // The partition must add up to the subjects (the database also
    // recounts every number from the stored rows).
    let mut forged = summary.clone();
    forged.partition.failing += 1;
    assert!(!forged.is_consistent());
    let mut forged = summary.clone();
    forged.criteria[0].met -= 1;
    assert!(!forged.is_consistent());
    let mut forged = summary.clone();
    forged.conclusion = Conclusion::NoExceptionFound;
    assert!(!forged.is_consistent());
    let mut forged = summary.clone();
    forged.failing_opportunities += 1;
    assert!(!forged.is_consistent());
}

#[test]
fn proposals_decode_strictly_and_bounds_hold() {
    let population = JsonValue::Object(
        [
            ("key", JsonValue::String("ap".into())),
            ("basis", JsonValue::String("fy2026".into())),
            ("supersedes", JsonValue::String("".into())),
            ("original_id", JsonValue::String("ap-population".into())),
            ("sheet", JsonValue::String("Invoices".into())),
            ("header_row", JsonValue::Integer(3)),
            ("subject_unit", JsonValue::String("invoice".into())),
            (
                "grain",
                JsonValue::Array(vec![JsonValue::String("Invoice".into())]),
            ),
            ("period_column", JsonValue::String("Invoice date".into())),
            ("period_rule", JsonValue::String("date_iso".into())),
            ("value_columns", JsonValue::Array(vec![])),
            ("exhaustive", JsonValue::Bool(true)),
            ("control_original_id", JsonValue::String("".into())),
            ("control_locator", JsonValue::String("".into())),
            ("control_quote", JsonValue::String("".into())),
            ("control_rule", JsonValue::String("".into())),
            ("selection", JsonValue::String("Every invoice".into())),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect(),
    );
    let decoded = decode_population(&population).unwrap();
    assert_eq!(decoded.header_row, 3);
    assert!(decoded.period.is_some() && decoded.control.is_none());
    let mut changed = population.clone();
    if let JsonValue::Object(map) = &mut changed {
        map.insert("period_rule".into(), JsonValue::String("".into()));
    }
    assert!(
        decode_population(&changed).is_none(),
        "a period column needs its rule"
    );
    let mut changed = population.clone();
    if let JsonValue::Object(map) = &mut changed {
        map.insert("sheet".into(), JsonValue::String("".into()));
    }
    assert!(
        decode_population(&changed).is_none(),
        "CSV has its header in row 1"
    );
    let mut changed = population;
    if let JsonValue::Object(map) = &mut changed {
        map.insert(
            "grain".into(),
            JsonValue::Array((0..4).map(|i| JsonValue::String(format!("G{i}"))).collect()),
        );
    }
    assert!(
        decode_population(&changed).is_none(),
        "at most three grain columns"
    );
    // A spec naming more than twelve columns is invalid: three grain
    // columns, a period, eight values and a measure column.
    let mut wide = spec();
    wide.grain = vec!["G1".into(), "G2".into(), "G3".into()];
    wide.values = (0..MAX_VALUE_COLUMNS)
        .map(|i| ValueColumn {
            header: format!("Extra {i}"),
            name: format!("extra_{i}"),
            kind: FactType::Text,
            rule: ParseRule::TextExact,
            measure: None,
            measure_column: None,
        })
        .collect();
    assert_eq!(wide.columns().len(), MAX_POPULATION_COLUMNS);
    assert!(wide.is_valid());
    wide.values[0] = ValueColumn {
        header: "Extra 0".into(),
        name: "extra_0".into(),
        kind: FactType::Decimal,
        rule: ParseRule::DecimalPlain,
        measure: Some(usd()),
        measure_column: Some("Currency".into()),
    };
    assert_eq!(wide.columns().len(), MAX_POPULATION_COLUMNS + 1);
    assert!(!wide.is_valid());
    assert!(spec().is_valid());
    assert_eq!(
        (
            MAX_POPULATION_ROWS,
            MAX_POPULATION_COLUMNS,
            MAX_CELL_TEXT_BYTES
        ),
        (20_000, 12, 256)
    );
    // A seed is a plain decimal u64.
    let sample = |seed: &str, method: &str| {
        JsonValue::Object(
            [
                ("key", JsonValue::String("s".into())),
                ("population", JsonValue::String("ap".into())),
                ("method", JsonValue::String(method.into())),
                ("seed", JsonValue::String(seed.into())),
                ("size", JsonValue::Integer(1)),
                ("strata", JsonValue::String("".into())),
                ("justification", JsonValue::String("Why".into())),
                (
                    "keys",
                    JsonValue::Array(vec![JsonValue::String("INV-1".into())]),
                ),
                ("substitutions", JsonValue::Array(vec![])),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        )
    };
    assert!(decode_sample(&sample("42", "seeded_random")).is_some());
    assert!(decode_sample(&sample("042", "seeded_random")).is_none());
    assert!(decode_sample(&sample("18446744073709551616", "seeded_random")).is_none());
    assert!(
        decode_sample(&sample("42", "judgmental")).is_none(),
        "a seed only for a seeded method"
    );
    assert!(decode_sample(&sample("", "judgmental")).is_some());
}

#[test]
fn the_answer_fields_fit_their_bounds() {
    let fields = answer_fields();
    let names: Vec<&str> = fields.iter().map(|(n, _)| *n).collect();
    assert_eq!(
        names,
        [
            "propose_population",
            "propose_sample",
            "evaluate_population",
            "summarise"
        ]
    );
    for (name, schema) in &fields {
        assert!(schema.is_valid(), "{name}");
    }
    let max = |name: &str| match &fields.iter().find(|(n, _)| *n == name).unwrap().1 {
        ArgumentSchema::Array { max_items, .. } => *max_items as usize,
        _ => panic!(),
    };
    assert_eq!(
        (
            max("propose_population"),
            max("propose_sample"),
            max("evaluate_population"),
            max("summarise")
        ),
        (1, 1, 4, 2)
    );
}

// ---------------------------------------------------------- review round 1

fn complete_facts(counts: PopulationCounts) -> PopulationFacts {
    PopulationFacts {
        completeness: Completeness::Complete,
        reconciliation: Reconciliation::NotDeclared,
        counts,
        period_checked: true,
        naive_date_times: 0,
    }
}
fn met(subject: &str, origin: Origin) -> OpportunityFacts {
    OpportunityFacts {
        subject: subject.into(),
        origin,
        applicability: Applicability::Applicable,
        execution: Execution::Completed,
        verdict: Some(Verdict::Met),
        reason: None,
    }
}

#[test]
fn unkeyed_rows_and_unreviewed_judgments_never_prove_no_exception() {
    let p = Partition {
        meets_every_applicable: 10,
        ..Partition::default()
    };
    use Conclusion as C;
    let clean = Unproven::default();
    assert_eq!(conclusion(true, false, 10, &p, clean), C::NoExceptionFound);
    // A row with no usable key was never assessed.
    let unkeyed = Unproven {
        unkeyed: 1,
        ..clean
    };
    assert_eq!(conclusion(true, false, 11, &p, unkeyed), C::Inconclusive);
    let failing = Partition {
        failing: 1,
        meets_every_applicable: 9,
        ..Partition::default()
    };
    assert_eq!(
        conclusion(true, false, 11, &failing, unkeyed),
        C::ExceptionsFoundInconclusive
    );
    let none = Partition {
        not_applicable_to_any: 10,
        ..Partition::default()
    };
    assert_eq!(conclusion(true, false, 11, &none, unkeyed), C::Inconclusive);
    // A sample covers its selected items: unkeyed rows are not among them.
    assert_eq!(
        conclusion(true, true, 11, &failing, unkeyed),
        C::ExceptionsFound
    );
    // A met that is an unreviewed model proposal is not proven.
    let unreviewed = Unproven {
        unreviewed_met: 3,
        ..clean
    };
    assert_eq!(conclusion(true, false, 10, &p, unreviewed), C::Inconclusive);
    assert_eq!(
        conclusion(true, false, 10, &failing, unreviewed),
        C::ExceptionsFound
    );
}

#[test]
fn a_summary_says_how_many_mets_are_unreviewed_model_proposals() {
    let subjects: BTreeSet<String> = ["INV-1", "INV-2"].map(String::from).into();
    let facts = complete_facts(PopulationCounts {
        received_rows: 2,
        distinct_subjects: 2,
        in_scope: 2,
        ..PopulationCounts::default()
    });
    let rule = CriterionOpportunities {
        criterion_id: "crit-r".into(),
        judgment: false,
        opportunities: vec![
            met("INV-1", Origin::Deterministic),
            met("INV-2", Origin::Deterministic),
        ],
    };
    let judged = CriterionOpportunities {
        criterion_id: "crit-j".into(),
        judgment: true,
        opportunities: vec![
            met("INV-1", Origin::ModelProposal),
            met("INV-2", Origin::Deterministic),
        ],
    };
    let proven = summarise(&facts, &subjects, std::slice::from_ref(&rule), None);
    assert_eq!(proven.conclusion, Conclusion::NoExceptionFound);
    let summary = summarise(&facts, &subjects, &[rule, judged], None);
    assert_eq!(summary.criteria[1].met, 2);
    assert_eq!(summary.criteria[1].met_unreviewed, 1);
    assert_eq!(summary.partition.meets_every_applicable, 2);
    assert_eq!(summary.conclusion, Conclusion::Inconclusive);
    let limitation = summary
        .limitations
        .iter()
        .find(|l| l.code == LimitationCode::UnreviewedModelJudgments)
        .unwrap();
    assert_eq!(
        (limitation.criterion_id.as_deref(), limitation.count),
        (Some("crit-j"), Some(1))
    );
    assert!(
        limitation
            .words()
            .contains("1 met verdicts are model proposals")
    );
    assert!(summary.is_consistent());
    // A forged met_unreviewed above met is inconsistent.
    let mut forged = summary.clone();
    forged.criteria[1].met_unreviewed = 3;
    assert!(!forged.is_consistent());
}

#[test]
fn a_population_with_keyless_rows_is_inconclusive_and_says_so() {
    // Invoices 301-400 all meet the criterion.
    let mut rows: Vec<[String; 6]> = ap_rows()[300..400].to_vec();
    let e = enumeration(rows.clone());
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let ops = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    let facts = facts_of(&members, true, &e, None);
    let clean = summarise(&facts, &in_scope(&members), &ops, None);
    assert_eq!(clean.conclusion, Conclusion::NoExceptionFound);
    // The same rows and one received row whose key cell is blank.
    rows.push([
        "".into(),
        "2026-03-05".into(),
        "1,500.00".into(),
        "No".into(),
        "No".into(),
        "USD".into(),
    ]);
    let e = enumeration(rows);
    let members = build_members(&spec(), &e, date("2026-01-01"), date("2026-12-31"));
    let facts = facts_of(&members, true, &e, None);
    assert_eq!(facts.counts.unkeyed, 1);
    let ops = opportunities(&members, &[("crit-a", criterion("a", "approved"))]);
    let summary = summarise(&facts, &in_scope(&members), &ops, None);
    assert_eq!(summary.partition.failing, 0);
    assert_eq!(summary.partition.unresolved, 0);
    assert_ne!(summary.conclusion, Conclusion::NoExceptionFound);
    assert_eq!(summary.conclusion, Conclusion::Inconclusive);
    assert!(
        summary
            .limitations
            .iter()
            .any(|l| l.code == LimitationCode::UnkeyedRows && l.count == Some(1))
    );
    assert!(summary.is_consistent());
}

#[test]
fn excel_date_cells_parse_under_every_date_and_instant_rule() {
    // The trusted program writes a typed date-time cell's display form, its
    // date (ISO and day-first) and its instant read as UTC.
    let datetime = CellRead {
        texts: Some(vec![
            "2026-03-05".into(),
            "2026-03-05".into(),
            "05/03/2026".into(),
            "2026-03-05T00:00:00Z".into(),
            "2026-03-05T00:00:00".into(),
        ]),
        locator: None,
        kind: CellKind::DateTime,
    };
    for rule in [ParseRule::DateIso, ParseRule::DateDmy] {
        assert_eq!(
            parse_cell(&datetime, rule, None),
            Some(FactValue::Date(date("2026-03-05"))),
            "{rule:?}"
        );
    }
    assert!(matches!(
        parse_cell(&datetime, ParseRule::InstantRfc3339, None),
        Some(FactValue::Instant(_))
    ));
    let mut spec = spec();
    spec.period = Some(("Invoice date".into(), ParseRule::InstantRfc3339));
    let rows = vec![RowRead {
        row: 4,
        cells: vec![
            cell("INV-1", 1, 4),
            datetime.clone(),
            cell("1,500.00", 3, 4),
            cell("Yes", 4, 4),
            cell("Yes", 5, 4),
            cell("USD", 6, 4),
        ],
    }];
    let e = Enumeration {
        header_row: 3,
        last_row: 4,
        rows_read: 1,
        truncated: false,
        rows,
    };
    let members = build_members(&spec, &e, date("2026-01-01"), date("2026-12-31"));
    assert_eq!(members[0].disposition, Disposition::InScope);
    assert_eq!(members[0].cells[1].kind, CellKind::DateTime);
    assert_eq!(naive_date_times(&spec, &members), 1);
    // Under a date rule no instant was read, so nothing was assumed.
    assert_eq!(naive_date_times(&self::spec(), &members), 0);
}

#[test]
fn every_sample_refusal_is_reached() {
    let keys: BTreeSet<String> = (1..=10u32).map(|i| format!("INV-{i:02}")).collect();
    let all = ProposedSample {
        key: "s1".into(),
        population: "ap".into(),
        method: SampleMethod::AllInScope,
        size: 9,
        strata: String::new(),
        justification: "Every in-scope invoice".into(),
        keys: vec![],
        substitutions: vec![],
    };
    assert_eq!(
        check_sample(&all, &keys),
        Err(SampleRefusal::SizeMismatch {
            size: 9,
            in_scope: 10
        })
    );
    let judgmental = |keys: &[&str], substitutions: Vec<(&str, &str)>| ProposedSample {
        method: SampleMethod::Judgmental,
        size: keys.len() as u32,
        keys: keys.iter().map(|k| (*k).into()).collect(),
        substitutions: substitutions
            .into_iter()
            .map(|(replaced, substitute)| Substitution {
                replaced: replaced.into(),
                substitute: substitute.into(),
                reason: "voided".into(),
            })
            .collect(),
        ..all.clone()
    };
    // Replaced is not an in-scope subject.
    assert_eq!(
        check_sample(&judgmental(&["INV-01"], vec![("INV-99", "INV-01")]), &keys),
        Err(SampleRefusal::Substitution("INV-99".into()))
    );
    // The substitute is not among the selected keys.
    assert_eq!(
        check_sample(&judgmental(&["INV-01"], vec![("INV-02", "INV-03")]), &keys),
        Err(SampleRefusal::Substitution("INV-02".into()))
    );
    // The replaced key is still selected.
    assert_eq!(
        check_sample(
            &judgmental(&["INV-01", "INV-02"], vec![("INV-02", "INV-01")]),
            &keys
        ),
        Err(SampleRefusal::Substitution("INV-02".into()))
    );
    // A seeded selection: the replaced key was not in the recomputed one.
    let ordered: Vec<String> = keys.iter().cloned().collect();
    let chosen = seeded_selection(&ordered, 42, 3);
    let outsider = ordered
        .iter()
        .find(|k| !chosen.contains(k))
        .unwrap()
        .clone();
    let other = ordered
        .iter()
        .find(|k| !chosen.contains(k) && **k != outsider)
        .unwrap()
        .clone();
    let mut stated = chosen.clone();
    stated[0] = other.clone();
    let seeded = ProposedSample {
        method: SampleMethod::SeededRandom { seed: 42 },
        size: 3,
        keys: stated,
        substitutions: vec![Substitution {
            replaced: outsider.clone(),
            substitute: other,
            reason: "voided".into(),
        }],
        ..all.clone()
    };
    assert_eq!(
        check_sample(&seeded, &keys),
        Err(SampleRefusal::Substitution(outsider))
    );
}
