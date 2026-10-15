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
    citation::{CitationReader, ReadingError, verify},
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
        UnsupportedReason, Verdict, evaluate, judge, output_digest,
    },
    citation::{
        CitationSource, CitedAnswer, Locator, Segment, UnverifiedReason, Verification,
        VerifiedSource,
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

pub const ASSESSMENT_CONSTRAINTS: &str = "When you are ready to assess, use the assessment fields. Propose criteria in propose_criteria: an assertion, its authority (method: a requirement ID and the 0-based criterion ordinal of the bound method; or original: a registered original, an exact locator and the exact quote), the facts it needs with their types and units or ISO 4217 currency, an optional applicability test, and either a rule (one closed predicate that trusted code evaluates) or a judgment rubric. Propose one assessment basis in propose_basis: the objective, its criteria (IDs, or keys of criteria in the same answer), the business period, population references to registered originals, and limitations. Record typed facts in record_facts for one subject each (kept exactly, leading zeros included): the value in canonical form (decimals like 1250.00 with a unit or currency, dates YYYY-MM-DD, instants in RFC 3339 with the source offset), the closed parse rule that turns your quote into that value, and the exact quoted sources; or unavailable with a closed reason, or ambiguous with the number of candidates. Trusted code verifies each quote at its location and re-parses it; a value the source does not show is unsupported. Ask trusted code to evaluate rule criteria in evaluate; you never write a rule verdict. Propose judgments only for judgment criteria, with the facts that support and contradict them and your reasoning and uncertainty in words. Missing, unavailable or unsupported evidence is never an exception, and there is no confidence score. Records are immutable: to change one, propose a new version that supersedes it.";

/// The closed state of an analysis job a fact depends on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobState {
    /// Completed: its outputs may be relied on.
    Collected,
    /// Did not complete (failed, over a limit, stopped), or not yet ended.
    Failed,
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
            ("job_id", opt(f.job_id.as_deref())),
            (
                "job_state",
                opt(self.job_state.map(|state| match state {
                    JobState::Collected => "collected",
                    JobState::Failed => "failed",
                })),
            ),
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
            job_state: match get_opt(map, "job_state")?.as_deref() {
                None => None,
                Some("collected") => Some(JobState::Collected),
                Some("failed") => Some(JobState::Failed),
                Some(_) => return None,
            },
            digest: document_digest(document),
            recorded_us,
        };
        (record.document() == *document).then_some(record)
    }
    /// The fact as the evaluator reads it.
    pub fn input(&self) -> InputFact {
        InputFact {
            id: self.id.clone(),
            digest: self.digest.clone(),
            name: self.fact.name.clone(),
            state: self.fact.state.clone(),
            support: self.support,
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

/// Verify sources with the 22.5 verifier: one cited segment per source,
/// chunked within the answer bounds. Each source's result is in input order.
async fn verify_sources<C: CitationReader>(
    reader: &C,
    basis: &ClaimBasis,
    sources: &[CitationSource],
    cancellation: &ModelCancellation,
) -> Result<Vec<VerifiedSource>, ReadingError> {
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
        let stored = verify(reader, basis, &answer, cancellation).await?;
        if stored.len() != chunk.len() || stored.iter().any(|c| c.sources.len() != 1) {
            return Err(ReadingError::Invalid);
        }
        out.extend(stored.into_iter().map(|mut c| c.sources.remove(0)));
    }
    Ok(out)
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

impl<S: AssessmentStore, C: CitationReader> Assessment<'_, S, C> {
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
                    .remove(0);
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

        // 3. Fact observations: sources verified, values re-parsed.
        // (record, the fact names a job that is not one of this Task's)
        let mut pending: Vec<(FactRecord, bool)> = Vec::new();
        let mut seen: BTreeSet<(String, String, String)> = BTreeSet::new();
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
            let key = (
                basis_id.clone(),
                proposed.subject.clone(),
                proposed.name.clone(),
            );
            let recorded_before = self
                .store
                .facts(basis, &basis_id)
                .await?
                .iter()
                .any(|f| f.fact.subject == proposed.subject && f.fact.name == proposed.name);
            if !seen.insert(key) || recorded_before {
                feedback.push(format!(
                    "Fact {} of {} was not recorded: that basis already holds it. Facts are pinned to a basis version; propose a new basis version to change one.",
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
        let verified = if all_sources.is_empty() {
            vec![]
        } else {
            verify_sources(self.reader, basis, &all_sources, cancellation).await?
        };
        let mut at = 0usize;
        for (mut record, unknown_job) in pending {
            let count = record.fact.sources.len();
            record.sources = verified[at..at + count].to_vec();
            at += count;
            // A failed job is an analysis failure; a job that is not one of
            // this Task's leaves the material unverified, never "failed".
            record.support = if record.job_state == Some(JobState::Failed) {
                FactSupport::Unsupported(UnsupportedReason::AnalysisFailed)
            } else if unknown_job {
                FactSupport::Unsupported(UnsupportedReason::SourceUnverified)
            } else {
                match &record.fact.state {
                    FactState::Value(value) => {
                        if record
                            .sources
                            .iter()
                            .any(|s| s.verification != Verification::Verified)
                        {
                            FactSupport::Unsupported(UnsupportedReason::SourceUnverified)
                        } else {
                            let rule = record.fact.rule.expect("a stated value names its rule");
                            let derived: Vec<Option<FactValue>> = record
                                .sources
                                .iter()
                                .map(|s| rule.apply(&s.source.quote, value.measure()))
                                .collect();
                            if derived
                                .iter()
                                .all(|d| d.as_ref().is_some_and(|d| value.agrees(d)))
                            {
                                // The recorded value is the one derived from
                                // the verified quote.
                                record.fact.state =
                                    FactState::Value(derived[0].clone().expect("checked above"));
                                FactSupport::Supported
                            } else {
                                FactSupport::Unsupported(UnsupportedReason::TypeMismatch)
                            }
                        }
                    }
                    _ => FactSupport::NoValue,
                }
            };
            record.digest = document_digest(&record.document());
            let stored = self.store.record_fact(basis, &record).await?;
            progress = true;
            feedback.push(fact_line(&stored));
        }

        // 4. Deterministic evaluation, on request only.
        let mut ordinal = existing
            .evaluations
            .iter()
            .map(|e| e.ordinal + 1)
            .max()
            .unwrap_or(0);
        let mut written = existing.evaluations.len();
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
            let facts = self.store.facts(basis, &target.id).await?;
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
            if subjects.len() > MAX_SUBJECTS_PER_CRITERION {
                feedback.push(format!(
                    "{} has {} subjects under basis {}; the first {MAX_SUBJECTS_PER_CRITERION} in byte order are evaluated.",
                    criterion.id,
                    subjects.len(),
                    target.id
                ));
            }
            for subject in subjects.into_iter().take(MAX_SUBJECTS_PER_CRITERION) {
                let inputs: Vec<InputFact> = facts
                    .iter()
                    .filter(|f| f.fact.subject == subject)
                    .map(FactRecord::input)
                    .collect();
                let outcome = evaluate(
                    &criterion.criterion,
                    &context_for(&target, &criterion, &inputs),
                );
                let digest = output_digest(&target.id, &criterion.id, subject, &outcome, None);
                if let Some(found) = self
                    .store
                    .evaluation(basis, &target.id, &criterion.id, subject)
                    .await?
                {
                    feedback.push(if found.output_digest == digest {
                        format!(
                            "{} for {subject} under basis {} was already evaluated ({}); re-evaluating gives the same output digest {}.",
                            criterion.id,
                            target.id,
                            found.id,
                            &digest[..12]
                        )
                    } else {
                        format!(
                            "{} for {subject} under basis {} was already evaluated ({}); its inputs have changed since. Propose a new basis version to evaluate again.",
                            criterion.id, target.id, found.id
                        )
                    });
                    continue;
                }
                if written >= MAX_INVOCATION_EVALUATIONS {
                    feedback.push(
                        "Further evaluations were not recorded: the per-answer bound was reached."
                            .into(),
                    );
                    break;
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
                    subject: subject.into(),
                    outcome,
                    judgment: None,
                    output_digest: digest,
                    recorded_us: None,
                };
                let stored = self.store.record_evaluation(basis, &record).await?;
                ordinal += 1;
                written += 1;
                progress = true;
                feedback.push(evaluation_line(&stored));
            }
        }

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
            if let Some(found) = self
                .store
                .evaluation(basis, &target.id, &criterion.id, &proposed.subject)
                .await?
            {
                feedback.push(format!(
                    "The judgment of {} for {} under basis {} is already recorded ({}).",
                    criterion.id, proposed.subject, target.id, found.id
                ));
                continue;
            }
            let facts = self.store.facts(basis, &target.id).await?;
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
            if written >= MAX_INVOCATION_EVALUATIONS {
                break;
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
            let stored = self.store.record_evaluation(basis, &record).await?;
            ordinal += 1;
            written += 1;
            progress = true;
            feedback.push(evaluation_line(&stored));
        }
        *self.feedback.lock().expect("feedback lock") = Some((invocation.id.clone(), feedback));
        // A reclaim finds this answer's records already written: the work
        // continues exactly as it did when they were first recorded.
        let recorded_before = !(existing.criteria.is_empty()
            && existing.bases.is_empty()
            && existing.facts.is_empty()
            && existing.evaluations.is_empty());
        Ok(progress || recorded_before)
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
        let feedback = self
            .feedback
            .lock()
            .expect("feedback lock")
            .as_ref()
            .filter(|(_, lines)| !lines.is_empty())
            .map(|(_, lines)| {
                let mut text =
                    String::from("Assessment proposals of your last answer (platform facts):");
                let mut omitted = 0usize;
                for line in lines {
                    if text.len() + line.len() + 3 > MAX_ASSESSMENT_FEEDBACK_BYTES - 64 {
                        omitted += 1;
                        continue;
                    }
                    text.push_str("\n- ");
                    text.push_str(line);
                }
                if omitted > 0 {
                    text.push_str(&format!("\n- {omitted} further lines are not listed."));
                }
                text
            });
        Ok(AssessmentContext {
            outline: outline(&snapshot),
            feedback,
        })
    }
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
    if snapshot.total_bases + snapshot.total_criteria + snapshot.total_facts == 0 {
        return None;
    }
    let mut lines: Vec<String> = vec![
        "Assessment records of this Task (immutable; propose a superseding version to change one):"
            .into(),
    ];
    let mut bytes = lines[0].len();
    let mut omitted = 0u64;
    let mut push = |lines: &mut Vec<String>, line: String| {
        if bytes + line.len() + 1 > MAX_ASSESSMENT_OUTLINE_BYTES - 128 {
            omitted += 1;
        } else {
            bytes += line.len() + 1;
            lines.push(line);
        }
    };
    for b in snapshot.bases.iter().take(MAX_OUTLINE_RECORDS) {
        let facts = snapshot.facts.iter().filter(|f| f.basis_id == b.id).count();
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
    for e in snapshot.evaluations.iter().take(MAX_OUTLINE_RECORDS) {
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
    let total = snapshot.total_bases + snapshot.total_criteria + snapshot.total_evaluations;
    let listed = (lines.len() - 1) as u64;
    let unlisted = total.saturating_sub(listed).max(omitted);
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

impl<S: AssessmentStore, C: CitationReader> WorkAssessment for Assessment<'_, S, C> {
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

#[cfg(test)]
mod tests;
