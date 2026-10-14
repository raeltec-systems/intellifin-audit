//! Verification contracts with an in-memory trusted reader. The real sandbox,
//! documents and database are proven by the worker integration suite.
use super::*;
use std::{
    collections::BTreeMap,
    sync::Mutex,
    task::{Context, Poll, Waker},
};
use zobba_domain::{
    citation::{Segment, UnverifiedReason as R},
    identity::Scope,
};

fn run<F: Future>(future: F) -> F::Output {
    let mut future = std::pin::pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
    }
}
fn basis() -> ClaimBasis {
    ClaimBasis {
        actor_id: "actor".into(),
        scope: Scope {
            organisation_id: "org".into(),
            client_id: "client".into(),
            engagement_id: "engagement".into(),
        },
        task_id: "task".into(),
        cycle_id: "cycle".into(),
        claim_id: "claim".into(),
        worker_id: "worker".into(),
        process_instance: "process".into(),
        owner_epoch: 1,
        execution_epoch: 1,
        intent_revision: 1,
    }
}

#[derive(Default)]
struct Reader {
    originals: BTreeMap<String, String>,
    located: BTreeMap<(String, String), Located>,
    unreadable: Vec<String>,
    pages: BTreeMap<(String, u32), PageFacts>,
    bytes: BTreeMap<String, String>,
    locate_calls: Mutex<Vec<(String, usize)>>,
    fence: bool,
    /// A transient failure of every trusted read.
    transient: Option<ReadingError>,
    /// The reader answers that the original's format has no such location.
    unsupported: Vec<String>,
}
impl CitationReader for Reader {
    async fn original(
        &self,
        _: &ClaimBasis,
        id: &str,
    ) -> Result<Option<CitedOriginal>, ReadingError> {
        Ok(self.originals.get(id).map(|sha256| CitedOriginal {
            id: id.into(),
            sha256: sha256.clone(),
        }))
    }
    async fn byte_range(
        &self,
        _: &ClaimBasis,
        original: &CitedOriginal,
        start: u64,
        end: u64,
    ) -> Result<Located, ReadingError> {
        let text = &self.bytes[&original.id];
        Ok(text
            .get(start as usize..end as usize)
            .map_or(Located::Missing, |t| Located::Found(vec![t.into()])))
    }
    async fn locate(
        &self,
        _: &ClaimBasis,
        original: &CitedOriginal,
        locators: &[Locator],
        _: &ModelCancellation,
    ) -> Result<Vec<Located>, ReadingError> {
        self.locate_calls
            .lock()
            .unwrap()
            .push((original.id.clone(), locators.len()));
        if self.fence {
            return Err(ReadingError::Fenced);
        }
        if let Some(error) = self.transient {
            return Err(error);
        }
        if self.unreadable.contains(&original.id) {
            // A hostile file: the trusted program refused or hit a limit.
            return Ok(vec![Located::Unreadable; locators.len()]);
        }
        if self.unsupported.contains(&original.id) {
            return Ok(vec![Located::Missing; locators.len()]);
        }
        Ok(locators
            .iter()
            .map(|l| {
                self.located
                    .get(&(original.id.clone(), l.render()))
                    .cloned()
                    .unwrap_or(Located::Missing)
            })
            .collect())
    }
    async fn page(
        &self,
        _: &ClaimBasis,
        original: &CitedOriginal,
        page: u32,
        _: &ModelCancellation,
    ) -> Result<Option<PageFacts>, ReadingError> {
        if let Some(error) = self.transient {
            return Err(error);
        }
        Ok(self.pages.get(&(original.id.clone(), page)).cloned())
    }
}

fn source(original: &str, locator: &str, quote: &str) -> CitationSource {
    CitationSource {
        original_id: original.into(),
        locator: Locator::parse(locator),
        quote: quote.into(),
    }
}
fn answer(segments: Vec<(&str, Vec<CitationSource>)>) -> CitedAnswer {
    CitedAnswer {
        segments: segments
            .into_iter()
            .map(|(text, sources)| Segment {
                text: text.into(),
                sources,
            })
            .collect(),
        limitations: vec![],
        read_pages: vec![],
        programs: vec![],
    }
}
fn reasons(citations: &[StoredCitation]) -> Vec<Vec<Option<R>>> {
    citations
        .iter()
        .map(|c| c.sources.iter().map(|s| s.verification.reason()).collect())
        .collect()
}

fn reader() -> Reader {
    let mut reader = Reader::default();
    for (id, sha) in [
        ("trial-balance", "a"),
        ("contract-pdf", "b"),
        ("email", "c"),
        ("scan", "d"),
        ("zip-bomb", "e"),
        ("notes", "f"),
    ] {
        reader.originals.insert(id.into(), sha.repeat(64));
    }
    reader.located.insert(
        ("trial-balance".into(), "cell:Sheet1!B4".into()),
        Located::Found(vec!["1250".into(), "1,250.00".into()]),
    );
    reader.located.insert(
        ("email".into(), "part:1".into()),
        Located::Found(vec!["We confirm payment within 30 days.".into()]),
    );
    reader.unreadable.push("zip-bomb".into());
    reader.pages.insert(
        ("contract-pdf".into(), 2),
        PageFacts {
            exists: true,
            text_layer: Some("Payment terms\r\nPayment is due within 30 days.".into()),
            read_natively: false,
        },
    );
    reader.pages.insert(
        ("scan".into(), 3),
        PageFacts {
            exists: true,
            text_layer: None,
            read_natively: true,
        },
    );
    reader.bytes.insert(
        "notes".into(),
        "Opening balance 1,250.00 agreed to the ledger.\n".into(),
    );
    reader
}

#[test]
fn every_matrix_row_gets_its_closed_result_and_the_answer_is_unchanged() {
    let reader = reader();
    let original = answer(vec![
        (
            "The trial balance shows 1,250.00.",
            vec![source("trial-balance", "cell:Sheet1!B4", "1,250.00")],
        ),
        (
            " It also shows 1,280.00.",
            vec![source("trial-balance", "cell:Sheet1!B4", "1,280.00")],
        ),
        (
            " The signature is on page 3 of the scan.",
            vec![source("scan", "page:3", "Signed by A. Auditor")],
        ),
        (
            " Payment is due in 30 days.",
            vec![
                source("contract-pdf", "page:2", "Payment is due within 30 days."),
                source("email", "part:1", "payment within 30 days"),
            ],
        ),
        (
            " No locator was given.",
            vec![source("contract-pdf", "", "anything")],
        ),
        (
            " A hostile workbook.",
            vec![source("zip-bomb", "cell:Sheet1!A1", "x")],
        ),
        (
            " Unknown original.",
            vec![source("not-registered", "page:1", "x")],
        ),
        (
            " Plain text range.",
            vec![source("notes", "bytes:16-24", "1,250.00")],
        ),
        (" Uncited closing sentence.", vec![]),
    ]);
    let before = original.clone();
    let citations = run(verify(
        &reader,
        &basis(),
        &original,
        &ModelCancellation::new(),
    ))
    .unwrap();
    assert_eq!(original, before, "verification never edits the answer");
    assert_eq!(
        reasons(&citations),
        vec![
            vec![None],
            vec![Some(R::NotFoundAtLocation)],
            vec![Some(R::PageOnly)],
            vec![None, None],
            vec![Some(R::LocationMissing)],
            vec![Some(R::SourceUnreadable)],
            vec![Some(R::SourceUnreadable)],
            vec![None],
        ]
    );
    // Spans are the cited segments of the unchanged text.
    let text = original.text();
    assert_eq!(
        &text[citations[0].span.start as usize..citations[0].span.end as usize],
        "The trial balance shows 1,250.00."
    );
    assert_eq!(citations.len(), 8, "the uncited segment has no citation");
    // A verified source names the exact original digest it was read in.
    assert_eq!(
        citations[0].sources[0].original_sha256.as_deref(),
        Some("a".repeat(64).as_str())
    );
    assert_eq!(citations[6].sources[0].original_sha256, None);
    // One trusted locate run per original, deduplicating repeated locators.
    let calls = reader.locate_calls.lock().unwrap().clone();
    assert_eq!(
        calls,
        vec![
            ("email".into(), 1),
            ("trial-balance".into(), 1),
            ("zip-bomb".into(), 1)
        ]
    );
}

#[test]
fn a_fence_ends_verification_but_a_failed_read_is_only_unreadable() {
    let mut fenced = reader();
    fenced.fence = true;
    let cited = answer(vec![(
        "Claim.",
        vec![source("trial-balance", "cell:Sheet1!B4", "1,250.00")],
    )]);
    assert_eq!(
        run(verify(&fenced, &basis(), &cited, &ModelCancellation::new())),
        Err(ReadingError::Fenced)
    );
    // A scanned page with no text layer and no native read is not found there.
    let mut unread = reader();
    unread
        .pages
        .get_mut(&("scan".into(), 3))
        .unwrap()
        .read_natively = false;
    let page = answer(vec![(
        "Claim.",
        vec![source("scan", "page:3", "Signed by A. Auditor")],
    )]);
    assert_eq!(
        reasons(&run(verify(&unread, &basis(), &page, &ModelCancellation::new())).unwrap()),
        vec![vec![Some(R::NotFoundAtLocation)]]
    );
    // An invalid answer is refused before any read.
    let invalid = answer(vec![("", vec![])]);
    assert_eq!(
        run(verify(
            &reader(),
            &basis(),
            &invalid,
            &ModelCancellation::new()
        )),
        Err(ReadingError::Invalid)
    );
}

#[test]
fn transient_reads_end_verification_and_a_wrong_location_kind_is_not_found() {
    // Capacity or unavailability is not a fact about the source: nothing is
    // decided, so nothing is recorded and verification runs again later.
    for error in [ReadingError::Capacity, ReadingError::Unavailable] {
        let mut busy = reader();
        busy.transient = Some(error);
        for cited in [
            answer(vec![(
                "Claim.",
                vec![source("trial-balance", "cell:Sheet1!B4", "1,250.00")],
            )]),
            answer(vec![(
                "Claim.",
                vec![source("contract-pdf", "page:2", "Payment")],
            )]),
        ] {
            assert_eq!(
                run(verify(&busy, &basis(), &cited, &ModelCancellation::new())),
                Err(error)
            );
        }
    }
    // A cell locator into a document that has no cells: not at that location.
    let mut wrong = reader();
    wrong.unsupported.push("contract-pdf".into());
    let cited = answer(vec![(
        "Claim.",
        vec![source("contract-pdf", "cell:Sheet1!A1", "x")],
    )]);
    assert_eq!(
        reasons(&run(verify(&wrong, &basis(), &cited, &ModelCancellation::new())).unwrap()),
        vec![vec![Some(R::NotFoundAtLocation)]]
    );
}
