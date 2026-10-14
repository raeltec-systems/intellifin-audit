use super::*;

fn source(original: &str, locator: &str, quote: &str) -> CitationSource {
    CitationSource {
        original_id: original.into(),
        locator: Locator::parse(locator),
        quote: quote.into(),
    }
}

#[test]
fn locators_round_trip_in_their_one_canonical_spelling() {
    for text in [
        "page:1",
        "page:200",
        "cell:Sheet1!B4",
        "cell:Trial balance!B4:C6",
        "cell:a!b!A1",
        "paragraph:4",
        "table:1:2:3",
        "header:Subject",
        "header:X-Original-To",
        "part:2",
        "bytes:0-10",
        "bytes:10-20",
    ] {
        let locator = Locator::parse(text).unwrap_or_else(|| panic!("{text}"));
        assert_eq!(locator.render(), text);
        assert_eq!(Locator::parse(&locator.render()), Some(locator));
    }
    let cell = Locator::parse("cell:Sheet1!AA10").unwrap();
    assert_eq!(
        cell,
        Locator::Cell {
            sheet: "Sheet1".into(),
            range: CellRange {
                first_column: 27,
                first_row: 10,
                last_column: 27,
                last_row: 10
            }
        }
    );
    assert_eq!(cell.label(), "Sheet1!AA10");
    assert_eq!(Locator::parse("page:3").unwrap().label(), "page 3");
    // A page number is not the 200-page read count: page 9999 is a location.
    assert!(Locator::parse("page:9999").is_some());
}

#[test]
fn non_canonical_or_unbounded_locators_are_missing_never_guessed() {
    for text in [
        "",
        "page:0",
        "page:03",
        "page:10001",
        "page: 3",
        "Page:3",
        "cell:Sheet1!b4",
        "cell:Sheet1!B04",
        "cell:Sheet1!B4:B4",
        "cell:Sheet1!C6:B4",
        "cell:!B4",
        "cell:She*et!B4",
        "cell:Sheet1!XFE1",
        "cell:Sheet1!A1:Z100",
        "paragraph:0",
        "table:1:2",
        "table:1:2:3:4",
        "header:Sub ject",
        "header:",
        "part:-1",
        "bytes:10-10",
        "bytes:20-10",
        "bytes:01-5",
        "bytes:a-b",
        "sheet:Sheet1!B4",
    ] {
        assert_eq!(Locator::parse(text), None, "{text}");
    }
    assert_eq!(Locator::parse(&"page:1".repeat(100)), None);
}

#[test]
fn normalization_is_whitespace_and_nfc_only() {
    assert_eq!(normalize("  1,250.00 \n"), "1,250.00");
    assert_eq!(normalize("a\t\u{00A0} b\u{2003}c"), "a b c");
    // Decomposed é (e + combining acute) equals precomposed é.
    assert_eq!(normalize("Cafe\u{301}"), normalize("Caf\u{e9}"));
    // Case and digits are never changed.
    assert_ne!(normalize("Total"), normalize("total"));
    assert_ne!(normalize("1,250.00"), normalize("1250.00"));
}

#[test]
fn spreadsheet_claim_is_verified_and_wrong_value_is_not_found() {
    let found = Located::Found(vec!["1250".into(), "1,250.00".into()]);
    let right = source("trial-balance", "cell:Sheet1!B4", "1,250.00");
    assert_eq!(decide(&right, Some(&found), None), Verification::Verified);
    let wrong = source("trial-balance", "cell:Sheet1!B4", "1,280.00");
    assert_eq!(
        decide(&wrong, Some(&found), None),
        Verification::Unverified(UnverifiedReason::NotFoundAtLocation)
    );
    // A cell must equal the quote; containment is not enough.
    let partial = source("trial-balance", "cell:Sheet1!B4", "250");
    assert_eq!(
        decide(&partial, Some(&found), None),
        Verification::Unverified(UnverifiedReason::NotFoundAtLocation)
    );
    assert_eq!(
        decide(&right, Some(&Located::Missing), None),
        Verification::Unverified(UnverifiedReason::NotFoundAtLocation)
    );
    assert_eq!(
        decide(&right, Some(&Located::Unreadable), None),
        Verification::Unverified(UnverifiedReason::SourceUnreadable)
    );
}

#[test]
fn missing_locator_and_empty_quote() {
    let missing = source("contract", "", "anything");
    assert_eq!(missing.locator, None);
    assert_eq!(
        decide(&missing, None, None),
        Verification::Unverified(UnverifiedReason::LocationMissing)
    );
    let empty = source("contract", "paragraph:2", "   ");
    assert_eq!(
        decide(&empty, Some(&Located::Found(vec!["text".into()])), None),
        Verification::Unverified(UnverifiedReason::NotFoundAtLocation)
    );
}

#[test]
fn scanned_page_is_page_only_unless_a_text_layer_confirms_it() {
    let quote = source("scan", "page:3", "Signed by A. Auditor");
    let scanned = PageFacts {
        exists: true,
        text_layer: None,
        read_natively: true,
    };
    assert_eq!(
        decide(&quote, None, Some(&scanned)),
        Verification::Unverified(UnverifiedReason::PageOnly)
    );
    let layered = PageFacts {
        text_layer: Some("Page 3\nSigned  by A. Auditor\non 1 May".into()),
        ..scanned.clone()
    };
    assert_eq!(decide(&quote, None, Some(&layered)), Verification::Verified);
    let unread = PageFacts {
        read_natively: false,
        ..scanned.clone()
    };
    assert_eq!(
        decide(&quote, None, Some(&unread)),
        Verification::Unverified(UnverifiedReason::NotFoundAtLocation)
    );
    let absent = PageFacts {
        exists: false,
        ..scanned
    };
    assert_eq!(
        decide(&quote, None, Some(&absent)),
        Verification::Unverified(UnverifiedReason::NotFoundAtLocation)
    );
    assert_eq!(
        decide(&quote, None, None),
        Verification::Unverified(UnverifiedReason::SourceUnreadable)
    );
}

fn object(fields: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())
}
fn s(value: &str) -> JsonValue {
    JsonValue::String(value.into())
}
fn answer_json() -> JsonValue {
    object(vec![
        (
            "segments",
            JsonValue::Array(vec![
                object(vec![
                    ("text", s("The trial balance shows 1,250.00 in B4.")),
                    (
                        "sources",
                        JsonValue::Array(vec![object(vec![
                            ("original_id", s("trial-balance")),
                            ("locator", s("cell:Sheet1!B4")),
                            ("quote", s("1,250.00")),
                        ])]),
                    ),
                ]),
                object(vec![
                    (" The contract and email agree.", s("")),
                    ("text", s(" The contract and email agree.")),
                    (
                        "sources",
                        JsonValue::Array(vec![
                            object(vec![
                                ("original_id", s("contract")),
                                ("locator", s("page:2")),
                                ("quote", s("payment within 30 days")),
                            ]),
                            object(vec![
                                ("original_id", s("email")),
                                ("locator", s("not a locator")),
                                ("quote", s("30 days")),
                            ]),
                        ]),
                    ),
                ]),
            ]),
        ),
        (
            "limitations",
            JsonValue::Array(vec![s("Page 4 is smudged.")]),
        ),
        (
            "read_pages",
            JsonValue::Array(vec![object(vec![
                ("original_id", s("contract")),
                ("page", JsonValue::Integer(3)),
            ])]),
        ),
        (
            "programs",
            JsonValue::Array(vec![object(vec![
                ("program", s("print(1)")),
                (
                    "inputs",
                    JsonValue::Array(vec![s("trial-balance"), s("contract"), s("contract")]),
                ),
            ])]),
        ),
    ])
}

#[test]
fn cited_answer_decodes_spans_and_requests() {
    let mut value = answer_json();
    // The stray key in the second segment is not part of the schema.
    assert!(!CitedAnswer::schema().accepts(&value));
    if let JsonValue::Object(map) = &mut value
        && let Some(JsonValue::Array(segments)) = map.get_mut("segments")
        && let JsonValue::Object(second) = &mut segments[1]
    {
        second.remove(" The contract and email agree.");
    }
    // A 22.5 answer has no Story 22.6 fields: the plain schema accepts it, the
    // investigation schema asks for them, and the stored answer still decodes.
    assert!(CitedAnswer::schema().accepts(&value));
    assert!(!CitedAnswer::investigation_schema().accepts(&value));
    let old = CitedAnswer::from_json(&value).unwrap();
    assert!(old.read_method.is_empty() && old.method_notes.is_empty());
    if let JsonValue::Object(map) = &mut value {
        for key in [
            "read_method",
            "use_skills",
            "run_skill_script",
            "method_notes",
        ] {
            map.insert(key.into(), JsonValue::Array(vec![]));
        }
    }
    assert!(CitedAnswer::investigation_schema().accepts(&value));
    assert!(
        !CitedAnswer::schema().accepts(&value),
        "plain work never sees 22.6 fields"
    );
    let answer = CitedAnswer::from_json(&value).unwrap();
    assert_eq!(answer, old);
    assert_eq!(
        answer.text(),
        "The trial balance shows 1,250.00 in B4. The contract and email agree."
    );
    let spans = answer.spans();
    assert_eq!(spans.len(), 2);
    assert_eq!(spans[0].1, Span { start: 0, end: 39 });
    assert_eq!(
        &answer.text()[spans[1].1.start as usize..],
        " The contract and email agree."
    );
    assert_eq!(answer.segments[1].sources[1].locator, None);
    assert_eq!(answer.read_pages[0].page, 3);
    assert_eq!(answer.programs[0].inputs, vec!["contract", "trial-balance"]);
    assert!(answer.requests_reading());
    assert!(answer.is_answer());
}

#[test]
fn a_turn_that_only_reads_is_valid_but_not_an_answer_and_an_empty_turn_is_invalid() {
    let reading = CitedAnswer {
        read_pages: vec![PageRequest {
            original_id: "scan".into(),
            page: 9_999,
        }],
        ..CitedAnswer::default()
    };
    assert!(reading.is_valid());
    assert!(!reading.is_answer());
    let empty = CitedAnswer {
        read_pages: vec![],
        ..reading.clone()
    };
    assert!(!empty.is_valid(), "no text and no request is not a turn");
    let beyond = CitedAnswer {
        read_pages: vec![PageRequest {
            original_id: "scan".into(),
            page: MAX_PAGE_NUMBER + 1,
        }],
        ..reading
    };
    assert!(!beyond.is_valid());
}

#[test]
fn transcript_schema_and_bounds() {
    let value = object(vec![
        ("text", s("Invoice 42")),
        (
            "unreadable",
            JsonValue::Array(vec![s("Lower half is torn")]),
        ),
    ]);
    assert!(PageTranscript::schema().accepts(&value));
    let transcript = PageTranscript::from_json(&value).unwrap();
    assert_eq!(transcript.unreadable, vec!["Lower half is torn"]);
    let blank = object(vec![
        ("text", s("")),
        ("unreadable", JsonValue::Array(vec![s("   ")])),
    ]);
    assert_eq!(PageTranscript::from_json(&blank), None);
    // Both schemas fit the bounded JSON subset.
    assert!(PageTranscript::schema().is_valid());
    assert!(CitedAnswer::schema().is_valid());
}

#[test]
fn verified_source_names_its_exact_original() {
    let verified = VerifiedSource {
        source: source("a", "page:1", "x"),
        original_sha256: None,
        verification: Verification::Verified,
    };
    assert!(!verified.is_valid());
    assert!(
        VerifiedSource {
            original_sha256: Some("a".repeat(64)),
            ..verified.clone()
        }
        .is_valid()
    );
    assert!(
        VerifiedSource {
            verification: Verification::Unverified(UnverifiedReason::SourceUnreadable),
            ..verified
        }
        .is_valid()
    );
    assert_eq!(
        UnverifiedReason::ALL
            .iter()
            .map(|r| r.as_str())
            .collect::<Vec<_>>(),
        vec![
            "not_found_at_location",
            "location_missing",
            "source_unreadable",
            "page_only"
        ]
    );
}

fn note_json(kind: &str, reason: &str, segments: Vec<i64>) -> JsonValue {
    object(vec![
        ("requirement_id", s("REQ-1")),
        ("kind", s(kind)),
        ("text", s("Which vendor master applies?")),
        ("reason", s(reason)),
        (
            "segments",
            JsonValue::Array(segments.into_iter().map(JsonValue::Integer).collect()),
        ),
    ])
}

#[test]
fn method_and_skill_requests_decode_and_notes_alone_are_a_turn() {
    let value = object(vec![
        (
            "segments",
            JsonValue::Array(vec![object(vec![
                ("text", s("Payments over 10,000 need two approvals.")),
                ("sources", JsonValue::Array(vec![])),
            ])]),
        ),
        ("limitations", JsonValue::Array(vec![])),
        ("read_pages", JsonValue::Array(vec![])),
        ("programs", JsonValue::Array(vec![])),
        (
            "read_method",
            JsonValue::Array(vec![s("criteria/REQ-1"), s("skill/skill-v1/checklist")]),
        ),
        ("use_skills", JsonValue::Array(vec![s("skill-v1")])),
        (
            "run_skill_script",
            JsonValue::Array(vec![object(vec![
                ("version_id", s("skill-v1")),
                ("resource_id", s("summarise")),
                ("inputs", JsonValue::Array(vec![s("b"), s("a"), s("a")])),
            ])]),
        ),
        (
            "method_notes",
            JsonValue::Array(vec![
                note_json("question", "", vec![]),
                note_json("gap", "evidence_unavailable", vec![]),
                note_json("statement", "", vec![0]),
            ]),
        ),
    ]);
    assert!(CitedAnswer::investigation_schema().accepts(&value));
    let answer = CitedAnswer::from_json(&value).unwrap();
    assert_eq!(answer.use_skills, vec!["skill-v1"]);
    assert_eq!(answer.discarded, 0);
    assert_eq!(answer.run_skill_script[0].inputs, vec!["a", "b"]);
    assert_eq!(answer.method_notes.len(), 3);
    assert_eq!(
        answer.method_notes[1].reason,
        Some(crate::investigation::GapReason::EvidenceUnavailable)
    );
    assert!(answer.requests_investigation());
    assert!(
        !answer.requests_reading(),
        "22.6 requests are not 22.5 reading"
    );
    // A statement may only point at segments the answer has.
    let mut beyond = answer.clone();
    beyond.method_notes[2].segments = vec![1];
    assert!(!beyond.is_valid());
    // A gap without a closed reason, a "complete" kind, a statement beyond the
    // segments, a repeated load and an invalid part ID are each left out and
    // counted; the rest of the answer stands.
    let mut bad = value.clone();
    if let JsonValue::Object(map) = &mut bad {
        map.insert(
            "method_notes".into(),
            JsonValue::Array(vec![
                note_json("gap", "", vec![]),
                note_json("complete", "", vec![]),
                note_json("statement", "", vec![9]),
                note_json("statement", "", vec![0, 0]),
            ]),
        );
        map.insert(
            "use_skills".into(),
            JsonValue::Array(vec![s("skill-v1"), s("skill-v1"), s("bad id")]),
        );
        map.insert(
            "read_method".into(),
            JsonValue::Array(vec![s("criteria/../x"), s("criteria/REQ-1")]),
        );
    }
    let kept = CitedAnswer::from_json(&bad).unwrap();
    assert_eq!(kept.method_notes.len(), 1);
    assert_eq!(
        kept.method_notes[0].segments,
        vec![0],
        "segments are normalized"
    );
    assert_eq!(kept.use_skills, vec!["skill-v1"]);
    assert_eq!(kept.read_method, vec!["criteria/REQ-1"]);
    assert_eq!(kept.discarded, 6);
    assert_eq!(kept.segments, answer.segments);
    // Notes alone (no text, no request) are a valid turn that waits.
    let notes_only = CitedAnswer {
        method_notes: vec![answer.method_notes[0].clone()],
        ..CitedAnswer::default()
    };
    assert!(notes_only.is_valid());
    assert!(!notes_only.requests_reading());
    assert!(!notes_only.is_answer());
    // Duplicate loads or part fetches are not a valid request.
    let duplicate = CitedAnswer {
        use_skills: vec!["skill-v1".into(), "skill-v1".into()],
        ..CitedAnswer::default()
    };
    assert!(!duplicate.is_valid());
    let malformed = CitedAnswer {
        read_method: vec!["criteria/../x".into()],
        ..CitedAnswer::default()
    };
    assert!(!malformed.is_valid());
}
