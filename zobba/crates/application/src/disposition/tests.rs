use super::*;
use crate::analysis::tests::run;
use std::sync::Mutex;
use zobba_domain::{
    assessment::Verdict,
    citation::PageFacts,
    revision::{Concern, DispositionKind},
};

const TEXT: &str = "Invoices above 1,000.00 USD require an approver.";

#[derive(Default)]
struct Store {
    target: Option<RevisionTarget>,
    saved: Mutex<Vec<DispositionRecord>>,
    verified: Vec<(String, String)>,
    /// The actor may no longer dispose (the fence refuses, replays included).
    revoked: std::sync::atomic::AtomicBool,
}
impl DispositionStore for Store {
    async fn disposition_by_key(
        &self,
        actor: &str,
        _: &Scope,
        session: &str,
        key: &str,
    ) -> Result<Option<DispositionRecord>, DispositionError> {
        assert_eq!(session, "session-hash", "a replay is bound to the session");
        if self.revoked.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(DispositionError::Denied);
        }
        Ok(self
            .saved
            .lock()
            .unwrap()
            .iter()
            .find(|d| d.actor_id == actor && d.request.key == key)
            .cloned())
    }
    async fn revision_target(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        revision_id: &str,
    ) -> Result<Option<RevisionTarget>, DispositionError> {
        Ok(self
            .target
            .clone()
            .filter(|t| t.head_id == revision_id || revision_id.starts_with("eval-")))
    }
    async fn record_disposition(
        &self,
        _: &str,
        _: &Scope,
        session: &str,
        record: &DispositionRecord,
    ) -> Result<DispositionRecord, DispositionError> {
        assert_eq!(session, "session-hash");
        self.saved.lock().unwrap().push(record.clone());
        Ok(record.clone())
    }
    async fn verified_quotes(
        &self,
        _: &str,
        _: &Scope,
        original_id: &str,
        _: &str,
        locator: &Locator,
    ) -> Result<Vec<String>, ReadingError> {
        Ok(self
            .verified
            .iter()
            .filter(|(id, _)| id == original_id)
            .filter(|_| locator.render() == "cell:Sheet1!D2")
            .map(|(_, q)| q.clone())
            .collect())
    }
}

/// A reader over one plain-text original ("ap-policy") and the store's
/// previously verified cells of "ap-invoices".
struct Reader<'a>(&'a Store);
impl CitationReader for Reader<'_> {
    async fn original(
        &self,
        _: &ClaimBasis,
        id: &str,
    ) -> Result<Option<CitedOriginal>, ReadingError> {
        Ok(
            matches!(id, "ap-policy" | "ap-invoices").then(|| CitedOriginal {
                id: id.into(),
                sha256: "a".repeat(64),
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
        Ok(TEXT
            .get(start as usize..end as usize)
            .map_or(Located::Missing, |t| Located::Found(vec![t.into()])))
    }
    async fn byte_context(
        &self,
        _: &ClaimBasis,
        _: &CitedOriginal,
        start: u64,
        end: u64,
    ) -> Result<Option<String>, ReadingError> {
        Ok(crate::citation::widened(
            TEXT.as_bytes(),
            start as usize,
            end as usize,
        ))
    }
    async fn locate(
        &self,
        basis: &ClaimBasis,
        original: &CitedOriginal,
        locators: &[Locator],
        _: &ModelCancellation,
    ) -> Result<Vec<Located>, ReadingError> {
        let mut out = Vec::new();
        for l in locators {
            let quotes = self
                .0
                .verified_quotes(
                    &basis.actor_id,
                    &basis.scope,
                    &original.id,
                    &original.sha256,
                    l,
                )
                .await?;
            out.push(if quotes.is_empty() {
                Located::Unreadable
            } else {
                Located::Found(quotes)
            });
        }
        Ok(out)
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

fn scope() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}
fn chain() -> String {
    format!("eval-{}", "1".repeat(40))
}
fn head() -> String {
    format!("rev-{}", "2".repeat(40))
}
fn store(origin: Origin, revision: u32, head_revision: u32) -> Store {
    Store {
        target: Some(RevisionTarget {
            chain_id: chain(),
            revision,
            origin,
            head_id: if head_revision == 1 { chain() } else { head() },
            head_revision,
            decidable: true,
        }),
        verified: vec![("ap-invoices".into(), "J. Smith".into())],
        ..Store::default()
    }
}
fn request(kind: DispositionKind) -> DispositionRequest {
    DispositionRequest {
        key: "key-1".into(),
        revision_id: chain(),
        kind,
        concern: (kind == DispositionKind::NeedsReconsideration).then_some(Concern::Rule),
        verdict: (kind == DispositionKind::Replaced).then_some(Verdict::NotMet),
        rationale: "The approver signed after payment.".into(),
        references: vec![CitationSource {
            original_id: "ap-policy".into(),
            locator: Locator::parse("bytes:0-48"),
            quote: TEXT.into(),
        }],
    }
}
fn save(
    store: &Store,
    request: &DispositionRequest,
) -> Result<DispositionRecord, DispositionError> {
    run(save_disposition(
        store,
        &Reader(store),
        "auditor-7",
        &scope(),
        "session-hash",
        "task-1",
        request,
    ))
}

#[test]
fn a_verified_disposition_names_its_actor_revision_and_references() {
    let store = store(Origin::ModelProposal, 1, 1);
    let saved = save(&store, &request(DispositionKind::Replaced)).unwrap();
    assert_eq!(saved.actor_id, "auditor-7");
    assert_eq!(
        (saved.chain_id.as_str(), saved.revision),
        (chain().as_str(), 1)
    );
    assert_eq!(saved.request.revision_id, chain());
    assert_eq!(saved.references.len(), 1);
    assert_eq!(
        saved.references[0].1,
        "a".repeat(64),
        "the exact original digest"
    );
    assert_eq!(saved.id, disposition_id("auditor-7", "key-1"));
    assert_eq!(
        saved.digest,
        crate::assessment::document_digest(&saved.document())
    );
}

#[test]
fn an_exact_retry_returns_the_original_and_a_changed_one_conflicts() {
    let store = store(Origin::ModelProposal, 1, 1);
    let first = save(&store, &request(DispositionKind::Accepted)).unwrap();
    assert_eq!(save(&store, &request(DispositionKind::Accepted)), Ok(first));
    let mut changed = request(DispositionKind::Accepted);
    changed.rationale = "Another reason.".into();
    assert_eq!(save(&store, &changed), Err(DispositionError::Conflict));
    assert_eq!(store.saved.lock().unwrap().len(), 1);
}

#[test]
fn a_rule_verdict_is_never_replaced() {
    let store = store(Origin::Deterministic, 1, 1);
    assert_eq!(
        save(&store, &request(DispositionKind::Replaced)),
        Err(DispositionError::NotReplaceable)
    );
    assert!(store.saved.lock().unwrap().is_empty());
    // A person may still accept it or ask for reconsideration.
    let mut accepted = request(DispositionKind::NeedsReconsideration);
    accepted.key = "key-2".into();
    assert!(save(&store, &accepted).is_ok());
}

#[test]
fn a_superseded_revision_is_refused_and_names_the_head() {
    let store = store(Origin::ModelProposal, 1, 2);
    assert_eq!(
        save(&store, &request(DispositionKind::Accepted)),
        Err(DispositionError::RevisionSuperseded(head()))
    );
    assert!(store.saved.lock().unwrap().is_empty());
}

#[test]
fn an_unknown_revision_is_not_found() {
    let store = Store::default();
    assert_eq!(
        save(&store, &request(DispositionKind::Accepted)),
        Err(DispositionError::NotFound)
    );
}

#[test]
fn one_unverified_reference_refuses_the_whole_request_and_names_its_index() {
    let store = store(Origin::ModelProposal, 1, 1);
    let mut r = request(DispositionKind::Accepted);
    r.references.push(CitationSource {
        original_id: "ap-policy".into(),
        locator: Locator::parse("bytes:0-8"),
        quote: "Approved".into(),
    });
    assert_eq!(
        save(&store, &r),
        Err(DispositionError::ReferenceUnverified(1))
    );
    assert!(store.saved.lock().unwrap().is_empty(), "nothing written");
}

#[test]
fn a_reference_to_a_cell_is_verified_against_text_trusted_code_read_there() {
    let store = store(Origin::ModelProposal, 1, 1);
    let mut r = request(DispositionKind::Accepted);
    r.references = vec![CitationSource {
        original_id: "ap-invoices".into(),
        locator: Locator::parse("cell:Sheet1!D2"),
        quote: "J. Smith".into(),
    }];
    assert!(save(&store, &r).is_ok());
    let mut r = request(DispositionKind::Accepted);
    r.key = "key-2".into();
    r.references = vec![CitationSource {
        original_id: "ap-invoices".into(),
        locator: Locator::parse("cell:Sheet1!D3"),
        quote: "J. Smith".into(),
    }];
    assert_eq!(
        save(&store, &r),
        Err(DispositionError::ReferenceUnverified(0))
    );
}

#[test]
fn an_original_the_person_cannot_read_and_a_page_alone_are_unverified() {
    let store = store(Origin::ModelProposal, 1, 1);
    let mut r = request(DispositionKind::Accepted);
    r.references[0].original_id = "elsewhere".into();
    assert_eq!(
        save(&store, &r),
        Err(DispositionError::ReferenceUnverified(0))
    );
    let mut r = request(DispositionKind::Accepted);
    r.references = vec![CitationSource {
        original_id: "ap-policy".into(),
        locator: Locator::parse("page:1"),
        quote: TEXT.into(),
    }];
    assert_eq!(
        save(&store, &r),
        Err(DispositionError::ReferenceUnverified(0))
    );
}

#[test]
fn a_malformed_request_is_invalid_before_anything_is_read() {
    let store = store(Origin::ModelProposal, 1, 1);
    let mut r = request(DispositionKind::Accepted);
    r.rationale = "x".repeat(2_001);
    assert_eq!(save(&store, &r), Err(DispositionError::Invalid));
    let mut r = request(DispositionKind::Accepted);
    r.revision_id = "crit-1".into();
    assert_eq!(save(&store, &r), Err(DispositionError::Invalid));
}

#[test]
fn an_exact_replay_is_answered_only_after_authority_is_rechecked() {
    let store = store(Origin::ModelProposal, 1, 1);
    let first = save(&store, &request(DispositionKind::Accepted)).unwrap();
    store
        .revoked
        .store(true, std::sync::atomic::Ordering::SeqCst);
    // The stored original is never returned to an actor who may not dispose.
    assert_eq!(
        save(&store, &request(DispositionKind::Accepted)),
        Err(DispositionError::Denied)
    );
    store
        .revoked
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(save(&store, &request(DispositionKind::Accepted)), Ok(first));
}

#[test]
fn a_reference_is_a_whole_value_at_its_location() {
    let store = store(Origin::ModelProposal, 1, 1);
    // "nvoices" is verified at its bytes but is part of the word "Invoices":
    // the 24.1 whole-value rule refuses it, like `2,500.00` inside
    // `12,500.00`.
    let mut r = request(DispositionKind::Accepted);
    r.references = vec![CitationSource {
        original_id: "ap-policy".into(),
        locator: Locator::parse("bytes:1-8"),
        quote: "nvoices".into(),
    }];
    assert_eq!(
        save(&store, &r),
        Err(DispositionError::ReferenceUnverified(0))
    );
    // The whole value at the same kind of location is accepted.
    let mut r = request(DispositionKind::Accepted);
    r.key = "key-2".into();
    r.references = vec![CitationSource {
        original_id: "ap-policy".into(),
        locator: Locator::parse("bytes:0-8"),
        quote: "Invoices".into(),
    }];
    assert!(save(&store, &r).is_ok());
    assert_eq!(store.saved.lock().unwrap().len(), 1);
}

#[test]
fn a_persons_met_or_not_met_needs_a_decidable_head() {
    for verdict in [Verdict::Met, Verdict::NotMet] {
        let mut store = store(Origin::ModelProposal, 1, 1);
        store.target.as_mut().unwrap().decidable = false;
        let mut r = request(DispositionKind::Replaced);
        r.verdict = Some(verdict);
        assert_eq!(save(&store, &r), Err(DispositionError::NotDecidable));
        assert!(store.saved.lock().unwrap().is_empty());
        // Undetermined stays possible, and so does accepting.
        r.verdict = Some(Verdict::Undetermined);
        assert!(save(&store, &r).is_ok());
    }
}
