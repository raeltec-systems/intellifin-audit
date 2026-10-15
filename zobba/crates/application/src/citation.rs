//! Trusted citation verification (Story 22.5). Each source of each cited span
//! is checked against the exact original it names: text at the locator, read
//! by trusted code (byte ranges in process; spreadsheet cells, Word paragraphs
//! and table cells and email parts by the trusted document program in the 22.4
//! sandbox), and native page reads against what was actually sent. The answer
//! is never edited; the result per source is `verified` or `unverified` with a
//! closed reason.
use std::{collections::BTreeMap, future::Future};

use crate::model::ModelCancellation;
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
    /// The text of an exact original range widened by up to two characters
    /// on each side (fewer at the text's edges). Trusted code reads it only to
    /// check that a verified quote is a whole value, never to verify a quote.
    /// None: no context could be read (a fact's quote is then not proven
    /// whole).
    fn byte_context(
        &self,
        basis: &ClaimBasis,
        original: &CitedOriginal,
        start: u64,
        end: u64,
    ) -> impl Future<Output = Result<Option<String>, ReadingError>> + Send {
        let _ = (basis, original, start, end);
        async { Ok(None) }
    }
    /// Text at each structured locator, in order, read by the trusted
    /// document program in the sandbox over this exact original.
    fn locate(
        &self,
        basis: &ClaimBasis,
        original: &CitedOriginal,
        locators: &[Locator],
        cancellation: &ModelCancellation,
    ) -> impl Future<Output = Result<Vec<Located>, ReadingError>> + Send;
    /// Rendered page facts (existence, text layer) and whether this Task read
    /// exactly that rendered page natively. None: the original is not a paged
    /// document or could not be rendered.
    fn page(
        &self,
        basis: &ClaimBasis,
        original: &CitedOriginal,
        page: u32,
        cancellation: &ModelCancellation,
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
/// trusted locate run. Fencing, denial, capacity and unavailability end
/// verification without recording anything (it runs again on a reclaim); only
/// a definite unreadability makes a source `source_unreadable`.
pub async fn verify<C: CitationReader>(
    reader: &C,
    basis: &ClaimBasis,
    answer: &CitedAnswer,
    cancellation: &ModelCancellation,
) -> Result<Vec<StoredCitation>, ReadingError> {
    Ok(verify_located(reader, basis, answer, cancellation)
        .await?
        .into_iter()
        .map(|(citation, _)| citation)
        .collect())
}

/// [`verify`], also returning the text trusted code read at each source's
/// location (in source order; empty when nothing was read). Story 24.1 uses
/// it to check that a fact's quote is a whole value at its location, and
/// that the fact's subject and measure stand beside it.
pub async fn verify_located<C: CitationReader>(
    reader: &C,
    basis: &ClaimBasis,
    answer: &CitedAnswer,
    cancellation: &ModelCancellation,
) -> Result<Vec<(StoredCitation, Vec<Vec<String>>)>, ReadingError> {
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
        let results = match reader.locate(basis, original, locators, cancellation).await {
            Ok(results) if results.len() == locators.len() => results,
            Ok(_) => vec![Located::Unreadable; locators.len()],
            Err(error) => {
                unreadable::<()>(error).map(|_| vec![Located::Unreadable; locators.len()])?
            }
        };
        for (locator, result) in locators.iter().zip(results) {
            located.insert((id.clone(), locator.clone()), result);
        }
    }
    let mut out = Vec::new();
    for (index, span) in answer.spans() {
        let mut sources = Vec::new();
        let mut texts = Vec::new();
        for source in &answer.segments[index].sources {
            let original = originals.get(&source.original_id).cloned().flatten();
            let (verification, text) = match &original {
                None => (
                    Verification::Unverified(UnverifiedReason::SourceUnreadable),
                    vec![],
                ),
                Some(original) => {
                    decide_one(reader, basis, original, source, &located, cancellation).await?
                }
            };
            sources.push(VerifiedSource {
                source: source.clone(),
                original_sha256: original.map(|o| o.sha256),
                verification,
            });
            texts.push(text);
        }
        out.push((
            StoredCitation {
                segment: index as u32,
                span,
                sources,
            },
            texts,
        ));
    }
    Ok(out)
}

async fn decide_one<C: CitationReader>(
    reader: &C,
    basis: &ClaimBasis,
    original: &CitedOriginal,
    source: &CitationSource,
    located: &BTreeMap<(String, Locator), Located>,
    cancellation: &ModelCancellation,
) -> Result<(Verification, Vec<String>), ReadingError> {
    let Some(locator) = &source.locator else {
        return Ok((decide(source, None, None), vec![]));
    };
    let texts = |found: Option<&Located>| match found {
        Some(Located::Found(texts)) => texts.clone(),
        _ => vec![],
    };
    match locator {
        Locator::Page { page } => {
            let facts = match reader.page(basis, original, *page, cancellation).await {
                Ok(facts) => facts,
                Err(error) => unreadable::<PageFacts>(error)?,
            };
            let text = facts
                .as_ref()
                .and_then(|f| f.text_layer.clone())
                .into_iter()
                .collect();
            Ok((decide(source, None, facts.as_ref()), text))
        }
        Locator::Bytes { start, end } => {
            let found = match reader.byte_range(basis, original, *start, *end).await {
                Ok(found) => Some(found),
                Err(error) => unreadable::<Located>(error)?,
            };
            let found = found.unwrap_or(Located::Unreadable);
            let verification = decide(source, Some(&found), None);
            // A byte range shows only itself; the text around it says
            // whether the quote is a whole value (`2,500.00` cut from
            // `12,500.00`). Read only for a verified quote.
            let context = if verification == Verification::Verified {
                match reader.byte_context(basis, original, *start, *end).await {
                    Ok(context) => context,
                    Err(error) => unreadable::<String>(error)?,
                }
            } else {
                None
            };
            Ok((verification, context.into_iter().collect()))
        }
        _ => {
            let found = located.get(&(original.id.clone(), locator.clone()));
            Ok((decide(source, found, None), texts(found)))
        }
    }
}

/// An exact range of plain UTF-8 text widened by up to two characters on
/// each side (fewer at the text's edges). None when the range is not a
/// character-aligned range of valid text.
pub fn widened(bytes: &[u8], start: usize, end: usize) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?;
    if start >= end
        || end > text.len()
        || !text.is_char_boundary(start)
        || !text.is_char_boundary(end)
    {
        return None;
    }
    let from = text[..start]
        .char_indices()
        .rev()
        .take(2)
        .last()
        .map_or(start, |(i, _)| i);
    let to = end
        + text[end..]
            .chars()
            .take(2)
            .map(char::len_utf8)
            .sum::<usize>();
    Some(text[from..to].to_string())
}

/// A definite refusal of a read (`Invalid`) is not proof of absence: it is
/// `source_unreadable`. Fencing, denial, capacity and unavailability are not
/// facts about the source and end verification.
fn unreadable<T>(error: ReadingError) -> Result<Option<T>, ReadingError> {
    match error {
        ReadingError::Invalid => Ok(None),
        _ => Err(error),
    }
}

#[cfg(test)]
mod tests;
