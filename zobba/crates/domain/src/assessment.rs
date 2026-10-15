//! Story 24.1: typed criteria and facts bound to an assessment basis.
//!
//! The agent proposes criteria, one assessment basis, typed facts and
//! judgments as structured answer fields. Trusted code keeps a proposal only
//! after it checks it: authority and fact quotes are verified at their exact
//! source location (Story 22.5), a typed value is re-parsed from the verified
//! quote under a declared rule, and a rule criterion is decided by the pure
//! predicates in this module, never by the model. Applicability, execution,
//! verdict and origin are separate fields. There is no confidence score, no
//! floating point and no time-zone database: an exact decimal is an `i128`
//! mantissa with a scale, and an instant is UTC microseconds plus the offset
//! the source stated.
use std::{cmp::Ordering, collections::BTreeMap};

use crate::{
    citation::{CitationSource, Locator, MAX_LOCATOR_BYTES, MAX_QUOTE_BYTES, normalize},
    context::canonical_json,
    identity::valid_scope_id,
    model::{ArgumentSchema, JsonValue},
    work::sha256_hex,
};

/// Answer bounds (owner-approved shape of Story 24.1).
pub const MAX_PROPOSED_CRITERIA: usize = 8;
pub const MAX_PROPOSED_BASES: usize = 1;
pub const MAX_RECORDED_FACTS: usize = 64;
pub const MAX_EVALUATE: usize = 16;
pub const MAX_JUDGMENTS: usize = 8;
/// Text bounds, in UTF-8 bytes.
pub const MAX_ASSERTION_BYTES: usize = 1_000;
pub const MAX_RUBRIC_BYTES: usize = 2_000;
pub const MAX_RATIONALE_BYTES: usize = 2_000;
pub const MAX_OBJECTIVE_BYTES: usize = 1_000;
pub const MAX_SELECTION_BYTES: usize = 500;
pub const MAX_BASIS_LIMITATION_BYTES: usize = 500;
pub const MAX_SUBJECT_BYTES: usize = 128;
pub const MAX_TEXT_VALUE_BYTES: usize = 1_000;
pub const MAX_ENUM_VALUE_BYTES: usize = 128;
pub const MAX_NAME_BYTES: usize = 64;
/// Collection bounds.
pub const MAX_REQUIRED_FACTS: usize = 8;
pub const MAX_MEMBER_VALUES: usize = 16;
pub const MAX_BASIS_CRITERIA: usize = 16;
pub const MAX_POPULATION_REFERENCES: usize = 8;
pub const MAX_BASIS_LIMITATIONS: usize = 8;
pub const MAX_FACT_SOURCES: usize = 4;
pub const MAX_JUDGMENT_FACTS: usize = 8;
pub const MAX_CRITERION_ORDINAL: u32 = 31;
pub const MAX_AMBIGUOUS_CANDIDATES: u32 = 64;
/// An exact decimal has at most this many digits in total; scale alignment
/// of two such values therefore never overflows `i128`.
pub const MAX_DECIMAL_DIGITS: usize = 19;
pub const MAX_DECIMAL_SCALE: u8 = 18;
/// Source offsets beyond UTC±14:00 are not real offsets.
pub const MAX_OFFSET_MINUTES: i16 = 14 * 60;

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

vocabulary!(FactType {
    Identifier => "identifier",
    Text => "text",
    Boolean => "boolean",
    Enum => "enum",
    Decimal => "decimal",
    Date => "date",
    Instant => "instant",
});

// How trusted code derives a typed value from a verified quote. Closed.
vocabulary!(ParseRule {
    IdentifierExact => "identifier_exact",
    TextExact => "text_exact",
    EnumExact => "enum_exact",
    BooleanYesNo => "boolean_yes_no",
    BooleanTrueFalse => "boolean_true_false",
    DecimalPlain => "decimal_plain",
    DecimalGroupedComma => "decimal_grouped_comma",
    DateIso => "date_iso",
    DateDmy => "date_dmy",
    InstantRfc3339 => "instant_rfc3339",
});

// Why a fact has no value.
vocabulary!(UnavailableReason {
    EvidenceUnavailable => "evidence_unavailable",
    ActionNotPermitted => "action_not_permitted",
    ToolUnavailable => "tool_unavailable",
    SourceUnreadable => "source_unreadable",
});

// Why trusted code does not support a proposed value.
vocabulary!(UnsupportedReason {
    TypeMismatch => "type_mismatch",
    SourceUnverified => "source_unverified",
    AnalysisFailed => "analysis_failed",
});

vocabulary!(Comparison {
    Lt => "lt",
    Le => "le",
    Eq => "eq",
    Ge => "ge",
    Gt => "gt",
});

vocabulary!(PredicateKind {
    CompareConstant => "compare_constant",
    CompareFacts => "compare_facts",
    WithinPeriod => "within_period",
    IdentifiersEqual => "identifiers_equal",
    IdentifiersDiffer => "identifiers_differ",
    MemberOf => "member_of",
    Present => "present",
    IsTrue => "is_true",
});

vocabulary!(CriterionKind {
    Rule => "rule",
    Judgment => "judgment",
});

vocabulary!(AuthorityKind {
    Method => "method",
    Original => "original",
});

// Why a criterion's authority is not verified.
vocabulary!(AuthorityReason {
    NotFoundAtLocation => "not_found_at_location",
    LocationMissing => "location_missing",
    SourceUnreadable => "source_unreadable",
    PageOnly => "page_only",
    MethodChanged => "method_changed",
    CriterionNotFound => "criterion_not_found",
});

// What a missing or ambiguous input does. Story 24.1 has one treatment.
vocabulary!(MissingTreatment {
    Undetermined => "undetermined",
});

vocabulary!(Applicability {
    Applicable => "applicable",
    NotApplicable => "not_applicable",
    Unknown => "unknown",
});

vocabulary!(Execution {
    Completed => "completed",
    Failed => "failed",
});

vocabulary!(Verdict {
    Met => "met",
    NotMet => "not_met",
    Undetermined => "undetermined",
});

vocabulary!(Origin {
    Deterministic => "deterministic",
    ModelProposal => "model_proposal",
});

vocabulary!(EvaluationReason {
    MissingFact => "missing_fact",
    FactUnavailable => "fact_unavailable",
    FactAmbiguous => "fact_ambiguous",
    FactUnsupported => "fact_unsupported",
    UnitMismatch => "unit_mismatch",
    UnknownApplicability => "unknown_applicability",
    AuthorityUnverified => "authority_unverified",
    AnalysisFailed => "analysis_failed",
});

impl ParseRule {
    /// The fact type this rule produces.
    pub const fn produces(self) -> FactType {
        match self {
            Self::IdentifierExact => FactType::Identifier,
            Self::TextExact => FactType::Text,
            Self::EnumExact => FactType::Enum,
            Self::BooleanYesNo | Self::BooleanTrueFalse => FactType::Boolean,
            Self::DecimalPlain | Self::DecimalGroupedComma => FactType::Decimal,
            Self::DateIso | Self::DateDmy => FactType::Date,
            Self::InstantRfc3339 => FactType::Instant,
        }
    }
}

fn text_ok(value: &str, max: usize) -> bool {
    !value.trim().is_empty()
        && value.len() <= max
        && !value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}

/// A lowercase name: fact names, units and subject units.
pub fn valid_name(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= MAX_NAME_BYTES
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'_')
}

/// An ISO 4217 alphabetic code shape: three uppercase ASCII letters.
pub fn valid_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|b| b.is_ascii_uppercase())
}

/// A subject is kept exactly as stated: leading zeros, case and inner spaces.
pub fn valid_subject(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= MAX_SUBJECT_BYTES
        && !value.chars().any(char::is_control)
}

// ---------------------------------------------------------------- decimals

/// An exact decimal: `mantissa × 10^-scale`. `1,250.00` is `125000/2`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Decimal {
    pub mantissa: i128,
    pub scale: u8,
}

impl Decimal {
    /// `-?digits(.digits)?`, at most [`MAX_DECIMAL_DIGITS`] digits.
    pub fn parse_plain(text: &str) -> Option<Self> {
        let (negative, rest) = match text.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, text),
        };
        let (whole, fraction) = match rest.split_once('.') {
            Some((whole, fraction)) => (whole, Some(fraction)),
            None => (rest, None),
        };
        if whole.is_empty()
            || !whole.bytes().all(|b| b.is_ascii_digit())
            || fraction.is_some_and(|f| f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit()))
        {
            return None;
        }
        let fraction = fraction.unwrap_or("");
        let digits = whole.len() + fraction.len();
        if digits > MAX_DECIMAL_DIGITS || fraction.len() > MAX_DECIMAL_SCALE as usize {
            return None;
        }
        let mut mantissa: i128 = 0;
        for b in whole.bytes().chain(fraction.bytes()) {
            mantissa = mantissa * 10 + i128::from(b - b'0');
        }
        Some(Self {
            mantissa: if negative { -mantissa } else { mantissa },
            scale: fraction.len() as u8,
        })
    }
    /// Comma-grouped thousands: `1,250.00`, `12,000`, `999.5`. Groups after
    /// the first have exactly three digits.
    pub fn parse_grouped(text: &str) -> Option<Self> {
        let (negative, rest) = match text.strip_prefix('-') {
            Some(rest) => ("-", rest),
            None => ("", text),
        };
        let (whole, fraction) = match rest.split_once('.') {
            Some((whole, fraction)) => (whole, Some(fraction)),
            None => (rest, None),
        };
        let groups: Vec<&str> = whole.split(',').collect();
        if groups[0].is_empty()
            || groups[0].len() > 3
            || groups[1..].iter().any(|g| g.len() != 3)
            || groups
                .iter()
                .any(|g| !g.bytes().all(|b| b.is_ascii_digit()))
        {
            return None;
        }
        let plain = format!(
            "{negative}{}{}",
            groups.concat(),
            fraction.map(|f| format!(".{f}")).unwrap_or_default()
        );
        Self::parse_plain(&plain)
    }
    /// Canonical text: no grouping, exactly `scale` fraction digits.
    pub fn render(&self) -> String {
        let negative = self.mantissa < 0;
        let digits = self.mantissa.unsigned_abs().to_string();
        let scale = self.scale as usize;
        let padded = if digits.len() <= scale {
            format!("{}{digits}", "0".repeat(scale + 1 - digits.len()))
        } else {
            digits
        };
        let (whole, fraction) = padded.split_at(padded.len() - scale);
        format!(
            "{}{whole}{}",
            if negative { "-" } else { "" },
            if scale > 0 {
                format!(".{fraction}")
            } else {
                String::new()
            }
        )
    }
    /// Numeric order after aligning scales. Bounded digits cannot overflow.
    pub fn compare(&self, other: &Self) -> Ordering {
        let scale = self.scale.max(other.scale);
        let align = |d: &Self| {
            d.mantissa
                .checked_mul(10i128.pow(u32::from(scale - d.scale)))
                .expect("bounded decimals align within i128")
        };
        align(self).cmp(&align(other))
    }
    pub fn is_valid(&self) -> bool {
        self.scale <= MAX_DECIMAL_SCALE
            && self.mantissa.unsigned_abs().to_string().len() <= MAX_DECIMAL_DIGITS
    }
}

/// What a decimal counts: a currency (ISO 4217 code) or a unit name. Values
/// with different measures are never compared or converted.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Measure {
    Currency(String),
    Unit(String),
}
impl Measure {
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Currency(code) => valid_currency(code),
            Self::Unit(unit) => valid_name(unit),
        }
    }
    /// From the two answer fields; exactly one may be set.
    pub fn from_fields(unit: &str, currency: &str) -> Option<Option<Self>> {
        match (unit.is_empty(), currency.is_empty()) {
            (true, true) => Some(None),
            (false, true) => valid_name(unit).then(|| Some(Self::Unit(unit.into()))),
            (true, false) => {
                valid_currency(currency).then(|| Some(Self::Currency(currency.into())))
            }
            (false, false) => None,
        }
    }
    pub fn label(&self) -> String {
        match self {
            Self::Currency(code) => code.clone(),
            Self::Unit(unit) => unit.clone(),
        }
    }
}

// ------------------------------------------------------------ dates, times

/// A civil (calendar) date with no time zone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CivilDate {
    pub year: u16,
    pub month: u8,
    pub day: u8,
}

const fn leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}
const fn days_in_month(year: i64, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}
fn digits(value: &str, len: usize) -> Option<u32> {
    (value.len() == len && value.bytes().all(|b| b.is_ascii_digit()))
        .then(|| value.parse().ok())
        .flatten()
}
fn short_digits(value: &str) -> Option<u32> {
    ((1..=2).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_digit()))
        .then(|| value.parse().ok())
        .flatten()
}

impl CivilDate {
    pub fn new(year: u32, month: u32, day: u32) -> Option<Self> {
        let (year, month, day) = (
            u16::try_from(year).ok()?,
            u8::try_from(month).ok()?,
            u8::try_from(day).ok()?,
        );
        ((1..=9999).contains(&year)
            && (1..=12).contains(&month)
            && day >= 1
            && day <= days_in_month(i64::from(year), month))
        .then_some(Self { year, month, day })
    }
    /// `YYYY-MM-DD`.
    pub fn parse_iso(text: &str) -> Option<Self> {
        let mut parts = text.split('-');
        let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() {
            return None;
        }
        Self::new(digits(y, 4)?, digits(m, 2)?, digits(d, 2)?)
    }
    /// `DD/MM/YYYY` (day first); day and month may have one digit.
    pub fn parse_dmy(text: &str) -> Option<Self> {
        let mut parts = text.split('/');
        let (d, m, y) = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() {
            return None;
        }
        Self::new(digits(y, 4)?, short_digits(m)?, short_digits(d)?)
    }
    pub fn render(&self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
    /// Days since 1970-01-01 (proleptic Gregorian).
    pub fn days(&self) -> i64 {
        let (y, m, d) = (
            i64::from(self.year),
            i64::from(self.month),
            i64::from(self.day),
        );
        let y = if m <= 2 { y - 1 } else { y };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let mp = (m + 9) % 12;
        let doy = (153 * mp + 2) / 5 + d - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }
    pub fn from_days(days: i64) -> Option<Self> {
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let day = doy - (153 * mp + 2) / 5 + 1;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = yoe + era * 400 + i64::from(month <= 2);
        Self::new(u32::try_from(year).ok()?, month as u32, day as u32)
    }
}

const MICROS_PER_DAY: i64 = 86_400_000_000;

/// An exact instant: UTC microseconds since the Unix epoch, and the offset
/// from UTC the source stated (kept for display and the civil date).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Instant {
    pub utc_micros: i64,
    pub offset_minutes: i16,
}

impl Instant {
    /// RFC 3339 with seconds: `2026-03-05T23:30:00-05:00`, optional fraction
    /// of up to six digits, `Z` or `±HH:MM`.
    pub fn parse_rfc3339(text: &str) -> Option<Self> {
        let (date, rest) = text.split_once('T')?;
        let date = CivilDate::parse_iso(date)?;
        let (clock, offset_minutes) = if let Some(clock) = rest.strip_suffix('Z') {
            (clock, 0i16)
        } else {
            let at = rest.rfind(['+', '-'])?;
            let (clock, offset) = rest.split_at(at);
            let sign: i16 = if offset.starts_with('-') { -1 } else { 1 };
            let (h, m) = offset[1..].split_once(':')?;
            let (h, m) = (digits(h, 2)?, digits(m, 2)?);
            if m >= 60 {
                return None;
            }
            let minutes = i16::try_from(h * 60 + m).ok()?;
            if minutes > MAX_OFFSET_MINUTES {
                return None;
            }
            (clock, sign * minutes)
        };
        let (hms, fraction) = match clock.split_once('.') {
            Some((hms, fraction)) => (hms, Some(fraction)),
            None => (clock, None),
        };
        let mut parts = hms.split(':');
        let (h, mi, s) = (
            digits(parts.next()?, 2)?,
            digits(parts.next()?, 2)?,
            digits(parts.next()?, 2)?,
        );
        if parts.next().is_some() || h > 23 || mi > 59 || s > 59 {
            return None;
        }
        let micros = match fraction {
            Some(f) if (1..=6).contains(&f.len()) && f.bytes().all(|b| b.is_ascii_digit()) => {
                i64::from(f.parse::<u32>().ok()?) * 10i64.pow(6 - f.len() as u32)
            }
            Some(_) => return None,
            None => 0,
        };
        let local = date.days() * MICROS_PER_DAY
            + (i64::from(h) * 3_600 + i64::from(mi) * 60 + i64::from(s)) * 1_000_000
            + micros;
        Some(Self {
            utc_micros: local - i64::from(offset_minutes) * 60_000_000,
            offset_minutes,
        })
    }
    /// The civil date at the source's own offset (never the reader's zone).
    pub fn civil_date(&self) -> Option<CivilDate> {
        let local = self.utc_micros + i64::from(self.offset_minutes) * 60_000_000;
        CivilDate::from_days(local.div_euclid(MICROS_PER_DAY))
    }
    /// RFC 3339 in the source offset, with microseconds when present.
    pub fn render(&self) -> String {
        let local = self.utc_micros + i64::from(self.offset_minutes) * 60_000_000;
        let day = local.div_euclid(MICROS_PER_DAY);
        let within = local.rem_euclid(MICROS_PER_DAY);
        let date = CivilDate::from_days(day).map_or_else(|| "????-??-??".into(), |d| d.render());
        let seconds = within / 1_000_000;
        let micros = within % 1_000_000;
        let offset = if self.offset_minutes == 0 {
            "Z".to_string()
        } else {
            let abs = self.offset_minutes.unsigned_abs();
            format!(
                "{}{:02}:{:02}",
                if self.offset_minutes < 0 { '-' } else { '+' },
                abs / 60,
                abs % 60
            )
        };
        format!(
            "{date}T{:02}:{:02}:{:02}{}{offset}",
            seconds / 3600,
            (seconds / 60) % 60,
            seconds % 60,
            if micros > 0 {
                format!(".{micros:06}")
            } else {
                String::new()
            }
        )
    }
    /// The same instant in UTC (`Z`).
    pub fn render_utc(&self) -> String {
        Self {
            offset_minutes: 0,
            ..*self
        }
        .render()
    }
    pub fn is_valid(&self) -> bool {
        self.offset_minutes.abs() <= MAX_OFFSET_MINUTES && self.civil_date().is_some()
    }
}

// --------------------------------------------------------------- values

/// A typed value. Decimals carry their measure; nothing is a float.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FactValue {
    Identifier(String),
    Text(String),
    Boolean(bool),
    Enum(String),
    Decimal { value: Decimal, measure: Measure },
    Date(CivilDate),
    Instant(Instant),
}

impl FactValue {
    pub fn kind(&self) -> FactType {
        match self {
            Self::Identifier(_) => FactType::Identifier,
            Self::Text(_) => FactType::Text,
            Self::Boolean(_) => FactType::Boolean,
            Self::Enum(_) => FactType::Enum,
            Self::Decimal { .. } => FactType::Decimal,
            Self::Date(_) => FactType::Date,
            Self::Instant(_) => FactType::Instant,
        }
    }
    /// Canonical value text (the answer's `value` field form).
    pub fn text(&self) -> String {
        match self {
            Self::Identifier(v) | Self::Text(v) | Self::Enum(v) => v.clone(),
            Self::Boolean(v) => v.to_string(),
            Self::Decimal { value, .. } => value.render(),
            Self::Date(date) => date.render(),
            Self::Instant(instant) => instant.render(),
        }
    }
    pub fn measure(&self) -> Option<&Measure> {
        match self {
            Self::Decimal { measure, .. } => Some(measure),
            _ => None,
        }
    }
    /// The value a model stated, from its canonical text and measure.
    pub fn parse(kind: FactType, text: &str, measure: Option<Measure>) -> Option<Self> {
        let value = match kind {
            FactType::Identifier if valid_subject(text) => Self::Identifier(text.into()),
            FactType::Text if text_ok(text, MAX_TEXT_VALUE_BYTES) => Self::Text(text.into()),
            FactType::Enum if valid_subject(text) && text.len() <= MAX_ENUM_VALUE_BYTES => {
                Self::Enum(text.into())
            }
            FactType::Boolean => match text {
                "true" => Self::Boolean(true),
                "false" => Self::Boolean(false),
                _ => return None,
            },
            FactType::Decimal => Self::Decimal {
                value: Decimal::parse_plain(text)?,
                measure: measure.clone()?,
            },
            FactType::Date => Self::Date(CivilDate::parse_iso(text)?),
            FactType::Instant => Self::Instant(Instant::parse_rfc3339(text)?),
            _ => return None,
        };
        (kind == FactType::Decimal || measure.is_none()).then_some(value)
    }
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Identifier(v) => valid_subject(v),
            Self::Text(v) => text_ok(v, MAX_TEXT_VALUE_BYTES),
            Self::Enum(v) => valid_subject(v) && v.len() <= MAX_ENUM_VALUE_BYTES,
            Self::Boolean(_) | Self::Date(_) => true,
            Self::Decimal { value, measure } => value.is_valid() && measure.is_valid(),
            Self::Instant(instant) => instant.is_valid(),
        }
    }
    /// Whether a value trusted code derived from a quote equals this one.
    /// Decimals compare by value and measure (`1,250.00` = `1250.00`);
    /// identifiers and enums compare exactly; text after whitespace/NFC
    /// normalization; instants by UTC instant and stated offset.
    pub fn agrees(&self, derived: &Self) -> bool {
        match (self, derived) {
            (
                Self::Decimal { value, measure },
                Self::Decimal {
                    value: other,
                    measure: other_measure,
                },
            ) => measure == other_measure && value.compare(other) == Ordering::Equal,
            (Self::Text(a), Self::Text(b)) => normalize(a) == normalize(b),
            (a, b) => a == b,
        }
    }
}

impl ParseRule {
    /// Derive a typed value from a verified quote (whitespace and NFC
    /// normalized first). Decimals take the stated measure: the quote proves
    /// the number, the measure is part of the fact's declaration.
    pub fn apply(self, quote: &str, measure: Option<&Measure>) -> Option<FactValue> {
        let quote = normalize(quote);
        let value = match self {
            Self::IdentifierExact if valid_subject(&quote) => FactValue::Identifier(quote),
            Self::TextExact if text_ok(&quote, MAX_TEXT_VALUE_BYTES) => FactValue::Text(quote),
            Self::EnumExact if valid_subject(&quote) && quote.len() <= MAX_ENUM_VALUE_BYTES => {
                FactValue::Enum(quote)
            }
            Self::BooleanYesNo => match quote.to_ascii_lowercase().as_str() {
                "yes" => FactValue::Boolean(true),
                "no" => FactValue::Boolean(false),
                _ => return None,
            },
            Self::BooleanTrueFalse => match quote.to_ascii_lowercase().as_str() {
                "true" => FactValue::Boolean(true),
                "false" => FactValue::Boolean(false),
                _ => return None,
            },
            Self::DecimalPlain => FactValue::Decimal {
                value: Decimal::parse_plain(&quote)?,
                measure: measure?.clone(),
            },
            Self::DecimalGroupedComma => FactValue::Decimal {
                value: Decimal::parse_grouped(&quote)?,
                measure: measure?.clone(),
            },
            Self::DateIso => FactValue::Date(CivilDate::parse_iso(&quote)?),
            Self::DateDmy => FactValue::Date(CivilDate::parse_dmy(&quote)?),
            Self::InstantRfc3339 => FactValue::Instant(Instant::parse_rfc3339(&quote)?),
            _ => return None,
        };
        Some(value)
    }
}

/// What the agent states about one fact.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FactState {
    Value(FactValue),
    Unavailable(UnavailableReason),
    Ambiguous { candidates: u32 },
}
impl FactState {
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Value(value) => value.is_valid(),
            Self::Unavailable(_) => true,
            Self::Ambiguous { candidates } => (2..=MAX_AMBIGUOUS_CANDIDATES).contains(candidates),
        }
    }
}

/// Trusted code's judgment of a recorded fact.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FactSupport {
    /// Every source verified at its location and every quote re-parsed to the
    /// stated value under the declared rule.
    Supported,
    Unsupported(UnsupportedReason),
    /// An unavailable or ambiguous fact states no value to support.
    NoValue,
}
impl FactSupport {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Supported => "supported",
            Self::Unsupported(_) => "unsupported",
            Self::NoValue => "no_value",
        }
    }
    pub const fn reason(self) -> Option<UnsupportedReason> {
        match self {
            Self::Unsupported(reason) => Some(reason),
            _ => None,
        }
    }
    pub fn parse(support: &str, reason: Option<&str>) -> Option<Self> {
        match (support, reason) {
            ("supported", None) => Some(Self::Supported),
            ("no_value", None) => Some(Self::NoValue),
            ("unsupported", Some(reason)) => {
                Some(Self::Unsupported(UnsupportedReason::parse(reason)?))
            }
            _ => None,
        }
    }
}

// ------------------------------------------------------------ predicates

/// The closed set of deterministic predicates. Fact operands name required
/// facts of the criterion; nothing here is evaluated by a model.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Predicate {
    CompareConstant {
        fact: String,
        op: Comparison,
        constant: Decimal,
        measure: Measure,
    },
    CompareFacts {
        left: String,
        op: Comparison,
        right: String,
    },
    /// A date fact, or an instant's civil date at its source offset, is
    /// within the basis business period (inclusive).
    WithinPeriod {
        fact: String,
    },
    IdentifiersEqual {
        left: String,
        right: String,
    },
    IdentifiersDiffer {
        left: String,
        right: String,
    },
    MemberOf {
        fact: String,
        values: Vec<String>,
    },
    /// The fact has a supported value. Never false: a missing fact is
    /// undetermined, never an exception.
    Present {
        fact: String,
    },
    IsTrue {
        fact: String,
    },
}

impl Predicate {
    pub fn kind(&self) -> PredicateKind {
        match self {
            Self::CompareConstant { .. } => PredicateKind::CompareConstant,
            Self::CompareFacts { .. } => PredicateKind::CompareFacts,
            Self::WithinPeriod { .. } => PredicateKind::WithinPeriod,
            Self::IdentifiersEqual { .. } => PredicateKind::IdentifiersEqual,
            Self::IdentifiersDiffer { .. } => PredicateKind::IdentifiersDiffer,
            Self::MemberOf { .. } => PredicateKind::MemberOf,
            Self::Present { .. } => PredicateKind::Present,
            Self::IsTrue { .. } => PredicateKind::IsTrue,
        }
    }
    /// The fact names this predicate reads, in order.
    pub fn facts(&self) -> Vec<&str> {
        match self {
            Self::CompareConstant { fact, .. }
            | Self::WithinPeriod { fact }
            | Self::MemberOf { fact, .. }
            | Self::Present { fact }
            | Self::IsTrue { fact } => vec![fact],
            Self::CompareFacts { left, right, .. }
            | Self::IdentifiersEqual { left, right }
            | Self::IdentifiersDiffer { left, right } => vec![left, right],
        }
    }
    /// The fact types each operand may have.
    fn accepts(&self, kind: FactType) -> bool {
        match self {
            Self::CompareConstant { .. } | Self::CompareFacts { .. } => kind == FactType::Decimal,
            Self::WithinPeriod { .. } => matches!(kind, FactType::Date | FactType::Instant),
            Self::IdentifiersEqual { .. } | Self::IdentifiersDiffer { .. } => {
                kind == FactType::Identifier
            }
            Self::MemberOf { .. } => {
                matches!(kind, FactType::Enum | FactType::Identifier | FactType::Text)
            }
            Self::Present { .. } => true,
            Self::IsTrue { .. } => kind == FactType::Boolean,
        }
    }
    pub fn is_valid(&self) -> bool {
        self.facts().iter().all(|f| valid_name(f))
            && match self {
                Self::CompareConstant {
                    constant, measure, ..
                } => constant.is_valid() && measure.is_valid(),
                Self::CompareFacts { left, right, .. }
                | Self::IdentifiersEqual { left, right }
                | Self::IdentifiersDiffer { left, right } => left != right,
                Self::MemberOf { values, .. } => {
                    !values.is_empty()
                        && values.len() <= MAX_MEMBER_VALUES
                        && values.iter().enumerate().all(|(i, v)| {
                            valid_subject(v)
                                && v.len() <= MAX_ENUM_VALUE_BYTES
                                && !values[..i].contains(v)
                        })
                }
                _ => true,
            }
    }
    /// A short platform rendering, for the outline and the work panel.
    pub fn describe(&self) -> String {
        match self {
            Self::CompareConstant {
                fact,
                op,
                constant,
                measure,
            } => format!(
                "{fact} {} {} {}",
                op_symbol(*op),
                constant.render(),
                measure.label()
            ),
            Self::CompareFacts { left, op, right } => {
                format!("{left} {} {right}", op_symbol(*op))
            }
            Self::WithinPeriod { fact } => format!("{fact} within the basis period"),
            Self::IdentifiersEqual { left, right } => format!("{left} equals {right}"),
            Self::IdentifiersDiffer { left, right } => format!("{left} differs from {right}"),
            Self::MemberOf { fact, values } => format!("{fact} is one of {}", values.join(", ")),
            Self::Present { fact } => format!("{fact} is present"),
            Self::IsTrue { fact } => format!("{fact} is true"),
        }
    }
}
pub const fn op_symbol(op: Comparison) -> &'static str {
    match op {
        Comparison::Lt => "<",
        Comparison::Le => "≤",
        Comparison::Eq => "=",
        Comparison::Ge => "≥",
        Comparison::Gt => ">",
    }
}
const fn holds(op: Comparison, ordering: Ordering) -> bool {
    match op {
        Comparison::Lt => matches!(ordering, Ordering::Less),
        Comparison::Le => !matches!(ordering, Ordering::Greater),
        Comparison::Eq => matches!(ordering, Ordering::Equal),
        Comparison::Ge => !matches!(ordering, Ordering::Less),
        Comparison::Gt => matches!(ordering, Ordering::Greater),
    }
}

// ------------------------------------------------------------- criteria

/// A fact the criterion needs: its name, type and (for a decimal) measure.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RequiredFact {
    pub name: String,
    pub kind: FactType,
    pub measure: Option<Measure>,
}
impl RequiredFact {
    pub fn is_valid(&self) -> bool {
        valid_name(&self.name)
            && self.measure.as_ref().is_none_or(Measure::is_valid)
            && (self.measure.is_none() || self.kind == FactType::Decimal)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CriterionMethod {
    /// Decided by trusted code with a closed predicate.
    Rule(Predicate),
    /// Proposed by the model against a written rubric, pending human
    /// disposition (Story 24.3).
    Judgment { rubric: String },
}
impl CriterionMethod {
    pub fn kind(&self) -> CriterionKind {
        match self {
            Self::Rule(_) => CriterionKind::Rule,
            Self::Judgment { .. } => CriterionKind::Judgment,
        }
    }
}

/// Where a criterion's authority comes from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Authority {
    /// One criterion of the bound method: requirement ID and 0-based ordinal.
    Method {
        requirement_id: String,
        criterion_ordinal: u32,
    },
    /// A quote at an exact location of a registered original.
    Original(CitationSource),
}
impl Authority {
    pub fn kind(&self) -> AuthorityKind {
        match self {
            Self::Method { .. } => AuthorityKind::Method,
            Self::Original(_) => AuthorityKind::Original,
        }
    }
    pub fn is_valid(&self) -> bool {
        match self {
            Self::Method {
                requirement_id,
                criterion_ordinal,
            } => valid_scope_id(requirement_id) && *criterion_ordinal <= MAX_CRITERION_ORDINAL,
            Self::Original(source) => {
                valid_scope_id(&source.original_id) && text_ok(&source.quote, MAX_QUOTE_BYTES)
            }
        }
    }
}

/// A criterion version as proposed. Trusted code adds the checked authority,
/// the binding and the invocation when it records it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposedCriterion {
    /// Local name in this answer, so a basis in the same answer can list it.
    pub key: String,
    /// The earlier criterion version this one succeeds, by ID.
    pub supersedes: Option<String>,
    pub assertion: String,
    pub authority: Authority,
    pub effective_from: Option<CivilDate>,
    pub effective_to: Option<CivilDate>,
    pub applicability: Option<Predicate>,
    pub required_facts: Vec<RequiredFact>,
    pub method: CriterionMethod,
    pub missing: MissingTreatment,
}

impl ProposedCriterion {
    pub fn is_valid(&self) -> bool {
        let required = |name: &str| self.required_facts.iter().find(|r| r.name == name);
        // Every predicate operand is a required fact of an accepted type.
        let operands_ok = |predicate: &Predicate| {
            predicate.is_valid()
                && predicate
                    .facts()
                    .iter()
                    .all(|name| required(name).is_some_and(|r| predicate.accepts(r.kind)))
        };
        valid_scope_id(&self.key)
            && self.supersedes.as_deref().is_none_or(valid_scope_id)
            && text_ok(&self.assertion, MAX_ASSERTION_BYTES)
            && self.authority.is_valid()
            && match (self.effective_from, self.effective_to) {
                (Some(from), Some(to)) => from <= to,
                _ => true,
            }
            && self.required_facts.len() <= MAX_REQUIRED_FACTS
            && self.required_facts.iter().all(RequiredFact::is_valid)
            && self
                .required_facts
                .iter()
                .enumerate()
                .all(|(i, r)| !self.required_facts[..i].iter().any(|o| o.name == r.name))
            && self.applicability.as_ref().is_none_or(operands_ok)
            && match &self.method {
                CriterionMethod::Rule(predicate) => operands_ok(predicate),
                CriterionMethod::Judgment { rubric } => text_ok(rubric, MAX_RUBRIC_BYTES),
            }
    }
}

/// A population or sample reference: a registered original, by ID, with
/// its unit and how it was selected. Denominators are Story 24.2.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PopulationReference {
    pub original_id: String,
    pub unit: String,
    pub selection: String,
}
impl PopulationReference {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.original_id)
            && valid_name(&self.unit)
            && text_ok(&self.selection, MAX_SELECTION_BYTES)
    }
}

/// An assessment basis version as proposed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposedBasis {
    pub key: String,
    pub supersedes: Option<String>,
    pub objective: String,
    /// Criterion IDs, or keys of criteria proposed in the same answer.
    pub criteria: Vec<String>,
    pub period_from: CivilDate,
    pub period_to: CivilDate,
    pub as_of: Option<Instant>,
    pub population: Vec<PopulationReference>,
    pub limitations: Vec<String>,
}
impl ProposedBasis {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && self.supersedes.as_deref().is_none_or(valid_scope_id)
            && text_ok(&self.objective, MAX_OBJECTIVE_BYTES)
            && !self.criteria.is_empty()
            && self.criteria.len() <= MAX_BASIS_CRITERIA
            && self.criteria.iter().all(|c| valid_scope_id(c))
            && self
                .criteria
                .iter()
                .enumerate()
                .all(|(i, c)| !self.criteria[..i].contains(c))
            && self.period_from <= self.period_to
            && self.as_of.as_ref().is_none_or(Instant::is_valid)
            && self.population.len() <= MAX_POPULATION_REFERENCES
            && self.population.iter().all(PopulationReference::is_valid)
            && self.limitations.len() <= MAX_BASIS_LIMITATIONS
            && self
                .limitations
                .iter()
                .all(|l| text_ok(l, MAX_BASIS_LIMITATION_BYTES))
    }
}

/// One fact observation as proposed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposedFact {
    /// A basis ID, or the key of the basis proposed in the same answer.
    pub basis: String,
    pub subject: String,
    pub subject_unit: String,
    pub name: String,
    pub state: FactState,
    /// Present exactly for a stated value.
    pub rule: Option<ParseRule>,
    /// At least one for a stated value; any for unavailable/ambiguous.
    pub sources: Vec<CitationSource>,
    /// The 22.4 analysis job that produced the cited material, if any.
    pub job_id: Option<String>,
    /// The civil date the fact is effective at, when the source states one.
    pub effective: Option<CivilDate>,
}
impl ProposedFact {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.basis)
            && valid_subject(&self.subject)
            && valid_name(&self.subject_unit)
            && valid_name(&self.name)
            && self.state.is_valid()
            && match &self.state {
                FactState::Value(value) => {
                    self.rule
                        .is_some_and(|rule| rule.produces() == value.kind())
                        && !self.sources.is_empty()
                }
                _ => self.rule.is_none(),
            }
            && self.sources.len() <= MAX_FACT_SOURCES
            && self
                .sources
                .iter()
                .all(|s| valid_scope_id(&s.original_id) && text_ok(&s.quote, MAX_QUOTE_BYTES))
            && self.job_id.as_deref().is_none_or(valid_scope_id)
    }
}

/// A model's proposed judgment of one judgment criterion for one subject.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProposedJudgment {
    pub criterion: String,
    pub basis: String,
    pub subject: String,
    pub verdict: Verdict,
    /// Fact names of this basis and subject that support / contradict it.
    pub supporting: Vec<String>,
    pub contrary: Vec<String>,
    pub rationale: String,
    pub uncertainty: String,
}
impl ProposedJudgment {
    pub fn is_valid(&self) -> bool {
        let names = |list: &Vec<String>| {
            list.len() <= MAX_JUDGMENT_FACTS
                && list
                    .iter()
                    .enumerate()
                    .all(|(i, n)| valid_name(n) && !list[..i].contains(n))
        };
        valid_scope_id(&self.criterion)
            && valid_scope_id(&self.basis)
            && valid_subject(&self.subject)
            && names(&self.supporting)
            && names(&self.contrary)
            && !self.supporting.iter().any(|n| self.contrary.contains(n))
            && text_ok(&self.rationale, MAX_RATIONALE_BYTES)
            && (self.uncertainty.is_empty() || text_ok(&self.uncertainty, MAX_RATIONALE_BYTES))
    }
}

// ----------------------------------------------------------- evaluation

/// One recorded fact as the evaluator reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputFact {
    pub id: String,
    pub digest: String,
    pub name: String,
    pub state: FactState,
    pub support: FactSupport,
}

/// The pinned inputs of one evaluation: the basis period, whether the
/// criterion's authority is verified, and the facts of one subject.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvaluationContext<'a> {
    pub period_from: CivilDate,
    pub period_to: CivilDate,
    pub authority_verified: bool,
    pub facts: &'a [InputFact],
}

/// The result of evaluating one criterion for one subject.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub applicability: Applicability,
    pub execution: Execution,
    pub verdict: Option<Verdict>,
    pub reason: Option<EvaluationReason>,
    pub origin: Origin,
    /// (fact ID, fact digest) of every fact consulted, by fact name.
    pub inputs: Vec<(String, String)>,
}

impl Outcome {
    /// The structural rules the database also enforces.
    pub fn is_valid(&self) -> bool {
        let decided = matches!(self.verdict, Some(Verdict::Met | Verdict::NotMet));
        (!decided || (self.applicability == Applicability::Applicable && self.reason.is_none()))
            && (self.execution == Execution::Completed
                || (self.verdict.is_none() && self.reason == Some(EvaluationReason::AnalysisFailed)))
            && (self.applicability != Applicability::NotApplicable || self.verdict.is_none())
            // A deterministic undetermined verdict names its closed reason; a
            // model's own undetermined proposal explains itself in words.
            && (self.verdict != Some(Verdict::Undetermined)
                || self.reason.is_some()
                || self.origin == Origin::ModelProposal)
    }
}

enum Test {
    True,
    False,
    Undetermined(EvaluationReason),
}

fn usable<'a>(
    facts: &'a [InputFact],
    name: &str,
    kind: Option<FactType>,
) -> Result<&'a FactValue, EvaluationReason> {
    let fact = facts
        .iter()
        .find(|f| f.name == name)
        .ok_or(EvaluationReason::MissingFact)?;
    match (&fact.state, fact.support) {
        (FactState::Unavailable(_), _) => Err(EvaluationReason::FactUnavailable),
        (FactState::Ambiguous { .. }, _) => Err(EvaluationReason::FactAmbiguous),
        (FactState::Value(value), FactSupport::Supported) => {
            if kind.is_some_and(|k| k != value.kind()) {
                Err(EvaluationReason::FactUnsupported)
            } else {
                Ok(value)
            }
        }
        (FactState::Value(_), _) => Err(EvaluationReason::FactUnsupported),
    }
}

fn test(predicate: &Predicate, context: &EvaluationContext<'_>) -> Test {
    let facts = context.facts;
    let value = |name: &str| usable(facts, name, None);
    let result = (|| -> Result<bool, EvaluationReason> {
        Ok(match predicate {
            Predicate::CompareConstant {
                fact,
                op,
                constant,
                measure,
            } => match value(fact)? {
                FactValue::Decimal {
                    value,
                    measure: actual,
                } => {
                    if actual != measure {
                        return Err(EvaluationReason::UnitMismatch);
                    }
                    holds(*op, value.compare(constant))
                }
                _ => return Err(EvaluationReason::FactUnsupported),
            },
            Predicate::CompareFacts { left, op, right } => match (value(left)?, value(right)?) {
                (
                    FactValue::Decimal {
                        value: a,
                        measure: ma,
                    },
                    FactValue::Decimal {
                        value: b,
                        measure: mb,
                    },
                ) => {
                    if ma != mb {
                        return Err(EvaluationReason::UnitMismatch);
                    }
                    holds(*op, a.compare(b))
                }
                _ => return Err(EvaluationReason::FactUnsupported),
            },
            Predicate::WithinPeriod { fact } => {
                let date = match value(fact)? {
                    FactValue::Date(date) => *date,
                    FactValue::Instant(instant) => instant
                        .civil_date()
                        .ok_or(EvaluationReason::FactUnsupported)?,
                    _ => return Err(EvaluationReason::FactUnsupported),
                };
                context.period_from <= date && date <= context.period_to
            }
            Predicate::IdentifiersEqual { left, right }
            | Predicate::IdentifiersDiffer { left, right } => match (value(left)?, value(right)?) {
                (FactValue::Identifier(a), FactValue::Identifier(b)) => {
                    (a == b) == matches!(predicate, Predicate::IdentifiersEqual { .. })
                }
                _ => return Err(EvaluationReason::FactUnsupported),
            },
            Predicate::MemberOf { fact, values } => match value(fact)? {
                FactValue::Enum(v) | FactValue::Identifier(v) | FactValue::Text(v) => {
                    values.contains(v)
                }
                _ => return Err(EvaluationReason::FactUnsupported),
            },
            Predicate::Present { fact } => {
                value(fact)?;
                true
            }
            Predicate::IsTrue { fact } => match value(fact)? {
                FactValue::Boolean(b) => *b,
                _ => return Err(EvaluationReason::FactUnsupported),
            },
        })
    })();
    match result {
        Ok(true) => Test::True,
        Ok(false) => Test::False,
        Err(reason) => Test::Undetermined(reason),
    }
}

fn consulted(criterion: &ProposedCriterion, extra: &[&str]) -> Vec<String> {
    let mut names: Vec<String> = criterion
        .required_facts
        .iter()
        .map(|r| r.name.clone())
        .chain(
            criterion
                .applicability
                .iter()
                .flat_map(|p| p.facts())
                .map(String::from),
        )
        .chain(extra.iter().map(|n| String::from(*n)))
        .collect();
    if let CriterionMethod::Rule(predicate) = &criterion.method {
        names.extend(predicate.facts().into_iter().map(String::from));
    }
    names.sort();
    names.dedup();
    names
}

/// Applicability, analysis failure and authority, shared by rule and
/// judgment evaluation. `Err` is a finished outcome.
fn prepare(
    criterion: &ProposedCriterion,
    context: &EvaluationContext<'_>,
    origin: Origin,
    extra: &[&str],
) -> Result<Vec<(String, String)>, Outcome> {
    let names = consulted(criterion, extra);
    let inputs: Vec<(String, String)> = names
        .iter()
        .filter_map(|name| context.facts.iter().find(|f| &f.name == name))
        .map(|f| (f.id.clone(), f.digest.clone()))
        .collect();
    let outcome = |applicability, execution, verdict, reason| Outcome {
        applicability,
        execution,
        verdict,
        reason,
        origin,
        inputs: inputs.clone(),
    };
    // A failed analysis is an execution failure, never an exception.
    if names.iter().any(|name| {
        context.facts.iter().any(|f| {
            &f.name == name
                && f.support == FactSupport::Unsupported(UnsupportedReason::AnalysisFailed)
        })
    }) {
        return Err(outcome(
            Applicability::Unknown,
            Execution::Failed,
            None,
            Some(EvaluationReason::AnalysisFailed),
        ));
    }
    // A criterion version not in effect during the basis period does not apply.
    let effective = criterion
        .effective_from
        .is_none_or(|from| from <= context.period_to)
        && criterion
            .effective_to
            .is_none_or(|to| context.period_from <= to);
    let applicability = match &criterion.applicability {
        _ if !effective => Applicability::NotApplicable,
        None => Applicability::Applicable,
        Some(predicate) => match test(predicate, context) {
            Test::True => Applicability::Applicable,
            Test::False => Applicability::NotApplicable,
            Test::Undetermined(_) => Applicability::Unknown,
        },
    };
    match applicability {
        Applicability::NotApplicable => {
            return Err(outcome(applicability, Execution::Completed, None, None));
        }
        Applicability::Unknown => {
            return Err(outcome(
                applicability,
                Execution::Completed,
                Some(Verdict::Undetermined),
                Some(EvaluationReason::UnknownApplicability),
            ));
        }
        Applicability::Applicable => {}
    }
    if !context.authority_verified {
        return Err(outcome(
            applicability,
            Execution::Completed,
            Some(Verdict::Undetermined),
            Some(EvaluationReason::AuthorityUnverified),
        ));
    }
    for required in &criterion.required_facts {
        let checked =
            usable(context.facts, &required.name, Some(required.kind)).and_then(|v| {
                match (&required.measure, v.measure()) {
                    (Some(expected), Some(actual)) if expected != actual => {
                        Err(EvaluationReason::UnitMismatch)
                    }
                    _ => Ok(()),
                }
            });
        if let Err(reason) = checked {
            return Err(outcome(
                applicability,
                Execution::Completed,
                Some(Verdict::Undetermined),
                Some(reason),
            ));
        }
    }
    Ok(inputs)
}

/// Evaluate a rule criterion for one subject: pure, no I/O. The same
/// criterion and inputs always give the same outcome. A judgment criterion
/// is never decided here: it has no deterministic verdict.
pub fn evaluate(criterion: &ProposedCriterion, context: &EvaluationContext<'_>) -> Outcome {
    let inputs = match prepare(criterion, context, Origin::Deterministic, &[]) {
        Ok(inputs) => inputs,
        Err(outcome) => return outcome,
    };
    let (verdict, reason) = match &criterion.method {
        CriterionMethod::Rule(predicate) => match test(predicate, context) {
            Test::True => (Verdict::Met, None),
            Test::False => (Verdict::NotMet, None),
            Test::Undetermined(reason) => (Verdict::Undetermined, Some(reason)),
        },
        // Never decided here: a judgment is proposed through `judge`.
        CriterionMethod::Judgment { .. } => {
            return Outcome {
                applicability: Applicability::Applicable,
                execution: Execution::Completed,
                verdict: None,
                reason: None,
                origin: Origin::Deterministic,
                inputs,
            };
        }
    };
    Outcome {
        applicability: Applicability::Applicable,
        execution: Execution::Completed,
        verdict: Some(verdict),
        reason,
        origin: Origin::Deterministic,
        inputs,
    }
}

/// Record a model's proposed judgment for one subject. The proposal stands
/// only when the criterion applies, its authority is verified and every
/// cited fact is supported; otherwise it is undetermined with the reason.
pub fn judge(
    criterion: &ProposedCriterion,
    context: &EvaluationContext<'_>,
    judgment: &ProposedJudgment,
) -> Outcome {
    let cited: Vec<&str> = judgment
        .supporting
        .iter()
        .chain(&judgment.contrary)
        .map(String::as_str)
        .collect();
    let inputs = match prepare(criterion, context, Origin::ModelProposal, &cited) {
        Ok(inputs) => inputs,
        Err(outcome) => return outcome,
    };
    for name in &cited {
        if let Err(reason) = usable(context.facts, name, None) {
            return Outcome {
                applicability: Applicability::Applicable,
                execution: Execution::Completed,
                verdict: Some(Verdict::Undetermined),
                reason: Some(reason),
                origin: Origin::ModelProposal,
                inputs,
            };
        }
    }
    Outcome {
        applicability: Applicability::Applicable,
        execution: Execution::Completed,
        verdict: Some(judgment.verdict),
        reason: None,
        origin: Origin::ModelProposal,
        inputs,
    }
}

fn string(value: &str) -> JsonValue {
    JsonValue::String(value.into())
}

/// SHA-256 of the canonical JSON of an evaluation's identity and outcome
/// (and, for a judgment, its rationale and cited facts). Two evaluations
/// with the same inputs have byte-identical digests.
pub fn output_digest(
    basis_id: &str,
    criterion_id: &str,
    subject: &str,
    outcome: &Outcome,
    judgment: Option<(&[String], &[String], &str, &str)>,
) -> String {
    let mut object = BTreeMap::from([
        ("basis_id".to_string(), string(basis_id)),
        ("criterion_id".to_string(), string(criterion_id)),
        ("subject".to_string(), string(subject)),
        (
            "applicability".to_string(),
            string(outcome.applicability.as_str()),
        ),
        ("execution".to_string(), string(outcome.execution.as_str())),
        (
            "verdict".to_string(),
            outcome
                .verdict
                .map_or(JsonValue::Null, |v| string(v.as_str())),
        ),
        (
            "reason".to_string(),
            outcome
                .reason
                .map_or(JsonValue::Null, |r| string(r.as_str())),
        ),
        ("origin".to_string(), string(outcome.origin.as_str())),
        (
            "inputs".to_string(),
            JsonValue::Array(
                outcome
                    .inputs
                    .iter()
                    .map(|(id, digest)| {
                        JsonValue::Object(BTreeMap::from([
                            ("id".to_string(), string(id)),
                            ("digest".to_string(), string(digest)),
                        ]))
                    })
                    .collect(),
            ),
        ),
    ]);
    if let Some((supporting, contrary, rationale, uncertainty)) = judgment {
        let list = |items: &[String]| JsonValue::Array(items.iter().map(|i| string(i)).collect());
        object.insert("supporting".into(), list(supporting));
        object.insert("contrary".into(), list(contrary));
        object.insert("rationale".into(), string(rationale));
        object.insert("uncertainty".into(), string(uncertainty));
    }
    sha256_hex(canonical_json(&JsonValue::Object(object)).as_bytes())
}

// ------------------------------------------------- answer schema, decode

fn s(max: usize) -> ArgumentSchema {
    ArgumentSchema::String {
        max_bytes: max as u32,
        enumeration: vec![],
    }
}
fn e(values: Vec<&str>) -> ArgumentSchema {
    ArgumentSchema::String {
        max_bytes: 32,
        enumeration: values.into_iter().map(String::from).collect(),
    }
}
fn with_empty(values: &[&'static str]) -> Vec<&'static str> {
    let mut all = vec![""];
    all.extend(values);
    all
}
fn obj(fields: Vec<(&str, ArgumentSchema)>) -> ArgumentSchema {
    let required = fields.iter().map(|(k, _)| (*k).to_string()).collect();
    ArgumentSchema::Object {
        properties: fields
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        required,
    }
}
fn arr(items: ArgumentSchema, max: usize) -> ArgumentSchema {
    ArgumentSchema::Array {
        items: Box::new(items),
        max_items: max as u32,
    }
}
fn names_of<T: Copy>(all: &[T], name: fn(T) -> &'static str) -> Vec<&'static str> {
    all.iter().map(|v| name(*v)).collect()
}

fn predicate_schema() -> ArgumentSchema {
    obj(vec![
        (
            "kind",
            e(with_empty(&names_of(
                PredicateKind::ALL,
                PredicateKind::as_str,
            ))),
        ),
        ("fact", s(MAX_NAME_BYTES)),
        (
            "op",
            e(with_empty(&names_of(Comparison::ALL, Comparison::as_str))),
        ),
        ("right_fact", s(MAX_NAME_BYTES)),
        ("constant", s(48)),
        ("unit", s(MAX_NAME_BYTES)),
        ("currency", s(3)),
        ("values", arr(s(MAX_ENUM_VALUE_BYTES), MAX_MEMBER_VALUES)),
    ])
}
fn source_schema() -> ArgumentSchema {
    obj(vec![
        ("original_id", s(128)),
        ("locator", s(MAX_LOCATOR_BYTES)),
        ("quote", s(MAX_QUOTE_BYTES)),
    ])
}

/// The five Story 24.1 answer fields, offered only when assessment is
/// composed. Every property is required (strict output); `""` means none.
pub fn answer_fields() -> Vec<(&'static str, ArgumentSchema)> {
    let mut value_kinds = names_of(FactType::ALL, FactType::as_str);
    value_kinds.extend(["unavailable", "ambiguous"]);
    let criterion = obj(vec![
        ("key", s(128)),
        ("supersedes", s(128)),
        ("assertion", s(MAX_ASSERTION_BYTES)),
        (
            "authority_kind",
            e(names_of(AuthorityKind::ALL, AuthorityKind::as_str)),
        ),
        ("requirement_id", s(128)),
        (
            "criterion_ordinal",
            ArgumentSchema::Integer {
                minimum: 0,
                maximum: i64::from(MAX_CRITERION_ORDINAL),
            },
        ),
        ("original_id", s(128)),
        ("locator", s(MAX_LOCATOR_BYTES)),
        ("quote", s(MAX_QUOTE_BYTES)),
        ("effective_from", s(10)),
        ("effective_to", s(10)),
        ("applicability", predicate_schema()),
        (
            "required_facts",
            arr(
                obj(vec![
                    ("name", s(MAX_NAME_BYTES)),
                    ("type", e(names_of(FactType::ALL, FactType::as_str))),
                    ("unit", s(MAX_NAME_BYTES)),
                    ("currency", s(3)),
                ]),
                MAX_REQUIRED_FACTS,
            ),
        ),
        (
            "method",
            e(names_of(CriterionKind::ALL, CriterionKind::as_str)),
        ),
        ("rule", predicate_schema()),
        ("rubric", s(MAX_RUBRIC_BYTES)),
    ]);
    let basis = obj(vec![
        ("key", s(128)),
        ("supersedes", s(128)),
        ("objective", s(MAX_OBJECTIVE_BYTES)),
        ("criteria", arr(s(128), MAX_BASIS_CRITERIA)),
        ("period_from", s(10)),
        ("period_to", s(10)),
        ("as_of", s(40)),
        (
            "population",
            arr(
                obj(vec![
                    ("original_id", s(128)),
                    ("unit", s(MAX_NAME_BYTES)),
                    ("selection", s(MAX_SELECTION_BYTES)),
                ]),
                MAX_POPULATION_REFERENCES,
            ),
        ),
        (
            "limitations",
            arr(s(MAX_BASIS_LIMITATION_BYTES), MAX_BASIS_LIMITATIONS),
        ),
    ]);
    let fact = obj(vec![
        ("basis", s(128)),
        ("subject", s(MAX_SUBJECT_BYTES)),
        ("subject_unit", s(MAX_NAME_BYTES)),
        ("name", s(MAX_NAME_BYTES)),
        ("value_kind", e(value_kinds)),
        ("value", s(MAX_TEXT_VALUE_BYTES)),
        ("unit", s(MAX_NAME_BYTES)),
        ("currency", s(3)),
        (
            "reason",
            e(with_empty(&names_of(
                UnavailableReason::ALL,
                UnavailableReason::as_str,
            ))),
        ),
        (
            "candidates",
            ArgumentSchema::Integer {
                minimum: 0,
                maximum: i64::from(MAX_AMBIGUOUS_CANDIDATES),
            },
        ),
        (
            "rule",
            e(with_empty(&names_of(ParseRule::ALL, ParseRule::as_str))),
        ),
        ("sources", arr(source_schema(), MAX_FACT_SOURCES)),
        ("job_id", s(128)),
        ("effective", s(10)),
    ]);
    let judgment = obj(vec![
        ("criterion", s(128)),
        ("basis", s(128)),
        ("subject", s(MAX_SUBJECT_BYTES)),
        ("verdict", e(names_of(Verdict::ALL, Verdict::as_str))),
        ("supporting", arr(s(MAX_NAME_BYTES), MAX_JUDGMENT_FACTS)),
        ("contrary", arr(s(MAX_NAME_BYTES), MAX_JUDGMENT_FACTS)),
        ("rationale", s(MAX_RATIONALE_BYTES)),
        ("uncertainty", s(MAX_RATIONALE_BYTES)),
    ]);
    vec![
        ("propose_criteria", arr(criterion, MAX_PROPOSED_CRITERIA)),
        ("propose_basis", arr(basis, MAX_PROPOSED_BASES)),
        ("record_facts", arr(fact, MAX_RECORDED_FACTS)),
        ("evaluate", arr(s(128), MAX_EVALUATE)),
        ("judgments", arr(judgment, MAX_JUDGMENTS)),
    ]
}

type Object = BTreeMap<String, JsonValue>;
fn get<'a>(object: &'a Object, key: &str) -> Option<&'a JsonValue> {
    object.get(key)
}
fn text<'a>(object: &'a Object, key: &str) -> Option<&'a str> {
    match get(object, key)? {
        JsonValue::String(value) => Some(value),
        _ => None,
    }
}
fn integer(object: &Object, key: &str) -> Option<i64> {
    match get(object, key)? {
        JsonValue::Integer(value) => Some(*value),
        _ => None,
    }
}
fn object_of(value: &JsonValue) -> Option<&Object> {
    match value {
        JsonValue::Object(map) => Some(map),
        _ => None,
    }
}
fn strings(object: &Object, key: &str) -> Option<Vec<String>> {
    match get(object, key)? {
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
fn optional<T>(value: &str, parse: impl FnOnce(&str) -> Option<T>) -> Option<Option<T>> {
    if value.is_empty() {
        Some(None)
    } else {
        parse(value).map(Some)
    }
}
fn source_of(value: &JsonValue) -> Option<CitationSource> {
    let object = object_of(value)?;
    Some(CitationSource {
        original_id: text(object, "original_id")?.into(),
        locator: Locator::parse(text(object, "locator")?),
        quote: text(object, "quote")?.into(),
    })
}

/// A predicate object; `kind: ""` is none.
pub fn decode_predicate(value: &JsonValue) -> Option<Option<Predicate>> {
    let object = object_of(value)?;
    let kind = text(object, "kind")?;
    if kind.is_empty() {
        return Some(None);
    }
    let fact = || text(object, "fact").map(String::from);
    let right = || text(object, "right_fact").map(String::from);
    let op = || Comparison::parse(text(object, "op")?);
    let predicate = match PredicateKind::parse(kind)? {
        PredicateKind::CompareConstant => Predicate::CompareConstant {
            fact: fact()?,
            op: op()?,
            constant: Decimal::parse_plain(text(object, "constant")?)?,
            measure: Measure::from_fields(text(object, "unit")?, text(object, "currency")?)??,
        },
        PredicateKind::CompareFacts => Predicate::CompareFacts {
            left: fact()?,
            op: op()?,
            right: right()?,
        },
        PredicateKind::WithinPeriod => Predicate::WithinPeriod { fact: fact()? },
        PredicateKind::IdentifiersEqual => Predicate::IdentifiersEqual {
            left: fact()?,
            right: right()?,
        },
        PredicateKind::IdentifiersDiffer => Predicate::IdentifiersDiffer {
            left: fact()?,
            right: right()?,
        },
        PredicateKind::MemberOf => Predicate::MemberOf {
            fact: fact()?,
            values: strings(object, "values")?,
        },
        PredicateKind::Present => Predicate::Present { fact: fact()? },
        PredicateKind::IsTrue => Predicate::IsTrue { fact: fact()? },
    };
    predicate.is_valid().then_some(Some(predicate))
}

pub fn decode_criterion(value: &JsonValue) -> Option<ProposedCriterion> {
    let object = object_of(value)?;
    let authority = match AuthorityKind::parse(text(object, "authority_kind")?)? {
        AuthorityKind::Method => Authority::Method {
            requirement_id: text(object, "requirement_id")?.into(),
            criterion_ordinal: u32::try_from(integer(object, "criterion_ordinal")?).ok()?,
        },
        AuthorityKind::Original => Authority::Original(CitationSource {
            original_id: text(object, "original_id")?.into(),
            locator: Locator::parse(text(object, "locator")?),
            quote: text(object, "quote")?.into(),
        }),
    };
    let required_facts = match get(object, "required_facts")? {
        JsonValue::Array(items) => items
            .iter()
            .map(|item| {
                let item = object_of(item)?;
                Some(RequiredFact {
                    name: text(item, "name")?.into(),
                    kind: FactType::parse(text(item, "type")?)?,
                    measure: Measure::from_fields(text(item, "unit")?, text(item, "currency")?)?,
                })
            })
            .collect::<Option<Vec<_>>>()?,
        _ => return None,
    };
    let method = match CriterionKind::parse(text(object, "method")?)? {
        CriterionKind::Rule => CriterionMethod::Rule(decode_predicate(get(object, "rule")?)??),
        CriterionKind::Judgment => CriterionMethod::Judgment {
            rubric: text(object, "rubric")?.into(),
        },
    };
    let criterion = ProposedCriterion {
        key: text(object, "key")?.into(),
        supersedes: optional(text(object, "supersedes")?, |v| Some(v.to_string()))?,
        assertion: text(object, "assertion")?.into(),
        authority,
        effective_from: optional(text(object, "effective_from")?, CivilDate::parse_iso)?,
        effective_to: optional(text(object, "effective_to")?, CivilDate::parse_iso)?,
        applicability: decode_predicate(get(object, "applicability")?)?,
        required_facts,
        method,
        missing: MissingTreatment::Undetermined,
    };
    criterion.is_valid().then_some(criterion)
}

pub fn decode_basis(value: &JsonValue) -> Option<ProposedBasis> {
    let object = object_of(value)?;
    let population = match get(object, "population")? {
        JsonValue::Array(items) => items
            .iter()
            .map(|item| {
                let item = object_of(item)?;
                Some(PopulationReference {
                    original_id: text(item, "original_id")?.into(),
                    unit: text(item, "unit")?.into(),
                    selection: text(item, "selection")?.into(),
                })
            })
            .collect::<Option<Vec<_>>>()?,
        _ => return None,
    };
    let basis = ProposedBasis {
        key: text(object, "key")?.into(),
        supersedes: optional(text(object, "supersedes")?, |v| Some(v.to_string()))?,
        objective: text(object, "objective")?.into(),
        criteria: strings(object, "criteria")?,
        period_from: CivilDate::parse_iso(text(object, "period_from")?)?,
        period_to: CivilDate::parse_iso(text(object, "period_to")?)?,
        as_of: optional(text(object, "as_of")?, Instant::parse_rfc3339)?,
        population,
        limitations: strings(object, "limitations")?,
    };
    basis.is_valid().then_some(basis)
}

pub fn decode_fact(value: &JsonValue) -> Option<ProposedFact> {
    let object = object_of(value)?;
    let kind = text(object, "value_kind")?;
    let state = match kind {
        "unavailable" => FactState::Unavailable(UnavailableReason::parse(text(object, "reason")?)?),
        "ambiguous" => FactState::Ambiguous {
            candidates: u32::try_from(integer(object, "candidates")?).ok()?,
        },
        kind => FactState::Value(FactValue::parse(
            FactType::parse(kind)?,
            text(object, "value")?,
            Measure::from_fields(text(object, "unit")?, text(object, "currency")?)?,
        )?),
    };
    let sources = match get(object, "sources")? {
        JsonValue::Array(items) => items.iter().map(source_of).collect::<Option<Vec<_>>>()?,
        _ => return None,
    };
    let fact = ProposedFact {
        basis: text(object, "basis")?.into(),
        subject: text(object, "subject")?.into(),
        subject_unit: text(object, "subject_unit")?.into(),
        name: text(object, "name")?.into(),
        state,
        rule: optional(text(object, "rule")?, ParseRule::parse)?,
        sources,
        job_id: optional(text(object, "job_id")?, |v| Some(v.to_string()))?,
        effective: optional(text(object, "effective")?, CivilDate::parse_iso)?,
    };
    fact.is_valid().then_some(fact)
}

pub fn decode_judgment(value: &JsonValue) -> Option<ProposedJudgment> {
    let object = object_of(value)?;
    let judgment = ProposedJudgment {
        criterion: text(object, "criterion")?.into(),
        basis: text(object, "basis")?.into(),
        subject: text(object, "subject")?.into(),
        verdict: Verdict::parse(text(object, "verdict")?)?,
        supporting: strings(object, "supporting")?,
        contrary: strings(object, "contrary")?,
        rationale: text(object, "rationale")?.into(),
        uncertainty: text(object, "uncertainty")?.into(),
    };
    judgment.is_valid().then_some(judgment)
}

#[cfg(test)]
mod tests;
