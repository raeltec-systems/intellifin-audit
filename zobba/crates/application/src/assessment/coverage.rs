//! Story 24.2: exact population, sample and coverage denominators.
//!
//! The agent keeps deciding what to read and how to scope the work. When it
//! has found a population source it proposes a manifest (where and how to
//! read it); trusted code reads every row of the exact original, decides each
//! row's disposition, evaluates rule criteria over every in-scope member with
//! the 24.1 pure evaluator, and computes the coverage summary with the pure
//! `zobba_domain::coverage::summarise`. The database recounts every summary
//! number with exact SQL aggregates over the stored rows. The model never
//! counts and never writes a member, a disposition or a rule verdict.
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
};

use super::{
    Assessment, AssessmentStore, BasisRecord, CriterionRecord, EvaluationRecord, FactRecord, Map,
    as_obj, context_for, document_digest, envelope_from, get_array, get_bool, get_int, get_list,
    get_opt, get_str, int, list, measure_doc, measure_from, obj, opt, record_id, s, source_doc,
    source_from, turn_basis, value_doc, value_from, verify_sources,
};
use crate::{
    citation::{CitationReader, ReadingError},
    investigation::bounded,
    model::{Invocation, ModelCancellation},
};
use zobba_domain::{
    assessment::{
        Applicability, CriterionKind, Execution, FactState, FactType, Origin, Outcome, ParseRule,
        Verdict, evaluate, output_digest, whole_value,
    },
    citation::{CitedAnswer, Locator, Verification, VerifiedSource},
    coverage::{
        CellKind, Completeness, Conclusion, ControlCount, CriterionOpportunities, Disposition,
        DispositionKind, DispositionReason, Enumeration, EnumerationFailure, IncompleteReason,
        Limitation, LimitationCode, Member, MemberCell, MemberValue, OpportunityFacts,
        PopulationCounts, PopulationFacts, ProposedPopulation, ProposedSample, Reconciliation,
        SampleMethod, SampleMethodKind, SampleRefusal, Substitution, Summary, ValueColumn,
        build_members, check_sample, completeness, naive_date_times, summarise,
    },
    model::JsonValue,
    task::ClaimBasis,
};

/// Populations, samples and summaries the outline lists; the rest counted.
pub const MAX_OUTLINE_COVERAGE: usize = 16;

/// An immutable population manifest version, as trusted code recorded it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PopulationRecord {
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub invocation_id: String,
    pub ordinal: u32,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub basis_id: String,
    /// `basis` holds the basis ID.
    pub population: ProposedPopulation,
    /// The exact registered digest the enumeration read.
    pub original_sha256: String,
    /// The cited control count as the 22.5 verifier recorded it.
    pub control: Option<VerifiedSource>,
    pub declared_count: Option<u64>,
    /// The 22.4 job of a workbook read (None: read in process).
    pub job_id: Option<String>,
    pub last_row: u32,
    pub rows_read: u32,
    pub truncated: bool,
    pub counts: PopulationCounts,
    pub completeness: Completeness,
    pub reconciliation: Reconciliation,
    /// Excel date-time cells (no time zone) read as UTC under an instant rule.
    pub naive_date_times: u64,
    pub digest: String,
    pub recorded_us: Option<i64>,
}

/// One received row of a population, with its canonical document digest.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemberRecord {
    pub population_id: String,
    pub member: Member,
    pub digest: String,
}

/// An immutable sample manifest version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SampleRecord {
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub invocation_id: String,
    pub ordinal: u32,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub population_id: String,
    /// `population` holds the population ID.
    pub sample: ProposedSample,
    /// The selected subjects, in C (byte) order, checked by trusted code.
    pub selected: Vec<String>,
    pub digest: String,
    pub recorded_us: Option<i64>,
}

/// One immutable opportunity: a criterion for one in-scope member.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpportunityRecord {
    pub population_id: String,
    pub criterion_id: String,
    pub member_ordinal: u32,
    pub subject: String,
    pub invocation_id: String,
    pub outcome: Outcome,
    pub output_digest: String,
    /// The 24.1 judgment a judgment criterion's opportunity uses.
    pub evaluation_id: Option<String>,
}

/// An immutable coverage summary version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SummaryRecord {
    pub id: String,
    pub task_id: String,
    pub cycle_id: String,
    pub invocation_id: String,
    pub ordinal: u32,
    pub methodology_binding_id: String,
    pub execution_epoch: u64,
    pub basis_id: String,
    pub population_id: String,
    pub sample_id: Option<String>,
    pub summary: Summary,
    /// The canonical digest of `summary.document()`.
    pub summary_digest: String,
    pub digest: String,
    pub recorded_us: Option<i64>,
}

/// Coverage records one invocation wrote.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InvocationCoverage {
    pub populations: Vec<PopulationRecord>,
    pub samples: Vec<SampleRecord>,
    pub summaries: Vec<SummaryRecord>,
}

/// The Task's recent coverage records (bounded) and exact totals.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CoverageSnapshot {
    pub populations: Vec<PopulationRecord>,
    /// Older populations a listed sample or summary reads (exact, by ID).
    pub referenced: Vec<PopulationRecord>,
    pub samples: Vec<SampleRecord>,
    pub summaries: Vec<SummaryRecord>,
    pub total_populations: u64,
    pub total_samples: u64,
    pub total_summaries: u64,
}

/// Coverage records under the exact claim producer's custody. Every record
/// is immutable; exact checks use exact queries, never bounded lists.
pub trait CoverageStore: Send + Sync {
    fn invocation_coverage(
        &self,
        basis: &ClaimBasis,
        invocation_id: &str,
    ) -> impl Future<Output = Result<InvocationCoverage, ReadingError>> + Send;
    fn population(
        &self,
        basis: &ClaimBasis,
        id: &str,
    ) -> impl Future<Output = Result<Option<PopulationRecord>, ReadingError>> + Send;
    /// Every member of one population (an exact read: at most the rows its
    /// manifest received).
    fn members(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
    ) -> impl Future<Output = Result<Vec<MemberRecord>, ReadingError>> + Send;
    /// The manifest and every member in one transaction.
    fn record_population(
        &self,
        basis: &ClaimBasis,
        record: &PopulationRecord,
        members: &[MemberRecord],
    ) -> impl Future<Output = Result<PopulationRecord, ReadingError>> + Send;
    fn sample(
        &self,
        basis: &ClaimBasis,
        id: &str,
    ) -> impl Future<Output = Result<Option<SampleRecord>, ReadingError>> + Send;
    fn record_sample(
        &self,
        basis: &ClaimBasis,
        record: &SampleRecord,
    ) -> impl Future<Output = Result<SampleRecord, ReadingError>> + Send;
    /// Every opportunity of one criterion over one population (exact).
    fn opportunities(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
        criterion_id: &str,
    ) -> impl Future<Output = Result<Vec<OpportunityRecord>, ReadingError>> + Send;
    /// Every opportunity of one criterion over one population, in one
    /// transaction. An identical retry succeeds; a different one is refused.
    fn record_opportunities(
        &self,
        basis: &ClaimBasis,
        records: &[OpportunityRecord],
    ) -> impl Future<Output = Result<(), ReadingError>> + Send;
    fn summary_for(
        &self,
        basis: &ClaimBasis,
        population_id: &str,
        sample_id: Option<&str>,
    ) -> impl Future<Output = Result<Option<SummaryRecord>, ReadingError>> + Send;
    fn record_summary(
        &self,
        basis: &ClaimBasis,
        record: &SummaryRecord,
    ) -> impl Future<Output = Result<SummaryRecord, ReadingError>> + Send;
    fn coverage_snapshot(
        &self,
        basis: &ClaimBasis,
    ) -> impl Future<Output = Result<CoverageSnapshot, ReadingError>> + Send;
}

// ------------------------------------------------------------- documents

fn u(value: Option<u64>) -> JsonValue {
    value.map_or(JsonValue::Null, int)
}
fn counts_doc(c: &PopulationCounts) -> JsonValue {
    obj(vec![
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
    ])
}
fn counts_from(map: &Map) -> Option<PopulationCounts> {
    let n = |key: &str| u64::try_from(get_int(map, key)?).ok();
    Some(PopulationCounts {
        received_rows: n("received_rows")?,
        unkeyed: n("unkeyed")?,
        duplicate_rows: n("duplicate_rows")?,
        distinct_subjects: n("distinct_subjects")?,
        excluded_out_of_period: n("excluded_out_of_period")?,
        scope_unknown_period_unparsed: n("scope_unknown_period_unparsed")?,
        scope_unknown_period_missing: n("scope_unknown_period_missing")?,
        scope_unknown_conflicting_duplicate: n("scope_unknown_conflicting_duplicate")?,
        in_scope: n("in_scope")?,
    })
}
fn verification_doc(v: &VerifiedSource) -> JsonValue {
    let mut fields = source_doc(&v.source);
    fields.push(("original_sha256", opt(v.original_sha256.as_deref())));
    fields.push((
        "verification",
        s(match v.verification {
            Verification::Verified => "verified",
            Verification::Unverified(_) => "unverified",
        }),
    ));
    obj(fields)
}

impl PopulationRecord {
    pub fn document(&self) -> JsonValue {
        let p = &self.population;
        let mut fields = envelope_doc!("population", self);
        fields.extend([
            ("basis_id", s(&self.basis_id)),
            ("key", s(&p.key)),
            ("supersedes", opt(p.supersedes.as_deref())),
            ("original_id", s(&p.original_id)),
            ("original_sha256", s(&self.original_sha256)),
            ("sheet", opt(p.sheet.as_deref())),
            ("header_row", int(u64::from(p.header_row))),
            // The named columns in the order the trusted read requested them.
            ("columns", list(&p.columns())),
            ("subject_unit", s(&p.subject_unit)),
            ("grain", list(&p.grain)),
            (
                "period_column",
                opt(p.period.as_ref().map(|(h, _)| h.as_str())),
            ),
            (
                "period_rule",
                opt(p.period.as_ref().map(|(_, r)| r.as_str())),
            ),
            (
                "value_columns",
                JsonValue::Array(
                    p.values
                        .iter()
                        .map(|v| {
                            obj(vec![
                                ("header", s(&v.header)),
                                ("name", s(&v.name)),
                                ("type", s(v.kind.as_str())),
                                ("rule", s(v.rule.as_str())),
                                ("measure", measure_doc(v.measure.as_ref())),
                                ("measure_column", opt(v.measure_column.as_deref())),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("exhaustive", JsonValue::Bool(p.exhaustive)),
            (
                "control",
                match (&p.control, &self.control) {
                    (Some(c), Some(v)) => {
                        let JsonValue::Object(mut map) = verification_doc(v) else {
                            unreachable!()
                        };
                        map.insert("rule".into(), s(c.rule.as_str()));
                        JsonValue::Object(map)
                    }
                    _ => JsonValue::Null,
                },
            ),
            ("declared_count", u(self.declared_count)),
            ("selection", s(&p.selection)),
            ("job_id", opt(self.job_id.as_deref())),
            ("last_row", int(u64::from(self.last_row))),
            ("rows_read", int(u64::from(self.rows_read))),
            ("truncated", JsonValue::Bool(self.truncated)),
            ("naive_date_times", int(self.naive_date_times)),
            ("counts", counts_doc(&self.counts)),
            ("completeness", s(self.completeness.as_str())),
            (
                "completeness_reason",
                opt(self.completeness.reason().map(IncompleteReason::as_str)),
            ),
            ("reconciliation", s(self.reconciliation.as_str())),
        ]);
        obj(fields)
    }
    pub fn from_document(document: &JsonValue, recorded_us: Option<i64>) -> Option<Self> {
        let map = as_obj(document)?;
        let e = envelope_from(map, "population")?;
        let values = get_array(map, "value_columns")?
            .iter()
            .map(|item| {
                let v = as_obj(item)?;
                Some(ValueColumn {
                    header: get_str(v, "header")?.into(),
                    name: get_str(v, "name")?.into(),
                    kind: FactType::parse(get_str(v, "type")?)?,
                    rule: ParseRule::parse(get_str(v, "rule")?)?,
                    measure: measure_from(v.get("measure")?)?,
                    measure_column: get_opt(v, "measure_column")?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let period = match (get_opt(map, "period_column")?, get_opt(map, "period_rule")?) {
            (Some(h), Some(r)) => Some((h, ParseRule::parse(&r)?)),
            (None, None) => None,
            _ => return None,
        };
        let (control, verified) = match map.get("control")? {
            JsonValue::Null => (None, None),
            value => {
                let c = as_obj(value)?;
                let source = source_from(c)?;
                let verification = match get_str(c, "verification")? {
                    "verified" => Verification::Verified,
                    _ => return None,
                };
                (
                    Some(ControlCount {
                        source: source.clone(),
                        rule: ParseRule::parse(get_str(c, "rule")?)?,
                    }),
                    Some(VerifiedSource {
                        source,
                        original_sha256: get_opt(c, "original_sha256")?,
                        verification,
                    }),
                )
            }
        };
        let counts = counts_from(as_obj(map.get("counts")?)?)?;
        let completeness = match (
            get_str(map, "completeness")?,
            get_opt(map, "completeness_reason")?,
        ) {
            ("complete", None) => Completeness::Complete,
            ("incomplete", Some(r)) => Completeness::Incomplete(IncompleteReason::parse(&r)?),
            _ => return None,
        };
        let declared_count = match map.get("declared_count")? {
            JsonValue::Null => None,
            JsonValue::Integer(n) => Some(u64::try_from(*n).ok()?),
            _ => return None,
        };
        let reconciliation = match (get_str(map, "reconciliation")?, declared_count) {
            ("matched", Some(_)) => Reconciliation::Matched,
            ("not_declared", None) => Reconciliation::NotDeclared,
            ("mismatch", Some(declared)) => Reconciliation::Mismatch {
                declared,
                distinct: counts.distinct_subjects,
            },
            _ => return None,
        };
        let basis_id: String = get_str(map, "basis_id")?.into();
        let record = Self {
            id: e.id,
            task_id: e.task_id,
            cycle_id: e.cycle_id,
            invocation_id: e.invocation_id,
            ordinal: e.ordinal,
            methodology_binding_id: e.binding,
            execution_epoch: e.epoch,
            population: ProposedPopulation {
                key: get_str(map, "key")?.into(),
                basis: basis_id.clone(),
                supersedes: get_opt(map, "supersedes")?,
                original_id: get_str(map, "original_id")?.into(),
                sheet: get_opt(map, "sheet")?,
                header_row: u32::try_from(get_int(map, "header_row")?).ok()?,
                subject_unit: get_str(map, "subject_unit")?.into(),
                grain: get_list(map, "grain")?,
                period,
                values,
                exhaustive: get_bool(map, "exhaustive")?,
                control,
                selection: get_str(map, "selection")?.into(),
            },
            basis_id,
            original_sha256: get_str(map, "original_sha256")?.into(),
            control: verified,
            declared_count,
            job_id: get_opt(map, "job_id")?,
            last_row: u32::try_from(get_int(map, "last_row")?).ok()?,
            rows_read: u32::try_from(get_int(map, "rows_read")?).ok()?,
            truncated: get_bool(map, "truncated")?,
            counts,
            completeness,
            reconciliation,
            naive_date_times: u64::try_from(get_int(map, "naive_date_times")?).ok()?,
            digest: document_digest(document),
            recorded_us,
        };
        (record.population.is_valid() && record.document() == *document).then_some(record)
    }
    /// The facts the summary reads.
    pub fn facts(&self) -> PopulationFacts {
        PopulationFacts {
            completeness: self.completeness,
            reconciliation: self.reconciliation,
            counts: self.counts,
            period_checked: self.population.period.is_some(),
            naive_date_times: self.naive_date_times,
        }
    }
}

fn member_value_doc(value: &MemberValue) -> JsonValue {
    match value {
        MemberValue::Missing => obj(vec![("kind", s("missing"))]),
        MemberValue::Unsupported => obj(vec![
            ("kind", s("unsupported")),
            ("reason", s("type_mismatch")),
        ]),
        MemberValue::Value {
            value,
            measure_grounded,
        } => {
            let JsonValue::Object(mut map) = value_doc(&FactState::Value(value.clone())) else {
                unreachable!()
            };
            map.insert(
                "measure_grounded".into(),
                measure_grounded.map_or(JsonValue::Null, JsonValue::Bool),
            );
            JsonValue::Object(map)
        }
    }
}
fn member_value_from(value: &JsonValue) -> Option<MemberValue> {
    let map = as_obj(value)?;
    match get_str(map, "kind")? {
        "missing" if map.len() == 1 => Some(MemberValue::Missing),
        "unsupported" if get_str(map, "reason")? == "type_mismatch" && map.len() == 2 => {
            Some(MemberValue::Unsupported)
        }
        _ => {
            let grounded = match map.get("measure_grounded")? {
                JsonValue::Null => None,
                JsonValue::Bool(b) => Some(*b),
                _ => return None,
            };
            let mut rest = map.clone();
            rest.remove("measure_grounded");
            match value_from(&JsonValue::Object(rest))? {
                FactState::Value(value) => ((value.kind() == FactType::Decimal)
                    == grounded.is_some())
                .then_some(MemberValue::Value {
                    value,
                    measure_grounded: grounded,
                }),
                _ => None,
            }
        }
    }
}

impl MemberRecord {
    pub fn new(population_id: &str, spec: &ProposedPopulation, member: Member) -> Self {
        let mut record = Self {
            population_id: population_id.into(),
            member,
            digest: String::new(),
        };
        record.digest = document_digest(&record.document(spec));
        record
    }
    pub fn document(&self, spec: &ProposedPopulation) -> JsonValue {
        let m = &self.member;
        let columns = spec.columns();
        obj(vec![
            ("record", s("member")),
            ("population_id", s(&self.population_id)),
            ("ordinal", int(u64::from(m.ordinal))),
            ("row", int(u64::from(m.row))),
            ("subject", opt(m.subject.as_deref())),
            ("disposition", s(m.disposition.kind().as_str())),
            (
                "reason",
                opt(m.disposition.reason().map(DispositionReason::as_str)),
            ),
            (
                "duplicate_of",
                u(m.disposition.duplicate_of().map(u64::from)),
            ),
            (
                "cells",
                JsonValue::Array(
                    columns
                        .iter()
                        .zip(&m.cells)
                        .map(|(header, cell)| {
                            obj(vec![
                                ("header", s(header)),
                                ("text", opt(cell.text.as_deref())),
                                (
                                    "locator",
                                    cell.locator
                                        .as_ref()
                                        .map_or(JsonValue::Null, |l| s(&l.render())),
                                ),
                                ("kind", s(cell.kind.as_str())),
                            ])
                        })
                        .collect(),
                ),
            ),
            (
                "values",
                JsonValue::Array(
                    spec.values
                        .iter()
                        .zip(&m.values)
                        .map(|(column, value)| {
                            obj(vec![
                                ("name", s(&column.name)),
                                ("value", member_value_doc(value)),
                            ])
                        })
                        .collect(),
                ),
            ),
        ])
    }
    pub fn from_document(document: &JsonValue, spec: &ProposedPopulation) -> Option<Self> {
        let map = as_obj(document)?;
        (get_str(map, "record")? == "member").then_some(())?;
        let disposition = Disposition::from_parts(
            DispositionKind::parse(get_str(map, "disposition")?)?,
            match get_opt(map, "reason")? {
                Some(r) => Some(DispositionReason::parse(&r)?),
                None => None,
            },
            match map.get("duplicate_of")? {
                JsonValue::Null => None,
                JsonValue::Integer(n) => Some(u32::try_from(*n).ok()?),
                _ => return None,
            },
        )?;
        let cells = get_array(map, "cells")?
            .iter()
            .map(|cell| {
                let cell = as_obj(cell)?;
                Some(MemberCell {
                    text: get_opt(cell, "text")?,
                    locator: match get_opt(cell, "locator")? {
                        Some(text) => Some(Locator::parse(&text)?),
                        None => None,
                    },
                    kind: CellKind::parse(get_str(cell, "kind")?)?,
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let values = get_array(map, "values")?
            .iter()
            .map(|v| member_value_from(as_obj(v)?.get("value")?))
            .collect::<Option<Vec<_>>>()?;
        let record = Self {
            population_id: get_str(map, "population_id")?.into(),
            member: Member {
                ordinal: u32::try_from(get_int(map, "ordinal")?).ok()?,
                row: u32::try_from(get_int(map, "row")?).ok()?,
                subject: get_opt(map, "subject")?,
                disposition,
                cells,
                values,
            },
            digest: document_digest(document),
        };
        (record.document(spec) == *document).then_some(record)
    }
}

impl SampleRecord {
    pub fn document(&self) -> JsonValue {
        let p = &self.sample;
        let mut fields = envelope_doc!("sample", self);
        fields.extend([
            ("population_id", s(&self.population_id)),
            ("key", s(&p.key)),
            ("method", s(p.method.kind().as_str())),
            (
                "seed",
                opt(p.method.seed().map(|seed| seed.to_string()).as_deref()),
            ),
            (
                "algorithm",
                opt(p
                    .method
                    .seed()
                    .map(|_| zobba_domain::coverage::SAMPLE_ALGORITHM)),
            ),
            ("size", int(u64::from(p.size))),
            ("strata", s(&p.strata)),
            ("justification", s(&p.justification)),
            ("keys", list(&p.keys)),
            (
                "substitutions",
                JsonValue::Array(
                    p.substitutions
                        .iter()
                        .map(|x| {
                            obj(vec![
                                ("replaced", s(&x.replaced)),
                                ("substitute", s(&x.substitute)),
                                ("reason", s(&x.reason)),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("selected_count", int(self.selected.len() as u64)),
            ("selected_sha256", s(&selected_digest(&self.selected))),
            ("statistical_inference", JsonValue::Bool(false)),
        ]);
        obj(fields)
    }
    pub fn from_document(
        document: &JsonValue,
        selected: Vec<String>,
        recorded_us: Option<i64>,
    ) -> Option<Self> {
        let map = as_obj(document)?;
        let e = envelope_from(map, "sample")?;
        let method = match SampleMethodKind::parse(get_str(map, "method")?)? {
            SampleMethodKind::AllInScope => SampleMethod::AllInScope,
            SampleMethodKind::Judgmental => SampleMethod::Judgmental,
            SampleMethodKind::SeededRandom => SampleMethod::SeededRandom {
                seed: get_opt(map, "seed")??.parse().ok()?,
            },
        };
        let substitutions = get_array(map, "substitutions")?
            .iter()
            .map(|x| {
                let x = as_obj(x)?;
                Some(Substitution {
                    replaced: get_str(x, "replaced")?.into(),
                    substitute: get_str(x, "substitute")?.into(),
                    reason: get_str(x, "reason")?.into(),
                })
            })
            .collect::<Option<Vec<_>>>()?;
        let population_id: String = get_str(map, "population_id")?.into();
        let record = Self {
            id: e.id,
            task_id: e.task_id,
            cycle_id: e.cycle_id,
            invocation_id: e.invocation_id,
            ordinal: e.ordinal,
            methodology_binding_id: e.binding,
            execution_epoch: e.epoch,
            sample: ProposedSample {
                key: get_str(map, "key")?.into(),
                population: population_id.clone(),
                method,
                size: u32::try_from(get_int(map, "size")?).ok()?,
                strata: get_str(map, "strata")?.into(),
                justification: get_str(map, "justification")?.into(),
                keys: get_list(map, "keys")?,
                substitutions,
            },
            population_id,
            selected,
            digest: document_digest(document),
            recorded_us,
        };
        (record.sample.is_valid() && record.document() == *document).then_some(record)
    }
}

/// The SHA-256 of the selected subjects joined by newlines: the sample
/// document names its selection by count and digest, and the selected
/// subjects are stored one per row beside it.
pub fn selected_digest(selected: &[String]) -> String {
    zobba_domain::work::sha256_hex(selected.join("\n").as_bytes())
}

impl SummaryRecord {
    pub fn document(&self) -> JsonValue {
        let mut fields = envelope_doc!("summary", self);
        fields.extend([
            ("basis_id", s(&self.basis_id)),
            ("population_id", s(&self.population_id)),
            ("sample_id", opt(self.sample_id.as_deref())),
            ("summary", self.summary.document()),
            ("summary_digest", s(&self.summary_digest)),
        ]);
        obj(fields)
    }
    pub fn from_document(document: &JsonValue, recorded_us: Option<i64>) -> Option<Self> {
        let map = as_obj(document)?;
        let e = envelope_from(map, "summary")?;
        let summary = summary_from(as_obj(map.get("summary")?)?)?;
        let record = Self {
            id: e.id,
            task_id: e.task_id,
            cycle_id: e.cycle_id,
            invocation_id: e.invocation_id,
            ordinal: e.ordinal,
            methodology_binding_id: e.binding,
            execution_epoch: e.epoch,
            basis_id: get_str(map, "basis_id")?.into(),
            population_id: get_str(map, "population_id")?.into(),
            sample_id: get_opt(map, "sample_id")?,
            summary_digest: get_str(map, "summary_digest")?.into(),
            summary,
            digest: document_digest(document),
            recorded_us,
        };
        (record.summary.is_consistent()
            && record.summary_digest == record.summary.digest()
            && record.document() == *document)
            .then_some(record)
    }
}

/// The summary a stored document states (checked against its own document).
pub fn summary_from(map: &Map) -> Option<Summary> {
    use zobba_domain::coverage::{CriterionCounts, Partition};
    let n = |m: &Map, key: &str| u64::try_from(get_int(m, key)?).ok();
    let completeness = match (
        get_str(map, "completeness")?,
        get_opt(map, "completeness_reason")?,
    ) {
        ("complete", None) => Completeness::Complete,
        ("incomplete", Some(r)) => Completeness::Incomplete(IncompleteReason::parse(&r)?),
        _ => return None,
    };
    let counts = counts_from(map)?;
    let reconciliation = match get_str(map, "reconciliation")? {
        "matched" => Reconciliation::Matched,
        "not_declared" => Reconciliation::NotDeclared,
        "mismatch" => Reconciliation::Mismatch {
            declared: n(map, "mismatch_declared")?,
            distinct: n(map, "mismatch_distinct")?,
        },
        _ => return None,
    };
    let criteria = get_array(map, "criteria")?
        .iter()
        .map(|c| {
            let c = as_obj(c)?;
            Some(CriterionCounts {
                criterion_id: get_str(c, "criterion_id")?.into(),
                applicable: n(c, "applicable")?,
                not_applicable: n(c, "not_applicable")?,
                applicability_unknown: n(c, "applicability_unknown")?,
                met: n(c, "met")?,
                not_met: n(c, "not_met")?,
                undetermined: n(c, "undetermined")?,
                undetermined_by_reason: match c.get("undetermined_by_reason")? {
                    JsonValue::Object(by) => by
                        .iter()
                        .map(|(k, v)| match v {
                            JsonValue::Integer(v) => Some((k.clone(), u64::try_from(*v).ok()?)),
                            _ => None,
                        })
                        .collect::<Option<_>>()?,
                    _ => return None,
                },
                execution_failed: n(c, "execution_failed")?,
                not_evaluated: n(c, "not_evaluated")?,
                met_unreviewed: n(c, "met_unreviewed")?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let summary = Summary {
        completeness,
        reconciliation,
        counts,
        selected: match map.get("selected")? {
            JsonValue::Null => None,
            JsonValue::Integer(v) => Some(u64::try_from(*v).ok()?),
            _ => return None,
        },
        criteria,
        partition: Partition {
            failing: n(map, "failing")?,
            meets_every_applicable: n(map, "meets_every_applicable")?,
            unresolved: n(map, "unresolved")?,
            not_applicable_to_any: n(map, "not_applicable_to_any")?,
        },
        failing_opportunities: n(map, "failing_opportunities")?,
        conclusion: Conclusion::parse(get_str(map, "conclusion")?)?,
        limitations: get_array(map, "limitations")?
            .iter()
            .map(|l| {
                let l = as_obj(l)?;
                Some(Limitation {
                    code: LimitationCode::parse(get_str(l, "code")?)?,
                    criterion_id: get_opt(l, "criterion_id")?,
                    count: match l.get("count")? {
                        JsonValue::Null => None,
                        JsonValue::Integer(v) => Some(u64::try_from(*v).ok()?),
                        _ => return None,
                    },
                })
            })
            .collect::<Option<Vec<_>>>()?,
    };
    (summary.document() == JsonValue::Object(map.clone())).then_some(summary)
}

impl OpportunityRecord {
    /// The output digest recomputed from the record's own fields (a judgment
    /// opportunity carries its 24.1 judgment's own digest).
    pub fn computed_digest(&self) -> String {
        output_digest(
            &self.population_id,
            &self.criterion_id,
            &self.subject,
            &self.outcome,
            None,
        )
    }
    pub fn facts(&self) -> OpportunityFacts {
        OpportunityFacts {
            subject: self.subject.clone(),
            origin: self.outcome.origin,
            applicability: self.outcome.applicability,
            execution: self.outcome.execution,
            verdict: self.outcome.verdict,
            reason: self.outcome.reason,
        }
    }
}

// ---------------------------------------------------------------- lines

fn failure_words(failure: &EnumerationFailure) -> String {
    match failure {
        EnumerationFailure::RaggedRecord {
            record,
            fields,
            header,
        } => format!(
            "record {record} has {fields} fields where the header has {header}, so its columns would shift (an unquoted comma inside a value, for example 1,250.00, must be quoted)"
        ),
        EnumerationFailure::Empty => "the file is empty: it has no header record".into(),
        EnumerationFailure::HeaderMismatch { column } => format!(
            "the header row has no column exactly named \"{}\" (or more than one)",
            bounded(column, 128)
        ),
        EnumerationFailure::SheetMissing => "the workbook has no such sheet".into(),
        EnumerationFailure::Unsupported => {
            "the original is not a workbook, CSV or plain text that can be read row by row (a sheet is named only for a workbook)".into()
        }
        EnumerationFailure::Unreadable => {
            "the original could not be read (encrypted, corrupt, not UTF-8, or the trusted read failed or hit a limit)".into()
        }
    }
}

/// A count with its unit; on an incomplete population, a lower bound.
fn found(n: u64, unit: &str, complete: bool) -> String {
    let unit = if n == 1 {
        unit.to_string()
    } else {
        format!("{unit}s")
    };
    if complete {
        format!("{n} {unit}")
    } else {
        format!("at least {n} {unit}")
    }
}

/// How a population is said: never a count as a total when incomplete.
/// Rows are received; subjects (its unit) are resolved from rows.
pub fn population_line(record: &PopulationRecord) -> String {
    let c = &record.counts;
    let complete = record.completeness.complete();
    let unit = record.population.subject_unit.as_str();
    format!(
        "Population {} recorded as {} for basis {}: {} received ({} with no usable key, {} collapsed as exact duplicates), {} ({} out of period, {} with an unknown scope, {} in scope){}; {}{}; control count {}.",
        record.population.key,
        record.id,
        record.basis_id,
        found(c.received_rows, "row", complete),
        found(c.unkeyed, "row", complete),
        found(c.duplicate_rows, "row", complete),
        found(c.distinct_subjects, unit, complete),
        found(c.excluded_out_of_period, unit, complete),
        found(c.scope_unknown(), unit, complete),
        found(c.in_scope, unit, complete),
        if complete {
            ""
        } else {
            "; the total is not known"
        },
        record.completeness.as_str(),
        record
            .completeness
            .reason()
            .map(|r| format!(" ({})", r.as_str()))
            .unwrap_or_default(),
        match record.reconciliation {
            Reconciliation::Matched => "matched".to_string(),
            Reconciliation::NotDeclared => "not declared".to_string(),
            Reconciliation::Mismatch { declared, distinct } =>
                format!("{declared} declared, {distinct} subjects found"),
        }
    )
}
pub fn summary_line(record: &SummaryRecord) -> String {
    let m = &record.summary;
    let p = &m.partition;
    // A population summary over an incomplete population counts at least
    // these; a sample's selected items are known exactly.
    let exact = m.completeness.complete() || record.sample_id.is_some();
    let n = |v: u64| {
        if exact {
            v.to_string()
        } else {
            format!("at least {v}")
        }
    };
    format!(
        "Summary {} of population {}{}: conclusion {}; subjects failing {} · meeting every applicable criterion {} · unresolved {} · not applicable to any {}; failing opportunities {} (not records){}{}",
        record.id,
        record.population_id,
        record
            .sample_id
            .as_deref()
            .map(|s| format!(" over the selected items of sample {s}"))
            .unwrap_or_default(),
        m.conclusion.as_str(),
        n(p.failing),
        n(p.meets_every_applicable),
        n(p.unresolved),
        n(p.not_applicable_to_any),
        n(m.failing_opportunities),
        if exact {
            ""
        } else {
            "; the total is not known"
        },
        if m.limitations.is_empty() {
            ".".to_string()
        } else {
            format!(
                ". Limitations: {}",
                m.limitations
                    .iter()
                    .map(Limitation::words)
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        }
    )
}

// --------------------------------------------------------------- service

/// What the coverage steps carry between each other within one answer.
#[derive(Default)]
pub(super) struct AnswerCoverage {
    pub population: Option<PopulationRecord>,
    pub sample: Option<SampleRecord>,
    pub members: BTreeMap<String, Vec<MemberRecord>>,
}

/// The newest 24.1 judgment of a criterion for each subject under one basis
/// whose facts are all at the population's subject unit.
fn judgments_at_unit(
    evaluations: Vec<EvaluationRecord>,
    facts: &[FactRecord],
    unit: &str,
) -> BTreeMap<String, EvaluationRecord> {
    evaluations
        .into_iter()
        .filter(|e| e.outcome.origin == Origin::ModelProposal)
        .filter(|e| {
            let of: Vec<&FactRecord> = facts
                .iter()
                .filter(|f| f.fact.subject == e.subject)
                .collect();
            !of.is_empty() && of.iter().all(|f| f.fact.subject_unit == unit)
        })
        .map(|e| (e.subject.clone(), e))
        .collect()
}

impl<S, C> Assessment<'_, S, C>
where
    S: AssessmentStore
        + CoverageStore
        + super::revision::RevisionStore
        + super::exception::ExceptionStore,
    C: CitationReader,
{
    pub(super) async fn population_ref(
        &self,
        basis: &ClaimBasis,
        coverage: &AnswerCoverage,
        reference: &str,
    ) -> Result<Option<PopulationRecord>, ReadingError> {
        if let Some(found) = &coverage.population
            && (found.population.key == reference || found.id == reference)
        {
            return Ok(Some(found.clone()));
        }
        self.store.population(basis, reference).await
    }
    pub(super) async fn members_of(
        &self,
        basis: &ClaimBasis,
        coverage: &mut AnswerCoverage,
        population: &PopulationRecord,
    ) -> Result<Vec<MemberRecord>, ReadingError> {
        if !coverage.members.contains_key(&population.id) {
            let members = self.store.members(basis, &population.id).await?;
            coverage.members.insert(population.id.clone(), members);
        }
        Ok(coverage.members[&population.id].clone())
    }

    /// Step: the population manifest, read by trusted code.
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn coverage_population(
        &self,
        basis: &ClaimBasis,
        invocation: &Invocation,
        answer: &CitedAnswer,
        answer_basis: &Option<BasisRecord>,
        existing: &InvocationCoverage,
        coverage: &mut AnswerCoverage,
        feedback: &mut Vec<String>,
        cancellation: &ModelCancellation,
    ) -> Result<bool, ReadingError> {
        let Some(proposed) = answer.propose_population.first() else {
            return Ok(false);
        };
        if let Some(found) = existing.populations.first() {
            feedback.push(population_line(found));
            coverage.population = Some(found.clone());
            return Ok(false);
        }
        let key = &proposed.key;
        let target = match answer_basis
            .as_ref()
            .filter(|b| b.basis.key == proposed.basis || b.id == proposed.basis)
        {
            Some(found) => Some(found.clone()),
            None => self.store.basis_record(basis, &proposed.basis).await?,
        };
        let Some(target) = target else {
            feedback.push(format!(
                "Population {key} was not recorded: {} is not an assessment basis of this Task.",
                proposed.basis
            ));
            return Ok(false);
        };
        if let Some(previous) = &proposed.supersedes
            && self.store.population(basis, previous).await?.is_none()
        {
            feedback.push(format!(
                "Population {key} was not recorded: it supersedes {previous}, which is not a population of this Task."
            ));
            return Ok(false);
        }
        let Some(original) = self.reader.original(basis, &proposed.original_id).await? else {
            feedback.push(format!(
                "Population {key} was not recorded: {} is not a registered original you may read.",
                proposed.original_id
            ));
            return Ok(false);
        };
        // A cited control count must be verified at its exact location and be
        // the whole number there.
        let (control, declared) = match &proposed.control {
            None => (None, None),
            Some(count) => {
                let (verified, texts) = verify_sources(
                    self.reader,
                    basis,
                    std::slice::from_ref(&count.source),
                    cancellation,
                )
                .await?
                .remove(0);
                let whole = verified
                    .source
                    .locator
                    .as_ref()
                    .is_some_and(|l| whole_value(l, &texts, &count.source.quote));
                match (
                    verified.verification == Verification::Verified && whole,
                    count.parse(),
                ) {
                    (true, Some(n)) => (Some(verified), Some(n)),
                    _ => {
                        feedback.push(format!(
                            "Population {key} was not recorded: its control count \"{}\" was not verified as a whole number at {}. Cite the exact cell or bytes and quote the whole count, or leave it out.",
                            bounded(&count.source.quote, 64),
                            count.source.locator.as_ref().map_or("no location".into(), |l| l.render())
                        ));
                        return Ok(false);
                    }
                }
            }
        };
        let id = record_id("pop", &basis.task_id, &invocation.id, 0);
        let enumerated = self
            .reader
            .enumerate(basis, &original, &proposed.request(), cancellation)
            .await?;
        let job = enumerated
            .job_id
            .as_deref()
            .map(|j| format!(" (analysis job {j})"))
            .unwrap_or_default();
        let enumeration: Enumeration = match enumerated.outcome {
            // The read is of the header row the manifest names, or nothing.
            Ok(e) if e.header_row != proposed.header_row => {
                feedback.push(format!(
                    "Population {key} was not recorded: {}{job}. Nothing was counted; propose it again as a new request.",
                    failure_words(&EnumerationFailure::Unreadable)
                ));
                return Ok(false);
            }
            Ok(e) => e,
            Err(failure) => {
                feedback.push(format!(
                    "Population {key} was not recorded: {}{job}. Nothing was counted; propose it again as a new request.",
                    failure_words(&failure)
                ));
                return Ok(false);
            }
        };
        let (turn_binding, turn_epoch) = turn_basis(invocation);
        let members_built = build_members(
            proposed,
            &enumeration,
            target.basis.period_from,
            target.basis.period_to,
        );
        let pairs: Vec<(Option<&str>, Disposition)> = members_built
            .iter()
            .map(|m| (m.subject.as_deref(), m.disposition))
            .collect();
        let naive = naive_date_times(proposed, &members_built);
        let counts = PopulationCounts::of(&pairs);
        let (completeness, reconciliation) = completeness(
            proposed.exhaustive,
            &enumeration,
            declared,
            counts.distinct_subjects,
        );
        let spec = ProposedPopulation {
            basis: target.id.clone(),
            ..proposed.clone()
        };
        let members: Vec<MemberRecord> = members_built
            .into_iter()
            .map(|m| MemberRecord::new(&id, &spec, m))
            .collect();
        let mut record = PopulationRecord {
            id,
            task_id: basis.task_id.clone(),
            cycle_id: basis.cycle_id.clone(),
            invocation_id: invocation.id.clone(),
            ordinal: 0,
            methodology_binding_id: turn_binding,
            execution_epoch: turn_epoch,
            basis_id: target.id.clone(),
            population: spec,
            original_sha256: original.sha256.clone(),
            control,
            declared_count: declared,
            job_id: enumerated.job_id,
            last_row: enumeration.last_row,
            rows_read: enumeration.rows_read,
            truncated: enumeration.truncated,
            counts,
            completeness,
            reconciliation,
            naive_date_times: naive,
            digest: String::new(),
            recorded_us: None,
        };
        record.digest = document_digest(&record.document());
        match self.store.record_population(basis, &record, &members).await {
            Ok(stored) => {
                feedback.push(population_line(&stored));
                coverage.members.insert(stored.id.clone(), members);
                coverage.population = Some(stored);
                Ok(true)
            }
            Err(ReadingError::Invalid) => {
                feedback.push(format!(
                    "Population {key} was not recorded: the platform refused it as proposed."
                ));
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    /// Step: the sample manifest, checked against the in-scope subjects.
    pub(super) async fn coverage_sample(
        &self,
        basis: &ClaimBasis,
        invocation: &Invocation,
        answer: &CitedAnswer,
        existing: &InvocationCoverage,
        coverage: &mut AnswerCoverage,
        feedback: &mut Vec<String>,
    ) -> Result<bool, ReadingError> {
        let Some(proposed) = answer.propose_sample.first() else {
            return Ok(false);
        };
        if let Some(found) = existing.samples.first() {
            feedback.push(sample_line(found));
            coverage.sample = Some(found.clone());
            return Ok(false);
        }
        let key = &proposed.key;
        let Some(population) = self
            .population_ref(basis, coverage, &proposed.population)
            .await?
        else {
            feedback.push(format!(
                "Sample {key} was not recorded: {} is not a population of this Task.",
                proposed.population
            ));
            return Ok(false);
        };
        let members = self.members_of(basis, coverage, &population).await?;
        let in_scope: BTreeSet<String> = members
            .iter()
            .filter(|m| m.member.disposition == Disposition::InScope)
            .filter_map(|m| m.member.subject.clone())
            .collect();
        let selected = match check_sample(proposed, &in_scope) {
            Ok(selected) => selected,
            Err(refusal) => {
                feedback.push(format!(
                    "Sample {key} was not recorded: {}.",
                    match refusal {
                        SampleRefusal::NotInScope(k) => format!(
                            "{} is not an in-scope subject of population {}",
                            bounded(&k, 128),
                            population.id
                        ),
                        SampleRefusal::SelectionMismatch => format!(
                            "recomputing {} over the in-scope subjects in byte order gives other keys",
                            zobba_domain::coverage::SAMPLE_ALGORITHM
                        ),
                        SampleRefusal::SizeMismatch { size, in_scope } => format!(
                            "an all-in-scope sample has size {in_scope}, not {size}"
                        ),
                        SampleRefusal::SizeTooLarge { size, in_scope } => format!(
                            "a sample of {size} is larger than the {in_scope} in-scope subjects"
                        ),
                        SampleRefusal::Substitution(k) => format!(
                            "the substitution of {} does not replace a selected key with an in-scope one",
                            bounded(&k, 128)
                        ),
                    }
                ));
                return Ok(false);
            }
        };
        let (turn_binding, turn_epoch) = turn_basis(invocation);
        let mut record = SampleRecord {
            id: record_id("sample", &basis.task_id, &invocation.id, 0),
            task_id: basis.task_id.clone(),
            cycle_id: basis.cycle_id.clone(),
            invocation_id: invocation.id.clone(),
            ordinal: 0,
            methodology_binding_id: turn_binding,
            execution_epoch: turn_epoch,
            population_id: population.id.clone(),
            sample: ProposedSample {
                population: population.id.clone(),
                ..proposed.clone()
            },
            selected,
            digest: String::new(),
            recorded_us: None,
        };
        record.digest = document_digest(&record.document());
        match self.store.record_sample(basis, &record).await {
            Ok(stored) => {
                feedback.push(sample_line(&stored));
                coverage.sample = Some(stored);
                Ok(true)
            }
            Err(ReadingError::Invalid) => {
                feedback.push(format!(
                    "Sample {key} was not recorded: the platform refused it as proposed."
                ));
                Ok(false)
            }
            Err(error) => Err(error),
        }
    }

    /// Step: rule criteria evaluated over every in-scope member; judgment
    /// criteria use the 24.1 judgment at the population's subject unit.
    pub(super) async fn coverage_evaluate(
        &self,
        basis: &ClaimBasis,
        invocation: &Invocation,
        answer: &CitedAnswer,
        keys: &BTreeMap<String, CriterionRecord>,
        coverage: &mut AnswerCoverage,
        feedback: &mut Vec<String>,
    ) -> Result<bool, ReadingError> {
        let mut progress = false;
        for request in &answer.evaluate_population {
            let Some(criterion) = self
                .resolve_criterion(basis, keys, &request.criterion)
                .await?
            else {
                feedback.push(format!(
                    "{} was not evaluated over a population: it is not a criterion of this Task.",
                    request.criterion
                ));
                continue;
            };
            let Some(population) = self
                .population_ref(basis, coverage, &request.population)
                .await?
            else {
                feedback.push(format!(
                    "{} was not evaluated: {} is not a population of this Task.",
                    criterion.id, request.population
                ));
                continue;
            };
            let Some(target) = self.store.basis_record(basis, &population.basis_id).await? else {
                return Err(ReadingError::Unavailable);
            };
            if !target.basis.criteria.contains(&criterion.id) {
                feedback.push(format!(
                    "{} was not evaluated over population {}: its basis {} does not list it.",
                    criterion.id, population.id, target.id
                ));
                continue;
            }
            let recorded = self
                .store
                .opportunities(basis, &population.id, &criterion.id)
                .await?;
            if !recorded.is_empty() {
                feedback.push(format!(
                    "{} over population {} was already evaluated: {} opportunities are recorded; a judgment recorded later is counted only in a new population version.",
                    criterion.id,
                    population.id,
                    recorded.len()
                ));
                continue;
            }
            let members = self.members_of(basis, coverage, &population).await?;
            // Story 24.3a: a judgment is the current head of its chain, read
            // with the basis's effective facts (own and carried). A head that
            // is a later revision, or reads another basis version, is not a
            // 24.2 opportunity (an opportunity names a revision-1 judgment of
            // the population's own basis): such a subject stays not
            // evaluated here and is counted, never given its superseded
            // first verdict.
            let (judgments, revised) =
                if criterion.criterion.method.kind() == CriterionKind::Judgment {
                    let heads = self.store.heads(basis, &target.id, &criterion.id).await?;
                    let facts = self.store.effective_facts(basis, &target.id).await?;
                    let mut revised = BTreeSet::new();
                    let current: Vec<EvaluationRecord> = heads
                        .into_iter()
                        .filter_map(|h| {
                            if h.head.is_some() || h.first.basis_id != target.id {
                                revised.insert(h.first.subject.clone());
                                None
                            } else {
                                Some(h.first)
                            }
                        })
                        .collect();
                    (
                        judgments_at_unit(current, &facts, &population.population.subject_unit),
                        revised,
                    )
                } else {
                    (BTreeMap::new(), BTreeSet::new())
                };
            let revised = members
                .iter()
                .filter(|m| m.member.disposition == Disposition::InScope)
                .filter(|m| {
                    m.member
                        .subject
                        .as_ref()
                        .is_some_and(|s| revised.contains(s))
                })
                .count();
            if revised > 0 {
                feedback.push(format!(
                    "{} over population {}: {revised} subjects' judgments were revised or read another basis version; they are counted here as not evaluated, never with a superseded verdict.",
                    criterion.id, population.id
                ));
            }
            let mut records = Vec::new();
            for m in members
                .iter()
                .filter(|m| m.member.disposition == Disposition::InScope)
            {
                let Some(subject) = m.member.subject.clone() else {
                    continue;
                };
                let facts = m
                    .member
                    .facts(&population.id, &m.digest, &population.population);
                let mut outcome = evaluate(
                    &criterion.criterion,
                    &context_for(&target, &criterion, &facts),
                );
                let mut evaluation_id = None;
                let mut digest =
                    output_digest(&population.id, &criterion.id, &subject, &outcome, None);
                // A judgment criterion that applies uses the newest 24.1
                // judgment for this subject at the population's unit, or
                // stays not evaluated. The model never judges here.
                if criterion.criterion.method.kind() == CriterionKind::Judgment
                    && outcome.applicability == Applicability::Applicable
                    && outcome.verdict.is_none()
                    && outcome.execution == Execution::Completed
                    && let Some(judgment) = judgments.get(&subject)
                {
                    outcome = judgment.outcome.clone();
                    evaluation_id = Some(judgment.id.clone());
                    digest = judgment.output_digest.clone();
                }
                records.push(OpportunityRecord {
                    population_id: population.id.clone(),
                    criterion_id: criterion.id.clone(),
                    member_ordinal: m.member.ordinal,
                    subject,
                    invocation_id: invocation.id.clone(),
                    outcome,
                    output_digest: digest,
                    evaluation_id,
                });
            }
            match self.store.record_opportunities(basis, &records).await {
                Ok(()) => {
                    progress = true;
                    feedback.push(opportunities_line(
                        &criterion.id,
                        &population.id,
                        population.completeness.complete(),
                        &records,
                    ));
                }
                Err(ReadingError::Invalid) => feedback.push(format!(
                    "{} over population {} was not recorded: the platform refused it as proposed.",
                    criterion.id, population.id
                )),
                Err(error) => return Err(error),
            }
        }
        Ok(progress)
    }

    /// Step: coverage summaries, computed by the pure summarise.
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn coverage_summarise(
        &self,
        basis: &ClaimBasis,
        invocation: &Invocation,
        answer: &CitedAnswer,
        answer_basis: &Option<BasisRecord>,
        existing: &InvocationCoverage,
        coverage: &mut AnswerCoverage,
        feedback: &mut Vec<String>,
    ) -> Result<bool, ReadingError> {
        let mut progress = false;
        for (ordinal, request) in answer.summarise.iter().enumerate() {
            let ordinal = ordinal as u32;
            if let Some(found) = existing.summaries.iter().find(|s| s.ordinal == ordinal) {
                feedback.push(summary_line(found));
                continue;
            }
            let Some(population) = self
                .population_ref(basis, coverage, &request.population)
                .await?
            else {
                feedback.push(format!(
                    "No summary of {} was recorded: it is not a population of this Task.",
                    request.population
                ));
                continue;
            };
            let basis_matches = population.basis_id == request.basis
                || answer_basis
                    .as_ref()
                    .is_some_and(|b| b.id == population.basis_id && b.basis.key == request.basis);
            if !basis_matches {
                feedback.push(format!(
                    "No summary of population {} was recorded: it belongs to basis {}, not {}.",
                    population.id, population.basis_id, request.basis
                ));
                continue;
            }
            let sample = match &request.sample {
                None => None,
                Some(reference) => {
                    let found = match &coverage.sample {
                        Some(s) if s.sample.key == *reference || s.id == *reference => {
                            Some(s.clone())
                        }
                        _ => self.store.sample(basis, reference).await?,
                    };
                    match found.filter(|s| s.population_id == population.id) {
                        Some(s) => Some(s),
                        None => {
                            feedback.push(format!(
                                "No summary of population {} was recorded: {reference} is not one of its samples.",
                                population.id
                            ));
                            continue;
                        }
                    }
                }
            };
            if let Some(found) = self
                .store
                .summary_for(
                    basis,
                    &population.id,
                    sample.as_ref().map(|s| s.id.as_str()),
                )
                .await?
            {
                feedback.push(format!("{} It was already recorded.", summary_line(&found)));
                continue;
            }
            let Some(target) = self.store.basis_record(basis, &population.basis_id).await? else {
                return Err(ReadingError::Unavailable);
            };
            let members = self.members_of(basis, coverage, &population).await?;
            let in_scope: BTreeSet<String> = members
                .iter()
                .filter(|m| m.member.disposition == Disposition::InScope)
                .filter_map(|m| m.member.subject.clone())
                .collect();
            let criteria = self.store.criteria(basis, &target.basis.criteria).await?;
            let mut opportunities = Vec::new();
            let mut missing = Vec::new();
            for id in &target.basis.criteria {
                let Some(criterion) = criteria.iter().find(|c| &c.id == id) else {
                    return Err(ReadingError::Unavailable);
                };
                let recorded = self.store.opportunities(basis, &population.id, id).await?;
                if recorded.len() as u64 != population.counts.in_scope {
                    missing.push(id.clone());
                }
                opportunities.push(CriterionOpportunities {
                    criterion_id: id.clone(),
                    judgment: criterion.criterion.method.kind() == CriterionKind::Judgment,
                    opportunities: recorded.iter().map(OpportunityRecord::facts).collect(),
                });
            }
            if !missing.is_empty() {
                feedback.push(format!(
                    "No summary of population {} was recorded: {} {} not yet evaluated over it. Ask evaluate_population for each criterion of its basis first.",
                    population.id,
                    missing.join(", "),
                    if missing.len() == 1 { "is" } else { "are" }
                ));
                continue;
            }
            let selected: Option<BTreeSet<String>> = sample
                .as_ref()
                .map(|s| s.selected.iter().cloned().collect());
            let summary = summarise(
                &population.facts(),
                &in_scope,
                &opportunities,
                selected.as_ref(),
            );
            let (turn_binding, turn_epoch) = turn_basis(invocation);
            let mut record = SummaryRecord {
                id: record_id("summary", &basis.task_id, &invocation.id, ordinal),
                task_id: basis.task_id.clone(),
                cycle_id: basis.cycle_id.clone(),
                invocation_id: invocation.id.clone(),
                ordinal,
                methodology_binding_id: turn_binding,
                execution_epoch: turn_epoch,
                basis_id: population.basis_id.clone(),
                population_id: population.id.clone(),
                sample_id: sample.map(|s| s.id),
                summary_digest: summary.digest(),
                summary,
                digest: String::new(),
                recorded_us: None,
            };
            record.digest = document_digest(&record.document());
            match self.store.record_summary(basis, &record).await {
                Ok(stored) => {
                    progress = true;
                    feedback.push(summary_line(&stored));
                }
                Err(ReadingError::Invalid) => feedback.push(format!(
                    "No summary of population {} was recorded: the platform refused it as proposed.",
                    population.id
                )),
                Err(error) => return Err(error),
            }
        }
        Ok(progress)
    }
}

pub fn sample_line(record: &SampleRecord) -> String {
    format!(
        "Sample {} recorded as {} of population {}: {} · {} selected items{}; a sample says nothing about the items it did not select.",
        record.sample.key,
        record.id,
        record.population_id,
        record.sample.method.kind().as_str(),
        record.selected.len(),
        record
            .sample
            .method
            .seed()
            .map(|seed| format!(
                " (seed {seed}, {})",
                zobba_domain::coverage::SAMPLE_ALGORITHM
            ))
            .unwrap_or_default()
    )
}

fn opportunities_line(
    criterion: &str,
    population: &str,
    complete: bool,
    records: &[OpportunityRecord],
) -> String {
    let at = if complete { "" } else { "at least " };
    let count = |f: &dyn Fn(&Outcome) -> bool| {
        format!("{at}{}", records.iter().filter(|r| f(&r.outcome)).count())
    };
    format!(
        "{criterion} evaluated over population {population}: {at}{} opportunities · applicable {} · not applicable {} · applicability unknown {} · met {} · not met {} · undetermined {} · execution failed {} · not evaluated {}{}.",
        records.len(),
        count(&|o| o.applicability == Applicability::Applicable),
        count(&|o| o.applicability == Applicability::NotApplicable),
        count(&|o| o.applicability == Applicability::Unknown),
        count(&|o| o.verdict == Some(Verdict::Met)),
        count(&|o| o.verdict == Some(Verdict::NotMet)),
        count(&|o| o.applicability == Applicability::Applicable
            && o.verdict == Some(Verdict::Undetermined)),
        count(&|o| o.applicability == Applicability::Applicable && o.execution == Execution::Failed),
        count(&|o| o.applicability == Applicability::Applicable
            && o.execution == Execution::Completed
            && o.verdict.is_none()),
        if complete {
            ""
        } else {
            "; the population is incomplete, so the total is not known"
        },
    )
}

/// The outline's coverage lines (exact counts, bounded).
pub fn coverage_lines(snapshot: &CoverageSnapshot) -> Vec<String> {
    let mut lines = Vec::new();
    for p in snapshot.populations.iter().take(MAX_OUTLINE_COVERAGE) {
        lines.push(format!(
            "- population {} of basis {} · original {} · unit {} · grain {} · {}",
            p.id,
            p.basis_id,
            p.population.original_id,
            p.population.subject_unit,
            p.population.grain.join(" + "),
            bounded(&population_line(p), 600)
        ));
    }
    for s in snapshot.samples.iter().take(MAX_OUTLINE_COVERAGE) {
        lines.push(format!("- {}", sample_line(s)));
    }
    for s in snapshot.summaries.iter().take(MAX_OUTLINE_COVERAGE) {
        lines.push(format!("- {}", summary_line(s)));
    }
    // One line per record: the outline counts the records it lists and says
    // exactly how many of every kind are not listed.
    lines
}
