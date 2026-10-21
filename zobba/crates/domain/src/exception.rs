//! Story 24.3b: Task-scoped exceptions and the effective summary.
//!
//! Every `not_met` result (a 24.1 evaluation, a 24.3a revision, a 24.2
//! opportunity, or a person's `replaced not_met` disposition) adds one
//! immutable **occurrence** to the Task-scoped **exception** of its
//! criterion lineage and subject. An exception's status is never stored: it
//! is derived here, by pure trusted code, from its occurrences, the current
//! observations of its criterion lineage and subject, and the exception
//! dispositions people saved:
//!
//! - `closed_by_disposition`: an Audit manager or the Task's accountable
//!   person closed it with evidence, and no occurrence is newer than that;
//! - `replaced_by_human_judgment`: the latest observation is a person's
//!   verdict that is not `not_met`;
//! - `resolved_by_evidence`: the latest observation meets the criterion,
//!   completed, from new evidence (a revision caused by changed inputs or a
//!   revised basis, or a later population read of the same criterion) that
//!   differs from the failing occurrence's;
//! - `open` otherwise. A latest observation that is not `not_met` and does
//!   not resolve the exception (undetermined, failed, not applicable, absent
//!   from a later population, not yet evaluated) keeps it open and says so:
//!   it is not evidence of remediation.
//!
//! A failing count never drops because a later read did not observe it, and
//! there is no waiver, no numeric confidence and no percentage anywhere.
use std::collections::{BTreeMap, BTreeSet};

use crate::{
    assessment::{Execution, Origin, Verdict, text_ok, valid_subject},
    citation::{CitationSource, Locator, MAX_LOCATOR_BYTES, MAX_QUOTE_BYTES},
    context::canonical_json,
    coverage::{
        Conclusion, CriterionOpportunities, OpportunityFacts, PopulationFacts, Summary,
        SummaryRequest, summarise,
    },
    identity::valid_scope_id,
    model::{ArgumentSchema, JsonValue},
    revision::{
        EffectiveOrigin, MAX_DISPOSITION_RATIONALE_BYTES, MAX_DISPOSITION_REFERENCES, ReviewState,
        RevisionCause,
    },
    work::sha256_hex,
};

/// The one exception kind of Story 24.3b.
pub const EXCEPTION_KIND: &str = "criterion_not_met";
/// The effective summary's aggregation rule.
pub const EFFECTIVE_AGGREGATION: &str = "effective_partition_v1";
/// Exceptions an effective summary lists (the exact total is beside them).
pub const MAX_LISTED_EXCEPTIONS: usize = 50;
/// Exception dispositions one exception may hold (the latest is effective).
pub const MAX_EXCEPTION_DISPOSITIONS: usize = 16;
/// `summarise_effective` entries one answer may make.
pub const MAX_SUMMARISE_EFFECTIVE: usize = 2;
/// Occurrences one page of an exception's detail lists.
pub const OCCURRENCE_PAGE: usize = 50;
/// The sentence an open exception carries when its latest observation does
/// not show it failing.
pub const NOT_REMEDIATION: &str =
    "not observed in the latest revision; this is not evidence of remediation";
/// The sentence an open exception carries when an unreviewed model proposal
/// would resolve it once a person accepts it (owner decision 2026-10-21).
pub const PROPOSED_MET: &str = "a model proposal suggests this is met; awaiting human review";
/// The sentence an open exception carries when a person replaced the
/// failing judgment with `undetermined` (owner decision 2026-10-21).
pub const PERSON_UNDETERMINED: &str =
    "a person marked this undetermined; this is not evidence of remediation";

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

// The derived status of an exception. Never stored.
vocabulary!(ExceptionStatus {
    Open => "open",
    ResolvedByEvidence => "resolved_by_evidence",
    ReplacedByHumanJudgment => "replaced_by_human_judgment",
    ClosedByDisposition => "closed_by_disposition",
});

// What the current observations show: `not_met` while any of them fails;
// otherwise what the latest one shows when it does not resolve the
// exception.
vocabulary!(LatestObserved {
    NotMet => "not_met",
    NotObserved => "not_observed",
    ProposedMet => "proposed_met",
    PersonUndetermined => "person_undetermined",
});

// Which record an occurrence is.
vocabulary!(OccurrenceSource {
    Evaluation => "evaluation",
    Revision => "revision",
    Opportunity => "opportunity",
    Disposition => "disposition",
});

// One current observation of an exception's criterion lineage and subject.
vocabulary!(ObservationKind {
    // The head of an evaluation chain, under its newest disposition.
    Chain => "chain",
    // A rule opportunity of the latest version of a population lineage.
    Opportunity => "opportunity",
    // The latest version of a population lineage that observed the subject
    // before no longer holds it in scope.
    Absent => "absent",
});

// What an Audit manager or the Task's accountable person decided.
vocabulary!(ExceptionDispositionKind {
    Closed => "closed",
    Reopened => "reopened",
});

// A closed limitation of an effective summary, said in words.
vocabulary!(EffectiveLimitationCode {
    PopulationIncomplete => "population_incomplete",
    UnresolvedSubjects => "unresolved_subjects",
    PendingReconsideration => "pending_reconsideration",
    UnreviewedModelProposals => "unreviewed_model_proposals",
    SupersededInputsNotReevaluated => "superseded_inputs_not_reevaluated",
    OpenExceptions => "open_exceptions",
    SampleOnly => "sample_only",
});

/// An exception ID: `exc-` and 40 lowercase hex digits.
pub fn valid_exception_id(id: &str) -> bool {
    id.strip_prefix("exc-").is_some_and(|rest| {
        rest.len() == 40 && rest.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    })
}

/// The exception of a criterion lineage and a subject in one Task. The
/// database derives the same ID: every part but the subject is free of `|`
/// (scope IDs), and the subject is last, so the join is unambiguous.
pub fn exception_id(
    organisation: &str,
    client: &str,
    engagement: &str,
    task: &str,
    criterion_root: &str,
    subject: &str,
) -> String {
    let joined = [
        "exc",
        organisation,
        client,
        engagement,
        task,
        criterion_root,
        EXCEPTION_KIND,
        subject,
    ]
    .join("|");
    format!("exc-{}", &sha256_hex(joined.as_bytes())[..40])
}

// ------------------------------------------------------------- status

/// One current observation, as status derivation reads it. Every list of
/// digests is sorted and distinct (the evidence an outcome read).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Observation {
    pub kind: ObservationKind,
    /// The observed record (head, opportunity or population) ID; the second
    /// key of the observation order, in byte order.
    pub id: String,
    /// Database time of the observed result itself: a chain head's own
    /// record time (a disposition never makes an older result newer), a
    /// person's `replaced` verdict at its own time (it really is new), an
    /// opportunity's or a population version's record time.
    pub at_us: i64,
    pub verdict: Option<Verdict>,
    /// None for an absent observation.
    pub execution: Option<Execution>,
    pub origin: Option<EffectiveOrigin>,
    /// A chain head's review state (`accepted` only when its newest
    /// disposition is an acceptance); `unreviewed` otherwise.
    pub review: ReviewState,
    /// A chain head's closed causes (none for revision 1).
    pub causes: Vec<RevisionCause>,
    pub criterion_id: Option<String>,
    pub evidence: Vec<String>,
}

/// One occurrence of an exception, as status derivation reads it: its place
/// in the exception's order (`seq`, commit order under the Task's exception
/// lock), its database time, criterion version and evidence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Occurrence {
    pub seq: i64,
    pub at_us: i64,
    pub criterion_id: String,
    pub evidence: Vec<String>,
}

/// Everything an exception's status is derived from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExceptionFacts {
    /// Every occurrence of the exception (at least one).
    pub occurrences: Vec<Occurrence>,
    /// The newest exception disposition and its place in the order.
    pub decision: Option<(ExceptionDispositionKind, i64)>,
    pub observations: Vec<Observation>,
}

/// The latest observation: the greatest (time, ID) in byte order.
pub fn latest_observation(observations: &[Observation]) -> Option<&Observation> {
    observations
        .iter()
        .max_by(|a, b| (a.at_us, a.id.as_bytes()).cmp(&(b.at_us, b.id.as_bytes())))
}

/// The newest occurrence (by its place in the order).
pub fn newest_occurrence(occurrences: &[Occurrence]) -> Option<&Occurrence> {
    occurrences.iter().max_by_key(|o| o.seq)
}

/// Whether a closure saved at `closed_at` (a place in the order) still
/// stands: no later occurrence is one the closer did not see, i.e. one whose
/// criterion version and evidence differ from every occurrence before the
/// closure. The same failure read again over identical evidence does not
/// reopen it; a new failure does.
pub fn closure_stands(occurrences: &[Occurrence], closed_at: i64) -> bool {
    occurrences
        .iter()
        .filter(|o| o.seq > closed_at)
        .all(|later| {
            occurrences.iter().any(|seen| {
                seen.seq < closed_at
                    && seen.criterion_id == later.criterion_id
                    && seen.evidence == later.evidence
            })
        })
}

/// Whether an observation would be new evidence that the criterion is met,
/// apart from review: a completed `met` that is not a person's verdict, newer
/// than the failing occurrence, reading different evidence, and either a
/// revision caused by changed inputs or a revised basis, or a later read of
/// the same criterion version.
pub fn would_resolve(observation: &Observation, failing: &Occurrence) -> bool {
    observation.verdict == Some(Verdict::Met)
        && observation.execution == Some(Execution::Completed)
        && matches!(
            observation.origin,
            Some(EffectiveOrigin::Deterministic | EffectiveOrigin::ModelProposal)
        )
        && observation.at_us > failing.at_us
        && observation.evidence != failing.evidence
        && match observation.kind {
            ObservationKind::Chain => observation.causes.iter().any(|c| {
                matches!(
                    c,
                    RevisionCause::InputsChanged | RevisionCause::BasisRevised
                )
            }),
            ObservationKind::Opportunity => {
                observation.criterion_id.as_deref() == Some(failing.criterion_id.as_str())
            }
            ObservationKind::Absent => false,
        }
}

/// Whether an observation is new evidence that resolves the exception: it
/// would resolve it, and it is a deterministic result or a model proposal a
/// person accepted (owner decision 2026-10-21: an unreviewed model proposal
/// never resolves an exception).
pub fn resolves(observation: &Observation, failing: &Occurrence) -> bool {
    would_resolve(observation, failing)
        && (observation.origin == Some(EffectiveOrigin::Deterministic)
            || observation.review == ReviewState::Accepted)
}

/// The derived status and what the latest observation shows:
/// 1. `closed_by_disposition` while the newest exception disposition is a
///    closure that still stands ([`closure_stands`]);
/// 2. `open` (latest observed `not_met`) while any current observation is
///    `not_met`: a failure still observed is never hidden by another one;
/// 3. `replaced_by_human_judgment` when the latest observation is a
///    person's `met` (owner decision 2026-10-21: a person's `undetermined` is
///    not evidence of remediation);
/// 4. `resolved_by_evidence` when it [`resolves`] the newest occurrence;
/// 5. `open` otherwise: `proposed_met` when an unreviewed model proposal
///    would resolve it once accepted, `person_undetermined` for a person's
///    undetermined, `not_observed` for everything else.
pub fn exception_status(facts: &ExceptionFacts) -> (ExceptionStatus, LatestObserved) {
    let failing = facts
        .observations
        .iter()
        .any(|o| o.verdict == Some(Verdict::NotMet));
    let latest = latest_observation(&facts.observations);
    let newest = newest_occurrence(&facts.occurrences);
    let meets = match (latest, newest) {
        (Some(l), Some(o)) => would_resolve(l, o),
        _ => false,
    };
    let observed = match latest {
        _ if failing => LatestObserved::NotMet,
        None => LatestObserved::NotObserved,
        Some(l)
            if l.origin == Some(EffectiveOrigin::Human)
                && l.verdict == Some(Verdict::Undetermined) =>
        {
            LatestObserved::PersonUndetermined
        }
        Some(l)
            if meets
                && l.origin == Some(EffectiveOrigin::ModelProposal)
                && l.review != ReviewState::Accepted =>
        {
            LatestObserved::ProposedMet
        }
        Some(_) => LatestObserved::NotObserved,
    };
    if let Some((ExceptionDispositionKind::Closed, at)) = facts.decision
        && closure_stands(&facts.occurrences, at)
    {
        return (ExceptionStatus::ClosedByDisposition, observed);
    }
    let Some(l) = latest else {
        return (ExceptionStatus::Open, observed);
    };
    if failing {
        return (ExceptionStatus::Open, observed);
    }
    if l.origin == Some(EffectiveOrigin::Human) && l.verdict == Some(Verdict::Met) {
        return (ExceptionStatus::ReplacedByHumanJudgment, observed);
    }
    if meets
        && (l.origin == Some(EffectiveOrigin::Deterministic) || l.review == ReviewState::Accepted)
    {
        return (ExceptionStatus::ResolvedByEvidence, observed);
    }
    (ExceptionStatus::Open, observed)
}

/// The status in words. An open exception the latest observation does not
/// show failing says that this is not evidence of remediation.
pub fn status_words(status: ExceptionStatus, latest: LatestObserved) -> String {
    match (status, latest) {
        (ExceptionStatus::Open, LatestObserved::NotMet) => {
            "Open: a current observation does not meet the criterion.".into()
        }
        (ExceptionStatus::Open, LatestObserved::NotObserved) => {
            format!("Open: {NOT_REMEDIATION}.")
        }
        (ExceptionStatus::Open, LatestObserved::ProposedMet) => {
            format!("Open: {PROPOSED_MET}.")
        }
        (ExceptionStatus::Open, LatestObserved::PersonUndetermined) => {
            format!("Open: {PERSON_UNDETERMINED}.")
        }
        (ExceptionStatus::ResolvedByEvidence, _) => {
            "Resolved by evidence: a later evaluation of new evidence meets the criterion.".into()
        }
        (ExceptionStatus::ReplacedByHumanJudgment, _) => {
            "Replaced by human judgment: a person's verdict that the criterion is met replaces the failing judgment.".into()
        }
        (ExceptionStatus::ClosedByDisposition, _) => {
            "Closed by a disposition with evidence; a later failing observation on new evidence reopens it.".into()
        }
    }
}

// ------------------------------------------------------- dispositions

/// A person's disposition of one exception, as requested.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExceptionDispositionRequest {
    /// Session-bound request key, idempotent per actor.
    pub key: String,
    pub exception_id: String,
    pub kind: ExceptionDispositionKind,
    /// 1–2,000 bytes of the person's words (attributed data).
    pub rationale: String,
    /// 0–8 evidence references, each verified at write time; `closed` names
    /// at least one.
    pub references: Vec<CitationSource>,
}

/// Why an exception disposition is refused before anything is written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExceptionRefusal {
    /// Malformed (shape, bounds, vocabulary), or a closure without evidence.
    Invalid,
    /// `closed` on an exception that is already closed.
    AlreadyClosed,
    /// `reopened` on an exception that is not closed.
    NotClosed,
}

impl ExceptionDispositionRequest {
    /// The structural rules the database also enforces.
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && valid_exception_id(&self.exception_id)
            && !self.rationale.trim().is_empty()
            && text_ok(&self.rationale, MAX_DISPOSITION_RATIONALE_BYTES)
            && self.references.len() <= MAX_DISPOSITION_REFERENCES
            && (self.kind != ExceptionDispositionKind::Closed || !self.references.is_empty())
            && self.references.iter().all(|r| {
                valid_scope_id(&r.original_id)
                    && !r.quote.trim().is_empty()
                    && text_ok(&r.quote, MAX_QUOTE_BYTES)
                    && r.locator
                        .as_ref()
                        .is_some_and(|l| l.render().len() <= MAX_LOCATOR_BYTES)
            })
            && self
                .references
                .iter()
                .enumerate()
                .all(|(i, r)| !self.references[..i].contains(r))
    }
    /// Whether this disposition may be saved on an exception of `status`:
    /// close one that is not closed, reopen one that is.
    pub fn check(&self, status: ExceptionStatus) -> Result<(), ExceptionRefusal> {
        if !self.is_valid() {
            return Err(ExceptionRefusal::Invalid);
        }
        let closed = status == ExceptionStatus::ClosedByDisposition;
        match self.kind {
            ExceptionDispositionKind::Closed if closed => Err(ExceptionRefusal::AlreadyClosed),
            ExceptionDispositionKind::Reopened if !closed => Err(ExceptionRefusal::NotClosed),
            _ => Ok(()),
        }
    }
}

fn s(value: &str) -> JsonValue {
    JsonValue::String(value.into())
}
fn int(value: u64) -> JsonValue {
    JsonValue::Integer(value.min(i64::MAX as u64) as i64)
}
fn object(fields: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(fields.into_iter().map(|(k, v)| (k.into(), v)).collect())
}

/// The canonical document of a stored exception disposition.
pub fn exception_disposition_document(
    id: &str,
    task_id: &str,
    actor_id: &str,
    request: &ExceptionDispositionRequest,
    references: &[(CitationSource, String)],
) -> JsonValue {
    object(vec![
        ("record", s("exception_disposition")),
        ("id", s(id)),
        ("task_id", s(task_id)),
        ("actor_id", s(actor_id)),
        ("key", s(&request.key)),
        ("exception_id", s(&request.exception_id)),
        ("kind", s(request.kind.as_str())),
        ("rationale", s(&request.rationale)),
        (
            "references",
            JsonValue::Array(
                references
                    .iter()
                    .map(|(source, sha)| {
                        object(vec![
                            ("original_id", s(&source.original_id)),
                            (
                                "locator",
                                source
                                    .locator
                                    .as_ref()
                                    .map_or(JsonValue::Null, |l| s(&l.render())),
                            ),
                            ("quote", s(&source.quote)),
                            ("original_sha256", s(sha)),
                            ("verification", s("verified")),
                        ])
                    })
                    .collect(),
            ),
        ),
    ])
}

/// Decode a stored exception disposition document.
pub fn exception_disposition_from(
    document: &JsonValue,
) -> Option<(ExceptionDispositionRequest, Vec<(CitationSource, String)>)> {
    let JsonValue::Object(map) = document else {
        return None;
    };
    let text = |key: &str| match map.get(key)? {
        JsonValue::String(v) => Some(v.clone()),
        _ => None,
    };
    let references = match map.get("references")? {
        JsonValue::Array(items) => items
            .iter()
            .map(|item| {
                let JsonValue::Object(r) = item else {
                    return None;
                };
                let get = |key: &str| match r.get(key)? {
                    JsonValue::String(v) => Some(v.clone()),
                    _ => None,
                };
                (get("verification")? == "verified").then_some(())?;
                Some((
                    CitationSource {
                        original_id: get("original_id")?,
                        locator: Locator::parse(&get("locator")?),
                        quote: get("quote")?,
                    },
                    get("original_sha256")?,
                ))
            })
            .collect::<Option<Vec<_>>>()?,
        _ => return None,
    };
    let request = ExceptionDispositionRequest {
        key: text("key")?,
        exception_id: text("exception_id")?,
        kind: ExceptionDispositionKind::parse(&text("kind")?)?,
        rationale: text("rationale")?,
        references: references.iter().map(|(r, _)| r.clone()).collect(),
    };
    request.is_valid().then_some((request, references))
}

// ------------------------------------------------------ effective summary

/// One opportunity as the effective summary reads it: its effective outcome
/// (a judgment opportunity resolves to its chain head under the head's
/// newest disposition; a rule opportunity is itself), the head's review
/// state, and whether the head reads a basis version a later one supersedes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectiveOpportunity {
    pub subject: String,
    pub verdict: Option<Verdict>,
    pub applicability: crate::assessment::Applicability,
    pub execution: Execution,
    pub reason: Option<crate::assessment::EvaluationReason>,
    pub origin: EffectiveOrigin,
    pub review: ReviewState,
    pub superseded: bool,
}
impl EffectiveOpportunity {
    /// The 24.2 summary's reading of it. A person's verdict is not an
    /// unreviewed model proposal, so it is counted as a decided verdict.
    pub fn facts(&self) -> OpportunityFacts {
        OpportunityFacts {
            subject: self.subject.clone(),
            origin: match self.origin {
                EffectiveOrigin::ModelProposal => Origin::ModelProposal,
                EffectiveOrigin::Deterministic | EffectiveOrigin::Human => Origin::Deterministic,
            },
            applicability: self.applicability,
            execution: self.execution,
            verdict: self.verdict,
            reason: self.reason,
        }
    }
}

/// One criterion of the summary's basis and its effective opportunities.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectiveCriterion {
    pub criterion_id: String,
    pub judgment: bool,
    pub opportunities: Vec<EffectiveOpportunity>,
}

/// Exact counts per criterion that the 24.2 summary does not carry.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct EffectiveCounts {
    pub criterion_id: String,
    /// A person's verdict replaces a model proposal.
    pub human_replaced: u64,
    /// The head's newest disposition asks for reconsideration.
    pub pending_reconsideration: u64,
    /// A model proposal with no disposition at all.
    pub undisposed: u64,
    /// The head reads a basis version that a later one supersedes.
    pub superseded: u64,
}

/// One exception with its derived status.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExceptionEntry {
    pub id: String,
    pub subject: String,
    pub criterion_root: String,
    pub status: ExceptionStatus,
    pub latest_observed: LatestObserved,
}

/// Exact exception counts by derived status, and distinct subjects.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ExceptionCounts {
    pub total: u64,
    pub open: u64,
    pub resolved_by_evidence: u64,
    pub replaced_by_human_judgment: u64,
    pub closed_by_disposition: u64,
    pub subjects: u64,
}
impl ExceptionCounts {
    pub fn of(entries: &[ExceptionEntry]) -> Self {
        let mut counts = Self {
            total: entries.len() as u64,
            ..Self::default()
        };
        for e in entries {
            match e.status {
                ExceptionStatus::Open => counts.open += 1,
                ExceptionStatus::ResolvedByEvidence => counts.resolved_by_evidence += 1,
                ExceptionStatus::ReplacedByHumanJudgment => counts.replaced_by_human_judgment += 1,
                ExceptionStatus::ClosedByDisposition => counts.closed_by_disposition += 1,
            }
        }
        counts.subjects = entries
            .iter()
            .map(|e| e.subject.as_str())
            .collect::<BTreeSet<_>>()
            .len() as u64;
        counts
    }
    pub fn is_consistent(&self) -> bool {
        self.open
            + self.resolved_by_evidence
            + self.replaced_by_human_judgment
            + self.closed_by_disposition
            == self.total
            && self.subjects <= self.total
    }
}

/// One closed limitation of an effective summary with its exact count.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EffectiveLimitation {
    pub code: EffectiveLimitationCode,
    pub count: Option<u64>,
}
impl EffectiveLimitation {
    /// The sentence the auditor and the agent read. `exact` is false for a
    /// population summary over an incomplete population: its counts are
    /// lower bounds.
    pub fn words(&self, exact: bool) -> String {
        let n = self.count.unwrap_or(0);
        let at = if exact { "" } else { "at least " };
        match self.code {
            EffectiveLimitationCode::PopulationIncomplete => "The population is incomplete: every count is at least the number shown, and the total is not known.".into(),
            EffectiveLimitationCode::UnresolvedSubjects => format!(
                "{at}{n} subjects are unresolved: no conclusion covers them."
            ),
            EffectiveLimitationCode::PendingReconsideration => format!(
                "{at}{n} evaluations wait for a reconsideration a person asked for; their verdicts stand until it is answered."
            ),
            EffectiveLimitationCode::UnreviewedModelProposals => format!(
                "{at}{n} model proposals have no disposition: nobody has reviewed them."
            ),
            EffectiveLimitationCode::SupersededInputsNotReevaluated => format!(
                "{at}{n} evaluations read a basis version that a later version supersedes; they were not evaluated again."
            ),
            EffectiveLimitationCode::OpenExceptions => format!(
                "{at}{n} exceptions of these subjects are open: while one is open, no summary concludes that no exception exists."
            ),
            EffectiveLimitationCode::SampleOnly => format!(
                "A sample of {n} selected items: the counts describe the selected items only, never the population."
            ),
        }
    }
}

/// The effective summary: the 24.2 partition over effective outcomes, the
/// counts the 24.2 summary does not carry, the exceptions of its own
/// subjects (the population's in-scope subjects, or the sample's selected
/// ones) under the basis's criterion lineages by derived status (the first
/// 50 listed, with the exact total), its effective conclusion and closed
/// limitations in words. Its denominators are the 24.2 ones: the same
/// population (or sample) subjects.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectiveSummary {
    pub summary: Summary,
    /// The 24.2 conclusion of the partition, except that it is never
    /// `no_exception_found` while one of its subjects' exceptions is open.
    pub conclusion: Conclusion,
    pub criteria: Vec<EffectiveCounts>,
    pub exceptions: ExceptionCounts,
    pub listed: Vec<ExceptionEntry>,
    pub limitations: Vec<EffectiveLimitation>,
}

/// The listed exceptions: the first 50 in (subject, criterion lineage, ID)
/// byte order.
pub fn listed(entries: &[ExceptionEntry]) -> Vec<ExceptionEntry> {
    let mut sorted: Vec<ExceptionEntry> = entries.to_vec();
    sorted.sort_by(|a, b| {
        (
            a.subject.as_bytes(),
            a.criterion_root.as_bytes(),
            a.id.as_bytes(),
        )
            .cmp(&(
                b.subject.as_bytes(),
                b.criterion_root.as_bytes(),
                b.id.as_bytes(),
            ))
    });
    sorted.truncate(MAX_LISTED_EXCEPTIONS);
    sorted
}

/// Pure: the same effective outcomes and exceptions always give the same
/// effective summary (and the same digest). Rule: `effective_partition_v1`.
pub fn summarise_effective(
    population: &PopulationFacts,
    in_scope: &BTreeSet<String>,
    criteria: &[EffectiveCriterion],
    sample: Option<&BTreeSet<String>>,
    exceptions: &[ExceptionEntry],
) -> EffectiveSummary {
    let plain: Vec<CriterionOpportunities> = criteria
        .iter()
        .map(|c| CriterionOpportunities {
            criterion_id: c.criterion_id.clone(),
            judgment: c.judgment,
            opportunities: c
                .opportunities
                .iter()
                .map(EffectiveOpportunity::facts)
                .collect(),
        })
        .collect();
    let summary = summarise(population, in_scope, &plain, sample);
    let domain: &BTreeSet<String> = sample.unwrap_or(in_scope);
    // Only the exceptions of the summary's own subjects: an exception of a
    // subject outside its population or sample is never counted here.
    let exceptions: Vec<ExceptionEntry> = exceptions
        .iter()
        .filter(|e| domain.contains(&e.subject))
        .cloned()
        .collect();
    let exceptions = exceptions.as_slice();
    let counts: Vec<EffectiveCounts> = criteria
        .iter()
        .map(|c| {
            let mut k = EffectiveCounts {
                criterion_id: c.criterion_id.clone(),
                ..EffectiveCounts::default()
            };
            // The first opportunity of each subject of the domain, as the
            // 24.2 summary counts it.
            let mut seen: BTreeSet<&str> = BTreeSet::new();
            for o in &c.opportunities {
                if !domain.contains(&o.subject) || !seen.insert(o.subject.as_str()) {
                    continue;
                }
                match o.review {
                    ReviewState::Replaced => k.human_replaced += 1,
                    ReviewState::PendingReconsideration => k.pending_reconsideration += 1,
                    ReviewState::Unreviewed if o.origin == EffectiveOrigin::ModelProposal => {
                        k.undisposed += 1
                    }
                    _ => {}
                }
                if o.superseded {
                    k.superseded += 1;
                }
            }
            k
        })
        .collect();
    let exception_counts = ExceptionCounts::of(exceptions);
    let mut limitations = Vec::new();
    if !summary.completeness.complete() {
        limitations.push(EffectiveLimitation {
            code: EffectiveLimitationCode::PopulationIncomplete,
            count: None,
        });
    }
    let mut add = |code: EffectiveLimitationCode, n: u64| {
        if n > 0 {
            limitations.push(EffectiveLimitation {
                code,
                count: Some(n),
            });
        }
    };
    add(
        EffectiveLimitationCode::UnresolvedSubjects,
        summary.partition.unresolved,
    );
    add(
        EffectiveLimitationCode::PendingReconsideration,
        counts.iter().map(|k| k.pending_reconsideration).sum(),
    );
    add(
        EffectiveLimitationCode::UnreviewedModelProposals,
        counts.iter().map(|k| k.undisposed).sum(),
    );
    add(
        EffectiveLimitationCode::SupersededInputsNotReevaluated,
        counts.iter().map(|k| k.superseded).sum(),
    );
    add(
        EffectiveLimitationCode::OpenExceptions,
        exception_counts.open,
    );
    if let Some(selected) = sample {
        limitations.push(EffectiveLimitation {
            code: EffectiveLimitationCode::SampleOnly,
            count: Some(selected.len() as u64),
        });
    }
    EffectiveSummary {
        conclusion: effective_conclusion(summary.conclusion, &exception_counts),
        summary,
        criteria: counts,
        exceptions: exception_counts,
        listed: listed(exceptions),
        limitations,
    }
}

/// The effective conclusion: the 24.2 conclusion, but never that no
/// exception was found while an exception of the summary's subjects is open.
pub fn effective_conclusion(conclusion: Conclusion, exceptions: &ExceptionCounts) -> Conclusion {
    if conclusion == Conclusion::NoExceptionFound && exceptions.open > 0 {
        Conclusion::Inconclusive
    } else {
        conclusion
    }
}

impl EffectiveSummary {
    /// Whether every count is exact (a sample's selected items, or a
    /// complete population), or a lower bound.
    pub fn exact(&self) -> bool {
        self.summary.completeness.complete() || self.summary.selected.is_some()
    }
    /// The canonical effective summary document.
    pub fn document(&self) -> JsonValue {
        let exact = self.exact();
        let e = &self.exceptions;
        object(vec![
            ("aggregation", s(EFFECTIVE_AGGREGATION)),
            ("conclusion", s(self.conclusion.as_str())),
            ("summary", self.summary.document()),
            (
                "criteria",
                JsonValue::Array(
                    self.criteria
                        .iter()
                        .map(|k| {
                            object(vec![
                                ("criterion_id", s(&k.criterion_id)),
                                ("human_replaced", int(k.human_replaced)),
                                ("pending_reconsideration", int(k.pending_reconsideration)),
                                ("undisposed", int(k.undisposed)),
                                ("superseded", int(k.superseded)),
                            ])
                        })
                        .collect(),
                ),
            ),
            (
                "exceptions",
                object(vec![
                    ("total", int(e.total)),
                    ("open", int(e.open)),
                    ("resolved_by_evidence", int(e.resolved_by_evidence)),
                    (
                        "replaced_by_human_judgment",
                        int(e.replaced_by_human_judgment),
                    ),
                    ("closed_by_disposition", int(e.closed_by_disposition)),
                    ("subjects", int(e.subjects)),
                ]),
            ),
            (
                "listed",
                JsonValue::Array(
                    self.listed
                        .iter()
                        .map(|x| {
                            object(vec![
                                ("id", s(&x.id)),
                                ("subject", s(&x.subject)),
                                ("criterion_root", s(&x.criterion_root)),
                                ("status", s(x.status.as_str())),
                                ("latest_observed", s(x.latest_observed.as_str())),
                                ("text", s(&status_words(x.status, x.latest_observed))),
                            ])
                        })
                        .collect(),
                ),
            ),
            (
                "limitations",
                JsonValue::Array(
                    self.limitations
                        .iter()
                        .map(|l| {
                            object(vec![
                                ("code", s(l.code.as_str())),
                                ("count", l.count.map_or(JsonValue::Null, int)),
                                ("text", s(&l.words(exact))),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("statistical_inference", JsonValue::Bool(false)),
        ])
    }
    /// SHA-256 of the canonical effective summary document.
    pub fn digest(&self) -> String {
        sha256_hex(canonical_json(&self.document()).as_bytes())
    }
    /// The structural rules the database also enforces.
    pub fn is_consistent(&self) -> bool {
        let pending: u64 = self
            .criteria
            .iter()
            .map(|k| k.pending_reconsideration)
            .sum();
        let undisposed: u64 = self.criteria.iter().map(|k| k.undisposed).sum();
        let superseded: u64 = self.criteria.iter().map(|k| k.superseded).sum();
        let mut expected = Vec::new();
        if !self.summary.completeness.complete() {
            expected.push((EffectiveLimitationCode::PopulationIncomplete, None));
        }
        for (code, n) in [
            (
                EffectiveLimitationCode::UnresolvedSubjects,
                self.summary.partition.unresolved,
            ),
            (EffectiveLimitationCode::PendingReconsideration, pending),
            (
                EffectiveLimitationCode::UnreviewedModelProposals,
                undisposed,
            ),
            (
                EffectiveLimitationCode::SupersededInputsNotReevaluated,
                superseded,
            ),
            (
                EffectiveLimitationCode::OpenExceptions,
                self.exceptions.open,
            ),
        ] {
            if n > 0 {
                expected.push((code, Some(n)));
            }
        }
        if let Some(selected) = self.summary.selected {
            expected.push((EffectiveLimitationCode::SampleOnly, Some(selected)));
        }
        let domain = self
            .summary
            .selected
            .unwrap_or(self.summary.counts.in_scope);
        self.summary.is_consistent()
            && self.conclusion == effective_conclusion(self.summary.conclusion, &self.exceptions)
            && self.exceptions.subjects <= domain
            && self.criteria.len() == self.summary.criteria.len()
            && self
                .criteria
                .iter()
                .zip(&self.summary.criteria)
                .all(|(k, c)| {
                    k.criterion_id == c.criterion_id
                        && k.human_replaced + k.pending_reconsideration + k.undisposed <= domain
                        && k.superseded <= domain
                })
            && self.exceptions.is_consistent()
            && self.listed.len() as u64 <= self.exceptions.total
            && self.listed.len() <= MAX_LISTED_EXCEPTIONS
            && (self.exceptions.total <= MAX_LISTED_EXCEPTIONS as u64
                || self.listed.len() == MAX_LISTED_EXCEPTIONS)
            && (self.exceptions.total > MAX_LISTED_EXCEPTIONS as u64
                || self.listed.len() as u64 == self.exceptions.total)
            && listed(&self.listed) == self.listed
            && self
                .limitations
                .iter()
                .map(|l| (l.code, l.count))
                .eq(expected)
    }
}

/// Decode a stored effective summary document's own fields around its
/// 24.2 summary (decoded by the caller); refused unless it re-renders to
/// the same document.
pub fn effective_from(
    map: &BTreeMap<String, JsonValue>,
    summary: Summary,
) -> Option<EffectiveSummary> {
    let n = |m: &BTreeMap<String, JsonValue>, key: &str| match m.get(key)? {
        JsonValue::Integer(v) => u64::try_from(*v).ok(),
        _ => None,
    };
    let text = |m: &BTreeMap<String, JsonValue>, key: &str| match m.get(key)? {
        JsonValue::String(v) => Some(v.clone()),
        _ => None,
    };
    let array = |key: &str| match map.get(key)? {
        JsonValue::Array(items) => Some(items.clone()),
        _ => None,
    };
    let as_map = |value: &JsonValue| match value {
        JsonValue::Object(m) => Some(m.clone()),
        _ => None,
    };
    let criteria = array("criteria")?
        .iter()
        .map(|item| {
            let m = as_map(item)?;
            Some(EffectiveCounts {
                criterion_id: text(&m, "criterion_id")?,
                human_replaced: n(&m, "human_replaced")?,
                pending_reconsideration: n(&m, "pending_reconsideration")?,
                undisposed: n(&m, "undisposed")?,
                superseded: n(&m, "superseded")?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let e = as_map(map.get("exceptions")?)?;
    let exceptions = ExceptionCounts {
        total: n(&e, "total")?,
        open: n(&e, "open")?,
        resolved_by_evidence: n(&e, "resolved_by_evidence")?,
        replaced_by_human_judgment: n(&e, "replaced_by_human_judgment")?,
        closed_by_disposition: n(&e, "closed_by_disposition")?,
        subjects: n(&e, "subjects")?,
    };
    let listed = array("listed")?
        .iter()
        .map(|item| {
            let m = as_map(item)?;
            let subject = text(&m, "subject")?;
            Some(ExceptionEntry {
                id: text(&m, "id")?,
                criterion_root: text(&m, "criterion_root")?,
                status: ExceptionStatus::parse(&text(&m, "status")?)?,
                latest_observed: LatestObserved::parse(&text(&m, "latest_observed")?)?,
                subject: valid_subject(&subject).then_some(subject)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let limitations = array("limitations")?
        .iter()
        .map(|item| {
            let m = as_map(item)?;
            Some(EffectiveLimitation {
                code: EffectiveLimitationCode::parse(&text(&m, "code")?)?,
                count: match m.get("count")? {
                    JsonValue::Null => None,
                    JsonValue::Integer(v) => Some(u64::try_from(*v).ok()?),
                    _ => return None,
                },
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let decoded = EffectiveSummary {
        conclusion: Conclusion::parse(&text(map, "conclusion")?)?,
        summary,
        criteria,
        exceptions,
        listed,
        limitations,
    };
    (decoded.is_consistent() && decoded.document() == JsonValue::Object(map.clone()))
        .then_some(decoded)
}

fn string(max: usize) -> ArgumentSchema {
    ArgumentSchema::String {
        max_bytes: max as u32,
        enumeration: vec![],
    }
}

/// The Story 24.3b answer field, offered only when assessment is composed.
/// Every property is required (strict output); `""` means no sample.
pub fn answer_fields() -> Vec<(&'static str, ArgumentSchema)> {
    let fields = vec![
        ("basis", string(128)),
        ("population", string(128)),
        ("sample", string(128)),
    ];
    let required = fields.iter().map(|(k, _)| (*k).to_string()).collect();
    vec![(
        "summarise_effective",
        ArgumentSchema::Array {
            items: Box::new(ArgumentSchema::Object {
                properties: fields
                    .into_iter()
                    .map(|(k, v)| (k.to_string(), v))
                    .collect(),
                required,
            }),
            max_items: MAX_SUMMARISE_EFFECTIVE as u32,
        },
    )]
}

/// An effective summary request has the 24.2 summary request's shape.
pub fn decode_summarise_effective(value: &JsonValue) -> Option<SummaryRequest> {
    crate::coverage::decode_summary(value)
}

#[cfg(test)]
mod tests;
