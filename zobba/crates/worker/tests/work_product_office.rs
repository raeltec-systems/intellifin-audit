//! Story 24.4: the deterministic DOCX and XLSX exports open in LibreOffice.
//!
//! A fixed export view is rendered by the trusted in-house writer
//! (`zobba-export-v1`); the bytes must equal the committed fixtures
//! (`fixtures/exports/`, rewritten only with ZOBBA_UPDATE_EXPORT_FIXTURE=1),
//! and LibreOffice headless must open both: the DOCX converts to text that
//! carries the source revision, every required section and the review
//! state, and to PDF; the XLSX converts to HTML whose cells carry the
//! formula-looking statement as text and the SUM total. It fails, never
//! skips, when `soffice` is missing.
use std::path::{Path, PathBuf};

use zobba_domain::work_product::{
    ExportFormat,
    export::{ExportBlock, ExportCitation, ExportCoverage, ExportSection, ExportView, render},
};

fn hex(prefix: &str, c: char) -> String {
    format!("{prefix}-{}", c.to_string().repeat(40))
}

fn view() -> ExportView {
    ExportView {
        version_id: hex("wpv", '7'),
        version: 2,
        digest: "d".repeat(64),
        title: "AP approvals working paper".into(),
        kind: "working_paper".into(),
        template: "AP working paper FY2026".into(),
        sections: vec![
            ExportSection {
                title: "Objective".into(),
                required: true,
                blocks: vec![
                    ExportBlock::Heading("Approval testing".into()),
                    ExportBlock::Narrative {
                        judgment: false,
                        text: "Test whether every invoice above the threshold was approved.".into(),
                    },
                ],
            },
            ExportSection {
                title: "Results".into(),
                required: false,
                blocks: vec![
                    ExportBlock::Narrative {
                        judgment: true,
                        text: "Approvals appear weak across the population.".into(),
                    },
                    ExportBlock::Claim {
                        number: 1,
                        statement: "15 of 1,000 applicable invoices had no recorded approver.".into(),
                        coverage: Some("Population complete · 1,200 in scope · unresolved 20 (see Limitations)".into()),
                        refresh: vec![],
                        support: vec!["Summary summary-3: 15 not met (criterion approver)".into()],
                    },
                    ExportBlock::Claim {
                        number: 2,
                        statement: "=HYPERLINK the policy requires an approver above 1,000.00 USD.".into(),
                        coverage: None,
                        refresh: vec!["the evaluation it cites was revised".into()],
                        support: vec!["Quote from original ap-policy at bytes:0-48".into()],
                    },
                    ExportBlock::Lines(vec![
                        "Population complete · 1,200 in scope · unresolved 20 (see Limitations)".into(),
                        "Conclusion: exceptions found inconclusive".into(),
                    ]),
                ],
            },
            ExportSection {
                title: "Conclusion".into(),
                required: true,
                blocks: vec![ExportBlock::Limitations],
            },
        ],
        citations: vec![
            ExportCitation {
                claim: 1,
                record_kind: "summary".into(),
                record_id: hex("summary", '3'),
                digest: "e".repeat(64),
                value: "15".into(),
                quote: None,
                withheld: false,
            },
            ExportCitation {
                claim: 2,
                record_kind: "original".into(),
                record_id: "ap-policy".into(),
                digest: "b".repeat(64),
                value: "Invoices above 1,000.00 USD require an approver.".into(),
                quote: Some((
                    "AP policy.txt".into(),
                    "bytes:0-48".into(),
                    "Invoices above 1,000.00 USD require an approver.".into(),
                )),
                withheld: false,
            },
        ],
        limitations: vec![
            "Summary summary-3: conclusion exceptions found inconclusive; unresolved 20.".into(),
            "Claim [2] needs refresh: the evaluation it cites was revised.".into(),
        ],
        coverage: vec![ExportCoverage {
            summary_id: hex("summary", '3'),
            line: "Population complete · 1,200 in scope".into(),
            partition: [
                ("Failing".into(), 20),
                ("Meeting every applicable criterion".into(), 960),
                ("Unresolved".into(), 20),
                ("Not applicable to any".into(), 200),
            ],
            total_label: "Subjects in scope".into(),
            total: 1_200,
            exact: true,
        }],
        preparation: "Prepared by Zobba (agent); edited by Alex Auditor".into(),
    }
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/exports")
}

/// The committed fixtures are exactly the writer's bytes.
#[test]
fn the_committed_export_fixtures_are_the_writers_exact_bytes() {
    for (format, name) in [
        (ExportFormat::Docx, "working-paper.docx"),
        (ExportFormat::Xlsx, "working-paper.xlsx"),
    ] {
        let bytes = render(&view(), format);
        assert_eq!(
            bytes,
            render(&view(), format),
            "the writer is deterministic"
        );
        let path = fixtures().join(name);
        if std::env::var("ZOBBA_UPDATE_EXPORT_FIXTURE").as_deref() == Ok("1") {
            std::fs::write(&path, &bytes).unwrap();
        } else {
            let stored = std::fs::read(&path).unwrap_or_default();
            assert!(
                stored == bytes,
                "set ZOBBA_UPDATE_EXPORT_FIXTURE=1 to update {path:?}"
            );
        }
    }
}

fn soffice(out: &Path, profile: &Path, args: &[&str]) {
    let status = std::process::Command::new("soffice")
        .arg(format!(
            "-env:UserInstallation=file://{}",
            profile.display()
        ))
        .args(["--headless", "--norestore", "--nolockcheck"])
        .args(args)
        .arg("--outdir")
        .arg(out)
        .status()
        .expect("LibreOffice (soffice) is required to open the export fixtures");
    assert!(status.success(), "soffice {args:?} failed: {status}");
}

/// LibreOffice headless opens the committed DOCX and XLSX fixtures.
#[test]
fn the_export_fixtures_open_in_libreoffice_headless() {
    let work = std::env::temp_dir().join(format!("zobba-office-{}", std::process::id()));
    let (out, profile) = (work.join("out"), work.join("profile"));
    std::fs::create_dir_all(&out).unwrap();
    let docx = fixtures().join("working-paper.docx");
    let xlsx = fixtures().join("working-paper.xlsx");
    soffice(
        &out,
        &profile,
        &[
            "--convert-to",
            "txt:Text (encoded):UTF8",
            docx.to_str().unwrap(),
        ],
    );
    let text = std::fs::read_to_string(out.join("working-paper.txt")).expect("the DOCX opened");
    let v = view();
    assert!(text.contains(&v.source_revision()), "{text}");
    for wanted in [
        "Objective",
        "Results",
        "Conclusion",
        "Not completed in this version.",
        "Zobba's judgment — not checked against records",
        "Needs refresh: the evaluation it cites was revised",
        "Citations",
        "Draft — not reviewed",
        "[1]",
    ] {
        assert!(text.contains(wanted), "{wanted}: {text}");
    }
    soffice(
        &out,
        &profile,
        &["--convert-to", "pdf", docx.to_str().unwrap()],
    );
    let pdf = std::fs::read(out.join("working-paper.pdf")).expect("the DOCX rendered to PDF");
    assert!(pdf.starts_with(b"%PDF"));
    soffice(
        &out,
        &profile,
        &["--convert-to", "html", xlsx.to_str().unwrap()],
    );
    let html = std::fs::read_to_string(out.join("working-paper.html")).expect("the XLSX opened");
    for wanted in [
        "=HYPERLINK the policy",
        "Work product",
        "Claims",
        "Citations",
        "Coverage",
        "1200",
    ] {
        assert!(html.contains(wanted), "{wanted} in the opened workbook");
    }
    let _ = std::fs::remove_dir_all(&work);
}
