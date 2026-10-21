use super::*;
use crate::{analysis::tests::run, citation::CitedOriginal, model::ModelCancellation};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use zobba_domain::{
    citation::{CitationSource, Located, Locator, PageFacts},
    exception::ExceptionDispositionKind,
    task::ClaimBasis,
};

const TEXT: &str = "Invoices above 1,000.00 USD require an approver.";

struct Store {
    target: Option<ExceptionTarget>,
    saved: Mutex<Vec<ExceptionDispositionRecord>>,
    revoked: AtomicBool,
}
impl ExceptionDispositionStore for Store {
    async fn exception_disposition_by_key(
        &self,
        actor: &str,
        _: &Scope,
        session: &str,
        key: &str,
    ) -> Result<Option<ExceptionDispositionRecord>, ExceptionDispositionError> {
        assert_eq!(session, "session-hash", "a replay is bound to the session");
        if self.revoked.load(Ordering::SeqCst) {
            return Err(ExceptionDispositionError::Denied);
        }
        Ok(self
            .saved
            .lock()
            .unwrap()
            .iter()
            .find(|d| d.actor_id == actor && d.request.key == key)
            .cloned())
    }
    async fn exception_target(
        &self,
        _: &str,
        _: &Scope,
        _: &str,
        exception_id: &str,
    ) -> Result<Option<ExceptionTarget>, ExceptionDispositionError> {
        Ok(self
            .target
            .clone()
            .filter(|t| t.exception_id == exception_id))
    }
    async fn record_exception_disposition(
        &self,
        _: &str,
        _: &Scope,
        session: &str,
        record: &ExceptionDispositionRecord,
    ) -> Result<ExceptionDispositionRecord, ExceptionDispositionError> {
        assert_eq!(session, "session-hash");
        self.saved.lock().unwrap().push(record.clone());
        Ok(record.clone())
    }
}

/// A reader over one plain-text original, "ap-policy".
struct Reader;
impl CitationReader for Reader {
    async fn original(
        &self,
        _: &ClaimBasis,
        id: &str,
    ) -> Result<Option<CitedOriginal>, ReadingError> {
        Ok((id == "ap-policy").then(|| CitedOriginal {
            id: id.into(),
            sha256: "a".repeat(64),
        }))
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
        _: &ClaimBasis,
        _: &CitedOriginal,
        locators: &[Locator],
        _: &ModelCancellation,
    ) -> Result<Vec<Located>, ReadingError> {
        Ok(locators.iter().map(|_| Located::Unreadable).collect())
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
fn exception() -> String {
    format!("exc-{}", "3".repeat(40))
}
fn store(status: ExceptionStatus, may_close: bool) -> Store {
    Store {
        target: Some(ExceptionTarget {
            exception_id: exception(),
            task_id: "task-1".into(),
            status,
            may_close,
        }),
        saved: Mutex::default(),
        revoked: AtomicBool::new(false),
    }
}
fn reference(quote: &str) -> CitationSource {
    CitationSource {
        original_id: "ap-policy".into(),
        locator: Locator::parse("bytes:0-48"),
        quote: quote.into(),
    }
}
fn request(kind: ExceptionDispositionKind) -> ExceptionDispositionRequest {
    ExceptionDispositionRequest {
        key: "key-1".into(),
        exception_id: exception(),
        kind,
        rationale: "The approver confirmed in writing after the review.".into(),
        references: vec![reference(TEXT)],
    }
}
fn save(
    store: &Store,
    request: &ExceptionDispositionRequest,
) -> Result<ExceptionDispositionRecord, ExceptionDispositionError> {
    run(save_exception_disposition(
        store,
        &Reader,
        "manager-3",
        &scope(),
        "session-hash",
        "task-1",
        request,
    ))
}

#[test]
fn a_verified_closure_names_its_person_exception_and_references() {
    let store = store(ExceptionStatus::Open, true);
    let saved = save(&store, &request(ExceptionDispositionKind::Closed)).unwrap();
    assert_eq!(saved.actor_id, "manager-3");
    assert_eq!(saved.request.exception_id, exception());
    assert_eq!(saved.references, vec![(reference(TEXT), "a".repeat(64))]);
    assert_eq!(saved.id, exception_disposition_id("manager-3", "key-1"));
    assert!(saved.id.starts_with("xdisp-") && saved.id.len() == 46);
    assert_eq!(
        saved.digest,
        crate::assessment::document_digest(&saved.document())
    );
}

#[test]
fn a_closure_without_evidence_is_invalid_and_nothing_is_saved() {
    let store = store(ExceptionStatus::Open, true);
    let mut closure = request(ExceptionDispositionKind::Closed);
    closure.references.clear();
    assert_eq!(
        save(&store, &closure),
        Err(ExceptionDispositionError::Invalid)
    );
    assert!(store.saved.lock().unwrap().is_empty());
}

#[test]
fn a_reopening_may_cite_no_evidence() {
    let store = store(ExceptionStatus::ClosedByDisposition, true);
    let mut reopening = request(ExceptionDispositionKind::Reopened);
    reopening.references.clear();
    assert!(save(&store, &reopening).is_ok());
}

#[test]
fn only_an_audit_manager_or_the_accountable_person_disposes() {
    let store = store(ExceptionStatus::Open, false);
    assert_eq!(
        save(&store, &request(ExceptionDispositionKind::Closed)),
        Err(ExceptionDispositionError::NotAuthorised)
    );
    assert_eq!(
        ExceptionDispositionError::NotAuthorised.code(),
        "exception_close_forbidden"
    );
    assert!(store.saved.lock().unwrap().is_empty());
}

#[test]
fn a_closed_exception_is_not_closed_again() {
    let store = store(ExceptionStatus::ClosedByDisposition, true);
    assert_eq!(
        save(&store, &request(ExceptionDispositionKind::Closed)),
        Err(ExceptionDispositionError::AlreadyClosed)
    );
}

#[test]
fn only_a_closed_exception_is_reopened() {
    for status in [
        ExceptionStatus::Open,
        ExceptionStatus::ResolvedByEvidence,
        ExceptionStatus::ReplacedByHumanJudgment,
    ] {
        let store = store(status, true);
        assert_eq!(
            save(&store, &request(ExceptionDispositionKind::Reopened)),
            Err(ExceptionDispositionError::NotClosed),
            "{status:?}"
        );
    }
}

#[test]
fn a_resolved_or_replaced_exception_may_still_be_closed() {
    for status in [
        ExceptionStatus::ResolvedByEvidence,
        ExceptionStatus::ReplacedByHumanJudgment,
    ] {
        let store = store(status, true);
        assert!(
            save(&store, &request(ExceptionDispositionKind::Closed)).is_ok(),
            "{status:?}"
        );
    }
}

#[test]
fn an_unverified_reference_refuses_the_whole_request_and_names_it() {
    let store = store(ExceptionStatus::Open, true);
    let mut closure = request(ExceptionDispositionKind::Closed);
    closure
        .references
        .push(reference("This sentence is not in the policy."));
    assert_eq!(
        save(&store, &closure),
        Err(ExceptionDispositionError::ReferenceUnverified(1))
    );
    // A quote that is not at its location is refused too.
    let mut partial = request(ExceptionDispositionKind::Closed);
    partial.references = vec![CitationSource {
        locator: Locator::parse("bytes:0-8"),
        ..reference("an approver.")
    }];
    assert_eq!(
        save(&store, &partial),
        Err(ExceptionDispositionError::ReferenceUnverified(0))
    );
    assert!(store.saved.lock().unwrap().is_empty());
}

#[test]
fn an_unknown_exception_is_not_found() {
    let store = store(ExceptionStatus::Open, true);
    let mut other = request(ExceptionDispositionKind::Closed);
    other.exception_id = format!("exc-{}", "4".repeat(40));
    assert_eq!(
        save(&store, &other),
        Err(ExceptionDispositionError::NotFound)
    );
}

#[test]
fn an_exact_replay_returns_the_original_and_a_changed_one_conflicts() {
    let store = store(ExceptionStatus::Open, true);
    let first = save(&store, &request(ExceptionDispositionKind::Closed)).unwrap();
    assert_eq!(
        save(&store, &request(ExceptionDispositionKind::Closed)),
        Ok(first)
    );
    let mut changed = request(ExceptionDispositionKind::Closed);
    changed.rationale = "Another reason.".into();
    assert_eq!(
        save(&store, &changed),
        Err(ExceptionDispositionError::Conflict)
    );
    assert_eq!(store.saved.lock().unwrap().len(), 1);
}

#[test]
fn a_replay_rechecks_authority() {
    let store = store(ExceptionStatus::Open, true);
    save(&store, &request(ExceptionDispositionKind::Closed)).unwrap();
    store.revoked.store(true, Ordering::SeqCst);
    assert_eq!(
        save(&store, &request(ExceptionDispositionKind::Closed)),
        Err(ExceptionDispositionError::Denied)
    );
}

#[test]
fn a_malformed_request_is_invalid_before_any_read() {
    let store = Store {
        target: None,
        saved: Mutex::default(),
        revoked: AtomicBool::new(false),
    };
    let mut bad = request(ExceptionDispositionKind::Closed);
    bad.exception_id = "exc-not-an-id".into();
    assert_eq!(save(&store, &bad), Err(ExceptionDispositionError::Invalid));
    let mut blank = request(ExceptionDispositionKind::Closed);
    blank.rationale = "  ".into();
    assert_eq!(
        save(&store, &blank),
        Err(ExceptionDispositionError::Invalid)
    );
}
