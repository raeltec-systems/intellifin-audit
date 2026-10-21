use super::export::*;
use super::*;
use crate::{
    assessment::{Applicability, Execution, Origin},
    coverage::{
        Completeness, CriterionOpportunities, OpportunityFacts, PopulationCounts, PopulationFacts,
        Reconciliation, summarise,
    },
};

fn renderings(values: &[u64]) -> Renderings {
    let mut r = Renderings::default();
    for v in values {
        r.count(*v);
    }
    r
}

#[test]
fn every_figure_of_a_statement_is_an_asserted_value() {
    let ids = Identifiers::default();
    let r = renderings(&[15, 1000]);
    assert_eq!(
        statement_figures_v1(
            "15 of 1,000 applicable invoices had no recorded approver.",
            &r,
            &ids
        ),
        Ok(())
    );
    assert_eq!(
        statement_figures_v1("15 of 1000 applicable invoices.", &r, &ids),
        Ok(())
    );
    // The wrong figure is named.
    assert_eq!(
        statement_figures_v1(
            "14 of 1,000 applicable invoices had no recorded approver.",
            &r,
            &ids
        ),
        Err("14".into())
    );
    // A figure is matched whole, never as a part of a longer run.
    assert_eq!(
        statement_figures_v1("115 of 1,000.", &r, &ids),
        Err("115".into())
    );
    assert_eq!(
        statement_figures_v1("15 of 1,0000.", &r, &ids),
        Err("1,0000".into())
    );
    // Non-ASCII digits are figures too (Arabic-Indic fifteen).
    assert!(statement_figures_v1("\u{661}\u{665} invoices", &r, &ids).is_err());
    // Dates of a period are renderings; the two bounds split at the slash.
    let mut period = Renderings::default();
    period.text("2026-01-01/2026-12-31");
    assert_eq!(
        statement_figures_v1("From 2026-01-01 to 2026-12-31.", &period, &ids),
        Ok(())
    );
    assert!(statement_figures_v1("From 2026-01-02.", &period, &ids).is_err());
    // A decimal fact value, plain or grouped, signed or not.
    let mut decimal = Renderings::default();
    decimal.decimal("-1250.00");
    for text in ["1250.00", "1,250.00"] {
        assert_eq!(statement_figures_v1(text, &decimal, &ids), Ok(()), "{text}");
    }
    assert!(statement_figures_v1("1250.0", &decimal, &ids).is_err());
}

#[test]
fn identifiers_resolve_only_to_records_and_template_sections() {
    let mut ids = Identifiers::default();
    ids.add("FY2026 AP working paper");
    ids.add("Risk assessment under ISA 315");
    ids.add_record("INV-0042");
    ids.add_record("000123");
    ids.add("Sample 25 items");
    let none = Renderings::default();
    // Named identifiers and LABEL-number pairs resolve in narrative.
    for text in [
        "FY2026 results",
        "Under ISA 315, the approver was not recorded.",
        "INV-0042 is described below.",
    ] {
        assert_eq!(narrative_figures(text, &ids), Ok(()), "{text}");
    }
    // A pure number never resolves in narrative, even a record's subject.
    assert_eq!(
        narrative_figures("about 20 items failed", &ids),
        Err("20".into())
    );
    assert_eq!(narrative_figures("Invoice 000123", &ids), Err("000123".into()));
    // An identifier the version does not name does not resolve.
    assert_eq!(narrative_figures("FY2025 results", &ids), Err("FY2025".into()));
    assert_eq!(narrative_figures("Under ISA 316", &ids), Err("316".into()));
    // A number in template text is never an identifier in a claim.
    assert_eq!(
        statement_figures_v1("25 invoices", &none, &ids),
        Err("25".into())
    );
    // A pinned subject's pure number resolves in a claim.
    assert_eq!(
        statement_figures_v1("Invoice 000123 had no approver.", &none, &ids),
        Ok(())
    );
    // Non-ASCII digits in narrative are refused.
    assert!(narrative_figures("\u{966}", &ids).is_err());
    assert!(is_decimal_digit('\u{1D7CE}'));
    assert!(!is_decimal_digit('\u{2160}'), "a Roman numeral is Nl, not Nd");
}

#[test]
fn verdict_words_are_closed_whole_and_case_insensitive() {
    assert_eq!(verdict_word("The control PASSED."), Some("passed".into()));
    assert_eq!(verdict_word("not met"), Some("met".into()));
    assert_eq!(verdict_word("No exception was seen"), Some("exception".into()));
    assert_eq!(verdict_word("non-compliant"), Some("compliant".into()));
    assert_eq!(verdict_word("The policy says approvals metre"), None);
    assert_eq!(verdict_word("Invoices require an approver"), None);
}

fn pin(kind: AssertionKind, record_kind: RecordKind, id: &str, value: &str) -> Pin {
    Pin {
        kind,
        record_kind,
        record_id: id.into(),
        record_digest: "a".repeat(64),
        measure: (kind == AssertionKind::Count).then_some(CountMeasure::InScope),
        criterion_id: None,
        value: value.into(),
        origin: (kind == AssertionKind::Outcome).then_some(EffectiveOrigin::ModelProposal),
        review: (kind == AssertionKind::Outcome).then_some(ReviewState::Unreviewed),
        locator: (kind == AssertionKind::Quote).then(|| Locator::Bytes { start: 0, end: 8 }),
        unit: None,
        subject: None,
    }
}
fn hex(prefix: &str, c: char) -> String {
    format!("{prefix}-{}", c.to_string().repeat(40))
}

#[test]
fn currency_is_derived_from_pins_with_one_closed_reason_each() {
    let head = hex("eval", '1');
    let outcome = pin(
        AssertionKind::Outcome,
        RecordKind::Evaluation,
        &head,
        "not_met",
    );
    let same = Current::Outcome {
        head_id: head.clone(),
        verdict: Some(Verdict::NotMet),
        origin: EffectiveOrigin::ModelProposal,
        review: ReviewState::Unreviewed,
    };
    assert!(currency(std::slice::from_ref(&outcome), std::slice::from_ref(&same)).current());
    let revised = Current::Outcome {
        head_id: hex("rev", '2'),
        verdict: Some(Verdict::NotMet),
        origin: EffectiveOrigin::ModelProposal,
        review: ReviewState::Unreviewed,
    };
    assert_eq!(
        currency(std::slice::from_ref(&outcome), &[revised]).reasons,
        vec![RefreshReason::EvaluationRevised]
    );
    // A person replaced the verdict on the same head.
    let replaced = Current::Outcome {
        head_id: head.clone(),
        verdict: Some(Verdict::Met),
        origin: EffectiveOrigin::Human,
        review: ReviewState::Replaced,
    };
    assert_eq!(
        currency(std::slice::from_ref(&outcome), &[replaced]).reasons,
        vec![RefreshReason::DispositionChanged]
    );
    // An acceptance alone changes the review state: also a disposition.
    let accepted = Current::Outcome {
        head_id: head,
        verdict: Some(Verdict::NotMet),
        origin: EffectiveOrigin::ModelProposal,
        review: ReviewState::Accepted,
    };
    assert_eq!(
        currency(std::slice::from_ref(&outcome), &[accepted]).reasons,
        vec![RefreshReason::DispositionChanged]
    );
    let count = pin(
        AssertionKind::Count,
        RecordKind::Summary,
        &hex("summary", '3'),
        "1000",
    );
    assert!(currency(std::slice::from_ref(&count), &[Current::Summary { superseded: false }]).current());
    assert_eq!(
        currency(std::slice::from_ref(&count), &[Current::Summary { superseded: true }]).reasons,
        vec![RefreshReason::SummarySuperseded]
    );
    let exception = pin(
        AssertionKind::Exception,
        RecordKind::Exception,
        &hex("exc", '4'),
        "open",
    );
    assert_eq!(
        currency(
            std::slice::from_ref(&exception),
            &[Current::Exception {
                status: ExceptionStatus::ResolvedByEvidence
            }]
        )
        .reasons,
        vec![RefreshReason::ExceptionStatusChanged]
    );
    let fact = pin(AssertionKind::Fact, RecordKind::Fact, &hex("fact", '5'), "J. Smith");
    assert_eq!(
        currency(std::slice::from_ref(&fact), &[Current::Fact { superseded: true }]).reasons,
        vec![RefreshReason::FactSuperseded]
    );
    // A quote whose original this viewer cannot read is withheld, never
    // stale; one no longer registered with its digest needs refresh.
    let quote = pin(AssertionKind::Quote, RecordKind::Original, "ap-policy", "Invoices");
    let withheld = currency(
        std::slice::from_ref(&quote),
        &[Current::Quote {
            registered: Some("a".repeat(64)),
            readable: false,
        }],
    );
    assert!(withheld.current() && withheld.withheld);
    assert_eq!(
        currency(
            std::slice::from_ref(&quote),
            &[Current::Quote {
                registered: Some("b".repeat(64)),
                readable: true,
            }]
        )
        .reasons,
        vec![RefreshReason::SourceWithdrawn]
    );
    // Not visible to this viewer is withheld, never stale.
    let hidden = currency(
        std::slice::from_ref(&quote),
        &[Current::Quote {
            registered: None,
            readable: false,
        }],
    );
    assert!(hidden.current() && hidden.withheld);
    assert_eq!(
        currency(std::slice::from_ref(&quote), &[]).reasons,
        vec![RefreshReason::SourceWithdrawn]
    );
    // A current fact that cannot be read is never shown as current.
    assert!(!currency(std::slice::from_ref(&count), &[]).current());
    // Reasons are a set in vocabulary order.
    let both = currency(
        &[outcome.clone(), count.clone(), outcome],
        &[
            Current::Outcome {
                head_id: hex("rev", '9'),
                verdict: None,
                origin: EffectiveOrigin::Deterministic,
                review: ReviewState::Unreviewed,
            },
            Current::Summary { superseded: true },
            Current::Summary { superseded: true },
        ],
    );
    assert_eq!(
        both.reasons,
        vec![
            RefreshReason::EvaluationRevised,
            RefreshReason::SummarySuperseded
        ]
    );
}

fn summary() -> Summary {
    let population = PopulationFacts {
        completeness: Completeness::Complete,
        reconciliation: Reconciliation::NotDeclared,
        counts: PopulationCounts {
            received_rows: 3,
            distinct_subjects: 3,
            in_scope: 3,
            ..PopulationCounts::default()
        },
        period_checked: true,
        naive_date_times: 0,
    };
    let in_scope: BTreeSet<String> = ["a", "b", "c"].iter().map(|s| s.to_string()).collect();
    let opportunity = |subject: &str, verdict: Verdict| OpportunityFacts {
        subject: subject.into(),
        origin: Origin::Deterministic,
        applicability: Applicability::Applicable,
        execution: Execution::Completed,
        verdict: Some(verdict),
        reason: None,
    };
    summarise(
        &population,
        &in_scope,
        &[CriterionOpportunities {
            criterion_id: hex("crit", 'c'),
            judgment: false,
            opportunities: vec![
                opportunity("a", Verdict::NotMet),
                opportunity("b", Verdict::Met),
                opportunity("c", Verdict::Met),
            ],
        }],
        None,
    )
}

#[test]
fn a_count_measure_reads_exactly_one_stored_count() {
    let s = summary();
    let c = hex("crit", 'c');
    assert_eq!(CountMeasure::NotMet.of(&s, Some(&c)), Some(1));
    assert_eq!(CountMeasure::Applicable.of(&s, Some(&c)), Some(3));
    assert_eq!(CountMeasure::InScope.of(&s, None), Some(3));
    assert_eq!(CountMeasure::FailingSubjects.of(&s, None), Some(1));
    // A criterion measure needs a criterion of the summary; a summary
    // measure has none; `selected` exists only for a sample.
    assert_eq!(CountMeasure::NotMet.of(&s, None), None);
    assert_eq!(CountMeasure::NotMet.of(&s, Some("crit-other")), None);
    assert_eq!(CountMeasure::InScope.of(&s, Some(&c)), None);
    assert_eq!(CountMeasure::Selected.of(&s, None), None);
    assert_eq!(coverage_line(&s), "Population complete · 3 in scope");
    assert_eq!(grouped(1_234_567), "1,234,567");
}

fn template() -> TemplateRef {
    TemplateRef {
        binding_id: "binding-1".into(),
        id: "ap-wp".into(),
        version: "1".into(),
        source_version_id: "method-v1".into(),
        name: "AP working paper".into(),
        neutral: false,
        sections: vec![
            SectionRef {
                id: "objective".into(),
                title: "Objective".into(),
                required: false,
            },
            SectionRef {
                id: "results".into(),
                title: "Results".into(),
                required: false,
            },
            SectionRef {
                id: "conclusion".into(),
                title: "Conclusion".into(),
                required: true,
            },
        ],
    }
}
pub(super) fn version() -> Version {
    let id = agent_version_id("task-1", "invocation-1");
    let author = Author::Agent {
        invocation_id: "invocation-1".into(),
    };
    let block = |ordinal: usize, section: &str, content: Content| Block {
        id: block_id(&id, ordinal),
        section: section.into(),
        content,
        author: author.clone(),
        authored_in: id.clone(),
    };
    let mut count = pin(
        AssertionKind::Count,
        RecordKind::Summary,
        &hex("summary", '3'),
        "15",
    );
    count.measure = Some(CountMeasure::NotMet);
    count.criterion_id = Some(hex("crit", 'c'));
    let blocks = vec![
        block(
            0,
            "objective",
            Content::Heading {
                text: "Objective".into(),
            },
        ),
        block(
            1,
            "results",
            Content::Claim {
                statement: "15 invoices had no recorded approver.".into(),
                pins: vec![count],
            },
        ),
        block(
            2,
            "results",
            Content::Narrative {
                label: NarrativeLabel::Judgment,
                text: "The approval control appears weak.".into(),
            },
        ),
        block(3, "conclusion", Content::Limitations),
    ];
    let template = template();
    Version {
        missing_required: missing_required(&template, &blocks),
        id,
        product_id: product_id("task-1", "invocation-1"),
        task_id: "task-1".into(),
        number: 1,
        predecessor: None,
        author,
        key: None,
        cycle_id: Some("cycle-1".into()),
        title: "AP approvals".into(),
        kind: ProductKind::WorkingPaper,
        template,
        methodology_binding_id: "binding-1".into(),
        execution_epoch: 1,
        blocks,
    }
}

#[test]
fn a_version_document_round_trips_and_its_digest_is_deterministic() {
    let v = version();
    assert!(v.is_valid(), "the fixture version is valid");
    // The limitations block is not content: the required conclusion is
    // missing.
    assert_eq!(v.missing_required, vec!["conclusion".to_string()]);
    let document = v.document();
    assert_eq!(Version::from_document(&document), Some(v.clone()));
    assert_eq!(v.digest(), version().digest());
    // Any altered field is refused on decode, never repaired.
    let JsonValue::Object(mut map) = document.clone() else {
        unreachable!()
    };
    map.insert("missing_required".into(), JsonValue::Array(vec![]));
    assert_eq!(Version::from_document(&JsonValue::Object(map)), None);
    let mut two = v.clone();
    two.blocks.push(two.blocks[3].clone());
    assert!(!two.is_valid(), "one limitations block and distinct IDs");
    let mut human = v.clone();
    human.blocks[1].author = Author::Human {
        actor_id: "actor-a".into(),
    };
    assert!(
        !human.is_valid(),
        "a block written in this version has this version's author"
    );
    let mut over = v;
    over.blocks[1].content = Content::Claim {
        statement: "x".repeat(MAX_STATEMENT_BYTES + 1),
        pins: vec![],
    };
    assert!(!over.is_valid());
}

#[test]
fn the_answer_field_is_strict_and_fits_the_answer_schema() {
    let fields = answer_fields();
    assert_eq!(fields.len(), 1);
    assert!(fields[0].1.is_valid());
    assert!(crate::citation::CitedAnswer::assessment_schema().is_valid());
    let draft = serde_like(
        r#"{"title":"AP approvals","kind":"working_paper","template":"ap-wp:1","base":"",
        "blocks":[{"section":"results","kind":"claim","text":"15 of 1,000.","record":"",
          "assertions":[{"kind":"count","record":"summary-1111111111111111111111111111111111111111","measure":"not_met","detail":"crit-1","value":"15"}]},
          {"kind":"keep","section":"","text":"","record":"blk-2222222222222222222222222222222222222222","assertions":[]},
          {"kind":"keep","section":"results","text":"","record":"blk-3","assertions":[]},
          {"section":"results","kind":"heading","text":"x","record":"summary-1","assertions":[]}]}"#,
    );
    let decoded = decode_draft(&draft).unwrap();
    assert_eq!(decoded.base_version, None);
    assert_eq!(
        (decoded.template_id.as_str(), decoded.template_version.as_str()),
        ("ap-wp", "1")
    );
    assert_eq!(
        decoded.blocks[1],
        ProposedBlock::Keep("blk-2222222222222222222222222222222222222222".into())
    );
    // A kept block with content and a heading naming a record are kept
    // as malformed (refused with a reason), never silently dropped.
    assert!(matches!(
        decoded.blocks[2],
        ProposedBlock::New {
            content: ProposedContent::Malformed,
            ..
        }
    ));
    assert!(matches!(
        decoded.blocks[3],
        ProposedBlock::New {
            content: ProposedContent::Malformed,
            ..
        }
    ));
    let ProposedBlock::New {
        content: ProposedContent::Claim { assertions, .. },
        ..
    } = &decoded.blocks[0]
    else {
        panic!("a claim");
    };
    assert_eq!(
        assertions[0],
        ProposedAssertion::Count {
            summary_id: "summary-1111111111111111111111111111111111111111".into(),
            measure: Some(CountMeasure::NotMet),
            criterion_id: Some("crit-1".into()),
            value: Some(15),
        }
    );
    // A grouped or padded count is not a count value.
    let padded = serde_like(
        r#"{"kind":"count","record":"s","measure":"not_met","detail":"","value":"015"}"#,
    );
    assert!(matches!(
        assertion_from(&padded),
        Some(ProposedAssertion::Count { value: None, .. })
    ));
}

/// A minimal JSON reader for the tests (objects, arrays, strings).
fn serde_like(text: &str) -> JsonValue {
    fn value(chars: &[char], at: &mut usize) -> JsonValue {
        skip(chars, at);
        match chars[*at] {
            '{' => {
                *at += 1;
                let mut map = BTreeMap::new();
                loop {
                    skip(chars, at);
                    if chars[*at] == '}' {
                        *at += 1;
                        return JsonValue::Object(map);
                    }
                    let JsonValue::String(key) = value(chars, at) else {
                        panic!()
                    };
                    skip(chars, at);
                    *at += 1; // :
                    let v = value(chars, at);
                    map.insert(key, v);
                    skip(chars, at);
                    if chars[*at] == ',' {
                        *at += 1;
                    }
                }
            }
            '[' => {
                *at += 1;
                let mut items = Vec::new();
                loop {
                    skip(chars, at);
                    if chars[*at] == ']' {
                        *at += 1;
                        return JsonValue::Array(items);
                    }
                    items.push(value(chars, at));
                    skip(chars, at);
                    if chars[*at] == ',' {
                        *at += 1;
                    }
                }
            }
            '"' => {
                *at += 1;
                let mut s = String::new();
                while chars[*at] != '"' {
                    s.push(chars[*at]);
                    *at += 1;
                }
                *at += 1;
                JsonValue::String(s)
            }
            _ => panic!("unsupported"),
        }
    }
    fn skip(chars: &[char], at: &mut usize) {
        while chars[*at].is_whitespace() {
            *at += 1;
        }
    }
    let chars: Vec<char> = text.chars().collect();
    value(&chars, &mut 0)
}

#[test]
fn crc32_and_the_stored_zip_match_known_vectors() {
    assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    assert_eq!(crc32(b""), 0);
    assert_eq!(
        crc32(b"The quick brown fox jumps over the lazy dog"),
        0x414F_A339
    );
    let archive = zip(&[("a.txt", b"hello".to_vec()), ("b/c.xml", b"<x/>".to_vec())]);
    assert_eq!(&archive[..4], b"PK\x03\x04");
    assert_eq!(
        unzip(&archive),
        Some(vec![
            ("a.txt".to_string(), b"hello".to_vec()),
            ("b/c.xml".to_string(), b"<x/>".to_vec())
        ])
    );
    // A changed byte fails its CRC.
    let mut broken = archive.clone();
    let at = broken.windows(5).position(|w| w == b"hello").unwrap();
    broken[at] = b'j';
    assert_eq!(unzip(&broken), None);
    assert_eq!(xml("a<b&\"c\u{1}"), "a&lt;b&amp;&quot;c\u{FFFD}");
}

pub(super) fn view() -> ExportView {
    ExportView {
        version_id: hex("wpv", '7'),
        version: 2,
        digest: "d".repeat(64),
        title: "AP approvals".into(),
        kind: "working_paper".into(),
        template: "AP working paper".into(),
        sections: vec![
            ExportSection {
                title: "Results".into(),
                required: false,
                blocks: vec![
                    ExportBlock::Claim {
                        number: 1,
                        statement: "=HYPERLINK(\"x\") 15 of 1,000 invoices.".into(),
                        coverage: Some("Population complete · 1,000 in scope".into()),
                        refresh: vec!["the evaluation it cites was revised".into()],
                        support: vec!["not met: 15 (summary)".into()],
                    },
                    ExportBlock::Narrative {
                        judgment: true,
                        text: "Weak.\nVery weak.".into(),
                    },
                ],
            },
            ExportSection {
                title: "Conclusion".into(),
                required: true,
                blocks: vec![ExportBlock::Limitations],
            },
        ],
        citations: vec![ExportCitation {
            claim: 1,
            record_kind: "summary".into(),
            record_id: hex("summary", '3'),
            digest: "e".repeat(64),
            value: "15".into(),
            quote: None,
            withheld: false,
        }],
        limitations: vec!["4 subjects are unresolved.".into()],
        coverage: vec![ExportCoverage {
            summary_id: hex("summary", '3'),
            line: "Population complete · 1,000 in scope".into(),
            partition: [
                ("failing".into(), 15),
                ("meeting every applicable criterion".into(), 965),
                ("unresolved".into(), 20),
                ("not applicable to any".into(), 0),
            ],
            total_label: "in scope (stored total)".into(),
            total: 1000,
        }],
        preparation: "Prepared by Zobba (agent); edited by Alex".into(),
    }
}

fn part(archive: &[u8], name: &str) -> String {
    let entries = unzip(archive).unwrap();
    String::from_utf8(
        entries
            .into_iter()
            .find(|(n, _)| n == name)
            .unwrap_or_else(|| panic!("{name}"))
            .1,
    )
    .unwrap()
}

#[test]
fn a_docx_names_its_source_revision_keeps_sections_and_links_every_claim() {
    let view = view();
    let bytes = docx(&view);
    assert_eq!(bytes, docx(&view), "the same view gives the same bytes");
    let document = part(&bytes, "word/document.xml");
    let footer = part(&bytes, "word/footer1.xml");
    let revision = view.source_revision();
    assert!(document.contains(&xml(&revision)), "first page");
    assert!(footer.contains(&xml(&revision)), "footer");
    assert!(footer.contains(" PAGE "), "page numbers");
    assert!(document.contains(NOT_COMPLETED), "a required empty section");
    assert!(document.contains("w:anchor=\"citation_1\""));
    assert!(document.contains("w:name=\"citation_1\""));
    assert!(document.contains("Needs refresh: the evaluation it cites was revised"));
    assert!(document.contains(JUDGMENT_LABEL));
    assert!(document.contains("Review state: Draft — not reviewed."));
    assert!(document.contains("4 subjects are unresolved."));
    // Text is text: the equals sign is a character of a run.
    assert!(document.contains("<w:t xml:space=\"preserve\">=HYPERLINK(&quot;x&quot;)"));
    assert!(document.contains("Weak.</w:t><w:br/>"));
}

#[test]
fn an_xlsx_writes_every_text_as_an_inline_string_and_one_sum() {
    let view = view();
    let bytes = xlsx(&view);
    assert_eq!(bytes, xlsx(&view));
    let names: Vec<String> = unzip(&bytes).unwrap().into_iter().map(|(n, _)| n).collect();
    assert!(names.contains(&"xl/worksheets/sheet4.xml".to_string()));
    let workbook = part(&bytes, "xl/workbook.xml");
    for sheet in ["Work product", "Claims", "Citations", "Coverage"] {
        assert!(workbook.contains(&format!("name=\"{sheet}\"")), "{sheet}");
    }
    let claims = part(&bytes, "xl/worksheets/sheet2.xml");
    assert!(claims.contains("t=\"inlineStr\"><is><t xml:space=\"preserve\">=HYPERLINK"));
    let coverage = part(&bytes, "xl/worksheets/sheet4.xml");
    assert_eq!(coverage.matches("<f>").count(), 1, "exactly one formula");
    assert!(coverage.contains("<f>SUM(C3:C6)</f><v>1000</v>"));
    for sheet in 1..=4 {
        let text = part(&bytes, &format!("xl/worksheets/sheet{sheet}.xml"));
        if sheet != 4 {
            assert!(!text.contains("<f>"), "no formula from text");
        }
    }
    assert_eq!(view.refresh_count(), 1);
}
