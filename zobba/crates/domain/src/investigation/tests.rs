use super::*;

fn note(kind: NoteKind, reason: Option<GapReason>) -> MethodNote {
    MethodNote {
        requirement_id: Some("REQ-1".into()),
        kind,
        text: "The vendor master is not registered".into(),
        reason,
        segments: vec![],
    }
}

#[test]
fn a_gap_carries_exactly_one_closed_reason_and_only_statements_cite() {
    assert!(note(NoteKind::Gap, Some(GapReason::EvidenceUnavailable)).is_valid());
    assert!(!note(NoteKind::Gap, None).is_valid());
    assert!(!note(NoteKind::Question, Some(GapReason::CriteriaMissing)).is_valid());
    assert!(note(NoteKind::Question, None).is_valid());
    let mut statement = note(NoteKind::Statement, None);
    statement.segments = vec![0, 2];
    assert!(statement.is_valid());
    statement.segments = vec![2, 2];
    assert!(!statement.is_valid(), "segments are strictly ordered");
    let mut question = note(NoteKind::Question, None);
    question.segments = vec![0];
    assert!(!question.is_valid(), "only a statement points at citations");
    let mut long = note(NoteKind::Question, None);
    long.text = "x".repeat(MAX_NOTE_BYTES + 1);
    assert!(!long.is_valid());
    let mut blank = note(NoteKind::Question, None);
    blank.text = "  ".into();
    assert!(!blank.is_valid());
    let mut control = note(NoteKind::Question, None);
    control.text = "a\u{7}b".into();
    assert!(!control.is_valid());
    let mut general = note(NoteKind::Question, None);
    general.requirement_id = None;
    assert!(general.is_valid());
    general.requirement_id = Some("bad id".into());
    assert!(!general.is_valid());
}

#[test]
fn every_vocabulary_round_trips() {
    for kind in NoteKind::ALL {
        assert_eq!(NoteKind::parse(kind.as_str()), Some(*kind));
    }
    for reason in GapReason::ALL {
        assert_eq!(GapReason::parse(reason.as_str()), Some(*reason));
    }
    for reason in UseReason::ALL {
        assert_eq!(UseReason::parse(reason.as_str()), Some(*reason));
    }
    for outcome in UseOutcome::ALL {
        assert_eq!(UseOutcome::parse(outcome.as_str()), Some(*outcome));
    }
    assert_eq!(GapReason::parse("complete"), None);
}

#[test]
fn part_identifiers_are_canonical_and_built_from_owned_identifiers() {
    for part in [
        Part::Criteria("REQ-1".into()),
        Part::Procedure("REQ-1".into()),
        Part::Template("ap-template".into(), "v2".into()),
        Part::SkillResource("skill-v1".into(), "checklist".into()),
    ] {
        assert_eq!(Part::parse(&part.id()), Some(part.clone()));
        assert!(valid_part_id(&part.id()));
    }
    for bad in [
        "",
        "criteria",
        "criteria/",
        "criteria/a/b",
        "template/a",
        "skill/v1",
        "criteria/../x",
        "criteria/a b",
        "unknown/x",
    ] {
        assert!(!valid_part_id(bad), "{bad}");
    }
    assert!(Part::parse("skill/v/r").unwrap().is_skill());
}

#[test]
fn script_requests_name_ordered_registered_inputs() {
    let request = ScriptRequest {
        version_id: "skill-v1".into(),
        resource_id: "summary".into(),
        inputs: vec!["a".into(), "b".into()],
    };
    assert!(request.is_valid());
    assert!(
        !ScriptRequest {
            inputs: vec![],
            ..request.clone()
        }
        .is_valid()
    );
    assert!(
        !ScriptRequest {
            inputs: vec!["b".into(), "a".into()],
            ..request.clone()
        }
        .is_valid()
    );
    assert!(
        !ScriptRequest {
            inputs: (0..=MAX_SCRIPT_INPUTS).map(|i| format!("o{i}")).collect(),
            ..request
        }
        .is_valid()
    );
}
