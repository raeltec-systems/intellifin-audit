//! Custody sequencing. No database transaction spans immutable object I/O.
use crate::knowledge::{
    CapturedAssertion, CapturedExcerpt, EvidenceCapture, MAX_EXCERPT_BYTES, Omission,
};
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
    /// The adapter must authorize the exact current scope and bound C-ordered
    /// candidates before matching attributed metadata. Recovery stays separate.
    fn search(
        &self,
        actor: &str,
        scope: &Scope,
        query: &EvidenceSearchQuery,
    ) -> impl Future<Output = Result<EvidenceSearchPage, EvidenceError>> + Send;
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
    /// Atomically register the original and exact capture or a durable explicit
    /// omission. Every production adapter implements this owned boundary.
    #[allow(clippy::too_many_arguments)]
    fn register_captured(
        &self,
        actor: &str,
        scope: &Scope,
        id: &str,
        namespace: &str,
        version: &str,
        identity: &ContentIdentity,
        capture: &EvidenceCapture,
    ) -> impl Future<Output = Result<RegisteredEvidence, EvidenceError>> + Send;
    fn authorize(
        &self,
        actor: &str,
        scope: &Scope,
    ) -> impl Future<Output = Result<(), EvidenceError>> + Send;
}
/// Consume at most the candidate budget plus one unexamined lookahead row. Stop
/// at the result budget without skipping later candidates, including matches.
/// Adapters supply only currently authorized, C-ordered registered originals.
pub fn search_candidates(
    query: &EvidenceSearchQuery,
    candidates: Vec<RegisteredEvidence>,
) -> Result<EvidenceSearchPage, EvidenceError> {
    if !query.is_valid() {
        return Err(EvidenceError::Invalid);
    }
    if candidates.len() > EVIDENCE_SEARCH_CANDIDATES + 1
        || candidates
            .windows(2)
            .any(|pair| pair[0].reservation.id >= pair[1].reservation.id)
        || candidates.first().is_some_and(|first| {
            query
                .after
                .as_ref()
                .is_some_and(|after| &first.reservation.id <= after)
        })
    {
        return Err(EvidenceError::Unavailable);
    }
    let needle = metadata_search_case_key(&query.query);
    let candidate_count = candidates.len();
    let mut items = Vec::new();
    let mut examined_count = 0;
    let mut last_examined = None;
    for candidate in candidates.into_iter().take(EVIDENCE_SEARCH_CANDIDATES) {
        examined_count += 1;
        last_examined = Some(candidate.reservation.id.clone());
        let request = &candidate.reservation.request;
        if [
            Some(&request.filename),
            request.source.system.as_ref(),
            request.source.account.as_ref(),
            request.source.source_version.as_ref(),
            request.source.selection.as_ref(),
            request.source.coverage.as_ref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| metadata_search_case_key(value).contains(&needle))
        {
            items.push(candidate);
            if items.len() == EVIDENCE_PAGE_SIZE {
                break;
            }
        }
    }
    let complete = examined_count == candidate_count;
    Ok(EvidenceSearchPage {
        items,
        next_cursor: if complete { None } else { last_examined },
        coverage: EvidenceSearchCoverage {
            examined_count,
            candidate_limit: EVIDENCE_SEARCH_CANDIDATES,
            complete,
        },
    })
}
/// Map each Unicode scalar to lowercase independently, then compare literal
/// substrings. Whole-string lowercasing is context-sensitive (for example, Greek
/// final sigma), so it can erase a prefix match. This applies neither Unicode
/// normalization nor locale-specific casing/full case folding, and never changes
/// the attributed metadata returned to the caller.
fn metadata_search_case_key(value: &str) -> String {
    value.chars().flat_map(char::to_lowercase).collect()
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
    let capture = capture_evidence(&original.bytes, &reservation.reservation.request.source);
    let evidence = metadata
        .register_captured(
            actor,
            scope,
            id,
            &reservation.namespace,
            &version,
            &original.identity,
            &capture,
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

/// Eligibility matches the inert text preview, but offsets and content are
/// derived directly from the immutable original bytes, never display previews.
/// Populated acquisition metadata stays explicitly attributed assertions.
pub fn capture_evidence(bytes: &[u8], assertions: &SourceAssertions) -> EvidenceCapture {
    let assertions = [
        ("source.system", &assertions.system),
        ("source.account", &assertions.account),
        ("source.source_version", &assertions.source_version),
        ("source.selection", &assertions.selection),
        ("source.coverage", &assertions.coverage),
    ]
    .into_iter()
    .filter_map(|(path, value)| {
        value.as_ref().map(|text| CapturedAssertion {
            field_path: path.into(),
            text: text.clone(),
        })
    })
    .collect();
    let excerpt = if bytes.len() <= MAX_ORIGINAL_BYTES && plain_preview(bytes).is_some() {
        // plain_preview has already validated UTF-8 and inert-text eligibility.
        let text = std::str::from_utf8(bytes).expect("validated UTF-8 original");
        let mut end = bytes.len().min(MAX_EXCERPT_BYTES);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        Some(CapturedExcerpt {
            text: text[..end].into(),
            byte_start: 0,
            byte_end: end as u64,
            original_size: bytes.len() as u64,
            partial: end < bytes.len(),
        })
    } else {
        None
    };
    let omission = if excerpt.is_none() {
        Some(Omission::UnsupportedFormat)
    } else if excerpt.as_ref().is_some_and(|value| value.partial) {
        Some(Omission::PartialSource)
    } else {
        None
    };
    EvidenceCapture {
        excerpt,
        assertions,
        omission,
    }
}

/// Server-side exact range recorder. Refuses invalid UTF-8 boundaries and never
/// accepts browser-supplied excerpt prose as validated support.
pub fn capture_range(bytes: &[u8], start: u64, end: u64) -> Result<CapturedExcerpt, EvidenceError> {
    let start = usize::try_from(start).map_err(|_| EvidenceError::Invalid)?;
    let end = usize::try_from(end).map_err(|_| EvidenceError::Invalid)?;
    if bytes.len() > MAX_ORIGINAL_BYTES
        || start >= end
        || end > bytes.len()
        || end - start > MAX_EXCERPT_BYTES
        || plain_preview(bytes).is_none()
    {
        return Err(EvidenceError::Invalid);
    }
    let text = std::str::from_utf8(&bytes[start..end]).map_err(|_| EvidenceError::Invalid)?;
    Ok(CapturedExcerpt {
        text: text.into(),
        byte_start: start as u64,
        byte_end: end as u64,
        original_size: bytes.len() as u64,
        partial: start != 0 || end != bytes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn search_fixture(index: usize, filename: &str) -> RegisteredEvidence {
        RegisteredEvidence {
            reservation: Reservation {
                id: format!("evidence-{index:04}"),
                actor_id: "actor-a".into(),
                scope: Scope {
                    organisation_id: "org-a".into(),
                    client_id: "client-a".into(),
                    engagement_id: "engagement-a".into(),
                },
                request: ReservationRequest {
                    key: format!("key-{index}"),
                    filename: filename.into(),
                    identity: ContentIdentity {
                        sha256: "a".repeat(64),
                        size: 1,
                    },
                    source: SourceAssertions::default(),
                },
                reserved_at: 1,
            },
            version: "version-a".into(),
            registered_at: 2,
        }
    }
    #[test]
    fn search_result_limit_continues_at_last_examined_without_skipping_matches() {
        let candidates: Vec<_> = (0..101)
            .map(|index| {
                search_fixture(
                    index,
                    if index % 2 == 0 {
                        "match.txt"
                    } else {
                        "other.txt"
                    },
                )
            })
            .collect();
        let first = search_candidates(
            &EvidenceSearchQuery::new("MATCH", None).unwrap(),
            candidates.clone(),
        )
        .unwrap();
        assert_eq!(first.items.len(), 50);
        assert_eq!(first.coverage.examined_count, 99);
        assert_eq!(first.next_cursor.as_deref(), Some("evidence-0098"));
        assert!(!first.coverage.complete);
        let second = search_candidates(
            &EvidenceSearchQuery::new("MATCH", first.next_cursor).unwrap(),
            candidates.into_iter().skip(99).collect(),
        )
        .unwrap();
        assert_eq!(second.items.len(), 1);
        assert_eq!(second.items[0].reservation.id, "evidence-0100");
        assert_eq!(second.coverage.examined_count, 2);
        assert!(second.coverage.complete);
        assert!(second.next_cursor.is_none());
    }
    #[test]
    fn search_partial_empty_page_continues_past_256_unmatched_candidates() {
        let candidates: Vec<_> = (0..257)
            .map(|index| {
                search_fixture(
                    index,
                    if index == 256 {
                        "rare.txt"
                    } else {
                        "other.txt"
                    },
                )
            })
            .collect();
        let first = search_candidates(
            &EvidenceSearchQuery::new("rare", None).unwrap(),
            candidates.clone(),
        )
        .unwrap();
        assert!(first.items.is_empty());
        assert_eq!(first.coverage.examined_count, 256);
        assert_eq!(first.next_cursor.as_deref(), Some("evidence-0255"));
        assert!(!first.coverage.complete);
        let second = search_candidates(
            &EvidenceSearchQuery::new("rare", first.next_cursor).unwrap(),
            vec![candidates[256].clone()],
        )
        .unwrap();
        assert_eq!(second.items[0].reservation.id, "evidence-0256");
        assert_eq!(second.coverage.examined_count, 1);
        assert!(second.coverage.complete);
        let empty =
            search_candidates(&EvidenceSearchQuery::new("rare", None).unwrap(), vec![]).unwrap();
        assert_eq!(empty.coverage.examined_count, 0);
        assert!(empty.coverage.complete);
    }
    #[test]
    fn search_matches_only_literal_attributed_fields_with_unicode_lowercase() {
        let mut candidate = search_fixture(1, "Résumé 界🙂.txt");
        candidate.reservation.request.source = SourceAssertions {
            system: Some("LEDGER".into()),
            account: Some("Bank account".into()),
            source_version: Some("June-v2".into()),
            selection: Some("Selected %_ rows".into()),
            coverage: Some("Unverified coverage".into()),
        };
        for query in [
            "RÉSUMÉ", "界🙂", "ledger", "ACCOUNT", "june", "%_", "COVERAGE", "",
        ] {
            assert_eq!(
                search_candidates(
                    &EvidenceSearchQuery::new(query, None).unwrap(),
                    vec![candidate.clone()]
                )
                .unwrap()
                .items,
                vec![candidate.clone()]
            );
        }
        for query in [
            "actor-a",
            "version-a",
            "evidence-0001",
            "org-a",
            "not a stored excerpt",
        ] {
            assert!(
                search_candidates(
                    &EvidenceSearchQuery::new(query, None).unwrap(),
                    vec![candidate.clone()]
                )
                .unwrap()
                .items
                .is_empty()
            );
        }
        assert_eq!(
            search_candidates(
                &EvidenceSearchQuery::new("", None).unwrap(),
                vec![candidate.clone(); 258]
            ),
            Err(EvidenceError::Unavailable)
        );
        assert_eq!(
            search_candidates(
                &EvidenceSearchQuery::new("", Some(candidate.reservation.id.clone())).unwrap(),
                vec![candidate]
            ),
            Err(EvidenceError::Unavailable)
        );
    }
    #[test]
    fn search_unicode_case_mapping_is_context_independent_and_keeps_literal_substrings() {
        let mut candidate = search_fixture(1, "ΟΣΑ Café %_.txt");
        candidate.reservation.request.source = SourceAssertions {
            system: Some("ΔΟΣΑ".into()),
            account: Some("ΠΟΣΑ".into()),
            source_version: Some("ΝΟΣΑ".into()),
            selection: Some("ΡΟΣΑ".into()),
            coverage: Some("ΤΟΣΑ".into()),
        };
        for query in [
            "ΟΣ", "οσ", "ΟΣΑ", "ΔΟΣ", "ΠΟΣ", "ΝΟΣ", "ΡΟΣ", "ΤΟΣ", "CAFÉ", "%_",
        ] {
            assert_eq!(
                search_candidates(
                    &EvidenceSearchQuery::new(query, None).unwrap(),
                    vec![candidate.clone()]
                )
                .unwrap()
                .items,
                vec![candidate.clone()],
                "Unicode casing must retain literal metadata prefixes: {query}"
            );
        }
        for query in ["ΟΣΒ", "Cafe\u{301}", ".*", "%X"] {
            assert!(
                search_candidates(
                    &EvidenceSearchQuery::new(query, None).unwrap(),
                    vec![candidate.clone()]
                )
                .unwrap()
                .items
                .is_empty(),
                "search must not normalize text or interpret patterns: {query}"
            );
        }
    }
    #[test]
    fn automatic_capture_preserves_exact_bytes_and_separates_assertions() {
        let bytes = "\u{feff}Statement\r\n界🙂".as_bytes();
        let captured = capture_evidence(
            bytes,
            &SourceAssertions {
                system: Some("Asserted ledger".into()),
                ..Default::default()
            },
        );
        let excerpt = captured.excerpt.unwrap();
        assert_eq!(excerpt.text.as_bytes(), bytes);
        assert_eq!(excerpt.byte_end, bytes.len() as u64);
        assert!(!excerpt.partial);
        assert_eq!(
            captured.assertions,
            vec![CapturedAssertion {
                field_path: "source.system".into(),
                text: "Asserted ledger".into()
            }]
        );
        assert_eq!(captured.omission, None);
    }
    #[test]
    fn prefix_bound_is_on_original_bytes_and_a_unicode_boundary() {
        let bytes = format!("{}🙂tail", "x".repeat(MAX_EXCERPT_BYTES - 1));
        let captured = capture_evidence(bytes.as_bytes(), &SourceAssertions::default());
        let excerpt = captured.excerpt.unwrap();
        assert_eq!(excerpt.text.len(), MAX_EXCERPT_BYTES - 1);
        assert_eq!(
            excerpt.text.as_bytes(),
            &bytes.as_bytes()[..MAX_EXCERPT_BYTES - 1]
        );
        assert_eq!(captured.omission, Some(Omission::PartialSource));
        assert!(excerpt.partial);
    }
    #[test]
    fn unsupported_original_retains_assertions_with_an_explicit_omission() {
        for bytes in [
            &b"<svg>untrusted markup</svg>"[..],
            &[0xff][..],
            &b"a\0b"[..],
        ] {
            let captured = capture_evidence(
                bytes,
                &SourceAssertions {
                    coverage: Some("Claimed complete".into()),
                    ..Default::default()
                },
            );
            assert_eq!(captured.excerpt, None);
            assert_eq!(captured.omission, Some(Omission::UnsupportedFormat));
            assert_eq!(captured.assertions.len(), 1);
        }
    }
    #[test]
    fn selected_ranges_preserve_bom_and_refuse_non_boundaries() {
        let bytes = "\u{feff}🙂\r\ntext".as_bytes();
        assert_eq!(capture_range(bytes, 0, 3).unwrap().text, "\u{feff}");
        assert_eq!(capture_range(bytes, 3, 7).unwrap().text, "🙂");
        assert_eq!(capture_range(bytes, 1, 7), Err(EvidenceError::Invalid));
        assert_eq!(capture_range(bytes, 0, 4), Err(EvidenceError::Invalid));
        assert_eq!(capture_range(bytes, 3, 3), Err(EvidenceError::Invalid));
        assert_eq!(
            capture_range(bytes, 0, bytes.len() as u64 + 1),
            Err(EvidenceError::Invalid)
        );
    }
}
