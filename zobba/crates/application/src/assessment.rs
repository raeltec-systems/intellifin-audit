//! Story 24.1: typed criteria and facts bound to an assessment basis.
//!
//! The agent keeps reading and acting natively (22.5/22.6). When it is ready
//! to assess, it proposes criteria, an assessment basis, typed facts and
//! judgments in its structured answer. Trusted code turns each proposal into
//! an immutable record only after it checks it:
//!
//! - a criterion's authority is either a criterion of the current method
//!   binding (read like a method part) or a quote verified at its exact
//!   location by the 22.5 verifier; an unverified authority is recorded but
//!   can never yield `met` or `not_met`;
//! - a fact's sources are verified at their exact locations, and its typed
//!   value is re-parsed from the verified quote under its declared rule; a
//!   fact that depends on a failed analysis job is `analysis_failed`;
//! - a rule criterion is evaluated by the pure predicates of
//!   `zobba_domain::assessment` when the agent asks `evaluate`; the model
//!   never writes a rule verdict. A judgment is recorded as a model proposal
//!   with its rationale in words, pending human disposition (24.3).
//!
//! Every record names its invocation, methodology binding and execution
//! epoch. Criterion, fact and basis text is attributed data and never grants
//! authority. No numeric confidence exists anywhere.
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    sync::Mutex,
};

use crate::{
    citation::{CitationReader, ReadingError, verify_located},
    investigation::{bounded, criteria_missing},
    methodology::Binding,
    model::{Invocation, ModelCancellation, ModelError},
};
use zobba_domain::{
    assessment::{
        Applicability, Authority, AuthorityReason, CivilDate, CriterionKind, CriterionMethod,
        Decimal, EvaluationContext, EvaluationReason, Execution, FactState, FactSupport, FactType,
        FactValue, InputFact, Instant, Measure, Origin, Outcome, ParseRule, PopulationReference,
        Predicate, ProposedBasis, ProposedCriterion, ProposedFact, RequiredFact, UnavailableReason,
        UnsupportedReason, Verdict, evaluate, judge, output_digest, whole_token, whole_value,
    },
    citation::{
        CitationSource, CitedAnswer, Locator, Segment, UnverifiedReason, Verification,
        VerifiedSource, normalize,
    },
    context::{InputClass, canonical_json, envelope},
    model::JsonValue,
    task::ClaimBasis,
    work::sha256_hex,
};

/// Subjects one `evaluate` request evaluates; the rest are counted.
pub const MAX_SUBJECTS_PER_CRITERION: usize = 64;
/// Facts one basis version may hold (an exact read, never a bounded list).
pub const MAX_BASIS_FACTS: usize = 1_024;
/// Evaluation records one invocation may write (16 criteria × 64 subjects,
/// plus 8 judgments).
pub const MAX_INVOCATION_EVALUATIONS: usize = 16 * MAX_SUBJECTS_PER_CRITERION + 8;
/// Records the outline lists; the rest are counted.
pub const MAX_OUTLINE_RECORDS: usize = 64;
/// The outline and feedback bound (tier 2 is never dropped).
pub const MAX_ASSESSMENT_OUTLINE_BYTES: usize = 16 * 1024;
pub const MAX_ASSESSMENT_FEEDBACK_BYTES: usize = 8 * 1024;

use revision::{ChainHead, Planned, head_line};

pub const ASSESSMENT_CONSTRAINTS: &str = "When you are ready to assess, use the assessment fields. Propose criteria in propose_criteria: an assertion, its authority (method: a requirement ID and the 0-based criterion ordinal of the bound method; or original: a registered original, an exact locator and the exact quote), the facts it needs with their types and units or ISO 4217 currency, an optional applicability test, and either a rule (one closed predicate that trusted code evaluates) or a judgment rubric. Propose one assessment basis in propose_basis: the objective, its criteria (IDs, or keys of criteria in the same answer), the business period, population references to registered originals, and limitations. Record typed facts in record_facts for one subject each (kept exactly, leading zeros included): the value in canonical form (decimals like 1250.00 with a unit or currency, dates YYYY-MM-DD, instants in RFC 3339 with the source offset), the closed parse rule that turns your quote into that value, and the exact quoted sources; or unavailable with a closed reason, or ambiguous with the number of candidates. Trusted code verifies each quote at its location and re-parses it; a value the source does not show is unsupported. Ask trusted code to evaluate rule criteria in evaluate; you never write a rule verdict. Propose judgments only for judgment criteria, with the facts that support and contradict them and your reasoning and uncertainty in words. Missing, unavailable or unsupported evidence is never an exception, and there is no confidence score. Records are immutable: to change one, propose a new version that supersedes it. To show exact coverage, propose one population manifest in propose_population once you have found the population source: the registered original, the sheet and 1-based header row of a workbook (no sheet and header row 1 for CSV or plain text), the subject unit, one to three grain columns whose exact cell texts form each subject key, an optional period column with its date or instant rule, typed value columns (header, fact name, type, parse rule, a decimal's unit or ISO 4217 currency and the column in the same row that shows it), whether the source is the whole population (a search export or a filtered view is not), and optionally a control count you cite at its exact location. Trusted code reads every row and counts; you never count, list members or decide a row's scope. Propose a sample in propose_sample (all_in_scope, judgmental, or seeded_random with a seed; trusted code recomputes a seeded selection), ask evaluate_population to evaluate a criterion of the population's basis over every in-scope member, and ask summarise for the coverage summary. Counts are exact; there are no percentages and no statistical inference, and a sample describes only the items it selected. When late evidence arrives, record the new fact on the same basis (a fact not yet recorded there) and ask evaluate or propose the judgment again: trusted code finds the current evaluation, derives why it changed and appends a revision, and records nothing when nothing changed. To correct a recorded fact, propose a successor basis that supersedes it, list it in carry_facts with the (subject, name) pairs to leave out, and record the corrected facts on the successor; every other fact is carried by reference with its original verification. A person may ask you to reconsider an evaluation: the outline shows their concern and their words as quoted data; reconsider by evaluating or judging again. You never choose a predecessor, a cause or a disposition.";

/// The state of an analysis job a fact depends on, from its latest
/// outcome event (a `collected` event repeats the outcome before it).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobState {
    /// Completed: its outputs may be relied on.
    Completed,
    /// Ended without completing (failed, over a limit, stopped).
    Failed,
    /// Not ended yet (admitted, starting, running or unknown). A fact that
    /// depends on it is not recorded: nothing permanent is said about an
    /// analysis that may still complete.
    Pending,
}
impl JobState {
    /// The stored label of an ended job.
    pub const fn label(self) -> Option<&'static str> {
        match self {
            Self::Completed => Some("completed"),
            Self::Failed => Some("failed"),
            Self::Pending => None,
        }
    }
}

/// Whether trusted code found a fact's subject and measure at, or beside, a
/// verified source of its value: in the located text of that source, or as
/// the exact quote of another verified source in the same cell row (a
/// spreadsheet) or at the same location. Otherwise they are only claims.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Grounding {
    pub subject: bool,
    /// For a decimal value; None for every other kind.
    pub measure: Option<bool>,
}

/// The checked authority of a criterion version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthorityCheck {
    pub verified: bool,
    pub reason: Option<AuthorityReason>,
    /// Method authority: the binding read and the SHA-256 of the criterion text.
    pub binding_id: Option<String>,
    pub text_sha256: Option<String>,
    /// Original authority: the exact original digest verification read.
    pub original_sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CriterionRecord {
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub invocation_id: String,
    pub ordinal: u32,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub criterion: ProposedCriterion,
    pub authority: AuthorityCheck,
    pub digest: String,
    pub recorded_us: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BasisRecord {
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub invocation_id: String,
    pub ordinal: u32,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    /// `criteria` holds criterion IDs, resolved by trusted code.
    pub basis: ProposedBasis,
    /// The current registered digest of each population reference (None:
    /// not a registered original of this engagement).
    pub population_sha256: Vec<Option<String>>,
    pub digest: String,
    pub recorded_us: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FactRecord {
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub invocation_id: String,
    pub ordinal: u32,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub basis_id: String,
    /// `basis` holds the basis ID. A supported value is the one trusted code
    /// derived from the verified quote.
    pub fact: ProposedFact,
    pub sources: Vec<VerifiedSource>,
    pub support: FactSupport,
    pub grounding: Grounding,
    pub job_state: Option<JobState>,
    pub digest: String,
    pub recorded_us: Option<i64>,
}

/// A judgment's words and cited facts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JudgmentDetail {
    pub rubric_criterion_id: String,
    pub supporting: Vec<String>,
    pub contrary: Vec<String>,
    pub rationale: String,
    pub uncertainty: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvaluationRecord {
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub invocation_id: String,
    pub ordinal: u32,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub basis_id: String,
    pub criterion_id: String,
    pub subject: String,
    pub outcome: Outcome,
    pub judgment: Option<JudgmentDetail>,
    pub output_digest: String,
    pub recorded_us: Option<i64>,
}

/// Every assessment record one invocation wrote.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InvocationAssessment {
    pub criteria: Vec<CriterionRecord>,
    pub bases: Vec<BasisRecord>,
    pub facts: Vec<FactRecord>,
    pub evaluations: Vec<EvaluationRecord>,
}

/// The Task's recent assessment records, bounded, for the outline and view.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AssessmentSnapshot {
    pub bases: Vec<BasisRecord>,
    pub criteria: Vec<CriterionRecord>,
    pub facts: Vec<FactRecord>,
    pub evaluations: Vec<EvaluationRecord>,
    pub total_bases: u64,
    pub total_criteria: u64,
    pub total_facts: u64,
    pub total_evaluations: u64,
    /// The exact fact count of each listed basis (never a sampled count).
    pub basis_fact_counts: BTreeMap<String, u64>,
}

/// Durable assessment records under the exact claim producer's custody and
/// current Task authority. Every record is immutable; an identical retry
/// returns the original and a different one is refused. Exact checks use
/// exact queries, never the bounded snapshot.
pub trait AssessmentStore: Send + Sync {
    fn invocation_records(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> impl Future<Output = Result<InvocationAssessment, ReadingError>> + Send;
    /// Criterion versions of this Task by exact ID (unknown IDs are absent).
    fn criteria(
        &self,
        basis: &ClaimBasis,
        ids: &[String],
    ) -> impl Future<Output = Result<Vec<CriterionRecord>, ReadingError>> + Send;
    fn basis_record(
        &self,
        basis: &ClaimBasis,
        id: &str,
    ) -> impl Future<Output = Result<Option<BasisRecord>, ReadingError>> + Send;
    /// The newest basis version of this Task that lists the criterion.
    fn latest_basis_with(
        &self,
        basis: &ClaimBasis,
        criterion_id: &str,
    ) -> impl Future<Output = Result<Option<BasisRecord>, ReadingError>> + Send;
    /// Every fact of one basis version (at most [`MAX_BASIS_FACTS`]).
    fn facts(
        &self,
        basis: &ClaimBasis,
        basis_id: &str,
    ) -> impl Future<Output = Result<Vec<FactRecord>, ReadingError>> + Send;
    fn evaluation(
        &self,
        basis: &ClaimBasis,
        basis_id: &str,
        criterion_id: &str,
        subject: &str,
    ) -> impl Future<Output = Result<Option<EvaluationRecord>, ReadingError>> + Send;
    /// Every evaluation of one criterion under one basis version (an exact
    /// read: at most one per subject, and subjects are bounded by
    /// [`MAX_BASIS_FACTS`]).
    fn evaluations_of(
        &self,
        basis: &ClaimBasis,
        basis_id: &str,
        criterion_id: &str,
    ) -> impl Future<Output = Result<Vec<EvaluationRecord>, ReadingError>> + Send;
    /// The state of a 22.4 job of this Task; None when it is not one.
    fn job_state(
        &self,
        basis: &ClaimBasis,
        job_id: &str,
    ) -> impl Future<Output = Result<Option<JobState>, ReadingError>> + Send;
    fn record_criterion(
        &self,
        basis: &ClaimBasis,
        record: &CriterionRecord,
    ) -> impl Future<Output = Result<CriterionRecord, ReadingError>> + Send;
    fn record_basis(
        &self,
        basis: &ClaimBasis,
        record: &BasisRecord,
    ) -> impl Future<Output = Result<BasisRecord, ReadingError>> + Send;
    fn record_fact(
        &self,
        basis: &ClaimBasis,
        record: &FactRecord,
    ) -> impl Future<Output = Result<FactRecord, ReadingError>> + Send;
    fn record_evaluation(
        &self,
        basis: &ClaimBasis,
        record: &EvaluationRecord,
    ) -> impl Future<Output = Result<EvaluationRecord, ReadingError>> + Send;
    fn snapshot(
        &self,
        basis: &ClaimBasis,
    ) -> impl Future<Output = Result<AssessmentSnapshot, ReadingError>> + Send;
}

/// What the next turn carries: the assessment outline (tier 2) and what
/// became of the last answer's proposals.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AssessmentContext {
    pub outline: Option<String>,
    pub feedback: Option<String>,
}

/// The trusted assessment tools: a store under claim custody and the 22.5
/// citation reader that verifies quotes at their exact locations.
pub struct Assessment<'a, S, C> {
    pub store: &'a S,
    pub reader: &'a C,
    /// What became of the last processed answer's proposals, keyed by its
    /// invocation. Recomputed identically when a reclaim repeats the answer.
    pub feedback: Mutex<Option<(String, Vec<String>)>>,
}

impl<'a, S, C> Assessment<'a, S, C> {
    pub fn new(store: &'a S, reader: &'a C) -> Self {
        Self {
            store,
            reader,
            feedback: Mutex::new(None),
        }
    }
}

fn record_id(prefix: &str, task_id: &str, invocation_id: &str, ordinal: u32) -> String {
    let digest = sha256_hex(format!("{prefix}\0{task_id}\0{invocation_id}\0{ordinal}").as_bytes());
    format!("{prefix}-{}", &digest[..40])
}

/// The methodology binding and execution epoch a turn was produced under.
fn turn_basis(invocation: &Invocation) -> (String, u64) {
    (
        invocation
            .request
            .context
            .verification
            .expected_methodology_binding_id
            .clone(),
        invocation.request.basis.execution_epoch as u64,
    )
}

// ------------------------------------------------------------ documents

fn s(value: &str) -> JsonValue {
    JsonValue::String(value.into())
}
fn opt(value: Option<&str>) -> JsonValue {
    value.map_or(JsonValue::Null, s)
}
fn int(value: u64) -> JsonValue {
    JsonValue::Integer(value.min(i64::MAX as u64) as i64)
}
fn list(values: &[String]) -> JsonValue {
    JsonValue::Array(values.iter().map(|v| s(v)).collect())
}
fn obj(fields: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
    )
}
type Map = BTreeMap<String, JsonValue>;
fn as_obj(value: &JsonValue) -> Option<&Map> {
    match value {
        JsonValue::Object(map) => Some(map),
        _ => None,
    }
}
fn get_str<'v>(map: &'v Map, key: &str) -> Option<&'v str> {
    match map.get(key)? {
        JsonValue::String(v) => Some(v),
        _ => None,
    }
}
fn get_opt(map: &Map, key: &str) -> Option<Option<String>> {
    match map.get(key)? {
        JsonValue::String(v) => Some(Some(v.clone())),
        JsonValue::Null => Some(None),
        _ => None,
    }
}
fn get_int(map: &Map, key: &str) -> Option<i64> {
    match map.get(key)? {
        JsonValue::Integer(v) => Some(*v),
        _ => None,
    }
}
fn get_bool(map: &Map, key: &str) -> Option<bool> {
    match map.get(key)? {
        JsonValue::Bool(v) => Some(*v),
        _ => None,
    }
}
fn get_list(map: &Map, key: &str) -> Option<Vec<String>> {
    match map.get(key)? {
        JsonValue::Array(items) => items
            .iter()
            .map(|i| match i {
                JsonValue::String(v) => Some(v.clone()),
                _ => None,
            })
            .collect(),
        _ => None,
    }
}
fn get_array<'v>(map: &'v Map, key: &str) -> Option<&'v [JsonValue]> {
    match map.get(key)? {
        JsonValue::Array(items) => Some(items),
        _ => None,
    }
}

fn measure_doc(measure: Option<&Measure>) -> JsonValue {
    match measure {
        None => JsonValue::Null,
        Some(Measure::Currency(code)) => obj(vec![("currency", s(code))]),
        Some(Measure::Unit(unit)) => obj(vec![("unit", s(unit))]),
    }
}
fn measure_from(value: &JsonValue) -> Option<Option<Measure>> {
    match value {
        JsonValue::Null => Some(None),
        JsonValue::Object(map) => {
            if let Some(code) = get_str(map, "currency") {
                Some(Some(Measure::Currency(code.into())))
            } else {
                Some(Some(Measure::Unit(get_str(map, "unit")?.into())))
            }
        }
        _ => None,
    }
}
fn predicate_doc(predicate: Option<&Predicate>) -> JsonValue {
    let Some(predicate) = predicate else {
        return JsonValue::Null;
    };
    let mut fields = vec![("kind", s(predicate.kind().as_str()))];
    match predicate {
        Predicate::CompareConstant {
            fact,
            op,
            constant,
            measure,
        } => fields.extend([
            ("fact", s(fact)),
            ("op", s(op.as_str())),
            ("constant", s(&constant.render())),
            ("measure", measure_doc(Some(measure))),
        ]),
        Predicate::CompareFacts { left, op, right } => fields.extend([
            ("fact", s(left)),
            ("op", s(op.as_str())),
            ("right_fact", s(right)),
        ]),
        Predicate::IdentifiersEqual { left, right }
        | Predicate::IdentifiersDiffer { left, right } => {
            fields.extend([("fact", s(left)), ("right_fact", s(right))])
        }
        Predicate::MemberOf { fact, values } => {
            fields.extend([("fact", s(fact)), ("values", list(values))])
        }
        Predicate::WithinPeriod { fact }
        | Predicate::Present { fact }
        | Predicate::IsTrue { fact } => fields.push(("fact", s(fact))),
    }
    obj(fields)
}
fn predicate_from(value: &JsonValue) -> Option<Option<Predicate>> {
    use zobba_domain::assessment::{Comparison, PredicateKind};
    if *value == JsonValue::Null {
        return Some(None);
    }
    let map = as_obj(value)?;
    let fact = || get_str(map, "fact").map(String::from);
    let right = || get_str(map, "right_fact").map(String::from);
    let op = || Comparison::parse(get_str(map, "op")?);
    let predicate = match PredicateKind::parse(get_str(map, "kind")?)? {
        PredicateKind::CompareConstant => Predicate::CompareConstant {
            fact: fact()?,
            op: op()?,
            constant: Decimal::parse_plain(get_str(map, "constant")?)?,
            measure: measure_from(map.get("measure")?)??,
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
            values: get_list(map, "values")?,
        },
        PredicateKind::Present => Predicate::Present { fact: fact()? },
        PredicateKind::IsTrue => Predicate::IsTrue { fact: fact()? },
    };
    Some(Some(predicate))
}
fn source_doc(source: &CitationSource) -> Vec<(&'static str, JsonValue)> {
    vec![
        ("original_id", s(&source.original_id)),
        (
            "locator",
            source
                .locator
                .as_ref()
                .map_or(JsonValue::Null, |l| s(&l.render())),
        ),
        ("quote", s(&source.quote)),
    ]
}
fn source_from(map: &Map) -> Option<CitationSource> {
    Some(CitationSource {
        original_id: get_str(map, "original_id")?.into(),
        locator: match get_opt(map, "locator")? {
            Some(text) => Some(Locator::parse(&text)?),
            None => None,
        },
        quote: get_str(map, "quote")?.into(),
    })
}
fn date_doc(date: Option<CivilDate>) -> JsonValue {
    date.map_or(JsonValue::Null, |d| s(&d.render()))
}
fn date_from(map: &Map, key: &str) -> Option<Option<CivilDate>> {
    match get_opt(map, key)? {
        Some(text) => Some(Some(CivilDate::parse_iso(&text)?)),
        None => Some(None),
    }
}
fn value_doc(state: &FactState) -> JsonValue {
    match state {
        FactState::Value(value) => {
            let mut fields = vec![
                ("kind", s(value.kind().as_str())),
                ("value", s(&value.text())),
                ("measure", measure_doc(value.measure())),
            ];
            match value {
                FactValue::Decimal { value, .. } => {
                    // The exact representation: mantissa and scale.
                    fields.push(("mantissa", s(&value.mantissa.to_string())));
                    fields.push(("scale", int(u64::from(value.scale))));
                }
                FactValue::Instant(instant) => {
                    fields.push(("utc_micros", JsonValue::Integer(instant.utc_micros)));
                    fields.push((
                        "offset_minutes",
                        JsonValue::Integer(i64::from(instant.offset_minutes)),
                    ));
                }
                _ => {}
            }
            obj(fields)
        }
        FactState::Unavailable(reason) => obj(vec![
            ("kind", s("unavailable")),
            ("reason", s(reason.as_str())),
        ]),
        FactState::Ambiguous { candidates } => obj(vec![
            ("kind", s("ambiguous")),
            ("candidates", int(u64::from(*candidates))),
        ]),
    }
}
fn value_from(value: &JsonValue) -> Option<FactState> {
    let map = as_obj(value)?;
    match get_str(map, "kind")? {
        "unavailable" => Some(FactState::Unavailable(UnavailableReason::parse(get_str(
            map, "reason",
        )?)?)),
        "ambiguous" => Some(FactState::Ambiguous {
            candidates: u32::try_from(get_int(map, "candidates")?).ok()?,
        }),
        kind => {
            let kind = FactType::parse(kind)?;
            let value = FactValue::parse(
                kind,
                get_str(map, "value")?,
                measure_from(map.get("measure")?)?,
            )?;
            // The stored exact form must agree with its text.
            if let FactValue::Decimal { value: d, .. } = &value
                && (get_str(map, "mantissa")? != d.mantissa.to_string()
                    || get_int(map, "scale")? != i64::from(d.scale))
            {
                return None;
            }
            Some(FactState::Value(value))
        }
    }
}
fn verified_doc(sources: &[VerifiedSource]) -> JsonValue {
    JsonValue::Array(
        sources
            .iter()
            .map(|v| {
                let mut fields = source_doc(&v.source);
                fields.push(("original_sha256", opt(v.original_sha256.as_deref())));
                fields.push((
                    "verification",
                    s(match v.verification {
                        Verification::Verified => "verified",
                        Verification::Unverified(_) => "unverified",
                    }),
                ));
                fields.push(("reason", opt(v.verification.reason().map(|r| r.as_str()))));
                obj(fields)
            })
            .collect(),
    )
}
fn verified_from(items: &[JsonValue]) -> Option<Vec<VerifiedSource>> {
    items
        .iter()
        .map(|item| {
            let map = as_obj(item)?;
            let verification = match (get_str(map, "verification")?, get_opt(map, "reason")?) {
                ("verified", None) => Verification::Verified,
                ("unverified", Some(reason)) => {
                    Verification::Unverified(UnverifiedReason::parse(&reason)?)
                }
                _ => return None,
            };
            Some(VerifiedSource {
                source: source_from(map)?,
                original_sha256: get_opt(map, "original_sha256")?,
                verification,
            })
        })
        .collect()
}
/// The envelope fields every record document starts with.
macro_rules! envelope_doc {
    ($kind:literal, $record:expr) => {
        vec![
            ("record", s($kind)),
            ("id", s(&$record.id)),
            ("task_id", s(&$record.task_id)),
            ("cycle_id", s(&$record.cycle_id)),
            ("invocation_id", s(&$record.invocation_id)),
            ("ordinal", int(u64::from($record.ordinal))),
            ("methodology_binding_id", s(&$record.methodology_binding_id)),
            ("execution_epoch", int($record.execution_epoch)),
        ]
    };
}
struct Envelope {
    id: String,
    task_id: String,
    cycle_id: String,
    invocation_id: String,
    ordinal: u32,
    binding: String,
    epoch: u64,
}
fn envelope_from(map: &Map, kind: &str) -> Option<Envelope> {
    (get_str(map, "record")? == kind).then_some(())?;
    Some(Envelope {
        id: get_str(map, "id")?.into(),
        task_id: get_str(map, "task_id")?.into(),
        cycle_id: get_str(map, "cycle_id")?.into(),
        invocation_id: get_str(map, "invocation_id")?.into(),
        ordinal: u32::try_from(get_int(map, "ordinal")?).ok()?,
        binding: get_str(map, "methodology_binding_id")?.into(),
        epoch: u64::try_from(get_int(map, "execution_epoch")?).ok()?,
    })
}
/// SHA-256 of a document's canonical JSON.
pub fn document_digest(document: &JsonValue) -> String {
    sha256_hex(canonical_json(document).as_bytes())
}

impl CriterionRecord {
    /// The canonical document stored and digested (digest and time excluded).
    pub fn document(&self) -> JsonValue {
        let c = &self.criterion;
        let mut fields = envelope_doc!("criterion", self);
        fields.extend([
            ("key", s(&c.key)),
            ("supersedes", opt(c.supersedes.as_deref())),
            ("assertion", s(&c.assertion)),
            ("authority_kind", s(c.authority.kind().as_str())),
            (
                "authority",
                match &c.authority {
                    Authority::Method {
                        requirement_id,
                        criterion_ordinal,
                    } => obj(vec![
                        ("requirement_id", s(requirement_id)),
                        ("criterion_ordinal", int(u64::from(*criterion_ordinal))),
                    ]),
                    Authority::Original(source) => obj(source_doc(source)),
                },
            ),
            (
                "authority_verified",
                JsonValue::Bool(self.authority.verified),
            ),
            (
                "authority_reason",
                opt(self.authority.reason.map(AuthorityReason::as_str)),
            ),
            (
                "authority_binding_id",
                opt(self.authority.binding_id.as_deref()),
            ),
            (
                "authority_text_sha256",
                opt(self.authority.text_sha256.as_deref()),
            ),
            (
                "authority_original_sha256",
                opt(self.authority.original_sha256.as_deref()),
            ),
            ("effective_from", date_doc(c.effective_from)),
            ("effective_to", date_doc(c.effective_to)),
            ("applicability", predicate_doc(c.applicability.as_ref())),
            (
                "required_facts",
                JsonValue::Array(
                    c.required_facts
                        .iter()
                        .map(|r| {
                            obj(vec![
                                ("name", s(&r.name)),
                                ("type", s(r.kind.as_str())),
                                ("measure", measure_doc(r.measure.as_ref())),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("method", s(c.method.kind().as_str())),
            (
                "rule",
                match &c.method {
                    CriterionMethod::Rule(p) => predicate_doc(Some(p)),
                    CriterionMethod::Judgment { .. } => JsonValue::Null,
                },
            ),
            (
                "rubric",
                match &c.method {
                    CriterionMethod::Judgment { rubric } => s(rubric),
                    CriterionMethod::Rule(_) => JsonValue::Null,
                },
            ),
            ("missing", s(c.missing.as_str())),
        ]);
        obj(fields)
    }
    pub fn from_document(document: &JsonValue, recorded_us: Option<i64>) -> Option<Self> {
        let map = as_obj(document)?;
        let e = envelope_from(map, "criterion")?;
        let authority_map = as_obj(map.get("authority")?)?;
        let authority = match get_str(map, "authority_kind")? {
            "method" => Authority::Method {
                requirement_id: get_str(authority_map, "requirement_id")?.into(),
                criterion_ordinal: u32::try_from(get_int(authority_map, "criterion_ordinal")?)
                    .ok()?,
            },
            "original" => Authority::Original(source_from(authority_map)?),
            _ => return None,
        };
        let required_facts = get_array(map, "required_facts")?
            .iter()
            .map(|item| {
                let item = as_obj(item)?;
                Some(RequiredFact {
                    name: get_str(item, "name")?.into(),
                    kind: FactType::parse(get_str(item, "type")?)?,
                    measure: measure_from(item.get("measure")?)?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let method = match CriterionKind::parse(get_str(map, "method")?)? {
            CriterionKind::Rule => CriterionMethod::Rule(predicate_from(map.get("rule")?)??),
            CriterionKind::Judgment => CriterionMethod::Judgment {
                rubric: get_str(map, "rubric")?.into(),
            },
        };
        let record = Self {
            id: e.id,
            task_id: e.task_id,
            cycle_id: e.cycle_id,
            invocation_id: e.invocation_id,
            ordinal: e.ordinal,
            methodology_binding_id: e.binding,
            execution_epoch: e.epoch,
            criterion: ProposedCriterion {
                key: get_str(map, "key")?.into(),
                supersedes: get_opt(map, "supersedes")?,
                assertion: get_str(map, "assertion")?.into(),
                authority,
                effective_from: date_from(map, "effective_from")?,
                effective_to: date_from(map, "effective_to")?,
                applicability: predicate_from(map.get("applicability")?)?,
                required_facts,
                method,
                missing: zobba_domain::assessment::MissingTreatment::parse(get_str(
                    map, "missing",
                )?)?,
            },
            authority: AuthorityCheck {
                verified: get_bool(map, "authority_verified")?,
                reason: match get_opt(map, "authority_reason")? {
                    Some(reason) => Some(AuthorityReason::parse(&reason)?),
                    None => None,
                },
                binding_id: get_opt(map, "authority_binding_id")?,
                text_sha256: get_opt(map, "authority_text_sha256")?,
                original_sha256: get_opt(map, "authority_original_sha256")?,
            },
            digest: document_digest(document),
            recorded_us,
        };
        (record.criterion.is_valid() && record.document() == *document).then_some(record)
    }
}

impl BasisRecord {
    pub fn document(&self) -> JsonValue {
        let b = &self.basis;
        let mut fields = envelope_doc!("basis", self);
        fields.extend([
            ("key", s(&b.key)),
            ("supersedes", opt(b.supersedes.as_deref())),
            ("objective", s(&b.objective)),
            ("criteria", list(&b.criteria)),
            ("period_from", s(&b.period_from.render())),
            ("period_to", s(&b.period_to.render())),
            ("as_of", b.as_of.map_or(JsonValue::Null, |i| s(&i.render()))),
            (
                "population",
                JsonValue::Array(
                    b.population
                        .iter()
                        .zip(&self.population_sha256)
                        .map(|(p, digest)| {
                            obj(vec![
                                ("original_id", s(&p.original_id)),
                                ("unit", s(&p.unit)),
                                ("selection", s(&p.selection)),
                                ("sha256", opt(digest.as_deref())),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("limitations", list(&b.limitations)),
        ]);
        obj(fields)
    }
    pub fn from_document(document: &JsonValue, recorded_us: Option<i64>) -> Option<Self> {
        let map = as_obj(document)?;
        let e = envelope_from(map, "basis")?;
        let mut population = Vec::new();
        let mut population_sha256 = Vec::new();
        for item in get_array(map, "population")? {
            let item = as_obj(item)?;
            population.push(PopulationReference {
                original_id: get_str(item, "original_id")?.into(),
                unit: get_str(item, "unit")?.into(),
                selection: get_str(item, "selection")?.into(),
            });
            population_sha256.push(get_opt(item, "sha256")?);
        }
        let record = Self {
            id: e.id,
            task_id: e.task_id,
            cycle_id: e.cycle_id,
            invocation_id: e.invocation_id,
            ordinal: e.ordinal,
            methodology_binding_id: e.binding,
            execution_epoch: e.epoch,
            basis: ProposedBasis {
                key: get_str(map, "key")?.into(),
                supersedes: get_opt(map, "supersedes")?,
                objective: get_str(map, "objective")?.into(),
                criteria: get_list(map, "criteria")?,
                period_from: CivilDate::parse_iso(get_str(map, "period_from")?)?,
                period_to: CivilDate::parse_iso(get_str(map, "period_to")?)?,
                as_of: match get_opt(map, "as_of")? {
                    Some(text) => Some(Instant::parse_rfc3339(&text)?),
                    None => None,
                },
                population,
                limitations: get_list(map, "limitations")?,
            },
            population_sha256,
            digest: document_digest(document),
            recorded_us,
        };
        (record.basis.is_valid() && record.document() == *document).then_some(record)
    }
}

impl FactRecord {
    pub fn document(&self) -> JsonValue {
        let f = &self.fact;
        let mut fields = envelope_doc!("fact", self);
        fields.extend([
            ("basis_id", s(&self.basis_id)),
            ("subject", s(&f.subject)),
            ("subject_unit", s(&f.subject_unit)),
            ("name", s(&f.name)),
            ("value", value_doc(&f.state)),
            ("rule", opt(f.rule.map(ParseRule::as_str))),
            ("sources", verified_doc(&self.sources)),
            ("support", s(self.support.as_str())),
            (
                "support_reason",
                opt(self.support.reason().map(UnsupportedReason::as_str)),
            ),
            ("subject_grounded", JsonValue::Bool(self.grounding.subject)),
            (
                "measure_grounded",
                self.grounding
                    .measure
                    .map_or(JsonValue::Null, JsonValue::Bool),
            ),
            ("job_id", opt(f.job_id.as_deref())),
            ("job_state", opt(self.job_state.and_then(JobState::label))),
            ("effective", date_doc(f.effective)),
        ]);
        obj(fields)
    }
    pub fn from_document(document: &JsonValue, recorded_us: Option<i64>) -> Option<Self> {
        let map = as_obj(document)?;
        let e = envelope_from(map, "fact")?;
        let sources = verified_from(get_array(map, "sources")?)?;
        let basis_id: String = get_str(map, "basis_id")?.into();
        let record = Self {
            id: e.id,
            task_id: e.task_id,
            cycle_id: e.cycle_id,
            invocation_id: e.invocation_id,
            ordinal: e.ordinal,
            methodology_binding_id: e.binding,
            execution_epoch: e.epoch,
            fact: ProposedFact {
                basis: basis_id.clone(),
                subject: get_str(map, "subject")?.into(),
                subject_unit: get_str(map, "subject_unit")?.into(),
                name: get_str(map, "name")?.into(),
                state: value_from(map.get("value")?)?,
                rule: match get_opt(map, "rule")? {
                    Some(rule) => Some(ParseRule::parse(&rule)?),
                    None => None,
                },
                sources: sources.iter().map(|v| v.source.clone()).collect(),
                job_id: get_opt(map, "job_id")?,
                effective: date_from(map, "effective")?,
            },
            basis_id,
            sources,
            support: FactSupport::parse(
                get_str(map, "support")?,
                get_opt(map, "support_reason")?.as_deref(),
            )?,
            grounding: Grounding {
                subject: get_bool(map, "subject_grounded")?,
                measure: match map.get("measure_grounded")? {
                    JsonValue::Null => None,
                    JsonValue::Bool(b) => Some(*b),
                    _ => return None,
                },
            },
            job_state: match get_opt(map, "job_state")?.as_deref() {
                None => None,
                Some("completed") => Some(JobState::Completed),
                Some("failed") => Some(JobState::Failed),
                Some(_) => return None,
            },
            digest: document_digest(document),
            recorded_us,
        };
        // A decimal value states whether its measure was grounded; no other
        // value does.
        let decimal = matches!(
            record.fact.state,
            FactState::Value(FactValue::Decimal { .. })
        );
        (decimal == record.grounding.measure.is_some() && record.document() == *document)
            .then_some(record)
    }
    /// The fact as the evaluator reads it.
    pub fn input(&self) -> InputFact {
        InputFact {
            id: self.id.clone(),
            digest: self.digest.clone(),
            name: self.fact.name.clone(),
            state: self.fact.state.clone(),
            support: self.support,
            subject_grounded: self.grounding.subject,
            measure_grounded: self.grounding.measure,
            effective: self.fact.effective,
        }
    }
}

impl EvaluationRecord {
    pub fn document(&self) -> JsonValue {
        let o = &self.outcome;
        let mut fields = envelope_doc!("evaluation", self);
        fields.extend([
            ("basis_id", s(&self.basis_id)),
            ("criterion_id", s(&self.criterion_id)),
            ("subject", s(&self.subject)),
            ("applicability", s(o.applicability.as_str())),
            ("execution", s(o.execution.as_str())),
            ("verdict", opt(o.verdict.map(Verdict::as_str))),
            ("reason", opt(o.reason.map(EvaluationReason::as_str))),
            ("origin", s(o.origin.as_str())),
            (
                "inputs",
                JsonValue::Array(
                    o.inputs
                        .iter()
                        .map(|(id, digest)| obj(vec![("id", s(id)), ("digest", s(digest))]))
                        .collect(),
                ),
            ),
            (
                "judgment",
                self.judgment.as_ref().map_or(JsonValue::Null, |j| {
                    obj(vec![
                        ("rubric_criterion_id", s(&j.rubric_criterion_id)),
                        ("supporting", list(&j.supporting)),
                        ("contrary", list(&j.contrary)),
                        ("rationale", s(&j.rationale)),
                        ("uncertainty", s(&j.uncertainty)),
                    ])
                }),
            ),
            ("output_digest", s(&self.output_digest)),
        ]);
        obj(fields)
    }
    pub fn from_document(document: &JsonValue, recorded_us: Option<i64>) -> Option<Self> {
        let map = as_obj(document)?;
        let e = envelope_from(map, "evaluation")?;
        let inputs = get_array(map, "inputs")?
            .iter()
            .map(|item| {
                let item = as_obj(item)?;
                Some((get_str(item, "id")?.into(), get_str(item, "digest")?.into()))
            })
            .collect::<Option<Vec<_>>>()?;
        let judgment = match map.get("judgment")? {
            JsonValue::Null => None,
            value => {
                let j = as_obj(value)?;
                Some(JudgmentDetail {
                    rubric_criterion_id: get_str(j, "rubric_criterion_id")?.into(),
                    supporting: get_list(j, "supporting")?,
                    contrary: get_list(j, "contrary")?,
                    rationale: get_str(j, "rationale")?.into(),
                    uncertainty: get_str(j, "uncertainty")?.into(),
                })
            }
        };
        let record = Self {
            id: e.id,
            task_id: e.task_id,
            cycle_id: e.cycle_id,
            invocation_id: e.invocation_id,
            ordinal: e.ordinal,
            methodology_binding_id: e.binding,
            execution_epoch: e.epoch,
            basis_id: get_str(map, "basis_id")?.into(),
            criterion_id: get_str(map, "criterion_id")?.into(),
            subject: get_str(map, "subject")?.into(),
            outcome: Outcome {
                applicability: Applicability::parse(get_str(map, "applicability")?)?,
                execution: Execution::parse(get_str(map, "execution")?)?,
                verdict: match get_opt(map, "verdict")? {
                    Some(v) => Some(Verdict::parse(&v)?),
                    None => None,
                },
                reason: match get_opt(map, "reason")? {
                    Some(r) => Some(EvaluationReason::parse(&r)?),
                    None => None,
                },
                origin: Origin::parse(get_str(map, "origin")?)?,
                inputs,
            },
            judgment,
            output_digest: get_str(map, "output_digest")?.into(),
            recorded_us,
        };
        (record.outcome.is_valid()
            && record.output_digest == record.computed_digest()
            && record.document() == *document)
            .then_some(record)
    }
    /// The output digest recomputed from the record's own fields.
    pub fn computed_digest(&self) -> String {
        output_digest(
            &self.basis_id,
            &self.criterion_id,
            &self.subject,
            &self.outcome,
            self.judgment.as_ref().map(|j| {
                (
                    j.supporting.as_slice(),
                    j.contrary.as_slice(),
                    j.rationale.as_str(),
                    j.uncertainty.as_str(),
                )
            }),
        )
    }
}

// ----------------------------------------------------------- the service

/// One verified source and the text trusted code read at its location.
type Located = (VerifiedSource, Vec<String>);

/// Verify sources with the 22.5 verifier: one cited segment per source,
/// chunked within the answer bounds. Each source's result is in input order,
/// with the text read at its location.
pub(crate) async fn verify_sources<C: CitationReader>(
    reader: &C,
    basis: &ClaimBasis,
    sources: &[CitationSource],
    cancellation: &ModelCancellation,
) -> Result<Vec<Located>, ReadingError> {
    let mut out = Vec::with_capacity(sources.len());
    for chunk in sources.chunks(zobba_domain::citation::MAX_SEGMENTS) {
        let answer = CitedAnswer {
            segments: chunk
                .iter()
                .map(|source| Segment {
                    text: "Cited source.".into(),
                    sources: vec![source.clone()],
                })
                .collect(),
            ..CitedAnswer::default()
        };
        let stored = verify_located(reader, basis, &answer, cancellation).await?;
        if stored.len() != chunk.len()
            || stored
                .iter()
                .any(|(c, texts)| c.sources.len() != 1 || texts.len() != 1)
        {
            return Err(ReadingError::Invalid);
        }
        out.extend(
            stored
                .into_iter()
                .map(|(mut c, mut texts)| (c.sources.remove(0), texts.remove(0))),
        );
    }
    Ok(out)
}

/// What one source of a stated value is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Role {
    /// Its quote re-parses to the stated value; `whole` when the quote is
    /// the whole value at its location.
    Value { whole: bool },
    /// Its quote is exactly the subject or the measure (a row's invoice
    /// number cell, a currency column).
    Grounding,
    /// A wider byte range of the same original that contains a value
    /// source's range (the line the value stands in).
    Context,
    /// None of these: the source does not show this value.
    Mismatch,
}

fn measure_token(measure: &Measure) -> String {
    match measure {
        Measure::Currency(code) => code.clone(),
        Measure::Unit(unit) => unit.clone(),
    }
}
fn same_token(a: &str, b: &str, fold: bool) -> bool {
    let (a, b) = (normalize(a), normalize(b));
    if fold {
        a.to_lowercase() == b.to_lowercase()
    } else {
        a == b
    }
}
/// A grounding source stands beside a value source: the same original and,
/// for spreadsheet cells, the same sheet and an overlapping row; for any
/// other locator, the same location.
fn beside(grounding: &CitationSource, value: &CitationSource) -> bool {
    if grounding.original_id != value.original_id {
        return false;
    }
    match (&grounding.locator, &value.locator) {
        (
            Some(Locator::Cell {
                sheet: a,
                range: ra,
            }),
            Some(Locator::Cell {
                sheet: b,
                range: rb,
            }),
        ) => a == b && ra.first_row <= rb.last_row && rb.first_row <= ra.last_row,
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}
/// A byte range of the same original that contains the value's range.
fn contains(context: &CitationSource, value: &CitationSource) -> bool {
    match (&context.locator, &value.locator) {
        (Some(Locator::Bytes { start: a, end: b }), Some(Locator::Bytes { start: c, end: d })) => {
            context.original_id == value.original_id && a <= c && d <= b && (a, b) != (c, d)
        }
        _ => false,
    }
}

/// Trusted code's judgment of a stated value: its support, its grounding
/// and the value derived from the verified quotes.
///
/// Every source must be verified at its location. Each source either
/// re-parses to the stated value (a value source), quotes exactly the
/// subject or the measure (a grounding source), or is a wider byte range
/// containing a value source (a context source); anything else is a type
/// mismatch, and at least one value source is needed. A value source's
/// quote must be the whole value at its location (`2,500.00` inside
/// `12,500.00` is only a part). The subject and the measure are grounded
/// when they stand as whole tokens in a value source's located text or a
/// context source's quote, or as the quote of a grounding source beside a
/// value source (the same row of a sheet, or the same location).
pub fn assess_value(
    subject: &str,
    value: &FactValue,
    rule: ParseRule,
    sources: &[(VerifiedSource, Vec<String>)],
) -> (FactSupport, Grounding, Option<FactValue>) {
    let measure = value.measure().map(measure_token);
    let fold = matches!(value.measure(), Some(Measure::Unit(_)));
    let derived: Vec<Option<FactValue>> = sources
        .iter()
        .map(|(v, _)| {
            rule.apply(&v.source.quote, value.measure())
                .filter(|d| value.agrees(d))
        })
        .collect();
    let values: Vec<usize> = (0..sources.len())
        .filter(|&i| derived[i].is_some())
        .collect();
    let roles: Vec<Role> = (0..sources.len())
        .map(|i| {
            let (v, texts) = &sources[i];
            let quote = &v.source.quote;
            if derived[i].is_some() {
                Role::Value {
                    whole: v
                        .source
                        .locator
                        .as_ref()
                        .is_some_and(|l| whole_value(l, texts, quote)),
                }
            } else if same_token(quote, subject, false)
                || measure
                    .as_deref()
                    .is_some_and(|m| same_token(quote, m, fold))
            {
                Role::Grounding
            } else if values
                .iter()
                .any(|&j| contains(&v.source, &sources[j].0.source))
            {
                Role::Context
            } else {
                Role::Mismatch
            }
        })
        .collect();
    let verified = |i: usize| sources[i].0.verification == Verification::Verified;
    let grounded = |token: &str, fold: bool| {
        let whole = |text: &str| {
            if fold {
                whole_token(&text.to_lowercase(), &token.to_lowercase())
            } else {
                whole_token(text, token)
            }
        };
        (0..sources.len()).any(|i| {
            verified(i)
                && match roles[i] {
                    Role::Value { .. } => sources[i].1.iter().any(|t| whole(t)),
                    Role::Context => whole(&sources[i].0.source.quote),
                    Role::Grounding => {
                        same_token(&sources[i].0.source.quote, token, fold)
                            && values.iter().any(|&j| {
                                verified(j) && beside(&sources[i].0.source, &sources[j].0.source)
                            })
                    }
                    Role::Mismatch => false,
                }
        })
    };
    let grounding = Grounding {
        subject: grounded(subject, false),
        measure: measure.as_deref().map(|m| grounded(m, fold)),
    };
    let support = if (0..sources.len()).any(|i| !verified(i)) {
        FactSupport::Unsupported(UnsupportedReason::SourceUnverified)
    } else if roles.contains(&Role::Mismatch) || values.is_empty() {
        FactSupport::Unsupported(UnsupportedReason::TypeMismatch)
    } else if roles.contains(&Role::Value { whole: false }) {
        FactSupport::Unsupported(UnsupportedReason::PartialValue)
    } else {
        FactSupport::Supported
    };
    let derived = (support == FactSupport::Supported)
        .then(|| values.first().and_then(|&i| derived[i].clone()))
        .flatten();
    (support, grounding, derived)
}

fn authority_reason(reason: UnverifiedReason) -> AuthorityReason {
    match reason {
        UnverifiedReason::NotFoundAtLocation => AuthorityReason::NotFoundAtLocation,
        UnverifiedReason::LocationMissing => AuthorityReason::LocationMissing,
        UnverifiedReason::SourceUnreadable => AuthorityReason::SourceUnreadable,
        UnverifiedReason::PageOnly => AuthorityReason::PageOnly,
    }
}

/// The exact text of one criterion of the current binding.
pub fn method_criterion(binding: &Binding, requirement_id: &str, ordinal: u32) -> Option<String> {
    let requirement = binding
        .resolution
        .requirements
        .iter()
        .map(|r| &r.requirement)
        .find(|r| r.id == requirement_id)?;
    if criteria_missing(requirement) {
        return None;
    }
    requirement
        .criteria
        .as_ref()?
        .get(ordinal as usize)
        .filter(|text| !text.trim().is_empty())
        .cloned()
}

/// Names a criterion reads, for subject selection.
fn consulted(criterion: &ProposedCriterion) -> BTreeSet<String> {
    let mut names: BTreeSet<String> = criterion
        .required_facts
        .iter()
        .map(|r| r.name.clone())
        .collect();
    if let Some(p) = &criterion.applicability {
        names.extend(p.facts().into_iter().map(String::from));
    }
    if let CriterionMethod::Rule(p) = &criterion.method {
        names.extend(p.facts().into_iter().map(String::from));
    }
    names
}

fn context_for<'f>(
    basis: &BasisRecord,
    criterion: &CriterionRecord,
    facts: &'f [InputFact],
) -> EvaluationContext<'f> {
    EvaluationContext {
        period_from: basis.basis.period_from,
        period_to: basis.basis.period_to,
        authority_verified: criterion.authority.verified,
        facts,
    }
}

impl<S: AssessmentStore + coverage::CoverageStore + revision::RevisionStore, C: CitationReader>
    Assessment<'_, S, C>
{
    /// Check, record and evaluate one answered turn's assessment proposals.
    /// Idempotent per invocation: a record of this invocation is never
    /// written twice, and every check is an exact query. True when a new
    /// record was written (a further turn is useful).
    pub async fn after_answer(
        &self,
        basis: &ClaimBasis,
        binding: &Binding,
        invocation: &Invocation,
        answer: &CitedAnswer,
        cancellation: &ModelCancellation,
    ) -> Result<bool, ReadingError> {
        let (turn_binding, turn_epoch) = turn_basis(invocation);
        let existing = self.store.invocation_records(basis, &invocation.id).await?;
        let existing_coverage = self
            .store
            .invocation_coverage(basis, &invocation.id)
            .await?;
        let existing_revisions = self
            .store
            .invocation_revisions(basis, &invocation.id)
            .await?;
        let mut answer_coverage = coverage::AnswerCoverage::default();
        let mut feedback: Vec<String> = Vec::new();
        let mut progress = false;
        if answer.discarded > 0 {
            feedback.push(format!(
                "{} invalid, repeated or over-bound entries of your last answer were left out.",
                answer.discarded
            ));
        }

        // 1. Criterion versions. Keys map to the IDs recorded in this answer.
        let mut keys: BTreeMap<String, CriterionRecord> = BTreeMap::new();
        for (ordinal, proposed) in answer.propose_criteria.iter().enumerate() {
            let ordinal = ordinal as u32;
            if let Some(found) = existing.criteria.iter().find(|c| c.ordinal == ordinal) {
                keys.insert(proposed.key.clone(), found.clone());
                feedback.push(criterion_line(found));
                continue;
            }
            if let Some(previous) = &proposed.supersedes
                && self
                    .store
                    .criteria(basis, std::slice::from_ref(previous))
                    .await?
                    .is_empty()
            {
                feedback.push(format!(
                    "Criterion {} was not recorded: it supersedes {previous}, which is not a criterion of this Task.",
                    proposed.key
                ));
                continue;
            }
            let authority = match &proposed.authority {
                Authority::Method {
                    requirement_id,
                    criterion_ordinal,
                } => {
                    if turn_binding != binding.id {
                        AuthorityCheck {
                            verified: false,
                            reason: Some(AuthorityReason::MethodChanged),
                            binding_id: Some(turn_binding.clone()),
                            text_sha256: None,
                            original_sha256: None,
                        }
                    } else {
                        match method_criterion(binding, requirement_id, *criterion_ordinal) {
                            Some(text) => AuthorityCheck {
                                verified: true,
                                reason: None,
                                binding_id: Some(binding.id.clone()),
                                text_sha256: Some(sha256_hex(text.as_bytes())),
                                original_sha256: None,
                            },
                            None => AuthorityCheck {
                                verified: false,
                                reason: Some(AuthorityReason::CriterionNotFound),
                                binding_id: Some(binding.id.clone()),
                                text_sha256: None,
                                original_sha256: None,
                            },
                        }
                    }
                }
                Authority::Original(source) => {
                    let verified = verify_sources(
                        self.reader,
                        basis,
                        std::slice::from_ref(source),
                        cancellation,
                    )
                    .await?
                    .remove(0)
                    .0;
                    AuthorityCheck {
                        verified: verified.verification == Verification::Verified,
                        reason: verified.verification.reason().map(authority_reason),
                        binding_id: None,
                        text_sha256: None,
                        original_sha256: verified.original_sha256,
                    }
                }
            };
            let mut record = CriterionRecord {
                id: record_id("crit", &basis.task_id, &invocation.id, ordinal),
                task_id: basis.task_id.clone(),
                cycle_id: basis.cycle_id.clone(),
                invocation_id: invocation.id.clone(),
                ordinal,
                methodology_binding_id: turn_binding.clone(),
                execution_epoch: turn_epoch,
                criterion: proposed.clone(),
                authority,
                digest: String::new(),
                recorded_us: None,
            };
            record.digest = document_digest(&record.document());
            let stored = self.store.record_criterion(basis, &record).await?;
            progress = true;
            feedback.push(criterion_line(&stored));
            keys.insert(proposed.key.clone(), stored);
        }

        // 2. The assessment basis version.
        let mut answer_basis: Option<BasisRecord> = None;
        if let Some(proposed) = answer.propose_basis.first() {
            if let Some(found) = existing.bases.first() {
                feedback.push(basis_line(found));
                answer_basis = Some(found.clone());
            } else {
                let mut criteria = Vec::new();
                let mut unknown = Vec::new();
                for reference in &proposed.criteria {
                    match self.resolve_criterion(basis, &keys, reference).await? {
                        Some(found) => criteria.push(found.id),
                        None => unknown.push(reference.clone()),
                    }
                }
                let supersedes_ok = match &proposed.supersedes {
                    Some(previous) => self.store.basis_record(basis, previous).await?.is_some(),
                    None => true,
                };
                let distinct: BTreeSet<&String> = criteria.iter().collect();
                if !unknown.is_empty() {
                    feedback.push(format!(
                        "Basis {} was not recorded: {} {} not criteria of this Task.",
                        proposed.key,
                        unknown.join(", "),
                        if unknown.len() == 1 { "is" } else { "are" }
                    ));
                } else if !supersedes_ok {
                    feedback.push(format!(
                        "Basis {} was not recorded: it supersedes a basis that is not one of this Task.",
                        proposed.key
                    ));
                } else if distinct.len() != criteria.len() {
                    feedback.push(format!(
                        "Basis {} was not recorded: it lists one criterion twice.",
                        proposed.key
                    ));
                } else {
                    let mut population_sha256 = Vec::new();
                    for reference in &proposed.population {
                        population_sha256.push(
                            self.reader
                                .original(basis, &reference.original_id)
                                .await?
                                .map(|o| o.sha256),
                        );
                    }
                    let mut record = BasisRecord {
                        id: record_id("basis", &basis.task_id, &invocation.id, 0),
                        task_id: basis.task_id.clone(),
                        cycle_id: basis.cycle_id.clone(),
                        invocation_id: invocation.id.clone(),
                        ordinal: 0,
                        methodology_binding_id: turn_binding.clone(),
                        execution_epoch: turn_epoch,
                        basis: ProposedBasis {
                            criteria,
                            ..proposed.clone()
                        },
                        population_sha256,
                        digest: String::new(),
                        recorded_us: None,
                    };
                    record.digest = document_digest(&record.document());
                    let stored = self.store.record_basis(basis, &record).await?;
                    progress = true;
                    feedback.push(basis_line(&stored));
                    answer_basis = Some(stored);
                }
            }
        }
        let resolve_basis = |reference: &str| -> Option<String> {
            answer_basis
                .as_ref()
                .filter(|b| b.basis.key == reference || b.id == reference)
                .map(|b| b.id.clone())
        };

        // 2b. Story 24.3a: a successor basis carries its predecessor's
        // effective facts by reference, except the listed ones.
        progress |= self
            .carry_step(
                basis,
                invocation,
                answer,
                &answer_basis,
                &existing_revisions,
                &mut feedback,
            )
            .await?;

        // 3. Fact observations: sources verified, values re-parsed. Facts of
        // a basis are read once (an exact read) and the per-basis bound is
        // enforced before anything is written.
        let mut basis_facts: BTreeMap<String, Vec<FactRecord>> = BTreeMap::new();
        // (basis, subject) pairs whose facts of this answer are still to come:
        // they are not evaluated or judged in this answer.
        let mut deferred: BTreeSet<(String, String)> = BTreeSet::new();
        // (record, the fact names a job that is not one of this Task's)
        let mut pending: Vec<(FactRecord, bool)> = Vec::new();
        let mut seen: BTreeSet<(String, String, String)> = BTreeSet::new();
        let mut carried: BTreeMap<String, usize> = BTreeMap::new();
        for (ordinal, proposed) in answer.record_facts.iter().enumerate() {
            let ordinal = ordinal as u32;
            if let Some(found) = existing.facts.iter().find(|f| f.ordinal == ordinal) {
                feedback.push(fact_line(found));
                continue;
            }
            let basis_id = match resolve_basis(&proposed.basis) {
                Some(id) => Some(id),
                None => self
                    .store
                    .basis_record(basis, &proposed.basis)
                    .await?
                    .map(|b| b.id),
            };
            let Some(basis_id) = basis_id else {
                feedback.push(format!(
                    "Fact {} of {} was not recorded: {} is not an assessment basis of this Task.",
                    proposed.name, proposed.subject, proposed.basis
                ));
                continue;
            };
            if !basis_facts.contains_key(&basis_id) {
                let facts = self.store.facts(basis, &basis_id).await?;
                basis_facts.insert(basis_id.clone(), facts);
            }
            // The 1,024-fact bound counts the facts carried into the basis.
            if !carried.contains_key(&basis_id) {
                let count = self
                    .store
                    .carry(basis, &basis_id)
                    .await?
                    .map_or(0, |c| c.fact_ids.len());
                carried.insert(basis_id.clone(), count);
            }
            let recorded = &basis_facts[&basis_id];
            let key = (
                basis_id.clone(),
                proposed.subject.clone(),
                proposed.name.clone(),
            );
            let recorded_before = recorded
                .iter()
                .any(|f| f.fact.subject == proposed.subject && f.fact.name == proposed.name);
            if seen.contains(&key) || recorded_before {
                feedback.push(format!(
                    "Fact {} of {} was not recorded: that basis already holds it. Facts are pinned to a basis version: to correct one, propose a successor basis (supersedes) with carry_facts excepting this subject and name, and record the corrected fact there.",
                    proposed.name, proposed.subject
                ));
                continue;
            }
            let queued = pending
                .iter()
                .filter(|(f, _)| f.basis_id == basis_id)
                .count();
            if recorded.len() + carried[&basis_id] + queued >= MAX_BASIS_FACTS {
                feedback.push(format!(
                    "Fact {} of {} was not recorded: basis {basis_id} already holds {MAX_BASIS_FACTS} facts, the most one basis version may hold. Propose a new basis version for further facts.",
                    proposed.name, proposed.subject
                ));
                continue;
            }
            let (job_state, unknown_job) = match &proposed.job_id {
                Some(job) => match self.store.job_state(basis, job).await? {
                    Some(state) => (Some(state), false),
                    None => (None, true),
                },
                None => (None, false),
            };
            if job_state == Some(JobState::Pending) {
                // Nothing permanent is said about an analysis that may still
                // complete: the fact is not recorded, and the agent records
                // it again once the job has ended.
                feedback.push(format!(
                    "Fact {} of {} was not recorded: analysis job {} has not ended. Record the fact again after the job completes.",
                    proposed.name,
                    proposed.subject,
                    proposed.job_id.as_deref().unwrap_or_default()
                ));
                deferred.insert((basis_id, proposed.subject.clone()));
                continue;
            }
            seen.insert(key);
            pending.push((
                FactRecord {
                    id: record_id("fact", &basis.task_id, &invocation.id, ordinal),
                    task_id: basis.task_id.clone(),
                    cycle_id: basis.cycle_id.clone(),
                    invocation_id: invocation.id.clone(),
                    ordinal,
                    methodology_binding_id: turn_binding.clone(),
                    execution_epoch: turn_epoch,
                    basis_id: basis_id.clone(),
                    // A job that is not one of this Task's is not kept as
                    // a reference: the material is recorded unverified.
                    fact: ProposedFact {
                        basis: basis_id,
                        job_id: proposed.job_id.clone().filter(|_| !unknown_job),
                        ..proposed.clone()
                    },
                    sources: vec![],
                    support: FactSupport::NoValue,
                    grounding: Grounding::default(),
                    job_state,
                    digest: String::new(),
                    recorded_us: None,
                },
                unknown_job,
            ));
        }
        let all_sources: Vec<CitationSource> = pending
            .iter()
            .flat_map(|(f, _)| f.fact.sources.iter().cloned())
            .collect();
        // Every source is verified before any fact is written: a read that
        // fails ends the answer with nothing recorded, and a reclaim repeats it.
        let verified = if all_sources.is_empty() {
            vec![]
        } else {
            verify_sources(self.reader, basis, &all_sources, cancellation).await?
        };
        let mut at = 0usize;
        for (mut record, unknown_job) in pending {
            let count = record.fact.sources.len();
            let located = &verified[at..at + count];
            at += count;
            record.sources = located.iter().map(|(v, _)| v.clone()).collect();
            let assessed = match (&record.fact.state, record.fact.rule) {
                (FactState::Value(value), Some(rule)) => {
                    Some(assess_value(&record.fact.subject, value, rule, located))
                }
                _ => None,
            };
            if let Some((_, grounding, _)) = &assessed {
                record.grounding = *grounding;
            }
            // A failed job is an analysis failure; a job that is not one of
            // this Task's leaves the material unverified, never "failed".
            record.support = if record.job_state == Some(JobState::Failed) {
                FactSupport::Unsupported(UnsupportedReason::AnalysisFailed)
            } else if unknown_job {
                FactSupport::Unsupported(UnsupportedReason::SourceUnverified)
            } else {
                match assessed {
                    Some((support, _, derived)) => {
                        // The recorded value is the one derived from the
                        // verified quote.
                        if let Some(derived) = derived {
                            record.fact.state = FactState::Value(derived);
                        }
                        support
                    }
                    None => FactSupport::NoValue,
                }
            };
            record.digest = document_digest(&record.document());
            match self.store.record_fact(basis, &record).await {
                Ok(stored) => {
                    progress = true;
                    feedback.push(fact_line(&stored));
                    basis_facts
                        .entry(stored.basis_id.clone())
                        .or_default()
                        .push(stored);
                }
                // The database refused it, for example because the job it
                // names changed state since it was read. Nothing is recorded;
                // the agent may record it again.
                Err(ReadingError::Invalid) => {
                    feedback.push(format!(
                        "Fact {} of {} was not recorded: the platform refused it as proposed (its analysis job may have changed state). Record it again.",
                        record.fact.name, record.fact.subject
                    ));
                    deferred.insert((record.basis_id.clone(), record.fact.subject.clone()));
                }
                Err(error) => return Err(error),
            }
        }

        // 3b. Story 24.2: the population manifest (every row read by trusted
        // code) and the sample manifest (checked against the in-scope
        // subjects).
        progress |= self
            .coverage_population(
                basis,
                invocation,
                answer,
                &answer_basis,
                &existing_coverage,
                &mut answer_coverage,
                &mut feedback,
                cancellation,
            )
            .await?;
        progress |= self
            .coverage_sample(
                basis,
                invocation,
                answer,
                &existing_coverage,
                &mut answer_coverage,
                &mut feedback,
            )
            .await?;

        // 4. Deterministic evaluation, on request only.
        let mut ordinal = existing
            .evaluations
            .iter()
            .map(|e| e.ordinal + 1)
            .max()
            .unwrap_or(0);
        let mut written = existing.evaluations.len() + existing_revisions.revisions.len();
        let mut rev_ordinal = existing_revisions
            .revisions
            .iter()
            .map(|r| r.ordinal + 1)
            .max()
            .unwrap_or(0);
        // Effective facts (own and carried) of each basis, read after this
        // answer's facts are written.
        let mut effective: BTreeMap<String, Vec<FactRecord>> = BTreeMap::new();
        let mut bound_reported = false;
        let bound_line = "Further evaluations were not recorded: the per-answer bound was reached. Ask again in a later answer.";
        for reference in &answer.evaluate {
            let Some(criterion) = self.resolve_criterion(basis, &keys, reference).await? else {
                feedback.push(format!(
                    "{reference} was not evaluated: it is not a criterion of this Task."
                ));
                continue;
            };
            if criterion.criterion.method.kind() != CriterionKind::Rule {
                feedback.push(format!(
                    "{} is a judgment criterion: it is never evaluated by a rule. Propose a judgment instead.",
                    criterion.id
                ));
                continue;
            }
            let Some(target) = self.basis_for(basis, &answer_basis, &criterion.id).await? else {
                feedback.push(format!(
                    "{} was not evaluated: no assessment basis of this Task lists it.",
                    criterion.id
                ));
                continue;
            };
            if !effective.contains_key(&target.id) {
                let facts = self.store.effective_facts(basis, &target.id).await?;
                effective.insert(target.id.clone(), facts);
            }
            let facts = effective[&target.id].clone();
            let names = consulted(&criterion.criterion);
            let subjects: BTreeSet<&str> = facts
                .iter()
                .filter(|f| names.contains(&f.fact.name))
                .map(|f| f.fact.subject.as_str())
                .collect();
            if subjects.is_empty() {
                feedback.push(format!(
                    "{} was not evaluated under basis {}: no fact it reads is recorded there.",
                    criterion.id, target.id
                ));
                continue;
            }
            // Story 24.3a: every chain of this lineage with its current head,
            // by an exact query. A subject with no chain is evaluated for the
            // first time; one with a chain is revised only when trusted code
            // derives a cause. Subjects that need nothing are set aside
            // before the per-request bound.
            let heads: BTreeMap<String, ChainHead> = self
                .store
                .heads(basis, &target.id, &criterion.id)
                .await?
                .into_iter()
                .map(|h| (h.subject().to_string(), h))
                .collect();
            let inputs_of = |subject: &str| -> Vec<InputFact> {
                facts
                    .iter()
                    .filter(|f| f.fact.subject == subject)
                    .map(FactRecord::input)
                    .collect()
            };
            let mut todo: Vec<(&str, Outcome, String, Option<Planned>)> = Vec::new();
            for subject in subjects {
                if deferred.contains(&(target.id.clone(), subject.to_string())) {
                    feedback.push(format!(
                        "{} for {subject} under basis {} was not evaluated: some of its facts in your last answer were not recorded yet. Ask again once they are.",
                        criterion.id, target.id
                    ));
                    continue;
                }
                let inputs = inputs_of(subject);
                let outcome = evaluate(
                    &criterion.criterion,
                    &context_for(&target, &criterion, &inputs),
                );
                let digest = output_digest(&target.id, &criterion.id, subject, &outcome, None);
                let Some(head) = heads.get(subject) else {
                    todo.push((subject, outcome, digest, None));
                    continue;
                };
                if head.invocation_id() == invocation.id {
                    feedback.push(head_line(head));
                    continue;
                }
                match self
                    .plan_revision(
                        basis,
                        head,
                        &target,
                        &criterion,
                        &outcome,
                        &digest,
                        &facts,
                        revision::shown_reconsideration(invocation, head.head_id()),
                    )
                    .await?
                {
                    Ok(planned) => todo.push((subject, outcome, digest, Some(planned))),
                    Err(line) => feedback.push(line),
                }
            }
            if todo.len() > MAX_SUBJECTS_PER_CRITERION {
                feedback.push(format!(
                    "{} has {} subjects to evaluate or revise under basis {}; the first {MAX_SUBJECTS_PER_CRITERION} in byte order are recorded now. Ask again to continue.",
                    criterion.id,
                    todo.len(),
                    target.id
                ));
            }
            for (subject, outcome, digest, planned) in
                todo.into_iter().take(MAX_SUBJECTS_PER_CRITERION)
            {
                if written >= MAX_INVOCATION_EVALUATIONS {
                    if !bound_reported {
                        feedback.push(bound_line.into());
                        bound_reported = true;
                    }
                    break;
                }
                written += 1;
                match planned {
                    None => {
                        let record = EvaluationRecord {
                            id: record_id("eval", &basis.task_id, &invocation.id, ordinal),
                            task_id: basis.task_id.clone(),
                            cycle_id: basis.cycle_id.clone(),
                            invocation_id: invocation.id.clone(),
                            ordinal,
                            methodology_binding_id: turn_binding.clone(),
                            execution_epoch: turn_epoch,
                            basis_id: target.id.clone(),
                            criterion_id: criterion.id.clone(),
                            subject: subject.into(),
                            outcome,
                            judgment: None,
                            output_digest: digest,
                            recorded_us: None,
                        };
                        ordinal += 1;
                        match self.store.record_evaluation(basis, &record).await {
                            Ok(stored) => {
                                progress = true;
                                feedback.push(evaluation_line(&stored));
                            }
                            Err(ReadingError::Invalid) => feedback.push(format!(
                                "{} for {subject} under basis {} was not recorded: the platform refused it as proposed.",
                                criterion.id, target.id
                            )),
                            Err(error) => return Err(error),
                        }
                    }
                    Some(planned) => {
                        let record = planned.record(
                            record_id("rev", &basis.task_id, &invocation.id, rev_ordinal),
                            basis,
                            invocation,
                            rev_ordinal,
                            (&turn_binding, turn_epoch),
                            (&target.id, &criterion.id, subject),
                            outcome,
                            None,
                            digest,
                        );
                        rev_ordinal += 1;
                        progress |= self.write_revision(basis, &record, &mut feedback).await?;
                    }
                }
            }
        }

        // 4b. Story 24.2: criteria over every in-scope member of a population.
        progress |= self
            .coverage_evaluate(
                basis,
                invocation,
                answer,
                &keys,
                &mut answer_coverage,
                &mut feedback,
            )
            .await?;

        // 5. Judgments: model proposals in words, never a rule verdict.
        for proposed in &answer.judgments {
            let Some(criterion) = self
                .resolve_criterion(basis, &keys, &proposed.criterion)
                .await?
            else {
                feedback.push(format!(
                    "The judgment of {} was not recorded: it is not a criterion of this Task.",
                    proposed.criterion
                ));
                continue;
            };
            if criterion.criterion.method.kind() != CriterionKind::Judgment {
                feedback.push(format!(
                    "The judgment of {} was not recorded: it is a rule criterion, decided only by trusted code.",
                    criterion.id
                ));
                continue;
            }
            let target = match resolve_basis(&proposed.basis) {
                Some(_) => answer_basis.clone(),
                None => self.store.basis_record(basis, &proposed.basis).await?,
            };
            let Some(target) = target.filter(|b| b.basis.criteria.contains(&criterion.id)) else {
                feedback.push(format!(
                    "The judgment of {} was not recorded: basis {} is not one of this Task that lists it.",
                    criterion.id, proposed.basis
                ));
                continue;
            };
            if deferred.contains(&(target.id.clone(), proposed.subject.clone())) {
                feedback.push(format!(
                    "The judgment of {} for {} was not recorded: some of its facts in your last answer were not recorded yet. Propose it again once they are.",
                    criterion.id, proposed.subject
                ));
                continue;
            }
            if written >= MAX_INVOCATION_EVALUATIONS {
                if !bound_reported {
                    feedback.push(bound_line.into());
                }
                break;
            }
            if !effective.contains_key(&target.id) {
                let facts = self.store.effective_facts(basis, &target.id).await?;
                effective.insert(target.id.clone(), facts);
            }
            let facts = effective[&target.id].clone();
            let inputs: Vec<InputFact> = facts
                .iter()
                .filter(|f| f.fact.subject == proposed.subject)
                .map(FactRecord::input)
                .collect();
            let outcome = judge(
                &criterion.criterion,
                &context_for(&target, &criterion, &inputs),
                proposed,
            );
            let ids = |names: &[String]| -> Vec<String> {
                names
                    .iter()
                    .filter_map(|n| inputs.iter().find(|f| &f.name == n).map(|f| f.id.clone()))
                    .collect()
            };
            let detail = JudgmentDetail {
                rubric_criterion_id: criterion.id.clone(),
                supporting: ids(&proposed.supporting),
                contrary: ids(&proposed.contrary),
                rationale: proposed.rationale.clone(),
                uncertainty: proposed.uncertainty.clone(),
            };
            let digest = output_digest(
                &target.id,
                &criterion.id,
                &proposed.subject,
                &outcome,
                Some((
                    &detail.supporting,
                    &detail.contrary,
                    &detail.rationale,
                    &detail.uncertainty,
                )),
            );
            // Story 24.3a: a chain in this lineage is revised only when
            // trusted code derives a cause (new facts, a new criterion or
            // basis version, or a person's reconsideration request).
            let head = self
                .store
                .heads(basis, &target.id, &criterion.id)
                .await?
                .into_iter()
                .find(|h| h.subject() == proposed.subject);
            if let Some(head) = &head {
                if head.invocation_id() == invocation.id {
                    feedback.push(head_line(head));
                    continue;
                }
                let planned = match self
                    .plan_revision(
                        basis,
                        head,
                        &target,
                        &criterion,
                        &outcome,
                        &digest,
                        &facts,
                        revision::shown_reconsideration(invocation, head.head_id()),
                    )
                    .await?
                {
                    Ok(planned) => planned,
                    Err(_) => {
                        feedback.push(format!(
                            "The judgment of {} for {} was not recorded: {} is already recorded and nothing it reads has changed. A new judgment is recorded only after new facts, a new criterion or basis version, or a person's request to reconsider it.",
                            criterion.id,
                            proposed.subject,
                            head.head_id()
                        ));
                        continue;
                    }
                };
                written += 1;
                let record = planned.record(
                    record_id("rev", &basis.task_id, &invocation.id, rev_ordinal),
                    basis,
                    invocation,
                    rev_ordinal,
                    (&turn_binding, turn_epoch),
                    (&target.id, &criterion.id, &proposed.subject),
                    outcome,
                    Some(detail),
                    digest,
                );
                rev_ordinal += 1;
                progress |= self.write_revision(basis, &record, &mut feedback).await?;
                continue;
            }
            let record = EvaluationRecord {
                id: record_id("eval", &basis.task_id, &invocation.id, ordinal),
                task_id: basis.task_id.clone(),
                cycle_id: basis.cycle_id.clone(),
                invocation_id: invocation.id.clone(),
                ordinal,
                methodology_binding_id: turn_binding.clone(),
                execution_epoch: turn_epoch,
                basis_id: target.id.clone(),
                criterion_id: criterion.id.clone(),
                subject: proposed.subject.clone(),
                outcome,
                judgment: Some(detail),
                output_digest: digest,
                recorded_us: None,
            };
            ordinal += 1;
            written += 1;
            match self.store.record_evaluation(basis, &record).await {
                Ok(stored) => {
                    progress = true;
                    feedback.push(evaluation_line(&stored));
                }
                Err(ReadingError::Invalid) => feedback.push(format!(
                    "The judgment of {} for {} was not recorded: the platform refused it as proposed.",
                    criterion.id, proposed.subject
                )),
                Err(error) => return Err(error),
            }
        }
        // 6. Story 24.2: coverage summaries, computed by the pure summarise.
        progress |= self
            .coverage_summarise(
                basis,
                invocation,
                answer,
                &answer_basis,
                &existing_coverage,
                &mut answer_coverage,
                &mut feedback,
            )
            .await?;
        *self.feedback.lock().expect("feedback lock") = Some((invocation.id.clone(), feedback));
        // A reclaim finds this answer's records already written: the work
        // continues exactly as it did when they were first recorded.
        let recorded_before = !(existing.criteria.is_empty()
            && existing.bases.is_empty()
            && existing.facts.is_empty()
            && existing.evaluations.is_empty()
            && existing_revisions.carries.is_empty()
            && existing_revisions.revisions.is_empty()
            && existing_coverage.populations.is_empty()
            && existing_coverage.samples.is_empty()
            && existing_coverage.summaries.is_empty());
        // Story 24.3a: a person's request to reconsider that this turn's
        // request did not show (it arrived during or after the turn, or the
        // turn is replayed on a reclaim) is due a further turn that shows it.
        let unseen = self
            .store
            .revision_snapshot(basis)
            .await?
            .reconsiderations
            .iter()
            .any(|r| !revision::shown_reconsideration(invocation, &r.head_id));
        Ok(progress || recorded_before || unseen)
    }

    /// A criterion by same-answer key, else by exact ID of this Task.
    async fn resolve_criterion(
        &self,
        basis: &ClaimBasis,
        keys: &BTreeMap<String, CriterionRecord>,
        reference: &str,
    ) -> Result<Option<CriterionRecord>, ReadingError> {
        if let Some(found) = keys.get(reference) {
            return Ok(Some(found.clone()));
        }
        Ok(self
            .store
            .criteria(basis, &[reference.to_string()])
            .await?
            .into_iter()
            .find(|c| c.id == reference))
    }

    /// The basis to evaluate a criterion under: this answer's basis when it
    /// lists the criterion, else the newest basis of the Task that does.
    async fn basis_for(
        &self,
        basis: &ClaimBasis,
        answer_basis: &Option<BasisRecord>,
        criterion_id: &str,
    ) -> Result<Option<BasisRecord>, ReadingError> {
        if let Some(found) = answer_basis
            && found.basis.criteria.iter().any(|c| c == criterion_id)
        {
            return Ok(Some(found.clone()));
        }
        self.store.latest_basis_with(basis, criterion_id).await
    }

    /// The outline of recorded assessment facts and the last answer's
    /// feedback, as attributed data.
    pub async fn context(&self, basis: &ClaimBasis) -> Result<AssessmentContext, ReadingError> {
        let snapshot = self.store.snapshot(basis).await?;
        let covered = self.store.coverage_snapshot(basis).await?;
        let revisions = self.store.revision_snapshot(basis).await?;
        let feedback = self
            .feedback
            .lock()
            .expect("feedback lock")
            .as_ref()
            .filter(|(_, lines)| !lines.is_empty())
            .map(|(_, lines)| feedback_text(lines));
        Ok(AssessmentContext {
            outline: outline_full(&snapshot, &covered, &revisions),
            feedback,
        })
    }
}

/// What became of the last answer's proposals. The lines repeat keys,
/// names, subjects and values that came from the agent's answer and from
/// source documents, so they travel inside the untrusted-content envelope
/// (escaped) like every other attributed text; they never grant authority.
pub fn feedback_text(lines: &[String]) -> String {
    let mut body = String::from(
        "What trusted code did with the assessment proposals of your last answer (agent and source text is quoted data):",
    );
    let mut omitted = 0usize;
    for line in lines {
        // The envelope adds its header and escapes; keep room for both.
        if body.len() + line.len() + 3 > MAX_ASSESSMENT_FEEDBACK_BYTES - 512 {
            omitted += 1;
            continue;
        }
        body.push_str("\n- ");
        body.push_str(line);
    }
    if omitted > 0 {
        body.push_str(&format!("\n- {omitted} further lines are not listed."));
    }
    envelope(InputClass::ModelOutput, "assessment-feedback", &body)
}

fn verdict_text(outcome: &Outcome) -> String {
    let mut text = format!(
        "applicability {} · execution {} · verdict {}",
        outcome.applicability.as_str(),
        outcome.execution.as_str(),
        outcome.verdict.map_or("none", Verdict::as_str)
    );
    if let Some(reason) = outcome.reason {
        text.push_str(&format!(" ({})", reason.as_str()));
    }
    text.push_str(&format!(" · origin {}", outcome.origin.as_str()));
    text
}
fn criterion_line(record: &CriterionRecord) -> String {
    format!(
        "Criterion {} recorded as {} ({}, authority {}{}).",
        record.criterion.key,
        record.id,
        record.criterion.method.kind().as_str(),
        if record.authority.verified {
            "verified"
        } else {
            "unverified"
        },
        record
            .authority
            .reason
            .map(|r| format!(": {}", r.as_str()))
            .unwrap_or_default()
    )
}
fn basis_line(record: &BasisRecord) -> String {
    format!(
        "Basis {} recorded as {} for {} to {} with criteria {}.",
        record.basis.key,
        record.id,
        record.basis.period_from.render(),
        record.basis.period_to.render(),
        record.basis.criteria.join(", ")
    )
}
fn fact_line(record: &FactRecord) -> String {
    let value = match &record.fact.state {
        FactState::Value(value) => format!(
            "{}{}",
            value.text(),
            value
                .measure()
                .map(|m| format!(" {}", m.label()))
                .unwrap_or_default()
        ),
        FactState::Unavailable(reason) => format!("unavailable ({})", reason.as_str()),
        FactState::Ambiguous { candidates } => format!("ambiguous ({candidates} candidates)"),
    };
    format!(
        "Fact {} of {} {} recorded as {}: {} · {}{}.",
        record.fact.name,
        record.fact.subject_unit,
        record.fact.subject,
        record.id,
        bounded(&value, 200),
        record.support.as_str(),
        record
            .support
            .reason()
            .map(|r| format!(" ({})", r.as_str()))
            .unwrap_or_default()
    )
}
fn evaluation_line(record: &EvaluationRecord) -> String {
    format!(
        "Evaluation {} of {} for {} under basis {}: {} · output digest {}.",
        record.id,
        record.criterion_id,
        record.subject,
        record.basis_id,
        verdict_text(&record.outcome),
        &record.output_digest[..12]
    )
}

/// The tier-2 assessment outline: recorded bases, criteria and evaluations
/// with their IDs, so the agent can reference and evaluate them. Bounded as
/// a whole; whatever does not fit is counted. None before any record.
pub fn outline(snapshot: &AssessmentSnapshot) -> Option<String> {
    outline_with(snapshot, &coverage::CoverageSnapshot::default())
}

/// The outline with the Story 24.2 coverage records: populations, samples
/// and summaries with their exact counts (an incomplete population says "at
/// least"), bounded with the rest.
pub fn outline_with(
    snapshot: &AssessmentSnapshot,
    covered: &coverage::CoverageSnapshot,
) -> Option<String> {
    outline_full(snapshot, covered, &revision::RevisionSnapshot::default())
}

/// The outline with the Story 24.3a revision lines: exact counts of
/// evaluation heads, revisions and pending reconsiderations per basis, and
/// each pending reconsideration with the person's concern and words.
pub fn outline_full(
    snapshot: &AssessmentSnapshot,
    covered: &coverage::CoverageSnapshot,
    revisions: &revision::RevisionSnapshot,
) -> Option<String> {
    if snapshot.total_bases + snapshot.total_criteria + snapshot.total_facts == 0 {
        return None;
    }
    let mut lines: Vec<String> = vec![
        "Assessment records of this Task (immutable; propose a superseding version to change one):"
            .into(),
    ];
    let mut bytes = lines[0].len();
    // Every record line pushed is counted, so the "further records" count is
    // exact: every record of the Task minus those actually listed.
    let mut listed = 0u64;
    let mut push = |lines: &mut Vec<String>, line: String| {
        if bytes + line.len() < MAX_ASSESSMENT_OUTLINE_BYTES - 128 {
            bytes += line.len() + 1;
            lines.push(line);
            listed += 1;
        }
    };
    for b in snapshot.bases.iter().take(MAX_OUTLINE_RECORDS) {
        let facts = snapshot
            .basis_fact_counts
            .get(&b.id)
            .copied()
            .unwrap_or_default();
        push(
            &mut lines,
            format!(
                "- basis {} · {} to {} · criteria {} · {} facts{}",
                b.id,
                b.basis.period_from.render(),
                b.basis.period_to.render(),
                b.basis.criteria.join(", "),
                facts,
                b.basis
                    .supersedes
                    .as_deref()
                    .map(|p| format!(" · supersedes {p}"))
                    .unwrap_or_default()
            ),
        );
    }
    for c in snapshot.criteria.iter().take(MAX_OUTLINE_RECORDS) {
        let method = match &c.criterion.method {
            CriterionMethod::Rule(p) => format!("rule: {}", p.describe()),
            CriterionMethod::Judgment { .. } => "judgment".into(),
        };
        push(
            &mut lines,
            format!(
                "- criterion {} \"{}\" · {} · authority {} · facts {}",
                c.id,
                bounded(&c.criterion.assertion, 160),
                method,
                if c.authority.verified {
                    "verified"
                } else {
                    "unverified"
                },
                c.criterion
                    .required_facts
                    .iter()
                    .map(|r| format!("{} ({})", r.name, r.kind.as_str()))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        );
    }
    // The newest evaluations: the snapshot holds them oldest first.
    let skip = snapshot
        .evaluations
        .len()
        .saturating_sub(MAX_OUTLINE_RECORDS);
    for e in snapshot.evaluations.iter().skip(skip) {
        push(
            &mut lines,
            format!(
                "- evaluation {} of {} for {} under {} · {}",
                e.id,
                e.criterion_id,
                e.subject,
                e.basis_id,
                verdict_text(&e.outcome)
            ),
        );
    }
    for line in coverage::coverage_lines(covered) {
        push(&mut lines, line);
    }
    // Revision lines are counted as records too, so "further records" stays
    // exact; pending reconsiderations not listed are counted on their own line.
    let revision_lines = revision::revision_lines(revisions);
    let revision_records = revision_lines.len() as u64;
    for line in revision_lines {
        push(&mut lines, line);
    }
    let total = revision_records
        + snapshot.total_bases
        + snapshot.total_criteria
        + snapshot.total_evaluations
        + covered.total_populations
        + covered.total_samples
        + covered.total_summaries;
    let unlisted = total.saturating_sub(listed);
    if unlisted > 0 {
        lines.push(format!("{unlisted} further records are not listed."));
    }
    lines.push(format!(
        "{} facts are recorded in total.",
        snapshot.total_facts
    ));
    Some(envelope(
        InputClass::ModelOutput,
        "assessment-outline",
        &lines.join("\n"),
    ))
}

/// The work loop's hook (Story 24.1). Assessment needs cited answers and an
/// investigation (the method binding read for authority).
pub trait WorkAssessment: Send + Sync {
    fn enabled(&self) -> bool;
    fn context(
        &self,
        basis: &ClaimBasis,
    ) -> impl Future<Output = Result<AssessmentContext, ModelError>> + Send;
    /// Idempotent per invocation. True when a further turn is useful.
    fn after_answer(
        &self,
        basis: &ClaimBasis,
        binding: &Binding,
        invocation: &Invocation,
        answer: &CitedAnswer,
        cancellation: &ModelCancellation,
    ) -> impl Future<Output = Result<bool, ModelError>> + Send;
}

/// Work without assessment: the answer schema has no 24.1 fields.
pub struct NoAssessment;
impl WorkAssessment for NoAssessment {
    fn enabled(&self) -> bool {
        false
    }
    async fn context(&self, _: &ClaimBasis) -> Result<AssessmentContext, ModelError> {
        Ok(AssessmentContext::default())
    }
    async fn after_answer(
        &self,
        _: &ClaimBasis,
        _: &Binding,
        _: &Invocation,
        _: &CitedAnswer,
        _: &ModelCancellation,
    ) -> Result<bool, ModelError> {
        Ok(false)
    }
}

impl<S: AssessmentStore + coverage::CoverageStore + revision::RevisionStore, C: CitationReader>
    WorkAssessment for Assessment<'_, S, C>
{
    fn enabled(&self) -> bool {
        true
    }
    async fn context(&self, basis: &ClaimBasis) -> Result<AssessmentContext, ModelError> {
        Assessment::context(self, basis)
            .await
            .map_err(crate::investigation::model_error)
    }
    async fn after_answer(
        &self,
        basis: &ClaimBasis,
        binding: &Binding,
        invocation: &Invocation,
        answer: &CitedAnswer,
        cancellation: &ModelCancellation,
    ) -> Result<bool, ModelError> {
        Assessment::after_answer(self, basis, binding, invocation, answer, cancellation)
            .await
            .map_err(crate::investigation::model_error)
    }
}

pub mod coverage;
pub mod revision;

#[cfg(test)]
mod tests;
