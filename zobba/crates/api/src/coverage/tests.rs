//! The coverage view withholds every cell text and subject key of an
//! original the viewer may not read now, and keeps exact counts as digit
//! strings beside them.
use super::*;
use zobba_domain::{
    assessment::{FactType, Measure, ParseRule},
    citation::Locator,
    coverage::{
        CellKind, Completeness, Disposition, DispositionReason, IncompleteReason, Member,
        MemberCell, ProposedPopulation, ProposedSample, Reconciliation, ValueColumn,
    },
};
use zobba_infrastructure::citation::ViewerOriginal;

const SHA: &str = "aa00000000000000000000000000000000000000000000000000000000000000";

fn spec() -> ProposedPopulation {
    ProposedPopulation {
        key: "ap".into(),
        basis: "basis-1".into(),
        supersedes: None,
        original_id: "ap-population".into(),
        sheet: Some("Invoices".into()),
        header_row: 3,
        subject_unit: "invoice".into(),
        grain: vec!["Invoice".into()],
        period: Some(("Invoice date".into(), ParseRule::parse("date_dmy").unwrap())),
        values: vec![ValueColumn {
            header: "Amount".into(),
            name: "amount".into(),
            kind: FactType::Decimal,
            rule: ParseRule::parse("decimal_grouped_comma").unwrap(),
            measure: Some(Measure::Currency("USD".into())),
            measure_column: Some("Currency".into()),
        }],
        exhaustive: false,
        control: None,
        selection: "Every invoice".into(),
    }
}

fn record() -> PopulationRecord {
    PopulationRecord {
        id: "pop-1".into(),
        task_id: "task-1".into(),
        cycle_id: "cycle-1".into(),
        invocation_id: "inv-1".into(),
        ordinal: 0,
        methodology_binding_id: "binding-1".into(),
        execution_epoch: 1,
        basis_id: "basis-1".into(),
        population: spec(),
        original_sha256: SHA.into(),
        control: None,
        declared_count: None,
        job_id: Some("job-1".into()),
        last_row: 5,
        rows_read: 2,
        truncated: false,
        counts: PopulationCounts {
            received_rows: 2,
            distinct_subjects: 1,
            scope_unknown_conflicting_duplicate: 1,
            excluded_out_of_period: 1,
            ..PopulationCounts::default()
        },
        completeness: Completeness::Incomplete(IncompleteReason::NotExhaustive),
        reconciliation: Reconciliation::NotDeclared,
        naive_date_times: 0,
        digest: SHA.into(),
        recorded_us: Some(1),
    }
}

fn readable() -> Originals {
    [(
        "ap-population".to_string(),
        ViewerOriginal {
            filename: Some("AP population.xlsx".into()),
            version: "v1".into(),
            sha256: SHA.into(),
        },
    )]
    .into()
}

fn member_record() -> MemberRecord {
    MemberRecord::new(
        "pop-1",
        &spec(),
        Member {
            ordinal: 0,
            row: 4,
            subject: Some("000123".into()),
            disposition: Disposition::ScopeUnknown(DispositionReason::ConflictingDuplicate),
            cells: [
                ("000123", "cell:Invoices!A4"),
                ("05/03/2026", "cell:Invoices!B4"),
                ("1,250.00", "cell:Invoices!C4"),
                ("EUR", "cell:Invoices!F4"),
            ]
            .map(|(text, at)| MemberCell {
                text: Some(text.into()),
                locator: Locator::parse(at),
                kind: CellKind::Text,
            })
            .into(),
            values: vec![MemberValue::Value {
                value: zobba_domain::assessment::FactValue::Decimal {
                    value: zobba_domain::assessment::Decimal::parse_grouped("1,250.00").unwrap(),
                    measure: Measure::Currency("EUR".into()),
                },
                measure_grounded: Some(true),
            }],
        },
    )
}

#[test]
fn counts_are_exact_digit_strings_and_the_filename_needs_the_exact_original() {
    let shown = population(&record(), &readable());
    assert_eq!(shown.filename.as_deref(), Some("AP population.xlsx"));
    assert_eq!(shown.counts.received_rows, "2");
    assert_eq!(shown.counts.scope_unknown_conflicting_duplicate, "1");
    assert_eq!(
        (
            shown.completeness.as_str(),
            shown.incomplete_reason.as_deref()
        ),
        ("incomplete", Some("not_exhaustive"))
    );
    assert_eq!(shown.declared_count, None);
    // Another version of the same original is not the exact original.
    let mut other = readable();
    other.get_mut("ap-population").unwrap().sha256 = "b".repeat(64);
    assert_eq!(population(&record(), &other).filename, None);
    assert_eq!(population(&record(), &Originals::new()).filename, None);
}

#[test]
fn member_cells_and_keys_are_withheld_unless_the_original_is_readable() {
    let spec = spec();
    let names = vec!["amount".to_string()];
    let shown = member(&member_record(), &spec.columns(), &names, true);
    assert_eq!(shown.subject.as_deref(), Some("000123"));
    assert_eq!(shown.cells[2].text.as_deref(), Some("1,250.00"));
    assert_eq!(shown.cells[2].location.as_deref(), Some("Invoices!C4"));
    assert_eq!(
        (shown.disposition.as_str(), shown.reason.as_deref()),
        ("scope_unknown", Some("conflicting_duplicate"))
    );
    assert_eq!(shown.values[0].state, "value");
    assert_eq!(shown.values[0].measure.as_deref(), Some("EUR"));
    assert_eq!(shown.cells[0].kind, "text");
    let hidden = member(&member_record(), &spec.columns(), &names, false);
    assert_eq!(hidden.subject, None);
    assert!(hidden.cells.iter().all(|c| c.text.is_none()));
    // The measure is the text of a currency cell of the original: withheld.
    assert_eq!(hidden.values[0].measure, None);
    assert_eq!(hidden.values[0].value, None);
    assert!(!serde_json::to_string(&hidden).unwrap().contains("EUR"));
    // The row, disposition and location stay: they are platform facts.
    assert_eq!(
        (hidden.row, hidden.disposition.as_str()),
        (4, "scope_unknown")
    );
    assert_eq!(hidden.cells[0].location.as_deref(), Some("Invoices!A4"));
    assert!(!serde_json::to_string(&hidden).unwrap().contains("000123"));
}

fn sample_record(population_id: &str) -> SampleRecord {
    SampleRecord {
        id: "sample-1".into(),
        task_id: "task-1".into(),
        cycle_id: "cycle-1".into(),
        invocation_id: "inv-1".into(),
        ordinal: 0,
        methodology_binding_id: "binding-1".into(),
        execution_epoch: 1,
        population_id: population_id.into(),
        sample: ProposedSample {
            key: "s1".into(),
            population: population_id.into(),
            method: SampleMethod::Judgmental,
            size: 1,
            strata: String::new(),
            justification: "One invoice".into(),
            keys: vec!["000123".into()],
            substitutions: vec![],
        },
        selected: vec!["000123".into()],
        digest: SHA.into(),
        recorded_us: Some(1),
    }
}

#[test]
fn sample_keys_follow_their_population_even_when_it_is_not_listed() {
    // The sample's population is older than the listed ones: it is carried
    // as a referenced population, read exactly by ID.
    let view = CoverageSnapshot {
        populations: vec![],
        referenced: vec![record()],
        samples: vec![sample_record("pop-1")],
        ..CoverageSnapshot::default()
    };
    assert_eq!(originals(&view), vec!["ap-population".to_string()]);
    let shown = sample(&view.samples[0], &view, &readable());
    assert!(!shown.keys_withheld);
    assert_eq!(shown.keys, ["000123"]);
    let hidden = sample(&view.samples[0], &view, &Originals::new());
    assert!(hidden.keys_withheld && hidden.keys.is_empty());
    // A population that is nowhere in the snapshot withholds the keys.
    let unknown = CoverageSnapshot {
        samples: vec![sample_record("pop-other")],
        ..CoverageSnapshot::default()
    };
    assert!(sample(&unknown.samples[0], &unknown, &readable()).keys_withheld);
}
