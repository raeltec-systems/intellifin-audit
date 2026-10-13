//! Trusted citation verification (Story 22.5). Each source of each cited span
//! is checked against the exact original it names: text at the locator, read
//! by trusted code (byte ranges in process; spreadsheet cells, Word paragraphs
//! and table cells and email parts by the trusted document program in the 22.4
//! sandbox), and native page reads against what was actually sent. The answer
//! is never edited; the result per source is `verified` or `unverified` with a
//! closed reason.
use std::{collections::BTreeMap, future::Future};

use zobba_domain::{
    citation::{
        CitationSource, CitedAnswer, Located, Locator, LocatorFamily, PageFacts, Span,
        UnverifiedReason, Verification, VerifiedSource, decide,
    },
    task::ClaimBasis,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadingError {
    Invalid,
    Denied,
    Fenced,
    Capacity,
    Unavailable,
}
impl ReadingError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_reading",
            Self::Denied => "access_denied",
            Self::Fenced => "reading_fenced",
            Self::Capacity => "reading_capacity",
            Self::Unavailable => "reading_unavailable",
        }
    }
}

/// An exact current registered original, as verification read it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CitedOriginal {
    pub id: String,
    pub sha256: String,
}

/// Trusted reads that confirm a quote. A failure to read is never proof that
/// the quote is absent: it becomes `source_unreadable`.
pub trait CitationReader: Send + Sync {
    /// The original as currently registered under the claim's scope, or None.
    fn original(
        &self,
        basis: &ClaimBasis,
        id: &str,
    ) -> impl Future<Output = Result<Option<CitedOriginal>, ReadingError>> + Send;
    /// Plain-text bytes of an exact original range.
    fn byte_range(
        &self,
        basis: &ClaimBasis,
        original: &CitedOriginal,
        start: u64,
        end: u64,
    ) -> impl Future<Output = Result<Located, ReadingError>> + Send;
    /// Text at each structured locator, in order, read by the trusted
    /// document program in the sandbox over this exact original.
    fn locate(
        &self,
        basis: &ClaimBasis,
        original: &CitedOriginal,
        locators: &[Locator],
    ) -> impl Future<Output = Result<Vec<Located>, ReadingError>> + Send;
    /// Rendered page facts (existence, text layer) and whether this Task read
    /// exactly that rendered page natively. None: the original is not a paged
    /// document or could not be rendered.
    fn page(
        &self,
        basis: &ClaimBasis,
        original: &CitedOriginal,
        page: u32,
    ) -> impl Future<Output = Result<Option<PageFacts>, ReadingError>> + Send;
}

/// The verification of one cited span of an answer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredCitation {
    pub segment: u32,
    pub span: Span,
    pub sources: Vec<VerifiedSource>,
}

/// Verify every source of every cited span. Sources of one original share one
/// trusted locate run. Fencing and denial end verification; a source whose
/// original cannot be read safely is `source_unreadable`.
pub async fn verify<C: CitationReader>(
    reader: &C,
    basis: &ClaimBasis,
    answer: &CitedAnswer,
) -> Result<Vec<StoredCitation>, ReadingError> {
    if !answer.is_valid() {
        return Err(ReadingError::Invalid);
    }
    // Group structured locators by original for one locate run each.
    let mut originals: BTreeMap<String, Option<CitedOriginal>> = BTreeMap::new();
    let mut structured: BTreeMap<String, Vec<Locator>> = BTreeMap::new();
    for segment in &answer.segments {
        for source in &segment.sources {
            if !originals.contains_key(&source.original_id) {
                let found = reader.original(basis, &source.original_id).await?;
                originals.insert(source.original_id.clone(), found);
            }
            if let Some(locator) = &source.locator
                && matches!(
                    locator.family(),
                    LocatorFamily::Spreadsheet | LocatorFamily::Document | LocatorFamily::Email
                )
            {
                let list = structured.entry(source.original_id.clone()).or_default();
                if !list.contains(locator) {
                    list.push(locator.clone());
                }
            }
        }
    }
    let mut located: BTreeMap<(String, Locator), Located> = BTreeMap::new();
    for (id, locators) in &structured {
        let Some(Some(original)) = originals.get(id) else {
            continue;
        };
        let results = match reader.locate(basis, original, locators).await {
            Ok(results) if results.len() == locators.len() => results,
            Ok(_) => vec![Located::Unreadable; locators.len()],
            Err(ReadingError::Fenced) => return Err(ReadingError::Fenced),
            Err(ReadingError::Denied) => return Err(ReadingError::Denied),
            Err(_) => vec![Located::Unreadable; locators.len()],
        };
        for (locator, result) in locators.iter().zip(results) {
            located.insert((id.clone(), locator.clone()), result);
        }
    }
    let mut out = Vec::new();
    for (index, span) in answer.spans() {
        let mut sources = Vec::new();
        for source in &answer.segments[index].sources {
            let original = originals.get(&source.original_id).cloned().flatten();
            let verification = match &original {
                None => Verification::Unverified(UnverifiedReason::SourceUnreadable),
                Some(original) => decide_one(reader, basis, original, source, &located).await?,
            };
            sources.push(VerifiedSource {
                source: source.clone(),
                original_sha256: original.map(|o| o.sha256),
                verification,
            });
        }
        out.push(StoredCitation {
            segment: index as u32,
            span,
            sources,
        });
    }
    Ok(out)
}

async fn decide_one<C: CitationReader>(
    reader: &C,
    basis: &ClaimBasis,
    original: &CitedOriginal,
    source: &CitationSource,
    located: &BTreeMap<(String, Locator), Located>,
) -> Result<Verification, ReadingError> {
    let Some(locator) = &source.locator else {
        return Ok(decide(source, None, None));
    };
    match locator {
        Locator::Page { page } => {
            let facts = match reader.page(basis, original, *page).await {
                Ok(facts) => facts,
                Err(error) => unreadable::<PageFacts>(error)?,
            };
            Ok(decide(source, None, facts.as_ref()))
        }
        Locator::Bytes { start, end } => {
            let found = match reader.byte_range(basis, original, *start, *end).await {
                Ok(found) => Some(found),
                Err(error) => unreadable::<Located>(error)?,
            };
            Ok(decide(source, Some(&found.unwrap_or(Located::Unreadable)), None))
        }
        _ => Ok(decide(
            source,
            located.get(&(original.id.clone(), locator.clone())),
            None,
        )),
    }
}

/// A read that failed is not proof of absence: it is `source_unreadable`.
/// Fencing and denial still end verification.
fn unreadable<T>(error: ReadingError) -> Result<Option<T>, ReadingError> {
    match error {
        ReadingError::Fenced | ReadingError::Denied => Err(error),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests;
