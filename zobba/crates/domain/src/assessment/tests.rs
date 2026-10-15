use super::*;

fn usd() -> Measure {
    Measure::Currency("USD".into())
}
fn date(text: &str) -> CivilDate {
    CivilDate::parse_iso(text).unwrap()
}
fn fact(name: &str, state: FactState, support: FactSupport) -> InputFact {
    InputFact {
        id: format!("fact-{name}"),
        digest: format!("{:0>64}", name.len()),
        name: name.into(),
        state,
        support,
    }
}
fn amount(text: &str, measure: Measure) -> InputFact {
    fact(
        "amount",
        FactState::Value(FactValue::Decimal {
            value: Decimal::parse_plain(text).unwrap(),
            measure,
        }),
        FactSupport::Supported,
    )
}
fn approver(state: FactState, support: FactSupport) -> InputFact {
    fact("approver", state, support)
}
fn supported_approver() -> InputFact {
    approver(
        FactState::Value(FactValue::Identifier("J. Smith".into())),
        FactSupport::Supported,
    )
}

/// "Approval required above 1,000.00 USD": applies when the amount is over
/// the threshold; met when an approver is present.
fn approval_criterion() -> ProposedCriterion {
    ProposedCriterion {
        key: "c1".into(),
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
            RequiredFact {
                name: "amount".into(),
                kind: FactType::Decimal,
                measure: Some(usd()),
            },
            RequiredFact {
                name: "approver".into(),
                kind: FactType::Identifier,
                measure: None,
            },
        ],
        method: CriterionMethod::Rule(Predicate::Present {
            fact: "approver".into(),
        }),
        missing: MissingTreatment::Undetermined,
    }
}
fn context(facts: &[InputFact], authority_verified: bool) -> EvaluationContext<'_> {
    EvaluationContext {
        period_from: date("2026-01-01"),
        period_to: date("2026-12-31"),
        authority_verified,
        facts,
    }
}

#[test]
fn exact_decimals_parse_render_and_compare_without_floats() {
    let grouped = Decimal::parse_grouped("1,250.00").unwrap();
    assert_eq!(
        grouped,
        Decimal {
            mantissa: 125_000,
            scale: 2
        }
    );
    assert_eq!(grouped.render(), "1250.00");
    assert_eq!(Decimal::parse_plain("1250.00").unwrap(), grouped);
    assert_eq!(
        grouped.compare(&Decimal::parse_plain("1250").unwrap()),
        Ordering::Equal
    );
    assert_eq!(
        Decimal::parse_plain("0.1")
            .unwrap()
            .compare(&Decimal::parse_plain("0.10000000000000001").unwrap()),
        Ordering::Less,
        "no binary rounding"
    );
    assert_eq!(Decimal::parse_plain("-0.05").unwrap().render(), "-0.05");
    assert_eq!(Decimal::parse_plain("0.5").unwrap().render(), "0.5");
    for bad in [
        "",
        "1,250.00",
        "1.",
        ".5",
        "+1",
        "1e3",
        "12345678901234567890",
        "1 250",
    ] {
        assert!(Decimal::parse_plain(bad).is_none(), "{bad}");
    }
    for bad in ["1250.00", "12,50.00", ",250", "1,2500", "1,250."] {
        assert!(
            Decimal::parse_grouped(bad).is_none() || bad == "1250.00",
            "{bad}"
        );
    }
    assert!(Decimal::parse_grouped("1250.00").is_none());
    assert_eq!(Decimal::parse_grouped("999.5").unwrap().render(), "999.5");
    assert_eq!(Decimal::parse_grouped("12,000").unwrap().render(), "12000");
    // The largest values align within i128.
    let big = Decimal::parse_plain("9999999999999999999").unwrap();
    let small = Decimal::parse_plain("0.000000000000000001").unwrap();
    assert_eq!(big.compare(&small), Ordering::Greater);
}

#[test]
fn dates_and_instants_keep_the_source_offset_and_civil_date() {
    assert_eq!(
        CivilDate::parse_dmy("05/03/2026").unwrap(),
        date("2026-03-05")
    );
    assert_eq!(
        CivilDate::parse_dmy("5/3/2026").unwrap(),
        date("2026-03-05")
    );
    assert!(CivilDate::parse_iso("2026-02-29").is_none());
    assert!(CivilDate::parse_iso("2024-02-29").is_some());
    assert!(CivilDate::parse_dmy("31/04/2026").is_none());
    let instant = Instant::parse_rfc3339("2026-03-05T23:30:00-05:00").unwrap();
    assert_eq!(instant.offset_minutes, -300);
    assert_eq!(instant.render_utc(), "2026-03-06T04:30:00Z");
    assert_eq!(instant.render(), "2026-03-05T23:30:00-05:00");
    assert_eq!(instant.civil_date().unwrap(), date("2026-03-05"));
    assert_eq!(
        Instant::parse_rfc3339("1970-01-01T00:00:00.000001Z")
            .unwrap()
            .utc_micros,
        1
    );
    for bad in [
        "2026-03-05 23:30:00Z",
        "2026-03-05T24:00:00Z",
        "2026-03-05T23:30:00+15:00",
        "2026-03-05T23:30Z",
        "2026-03-05T23:30:00.1234567Z",
    ] {
        assert!(Instant::parse_rfc3339(bad).is_none(), "{bad}");
    }
    for days in [-1, 0, 1, 19_000, 2_932_896] {
        assert_eq!(CivilDate::from_days(days).unwrap().days(), days);
    }
}

#[test]
fn trusted_reparse_links_the_quote_to_the_typed_value() {
    let stated = FactValue::parse(FactType::Decimal, "1250.00", Some(usd())).unwrap();
    let derived = ParseRule::DecimalGroupedComma
        .apply("1,250.00", Some(&usd()))
        .unwrap();
    assert!(stated.agrees(&derived));
    assert_eq!(derived.text(), "1250.00");
    let mistyped = FactValue::parse(FactType::Decimal, "1280.00", Some(usd())).unwrap();
    assert!(
        !mistyped.agrees(&derived),
        "a value the source does not show"
    );
    let euros = FactValue::parse(
        FactType::Decimal,
        "1250.00",
        Some(Measure::Currency("EUR".into())),
    )
    .unwrap();
    assert!(!euros.agrees(&derived));
    // Identifiers keep leading zeros; no numeric parse.
    let id = ParseRule::IdentifierExact.apply(" 000123 ", None).unwrap();
    assert_eq!(id, FactValue::Identifier("000123".into()));
    assert!(!FactValue::Identifier("123".into()).agrees(&id));
    assert_eq!(
        ParseRule::DateDmy.apply("05/03/2026", None).unwrap(),
        FactValue::Date(date("2026-03-05"))
    );
    assert_eq!(
        ParseRule::BooleanYesNo.apply("No", None).unwrap(),
        FactValue::Boolean(false)
    );
    assert!(
        ParseRule::DecimalPlain
            .apply("1,250.00", Some(&usd()))
            .is_none()
    );
    assert!(
        ParseRule::DecimalPlain.apply("1250.00", None).is_none(),
        "a decimal needs its measure"
    );
    assert!(valid_subject("000123") && !valid_subject("  ") && !valid_subject(&"x".repeat(129)));
}

#[test]
fn rule_met_and_rerun_has_the_same_digest() {
    let facts = [amount("1250.00", usd()), supported_approver()];
    let first = evaluate(&approval_criterion(), &context(&facts, true));
    assert_eq!(first.applicability, Applicability::Applicable);
    assert_eq!(first.execution, Execution::Completed);
    assert_eq!(first.verdict, Some(Verdict::Met));
    assert_eq!(first.reason, None);
    assert_eq!(first.origin, Origin::Deterministic);
    assert!(first.is_valid());
    let second = evaluate(&approval_criterion(), &context(&facts, true));
    let digest = |o: &Outcome| output_digest("basis-1", "crit-1", "INV-0042", o, None);
    assert_eq!(digest(&first), digest(&second));
    assert_eq!(digest(&first).len(), 64);
    // The inputs are pinned by fact ID and digest, in name order.
    assert_eq!(
        first
            .inputs
            .iter()
            .map(|(id, _)| id.as_str())
            .collect::<Vec<_>>(),
        ["fact-amount", "fact-approver"]
    );
    let different = Outcome {
        verdict: Some(Verdict::NotMet),
        ..first.clone()
    };
    assert_ne!(digest(&first), digest(&different));
}

#[test]
fn missing_failed_and_exception_are_three_distinct_records() {
    let criterion = approval_criterion();
    // Missing input: completed, undetermined.
    let missing = evaluate(&criterion, &context(&[amount("1250.00", usd())], true));
    assert_eq!(
        (missing.execution, missing.verdict, missing.reason),
        (
            Execution::Completed,
            Some(Verdict::Undetermined),
            Some(EvaluationReason::MissingFact)
        )
    );
    // Unavailable source: distinct from an exception.
    let unavailable = evaluate(
        &criterion,
        &context(
            &[
                amount("1250.00", usd()),
                approver(
                    FactState::Unavailable(UnavailableReason::EvidenceUnavailable),
                    FactSupport::NoValue,
                ),
            ],
            true,
        ),
    );
    assert_eq!(unavailable.reason, Some(EvaluationReason::FactUnavailable));
    assert_eq!(unavailable.verdict, Some(Verdict::Undetermined));
    // Failed analysis: execution failed, no verdict.
    let failed = evaluate(
        &criterion,
        &context(
            &[
                amount("1250.00", usd()),
                approver(
                    FactState::Value(FactValue::Identifier("J. Smith".into())),
                    FactSupport::Unsupported(UnsupportedReason::AnalysisFailed),
                ),
            ],
            true,
        ),
    );
    assert_eq!(
        (failed.execution, failed.verdict, failed.reason),
        (
            Execution::Failed,
            None,
            Some(EvaluationReason::AnalysisFailed)
        )
    );
    assert!(failed.is_valid());
    // A supported observed exception: approver absent from the complete
    // approval history.
    let mut history = approval_criterion();
    history.required_facts[1] = RequiredFact {
        name: "in_approval_history".into(),
        kind: FactType::Boolean,
        measure: None,
    };
    history.method = CriterionMethod::Rule(Predicate::IsTrue {
        fact: "in_approval_history".into(),
    });
    assert!(history.is_valid());
    let exception = evaluate(
        &history,
        &context(
            &[
                amount("1250.00", usd()),
                fact(
                    "in_approval_history",
                    FactState::Value(FactValue::Boolean(false)),
                    FactSupport::Supported,
                ),
            ],
            true,
        ),
    );
    assert_eq!(
        (exception.execution, exception.verdict, exception.reason),
        (Execution::Completed, Some(Verdict::NotMet), None)
    );
    for outcome in [&missing, &unavailable, &failed] {
        assert_ne!(outcome.verdict, Some(Verdict::NotMet));
    }
}

#[test]
fn unsupported_ambiguous_unit_mismatch_and_authority_stay_undetermined() {
    let criterion = approval_criterion();
    let mistyped = evaluate(
        &criterion,
        &context(
            &[
                fact(
                    "amount",
                    FactState::Value(FactValue::Decimal {
                        value: Decimal::parse_plain("1280.00").unwrap(),
                        measure: usd(),
                    }),
                    FactSupport::Unsupported(UnsupportedReason::TypeMismatch),
                ),
                supported_approver(),
            ],
            true,
        ),
    );
    // The unsupported amount cannot establish applicability.
    assert_eq!(mistyped.applicability, Applicability::Unknown);
    assert_eq!(mistyped.verdict, Some(Verdict::Undetermined));
    // With the amount supported, an unsupported approver is fact_unsupported.
    let unsupported = evaluate(
        &criterion,
        &context(
            &[
                amount("1250.00", usd()),
                approver(
                    FactState::Value(FactValue::Identifier("J. Smith".into())),
                    FactSupport::Unsupported(UnsupportedReason::TypeMismatch),
                ),
            ],
            true,
        ),
    );
    assert_eq!(unsupported.reason, Some(EvaluationReason::FactUnsupported));
    let ambiguous = evaluate(
        &criterion,
        &context(
            &[
                amount("1250.00", usd()),
                approver(FactState::Ambiguous { candidates: 2 }, FactSupport::NoValue),
            ],
            true,
        ),
    );
    assert_eq!(ambiguous.reason, Some(EvaluationReason::FactAmbiguous));
    // Currency mismatch: a USD limit is never compared with a EUR amount.
    let limit = ProposedCriterion {
        applicability: None,
        required_facts: vec![RequiredFact {
            name: "amount".into(),
            kind: FactType::Decimal,
            measure: None,
        }],
        method: CriterionMethod::Rule(Predicate::CompareConstant {
            fact: "amount".into(),
            op: Comparison::Le,
            constant: Decimal::parse_plain("5000.00").unwrap(),
            measure: usd(),
        }),
        ..approval_criterion()
    };
    let euros = evaluate(
        &limit,
        &context(&[amount("4200.00", Measure::Currency("EUR".into()))], true),
    );
    assert_eq!(euros.verdict, Some(Verdict::Undetermined));
    assert_eq!(euros.reason, Some(EvaluationReason::UnitMismatch));
    let unverified = evaluate(
        &criterion,
        &context(&[amount("1250.00", usd()), supported_approver()], false),
    );
    assert_eq!(
        unverified.reason,
        Some(EvaluationReason::AuthorityUnverified)
    );
    assert_eq!(unverified.verdict, Some(Verdict::Undetermined));
}

#[test]
fn not_applicable_is_no_verdict_and_not_a_pass() {
    let outcome = evaluate(
        &approval_criterion(),
        &context(&[amount("980.00", usd())], true),
    );
    assert_eq!(outcome.applicability, Applicability::NotApplicable);
    assert_eq!(outcome.verdict, None);
    assert_eq!(outcome.reason, None);
    assert!(outcome.is_valid());
}

#[test]
fn period_test_uses_the_civil_date_of_the_fact() {
    let criterion = ProposedCriterion {
        applicability: None,
        required_facts: vec![RequiredFact {
            name: "approved_at".into(),
            kind: FactType::Instant,
            measure: None,
        }],
        method: CriterionMethod::Rule(Predicate::WithinPeriod {
            fact: "approved_at".into(),
        }),
        ..approval_criterion()
    };
    let at = |text: &str| {
        fact(
            "approved_at",
            FactState::Value(FactValue::Instant(Instant::parse_rfc3339(text).unwrap())),
            FactSupport::Supported,
        )
    };
    // 23:30 on 31 December at -05:00 is 1 January in UTC, but its civil date
    // is 31 December: inside the 2026 period.
    let inside = evaluate(
        &criterion,
        &context(&[at("2026-12-31T23:30:00-05:00")], true),
    );
    assert_eq!(inside.verdict, Some(Verdict::Met));
    let outside = evaluate(
        &criterion,
        &context(&[at("2027-01-01T00:30:00+01:00")], true),
    );
    assert_eq!(outside.verdict, Some(Verdict::NotMet));
}

#[test]
fn judgments_are_proposals_with_words_and_no_confidence() {
    let criterion = ProposedCriterion {
        applicability: None,
        required_facts: vec![RequiredFact {
            name: "approver".into(),
            kind: FactType::Identifier,
            measure: None,
        }],
        method: CriterionMethod::Judgment {
            rubric: "Segregation is adequate given the organisation chart".into(),
        },
        ..approval_criterion()
    };
    assert!(criterion.is_valid());
    let judgment = ProposedJudgment {
        criterion: "crit-1".into(),
        basis: "basis-1".into(),
        subject: "INV-0042".into(),
        verdict: Verdict::Met,
        supporting: vec!["approver".into()],
        contrary: vec![],
        rationale: "The approver is outside the requester's reporting line.".into(),
        uncertainty: "The organisation chart is dated 2025.".into(),
    };
    assert!(judgment.is_valid());
    let facts = [supported_approver()];
    let outcome = judge(&criterion, &context(&facts, true), &judgment);
    assert_eq!(outcome.origin, Origin::ModelProposal);
    assert_eq!(outcome.verdict, Some(Verdict::Met));
    assert!(outcome.is_valid());
    // A cited fact that is not supported keeps the proposal undetermined.
    let weak = judge(
        &criterion,
        &context(
            &[approver(
                FactState::Unavailable(UnavailableReason::EvidenceUnavailable),
                FactSupport::NoValue,
            )],
            true,
        ),
        &judgment,
    );
    assert_eq!(weak.verdict, Some(Verdict::Undetermined));
    assert_eq!(weak.reason, Some(EvaluationReason::FactUnavailable));
    // evaluate never decides a judgment criterion.
    assert_eq!(evaluate(&criterion, &context(&facts, true)).verdict, None);
    let with = output_digest(
        "b",
        "c",
        "s",
        &outcome,
        Some((
            &judgment.supporting,
            &judgment.contrary,
            &judgment.rationale,
            &judgment.uncertainty,
        )),
    );
    assert_ne!(with, output_digest("b", "c", "s", &outcome, None));
}

#[test]
fn a_criterion_names_typed_required_facts_for_every_operand() {
    let mut criterion = approval_criterion();
    assert!(criterion.is_valid());
    criterion.method = CriterionMethod::Rule(Predicate::Present {
        fact: "unknown_fact".into(),
    });
    assert!(!criterion.is_valid(), "operand not required");
    let mut typed = approval_criterion();
    typed.method = CriterionMethod::Rule(Predicate::IsTrue {
        fact: "amount".into(),
    });
    assert!(!typed.is_valid(), "is_true needs a boolean");
    let mut measure = approval_criterion();
    measure.required_facts[1].measure = Some(usd());
    assert!(!measure.is_valid(), "only decimals have a measure");
}

#[test]
fn proposals_decode_from_strict_output_and_invalid_ones_do_not() {
    let predicate = |kind: &str, fact: &str, op: &str, constant: &str, currency: &str| {
        JsonValue::Object(BTreeMap::from([
            ("kind".into(), string(kind)),
            ("fact".into(), string(fact)),
            ("op".into(), string(op)),
            ("right_fact".into(), string("")),
            ("constant".into(), string(constant)),
            ("unit".into(), string("")),
            ("currency".into(), string(currency)),
            ("values".into(), JsonValue::Array(vec![])),
        ]))
    };
    let required = |name: &str, kind: &str, currency: &str| {
        JsonValue::Object(BTreeMap::from([
            ("name".into(), string(name)),
            ("type".into(), string(kind)),
            ("unit".into(), string("")),
            ("currency".into(), string(currency)),
        ]))
    };
    let mut criterion = BTreeMap::from([
        ("key".into(), string("c1")),
        ("supersedes".into(), string("")),
        (
            "assertion".into(),
            string("Invoices above 1,000.00 USD require an approver"),
        ),
        ("authority_kind".into(), string("method")),
        ("requirement_id".into(), string("AP-1")),
        ("criterion_ordinal".into(), JsonValue::Integer(0)),
        ("original_id".into(), string("")),
        ("locator".into(), string("")),
        ("quote".into(), string("")),
        ("effective_from".into(), string("")),
        ("effective_to".into(), string("")),
        (
            "applicability".into(),
            predicate("compare_constant", "amount", "gt", "1000.00", "USD"),
        ),
        (
            "required_facts".into(),
            JsonValue::Array(vec![
                required("amount", "decimal", "USD"),
                required("approver", "identifier", ""),
            ]),
        ),
        ("method".into(), string("rule")),
        ("rule".into(), predicate("present", "approver", "", "", "")),
        ("rubric".into(), string("")),
    ]);
    let decoded = decode_criterion(&JsonValue::Object(criterion.clone())).unwrap();
    assert_eq!(decoded, approval_criterion());
    criterion.insert("rule".into(), predicate("present", "nobody", "", "", ""));
    assert!(decode_criterion(&JsonValue::Object(criterion)).is_none());

    let source = JsonValue::Object(BTreeMap::from([
        ("original_id".into(), string("ap-invoices")),
        ("locator".into(), string("cell:Sheet1!B2")),
        ("quote".into(), string("1,250.00")),
    ]));
    let fact = |value: &str, rule: &str, currency: &str| {
        JsonValue::Object(BTreeMap::from([
            ("basis".into(), string("b1")),
            ("subject".into(), string("INV-0042")),
            ("subject_unit".into(), string("invoice")),
            ("name".into(), string("amount")),
            ("value_kind".into(), string("decimal")),
            ("value".into(), string(value)),
            ("unit".into(), string("")),
            ("currency".into(), string(currency)),
            ("reason".into(), string("")),
            ("candidates".into(), JsonValue::Integer(0)),
            ("rule".into(), string(rule)),
            ("sources".into(), JsonValue::Array(vec![source.clone()])),
            ("job_id".into(), string("")),
            ("effective".into(), string("")),
        ]))
    };
    let decoded = decode_fact(&fact("1250.00", "decimal_grouped_comma", "USD")).unwrap();
    assert_eq!(
        decoded.state,
        FactState::Value(FactValue::Decimal {
            value: Decimal {
                mantissa: 125_000,
                scale: 2
            },
            measure: usd()
        })
    );
    assert!(
        decode_fact(&fact("1250.00", "date_iso", "USD")).is_none(),
        "rule type differs"
    );
    assert!(
        decode_fact(&fact("1250.00", "decimal_plain", "")).is_none(),
        "decimal needs a measure"
    );
    assert!(
        decode_fact(&fact("1250.00", "", "USD")).is_none(),
        "a value names its rule"
    );
}

#[test]
fn the_answer_fields_stay_within_the_schema_bounds() {
    let schema = ArgumentSchema::Object {
        properties: answer_fields()
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        required: answer_fields().iter().map(|(k, _)| k.to_string()).collect(),
    };
    assert!(schema.is_valid());
}

#[test]
fn a_criterion_version_outside_its_effective_period_does_not_apply() {
    let mut criterion = approval_criterion();
    criterion.effective_to = Some(date("2025-12-31"));
    let facts = [amount("1250.00", usd()), supported_approver()];
    let outcome = evaluate(&criterion, &context(&facts, true));
    assert_eq!(outcome.applicability, Applicability::NotApplicable);
    assert_eq!(outcome.verdict, None);
    criterion.effective_to = Some(date("2026-01-01"));
    assert_eq!(
        evaluate(&criterion, &context(&facts, true)).verdict,
        Some(Verdict::Met)
    );
}
