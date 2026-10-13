use super::*;

fn environment() -> AnalysisEnvironment {
    server_allowlist().remove(0)
}
fn request() -> AnalysisRequest {
    AnalysisRequest {
        environment_id: GENERAL_ENVIRONMENT_ID.into(),
        image_digest: GENERAL_IMAGE_DIGEST.into(),
        program: "print('x')\n".into(),
        program_sha256: "b".repeat(64),
        inputs: vec![
            AnalysisInput {
                original_id: "a-original".into(),
                digest: "c".repeat(64),
            },
            AnalysisInput {
                original_id: "b-original".into(),
                digest: "d".repeat(64),
            },
        ],
        limits: AnalysisLimits::DEFAULT,
    }
}
fn regular(path: &str, content: &[u8]) -> OutputEntry {
    OutputEntry {
        path: path.as_bytes().to_vec(),
        kind: OutputKind::Regular,
        links: 1,
        size: content.len() as u64,
        content: Some(content.to_vec()),
        withheld: None,
    }
}

#[test]
fn the_server_allowlist_is_one_pinned_environment() {
    let list = server_allowlist();
    assert_eq!(list.len(), 1);
    assert!(list[0].is_valid());
    assert!(valid_image_digest(&list[0].image_digest));
    assert_eq!(
        list[0].argv().last().map(String::as_str),
        Some(PROGRAM_PATH)
    );
}

#[test]
fn limits_cannot_exceed_owner_ceilings() {
    assert!(AnalysisLimits::DEFAULT.is_valid());
    assert!(CEILING.is_valid());
    for change in [
        |l: &mut AnalysisLimits| l.cpu_millis = 2_001,
        |l: &mut AnalysisLimits| l.memory_mib = 4_097,
        |l: &mut AnalysisLimits| l.wall_seconds = 901,
        |l: &mut AnalysisLimits| l.output_total_bytes = 100 * 1024 * 1024 + 1,
        |l: &mut AnalysisLimits| l.output_file_bytes = OUTPUT_FILE_CEILING + 1,
        |l: &mut AnalysisLimits| l.pids = 257,
        |l: &mut AnalysisLimits| l.output_files = 0,
        |l: &mut AnalysisLimits| l.wall_seconds = 0,
    ] {
        let mut limits = AnalysisLimits::DEFAULT;
        change(&mut limits);
        assert!(!limits.is_valid(), "{limits:?}");
    }
    let mut inverted = AnalysisLimits::DEFAULT;
    inverted.output_total_bytes = 10;
    inverted.output_file_bytes = 11;
    assert!(!inverted.is_valid());
}

#[test]
fn canonical_material_binds_environment_program_inputs_and_limits_only() {
    let base = request();
    let material = base.canonical_material().unwrap();
    assert!(material.contains(&base.program_sha256));
    assert!(
        !material.contains("print("),
        "program text never enters material"
    );
    assert!(material.contains("input:a-original:"));
    for change in [
        |r: &mut AnalysisRequest| r.environment_id = "other-env".into(),
        |r: &mut AnalysisRequest| r.image_digest = format!("sha256:{}", "e".repeat(64)),
        |r: &mut AnalysisRequest| r.program_sha256 = "f".repeat(64),
        |r: &mut AnalysisRequest| r.inputs[0].digest = "9".repeat(64),
        |r: &mut AnalysisRequest| r.inputs.pop().map(|_| ()).unwrap(),
        |r: &mut AnalysisRequest| r.limits.wall_seconds = 10,
        |r: &mut AnalysisRequest| r.limits.output_files = 3,
    ] {
        let mut other = base.clone();
        change(&mut other);
        assert_ne!(other.canonical_material(), Some(material.clone()));
    }
    // Maximal valid inputs still fit the reviewed material bound.
    let mut wide = base.clone();
    wide.inputs = (0..MAX_INPUTS)
        .map(|i| AnalysisInput {
            original_id: format!("{i:02}{}", "x".repeat(126)),
            digest: "a".repeat(64),
        })
        .collect();
    assert!(wide.canonical_material().is_some());
}

#[test]
fn requests_name_only_allowlisted_environments_by_id_and_digest() {
    let list = server_allowlist();
    assert!(request().environment(&list).is_some());
    let mut unlisted = request();
    unlisted.environment_id = "custom".into();
    assert!(unlisted.environment(&list).is_none());
    let mut digest = request();
    digest.image_digest = format!("sha256:{}", "0".repeat(64));
    assert!(digest.environment(&list).is_none());
    for invalid in [
        "python:3.13",
        "docker.io/library/python@sha256:abc",
        "sha256:XYZ",
    ] {
        let mut r = request();
        r.image_digest = invalid.into();
        assert!(!r.is_valid());
    }
    let mut unordered = request();
    unordered.inputs.reverse();
    assert!(!unordered.is_valid());
    let mut nul = request();
    nul.program = "a\0b".into();
    assert!(!nul.is_valid());
}

#[test]
fn status_machine_has_no_automatic_exit_from_unknown_or_terminal_states() {
    use JobStatus::*;
    assert!(PossiblyStarted.can_follow(Admitted));
    assert!(PossiblyStarted.can_follow(Absent));
    assert!(Running.can_follow(PossiblyStarted));
    assert!(Absent.can_follow(PossiblyStarted));
    assert!(
        !Absent.can_follow(Running),
        "a running job is never declared absent"
    );
    assert!(Collected.can_follow(Completed));
    assert!(!Collected.can_follow(Stopped), "a stopped job is discarded");
    assert!(
        !Collected.can_follow(Unknown),
        "unknown outputs are never registered"
    );
    assert!(
        !PossiblyStarted.can_follow(Unknown),
        "unknown is never retried automatically"
    );
    for next in JobStatus::ALL {
        assert!(!next.can_follow(Collected));
        assert!(!next.can_follow(Stopped));
    }
    for status in JobStatus::ALL {
        assert_eq!(JobStatus::parse(status.as_str()), Some(*status));
    }
}

#[test]
fn hostile_outputs_are_refused_with_closed_reasons_and_safe_siblings_survive() {
    let environment = environment();
    let mut entries = vec![
        regular("summary.csv", b"a,b\n1,2\n"),
        OutputEntry {
            kind: OutputKind::Symlink,
            ..regular("link.csv", b"")
        },
        OutputEntry {
            links: 2,
            ..regular("hard.csv", b"x")
        },
        regular("../x.csv", b"x"),
        regular("/abs.csv", b"x"),
        regular("A.csv", b"x"),
        regular("a.csv", b"x"),
        OutputEntry {
            kind: OutputKind::Fifo,
            ..regular("pipe.csv", b"")
        },
        OutputEntry {
            kind: OutputKind::Socket,
            ..regular("sock.csv", b"")
        },
        OutputEntry {
            kind: OutputKind::Device,
            ..regular("dev.csv", b"")
        },
        regular("bad\u{7}name.csv", b"x"),
        OutputEntry {
            path: b"nul\0.csv".to_vec(),
            ..regular("", b"x")
        },
        OutputEntry {
            path: vec![0xff, b'.', b'c'],
            ..regular("", b"x")
        },
        regular("a//b.csv", b"x"),
        regular("./c.csv", b"x"),
        regular("program.exe", b"x"),
        regular(&format!("{}.csv", "n".repeat(300)), b"x"),
        regular("1/2/3/4/5/6/7/8/9.csv", b"x"),
        regular("nested/ok.json", b"{}"),
        OutputEntry {
            kind: OutputKind::Directory,
            ..regular("nested", b"")
        },
        regular("win\\x.csv", b"x"),
        OutputEntry {
            content: None,
            ..regular("missing.csv", b"xyz")
        },
    ];
    entries.push(regular("dup.csv", b"1"));
    entries.push(regular("dup.csv", b"1"));
    let result = validate_outputs(&entries, &AnalysisLimits::DEFAULT, &environment);
    let accepted: Vec<&str> = result.accepted.iter().map(|a| a.path.as_str()).collect();
    assert_eq!(accepted, ["nested/ok.json", "summary.csv"]);
    let reason = |path: &[u8]| {
        let index = entries.iter().position(|e| e.path == path).unwrap();
        result
            .rejected
            .iter()
            .find(|r| r.index == index)
            .map(|r| r.reason)
    };
    use RejectReason::*;
    for (path, expected) in [
        (&b"link.csv"[..], Symlink),
        (b"hard.csv", Hardlink),
        (b"../x.csv", ParentReference),
        (b"/abs.csv", Absolute),
        (b"A.csv", CaseCollision),
        (b"a.csv", CaseCollision),
        (b"pipe.csv", Fifo),
        (b"sock.csv", Socket),
        (b"dev.csv", Device),
        ("bad\u{7}name.csv".as_bytes(), ControlCharacter),
        (b"nul\0.csv", Nul),
        (&[0xff, b'.', b'c'], Encoding),
        (b"a//b.csv", NotNormalized),
        (b"./c.csv", NotNormalized),
        (b"program.exe", MediaType),
        (b"1/2/3/4/5/6/7/8/9.csv", TooDeep),
        (b"win\\x.csv", ReservedCharacter),
        (b"missing.csv", SizeMismatch),
    ] {
        assert_eq!(
            reason(path),
            Some(expected),
            "{}",
            String::from_utf8_lossy(path)
        );
    }
    assert_eq!(
        reason(format!("{}.csv", "n".repeat(300)).as_bytes()),
        Some(TooLong)
    );
    assert_eq!(
        result
            .rejected
            .iter()
            .filter(|r| r.reason == Duplicate)
            .count(),
        2
    );
    assert!(
        reason(b"nested").is_none(),
        "directories are structure, not outputs"
    );
}

#[test]
fn file_count_and_total_limits_bound_registration() {
    let environment = environment();
    let limits = AnalysisLimits {
        output_files: 2,
        output_total_bytes: 10,
        output_file_bytes: 6,
        ..AnalysisLimits::DEFAULT
    };
    let entries = vec![
        regular("a.txt", b"12345"),
        regular("b.txt", b"12345"),
        regular("c.txt", b"1"),
        regular("d.txt", b"1234567"),
    ];
    let result = validate_outputs(&entries, &limits, &environment);
    assert_eq!(result.accepted.len(), 2);
    let reasons: Vec<RejectReason> = result.rejected.iter().map(|r| r.reason).collect();
    assert_eq!(
        reasons,
        [RejectReason::TooManyFiles, RejectReason::FileTooLarge]
    );
    let totals = AnalysisLimits {
        output_files: 8,
        output_total_bytes: 9,
        output_file_bytes: 6,
        ..AnalysisLimits::DEFAULT
    };
    let result = validate_outputs(&entries[..3], &totals, &environment);
    let accepted: Vec<&str> = result.accepted.iter().map(|a| a.path.as_str()).collect();
    assert_eq!(
        accepted,
        ["a.txt", "c.txt"],
        "a later smaller file still fits"
    );
    assert_eq!(result.rejected.len(), 1);
    assert_eq!(result.rejected[0].reason, RejectReason::TotalTooLarge);
}

#[test]
fn media_types_are_decided_by_trusted_extension_mapping() {
    assert_eq!(media_type_for("x/summary.CSV"), Some("text/csv"));
    assert_eq!(media_type_for(".csv"), None);
    assert_eq!(media_type_for("noext"), None);
    assert_eq!(media_type_for("image.png"), Some("image/png"));
    // Story 22.5: the general environment admits page images (the trusted
    // document program writes them); an environment without them refuses.
    let environment = environment();
    let result = validate_outputs(
        &[regular("image.png", b"x")],
        &AnalysisLimits::DEFAULT,
        &environment,
    );
    assert!(result.rejected.is_empty(), "png is a general page image");
    let narrow = AnalysisEnvironment {
        media_types: vec!["text/csv".into()],
        ..environment
    };
    let result = validate_outputs(
        &[regular("image.png", b"x")],
        &AnalysisLimits::DEFAULT,
        &narrow,
    );
    assert_eq!(
        result.rejected[0].reason,
        RejectReason::MediaType,
        "png is not allowed by an environment that does not list it"
    );
}

#[test]
fn case_collisions_use_nfc_and_full_case_folding() {
    // NFC before folding: a decomposed "é" collides with the composed "É".
    assert_eq!(fold_key("Cafe\u{301}.txt"), fold_key("CAF\u{c9}.TXT"));
    // Full folding, not lowercasing: "ß" folds to "ss".
    assert_eq!(fold_key("stra\u{df}e.csv"), fold_key("STRASSE.csv"));
    assert_ne!(
        "stra\u{df}e.csv".to_lowercase(),
        "STRASSE.csv".to_lowercase(),
        "lowercasing alone would miss this collision"
    );
    let environment = environment();
    let entries = [
        regular("stra\u{df}e.csv", b"1"),
        regular("STRASSE.csv", b"2"),
        regular("Cafe\u{301}.txt", b"3"),
        regular("caf\u{e9}.txt", b"4"),
        regular("other.txt", b"5"),
    ];
    let result = validate_outputs(&entries, &AnalysisLimits::DEFAULT, &environment);
    let accepted: Vec<&str> = result.accepted.iter().map(|a| a.path.as_str()).collect();
    assert_eq!(accepted, ["other.txt"]);
    assert_eq!(result.accepted[0].fold_key, fold_key("other.txt"));
    assert!(
        result
            .rejected
            .iter()
            .all(|r| r.reason == RejectReason::CaseCollision)
    );
    assert_eq!(result.rejected.len(), 4);
}

#[test]
fn withheld_entries_carry_the_collector_reason_not_a_size_mismatch() {
    let environment = environment();
    let withheld = |path: &str, why| OutputEntry {
        content: None,
        withheld: Some(why),
        ..regular(path, b"abc")
    };
    let entries = [
        withheld("budget.txt", Withheld::Budget),
        withheld("slots.txt", Withheld::Slots),
        withheld("unreadable.txt", Withheld::Unreadable),
        OutputEntry {
            path: vec![b'n'; COLLECT_PATH_BYTES_MAX],
            ..withheld("", Withheld::TooLong)
        },
        OutputEntry {
            content: None,
            ..regular("short.txt", b"abc")
        },
    ];
    let result = validate_outputs(&entries, &AnalysisLimits::DEFAULT, &environment);
    let reasons: Vec<RejectReason> = result.rejected.iter().map(|r| r.reason).collect();
    assert_eq!(
        reasons,
        [
            RejectReason::TotalTooLarge,
            RejectReason::TooManyFiles,
            RejectReason::NotRegular,
            RejectReason::TooLong,
            RejectReason::SizeMismatch,
        ]
    );
}

#[test]
fn start_refusal_is_the_only_exit_from_absence_besides_a_new_attempt() {
    assert!(JobStatus::Failed.can_follow(JobStatus::Absent));
    assert!(!JobStatus::Completed.can_follow(JobStatus::Absent));
    assert!(!JobStatus::Collected.can_follow(JobStatus::Absent));
}
