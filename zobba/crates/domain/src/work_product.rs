//! Story 24.4: firm-shaped work products with supported claims.
//!
//! The agent drafts a work product natively: it chooses a template of the
//! Task's current method binding, writes its sections and writes each claim
//! in its own words with the exact records the claim rests on. Trusted code,
//! never the model, checks every claim against those records before a
//! version is recorded (all or nothing): stated outcomes, counts, statuses,
//! fact values and quotes must equal the records, and every figure of a
//! claim's sentence must be one of the checked values ([`figures`]). Prose
//! that is not a checked claim is recorded only as labelled "Zobba's
//! judgment" or narrative and carries no figures. Versions are immutable;
//! whether a claim is current is derived on every read ([`currency`]) from
//! the record identities it pins. A person edits a draft by recording a new
//! version. Exports are rendered by trusted code from one exact version
//! ([`export`]). There is no numeric confidence and no percentage anywhere.
use std::collections::{BTreeMap, BTreeSet};

use crate::{
    assessment::{Verdict, valid_subject},
    citation::{CitationSource, Locator, MAX_LOCATOR_BYTES, MAX_QUOTE_BYTES},
    context::canonical_json,
    coverage::{Conclusion, Summary},
    exception::{ExceptionStatus, valid_exception_id},
    identity::{valid_scope_id, valid_scope_label},
    model::{ArgumentSchema, JsonValue},
    revision::{EffectiveOrigin, ReviewState},
    work::sha256_hex,
};

pub mod export;
pub mod figures;

pub use figures::{
    Identifiers, Renderings, is_decimal_digit, narrative_figures, statement_figures_v1,
    verdict_word,
};

/// Blocks one version holds.
pub const MAX_BLOCKS: usize = 64;
/// Claim blocks one version holds.
pub const MAX_CLAIMS: usize = 48;
/// Assertions one claim rests on.
pub const MAX_ASSERTIONS: usize = 8;
pub const MAX_NARRATIVE_BYTES: usize = 4_000;
pub const MAX_STATEMENT_BYTES: usize = 1_000;
pub const MAX_HEADING_BYTES: usize = 500;
/// A title: 1–200 Unicode scalars under the scope-label rules.
pub const MAX_TITLE_CHARS: usize = 200;
/// The canonical JSON bytes of one whole version document.
pub const MAX_VERSION_BYTES: usize = 64 * 1024;
/// `draft_work_product` entries one answer may make.
pub const MAX_DRAFTS: usize = 1;
/// Work products one Task holds (a write-time bound the shelf and the
/// outline read exactly).
pub const MAX_PRODUCTS: usize = 16;
/// Versions one work product holds.
pub const MAX_VERSIONS: u32 = 256;
/// Shelf page size.
pub const SHELF_PAGE: usize = 50;
/// The renderer of every export.
pub const RENDERER: &str = "zobba-export-v1";
/// The figure rule every recorded claim passed.
pub const FIGURE_RULE: &str = "statement_figures_v1";
/// How the built-in neutral starter is always labelled.
pub const NEUTRAL_LABEL: &str = "Neutral starter (not firm methodology)";
/// How a judgment block is always labelled.
pub const JUDGMENT_LABEL: &str = "Zobba's judgment — not checked against records";
/// The review state of every version of Story 24.4 (24.5 adds others).
pub const REVIEW_STATE: &str = "Draft";
/// What a required section with no content says.
pub const NOT_COMPLETED: &str = "Not completed in this version.";
/// The source ID of the built-in neutral template.
pub const NEUTRAL_SOURCE: &str = "builtin_neutral_v1";

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

vocabulary!(ProductKind {
    WorkingPaper => "working_paper",
    Analysis => "analysis",
    FindingSummary => "finding_summary",
    ReportDraft => "report_draft",
});

vocabulary!(BlockKind {
    Heading => "heading",
    Narrative => "narrative",
    Claim => "claim",
    Coverage => "coverage",
    Exceptions => "exceptions",
    Limitations => "limitations",
});

vocabulary!(NarrativeLabel {
    Judgment => "judgment",
    Narrative => "narrative",
});

vocabulary!(AuthorKind {
    Agent => "agent",
    Human => "human",
});

vocabulary!(AssertionKind {
    Outcome => "outcome",
    Count => "count",
    Conclusion => "conclusion",
    Exception => "exception",
    Fact => "fact",
    Quote => "quote",
    Period => "period",
});

// The record a pin names.
vocabulary!(RecordKind {
    Evaluation => "evaluation",
    Revision => "revision",
    Summary => "summary",
    EffectiveSummary => "effective_summary",
    Exception => "exception",
    Fact => "fact",
    Original => "original",
    Basis => "basis",
});

// The exact counts a `count` assertion may name (24.2 and 24.3b summary
// fields). The criterion measures need a criterion of the summary.
vocabulary!(CountMeasure {
    ReceivedRows => "received_rows",
    DistinctSubjects => "distinct_subjects",
    InScope => "in_scope",
    Selected => "selected",
    Excluded => "excluded",
    ScopeUnknown => "scope_unknown",
    Applicable => "applicable",
    NotApplicable => "not_applicable",
    Met => "met",
    NotMet => "not_met",
    Undetermined => "undetermined",
    ExecutionFailed => "execution_failed",
    NotEvaluated => "not_evaluated",
    FailingSubjects => "failing_subjects",
    FailingOpportunities => "failing_opportunities",
    MeetsEveryApplicable => "meets_every_applicable",
    Unresolved => "unresolved",
});

// Why a draft (or a person's edit) was not recorded, per block.
vocabulary!(Refusal {
    OutcomeMismatch => "outcome_mismatch",
    CountMismatch => "count_mismatch",
    ConclusionMismatch => "conclusion_mismatch",
    StatusMismatch => "status_mismatch",
    FactMismatch => "fact_mismatch",
    QuoteUnverified => "quote_unverified",
    SupersededSupport => "superseded_support",
    UnsupportedFigure => "unsupported_figure",
    FigureInNarrative => "figure_in_narrative",
    VerdictWithoutRecord => "verdict_without_record",
    UnknownRecord => "unknown_record",
    StaleBase => "stale_base",
    TemplateUnbound => "template_unbound",
    SectionUnknown => "section_unknown",
    HumanBlockDropped => "human_block_dropped",
    BoundExceeded => "bound_exceeded",
});

// Why a recorded claim needs refresh (derived on read, never stored).
vocabulary!(RefreshReason {
    EvaluationRevised => "evaluation_revised",
    DispositionChanged => "disposition_changed",
    SummarySuperseded => "summary_superseded",
    ExceptionStatusChanged => "exception_status_changed",
    FactSuperseded => "fact_superseded",
    SourceWithdrawn => "source_withdrawn",
});

vocabulary!(ExportFormat {
    Docx => "docx",
    Xlsx => "xlsx",
});

impl CountMeasure {
    /// Whether the measure counts one criterion of the summary.
    pub const fn per_criterion(self) -> bool {
        matches!(
            self,
            Self::Applicable
                | Self::NotApplicable
                | Self::Met
                | Self::NotMet
                | Self::Undetermined
                | Self::ExecutionFailed
                | Self::NotEvaluated
        )
    }
    /// The exact stored count of a summary, or None when the summary has no
    /// such count (no criterion of that ID, a criterion on a summary-level
    /// measure, `selected` of a population summary).
    pub fn of(self, summary: &Summary, criterion: Option<&str>) -> Option<u64> {
        if self.per_criterion() != criterion.is_some() {
            return None;
        }
        let c = &summary.counts;
        let p = &summary.partition;
        let k = || {
            summary
                .criteria
                .iter()
                .find(|k| Some(k.criterion_id.as_str()) == criterion)
        };
        Some(match self {
            Self::ReceivedRows => c.received_rows,
            Self::DistinctSubjects => c.distinct_subjects,
            Self::InScope => c.in_scope,
            Self::Selected => summary.selected?,
            Self::Excluded => c.excluded_out_of_period,
            Self::ScopeUnknown => c.scope_unknown(),
            Self::Applicable => k()?.applicable,
            Self::NotApplicable => k()?.not_applicable,
            Self::Met => k()?.met,
            Self::NotMet => k()?.not_met,
            Self::Undetermined => k()?.undetermined,
            Self::ExecutionFailed => k()?.execution_failed,
            Self::NotEvaluated => k()?.not_evaluated,
            Self::FailingSubjects => p.failing,
            Self::FailingOpportunities => summary.failing_opportunities,
            Self::MeetsEveryApplicable => p.meets_every_applicable,
            Self::Unresolved => p.unresolved,
        })
    }
    /// Words for a count of this measure.
    pub fn words(self) -> &'static str {
        match self {
            Self::ReceivedRows => "received rows",
            Self::DistinctSubjects => "distinct subjects",
            Self::InScope => "subjects in scope",
            Self::Selected => "selected items",
            Self::Excluded => "subjects excluded (out of period)",
            Self::ScopeUnknown => "subjects with unknown scope",
            Self::Applicable => "applicable",
            Self::NotApplicable => "not applicable",
            Self::Met => "met",
            Self::NotMet => "not met",
            Self::Undetermined => "undetermined",
            Self::ExecutionFailed => "execution failed",
            Self::NotEvaluated => "not evaluated",
            Self::FailingSubjects => "failing subjects",
            Self::FailingOpportunities => "failing opportunities (not records)",
            Self::MeetsEveryApplicable => "subjects meeting every applicable criterion",
            Self::Unresolved => "unresolved subjects",
        }
    }
}

impl Refusal {
    /// What the refusal means, for the agent's feedback and the editor.
    pub fn words(self) -> &'static str {
        match self {
            Self::OutcomeMismatch => "the stated verdict is not the evaluation's effective outcome",
            Self::CountMismatch => "the stated count is not the summary's stored count",
            Self::ConclusionMismatch => {
                "the stated conclusion is not the summary's stored conclusion"
            }
            Self::StatusMismatch => "the stated status is not the exception's derived status",
            Self::FactMismatch => "the stated value is not the fact's supported, grounded value",
            Self::QuoteUnverified => {
                "the quote is not the whole value at its exact location of a registered original"
            }
            Self::SupersededSupport => "the record is not current: cite the current one",
            Self::UnsupportedFigure => {
                "a figure of the sentence is not one of the claim's checked values"
            }
            Self::FigureInNarrative => {
                "narrative and judgment text carries no figures; put a figure in a checked claim"
            }
            Self::VerdictWithoutRecord => {
                "a claim that rests only on quotes may not state a verdict"
            }
            Self::UnknownRecord => "the record is not one of this Task's records",
            Self::StaleBase => "the version it edits is not the work product's latest version",
            Self::TemplateUnbound => "the template is not one of the Task's current method binding",
            Self::SectionUnknown => "the section is not one of the template's sections",
            Self::HumanBlockDropped => "a person's block must be kept by its ID, unchanged",
            Self::BoundExceeded => {
                "a bound of the work product is exceeded or a block is malformed"
            }
        }
    }
}

impl RefreshReason {
    pub fn words(self) -> &'static str {
        match self {
            Self::EvaluationRevised => "the evaluation it cites was revised",
            Self::DispositionChanged => {
                "a person's disposition changed the evaluation's effective outcome"
            }
            Self::SummarySuperseded => {
                "a newer summary of the same population supersedes the one it cites"
            }
            Self::ExceptionStatusChanged => "the exception's derived status changed",
            Self::FactSuperseded => "a successor basis replaced the fact it cites",
            Self::SourceWithdrawn => {
                "the original it quotes is no longer registered with the digest it was verified against"
            }
        }
    }
}

fn id_of(prefix: &str, parts: &[&str]) -> String {
    let joined = std::iter::once(prefix)
        .chain(parts.iter().copied())
        .collect::<Vec<_>>()
        .join("\0");
    format!("{prefix}-{}", &sha256_hex(joined.as_bytes())[..40])
}
fn valid_prefixed(id: &str, prefix: &str) -> bool {
    id.strip_prefix(prefix).is_some_and(|rest| {
        rest.len() == 40 && rest.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}
/// The work product an agent creates in one answer invocation.
pub fn product_id(task_id: &str, invocation_id: &str) -> String {
    id_of("wp", &[task_id, invocation_id])
}
/// The version an agent records in one answer invocation.
pub fn agent_version_id(task_id: &str, invocation_id: &str) -> String {
    id_of("wpv", &[task_id, invocation_id])
}
/// The version a person records with one session-bound request key.
pub fn human_version_id(task_id: &str, actor_id: &str, key: &str) -> String {
    id_of("wpv", &[task_id, actor_id, key])
}
/// A new block of one version, by its place in that version.
pub fn block_id(version_id: &str, ordinal: usize) -> String {
    id_of("blk", &[version_id, &ordinal.to_string()])
}
/// An export a viewer requested with one request key.
pub fn export_id(actor_id: &str, key: &str) -> String {
    id_of("wpx", &[actor_id, key])
}
/// The identity digest an exception pin holds (its record never changes;
/// its status is derived): SHA-256 of `exception|id|task|criterion
/// root|subject`, as the database's `work_product_exception_digest`.
pub fn exception_digest(id: &str, task_id: &str, root: &str, subject: &str) -> String {
    sha256_hex(format!("exception|{id}|{task_id}|{root}|{subject}").as_bytes())
}
/// The digest of a viewer's withheld set: the sorted, distinct original IDs
/// whose quotes this viewer may not read now (the empty set has a digest too).
pub fn withheld_digest(ids: &BTreeSet<String>) -> String {
    let joined: Vec<&str> = ids.iter().map(String::as_str).collect();
    sha256_hex(format!("withheld\0{}", joined.join("\0")).as_bytes())
}
pub fn valid_product_id(id: &str) -> bool {
    valid_prefixed(id, "wp-")
}
pub fn valid_version_id(id: &str) -> bool {
    valid_prefixed(id, "wpv-")
}
pub fn valid_block_id(id: &str) -> bool {
    valid_prefixed(id, "blk-")
}
pub fn valid_export_id(id: &str) -> bool {
    valid_prefixed(id, "wpx-")
}
fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
fn text_ok(value: &str, max: usize) -> bool {
    !value.trim().is_empty()
        && value.len() <= max
        && !value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}
/// A title: 1–200 Unicode scalars under the scope-label rules.
pub fn valid_title(value: &str) -> bool {
    valid_scope_label(value) && value.chars().count() <= MAX_TITLE_CHARS
}

/// The record kind an ID names, by its prefix.
pub fn record_kind_of(kind: AssertionKind, id: &str) -> Option<RecordKind> {
    let hex = |p: &str| valid_prefixed(id, p);
    match kind {
        AssertionKind::Outcome if hex("eval-") => Some(RecordKind::Evaluation),
        AssertionKind::Outcome if hex("rev-") => Some(RecordKind::Revision),
        AssertionKind::Count | AssertionKind::Conclusion if hex("summary-") => {
            Some(RecordKind::Summary)
        }
        AssertionKind::Count | AssertionKind::Conclusion if hex("esummary-") => {
            Some(RecordKind::EffectiveSummary)
        }
        AssertionKind::Exception if valid_exception_id(id) => Some(RecordKind::Exception),
        AssertionKind::Fact if hex("fact-") => Some(RecordKind::Fact),
        AssertionKind::Quote if valid_scope_id(id) => Some(RecordKind::Original),
        AssertionKind::Period if hex("basis-") => Some(RecordKind::Basis),
        _ => None,
    }
}

// --------------------------------------------------------------- drafts

/// One assertion as the agent states it. Trusted code checks it against the
/// record and pins the record's identity and digest.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProposedAssertion {
    /// `verdict` None states "no verdict" (`none`).
    Outcome {
        evaluation_id: String,
        verdict: Option<Option<Verdict>>,
    },
    Count {
        summary_id: String,
        measure: Option<CountMeasure>,
        criterion_id: Option<String>,
        value: Option<u64>,
    },
    Conclusion {
        summary_id: String,
        code: Option<Conclusion>,
    },
    Exception {
        exception_id: String,
        status: Option<ExceptionStatus>,
    },
    Fact {
        fact_id: String,
        value: String,
    },
    Quote {
        source: CitationSource,
    },
    Period {
        basis_id: String,
    },
}
impl ProposedAssertion {
    pub fn kind(&self) -> AssertionKind {
        match self {
            Self::Outcome { .. } => AssertionKind::Outcome,
            Self::Count { .. } => AssertionKind::Count,
            Self::Conclusion { .. } => AssertionKind::Conclusion,
            Self::Exception { .. } => AssertionKind::Exception,
            Self::Fact { .. } => AssertionKind::Fact,
            Self::Quote { .. } => AssertionKind::Quote,
            Self::Period { .. } => AssertionKind::Period,
        }
    }
    pub fn record_id(&self) -> &str {
        match self {
            Self::Outcome { evaluation_id, .. } => evaluation_id,
            Self::Count { summary_id, .. } | Self::Conclusion { summary_id, .. } => summary_id,
            Self::Exception { exception_id, .. } => exception_id,
            Self::Fact { fact_id, .. } => fact_id,
            Self::Quote { source } => &source.original_id,
            Self::Period { basis_id } => basis_id,
        }
    }
}

/// The content of a new block, as the agent states it. A block whose shape
/// is wrong is kept as `Malformed` so it is refused with its own reason
/// (`bound_exceeded`), never silently left out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProposedContent {
    Heading {
        text: String,
    },
    Narrative {
        label: NarrativeLabel,
        text: String,
    },
    Claim {
        statement: String,
        assertions: Vec<ProposedAssertion>,
    },
    Coverage {
        summary_id: String,
    },
    Exceptions {
        basis_id: String,
    },
    Limitations,
    Malformed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProposedBlock {
    /// Keep a block of the base version by its ID, byte for byte.
    Keep(String),
    New {
        section: String,
        content: ProposedContent,
    },
}

/// A `draft_work_product` answer entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Draft {
    pub title: String,
    pub kind: ProductKind,
    pub template_id: String,
    pub template_version: String,
    /// The version it edits (the work product's latest, which names the
    /// product); None for a new work product.
    pub base_version: Option<String>,
    pub blocks: Vec<ProposedBlock>,
}

// ---------------------------------------------------------------- records

/// The template a work product follows, resolved from the Task's method
/// binding when the product was created. Its section list is a frozen copy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TemplateRef {
    pub binding_id: String,
    pub id: String,
    pub version: String,
    pub source_version_id: String,
    pub name: String,
    /// The built-in neutral starter or a neutral source: always labelled
    /// [`NEUTRAL_LABEL`].
    pub neutral: bool,
    pub sections: Vec<SectionRef>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SectionRef {
    pub id: String,
    pub title: String,
    pub required: bool,
}
impl TemplateRef {
    /// How the template is labelled to every reader.
    pub fn label(&self) -> String {
        if self.neutral {
            format!("{} · {NEUTRAL_LABEL}", self.name)
        } else {
            self.name.clone()
        }
    }
    pub fn section(&self, id: &str) -> Option<&SectionRef> {
        self.sections.iter().find(|s| s.id == id)
    }
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.binding_id)
            && valid_scope_id(&self.id)
            && valid_scope_id(&self.version)
            && valid_scope_id(&self.source_version_id)
            && valid_scope_label(&self.name)
            && !self.sections.is_empty()
            && self.sections.len() <= MAX_BLOCKS
            && self.sections.iter().enumerate().all(|(i, s)| {
                valid_scope_id(&s.id)
                    && valid_scope_label(&s.title)
                    && self.sections[..i].iter().all(|p| p.id != s.id)
            })
    }
}

/// One checked assertion of a recorded claim: the record it pins (its ID
/// and digest), and the canonical value trusted code checked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pin {
    pub kind: AssertionKind,
    pub record_kind: RecordKind,
    pub record_id: String,
    /// The record's stored digest (an original's SHA-256 for a quote; for an
    /// exception, the digest of its identity).
    pub record_digest: String,
    pub measure: Option<CountMeasure>,
    pub criterion_id: Option<String>,
    /// The canonical value: a verdict (`none` for no verdict), a count, a
    /// conclusion or status code, a fact's value text, a quote, a period
    /// (`from/to`).
    pub value: String,
    /// An outcome's effective origin and review state.
    pub origin: Option<EffectiveOrigin>,
    pub review: Option<ReviewState>,
    /// A quote's exact locator; a fact's measure label.
    pub locator: Option<Locator>,
    pub unit: Option<String>,
    /// The record's subject (an outcome, exception or fact), when it has one.
    pub subject: Option<String>,
}
impl Pin {
    pub fn is_valid(&self) -> bool {
        record_kind_of(self.kind, &self.record_id) == Some(self.record_kind)
            && valid_digest(&self.record_digest)
            && match self.kind {
                AssertionKind::Count => self.measure.is_some_and(|m| {
                    m.per_criterion() == self.criterion_id.is_some()
                        && self
                            .value
                            .parse::<u64>()
                            .is_ok_and(|n| n.to_string() == self.value)
                }),
                _ => self.measure.is_none() && self.criterion_id.is_none(),
            }
            && (self.kind == AssertionKind::Outcome)
                == (self.origin.is_some() && self.review.is_some())
            && (self.kind == AssertionKind::Quote) == self.locator.is_some()
            && (self.kind == AssertionKind::Fact || self.unit.is_none())
            && self.criterion_id.as_deref().is_none_or(valid_scope_id)
            && self.subject.as_deref().is_none_or(valid_subject)
            && match self.kind {
                AssertionKind::Quote => {
                    text_ok(&self.value, MAX_QUOTE_BYTES)
                        && self
                            .locator
                            .as_ref()
                            .is_some_and(|l| l.render().len() <= MAX_LOCATOR_BYTES)
                }
                AssertionKind::Outcome => {
                    matches!(
                        self.value.as_str(),
                        "met" | "not_met" | "undetermined" | "none"
                    )
                }
                AssertionKind::Conclusion => Conclusion::parse(&self.value).is_some(),
                AssertionKind::Exception => ExceptionStatus::parse(&self.value).is_some(),
                _ => text_ok(&self.value, 1_024),
            }
    }
    /// The values a figure of the sentence may equal.
    pub fn renderings(&self, out: &mut Renderings) {
        match self.kind {
            AssertionKind::Count => {
                if let Ok(n) = self.value.parse::<u64>() {
                    out.count(n);
                }
            }
            AssertionKind::Fact => {
                if crate::assessment::Decimal::parse_plain(&self.value).is_some() {
                    out.decimal(&self.value);
                }
                out.text(&self.value);
            }
            AssertionKind::Quote | AssertionKind::Period => out.text(&self.value),
            _ => {}
        }
    }
}

/// Who wrote a block or a version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Author {
    /// The agent, in one answer invocation.
    Agent { invocation_id: String },
    /// A person.
    Human { actor_id: String },
}
impl Author {
    pub fn kind(&self) -> AuthorKind {
        match self {
            Self::Agent { .. } => AuthorKind::Agent,
            Self::Human { .. } => AuthorKind::Human,
        }
    }
    pub fn id(&self) -> &str {
        match self {
            Self::Agent { invocation_id } => invocation_id,
            Self::Human { actor_id } => actor_id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Content {
    Heading { text: String },
    Narrative { label: NarrativeLabel, text: String },
    Claim { statement: String, pins: Vec<Pin> },
    Coverage { summary_id: String },
    Exceptions { basis_id: String },
    Limitations,
}
impl Content {
    pub fn kind(&self) -> BlockKind {
        match self {
            Self::Heading { .. } => BlockKind::Heading,
            Self::Narrative { .. } => BlockKind::Narrative,
            Self::Claim { .. } => BlockKind::Claim,
            Self::Coverage { .. } => BlockKind::Coverage,
            Self::Exceptions { .. } => BlockKind::Exceptions,
            Self::Limitations => BlockKind::Limitations,
        }
    }
}

/// One block of a recorded version. Its ID survives versions; a kept block
/// is byte-equal to its source block, author and pins included.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub id: String,
    pub section: String,
    pub content: Content,
    pub author: Author,
    /// The version that wrote this content.
    pub authored_in: String,
}
impl Block {
    pub fn is_valid(&self) -> bool {
        valid_block_id(&self.id)
            && valid_scope_id(&self.section)
            && valid_scope_id(self.author.id())
            && valid_version_id(&self.authored_in)
            && match &self.content {
                Content::Heading { text } => text_ok(text, MAX_HEADING_BYTES),
                Content::Narrative { text, .. } => text_ok(text, MAX_NARRATIVE_BYTES),
                Content::Claim { statement, pins } => {
                    text_ok(statement, MAX_STATEMENT_BYTES)
                        && (1..=MAX_ASSERTIONS).contains(&pins.len())
                        && pins.iter().all(Pin::is_valid)
                }
                Content::Coverage { summary_id } => {
                    valid_prefixed(summary_id, "summary-")
                        || valid_prefixed(summary_id, "esummary-")
                }
                Content::Exceptions { basis_id } => valid_prefixed(basis_id, "basis-"),
                Content::Limitations => true,
            }
    }
    /// The canonical block document (also its byte identity when kept).
    pub fn document(&self) -> JsonValue {
        let (label, text, statement, record) = match &self.content {
            Content::Heading { text } => (None, Some(text.as_str()), None, None),
            Content::Narrative { label, text } => {
                (Some(label.as_str()), Some(text.as_str()), None, None)
            }
            Content::Claim { statement, .. } => (None, None, Some(statement.as_str()), None),
            Content::Coverage { summary_id } => (None, None, None, Some(summary_id.as_str())),
            Content::Exceptions { basis_id } => (None, None, None, Some(basis_id.as_str())),
            Content::Limitations => (None, None, None, None),
        };
        let pins: &[Pin] = match &self.content {
            Content::Claim { pins, .. } => pins,
            _ => &[],
        };
        object(vec![
            ("block_id", s(&self.id)),
            ("section_id", s(&self.section)),
            ("kind", s(self.content.kind().as_str())),
            ("label", opt(label)),
            ("text", opt(text)),
            ("statement", opt(statement)),
            ("record_id", opt(record)),
            ("author_kind", s(self.author.kind().as_str())),
            ("author_id", s(self.author.id())),
            ("authored_in_version", s(&self.authored_in)),
            (
                "assertions",
                JsonValue::Array(pins.iter().map(pin_document).collect()),
            ),
        ])
    }
    /// SHA-256 of the canonical block document.
    pub fn digest(&self) -> String {
        sha256_hex(canonical_json(&self.document()).as_bytes())
    }
}

/// One immutable version of a work product.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Version {
    pub id: String,
    pub product_id: String,
    pub task_id: String,
    pub number: u32,
    pub predecessor: Option<String>,
    pub author: Author,
    /// A person's request key; an agent's answer cycle.
    pub key: Option<String>,
    pub cycle_id: Option<String>,
    pub title: String,
    pub kind: ProductKind,
    pub template: TemplateRef,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub blocks: Vec<Block>,
    /// Required template sections with no content block, in template order.
    pub missing_required: Vec<String>,
}

fn s(value: &str) -> JsonValue {
    JsonValue::String(value.into())
}
fn opt(value: Option<&str>) -> JsonValue {
    value.map_or(JsonValue::Null, s)
}
fn int(value: u64) -> JsonValue {
    JsonValue::Integer(value.min(i64::MAX as u64) as i64)
}
fn object(fields: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())
}
fn pin_document(p: &Pin) -> JsonValue {
    object(vec![
        ("kind", s(p.kind.as_str())),
        ("record_kind", s(p.record_kind.as_str())),
        ("record_id", s(&p.record_id)),
        ("record_digest", s(&p.record_digest)),
        ("measure", opt(p.measure.map(CountMeasure::as_str))),
        ("criterion_id", opt(p.criterion_id.as_deref())),
        ("value", s(&p.value)),
        ("origin", opt(p.origin.map(EffectiveOrigin::as_str))),
        ("review", opt(p.review.map(ReviewState::as_str))),
        (
            "locator",
            p.locator
                .as_ref()
                .map_or(JsonValue::Null, |l| s(&l.render())),
        ),
        ("unit", opt(p.unit.as_deref())),
        ("subject", opt(p.subject.as_deref())),
    ])
}

/// Which template sections have content (any block but the platform's
/// limitations block).
pub fn missing_required(template: &TemplateRef, blocks: &[Block]) -> Vec<String> {
    template
        .sections
        .iter()
        .filter(|s| s.required)
        .filter(|s| {
            !blocks
                .iter()
                .any(|b| b.section == s.id && b.content.kind() != BlockKind::Limitations)
        })
        .map(|s| s.id.clone())
        .collect()
}

impl Version {
    /// The canonical version document (digest and time excluded).
    pub fn document(&self) -> JsonValue {
        let t = &self.template;
        object(vec![
            ("record", s("work_product_version")),
            ("id", s(&self.id)),
            ("product_id", s(&self.product_id)),
            ("task_id", s(&self.task_id)),
            ("version", int(u64::from(self.number))),
            ("predecessor_id", opt(self.predecessor.as_deref())),
            ("author_kind", s(self.author.kind().as_str())),
            ("author_id", s(self.author.id())),
            ("key", opt(self.key.as_deref())),
            ("cycle_id", opt(self.cycle_id.as_deref())),
            ("title", s(&self.title)),
            ("kind", s(self.kind.as_str())),
            (
                "template",
                object(vec![
                    ("binding_id", s(&t.binding_id)),
                    ("id", s(&t.id)),
                    ("version", s(&t.version)),
                    ("source_version_id", s(&t.source_version_id)),
                    ("name", s(&t.name)),
                    ("neutral", JsonValue::Bool(t.neutral)),
                    (
                        "sections",
                        JsonValue::Array(
                            t.sections
                                .iter()
                                .map(|x| {
                                    object(vec![
                                        ("id", s(&x.id)),
                                        ("title", s(&x.title)),
                                        ("required", JsonValue::Bool(x.required)),
                                    ])
                                })
                                .collect(),
                        ),
                    ),
                ]),
            ),
            ("methodology_binding_id", s(&self.methodology_binding_id)),
            ("execution_epoch", int(self.execution_epoch)),
            ("figure_rule", s(FIGURE_RULE)),
            (
                "blocks",
                JsonValue::Array(self.blocks.iter().map(Block::document).collect()),
            ),
            (
                "missing_required",
                JsonValue::Array(self.missing_required.iter().map(|m| s(m)).collect()),
            ),
        ])
    }
    /// SHA-256 of the canonical version document.
    pub fn digest(&self) -> String {
        sha256_hex(canonical_json(&self.document()).as_bytes())
    }
    /// The claims of this version.
    pub fn claims(&self) -> impl Iterator<Item = (&Block, &[Pin])> {
        self.blocks.iter().filter_map(|b| match &b.content {
            Content::Claim { pins, .. } => Some((b, pins.as_slice())),
            _ => None,
        })
    }
    /// The structural rules the database also enforces.
    pub fn is_valid(&self) -> bool {
        let claims = self.claims().count();
        let limitations = self
            .blocks
            .iter()
            .filter(|b| b.content.kind() == BlockKind::Limitations)
            .count();
        valid_version_id(&self.id)
            && valid_product_id(&self.product_id)
            && valid_scope_id(&self.task_id)
            && (1..=MAX_VERSIONS).contains(&self.number)
            && (self.number == 1) == self.predecessor.is_none()
            && self.predecessor.as_deref().is_none_or(valid_version_id)
            && valid_scope_id(self.author.id())
            && match (&self.author, &self.key, &self.cycle_id) {
                (Author::Agent { .. }, None, Some(cycle)) => valid_scope_id(cycle),
                (Author::Human { .. }, Some(key), None) => valid_scope_id(key),
                _ => false,
            }
            && valid_title(&self.title)
            && self.template.is_valid()
            && valid_scope_id(&self.methodology_binding_id)
            && self.execution_epoch > 0
            && !self.blocks.is_empty()
            && self.blocks.len() <= MAX_BLOCKS
            && claims <= MAX_CLAIMS
            && limitations == 1
            && self.blocks.iter().all(|b| {
                b.is_valid()
                    && self.template.section(&b.section).is_some()
                    && (b.authored_in != self.id || b.author == self.author)
            })
            && self
                .blocks
                .iter()
                .enumerate()
                .all(|(i, b)| self.blocks[..i].iter().all(|p| p.id != b.id))
            && self.missing_required == missing_required(&self.template, &self.blocks)
            && canonical_json(&self.document()).len() <= MAX_VERSION_BYTES
    }
    /// Decode a stored version document; refused unless it re-renders to the
    /// same document and is valid.
    pub fn from_document(document: &JsonValue) -> Option<Self> {
        let map = as_map(document)?;
        (text(map, "record")? == "work_product_version").then_some(())?;
        let t = as_map(map.get("template")?)?;
        let sections = as_array(t.get("sections")?)?
            .iter()
            .map(|x| {
                let x = as_map(x)?;
                Some(SectionRef {
                    id: text(x, "id")?,
                    title: text(x, "title")?,
                    required: boolean(x, "required")?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let template = TemplateRef {
            binding_id: text(t, "binding_id")?,
            id: text(t, "id")?,
            version: text(t, "version")?,
            source_version_id: text(t, "source_version_id")?,
            name: text(t, "name")?,
            neutral: boolean(t, "neutral")?,
            sections,
        };
        let author = |kind: &str, id: String| match AuthorKind::parse(kind)? {
            AuthorKind::Agent => Some(Author::Agent { invocation_id: id }),
            AuthorKind::Human => Some(Author::Human { actor_id: id }),
        };
        let blocks = as_array(map.get("blocks")?)?
            .iter()
            .map(|b| {
                let b = as_map(b)?;
                let kind = BlockKind::parse(&text(b, "kind")?)?;
                let pins = as_array(b.get("assertions")?)?
                    .iter()
                    .map(pin_from)
                    .collect::<Option<Vec<_>>>()?;
                let content = match kind {
                    BlockKind::Heading => Content::Heading {
                        text: text(b, "text")?,
                    },
                    BlockKind::Narrative => Content::Narrative {
                        label: NarrativeLabel::parse(&text(b, "label")?)?,
                        text: text(b, "text")?,
                    },
                    BlockKind::Claim => Content::Claim {
                        statement: text(b, "statement")?,
                        pins,
                    },
                    BlockKind::Coverage => Content::Coverage {
                        summary_id: text(b, "record_id")?,
                    },
                    BlockKind::Exceptions => Content::Exceptions {
                        basis_id: text(b, "record_id")?,
                    },
                    BlockKind::Limitations => Content::Limitations,
                };
                Some(Block {
                    id: text(b, "block_id")?,
                    section: text(b, "section_id")?,
                    content,
                    author: author(&text(b, "author_kind")?, text(b, "author_id")?)?,
                    authored_in: text(b, "authored_in_version")?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let version = Self {
            id: text(map, "id")?,
            product_id: text(map, "product_id")?,
            task_id: text(map, "task_id")?,
            number: u32::try_from(integer(map, "version")?).ok()?,
            predecessor: optional(map, "predecessor_id")?,
            author: author(&text(map, "author_kind")?, text(map, "author_id")?)?,
            key: optional(map, "key")?,
            cycle_id: optional(map, "cycle_id")?,
            title: text(map, "title")?,
            kind: ProductKind::parse(&text(map, "kind")?)?,
            template,
            methodology_binding_id: text(map, "methodology_binding_id")?,
            execution_epoch: u64::try_from(integer(map, "execution_epoch")?).ok()?,
            blocks,
            missing_required: as_array(map.get("missing_required")?)?
                .iter()
                .map(|v| match v {
                    JsonValue::String(v) => Some(v.clone()),
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()?,
        };
        (version.is_valid() && version.document() == *document).then_some(version)
    }
}

fn as_map(value: &JsonValue) -> Option<&BTreeMap<String, JsonValue>> {
    match value {
        JsonValue::Object(m) => Some(m),
        _ => None,
    }
}
fn as_array(value: &JsonValue) -> Option<&Vec<JsonValue>> {
    match value {
        JsonValue::Array(a) => Some(a),
        _ => None,
    }
}
fn text(map: &BTreeMap<String, JsonValue>, key: &str) -> Option<String> {
    match map.get(key)? {
        JsonValue::String(v) => Some(v.clone()),
        _ => None,
    }
}
fn optional(map: &BTreeMap<String, JsonValue>, key: &str) -> Option<Option<String>> {
    match map.get(key)? {
        JsonValue::String(v) => Some(Some(v.clone())),
        JsonValue::Null => Some(None),
        _ => None,
    }
}
fn integer(map: &BTreeMap<String, JsonValue>, key: &str) -> Option<i64> {
    match map.get(key)? {
        JsonValue::Integer(v) => Some(*v),
        _ => None,
    }
}
fn boolean(map: &BTreeMap<String, JsonValue>, key: &str) -> Option<bool> {
    match map.get(key)? {
        JsonValue::Bool(v) => Some(*v),
        _ => None,
    }
}
fn pin_from(value: &JsonValue) -> Option<Pin> {
    let m = as_map(value)?;
    let kind = AssertionKind::parse(&text(m, "kind")?)?;
    let pin = Pin {
        kind,
        record_kind: RecordKind::parse(&text(m, "record_kind")?)?,
        record_id: text(m, "record_id")?,
        record_digest: text(m, "record_digest")?,
        measure: match optional(m, "measure")? {
            Some(v) => Some(CountMeasure::parse(&v)?),
            None => None,
        },
        criterion_id: optional(m, "criterion_id")?,
        value: text(m, "value")?,
        origin: match optional(m, "origin")? {
            Some(v) => Some(EffectiveOrigin::parse(&v)?),
            None => None,
        },
        review: match optional(m, "review")? {
            Some(v) => Some(ReviewState::parse(&v)?),
            None => None,
        },
        locator: match optional(m, "locator")? {
            Some(v) => Some(Locator::parse(&v)?),
            None => None,
        },
        unit: optional(m, "unit")?,
        subject: optional(m, "subject")?,
    };
    pin.is_valid().then_some(pin)
}

// --------------------------------------------------------------- currency

/// What trusted code reads now about one pinned record.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Current {
    /// The chain's current head and its effective outcome now.
    Outcome {
        head_id: String,
        verdict: Option<Verdict>,
        origin: EffectiveOrigin,
        review: ReviewState,
    },
    /// Whether a newer summary or effective summary of the same population
    /// lineage (and sample) supersedes it.
    Summary {
        superseded: bool,
    },
    Exception {
        status: ExceptionStatus,
    },
    /// Whether a successor basis replaced the fact.
    Fact {
        superseded: bool,
    },
    /// The original's currently registered digest as this reader sees it
    /// (None: not visible to it), and whether this viewer may read it now.
    Quote {
        registered: Option<String>,
        readable: bool,
    },
    Period,
}

/// Whether a claim is current, derived on read and never stored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimCurrency {
    /// The closed reasons it needs refresh (empty: current), in vocabulary
    /// order.
    pub reasons: Vec<RefreshReason>,
    /// A quote whose original this viewer may not read now: shown as
    /// "withheld for this viewer", never as stale.
    pub withheld: bool,
}
impl ClaimCurrency {
    pub fn current(&self) -> bool {
        self.reasons.is_empty()
    }
}

/// The verdict text an outcome pin holds.
pub fn verdict_value(verdict: Option<Verdict>) -> &'static str {
    verdict.map_or("none", Verdict::as_str)
}

/// Pure: a claim's currency from its pins and what is true now (one
/// [`Current`] per pin, in order). A missing current fact is treated as the
/// record's change it would show (never as current).
pub fn currency(pins: &[Pin], current: &[Current]) -> ClaimCurrency {
    let mut reasons = BTreeSet::new();
    let mut withheld = false;
    for (index, pin) in pins.iter().enumerate() {
        let now = current.get(index);
        match (pin.kind, now) {
            (
                AssertionKind::Outcome,
                Some(Current::Outcome {
                    head_id,
                    verdict,
                    origin,
                    review,
                }),
            ) => {
                if *head_id != pin.record_id {
                    reasons.insert(RefreshReason::EvaluationRevised);
                } else if verdict_value(*verdict) != pin.value
                    || Some(*origin) != pin.origin
                    || Some(*review) != pin.review
                {
                    reasons.insert(RefreshReason::DispositionChanged);
                }
            }
            (AssertionKind::Outcome, _) => {
                reasons.insert(RefreshReason::EvaluationRevised);
            }
            (
                AssertionKind::Count | AssertionKind::Conclusion,
                Some(Current::Summary { superseded: false }),
            ) => {}
            (AssertionKind::Count | AssertionKind::Conclusion, _) => {
                reasons.insert(RefreshReason::SummarySuperseded);
            }
            (AssertionKind::Exception, Some(Current::Exception { status }))
                if status.as_str() == pin.value => {}
            (AssertionKind::Exception, _) => {
                reasons.insert(RefreshReason::ExceptionStatusChanged);
            }
            (AssertionKind::Fact, Some(Current::Fact { superseded: false })) => {}
            (AssertionKind::Fact, _) => {
                reasons.insert(RefreshReason::FactSuperseded);
            }
            (
                AssertionKind::Quote,
                Some(Current::Quote {
                    registered,
                    readable,
                }),
            ) => {
                // Registered under another digest: the original it quotes is
                // not the one it was verified against. Not visible to this
                // viewer (or not readable now) is never proof of that: the
                // quote is withheld, not stale.
                match registered {
                    Some(digest) if *digest != pin.record_digest => {
                        reasons.insert(RefreshReason::SourceWithdrawn);
                    }
                    Some(_) if *readable => {}
                    _ => withheld = true,
                }
            }
            (AssertionKind::Quote, _) => {
                reasons.insert(RefreshReason::SourceWithdrawn);
            }
            (AssertionKind::Period, _) => {}
        }
    }
    ClaimCurrency {
        reasons: reasons.into_iter().collect(),
        withheld,
    }
}

// --------------------------------------------------------- coverage words

/// The platform coverage line of a summary: completeness in words ("at
/// least N found" and "not known" for an incomplete population; "selected
/// items only" for a sample), never a model's words.
pub fn coverage_line(summary: &Summary) -> String {
    let p = &summary.partition;
    let mut line = match summary.selected {
        Some(n) => format!(
            "Sample: selected items only · {} selected; the counts describe the selected items, never the population",
            grouped(n)
        ),
        None if summary.completeness.complete() => format!(
            "Population complete · {} in scope",
            grouped(summary.counts.in_scope)
        ),
        None => format!(
            "Population incomplete · at least {} found; the total is not known",
            grouped(summary.counts.in_scope)
        ),
    };
    if p.unresolved > 0 {
        line.push_str(&format!(
            " · unresolved {} (see Limitations)",
            grouped(p.unresolved)
        ));
    }
    line
}
/// A count with comma grouping, as the documents show it.
pub fn grouped(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

// ------------------------------------------------------------ answer field

fn string(max: usize) -> ArgumentSchema {
    ArgumentSchema::String {
        max_bytes: max as u32,
        enumeration: vec![],
    }
}
fn enumerated(values: Vec<&str>) -> ArgumentSchema {
    let max = values.iter().map(|v| v.len()).max().unwrap_or(1);
    ArgumentSchema::String {
        max_bytes: max as u32,
        enumeration: values.into_iter().map(String::from).collect(),
    }
}
fn strict(fields: Vec<(&str, ArgumentSchema)>) -> ArgumentSchema {
    let required = fields.iter().map(|(k, _)| (*k).to_string()).collect();
    ArgumentSchema::Object {
        properties: fields
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        required,
    }
}

/// The Story 24.4 answer field, offered only when assessment is composed.
/// Every property is required (strict output); `""` means none. The shape
/// is compact because the whole answer schema has one fixed byte bound:
/// `template` is `id:version`; `base` is the version it edits (empty for a
/// new work product, whose product is then created); a block's `kind` is
/// `keep` (with the kept block's ID in `record`), `heading`, `narrative`,
/// `judgment` (narrative labelled Zobba's judgment), `claim` (its sentence
/// in `text`), `coverage` (a summary ID in `record`), `exceptions` (a basis
/// ID in `record`) or `limitations`; an assertion's `detail` is a count's
/// criterion ID or a quote's exact locator.
pub fn answer_fields() -> Vec<(&'static str, ArgumentSchema)> {
    let mut measures = vec![""];
    measures.extend(CountMeasure::ALL.iter().map(|m| m.as_str()));
    let assertion = strict(vec![
        (
            "kind",
            enumerated(AssertionKind::ALL.iter().map(|k| k.as_str()).collect()),
        ),
        ("record", string(128)),
        ("measure", enumerated(measures)),
        ("detail", string(MAX_LOCATOR_BYTES)),
        ("value", string(MAX_QUOTE_BYTES)),
    ]);
    let block = strict(vec![
        (
            "kind",
            enumerated(vec![
                "keep",
                "heading",
                "narrative",
                "judgment",
                "claim",
                "coverage",
                "exceptions",
                "limitations",
            ]),
        ),
        ("section", string(128)),
        ("text", string(MAX_NARRATIVE_BYTES)),
        ("record", string(128)),
        (
            "assertions",
            ArgumentSchema::Array {
                items: Box::new(assertion),
                max_items: MAX_ASSERTIONS as u32,
            },
        ),
    ]);
    let draft = strict(vec![
        ("title", string(MAX_TITLE_CHARS * 4)),
        (
            "kind",
            enumerated(ProductKind::ALL.iter().map(|k| k.as_str()).collect()),
        ),
        ("template", string(257)),
        ("base", string(48)),
        (
            "blocks",
            ArgumentSchema::Array {
                items: Box::new(block),
                max_items: MAX_BLOCKS as u32,
            },
        ),
    ]);
    vec![(
        "draft_work_product",
        ArgumentSchema::Array {
            items: Box::new(draft),
            max_items: MAX_DRAFTS as u32,
        },
    )]
}

fn assertion_from(value: &JsonValue) -> Option<ProposedAssertion> {
    let m = as_map(value)?;
    let record = text(m, "record")?;
    let measure = text(m, "measure")?;
    let detail = text(m, "detail")?;
    let raw = text(m, "value")?;
    Some(match AssertionKind::parse(&text(m, "kind")?)? {
        AssertionKind::Outcome => ProposedAssertion::Outcome {
            evaluation_id: record,
            verdict: match raw.as_str() {
                "none" => Some(None),
                v => Verdict::parse(v).map(Some),
            },
        },
        AssertionKind::Count => ProposedAssertion::Count {
            summary_id: record,
            measure: CountMeasure::parse(&measure),
            criterion_id: (!detail.is_empty()).then_some(detail),
            // Exactly a decimal count, no sign, no leading zero, no grouping.
            value: raw.parse::<u64>().ok().filter(|n| n.to_string() == raw),
        },
        AssertionKind::Conclusion => ProposedAssertion::Conclusion {
            summary_id: record,
            code: Conclusion::parse(&raw),
        },
        AssertionKind::Exception => ProposedAssertion::Exception {
            exception_id: record,
            status: ExceptionStatus::parse(&raw),
        },
        AssertionKind::Fact => ProposedAssertion::Fact {
            fact_id: record,
            value: raw,
        },
        AssertionKind::Quote => ProposedAssertion::Quote {
            source: CitationSource {
                original_id: record,
                locator: Locator::parse(&detail).filter(|l| l.render() == detail),
                quote: raw,
            },
        },
        AssertionKind::Period => ProposedAssertion::Period { basis_id: record },
    })
}

fn block_from(value: &JsonValue) -> Option<ProposedBlock> {
    let m = as_map(value)?;
    let kind = text(m, "kind")?;
    let section = text(m, "section")?;
    let body = text(m, "text")?;
    let record = text(m, "record")?;
    let assertions = as_array(m.get("assertions")?)?;
    let decoded = assertions
        .iter()
        .map(assertion_from)
        .collect::<Option<Vec<_>>>();
    let plain = decoded.as_ref().is_some_and(Vec::is_empty);
    let content = match kind.as_str() {
        // A kept block names only its ID; any content beside it is a
        // malformed block, refused with its own reason.
        "keep" if plain && section.is_empty() && body.is_empty() => {
            return Some(ProposedBlock::Keep(record));
        }
        "heading" if plain && record.is_empty() => ProposedContent::Heading { text: body },
        "narrative" | "judgment" if plain && record.is_empty() => ProposedContent::Narrative {
            label: if kind == "judgment" {
                NarrativeLabel::Judgment
            } else {
                NarrativeLabel::Narrative
            },
            text: body,
        },
        "claim" if record.is_empty() => match decoded {
            Some(assertions) => ProposedContent::Claim {
                statement: body,
                assertions,
            },
            None => ProposedContent::Malformed,
        },
        "coverage" if plain && body.is_empty() => ProposedContent::Coverage { summary_id: record },
        "exceptions" if plain && body.is_empty() => {
            ProposedContent::Exceptions { basis_id: record }
        }
        "limitations" if plain && body.is_empty() && record.is_empty() => {
            ProposedContent::Limitations
        }
        _ => ProposedContent::Malformed,
    };
    Some(ProposedBlock::New { section, content })
}

/// Decode one `draft_work_product` entry. A wrong JSON shape refuses the
/// entry (counted as discarded); a block whose content is wrong is kept as
/// malformed so trusted code refuses it with its reason.
pub fn decode_draft(value: &JsonValue) -> Option<Draft> {
    let m = as_map(value)?;
    let base = text(m, "base")?;
    let template = text(m, "template")?;
    let (template_id, template_version) = template.split_once(':').unwrap_or((&template, ""));
    Some(Draft {
        title: text(m, "title")?,
        kind: ProductKind::parse(&text(m, "kind")?)?,
        template_id: template_id.into(),
        template_version: template_version.into(),
        base_version: (!base.is_empty()).then_some(base),
        blocks: as_array(m.get("blocks")?)?
            .iter()
            .map(block_from)
            .collect::<Option<Vec<_>>>()?,
    })
}

#[cfg(test)]
mod tests;
