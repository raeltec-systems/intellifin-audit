//! Story 24.3b: a person's disposition of one exception.
//!
//! Only a person disposes of an exception, through the authenticated API: a
//! currently assigned Auditor or Audit manager in their own session, who is
//! also an Audit manager of the organisation or the Task's accountable
//! person. `closed` cites at least one evidence reference, each verified at
//! write time like a 24.3a disposition; `reopened` reopens a closed
//! exception. Neither changes an occurrence, a revision or a verdict, and no
//! failing count ever drops because of one. There are no waivers.
use std::future::Future;

use crate::{
    assessment::exception::ExceptionDispositionRecord,
    citation::{CitationReader, ReadingError},
    disposition::{DispositionError, verified_references},
};
use zobba_domain::{
    exception::{ExceptionDispositionRequest, ExceptionRefusal, ExceptionStatus},
    identity::Scope,
    work::sha256_hex,
};

/// Why an exception disposition was not saved.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExceptionDispositionError {
    /// The request is malformed, or a closure cites no evidence.
    Invalid,
    /// `closed` on an exception that is already closed (409).
    AlreadyClosed,
    /// `reopened` on an exception that is not closed (409).
    NotClosed,
    /// The reference at this 0-based index is not verified (409).
    ReferenceUnverified(usize),
    /// No such exception of this Task.
    NotFound,
    /// The actor may not read or act here (403).
    Denied,
    /// An assigned Auditor who is neither an Audit manager nor the Task's
    /// accountable person (403 `exception_close_forbidden`).
    NotAuthorised,
    /// The request key was used for a different request (409).
    Conflict,
    /// The exception already holds the most dispositions it may hold.
    Capacity,
    Unavailable,
}
impl ExceptionDispositionError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Invalid => "exception_disposition_invalid",
            Self::AlreadyClosed => "exception_already_closed",
            Self::NotClosed => "exception_not_closed",
            Self::ReferenceUnverified(_) => "reference_unverified",
            Self::NotFound => "exception_not_found",
            Self::Denied => "access_denied",
            Self::NotAuthorised => "exception_close_forbidden",
            Self::Conflict => "exception_disposition_conflict",
            Self::Capacity => "exception_disposition_capacity",
            Self::Unavailable => "exception_disposition_unavailable",
        }
    }
}
impl From<ReadingError> for ExceptionDispositionError {
    fn from(error: ReadingError) -> Self {
        match error {
            ReadingError::Denied | ReadingError::Fenced => Self::Denied,
            ReadingError::Invalid => Self::Invalid,
            ReadingError::Capacity => Self::Capacity,
            ReadingError::Unavailable => Self::Unavailable,
        }
    }
}
impl From<DispositionError> for ExceptionDispositionError {
    fn from(error: DispositionError) -> Self {
        match error {
            DispositionError::ReferenceUnverified(i) => Self::ReferenceUnverified(i),
            DispositionError::Denied => Self::Denied,
            DispositionError::Capacity => Self::Capacity,
            DispositionError::Invalid => Self::Invalid,
            _ => Self::Unavailable,
        }
    }
}

/// The exception a disposition names, as the person may act on it now.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExceptionTarget {
    pub exception_id: String,
    pub task_id: String,
    /// Its derived status, read in the person's scope.
    pub status: ExceptionStatus,
    /// The actor is an Audit manager or the Task's accountable person.
    pub may_close: bool,
}

/// Durable exception dispositions under the person's current authority.
pub trait ExceptionDispositionStore: Send + Sync {
    /// The disposition this actor saved under this key, after the exact
    /// session, assignment and closing authority are checked again (a
    /// replay is never answered for an actor who may not dispose now).
    fn exception_disposition_by_key(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        key: &str,
    ) -> impl Future<Output = Result<Option<ExceptionDispositionRecord>, ExceptionDispositionError>> + Send;
    /// The exception of this Task with this exact ID.
    fn exception_target(
        &self,
        actor: &str,
        scope: &Scope,
        task_id: &str,
        exception_id: &str,
    ) -> impl Future<Output = Result<Option<ExceptionTarget>, ExceptionDispositionError>> + Send;
    /// Write one disposition; the database checks session, assignment,
    /// closing authority and the exception's status again in the write.
    fn record_exception_disposition(
        &self,
        actor: &str,
        scope: &Scope,
        session_hash: &str,
        record: &ExceptionDispositionRecord,
    ) -> impl Future<Output = Result<ExceptionDispositionRecord, ExceptionDispositionError>> + Send;
}

/// The exception disposition ID: one per actor and request key.
pub fn exception_disposition_id(actor: &str, key: &str) -> String {
    let digest = sha256_hex(format!("xdisp\0{actor}\0{key}").as_bytes());
    format!("xdisp-{}", &digest[..40])
}

/// Check, verify and save one exception disposition. An exact retry of the
/// same key returns the original (authority checked again); the same key
/// with a different request is refused.
pub async fn save_exception_disposition<D: ExceptionDispositionStore, C: CitationReader>(
    store: &D,
    reader: &C,
    actor: &str,
    scope: &Scope,
    session_hash: &str,
    task_id: &str,
    request: &ExceptionDispositionRequest,
) -> Result<ExceptionDispositionRecord, ExceptionDispositionError> {
    if !request.is_valid() || !zobba_domain::identity::valid_scope_id(task_id) {
        return Err(ExceptionDispositionError::Invalid);
    }
    if let Some(found) = store
        .exception_disposition_by_key(actor, scope, session_hash, &request.key)
        .await?
    {
        return if found.request == *request && found.task_id == task_id {
            Ok(found)
        } else {
            Err(ExceptionDispositionError::Conflict)
        };
    }
    let target = store
        .exception_target(actor, scope, task_id, &request.exception_id)
        .await?
        .ok_or(ExceptionDispositionError::NotFound)?;
    if !target.may_close {
        return Err(ExceptionDispositionError::NotAuthorised);
    }
    request
        .check(target.status)
        .map_err(|refusal| match refusal {
            ExceptionRefusal::Invalid => ExceptionDispositionError::Invalid,
            ExceptionRefusal::AlreadyClosed => ExceptionDispositionError::AlreadyClosed,
            ExceptionRefusal::NotClosed => ExceptionDispositionError::NotClosed,
        })?;
    let references =
        verified_references(reader, actor, scope, task_id, &request.references).await?;
    let mut record = ExceptionDispositionRecord {
        id: exception_disposition_id(actor, &request.key),
        task_id: task_id.into(),
        actor_id: actor.into(),
        request: request.clone(),
        references,
        digest: String::new(),
        recorded_us: None,
    };
    record.digest = crate::assessment::document_digest(&record.document());
    store
        .record_exception_disposition(actor, scope, session_hash, &record)
        .await
}

#[cfg(test)]
mod tests;
