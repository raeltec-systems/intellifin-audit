//! Custody sequencing. No database transaction spans immutable object I/O.
use std::future::Future;
use zobba_domain::{evidence::*, identity::Scope};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvidenceError {
    Denied,
    Invalid,
    Conflict,
    Unavailable,
    Capacity,
    ReservationLimit,
    Integrity,
    TooLarge,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObjectError {
    AlreadyExists,
    Unavailable,
    TooLarge,
    VersionUnavailable,
    Integrity,
    NamespaceMismatch,
    DeadlineExceeded,
}
impl From<ObjectError> for EvidenceError {
    fn from(value: ObjectError) -> Self {
        match value {
            ObjectError::TooLarge => Self::TooLarge,
            ObjectError::Integrity => Self::Integrity,
            _ => Self::Unavailable,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredReservation {
    pub reservation: Reservation,
    pub namespace: String,
    pub registered: Option<RegisteredEvidence>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredEvidence {
    pub evidence: RegisteredEvidence,
    pub namespace: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MeasuredObject {
    pub bytes: Vec<u8>,
    pub identity: ContentIdentity,
}
pub trait EvidenceObjects: Send + Sync {
    fn namespace(&self) -> &str;
    fn measure(&self, bytes: &[u8]) -> ContentIdentity;
    fn put_if_absent(
        &self,
        reservation_id: &str,
        bytes: Vec<u8>,
    ) -> impl Future<Output = Result<String, ObjectError>> + Send;
    fn latest_version(
        &self,
        reservation_id: &str,
    ) -> impl Future<Output = Result<Option<String>, ObjectError>> + Send;
    fn get_version(
        &self,
        reservation_id: &str,
        namespace: &str,
        version: &str,
    ) -> impl Future<Output = Result<MeasuredObject, ObjectError>> + Send;
}
pub trait EvidenceMetadata: Send + Sync {
    fn reserve(
        &self,
        actor: &str,
        scope: &Scope,
        request: &ReservationRequest,
        namespace: &str,
    ) -> impl Future<Output = Result<StoredReservation, EvidenceError>> + Send;
    fn reservation(
        &self,
        actor: &str,
        scope: &Scope,
        id: &str,
    ) -> impl Future<Output = Result<StoredReservation, EvidenceError>> + Send;
    fn recover(
        &self,
        actor: &str,
        scope: &Scope,
        after: Option<&str>,
    ) -> impl Future<Output = Result<EvidencePage<Reservation>, EvidenceError>> + Send;
    fn list(
        &self,
        actor: &str,
        scope: &Scope,
        after: Option<&str>,
    ) -> impl Future<Output = Result<EvidencePage<RegisteredEvidence>, EvidenceError>> + Send;
    fn inspect(
        &self,
        actor: &str,
        scope: &Scope,
        id: &str,
    ) -> impl Future<Output = Result<StoredEvidence, EvidenceError>> + Send;
    fn register(
        &self,
        actor: &str,
        scope: &Scope,
        id: &str,
        namespace: &str,
        version: &str,
        identity: &ContentIdentity,
    ) -> impl Future<Output = Result<RegisteredEvidence, EvidenceError>> + Send;
    fn authorize(
        &self,
        actor: &str,
        scope: &Scope,
    ) -> impl Future<Output = Result<(), EvidenceError>> + Send;
}
fn valid_version(version: &str) -> bool {
    !version.is_empty()
        && version != "null"
        && version.len() <= 512
        && !version.chars().any(char::is_control)
}
pub async fn acquire<M: EvidenceMetadata, O: EvidenceObjects>(
    metadata: &M,
    objects: &O,
    actor: &str,
    scope: &Scope,
    id: &str,
    bytes: Vec<u8>,
) -> Result<RegisteredEvidence, EvidenceError> {
    if bytes.len() > MAX_ORIGINAL_BYTES {
        return Err(EvidenceError::TooLarge);
    }
    let reservation = metadata.reservation(actor, scope, id).await?;
    if reservation.namespace != objects.namespace() {
        return Err(EvidenceError::Unavailable);
    }
    let measured = objects.measure(&bytes);
    if measured != reservation.reservation.request.identity {
        return Err(EvidenceError::Conflict);
    }
    let version = if let Some(registered) = reservation.registered {
        registered.version
    } else {
        let mut version = None;
        // Each uncertain create is reconciled against the same immutable key. Never overwrite.
        for _ in 0..2 {
            match objects.put_if_absent(id, bytes.clone()).await {
                Ok(v) if valid_version(&v) => {
                    version = Some(v);
                    break;
                }
                Ok(_)
                | Err(
                    ObjectError::VersionUnavailable
                    | ObjectError::AlreadyExists
                    | ObjectError::Unavailable
                    | ObjectError::DeadlineExceeded,
                ) => {
                    if let Some(v) = objects.latest_version(id).await? {
                        if !valid_version(&v) {
                            return Err(EvidenceError::Unavailable);
                        }
                        version = Some(v);
                        break;
                    }
                }
                Err(error) => return Err(error.into()),
            }
        }
        version.ok_or(EvidenceError::Unavailable)?
    };
    let original = objects
        .get_version(id, &reservation.namespace, &version)
        .await?;
    if original.identity != measured || original.bytes != bytes {
        return Err(EvidenceError::Integrity);
    }
    let evidence = metadata
        .register(
            actor,
            scope,
            id,
            &reservation.namespace,
            &version,
            &original.identity,
        )
        .await?;
    metadata.authorize(actor, scope).await?;
    Ok(evidence)
}
pub async fn read_original<M: EvidenceMetadata, O: EvidenceObjects>(
    metadata: &M,
    objects: &O,
    actor: &str,
    scope: &Scope,
    id: &str,
) -> Result<(RegisteredEvidence, Vec<u8>), EvidenceError> {
    let stored = metadata.inspect(actor, scope, id).await?;
    if stored.namespace != objects.namespace() {
        return Err(EvidenceError::Unavailable);
    }
    let original = objects
        .get_version(id, &stored.namespace, &stored.evidence.version)
        .await?;
    if original.bytes.len() > MAX_ORIGINAL_BYTES
        || original.identity != stored.evidence.reservation.request.identity
        || objects.measure(&original.bytes) != original.identity
    {
        return Err(EvidenceError::Integrity);
    }
    metadata.authorize(actor, scope).await?;
    Ok((stored.evidence, original.bytes))
}
