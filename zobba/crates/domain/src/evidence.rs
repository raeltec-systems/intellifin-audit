//! Immutable evidence and attributed acquisition facts, independent of storage.
use crate::identity::{Scope, valid_scope_id};
pub const MAX_ORIGINAL_BYTES: usize = 10 * 1024 * 1024;
pub const EVIDENCE_PAGE_SIZE: usize = 50;
pub const EVIDENCE_SEARCH_CANDIDATES: usize = 256;
pub const EVIDENCE_SEARCH_QUERY_BYTES: usize = 200;
pub const PREVIEW_BYTES: usize = 64 * 1024;
pub const PREVIEW_LINES: usize = 100;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContentIdentity {
    pub sha256: String,
    pub size: u64,
}
impl ContentIdentity {
    pub fn is_valid(&self) -> bool {
        self.size <= MAX_ORIGINAL_BYTES as u64
            && self.sha256.len() == 64
            && self
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    }
}
/// Every populated field is an assertion by the acquisition actor; None is unknown.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SourceAssertions {
    pub system: Option<String>,
    pub account: Option<String>,
    pub source_version: Option<String>,
    pub selection: Option<String>,
    pub coverage: Option<String>,
}
impl SourceAssertions {
    pub fn is_valid(&self) -> bool {
        [
            &self.system,
            &self.account,
            &self.source_version,
            &self.selection,
            &self.coverage,
        ]
        .into_iter()
        .all(|v| {
            v.as_ref().is_none_or(|s| {
                !s.is_empty()
                    && s.len() <= 2000
                    && s.trim() == s
                    && !s.chars().any(char::is_control)
            })
        })
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReservationRequest {
    pub key: String,
    pub filename: String,
    pub identity: ContentIdentity,
    pub source: SourceAssertions,
}
impl ReservationRequest {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && !self.filename.is_empty()
            && self.filename.len() <= 255
            && self.filename.trim() == self.filename
            && !self
                .filename
                .chars()
                .any(|c| c.is_control() || matches!(c, '/' | '\\'))
            && self.identity.is_valid()
            && self.source.is_valid()
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reservation {
    pub id: String,
    pub actor_id: String,
    pub scope: Scope,
    pub request: ReservationRequest,
    pub reserved_at: i64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegisteredEvidence {
    pub reservation: Reservation,
    pub version: String,
    pub registered_at: i64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidencePage<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}
/// Literal metadata search. No extracted content, ranking or business assertion
/// is inferred from a match. Empty text browses the same registered originals.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidenceSearchQuery {
    pub query: String,
    pub after: Option<String>,
}
impl EvidenceSearchQuery {
    pub fn new(query: &str, after: Option<String>) -> Option<Self> {
        // Refuse controls before trimming, preserving the same Unicode rules as
        // attributed metadata (including accepted format and private-use text).
        if query.chars().any(char::is_control) {
            return None;
        }
        let value = Self {
            query: query.trim().to_owned(),
            after,
        };
        value.is_valid().then_some(value)
    }
    pub fn is_valid(&self) -> bool {
        self.query.len() <= EVIDENCE_SEARCH_QUERY_BYTES
            && self.query.trim() == self.query
            && !self.query.chars().any(char::is_control)
            && self.after.as_deref().is_none_or(valid_scope_id)
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidenceSearchCoverage {
    pub examined_count: usize,
    pub candidate_limit: usize,
    /// The remaining C-ordered candidates were exhausted for this read. This
    /// does not claim absence before the cursor, document meaning or completeness.
    pub complete: bool,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvidenceSearchPage {
    pub items: Vec<RegisteredEvidence>,
    /// Last examined candidate, which need not be a returned match.
    pub next_cursor: Option<String>,
    pub coverage: EvidenceSearchCoverage,
}
/// Only inert, valid plain text. Markup remains a download-only original.
pub fn plain_preview(bytes: &[u8]) -> Option<(String, bool)> {
    let text = std::str::from_utf8(bytes).ok()?;
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        || text
            .trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
            .starts_with('<')
    {
        return None;
    }
    let mut end = text.len().min(PREVIEW_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let bounded = &text[..end];
    let mut breaks = 0;
    let mut previous_cr = false;
    for (index, character) in bounded.char_indices() {
        if matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}')
            && !(character == '\n' && previous_cr)
        {
            breaks += 1;
            if breaks == PREVIEW_LINES {
                end = index;
                break;
            }
        }
        previous_cr = character == '\r';
    }
    Some((text[..end].to_owned(), end < text.len()))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_query_is_byte_bounded_and_preserves_metadata_unicode() {
        let value = EvidenceSearchQuery::new("\u{2003}Résumé 界🙂\u{a0}", None).unwrap();
        assert_eq!(value.query, "Résumé 界🙂");
        assert_eq!(
            EvidenceSearchQuery::new(" \u{2003}", None).unwrap().query,
            ""
        );
        for value in ["\u{feff}source", "source\u{200d}name", "\u{e000}"] {
            assert_eq!(EvidenceSearchQuery::new(value, None).unwrap().query, value);
        }
        assert!(EvidenceSearchQuery::new(&"🙂".repeat(50), None).is_some());
        assert!(EvidenceSearchQuery::new(&"🙂".repeat(51), None).is_none());
        for value in ["\nname", "name\r", "a\0b", "\u{85}name"] {
            assert!(EvidenceSearchQuery::new(value, None).is_none());
        }
        assert!(EvidenceSearchQuery::new("name", Some("../scope".into())).is_none());
    }
    #[test]
    fn preview_is_inert_bounded_and_utf8_safe() {
        assert!(plain_preview(b"<svg onload='x'>").is_none());
        assert!(plain_preview(&[0xff]).is_none());
        assert!(plain_preview(b"a\0b").is_none());
        let (v, t) = plain_preview("界".repeat(PREVIEW_BYTES).as_bytes()).unwrap();
        assert!(t);
        assert!(v.len() <= PREVIEW_BYTES);
        let (v, t) = plain_preview("line\n".repeat(101).as_bytes()).unwrap();
        assert!(t);
        assert_eq!(v.lines().count(), 100);
        for separator in ["\r", "\r\n", "\u{2028}", "\u{2029}"] {
            let (preview, truncated) =
                plain_preview(format!("line{separator}").repeat(101).as_bytes()).unwrap();
            assert!(truncated);
            assert_eq!(preview.split(separator).count(), PREVIEW_LINES);
        }
    }
}
