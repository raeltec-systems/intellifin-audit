//! Cited answers, stable source locators and verification results (Story 22.5).
//!
//! An answer is an ordered list of segments; a segment with sources is one
//! cited claim span. Each source names an original, an optional locator and the
//! quoted text the model says is there. Trusted code later opens the original
//! and records `verified` or `unverified` with one closed reason. Verification
//! never edits the answer. There is no confidence score.
use std::collections::BTreeMap;

use unicode_normalization::UnicodeNormalization;

use crate::{
    assessment::{
        self, MAX_EVALUATE, MAX_JUDGMENTS, MAX_PROPOSED_BASES, MAX_PROPOSED_CRITERIA,
        MAX_RECORDED_FACTS, ProposedBasis, ProposedCriterion, ProposedFact, ProposedJudgment,
    },
    coverage::{
        self, MAX_EVALUATE_POPULATION, MAX_PROPOSED_POPULATIONS, MAX_PROPOSED_SAMPLES,
        MAX_SUMMARISE, PopulationEvaluation, ProposedPopulation, ProposedSample, SummaryRequest,
    },
    identity::valid_scope_id,
    investigation::{
        GapReason, MAX_METHOD_NOTES, MAX_NOTE_BYTES, MAX_NOTE_SEGMENTS, MAX_PART_ID_BYTES,
        MAX_PART_REQUESTS, MAX_SCRIPT_INPUTS, MAX_SCRIPT_RUNS, MAX_SKILL_LOADS, MethodNote,
        NoteKind, ScriptRequest, valid_part_id,
    },
    model::{ArgumentSchema, JsonValue},
    permissions::valid_digest,
};

/// Owner-approved bounds (Story 22.5 "Ask First"): at most 200 distinct
/// pages read natively per document per Task, and page images of at most
/// 4 MB. These are narrower. The 200 is a COUNT of pages read; a page number
/// itself may be anything up to [`MAX_PAGE_NUMBER`].
pub const MAX_PAGES_PER_DOCUMENT: u32 = 200;
/// The largest page number a locator, request or record may name.
pub const MAX_PAGE_NUMBER: u32 = 10_000;
pub const MAX_PAGE_IMAGE_BYTES: usize = 2 * 1024 * 1024;
/// Structured model output is bounded at 32 KiB of JSON in total
/// (`MAX_TOOL_ARGUMENT_BYTES`), so these text bounds stay well inside it.
/// A page read's transcription.
pub const MAX_PAGE_TEXT_BYTES: usize = 16 * 1024;
/// A trusted renderer's text layer of one page (not model output).
pub const MAX_TEXT_LAYER_BYTES: usize = 64 * 1024;
pub const MAX_ANSWER_BYTES: usize = 16 * 1024;
pub const MAX_SEGMENTS: usize = 64;
pub const MAX_SEGMENT_BYTES: usize = 4 * 1024;
pub const MAX_SOURCES_PER_SEGMENT: usize = 8;
pub const MAX_QUOTE_BYTES: usize = 1000;
pub const MAX_LOCATOR_BYTES: usize = 300;
pub const MAX_LIMITATIONS: usize = 16;
pub const MAX_LIMITATION_BYTES: usize = 500;
/// Reading requests one answer may make: native page reads and programs.
pub const MAX_PAGE_REQUESTS: usize = 4;
pub const MAX_PROGRAM_REQUESTS: usize = 1;
pub const MAX_PROGRAM_TEXT_BYTES: usize = 12 * 1024;
pub const MAX_PROGRAM_INPUTS: usize = 8;
/// Distinct sources one answer may cite (bounds verification work).
pub const MAX_ANSWER_SOURCES: usize = 128;
/// Spreadsheet sheet names and email header names.
pub const MAX_NAME_BYTES: usize = 128;
pub const MAX_RANGE_CELLS: u64 = 256;

/// A stable location inside one original. `parse(render(l)) == Some(l)`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Locator {
    /// 1-based page of a PDF or an image document.
    Page { page: u32 },
    /// One cell (`B4`) or rectangular range (`B4:C6`) of a named sheet.
    Cell { sheet: String, range: CellRange },
    /// 1-based body paragraph of a Word document.
    Paragraph { paragraph: u32 },
    /// 1-based table, row and column of a Word document.
    TableCell { table: u32, row: u32, column: u32 },
    /// One header of an email message, by name (case-insensitive).
    EmailHeader { name: String },
    /// 1-based text part of an email message, in MIME tree order.
    EmailPart { part: u32 },
    /// Half-open byte range of a plain-text original.
    Bytes { start: u64, end: u64 },
}

/// `B4` is `{column: 2, row: 4}` to itself; columns and rows are 1-based.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct CellRange {
    pub first_column: u32,
    pub first_row: u32,
    pub last_column: u32,
    pub last_row: u32,
}
/// Excel's limits: 16,384 columns (XFD) and 1,048,576 rows.
const MAX_COLUMN: u32 = 16_384;
const MAX_ROW: u32 = 1_048_576;

fn column_name(mut column: u32) -> String {
    let mut out = Vec::new();
    while column > 0 {
        let rem = (column - 1) % 26;
        out.push(b'A' + rem as u8);
        column = (column - 1) / 26;
    }
    out.reverse();
    String::from_utf8(out).expect("ASCII column name")
}
fn parse_cell(value: &str) -> Option<(u32, u32)> {
    let split = value.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = value.split_at(split);
    if letters.is_empty()
        || letters.len() > 3
        || !letters.bytes().all(|b| b.is_ascii_uppercase())
        || digits.is_empty()
        || digits.starts_with('0')
        || !digits.bytes().all(|b| b.is_ascii_digit())
        || digits.len() > 7
    {
        return None;
    }
    let column = letters
        .bytes()
        .fold(0u32, |n, b| n * 26 + u32::from(b - b'A' + 1));
    let row: u32 = digits.parse().ok()?;
    ((1..=MAX_COLUMN).contains(&column) && (1..=MAX_ROW).contains(&row)).then_some((column, row))
}
impl CellRange {
    pub fn parse(value: &str) -> Option<Self> {
        let (first, last) = match value.split_once(':') {
            Some((first, last)) => (parse_cell(first)?, parse_cell(last)?),
            None => {
                let cell = parse_cell(value)?;
                (cell, cell)
            }
        };
        let range = Self {
            first_column: first.0,
            first_row: first.1,
            last_column: last.0,
            last_row: last.1,
        };
        // A single cell has one spelling; a range is ordered and bounded.
        (range.is_valid() && (value.contains(':') != range.is_single())).then_some(range)
    }
    pub fn is_single(&self) -> bool {
        self.first_column == self.last_column && self.first_row == self.last_row
    }
    pub fn is_valid(&self) -> bool {
        (1..=MAX_COLUMN).contains(&self.first_column)
            && (1..=MAX_ROW).contains(&self.first_row)
            && (self.first_column..=MAX_COLUMN).contains(&self.last_column)
            && (self.first_row..=MAX_ROW).contains(&self.last_row)
            && self.cells() <= MAX_RANGE_CELLS
    }
    pub fn cells(&self) -> u64 {
        u64::from(self.last_column - self.first_column + 1)
            * u64::from(self.last_row - self.first_row + 1)
    }
    pub fn render(&self) -> String {
        let first = format!("{}{}", column_name(self.first_column), self.first_row);
        if self.is_single() {
            first
        } else {
            format!("{first}:{}{}", column_name(self.last_column), self.last_row)
        }
    }
}

fn positive(value: &str) -> Option<u32> {
    (!value.is_empty()
        && value.len() <= 10
        && !value.starts_with('0')
        && value.bytes().all(|b| b.is_ascii_digit()))
    .then(|| value.parse().ok())
    .flatten()
    .filter(|n| *n > 0)
}
fn offset(value: &str) -> Option<u64> {
    (!value.is_empty()
        && value.len() <= 20
        && (value == "0" || !value.starts_with('0'))
        && value.bytes().all(|b| b.is_ascii_digit()))
    .then(|| value.parse().ok())
    .flatten()
}
pub fn valid_sheet(name: &str) -> bool {
    // Excel forbids []:*?/\ in sheet names and limits them to 31 characters.
    !name.is_empty()
        && name.chars().count() <= 31
        && name.len() <= MAX_NAME_BYTES
        && name.trim() == name
        && !name
            .chars()
            .any(|c| c.is_control() || matches!(c, '[' | ']' | ':' | '*' | '?' | '/' | '\\'))
}
fn valid_header(name: &str) -> bool {
    // RFC 5322 field name: printable ASCII except colon.
    !name.is_empty()
        && name.len() <= MAX_NAME_BYTES
        && name.bytes().all(|b| (33..=126).contains(&b) && b != b':')
}

impl Locator {
    /// Canonical text form used by model output, storage and display.
    pub fn render(&self) -> String {
        match self {
            Self::Page { page } => format!("page:{page}"),
            Self::Cell { sheet, range } => format!("cell:{sheet}!{}", range.render()),
            Self::Paragraph { paragraph } => format!("paragraph:{paragraph}"),
            Self::TableCell { table, row, column } => format!("table:{table}:{row}:{column}"),
            Self::EmailHeader { name } => format!("header:{name}"),
            Self::EmailPart { part } => format!("part:{part}"),
            Self::Bytes { start, end } => format!("bytes:{start}-{end}"),
        }
    }
    /// Exact canonical form only: no trimming, case folding or aliases.
    pub fn parse(value: &str) -> Option<Self> {
        if value.len() > MAX_LOCATOR_BYTES {
            return None;
        }
        let (kind, rest) = value.split_once(':')?;
        let locator = match kind {
            "page" => Self::Page {
                page: positive(rest).filter(|p| *p <= MAX_PAGE_NUMBER)?,
            },
            "cell" => {
                let (sheet, range) = rest.rsplit_once('!')?;
                if !valid_sheet(sheet) {
                    return None;
                }
                Self::Cell {
                    sheet: sheet.into(),
                    range: CellRange::parse(range)?,
                }
            }
            "paragraph" => Self::Paragraph {
                paragraph: positive(rest)?,
            },
            "table" => {
                let mut parts = rest.split(':');
                let table = positive(parts.next()?)?;
                let row = positive(parts.next()?)?;
                let column = positive(parts.next()?)?;
                if parts.next().is_some() {
                    return None;
                }
                Self::TableCell { table, row, column }
            }
            "header" => {
                if !valid_header(rest) {
                    return None;
                }
                Self::EmailHeader { name: rest.into() }
            }
            "part" => Self::EmailPart {
                part: positive(rest)?,
            },
            "bytes" => {
                let (start, end) = rest.split_once('-')?;
                let (start, end) = (offset(start)?, offset(end)?);
                if start >= end {
                    return None;
                }
                Self::Bytes { start, end }
            }
            _ => return None,
        };
        (locator.render() == value).then_some(locator)
    }
    /// Which trusted reader confirms it.
    pub fn family(&self) -> LocatorFamily {
        match self {
            Self::Page { .. } => LocatorFamily::Page,
            Self::Bytes { .. } => LocatorFamily::Bytes,
            Self::Cell { .. } => LocatorFamily::Spreadsheet,
            Self::Paragraph { .. } | Self::TableCell { .. } => LocatorFamily::Document,
            Self::EmailHeader { .. } | Self::EmailPart { .. } => LocatorFamily::Email,
        }
    }
    /// Whether the quote must equal one value at the location (a cell) or be
    /// contained in the located text (everything else).
    pub fn exact(&self) -> bool {
        matches!(self, Self::Cell { .. })
    }
    /// Short human label for display, for example `Sheet1!B4` or `page 3`.
    pub fn label(&self) -> String {
        match self {
            Self::Page { page } => format!("page {page}"),
            Self::Cell { sheet, range } => format!("{sheet}!{}", range.render()),
            Self::Paragraph { paragraph } => format!("paragraph {paragraph}"),
            Self::TableCell { table, row, column } => {
                format!("table {table}, row {row}, column {column}")
            }
            Self::EmailHeader { name } => format!("{name} header"),
            Self::EmailPart { part } => format!("message part {part}"),
            Self::Bytes { start, end } => format!("bytes {start}–{end}"),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocatorFamily {
    Page,
    Bytes,
    Spreadsheet,
    Document,
    Email,
}

/// One source of a cited claim, as the model stated it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CitationSource {
    pub original_id: String,
    /// None when the model gave no locator, or one that is not canonical.
    pub locator: Option<Locator>,
    pub quote: String,
}

/// One answer segment. With sources it is one cited claim span.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub text: String,
    pub sources: Vec<CitationSource>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PageRequest {
    pub original_id: String,
    pub page: u32,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProgramRequest {
    pub program: String,
    /// Strictly ordered, distinct original IDs.
    pub inputs: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CitedAnswer {
    pub segments: Vec<Segment>,
    /// Unreadable or ambiguous regions the model stated in words.
    pub limitations: Vec<String>,
    /// Further reading the model asked for before it can answer fully.
    pub read_pages: Vec<PageRequest>,
    pub programs: Vec<ProgramRequest>,
    /// Story 22.6: method parts and loaded-skill resources to fetch, by part ID.
    pub read_method: Vec<String>,
    /// Story 22.6: installed skill versions to load, by version ID.
    pub use_skills: Vec<String>,
    /// Story 22.6: loaded skills' scripts to run in the analysis sandbox.
    pub run_skill_script: Vec<ScriptRequest>,
    /// Story 22.6: gaps, contextual questions and statements per requirement.
    pub method_notes: Vec<MethodNote>,
    /// Story 24.1: criterion versions the agent proposes (checked and
    /// recorded by trusted code before they become records).
    pub propose_criteria: Vec<ProposedCriterion>,
    /// Story 24.1: at most one assessment basis version per answer.
    pub propose_basis: Vec<ProposedBasis>,
    /// Story 24.1: typed fact observations with their cited sources.
    pub record_facts: Vec<ProposedFact>,
    /// Story 24.1: rule criteria (IDs or same-answer keys) trusted code
    /// evaluates deterministically; the model never writes a rule verdict.
    pub evaluate: Vec<String>,
    /// Story 24.1: proposed judgments of judgment criteria, in words.
    pub judgments: Vec<ProposedJudgment>,
    /// Story 24.2: at most one population manifest version per answer:
    /// where the population is and how to read it. Trusted code reads every
    /// row and counts; the model never does.
    pub propose_population: Vec<ProposedPopulation>,
    /// Story 24.2: at most one sample manifest version per answer.
    pub propose_sample: Vec<ProposedSample>,
    /// Story 24.2: rule criteria trusted code evaluates over every in-scope
    /// member of a population.
    pub evaluate_population: Vec<PopulationEvaluation>,
    /// Story 24.2: coverage summaries trusted code computes.
    pub summarise: Vec<SummaryRequest>,
    /// Story 24.3a: a successor basis carries its predecessor's effective
    /// facts by reference, except the listed (subject, name) pairs.
    pub carry_facts: Vec<crate::revision::CarryFacts>,
    /// Story 24.3b: effective summaries trusted code computes over the
    /// current revisions and dispositions.
    pub summarise_effective: Vec<SummaryRequest>,
    /// Story 22.6: investigation requests and notes that were individually
    /// invalid, repeated or over their bound and so were left out on decode.
    /// The rest of the answer stands; trusted code reports the count.
    pub discarded: u32,
}

/// A claim span in answer text, in byte offsets on character boundaries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

fn text_ok(value: &str, max: usize) -> bool {
    value.len() <= max
        && !value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}
fn distinct(values: &[String]) -> bool {
    values
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        == values.len()
}
fn nonempty(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && text_ok(value, max)
}

impl CitedAnswer {
    /// The answer text: its segments, in order, unchanged.
    pub fn text(&self) -> String {
        self.segments.iter().map(|s| s.text.as_str()).collect()
    }
    /// Claim spans of the cited segments, with their segment index.
    pub fn spans(&self) -> Vec<(usize, Span)> {
        let mut at = 0u32;
        let mut spans = Vec::new();
        for (index, segment) in self.segments.iter().enumerate() {
            let end = at + segment.text.len() as u32;
            if !segment.sources.is_empty() {
                spans.push((index, Span { start: at, end }));
            }
            at = end;
        }
        spans
    }
    pub fn is_valid(&self) -> bool {
        let sources: usize = self.segments.iter().map(|s| s.sources.len()).sum();
        // An answer has text, or it is an intermediate turn that only asks to
        // read further or records method notes (stored, verified trivially,
        // never listed as an answer).
        (!self.segments.is_empty()
            || self.requests_reading()
            || self.requests_investigation()
            || !self.method_notes.is_empty()
            || self.requests_assessment())
            && self.segments.len() <= MAX_SEGMENTS
            && self.text().len() <= MAX_ANSWER_BYTES
            && self.segments.iter().all(|s| {
                !s.text.is_empty()
                    && text_ok(&s.text, MAX_SEGMENT_BYTES)
                    && s.sources.len() <= MAX_SOURCES_PER_SEGMENT
                    && s.sources.iter().all(|c| {
                        valid_scope_id(&c.original_id) && text_ok(&c.quote, MAX_QUOTE_BYTES)
                    })
            })
            && sources <= MAX_ANSWER_SOURCES
            && self.limitations.len() <= MAX_LIMITATIONS
            && self
                .limitations
                .iter()
                .all(|l| nonempty(l, MAX_LIMITATION_BYTES))
            && self.read_pages.len() <= MAX_PAGE_REQUESTS
            && self
                .read_pages
                .iter()
                .all(|r| valid_scope_id(&r.original_id) && (1..=MAX_PAGE_NUMBER).contains(&r.page))
            && self.programs.len() <= MAX_PROGRAM_REQUESTS
            && self.programs.iter().all(|p| {
                nonempty(&p.program, MAX_PROGRAM_TEXT_BYTES)
                    && !p.program.contains('\0')
                    && !p.inputs.is_empty()
                    && p.inputs.len() <= MAX_PROGRAM_INPUTS
                    && p.inputs.iter().all(|i| valid_scope_id(i))
                    && p.inputs.windows(2).all(|w| w[0] < w[1])
            })
            && self.read_method.len() <= MAX_PART_REQUESTS
            && self.read_method.iter().all(|p| valid_part_id(p))
            && distinct(&self.read_method)
            && self.use_skills.len() <= MAX_SKILL_LOADS
            && self.use_skills.iter().all(|v| valid_scope_id(v))
            && distinct(&self.use_skills)
            && self.run_skill_script.len() <= MAX_SCRIPT_RUNS
            && self.run_skill_script.iter().all(ScriptRequest::is_valid)
            && self.method_notes.len() <= MAX_METHOD_NOTES
            && self.method_notes.iter().all(|n| {
                n.is_valid()
                    && n.segments
                        .iter()
                        .all(|s| (*s as usize) < self.segments.len())
            })
            && self.propose_criteria.len() <= MAX_PROPOSED_CRITERIA
            && self
                .propose_criteria
                .iter()
                .all(ProposedCriterion::is_valid)
            && self.propose_basis.len() <= MAX_PROPOSED_BASES
            && self.propose_basis.iter().all(ProposedBasis::is_valid)
            && self.record_facts.len() <= MAX_RECORDED_FACTS
            && self.record_facts.iter().all(ProposedFact::is_valid)
            && self.evaluate.len() <= MAX_EVALUATE
            && self.evaluate.iter().all(|c| valid_scope_id(c))
            && distinct(&self.evaluate)
            && self.judgments.len() <= MAX_JUDGMENTS
            && self.judgments.iter().all(ProposedJudgment::is_valid)
            && self.propose_population.len() <= MAX_PROPOSED_POPULATIONS
            && self
                .propose_population
                .iter()
                .all(ProposedPopulation::is_valid)
            && self.propose_sample.len() <= MAX_PROPOSED_SAMPLES
            && self.propose_sample.iter().all(ProposedSample::is_valid)
            && self.evaluate_population.len() <= MAX_EVALUATE_POPULATION
            && self.summarise.len() <= MAX_SUMMARISE
            && self.carry_facts.len() <= crate::revision::MAX_CARRIES
            && self
                .carry_facts
                .iter()
                .all(crate::revision::CarryFacts::is_valid)
            && self.summarise_effective.len() <= crate::exception::MAX_SUMMARISE_EFFECTIVE
    }
    /// Whether the answer proposes criteria, a basis, facts, evaluations or
    /// judgments (Story 24.1), or a population, a sample, population
    /// evaluations or summaries (Story 24.2). Only a composed assessment acts
    /// on these.
    pub fn requests_assessment(&self) -> bool {
        !self.propose_criteria.is_empty()
            || !self.propose_basis.is_empty()
            || !self.record_facts.is_empty()
            || !self.evaluate.is_empty()
            || !self.judgments.is_empty()
            || !self.propose_population.is_empty()
            || !self.propose_sample.is_empty()
            || !self.evaluate_population.is_empty()
            || !self.summarise.is_empty()
            || !self.carry_facts.is_empty()
            || !self.summarise_effective.is_empty()
    }
    /// Whether the answer asks for more native reading or its own analysis
    /// program before it is complete (Story 22.5).
    pub fn requests_reading(&self) -> bool {
        !self.read_pages.is_empty() || !self.programs.is_empty()
    }
    /// Whether the answer asks for method parts, skills or skill scripts
    /// (Story 22.6). Only a composed investigation acts on these; notes alone
    /// never continue a turn.
    pub fn requests_investigation(&self) -> bool {
        !self.read_method.is_empty()
            || !self.use_skills.is_empty()
            || !self.run_skill_script.is_empty()
    }
    /// Whether this turn is an answer to show: it has answer text. A turn
    /// that only requests reading is an intermediate step.
    pub fn is_answer(&self) -> bool {
        !self.segments.is_empty()
    }

    /// Strict structured-output schema of a cited answer (Story 22.5). Every
    /// property is required (OpenAI strict output); empty arrays mean "none".
    pub fn schema() -> ArgumentSchema {
        Self::schema_with(false, false)
    }
    /// The cited answer with the Story 22.6 method and skill fields, used only
    /// when an investigation is composed.
    pub fn investigation_schema() -> ArgumentSchema {
        Self::schema_with(true, false)
    }
    /// The investigation schema with the Story 24.1 assessment fields, used
    /// only when an assessment is composed. The other two are unchanged, so
    /// requests of compositions without assessment keep their bytes.
    pub fn assessment_schema() -> ArgumentSchema {
        Self::schema_with(true, true)
    }
    fn schema_with(investigating: bool, assessing: bool) -> ArgumentSchema {
        let string = |max: usize| ArgumentSchema::String {
            max_bytes: max as u32,
            enumeration: vec![],
        };
        let object = |fields: Vec<(&str, ArgumentSchema)>| {
            let required = fields.iter().map(|(k, _)| (*k).to_string()).collect();
            ArgumentSchema::Object {
                properties: fields
                    .into_iter()
                    .map(|(k, v)| (k.to_string(), v))
                    .collect(),
                required,
            }
        };
        let array = |items: ArgumentSchema, max: usize| ArgumentSchema::Array {
            items: Box::new(items),
            max_items: max as u32,
        };
        let source = object(vec![
            ("original_id", string(128)),
            ("locator", string(MAX_LOCATOR_BYTES)),
            ("quote", string(MAX_QUOTE_BYTES)),
        ]);
        let segment = object(vec![
            ("text", string(MAX_SEGMENT_BYTES)),
            ("sources", array(source, MAX_SOURCES_PER_SEGMENT)),
        ]);
        let page = object(vec![
            ("original_id", string(128)),
            (
                "page",
                ArgumentSchema::Integer {
                    minimum: 1,
                    maximum: i64::from(MAX_PAGE_NUMBER),
                },
            ),
        ]);
        let program = object(vec![
            ("program", string(MAX_PROGRAM_TEXT_BYTES)),
            ("inputs", array(string(128), MAX_PROGRAM_INPUTS)),
        ]);
        let enumerated = |values: Vec<&str>| ArgumentSchema::String {
            max_bytes: 32,
            enumeration: values.into_iter().map(String::from).collect(),
        };
        let script = object(vec![
            ("version_id", string(128)),
            ("resource_id", string(128)),
            ("inputs", array(string(128), MAX_SCRIPT_INPUTS)),
        ]);
        let mut reasons = vec![""];
        reasons.extend(GapReason::ALL.iter().map(|r| r.as_str()));
        let note = object(vec![
            ("requirement_id", string(128)),
            (
                "kind",
                enumerated(NoteKind::ALL.iter().map(|k| k.as_str()).collect()),
            ),
            ("text", string(MAX_NOTE_BYTES)),
            ("reason", enumerated(reasons)),
            (
                "segments",
                array(
                    ArgumentSchema::Integer {
                        minimum: 0,
                        maximum: MAX_SEGMENTS as i64 - 1,
                    },
                    MAX_NOTE_SEGMENTS,
                ),
            ),
        ]);
        let mut fields = vec![
            ("segments", array(segment, MAX_SEGMENTS)),
            (
                "limitations",
                array(string(MAX_LIMITATION_BYTES), MAX_LIMITATIONS),
            ),
            ("read_pages", array(page, MAX_PAGE_REQUESTS)),
            ("programs", array(program, MAX_PROGRAM_REQUESTS)),
        ];
        if investigating {
            fields.extend([
                (
                    "read_method",
                    array(string(MAX_PART_ID_BYTES), MAX_PART_REQUESTS),
                ),
                ("use_skills", array(string(128), MAX_SKILL_LOADS)),
                ("run_skill_script", array(script, MAX_SCRIPT_RUNS)),
                ("method_notes", array(note, MAX_METHOD_NOTES)),
            ]);
        }
        if assessing {
            fields.extend(assessment::answer_fields());
            fields.extend(coverage::answer_fields());
            fields.extend(crate::revision::answer_fields());
            fields.extend(crate::exception::answer_fields());
        }
        object(fields)
    }

    /// Decode a structured value accepted by [`Self::schema`]. A locator that is
    /// empty or not canonical is kept as `None` (verified `location_missing`),
    /// never guessed. Input order of program inputs is normalized. The Story
    /// 22.6 fields are optional on decode, so stored older answers (which do
    /// not have them) keep parsing with their bytes unchanged.
    pub fn from_json(value: &JsonValue) -> Option<Self> {
        let object = as_object(value)?;
        let segments = as_array(object.get("segments")?)?
            .iter()
            .map(|segment| {
                let segment = as_object(segment)?;
                let sources = as_array(segment.get("sources")?)?
                    .iter()
                    .map(|source| {
                        let source = as_object(source)?;
                        let locator = as_string(source.get("locator")?)?;
                        Some(CitationSource {
                            original_id: as_string(source.get("original_id")?)?.into(),
                            locator: Locator::parse(locator),
                            quote: as_string(source.get("quote")?)?.into(),
                        })
                    })
                    .collect::<Option<Vec<_>>>()?;
                Some(Segment {
                    text: as_string(segment.get("text")?)?.into(),
                    sources,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let limitations = as_array(object.get("limitations")?)?
            .iter()
            .map(|l| as_string(l).map(String::from))
            .collect::<Option<Vec<_>>>()?;
        let read_pages = as_array(object.get("read_pages")?)?
            .iter()
            .map(|page| {
                let page = as_object(page)?;
                let JsonValue::Integer(number) = page.get("page")? else {
                    return None;
                };
                Some(PageRequest {
                    original_id: as_string(page.get("original_id")?)?.into(),
                    page: u32::try_from(*number).ok()?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let programs = as_array(object.get("programs")?)?
            .iter()
            .map(|program| {
                let program = as_object(program)?;
                let mut inputs = as_array(program.get("inputs")?)?
                    .iter()
                    .map(|i| as_string(i).map(String::from))
                    .collect::<Option<Vec<_>>>()?;
                inputs.sort();
                inputs.dedup();
                Some(ProgramRequest {
                    program: as_string(program.get("program")?)?.into(),
                    inputs,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        // Story 22.6 fields: each entry stands alone. An individually invalid,
        // repeated or over-bound entry is left out and counted; the answer
        // stands. A field of the wrong JSON type still refuses the answer.
        let mut discarded = 0u32;
        let mut strings = |key: &str, max: usize, valid: fn(&str) -> bool| -> Option<Vec<String>> {
            let Some(value) = object.get(key) else {
                return Some(vec![]);
            };
            let mut out: Vec<String> = Vec::new();
            for item in as_array(value)? {
                match as_string(item) {
                    Some(text)
                        if valid(text) && !out.iter().any(|o| o == text) && out.len() < max =>
                    {
                        out.push(text.into())
                    }
                    _ => discarded += 1,
                }
            }
            Some(out)
        };
        let read_method = strings("read_method", MAX_PART_REQUESTS, valid_part_id)?;
        let use_skills = strings("use_skills", MAX_SKILL_LOADS, valid_scope_id)?;
        let mut run_skill_script: Vec<ScriptRequest> = Vec::new();
        if let Some(value) = object.get("run_skill_script") {
            for script in as_array(value)? {
                let parsed = (|| {
                    let script = as_object(script)?;
                    let mut inputs = as_array(script.get("inputs")?)?
                        .iter()
                        .map(|i| as_string(i).map(String::from))
                        .collect::<Option<Vec<_>>>()?;
                    inputs.sort();
                    inputs.dedup();
                    Some(ScriptRequest {
                        version_id: as_string(script.get("version_id")?)?.into(),
                        resource_id: as_string(script.get("resource_id")?)?.into(),
                        inputs,
                    })
                })();
                match parsed {
                    Some(request)
                        if request.is_valid()
                            && !run_skill_script.contains(&request)
                            && run_skill_script.len() < MAX_SCRIPT_RUNS =>
                    {
                        run_skill_script.push(request)
                    }
                    _ => discarded += 1,
                }
            }
        }
        let mut method_notes: Vec<MethodNote> = Vec::new();
        if let Some(value) = object.get("method_notes") {
            for note in as_array(value)? {
                let parsed = (|| {
                    let note = as_object(note)?;
                    let requirement = as_string(note.get("requirement_id")?)?;
                    let reason = as_string(note.get("reason")?)?;
                    let mut segments = as_array(note.get("segments")?)?
                        .iter()
                        .map(|s| match s {
                            JsonValue::Integer(n) => u32::try_from(*n).ok(),
                            _ => None,
                        })
                        .collect::<Option<Vec<_>>>()?;
                    segments.sort_unstable();
                    segments.dedup();
                    Some(MethodNote {
                        requirement_id: (!requirement.is_empty()).then(|| requirement.into()),
                        kind: NoteKind::parse(as_string(note.get("kind")?)?)?,
                        text: as_string(note.get("text")?)?.into(),
                        reason: if reason.is_empty() {
                            None
                        } else {
                            Some(GapReason::parse(reason)?)
                        },
                        segments,
                    })
                })();
                match parsed {
                    Some(note)
                        if note.is_valid()
                            && note.segments.iter().all(|s| (*s as usize) < segments.len())
                            && method_notes.len() < MAX_METHOD_NOTES =>
                    {
                        method_notes.push(note)
                    }
                    _ => discarded += 1,
                }
            }
        }
        // Story 24.1 fields: the same rule. Each entry stands alone; an invalid,
        // repeated or over-bound one is left out and counted.
        fn entries<T: PartialEq>(
            object: &BTreeMap<String, JsonValue>,
            key: &str,
            max: usize,
            decode: fn(&JsonValue) -> Option<T>,
            discarded: &mut u32,
        ) -> Option<Vec<T>> {
            let Some(value) = object.get(key) else {
                return Some(vec![]);
            };
            let mut out: Vec<T> = Vec::new();
            for item in as_array(value)? {
                match decode(item) {
                    Some(entry) if !out.contains(&entry) && out.len() < max => out.push(entry),
                    _ => *discarded += 1,
                }
            }
            Some(out)
        }
        let mut propose_criteria = entries(
            object,
            "propose_criteria",
            usize::MAX,
            assessment::decode_criterion,
            &mut discarded,
        )?;
        // Criterion keys are local names: a repeated key is left out too,
        // before the bound, so a repeat never takes a valid entry's place.
        let mut seen = std::collections::BTreeSet::new();
        propose_criteria.retain(|c| {
            let fresh = seen.insert(c.key.clone());
            if !fresh {
                discarded += 1;
            }
            fresh
        });
        if propose_criteria.len() > MAX_PROPOSED_CRITERIA {
            discarded += (propose_criteria.len() - MAX_PROPOSED_CRITERIA) as u32;
            propose_criteria.truncate(MAX_PROPOSED_CRITERIA);
        }
        let propose_basis = entries(
            object,
            "propose_basis",
            MAX_PROPOSED_BASES,
            assessment::decode_basis,
            &mut discarded,
        )?;
        let record_facts = entries(
            object,
            "record_facts",
            MAX_RECORDED_FACTS,
            assessment::decode_fact,
            &mut discarded,
        )?;
        let evaluate = entries(
            object,
            "evaluate",
            MAX_EVALUATE,
            |v| as_string(v).filter(|s| valid_scope_id(s)).map(String::from),
            &mut discarded,
        )?;
        let judgments = entries(
            object,
            "judgments",
            MAX_JUDGMENTS,
            assessment::decode_judgment,
            &mut discarded,
        )?;
        let propose_population = entries(
            object,
            "propose_population",
            MAX_PROPOSED_POPULATIONS,
            coverage::decode_population,
            &mut discarded,
        )?;
        let propose_sample = entries(
            object,
            "propose_sample",
            MAX_PROPOSED_SAMPLES,
            coverage::decode_sample,
            &mut discarded,
        )?;
        let evaluate_population = entries(
            object,
            "evaluate_population",
            MAX_EVALUATE_POPULATION,
            coverage::decode_evaluation,
            &mut discarded,
        )?;
        let summarise = entries(
            object,
            "summarise",
            MAX_SUMMARISE,
            coverage::decode_summary,
            &mut discarded,
        )?;
        let carry_facts = entries(
            object,
            "carry_facts",
            crate::revision::MAX_CARRIES,
            crate::revision::decode_carry,
            &mut discarded,
        )?;
        let summarise_effective = entries(
            object,
            "summarise_effective",
            crate::exception::MAX_SUMMARISE_EFFECTIVE,
            crate::exception::decode_summarise_effective,
            &mut discarded,
        )?;
        let answer = Self {
            segments,
            limitations,
            read_pages,
            programs,
            read_method,
            use_skills,
            run_skill_script,
            method_notes,
            propose_criteria,
            propose_basis,
            record_facts,
            evaluate,
            judgments,
            propose_population,
            propose_sample,
            evaluate_population,
            summarise,
            carry_facts,
            summarise_effective,
            discarded,
        };
        answer.is_valid().then_some(answer)
    }
}
fn as_object(value: &JsonValue) -> Option<&BTreeMap<String, JsonValue>> {
    match value {
        JsonValue::Object(map) => Some(map),
        _ => None,
    }
}
fn as_array(value: &JsonValue) -> Option<&Vec<JsonValue>> {
    match value {
        JsonValue::Array(values) => Some(values),
        _ => None,
    }
}
fn as_string(value: &JsonValue) -> Option<&str> {
    match value {
        JsonValue::String(value) => Some(value),
        _ => None,
    }
}

/// One native page reading: the model's transcription and the regions it
/// stated it could not read. Never verified evidence by itself.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PageTranscript {
    pub text: String,
    pub unreadable: Vec<String>,
}
impl PageTranscript {
    pub fn schema() -> ArgumentSchema {
        ArgumentSchema::Object {
            properties: BTreeMap::from([
                (
                    "text".into(),
                    ArgumentSchema::String {
                        max_bytes: MAX_PAGE_TEXT_BYTES as u32,
                        enumeration: vec![],
                    },
                ),
                (
                    "unreadable".into(),
                    ArgumentSchema::Array {
                        items: Box::new(ArgumentSchema::String {
                            max_bytes: MAX_LIMITATION_BYTES as u32,
                            enumeration: vec![],
                        }),
                        max_items: MAX_LIMITATIONS as u32,
                    },
                ),
            ]),
            required: vec!["text".into(), "unreadable".into()],
        }
    }
    pub fn from_json(value: &JsonValue) -> Option<Self> {
        let object = as_object(value)?;
        let transcript = Self {
            text: as_string(object.get("text")?)?.into(),
            unreadable: as_array(object.get("unreadable")?)?
                .iter()
                .map(|l| as_string(l).map(String::from))
                .collect::<Option<Vec<_>>>()?,
        };
        transcript.is_valid().then_some(transcript)
    }
    pub fn is_valid(&self) -> bool {
        text_ok(&self.text, MAX_PAGE_TEXT_BYTES)
            && self.unreadable.len() <= MAX_LIMITATIONS
            && self
                .unreadable
                .iter()
                .all(|l| nonempty(l, MAX_LIMITATION_BYTES))
    }
}

macro_rules! vocabulary {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];
            pub const fn as_str(self) -> &'static str { match self { $(Self::$variant => $value),+ } }
            pub fn parse(value: &str) -> Option<Self> { match value { $($value => Some(Self::$variant),)+ _ => None } }
        }
    }
}
vocabulary!(UnverifiedReason {
    NotFoundAtLocation => "not_found_at_location",
    LocationMissing => "location_missing",
    SourceUnreadable => "source_unreadable",
    PageOnly => "page_only",
});

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verification {
    Verified,
    Unverified(UnverifiedReason),
}
impl Verification {
    pub fn reason(self) -> Option<UnverifiedReason> {
        match self {
            Self::Verified => None,
            Self::Unverified(reason) => Some(reason),
        }
    }
}

/// What a trusted reader found at one locator of one original.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Located {
    /// The text (or alternative renderings, for example a cell's stored and
    /// displayed values) at the location.
    Found(Vec<String>),
    /// The original was read and the location does not exist in it.
    Missing,
    /// The original could not be read safely (hostile, encrypted, corrupt or
    /// beyond the sandbox limits).
    Unreadable,
}

/// Whitespace and Unicode NFC normalization only: every run of Unicode
/// White_Space becomes one space and the ends are trimmed. Case, punctuation
/// and digits are never changed.
pub fn normalize(value: &str) -> String {
    let nfc: String = value.nfc().collect();
    nfc.split(char::is_whitespace)
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether located text confirms a quote: equality for a cell, containment for
/// all other locators, after [`normalize`]. An empty quote confirms nothing.
pub fn confirms(locator: &Locator, found: &[String], quote: &str) -> bool {
    let quote = normalize(quote);
    if quote.is_empty() {
        return false;
    }
    found.iter().any(|text| {
        let text = normalize(text);
        if locator.exact() {
            text == quote
        } else {
            text.contains(&quote)
        }
    })
}

/// Facts about one page that the trusted renderer and the page reads recorded.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PageFacts {
    /// The page exists in the rendered original.
    pub exists: bool,
    /// The page's text layer, if the document has one for this page.
    pub text_layer: Option<String>,
    /// A native read of this Task sent exactly this page's rendered image.
    pub read_natively: bool,
}

/// Decide one source. `located` is the trusted reader's answer for non-page
/// locators; `page` the recorded facts for a page locator.
pub fn decide(
    source: &CitationSource,
    located: Option<&Located>,
    page: Option<&PageFacts>,
) -> Verification {
    let Some(locator) = &source.locator else {
        return Verification::Unverified(UnverifiedReason::LocationMissing);
    };
    if let Locator::Page { .. } = locator {
        let Some(page) = page else {
            return Verification::Unverified(UnverifiedReason::SourceUnreadable);
        };
        if !page.exists {
            return Verification::Unverified(UnverifiedReason::NotFoundAtLocation);
        }
        if let Some(text) = &page.text_layer
            && confirms(locator, std::slice::from_ref(text), &source.quote)
        {
            return Verification::Verified;
        }
        return Verification::Unverified(if page.read_natively {
            UnverifiedReason::PageOnly
        } else {
            UnverifiedReason::NotFoundAtLocation
        });
    }
    match located {
        Some(Located::Found(texts)) if confirms(locator, texts, &source.quote) => {
            Verification::Verified
        }
        Some(Located::Found(_)) | Some(Located::Missing) => {
            Verification::Unverified(UnverifiedReason::NotFoundAtLocation)
        }
        Some(Located::Unreadable) | None => {
            Verification::Unverified(UnverifiedReason::SourceUnreadable)
        }
    }
}

/// A stored, verified source of one cited span.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VerifiedSource {
    pub source: CitationSource,
    /// The exact original digest verification read (None when unreadable
    /// before its identity was established).
    pub original_sha256: Option<String>,
    pub verification: Verification,
}
impl VerifiedSource {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.source.original_id)
            && text_ok(&self.source.quote, MAX_QUOTE_BYTES)
            && self.original_sha256.as_deref().is_none_or(valid_digest)
            // A verified source always names the exact original it was read in.
            && (self.verification != Verification::Verified || self.original_sha256.is_some())
    }
}

#[cfg(test)]
mod tests;
