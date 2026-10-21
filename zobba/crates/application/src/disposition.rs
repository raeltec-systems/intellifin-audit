//! Story 24.3a: a person's disposition of one exact evaluation revision.
//!
//! Only a person saves a disposition, through the authenticated API: an
//! assigned Auditor or Audit manager of the engagement (Admin alone is
//! refused). It names the exact revision (the 24.1 evaluation or a revision
//! row) and never changes it. A disposition on a revision that is no longer
//! the head of its chain is refused and names the current head. Each
//! evidence reference is verified at write time by the 22.5 verifier
//! (`crate::citation::verify`); an unverified one refuses the whole request.
//! A rule (deterministic) verdict is never replaced: to change it, correct
//! the facts or the criterion. There is no numeric confidence anywhere.
use std::future::Future;

use crate::{
    assessment::{revision::DispositionRecord, verify_sources},
    citation::{CitationReader, CitedOriginal, ReadingError},
    evidence::{EvidenceMetadata, EvidenceObjects, capture_range, read_original},
    model::ModelCancellation,
};
use zobba_domain::{
    assessment::{Origin, whole_value},
    citation::{CitationSource, Located, Locator, LocatorFamily, Verification},
    identity::Scope,
    revision::{DispositionRefusal, DispositionRequest},
    task::ClaimBasis,
    work::sha256_hex,
};

/// Why a disposition was not saved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispositionError {
    /// The request is malformed.
    Invalid,
    /// `replaced` on a deterministic revision (400 `not_replaceable`).
    NotReplaceable,
    /// `replaced` with met or not_met on a head that cannot yield one: not
    /// applicable, failed, or its authority unverified (400
    /// `verdict_not_decidable`).
    NotDecidable,
    /// The reference at this 0-based index is not verified (409).
    ReferenceUnverified(usize),
    /// The revision is not the head of its chain (409); names the head.
    RevisionSuperseded(String),
    /// No such revision of this Task.
    NotFound,
    /// The actor may not dispose here (403); nothing is recorded.
    Denied,
    /// The request key was used for a different request (409).
    Conflict,
    /// The revision already holds the most dispositions it may hold.
    Capacity,
    Unavailable,
}
impl DispositionError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Invalid => "disposition_invalid",
            Self::NotReplaceable => "not_replaceable",
            Self::NotDecidable => "verdict_not_decidable",
            Self::ReferenceUnverified(_) => "reference_unverified",
            Self::RevisionSuperseded(_) => "revision_superseded",
            Self::NotFound => "revision_not_found",
            Self::Denied => "access_denied",
            Self::Conflict => "disposition_conflict",
            Self::Capacity => "disposition_capacity",
            Self::Unavailable => "disposition_unavailable",
        }
    }
}
impl From<ReadingError> for DispositionError {
    fn from(error: ReadingError) -> Self {
        match error {
            ReadingError::Denied | ReadingError::Fenced => Self::Denied,
            ReadingError::Invalid => Self::Invalid,
            ReadingError::Capacity => Self::Capacity,
            ReadingError::Unavailable => Self::Unavailable,
        }
    }
}

/// The exact revision a disposition names, and the current head of its chain.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RevisionTarget {
    pub chain_id: String,
    pub revision: u32,
    pub origin: Origin,
    pub head_id: String,
    pub head_revision: u32,
    /// The revision may yield met or not_met: applicable, completed and its
    /// criterion's authority verified.
    pub decidable: bool,
}

/// Durable dispositions under the person's current authority.
pub trait DispositionStore: Send + Sync {
    /// The disposition this actor saved under this key, if any, after the
    /// exact session, role and assignment are checked again (a replay is
    /// never answered for an actor who may not dispose now).
    fn disposition_by_key(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        key: &str,
    ) -> impl Future<Output = Result<Option<DispositionRecord>, DispositionError>> + Send;
    /// The revision of this Task with this exact ID and its chain's head.
    fn revision_target(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        revision_id: &str,
    ) -> impl Future<Output = Result<Option<RevisionTarget>, DispositionError>> + Send;
    /// Write one disposition, rechecking the exact session, the role and the
    /// assignment, and that the revision is still the head, inside the write
    /// transaction. A `needs_reconsideration` disposition wakes the Task.
    fn record_disposition(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        record: &DispositionRecord,
    ) -> impl Future<Output = Result<DispositionRecord, DispositionError>> + Send;
    /// Quotes trusted code already verified at exactly this location of
    /// exactly this original, in this engagement (fact and answer sources).
    fn verified_quotes(
        &self,
        actor: &str,
        scope: &Scope,
        original_id: &str,
        sha256: &str,
        locator: &Locator,
    ) -> impl Future<Output = Result<Vec<String>, ReadingError>> + Send;
}

/// The person's verification reader: an original they may read now, plain
/// text byte ranges read from its exact bytes, and structured locations
/// (cells, paragraphs, email parts) confirmed against the text trusted code
/// already read there (originals are immutable and named by digest). A page
/// alone is never verified here.
pub struct PersonReader<'a, M, O, D> {
    pub metadata: &'a M,
    pub objects: Option<&'a O>,
    pub store: &'a D,
}

impl<M: EvidenceMetadata, O: EvidenceObjects, D: DispositionStore> PersonReader<'_, M, O, D> {
    async fn bytes(&self, basis: &ClaimBasis, id: &str) -> Result<Option<Vec<u8>>, ReadingError> {
        let Some(objects) = self.objects else {
            return Ok(None);
        };
        match read_original(self.metadata, objects, &basis.actor_id, &basis.scope, id).await {
            Ok((_, bytes)) => Ok(Some(bytes)),
            Err(_) => Ok(None),
        }
    }
}

impl<M: EvidenceMetadata, O: EvidenceObjects, D: DispositionStore> CitationReader
    for PersonReader<'_, M, O, D>
{
    async fn original(
        &self,
        basis: &ClaimBasis,
        id: &str,
    ) -> Result<Option<CitedOriginal>, ReadingError> {
        match self
            .metadata
            .inspect(&basis.actor_id, &basis.scope, id)
            .await
        {
            Ok(stored) => Ok(Some(CitedOriginal {
                id: id.into(),
                sha256: stored.evidence.reservation.request.identity.sha256.clone(),
            })),
            Err(_) => Ok(None),
        }
    }
    async fn byte_range(
        &self,
        basis: &ClaimBasis,
        original: &CitedOriginal,
        start: u64,
        end: u64,
    ) -> Result<Located, ReadingError> {
        let Some(bytes) = self.bytes(basis, &original.id).await? else {
            return Ok(Located::Unreadable);
        };
        if sha256_hex(&bytes) != original.sha256 {
            return Ok(Located::Unreadable);
        }
        Ok(match capture_range(&bytes, start, end) {
            Ok(excerpt) => Located::Found(vec![excerpt.text]),
            Err(_) => Located::Missing,
        })
    }
    async fn byte_context(
        &self,
        basis: &ClaimBasis,
        original: &CitedOriginal,
        start: u64,
        end: u64,
    ) -> Result<Option<String>, ReadingError> {
        let Some(bytes) = self.bytes(basis, &original.id).await? else {
            return Ok(None);
        };
        Ok(crate::citation::widened(
            &bytes,
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
        for locator in locators {
            let quotes = self
                .store
                .verified_quotes(
                    &basis.actor_id,
                    &basis.scope,
                    &original.id,
                    &original.sha256,
                    locator,
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
    ) -> Result<Option<zobba_domain::citation::PageFacts>, ReadingError> {
        Ok(None)
    }
}

/// The disposition record ID: one per actor and request key.
pub fn disposition_id(actor: &str, key: &str) -> String {
    let digest = sha256_hex(format!("disp\0{actor}\0{key}").as_bytes());
    format!("disp-{}", &digest[..40])
}

/// Verify each reference at write time. A page alone, an original the
/// person cannot read now, a quote not at its location, or a quote that is
/// only part of the value there (`2,500.00` inside `12,500.00`: the 24.1
/// whole-value rule) refuses the whole request, naming the first such
/// reference.
pub async fn verified_references<C: CitationReader>(
    reader: &C,
    actor: &str,
    scope: &Scope,
    task_id: &str,
    requested: &[CitationSource],
) -> Result<Vec<(CitationSource, String)>, DispositionError> {
    let mut references: Vec<(CitationSource, String)> = Vec::new();
    if requested.is_empty() {
        return Ok(references);
    }
    let basis = ClaimBasis {
        actor_id: actor.into(),
        scope: scope.clone(),
        task_id: task_id.into(),
        cycle_id: String::new(),
        claim_id: String::new(),
        worker_id: String::new(),
        process_instance: String::new(),
        owner_epoch: 0,
        execution_epoch: 0,
        intent_revision: 0,
    };
    let cancellation = ModelCancellation::default();
    let verified = verify_sources(reader, &basis, requested, &cancellation)
        .await
        .map_err(DispositionError::from)?;
    for (index, (source, texts)) in verified.into_iter().enumerate() {
        let page_only = source
            .source
            .locator
            .as_ref()
            .is_some_and(|l| l.family() == LocatorFamily::Page);
        let whole = source
            .source
            .locator
            .as_ref()
            .is_some_and(|l| whole_value(l, &texts, &source.source.quote));
        match (
            source.verification,
            source.original_sha256,
            page_only,
            whole,
        ) {
            (Verification::Verified, Some(sha), false, true) => {
                references.push((source.source, sha))
            }
            _ => return Err(DispositionError::ReferenceUnverified(index)),
        }
    }
    Ok(references)
}

/// Check, verify and save one disposition. An exact retry of the same key
/// returns the original; the same key with a different request is refused.
pub async fn save_disposition<D: DispositionStore, C: CitationReader>(
    store: &D,
    reader: &C,
    actor: &str,
    scope: &Scope,
    session_hash: &str,
    task_id: &str,
    request: &DispositionRequest,
) -> Result<DispositionRecord, DispositionError> {
    if !request.is_valid() || !zobba_domain::identity::valid_scope_id(task_id) {
        return Err(DispositionError::Invalid);
    }
    if let Some(found) = store
        .disposition_by_key(actor, scope, session_hash, &request.key)
        .await?
    {
        return if found.request == *request && found.task_id == task_id {
            Ok(found)
        } else {
            Err(DispositionError::Conflict)
        };
    }
    let target = store
        .revision_target(actor, scope, task_id, &request.revision_id)
        .await?
        .ok_or(DispositionError::NotFound)?;
    if target.revision != target.head_revision {
        return Err(DispositionError::RevisionSuperseded(target.head_id));
    }
    request
        .check(target.origin, target.decidable)
        .map_err(|refusal| match refusal {
            DispositionRefusal::Invalid => DispositionError::Invalid,
            DispositionRefusal::NotReplaceable => DispositionError::NotReplaceable,
            DispositionRefusal::NotDecidable => DispositionError::NotDecidable,
        })?;
    let references =
        verified_references(reader, actor, scope, task_id, &request.references).await?;
    let mut record = DispositionRecord {
        id: disposition_id(actor, &request.key),
        task_id: task_id.into(),
        actor_id: actor.into(),
        chain_id: target.chain_id,
        revision: target.revision,
        request: request.clone(),
        references,
        digest: String::new(),
        recorded_us: None,
    };
    record.digest = crate::assessment::document_digest(&record.document());
    store
        .record_disposition(actor, scope, session_hash, &record)
        .await
}

#[cfg(test)]
mod tests;
