//! Story 24.2: exact population, sample and coverage denominators.
//!
//! The agent names *where* a population is and *how* to read it (original,
//! sheet, header row, grain columns, period column, typed value columns,
//! whether the source is exhaustive, an optional cited control count) and,
//! if it samples, how it selected. Trusted code reads every row of the exact
//! original (Story 22.4 sandbox for a workbook, in process for CSV), builds
//! the members, evaluates rule criteria over every in-scope member with the
//! Story 24.1 pure [`evaluate`](crate::assessment::evaluate), and computes the
//! coverage summary with the pure [`summarise`] below. The model never counts,
//! never writes a member, a disposition or a rule verdict. Rows are received;
//! subjects are resolved from rows by the grain; opportunities are subject ×
//! criterion. There are no percentages, no statistical inference and no
//! numeric confidence: every count is exact, and anything not proven is said
//! in words.
use std::collections::{BTreeMap, BTreeSet};

use crate::{
    assessment::{
        Applicability, CivilDate, EvaluationReason, Execution, FactState, FactSupport, FactType,
        FactValue, InputFact, MAX_SUBJECT_BYTES, Measure, ParseRule, UnsupportedReason, Verdict,
        record_shaped, text_ok, valid_currency, valid_name, valid_subject,
    },
    citation::{CitationSource, Locator, MAX_LOCATOR_BYTES, MAX_QUOTE_BYTES, normalize},
    context::canonical_json,
    identity::valid_scope_id,
    model::{ArgumentSchema, JsonValue},
    work::sha256_hex,
};

/// Owner-approved bounds (Story 24.2, decision 5): one manifest reads at most
/// 20,000 data rows and 12 named columns; above that it is explicitly
/// `incomplete row_bound`, never silently cut.
pub const MAX_POPULATION_ROWS: u32 = 20_000;
pub const MAX_POPULATION_COLUMNS: usize = 12;
/// Each cell text trusted code keeps, in UTF-8 bytes. A longer cell is not
/// usable (a key, a period or a typed value), never truncated into another.
pub const MAX_CELL_TEXT_BYTES: usize = 256;
pub const MAX_GRAIN_COLUMNS: usize = 3;
pub const MAX_VALUE_COLUMNS: usize = 8;
pub const MAX_HEADER_BYTES: usize = 128;
pub const MAX_HEADER_ROW: u32 = 1_000;
pub const MAX_SHEET_BYTES: usize = crate::citation::MAX_NAME_BYTES;
pub const MAX_SELECTION_BYTES: usize = 500;
/// Answer bounds.
pub const MAX_PROPOSED_POPULATIONS: usize = 1;
pub const MAX_PROPOSED_SAMPLES: usize = 1;
pub const MAX_EVALUATE_POPULATION: usize = 4;
pub const MAX_SUMMARISE: usize = 2;
/// A judgmental or seeded sample names at most this many keys in one answer.
pub const MAX_SAMPLE_KEYS: usize = 200;
pub const MAX_SAMPLE_SUBSTITUTIONS: usize = 16;
pub const MAX_STRATA_BYTES: usize = 500;
pub const MAX_JUSTIFICATION_BYTES: usize = 1_000;
pub const MAX_SUBSTITUTION_REASON_BYTES: usize = 500;
pub const MAX_SUMMARY_LIMITATIONS: usize = 16;
/// The only seeded selection algorithm (owner decision 4).
pub const SAMPLE_ALGORITHM: &str = "splitmix64-fisher-yates-v1";
/// The only aggregation rule (two grains, never mixed).
pub const AGGREGATION_RULE: &str = "subject_partition_v1";

macro_rules! vocabulary {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub enum $name { $($variant),+ }
        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];
            pub const fn as_str(self) -> &'static str { match self { $(Self::$variant => $value),+ } }
            pub fn parse(value: &str) -> Option<Self> { match value { $($value => Some(Self::$variant),)+ _ => None } }
        }
    }
}

vocabulary!(DispositionKind {
    InScope => "in_scope",
    Excluded => "excluded",
    ScopeUnknown => "scope_unknown",
    DuplicateRow => "duplicate_row",
    Unkeyed => "unkeyed",
});

// Why a subject is excluded or its scope unknown. Closed.
vocabulary!(DispositionReason {
    OutOfPeriod => "out_of_period",
    PeriodUnparsed => "period_unparsed",
    PeriodMissing => "period_missing",
    ConflictingDuplicate => "conflicting_duplicate",
});

vocabulary!(IncompleteReason {
    NotExhaustive => "not_exhaustive",
    RowBound => "row_bound",
    CountMismatch => "count_mismatch",
});

vocabulary!(SampleMethodKind {
    AllInScope => "all_in_scope",
    Judgmental => "judgmental",
    SeededRandom => "seeded_random",
});

vocabulary!(Conclusion {
    NoEligibleItems => "no_eligible_items",
    ExceptionsFound => "exceptions_found",
    ExceptionsFoundInconclusive => "exceptions_found_inconclusive",
    NoExceptionFound => "no_exception_found",
    Inconclusive => "inconclusive",
    NoItemsFoundAbsenceNotProven => "no_items_found_absence_not_proven",
});

// The partition of subjects, one grain.
vocabulary!(SubjectOutcome {
    Failing => "failing",
    MeetsEveryApplicable => "meets_every_applicable",
    Unresolved => "unresolved",
    NotApplicableToAny => "not_applicable_to_any",
});

/// The undetermined bucket of a model's own undetermined proposal, which
/// explains itself in words rather than with a closed reason.
pub const STATED_IN_WORDS: &str = "stated_in_words";

/// What trusted code decided about one received row.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Disposition {
    InScope,
    Excluded(DispositionReason),
    ScopeUnknown(DispositionReason),
    /// All named cells are byte-identical to the row at this ordinal: the
    /// row is collapsed into it and counted.
    DuplicateRow {
        first: u32,
    },
    /// A grain cell is blank, over its bound or not a usable key.
    Unkeyed,
}
impl Disposition {
    pub const fn kind(self) -> DispositionKind {
        match self {
            Self::InScope => DispositionKind::InScope,
            Self::Excluded(_) => DispositionKind::Excluded,
            Self::ScopeUnknown(_) => DispositionKind::ScopeUnknown,
            Self::DuplicateRow { .. } => DispositionKind::DuplicateRow,
            Self::Unkeyed => DispositionKind::Unkeyed,
        }
    }
    pub const fn reason(self) -> Option<DispositionReason> {
        match self {
            Self::Excluded(r) | Self::ScopeUnknown(r) => Some(r),
            _ => None,
        }
    }
    pub const fn duplicate_of(self) -> Option<u32> {
        match self {
            Self::DuplicateRow { first } => Some(first),
            _ => None,
        }
    }
    /// From the stored kind, reason and duplicate ordinal; the closed pairs
    /// only (an excluded row is only out of period).
    pub fn from_parts(
        kind: DispositionKind,
        reason: Option<DispositionReason>,
        first: Option<u32>,
    ) -> Option<Self> {
        use DispositionReason as R;
        Some(match (kind, reason, first) {
            (DispositionKind::InScope, None, None) => Self::InScope,
            (DispositionKind::Excluded, Some(R::OutOfPeriod), None) => {
                Self::Excluded(R::OutOfPeriod)
            }
            (
                DispositionKind::ScopeUnknown,
                Some(r @ (R::PeriodUnparsed | R::PeriodMissing | R::ConflictingDuplicate)),
                None,
            ) => Self::ScopeUnknown(r),
            (DispositionKind::DuplicateRow, None, Some(first)) => Self::DuplicateRow { first },
            (DispositionKind::Unkeyed, None, None) => Self::Unkeyed,
            _ => return None,
        })
    }
}

// --------------------------------------------------------------- manifest

/// One typed value column of a population manifest.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValueColumn {
    /// The exact header text of the column.
    pub header: String,
    /// The fact name criteria read.
    pub name: String,
    pub kind: FactType,
    pub rule: ParseRule,
    /// A decimal's declared currency or unit (required for a decimal).
    pub measure: Option<Measure>,
    /// A column in the same row that shows the currency or unit; only it
    /// grounds the measure. Without it a decimal is `unit_unverified`.
    pub measure_column: Option<String>,
}
impl ValueColumn {
    pub fn is_valid(&self) -> bool {
        header_ok(&self.header)
            && valid_name(&self.name)
            && self.rule.produces() == self.kind
            && (self.kind == FactType::Decimal) == self.measure.is_some()
            && self.measure.as_ref().is_none_or(Measure::is_valid)
            && (self.measure_column.is_none() || self.kind == FactType::Decimal)
            && self.measure_column.as_deref().is_none_or(header_ok)
    }
}

/// A control count the agent cites: a registered original's exact location
/// whose quote trusted code verifies and parses as a whole number.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ControlCount {
    pub source: CitationSource,
    /// `decimal_plain` or `decimal_grouped_comma`, scale 0.
    pub rule: ParseRule,
}
impl ControlCount {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.source.original_id)
            && text_ok(&self.source.quote, MAX_QUOTE_BYTES)
            && matches!(
                self.rule,
                ParseRule::DecimalPlain | ParseRule::DecimalGroupedComma
            )
    }
    /// The count the verified quote states: a non-negative whole number.
    pub fn parse(&self) -> Option<u64> {
        let quote = normalize(&self.source.quote);
        let value = match self.rule {
            ParseRule::DecimalPlain => crate::assessment::Decimal::parse_plain(&quote)?,
            ParseRule::DecimalGroupedComma => crate::assessment::Decimal::parse_grouped(&quote)?,
            _ => return None,
        };
        (value.scale == 0 && value.mantissa >= 0)
            .then(|| u64::try_from(value.mantissa).ok())
            .flatten()
    }
}

fn header_ok(value: &str) -> bool {
    text_ok(value, MAX_HEADER_BYTES) && !value.chars().any(char::is_control)
}

/// A population manifest version as proposed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposedPopulation {
    /// Local name in this answer.
    pub key: String,
    /// A basis ID, or the key of the basis proposed in the same answer.
    pub basis: String,
    pub supersedes: Option<String>,
    pub original_id: String,
    /// A workbook sheet; None for CSV or plain text (the whole file).
    pub sheet: Option<String>,
    /// 1-based header row (1 for CSV).
    pub header_row: u32,
    pub subject_unit: String,
    /// 1–3 header texts whose cell texts, joined, are the subject key.
    pub grain: Vec<String>,
    /// The period column and its rule (date or instant).
    pub period: Option<(String, ParseRule)>,
    pub values: Vec<ValueColumn>,
    /// The agent's statement that the source is the whole population. A
    /// search export or a filtered view is `false`. It can only lower a
    /// conclusion: `true` still needs end-of-sheet and reconciliation proof.
    pub exhaustive: bool,
    pub control: Option<ControlCount>,
    pub selection: String,
}
impl ProposedPopulation {
    /// Every named column, deduplicated, in order: grain, period, values,
    /// measure columns.
    pub fn columns(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut add = |h: &String| {
            if !out.contains(h) {
                out.push(h.clone());
            }
        };
        self.grain.iter().for_each(&mut add);
        if let Some((h, _)) = &self.period {
            add(h);
        }
        self.values.iter().for_each(|v| add(&v.header));
        self.values
            .iter()
            .filter_map(|v| v.measure_column.as_ref())
            .for_each(&mut add);
        out
    }
    pub fn is_valid(&self) -> bool {
        let names: Vec<&String> = self.values.iter().map(|v| &v.name).collect();
        valid_scope_id(&self.key)
            && !record_shaped(&self.key)
            && valid_scope_id(&self.basis)
            && self.supersedes.as_deref().is_none_or(valid_scope_id)
            && valid_scope_id(&self.original_id)
            && self
                .sheet
                .as_deref()
                .is_none_or(crate::citation::valid_sheet)
            && (1..=MAX_HEADER_ROW).contains(&self.header_row)
            && (self.sheet.is_some() || self.header_row == 1)
            && valid_name(&self.subject_unit)
            && (1..=MAX_GRAIN_COLUMNS).contains(&self.grain.len())
            && self.grain.iter().all(|h| header_ok(h))
            && self
                .grain
                .iter()
                .enumerate()
                .all(|(i, h)| !self.grain[..i].contains(h))
            && self.period.as_ref().is_none_or(|(h, rule)| {
                header_ok(h) && matches!(rule.produces(), FactType::Date | FactType::Instant)
            })
            && self.values.len() <= MAX_VALUE_COLUMNS
            && self.values.iter().all(ValueColumn::is_valid)
            && names
                .iter()
                .enumerate()
                .all(|(i, n)| !names[..i].contains(n))
            && self.control.as_ref().is_none_or(ControlCount::is_valid)
            && text_ok(&self.selection, MAX_SELECTION_BYTES)
            && self.columns().len() <= MAX_POPULATION_COLUMNS
    }
}

// ------------------------------------------------------------- enumeration

/// One named cell as the trusted read found it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CellRead {
    /// Its display texts (as `locate` reports them; the first is the
    /// display text), or None when a text was over [`MAX_CELL_TEXT_BYTES`].
    /// A blank cell is `[""]` or empty.
    pub texts: Option<Vec<String>>,
    /// Its exact location in the original.
    pub locator: Option<Locator>,
}
impl CellRead {
    /// The display text, or None for a blank or over-bound cell.
    pub fn text(&self) -> Option<&str> {
        self.texts
            .as_ref()?
            .first()
            .map(String::as_str)
            .filter(|t| !t.trim().is_empty())
    }
    pub fn blank(&self) -> bool {
        self.texts
            .as_ref()
            .is_some_and(|t| t.iter().all(|t| t.trim().is_empty()))
    }
}

/// One received row: its 1-based sheet row (CSV record number) and its
/// named cells, in [`ProposedPopulation::columns`] order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RowRead {
    pub row: u32,
    pub cells: Vec<CellRead>,
}

/// What the trusted read of every row reported. Trusted code read the exact
/// original digest; nothing here comes from a model.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Enumeration {
    pub header_row: u32,
    /// The sheet's last row (CSV: its last record number).
    pub last_row: u32,
    /// Data rows read after the header row.
    pub rows_read: u32,
    /// True when the sheet has more data rows than the bound.
    pub truncated: bool,
    pub rows: Vec<RowRead>,
}

/// Why the trusted read produced no rows. Nothing is fabricated after it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EnumerationFailure {
    /// A named header was not found exactly once in the header row.
    HeaderMismatch { column: String },
    /// The sheet is not in the workbook.
    SheetMissing,
    /// Not a workbook, CSV or plain text the reader supports, or a sheet was
    /// named for CSV.
    Unsupported,
    /// Encrypted, corrupt, hostile, not UTF-8, or the trusted job failed or
    /// hit a limit.
    Unreadable,
}

/// The outcome of one trusted read of every row, with the 22.4 job that
/// read it (None for CSV and plain text, read in process).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Enumerated {
    pub job_id: Option<String>,
    pub outcome: Result<Enumeration, EnumerationFailure>,
}

/// What to read: a workbook sheet (None for CSV/plain text, the whole file),
/// its 1-based header row, and the named columns in order. `record` names the
/// population record the read is for: a reclaim of the same answer reuses its
/// read, and a later request for the same sheet is a new read of its own.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnumerateRequest {
    pub sheet: Option<String>,
    pub header_row: u32,
    pub columns: Vec<String>,
    pub record: String,
}
impl ProposedPopulation {
    pub fn request(&self, record: &str) -> EnumerateRequest {
        EnumerateRequest {
            sheet: self.sheet.clone(),
            header_row: self.header_row,
            columns: self.columns(),
            record: record.into(),
        }
    }
}

// ----------------------------------------------------------------- members

/// A typed cell value of one member, re-parsed by trusted code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MemberValue {
    /// Blank: no fact.
    Missing,
    /// Parsed under the declared rule. For a decimal, whether a measure
    /// column in the same row showed its currency or unit.
    Value {
        value: FactValue,
        measure_grounded: Option<bool>,
    },
    /// Present but it does not parse under the rule (or is over the bound):
    /// `unsupported{type_mismatch}`, kept visible.
    Unsupported,
}

/// One received row of a population, as trusted code decided it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Member {
    /// 0-based order of receipt.
    pub ordinal: u32,
    pub row: u32,
    /// The subject key (exact cell texts, leading zeros kept); None when
    /// unkeyed.
    pub subject: Option<String>,
    pub disposition: Disposition,
    /// The named cells' display texts and locations (None: blank or over).
    pub cells: Vec<(Option<String>, Option<Locator>)>,
    /// One per value column, in manifest order.
    pub values: Vec<MemberValue>,
}

/// The subject key of one row: grain texts joined by `|` (a `|` or `\`
/// inside a text is escaped with `\`, so the key is injective), kept exactly.
pub fn subject_key(parts: &[&str]) -> Option<String> {
    let mut key = String::new();
    for (i, part) in parts.iter().enumerate() {
        if part.trim().is_empty() {
            return None;
        }
        if i > 0 {
            key.push('|');
        }
        for c in part.chars() {
            if matches!(c, '|' | '\\') && parts.len() > 1 {
                key.push('\\');
            }
            key.push(c);
        }
    }
    (valid_subject(&key) && key.len() <= MAX_SUBJECT_BYTES).then_some(key)
}

fn parse_cell(cell: &CellRead, rule: ParseRule, measure: Option<&Measure>) -> Option<FactValue> {
    cell.texts
        .as_ref()?
        .iter()
        .find_map(|text| rule.apply(text, measure))
}

fn measure_of(cell: &CellRead, declared: &Measure) -> Option<Measure> {
    let text = normalize(cell.text()?);
    match declared {
        Measure::Currency(_) => valid_currency(&text).then_some(Measure::Currency(text)),
        Measure::Unit(_) => valid_name(&text).then_some(Measure::Unit(text)),
    }
}

/// Every received row's disposition and typed values, decided by trusted
/// code only, in receipt order.
///
/// 1. A row with a blank, over-bound or unusable grain cell is `unkeyed`.
/// 2. Rows sharing a key: if every named cell of every row is byte-identical
///    to the first, the later rows are `duplicate_row{first}`; if any named
///    cell differs, every row of that key is `scope_unknown
///    conflicting_duplicate`.
/// 3. Otherwise the period cell decides: blank → `period_missing`, not
///    parseable under the rule → `period_unparsed`, outside the basis period
///    (inclusive) → `excluded out_of_period`, else `in_scope`. Without a
///    period column every keyed row is in scope.
pub fn build_members(
    spec: &ProposedPopulation,
    enumeration: &Enumeration,
    period_from: CivilDate,
    period_to: CivilDate,
) -> Vec<Member> {
    let columns = spec.columns();
    let index = |header: &str| columns.iter().position(|c| c == header);
    let grain: Vec<usize> = spec.grain.iter().filter_map(|h| index(h)).collect();
    let keys: Vec<Option<String>> = enumeration
        .rows
        .iter()
        .map(|row| {
            let parts: Option<Vec<&str>> = grain
                .iter()
                .map(|&i| row.cells.get(i).and_then(CellRead::text))
                .collect();
            subject_key(&parts?)
        })
        .collect();
    // Rows of each key, in receipt order.
    let mut by_key: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (i, key) in keys.iter().enumerate() {
        if let Some(key) = key {
            by_key.entry(key.as_str()).or_default().push(i);
        }
    }
    let identical = |a: &RowRead, b: &RowRead| {
        a.cells.len() == b.cells.len()
            && a.cells
                .iter()
                .zip(&b.cells)
                .all(|(x, y)| x.texts == y.texts)
    };
    let mut dispositions: Vec<Option<Disposition>> = vec![None; enumeration.rows.len()];
    for rows in by_key.values() {
        let first = &enumeration.rows[rows[0]];
        if rows.iter().all(|&i| identical(first, &enumeration.rows[i])) {
            for &i in &rows[1..] {
                dispositions[i] = Some(Disposition::DuplicateRow {
                    first: rows[0] as u32,
                });
            }
        } else {
            for &i in rows {
                dispositions[i] = Some(Disposition::ScopeUnknown(
                    DispositionReason::ConflictingDuplicate,
                ));
            }
        }
    }
    let period = spec.period.as_ref().map(|(h, rule)| (index(h), *rule));
    enumeration
        .rows
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let subject = keys[i].clone();
            let disposition = match (&subject, dispositions[i]) {
                (None, _) => Disposition::Unkeyed,
                (Some(_), Some(decided)) => decided,
                (Some(_), None) => match period {
                    None => Disposition::InScope,
                    Some((at, rule)) => {
                        let cell = at.and_then(|at| row.cells.get(at));
                        match cell {
                            Some(cell) if cell.blank() => {
                                Disposition::ScopeUnknown(DispositionReason::PeriodMissing)
                            }
                            None => Disposition::ScopeUnknown(DispositionReason::PeriodMissing),
                            Some(cell) => match parse_cell(cell, rule, None) {
                                Some(FactValue::Date(d)) => within(d, period_from, period_to),
                                Some(FactValue::Instant(instant)) => match instant.civil_date() {
                                    Some(d) => within(d, period_from, period_to),
                                    None => {
                                        Disposition::ScopeUnknown(DispositionReason::PeriodUnparsed)
                                    }
                                },
                                _ => Disposition::ScopeUnknown(DispositionReason::PeriodUnparsed),
                            },
                        }
                    }
                },
            };
            let values = spec
                .values
                .iter()
                .map(|column| {
                    let Some(cell) = index(&column.header).and_then(|at| row.cells.get(at)) else {
                        return MemberValue::Missing;
                    };
                    if cell.blank() {
                        return MemberValue::Missing;
                    }
                    // A measure column in the same row grounds the measure.
                    let (measure, grounded) = match &column.measure {
                        None => (None, None),
                        Some(declared) => {
                            let shown = column
                                .measure_column
                                .as_deref()
                                .and_then(index)
                                .and_then(|at| row.cells.get(at))
                                .and_then(|c| measure_of(c, declared));
                            match shown {
                                Some(m) => (Some(m), Some(true)),
                                None => (Some(declared.clone()), Some(false)),
                            }
                        }
                    };
                    match parse_cell(cell, column.rule, measure.as_ref()) {
                        Some(value) => MemberValue::Value {
                            value,
                            measure_grounded: grounded,
                        },
                        None => MemberValue::Unsupported,
                    }
                })
                .collect();
            Member {
                ordinal: i as u32,
                row: row.row,
                subject,
                disposition,
                cells: row
                    .cells
                    .iter()
                    .map(|c| (c.text().map(String::from), c.locator.clone()))
                    .collect(),
                values,
            }
        })
        .collect()
}

fn within(date: CivilDate, from: CivilDate, to: CivilDate) -> Disposition {
    if from <= date && date <= to {
        Disposition::InScope
    } else {
        Disposition::Excluded(DispositionReason::OutOfPeriod)
    }
}

impl Member {
    /// The member's typed cells as 24.1 evaluator facts. The enumeration read
    /// is itself the trusted read of the exact original, so a parsed value is
    /// supported and its subject grounded by the same row; a decimal's measure
    /// is grounded only by a measure column in the same row. A blank cell is
    /// no fact (`missing_fact`); a cell that does not parse is unsupported.
    pub fn facts(
        &self,
        population_id: &str,
        digest: &str,
        spec: &ProposedPopulation,
    ) -> Vec<InputFact> {
        spec.values
            .iter()
            .zip(&self.values)
            .filter_map(|(column, value)| {
                let (state, support, measure_grounded) = match value {
                    MemberValue::Missing => return None,
                    MemberValue::Value {
                        value,
                        measure_grounded,
                    } => (
                        FactState::Value(value.clone()),
                        FactSupport::Supported,
                        *measure_grounded,
                    ),
                    // The evaluator never reads an unsupported value: it
                    // only says the fact is unsupported (`fact_unsupported`).
                    MemberValue::Unsupported => (
                        FactState::Value(FactValue::Text("unsupported".into())),
                        FactSupport::Unsupported(UnsupportedReason::TypeMismatch),
                        None,
                    ),
                };
                Some(InputFact {
                    id: format!("{population_id}#{}/{}", self.ordinal, column.name),
                    digest: digest.into(),
                    name: column.name.clone(),
                    state,
                    support,
                    subject_grounded: true,
                    measure_grounded,
                    effective: None,
                })
            })
            .collect()
    }
}

// ------------------------------------------------------------ completeness

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Completeness {
    Complete,
    Incomplete(IncompleteReason),
}
impl Completeness {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Complete => "complete",
            Self::Incomplete(_) => "incomplete",
        }
    }
    pub const fn reason(self) -> Option<IncompleteReason> {
        match self {
            Self::Incomplete(r) => Some(r),
            Self::Complete => None,
        }
    }
    pub const fn complete(self) -> bool {
        matches!(self, Self::Complete)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reconciliation {
    Matched,
    Mismatch { declared: u64, distinct: u64 },
    NotDeclared,
}
impl Reconciliation {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Matched => "matched",
            Self::Mismatch { .. } => "mismatch",
            Self::NotDeclared => "not_declared",
        }
    }
}

/// Completeness and reconciliation, derived by trusted code and never
/// asserted by the model: complete only when the agent stated the source is
/// exhaustive, the read was not truncated, every data row to the sheet's
/// last row was read, and a declared control count (if any) equals the
/// distinct subjects. The first failing condition, in that order, is the
/// reason.
pub fn completeness(
    exhaustive: bool,
    enumeration: &Enumeration,
    declared: Option<u64>,
    distinct: u64,
) -> (Completeness, Reconciliation) {
    let reconciliation = match declared {
        None => Reconciliation::NotDeclared,
        Some(d) if d == distinct => Reconciliation::Matched,
        Some(declared) => Reconciliation::Mismatch { declared, distinct },
    };
    let read_all = !enumeration.truncated
        && enumeration.last_row >= enumeration.header_row
        && enumeration.rows_read == enumeration.last_row - enumeration.header_row;
    let completeness = if !exhaustive {
        Completeness::Incomplete(IncompleteReason::NotExhaustive)
    } else if !read_all {
        Completeness::Incomplete(IncompleteReason::RowBound)
    } else if matches!(reconciliation, Reconciliation::Mismatch { .. }) {
        Completeness::Incomplete(IncompleteReason::CountMismatch)
    } else {
        Completeness::Complete
    };
    (completeness, reconciliation)
}

/// Exact counts of a population's received rows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PopulationCounts {
    pub received_rows: u64,
    pub unkeyed: u64,
    pub duplicate_rows: u64,
    pub distinct_subjects: u64,
    pub excluded_out_of_period: u64,
    pub scope_unknown_period_unparsed: u64,
    pub scope_unknown_period_missing: u64,
    pub scope_unknown_conflicting_duplicate: u64,
    pub in_scope: u64,
}
impl PopulationCounts {
    /// Counts of rows by disposition; subjects are counted once (rows of one
    /// conflicting key are one subject).
    pub fn of(members: &[(Option<&str>, Disposition)]) -> Self {
        let mut counts = Self {
            received_rows: members.len() as u64,
            ..Self::default()
        };
        let mut distinct: BTreeSet<&str> = BTreeSet::new();
        let mut conflicting: BTreeSet<&str> = BTreeSet::new();
        for (subject, disposition) in members {
            if let Some(subject) = subject {
                distinct.insert(subject);
            }
            match disposition {
                Disposition::Unkeyed => counts.unkeyed += 1,
                Disposition::DuplicateRow { .. } => counts.duplicate_rows += 1,
                Disposition::InScope => counts.in_scope += 1,
                Disposition::Excluded(_) => counts.excluded_out_of_period += 1,
                Disposition::ScopeUnknown(DispositionReason::PeriodUnparsed) => {
                    counts.scope_unknown_period_unparsed += 1
                }
                Disposition::ScopeUnknown(DispositionReason::PeriodMissing) => {
                    counts.scope_unknown_period_missing += 1
                }
                Disposition::ScopeUnknown(_) => {
                    if let Some(subject) = subject {
                        conflicting.insert(subject);
                    }
                }
            }
        }
        counts.scope_unknown_conflicting_duplicate = conflicting.len() as u64;
        counts.distinct_subjects = distinct.len() as u64;
        counts
    }
    pub fn scope_unknown(&self) -> u64 {
        self.scope_unknown_period_unparsed
            + self.scope_unknown_period_missing
            + self.scope_unknown_conflicting_duplicate
    }
    /// Subjects are the in-scope, excluded and scope-unknown keyed subjects.
    pub fn is_consistent(&self) -> bool {
        self.distinct_subjects == self.in_scope + self.excluded_out_of_period + self.scope_unknown()
            && self.unkeyed + self.duplicate_rows <= self.received_rows
    }
}

// ------------------------------------------------------------------ samples

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SampleMethod {
    AllInScope,
    Judgmental,
    SeededRandom { seed: u64 },
}
impl SampleMethod {
    pub const fn kind(&self) -> SampleMethodKind {
        match self {
            Self::AllInScope => SampleMethodKind::AllInScope,
            Self::Judgmental => SampleMethodKind::Judgmental,
            Self::SeededRandom { .. } => SampleMethodKind::SeededRandom,
        }
    }
    pub const fn seed(&self) -> Option<u64> {
        match self {
            Self::SeededRandom { seed } => Some(*seed),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Substitution {
    pub replaced: String,
    pub substitute: String,
    pub reason: String,
}

/// A sample manifest version as proposed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposedSample {
    pub key: String,
    /// A population ID, or the key of the population proposed in the same
    /// answer.
    pub population: String,
    pub method: SampleMethod,
    pub size: u32,
    pub strata: String,
    pub justification: String,
    /// The selected subject keys (empty for `all_in_scope`: trusted code
    /// selects every in-scope subject).
    pub keys: Vec<String>,
    pub substitutions: Vec<Substitution>,
}
impl ProposedSample {
    pub fn is_valid(&self) -> bool {
        let distinct = |list: &[String]| list.iter().collect::<BTreeSet<_>>().len() == list.len();
        valid_scope_id(&self.key)
            && !record_shaped(&self.key)
            && valid_scope_id(&self.population)
            && self.size <= MAX_POPULATION_ROWS
            && (self.strata.is_empty() || text_ok(&self.strata, MAX_STRATA_BYTES))
            && text_ok(&self.justification, MAX_JUSTIFICATION_BYTES)
            && self.keys.len() <= MAX_SAMPLE_KEYS
            && self.keys.iter().all(|k| valid_subject(k))
            && distinct(&self.keys)
            && match self.method {
                SampleMethod::AllInScope => self.keys.is_empty() && self.substitutions.is_empty(),
                _ => self.keys.len() == self.size as usize && self.size > 0,
            }
            && self.substitutions.len() <= MAX_SAMPLE_SUBSTITUTIONS
            && self.substitutions.iter().all(|s| {
                valid_subject(&s.replaced)
                    && valid_subject(&s.substitute)
                    && s.replaced != s.substitute
                    && text_ok(&s.reason, MAX_SUBSTITUTION_REASON_BYTES)
            })
    }
}

/// SplitMix64 (Steele, Lea and Flood 2014): one step.
pub fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// `splitmix64-fisher-yates-v1`: a partial Fisher–Yates shuffle of the
/// C-ordered (byte-ordered) keys driven by SplitMix64 from `seed`; position
/// `i` swaps with `i + r mod (n - i)`, where draws `r` at or above the
/// largest multiple of `n - i` are rejected (no modulo bias). The first
/// `size` keys after shuffling are the selection, in selection order.
pub fn seeded_selection(c_ordered: &[String], seed: u64, size: usize) -> Vec<String> {
    let mut keys = c_ordered.to_vec();
    let n = keys.len();
    let size = size.min(n);
    let mut state = seed;
    for i in 0..size {
        let bound = (n - i) as u64;
        let limit = u64::MAX - u64::MAX % bound;
        let draw = loop {
            let r = splitmix64(&mut state);
            if r < limit {
                break r;
            }
        };
        keys.swap(i, i + (draw % bound) as usize);
    }
    keys.truncate(size);
    keys
}

/// Why trusted code refused a sample. Said in words to the agent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SampleRefusal {
    /// A key is not an in-scope subject of the population.
    NotInScope(String),
    /// The recomputed seeded selection differs from the agent's keys.
    SelectionMismatch,
    /// The stated size is not the number of in-scope subjects.
    SizeMismatch { size: u32, in_scope: u64 },
    /// A substitution does not replace a selected key with an in-scope one.
    Substitution(String),
}

/// Check a proposed sample against a population's in-scope subjects and
/// return the selected keys, in C order. Every key must be an in-scope
/// subject; a seeded selection is recomputed and must equal the agent's
/// keys after its substitutions.
pub fn check_sample(
    sample: &ProposedSample,
    in_scope: &BTreeSet<String>,
) -> Result<Vec<String>, SampleRefusal> {
    if let SampleMethod::AllInScope = sample.method {
        if u64::from(sample.size) != in_scope.len() as u64 {
            return Err(SampleRefusal::SizeMismatch {
                size: sample.size,
                in_scope: in_scope.len() as u64,
            });
        }
        return Ok(in_scope.iter().cloned().collect());
    }
    if let Some(key) = sample.keys.iter().find(|k| !in_scope.contains(*k)) {
        return Err(SampleRefusal::NotInScope(key.clone()));
    }
    let chosen: BTreeSet<&String> = sample.keys.iter().collect();
    for s in &sample.substitutions {
        if !in_scope.contains(&s.replaced)
            || !chosen.contains(&s.substitute)
            || chosen.contains(&s.replaced)
        {
            return Err(SampleRefusal::Substitution(s.replaced.clone()));
        }
    }
    if let SampleMethod::SeededRandom { seed } = sample.method {
        let ordered: Vec<String> = in_scope.iter().cloned().collect();
        let mut expected: BTreeSet<String> = seeded_selection(&ordered, seed, sample.size as usize)
            .into_iter()
            .collect();
        for s in &sample.substitutions {
            if !expected.remove(&s.replaced) {
                return Err(SampleRefusal::Substitution(s.replaced.clone()));
            }
            expected.insert(s.substitute.clone());
        }
        let stated: BTreeSet<String> = sample.keys.iter().cloned().collect();
        if expected != stated {
            return Err(SampleRefusal::SelectionMismatch);
        }
    }
    let mut keys = sample.keys.clone();
    keys.sort();
    Ok(keys)
}

// ----------------------------------------------------------------- summary

/// One opportunity (subject × criterion) as the summary reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpportunityFacts {
    pub subject: String,
    pub applicability: Applicability,
    pub execution: Execution,
    pub verdict: Option<Verdict>,
    pub reason: Option<EvaluationReason>,
}
impl OpportunityFacts {
    /// No not_met, but not proven either: applicability unknown, an
    /// undetermined verdict, a failed execution, or an applicable criterion
    /// with no verdict yet (a judgment not proposed).
    fn unknown(&self) -> bool {
        self.execution == Execution::Failed
            || self.applicability == Applicability::Unknown
            || (self.applicability == Applicability::Applicable
                && self.verdict != Some(Verdict::Met)
                && self.verdict != Some(Verdict::NotMet))
    }
}

/// Exact counts of one criterion over the summary's subjects. Applicable,
/// not applicable and unknown applicability add up to the subjects; met,
/// not met, undetermined, execution failed and not evaluated add up to the
/// applicable ones.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CriterionCounts {
    pub criterion_id: String,
    pub applicable: u64,
    pub not_applicable: u64,
    pub applicability_unknown: u64,
    pub met: u64,
    pub not_met: u64,
    pub undetermined: u64,
    /// Undetermined by closed reason ([`STATED_IN_WORDS`] for a model's own
    /// undetermined proposal), in reason order.
    pub undetermined_by_reason: BTreeMap<String, u64>,
    pub execution_failed: u64,
    pub not_evaluated: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Partition {
    pub failing: u64,
    pub meets_every_applicable: u64,
    pub unresolved: u64,
    pub not_applicable_to_any: u64,
}

/// The coverage summary: exact counts, a closed conclusion and limitations
/// in words. `statistical_inference` is always false in Story 24.2.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Summary {
    pub completeness: Completeness,
    pub reconciliation: Reconciliation,
    pub counts: PopulationCounts,
    /// The selected subjects of a sample summary; None for a population.
    pub selected: Option<u64>,
    pub criteria: Vec<CriterionCounts>,
    pub partition: Partition,
    /// Not-met opportunities over every criterion: a count of opportunities,
    /// never of failing records.
    pub failing_opportunities: u64,
    pub conclusion: Conclusion,
    pub limitations: Vec<String>,
}

/// The population facts a summary reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PopulationFacts {
    pub completeness: Completeness,
    pub reconciliation: Reconciliation,
    pub counts: PopulationCounts,
}

/// One criterion of the summary's basis: its ID, whether it is a judgment
/// criterion, and its opportunities over the population's in-scope subjects.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CriterionOpportunities {
    pub criterion_id: String,
    pub judgment: bool,
    pub opportunities: Vec<OpportunityFacts>,
}

/// The closed conclusion rule. `unresolved` includes, for a population,
/// subjects whose scope is unknown.
pub fn conclusion(
    complete: bool,
    sample: bool,
    received_rows: u64,
    partition: &Partition,
    scope_unknown: u64,
) -> Conclusion {
    let unresolved = partition.unresolved + if sample { 0 } else { scope_unknown };
    if !complete && received_rows == 0 {
        Conclusion::NoItemsFoundAbsenceNotProven
    } else if partition.failing > 0 {
        if unresolved > 0 || !complete {
            Conclusion::ExceptionsFoundInconclusive
        } else {
            Conclusion::ExceptionsFound
        }
    } else if complete && unresolved == 0 && partition.meets_every_applicable == 0 {
        Conclusion::NoEligibleItems
    } else if complete && !sample && unresolved == 0 {
        Conclusion::NoExceptionFound
    } else {
        Conclusion::Inconclusive
    }
}

/// Pure: the same manifest, opportunities and sample always give the same
/// summary (and the same canonical digest). The subjects are the
/// population's in-scope subjects, or the sample's selected subjects; an
/// opportunity of any other subject is not counted. A subject with no
/// opportunity of a criterion counts as not evaluated with unknown
/// applicability for it. Rule: `subject_partition_v1`.
pub fn summarise(
    population: &PopulationFacts,
    in_scope: &BTreeSet<String>,
    criteria: &[CriterionOpportunities],
    sample: Option<&BTreeSet<String>>,
) -> Summary {
    let domain: &BTreeSet<String> = sample.unwrap_or(in_scope);
    let mut outcomes: BTreeMap<&str, (bool, bool, bool)> = domain
        .iter()
        .map(|s| (s.as_str(), (false, false, false)))
        .collect(); // (any not_met, any unknown, any met)
    let mut counts = Vec::new();
    let mut failing_opportunities = 0u64;
    let mut limitations = Vec::new();
    for criterion in criteria {
        let mut c = CriterionCounts {
            criterion_id: criterion.criterion_id.clone(),
            ..CriterionCounts::default()
        };
        let mut seen: BTreeSet<&str> = BTreeSet::new();
        for o in &criterion.opportunities {
            let Some(entry) = outcomes.get_mut(o.subject.as_str()) else {
                continue;
            };
            if !seen.insert(o.subject.as_str()) {
                continue;
            }
            match o.applicability {
                Applicability::NotApplicable => c.not_applicable += 1,
                Applicability::Unknown => c.applicability_unknown += 1,
                Applicability::Applicable => {
                    c.applicable += 1;
                    if o.execution == Execution::Failed {
                        c.execution_failed += 1;
                    } else {
                        match o.verdict {
                            Some(Verdict::Met) => c.met += 1,
                            Some(Verdict::NotMet) => c.not_met += 1,
                            Some(Verdict::Undetermined) => {
                                c.undetermined += 1;
                                *c.undetermined_by_reason
                                    .entry(
                                        o.reason
                                            .map_or(STATED_IN_WORDS, EvaluationReason::as_str)
                                            .to_string(),
                                    )
                                    .or_default() += 1;
                            }
                            None => c.not_evaluated += 1,
                        }
                    }
                }
            }
            if o.verdict == Some(Verdict::NotMet) && o.execution == Execution::Completed {
                entry.0 = true;
            } else if o.unknown() {
                entry.1 = true;
            } else if o.verdict == Some(Verdict::Met) {
                entry.2 = true;
            }
        }
        // A subject with no opportunity of this criterion was not evaluated.
        let missing = domain.len() as u64 - seen.len() as u64;
        if missing > 0 {
            c.applicability_unknown += missing;
            for subject in domain {
                if !seen.contains(subject.as_str())
                    && let Some(entry) = outcomes.get_mut(subject.as_str())
                {
                    entry.1 = true;
                }
            }
            limitations.push(format!(
                "Criterion {} was not evaluated for {missing} of these items.",
                criterion.criterion_id
            ));
        }
        if criterion.judgment && c.not_evaluated > 0 {
            limitations.push(format!(
                "Judgment criterion {} has no recorded judgment for {} applicable items at this population's subject unit; judgments recorded at another unit or basis are not counted.",
                criterion.criterion_id, c.not_evaluated
            ));
        }
        failing_opportunities += c.not_met;
        counts.push(c);
    }
    let mut partition = Partition::default();
    for (not_met, unknown, met) in outcomes.values() {
        if *not_met {
            partition.failing += 1;
        } else if *unknown {
            partition.unresolved += 1;
        } else if *met {
            partition.meets_every_applicable += 1;
        } else {
            partition.not_applicable_to_any += 1;
        }
    }
    let complete = population.completeness.complete();
    if let Some(selected) = sample {
        limitations.push(format!(
            "A sample of {} selected items: the counts describe the selected items only, never the population.",
            selected.len()
        ));
    }
    if population.counts.scope_unknown() > 0 && sample.is_none() {
        limitations.push(format!(
            "{} subjects have an unknown scope; they are unresolved.",
            population.counts.scope_unknown()
        ));
    }
    let conclusion = conclusion(
        complete,
        sample.is_some(),
        population.counts.received_rows,
        &partition,
        population.counts.scope_unknown(),
    );
    limitations.truncate(MAX_SUMMARY_LIMITATIONS);
    Summary {
        completeness: population.completeness,
        reconciliation: population.reconciliation,
        counts: population.counts,
        selected: sample.map(|s| s.len() as u64),
        criteria: counts,
        partition,
        failing_opportunities,
        conclusion,
        limitations,
    }
}

fn int(value: u64) -> JsonValue {
    JsonValue::Integer(value.min(i64::MAX as u64) as i64)
}
fn string(value: &str) -> JsonValue {
    JsonValue::String(value.into())
}
fn object(fields: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())
}

impl Summary {
    /// The canonical summary document: every count, the conclusion and the
    /// aggregation rule. No percentage, no inference, no confidence.
    pub fn document(&self) -> JsonValue {
        let c = &self.counts;
        let (declared, distinct) = match self.reconciliation {
            Reconciliation::Mismatch { declared, distinct } => (int(declared), int(distinct)),
            _ => (JsonValue::Null, JsonValue::Null),
        };
        object(vec![
            ("aggregation", string(AGGREGATION_RULE)),
            ("completeness", string(self.completeness.as_str())),
            (
                "completeness_reason",
                self.completeness
                    .reason()
                    .map_or(JsonValue::Null, |r| string(r.as_str())),
            ),
            ("reconciliation", string(self.reconciliation.as_str())),
            ("mismatch_declared", declared),
            ("mismatch_distinct", distinct),
            ("received_rows", int(c.received_rows)),
            ("unkeyed", int(c.unkeyed)),
            ("duplicate_rows", int(c.duplicate_rows)),
            ("distinct_subjects", int(c.distinct_subjects)),
            ("excluded_out_of_period", int(c.excluded_out_of_period)),
            (
                "scope_unknown_period_unparsed",
                int(c.scope_unknown_period_unparsed),
            ),
            (
                "scope_unknown_period_missing",
                int(c.scope_unknown_period_missing),
            ),
            (
                "scope_unknown_conflicting_duplicate",
                int(c.scope_unknown_conflicting_duplicate),
            ),
            ("in_scope", int(c.in_scope)),
            ("selected", self.selected.map_or(JsonValue::Null, int)),
            (
                "criteria",
                JsonValue::Array(
                    self.criteria
                        .iter()
                        .map(|k| {
                            object(vec![
                                ("criterion_id", string(&k.criterion_id)),
                                ("applicable", int(k.applicable)),
                                ("not_applicable", int(k.not_applicable)),
                                ("applicability_unknown", int(k.applicability_unknown)),
                                ("met", int(k.met)),
                                ("not_met", int(k.not_met)),
                                ("undetermined", int(k.undetermined)),
                                (
                                    "undetermined_by_reason",
                                    JsonValue::Object(
                                        k.undetermined_by_reason
                                            .iter()
                                            .map(|(r, n)| (r.clone(), int(*n)))
                                            .collect(),
                                    ),
                                ),
                                ("execution_failed", int(k.execution_failed)),
                                ("not_evaluated", int(k.not_evaluated)),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("failing", int(self.partition.failing)),
            (
                "meets_every_applicable",
                int(self.partition.meets_every_applicable),
            ),
            ("unresolved", int(self.partition.unresolved)),
            (
                "not_applicable_to_any",
                int(self.partition.not_applicable_to_any),
            ),
            ("failing_opportunities", int(self.failing_opportunities)),
            ("conclusion", string(self.conclusion.as_str())),
            (
                "limitations",
                JsonValue::Array(self.limitations.iter().map(|l| string(l)).collect()),
            ),
            ("statistical_inference", JsonValue::Bool(false)),
        ])
    }
    /// SHA-256 of the canonical summary document.
    pub fn digest(&self) -> String {
        sha256_hex(canonical_json(&self.document()).as_bytes())
    }
    /// The structural rules the database also enforces.
    pub fn is_consistent(&self) -> bool {
        let domain = self.selected.unwrap_or(self.counts.in_scope);
        let p = &self.partition;
        self.counts.is_consistent()
            && p.failing + p.meets_every_applicable + p.unresolved + p.not_applicable_to_any
                == domain
            && self.criteria.iter().all(|k| {
                k.applicable + k.not_applicable + k.applicability_unknown == domain
                    && k.met + k.not_met + k.undetermined + k.execution_failed + k.not_evaluated
                        == k.applicable
                    && k.undetermined_by_reason.values().sum::<u64>() == k.undetermined
            })
            && self.failing_opportunities == self.criteria.iter().map(|k| k.not_met).sum::<u64>()
            && self.conclusion
                == conclusion(
                    self.completeness.complete(),
                    self.selected.is_some(),
                    self.counts.received_rows,
                    p,
                    self.counts.scope_unknown(),
                )
    }
}

// ------------------------------------------------------ answer schema, decode

fn s(max: usize) -> ArgumentSchema {
    ArgumentSchema::String {
        max_bytes: max as u32,
        enumeration: vec![],
    }
}
fn e(values: &[&str]) -> ArgumentSchema {
    ArgumentSchema::String {
        max_bytes: 32,
        enumeration: values.iter().map(|v| (*v).into()).collect(),
    }
}
fn obj(fields: Vec<(&str, ArgumentSchema)>) -> ArgumentSchema {
    let required = fields.iter().map(|(k, _)| (*k).to_string()).collect();
    ArgumentSchema::Object {
        properties: fields.into_iter().map(|(k, v)| (k.into(), v)).collect(),
        required,
    }
}
fn arr(items: ArgumentSchema, max: usize) -> ArgumentSchema {
    ArgumentSchema::Array {
        items: Box::new(items),
        max_items: max as u32,
    }
}
const PERIOD_RULES: [&str; 4] = ["", "date_iso", "date_dmy", "instant_rfc3339"];
const COUNT_RULES: [&str; 3] = ["", "decimal_plain", "decimal_grouped_comma"];

/// The four Story 24.2 answer fields, offered with the assessment fields.
/// Every property is required (strict output); `""` means none.
pub fn answer_fields() -> Vec<(&'static str, ArgumentSchema)> {
    let types: Vec<&str> = FactType::ALL.iter().map(|t| t.as_str()).collect();
    let rules: Vec<&str> = ParseRule::ALL.iter().map(|r| r.as_str()).collect();
    let methods: Vec<&str> = SampleMethodKind::ALL.iter().map(|m| m.as_str()).collect();
    let population = obj(vec![
        ("key", s(128)),
        ("basis", s(128)),
        ("supersedes", s(128)),
        ("original_id", s(128)),
        ("sheet", s(MAX_SHEET_BYTES)),
        (
            "header_row",
            ArgumentSchema::Integer {
                minimum: 1,
                maximum: i64::from(MAX_HEADER_ROW),
            },
        ),
        ("subject_unit", s(64)),
        ("grain", arr(s(MAX_HEADER_BYTES), MAX_GRAIN_COLUMNS)),
        ("period_column", s(MAX_HEADER_BYTES)),
        ("period_rule", e(&PERIOD_RULES)),
        (
            "value_columns",
            arr(
                obj(vec![
                    ("header", s(MAX_HEADER_BYTES)),
                    ("name", s(64)),
                    ("type", e(&types)),
                    ("rule", e(&rules)),
                    ("unit", s(64)),
                    ("currency", s(3)),
                    ("measure_column", s(MAX_HEADER_BYTES)),
                ]),
                MAX_VALUE_COLUMNS,
            ),
        ),
        ("exhaustive", ArgumentSchema::Boolean),
        ("control_original_id", s(128)),
        ("control_locator", s(MAX_LOCATOR_BYTES)),
        ("control_quote", s(64)),
        ("control_rule", e(&COUNT_RULES)),
        ("selection", s(MAX_SELECTION_BYTES)),
    ]);
    let sample = obj(vec![
        ("key", s(128)),
        ("population", s(128)),
        ("method", e(&methods)),
        ("seed", s(20)),
        (
            "size",
            ArgumentSchema::Integer {
                minimum: 0,
                maximum: i64::from(MAX_POPULATION_ROWS),
            },
        ),
        ("strata", s(MAX_STRATA_BYTES)),
        ("justification", s(MAX_JUSTIFICATION_BYTES)),
        ("keys", arr(s(MAX_SUBJECT_BYTES), MAX_SAMPLE_KEYS)),
        (
            "substitutions",
            arr(
                obj(vec![
                    ("replaced", s(MAX_SUBJECT_BYTES)),
                    ("substitute", s(MAX_SUBJECT_BYTES)),
                    ("reason", s(MAX_SUBSTITUTION_REASON_BYTES)),
                ]),
                MAX_SAMPLE_SUBSTITUTIONS,
            ),
        ),
    ]);
    let evaluate = obj(vec![("criterion", s(128)), ("population", s(128))]);
    let summarise = obj(vec![
        ("basis", s(128)),
        ("population", s(128)),
        ("sample", s(128)),
    ]);
    vec![
        (
            "propose_population",
            arr(population, MAX_PROPOSED_POPULATIONS),
        ),
        ("propose_sample", arr(sample, MAX_PROPOSED_SAMPLES)),
        (
            "evaluate_population",
            arr(evaluate, MAX_EVALUATE_POPULATION),
        ),
        ("summarise", arr(summarise, MAX_SUMMARISE)),
    ]
}

/// A criterion to evaluate over every in-scope member of a population.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PopulationEvaluation {
    pub criterion: String,
    pub population: String,
}

/// A coverage summary request: the basis, the population and an optional
/// sample (IDs, or keys of records in the same answer).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SummaryRequest {
    pub basis: String,
    pub population: String,
    pub sample: Option<String>,
}

type Object = BTreeMap<String, JsonValue>;
fn object_of(value: &JsonValue) -> Option<&Object> {
    match value {
        JsonValue::Object(map) => Some(map),
        _ => None,
    }
}
fn text<'a>(object: &'a Object, key: &str) -> Option<&'a str> {
    match object.get(key)? {
        JsonValue::String(v) => Some(v),
        _ => None,
    }
}
fn integer(object: &Object, key: &str) -> Option<i64> {
    match object.get(key)? {
        JsonValue::Integer(v) => Some(*v),
        _ => None,
    }
}
fn strings(object: &Object, key: &str) -> Option<Vec<String>> {
    match object.get(key)? {
        JsonValue::Array(items) => items
            .iter()
            .map(|i| match i {
                JsonValue::String(s) => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => None,
    }
}
fn optional(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

pub fn decode_population(value: &JsonValue) -> Option<ProposedPopulation> {
    let o = object_of(value)?;
    let values = match o.get("value_columns")? {
        JsonValue::Array(items) => items
            .iter()
            .map(|item| {
                let v = object_of(item)?;
                Some(ValueColumn {
                    header: text(v, "header")?.into(),
                    name: text(v, "name")?.into(),
                    kind: FactType::parse(text(v, "type")?)?,
                    rule: ParseRule::parse(text(v, "rule")?)?,
                    measure: Measure::from_fields(text(v, "unit")?, text(v, "currency")?)?,
                    measure_column: optional(text(v, "measure_column")?),
                })
            })
            .collect::<Option<Vec<_>>>()?,
        _ => return None,
    };
    let period = match (text(o, "period_column")?, text(o, "period_rule")?) {
        ("", "") => None,
        (column, rule) if !column.is_empty() => Some((column.into(), ParseRule::parse(rule)?)),
        _ => return None,
    };
    let control = match (
        text(o, "control_original_id")?,
        text(o, "control_locator")?,
        text(o, "control_quote")?,
        text(o, "control_rule")?,
    ) {
        ("", "", "", "") => None,
        (original_id, locator, quote, rule) => Some(ControlCount {
            source: CitationSource {
                original_id: original_id.into(),
                locator: Locator::parse(locator),
                quote: quote.into(),
            },
            rule: ParseRule::parse(rule)?,
        }),
    };
    let exhaustive = match o.get("exhaustive")? {
        JsonValue::Bool(b) => *b,
        _ => return None,
    };
    let population = ProposedPopulation {
        key: text(o, "key")?.into(),
        basis: text(o, "basis")?.into(),
        supersedes: optional(text(o, "supersedes")?),
        original_id: text(o, "original_id")?.into(),
        sheet: optional(text(o, "sheet")?),
        header_row: u32::try_from(integer(o, "header_row")?).ok()?,
        subject_unit: text(o, "subject_unit")?.into(),
        grain: strings(o, "grain")?,
        period,
        values,
        exhaustive,
        control,
        selection: text(o, "selection")?.into(),
    };
    population.is_valid().then_some(population)
}

pub fn decode_sample(value: &JsonValue) -> Option<ProposedSample> {
    let o = object_of(value)?;
    let method = match SampleMethodKind::parse(text(o, "method")?)? {
        SampleMethodKind::AllInScope => SampleMethod::AllInScope,
        SampleMethodKind::Judgmental => SampleMethod::Judgmental,
        SampleMethodKind::SeededRandom => {
            let seed = text(o, "seed")?;
            if seed.is_empty()
                || !seed.bytes().all(|b| b.is_ascii_digit())
                || (seed.len() > 1 && seed.starts_with('0'))
            {
                return None;
            }
            SampleMethod::SeededRandom {
                seed: seed.parse().ok()?,
            }
        }
    };
    if method.seed().is_none() && !text(o, "seed")?.is_empty() {
        return None;
    }
    let substitutions = match o.get("substitutions")? {
        JsonValue::Array(items) => items
            .iter()
            .map(|item| {
                let v = object_of(item)?;
                Some(Substitution {
                    replaced: text(v, "replaced")?.into(),
                    substitute: text(v, "substitute")?.into(),
                    reason: text(v, "reason")?.into(),
                })
            })
            .collect::<Option<Vec<_>>>()?,
        _ => return None,
    };
    let sample = ProposedSample {
        key: text(o, "key")?.into(),
        population: text(o, "population")?.into(),
        method,
        size: u32::try_from(integer(o, "size")?).ok()?,
        strata: text(o, "strata")?.into(),
        justification: text(o, "justification")?.into(),
        keys: strings(o, "keys")?,
        substitutions,
    };
    sample.is_valid().then_some(sample)
}

pub fn decode_evaluation(value: &JsonValue) -> Option<PopulationEvaluation> {
    let o = object_of(value)?;
    let request = PopulationEvaluation {
        criterion: text(o, "criterion")?.into(),
        population: text(o, "population")?.into(),
    };
    (valid_scope_id(&request.criterion) && valid_scope_id(&request.population)).then_some(request)
}

pub fn decode_summary(value: &JsonValue) -> Option<SummaryRequest> {
    let o = object_of(value)?;
    let request = SummaryRequest {
        basis: text(o, "basis")?.into(),
        population: text(o, "population")?.into(),
        sample: optional(text(o, "sample")?),
    };
    (valid_scope_id(&request.basis)
        && valid_scope_id(&request.population)
        && request.sample.as_deref().is_none_or(valid_scope_id))
    .then_some(request)
}

#[cfg(test)]
mod tests;
