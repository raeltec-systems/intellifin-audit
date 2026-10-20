//! Story 24.3a: revise evaluations without overwriting facts.
//!
//! Three layers never overwrite each other:
//!
//! - **facts**: what a source showed (24.1, immutable);
//! - **revisions**: what trusted code (a rule) or the model (a judgment)
//!   concluded from one pinned set of facts. Revision 1 of a chain is the
//!   24.1 evaluation; every later revision is a new immutable record that
//!   names its predecessor, the closed causes trusted code derived from the
//!   difference, and the fact IDs that were added, removed or replaced;
//! - **dispositions**: what a person decided about one exact revision.
//!   A disposition never changes the revision it names.
//!
//! The model never chooses a predecessor, a cause or a disposition: those
//! are found and derived here by trusted code. There is no numeric
//! confidence and no percentage anywhere.
use std::collections::{BTreeMap, BTreeSet};

use crate::{
    assessment::{Execution, Origin, Outcome, Verdict, text_ok, valid_name, valid_subject},
    citation::{CitationSource, Locator, MAX_LOCATOR_BYTES, MAX_QUOTE_BYTES},
    context::canonical_json,
    identity::valid_scope_id,
    model::{ArgumentSchema, JsonValue},
    work::sha256_hex,
};

/// Each `changes` list of one revision (an evaluation reads at most 32 facts).
pub const MAX_CHANGES: usize = 32;
/// `carry_facts` entries one answer may make, and the facts it may except.
pub const MAX_CARRIES: usize = 1;
pub const MAX_CARRY_EXCEPT: usize = 64;
/// A disposition's rationale, in UTF-8 bytes, and its evidence references.
pub const MAX_DISPOSITION_RATIONALE_BYTES: usize = 2_000;
pub const MAX_DISPOSITION_REFERENCES: usize = 8;
/// Dispositions one revision may hold (the latest is effective).
pub const MAX_DISPOSITIONS_PER_REVISION: usize = 16;
/// Basis or criterion versions trusted code walks back to a lineage root.
pub const MAX_LINEAGE: usize = 64;
/// Revisions one history page lists.
pub const HISTORY_PAGE: usize = 50;
/// Revisions per chain: the history cursor is a revision number.
pub const MAX_REVISIONS: u32 = 1_000_000;

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

// Why trusted code appended a revision. Closed, derived, never model-written.
vocabulary!(RevisionCause {
    InputsChanged => "inputs_changed",
    CriterionRevised => "criterion_revised",
    BasisRevised => "basis_revised",
    PriorExecutionFailed => "prior_execution_failed",
    ReconsiderationRequested => "reconsideration_requested",
});

// What a person decided about one exact revision.
vocabulary!(DispositionKind {
    Accepted => "accepted",
    Replaced => "replaced",
    NeedsReconsideration => "needs_reconsideration",
});

// What a reconsideration request is about.
vocabulary!(Concern {
    Facts => "facts",
    Rule => "rule",
    Authority => "authority",
    Scope => "scope",
});

// Who the effective verdict comes from.
vocabulary!(EffectiveOrigin {
    Deterministic => "deterministic",
    ModelProposal => "model_proposal",
    Human => "human",
});

// The review state of a chain head. `unreviewed` is the absence of a
// disposition; `accepted` is never review sign-off (Story 24.5).
vocabulary!(ReviewState {
    Unreviewed => "unreviewed",
    Accepted => "accepted",
    Replaced => "replaced",
    PendingReconsideration => "pending_reconsideration",
});

/// One step of a chain as cause derivation reads it: the basis and criterion
/// versions it was evaluated under, its execution and its input facts as
/// (fact name, fact ID) pairs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step<'a> {
    pub basis_id: &'a str,
    pub criterion_id: &'a str,
    pub execution: Execution,
    pub inputs: &'a [(String, String)],
}

/// The fact IDs a revision added, removed or replaced, by fact name.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Changes {
    /// Fact IDs read now under a name the predecessor did not read.
    pub added: Vec<String>,
    /// Fact IDs the predecessor read under a name no longer read.
    pub removed: Vec<String>,
    /// (predecessor fact ID, new fact ID) read under the same name.
    pub replaced: Vec<(String, String)>,
}
impl Changes {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.replaced.is_empty()
    }
    pub fn is_valid(&self) -> bool {
        let id = |v: &String| v.starts_with("fact-") && valid_scope_id(v);
        self.added.len() <= MAX_CHANGES
            && self.removed.len() <= MAX_CHANGES
            && self.replaced.len() <= MAX_CHANGES
            && self.added.iter().all(id)
            && self.removed.iter().all(id)
            && self.replaced.iter().all(|(a, b)| id(a) && id(b) && a != b)
    }
    pub fn document(&self) -> JsonValue {
        let ids = |v: &[String]| JsonValue::Array(v.iter().map(|i| s(i)).collect());
        JsonValue::Object(BTreeMap::from([
            ("added".into(), ids(&self.added)),
            ("removed".into(), ids(&self.removed)),
            (
                "replaced".into(),
                JsonValue::Array(
                    self.replaced
                        .iter()
                        .map(|(from, to)| {
                            JsonValue::Object(BTreeMap::from([
                                ("from".into(), s(from)),
                                ("to".into(), s(to)),
                            ]))
                        })
                        .collect(),
                ),
            ),
        ]))
    }
    pub fn from_document(value: &JsonValue) -> Option<Self> {
        let JsonValue::Object(map) = value else {
            return None;
        };
        let ids = |key: &str| -> Option<Vec<String>> {
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
        };
        let replaced = match map.get("replaced")? {
            JsonValue::Array(items) => items
                .iter()
                .map(|i| match i {
                    JsonValue::Object(pair) if pair.len() == 2 => {
                        match (pair.get("from")?, pair.get("to")?) {
                            (JsonValue::String(a), JsonValue::String(b)) => {
                                Some((a.clone(), b.clone()))
                            }
                            _ => None,
                        }
                    }
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()?,
            _ => return None,
        };
        if map.len() != 3 {
            return None;
        }
        Some(Self {
            added: ids("added")?,
            removed: ids("removed")?,
            replaced,
        })
        .filter(Self::is_valid)
    }
}

fn s(value: &str) -> JsonValue {
    JsonValue::String(value.into())
}

/// The difference between a predecessor's and a successor's input facts,
/// by fact name. Each list is in fact-name byte order. A fact carried by
/// reference into a successor basis keeps its ID, so carrying alone changes
/// nothing; a corrected fact is a new ID under the same name (`replaced`).
pub fn changes(previous: &[(String, String)], next: &[(String, String)]) -> Changes {
    let before: BTreeMap<&str, &str> = previous
        .iter()
        .map(|(n, i)| (n.as_str(), i.as_str()))
        .collect();
    let after: BTreeMap<&str, &str> = next.iter().map(|(n, i)| (n.as_str(), i.as_str())).collect();
    let mut changes = Changes::default();
    for (name, id) in &after {
        match before.get(name) {
            None => changes.added.push((*id).into()),
            Some(old) if old != id => changes.replaced.push(((*old).into(), (*id).into())),
            Some(_) => {}
        }
    }
    for (name, id) in &before {
        if !after.contains_key(name) {
            changes.removed.push((*id).into());
        }
    }
    changes
}

/// The closed causes of a new revision, in vocabulary order. Derived only
/// from the difference between the chain head and the new evaluation, and
/// whether the head's effective disposition asks for reconsideration:
///
/// - `inputs_changed`: the input fact IDs differ;
/// - `criterion_revised`: a different criterion version (its successor);
/// - `basis_revised`: a different basis version (its successor);
/// - `prior_execution_failed`: the head's execution failed and this one
///   completed;
/// - `reconsideration_requested`: a person asked for it on the head.
///
/// An empty result means nothing changed: trusted code records nothing.
pub fn causes(head: &Step<'_>, next: &Step<'_>, reconsideration: bool) -> Vec<RevisionCause> {
    let ids = |step: &Step<'_>| -> BTreeSet<String> {
        step.inputs.iter().map(|(_, id)| id.clone()).collect()
    };
    let mut out = Vec::new();
    if ids(head) != ids(next) {
        out.push(RevisionCause::InputsChanged);
    }
    if head.criterion_id != next.criterion_id {
        out.push(RevisionCause::CriterionRevised);
    }
    if head.basis_id != next.basis_id {
        out.push(RevisionCause::BasisRevised);
    }
    if head.execution == Execution::Failed && next.execution == Execution::Completed {
        out.push(RevisionCause::PriorExecutionFailed);
    }
    if reconsideration {
        out.push(RevisionCause::ReconsiderationRequested);
    }
    out
}

/// Whether a revision's stated causes are exactly the derived ones.
pub fn causes_valid(causes: &[RevisionCause]) -> bool {
    !causes.is_empty() && causes.windows(2).all(|w| w[0] < w[1])
}

/// SHA-256 of a revision's identity in its chain: the chain, its number,
/// the predecessor, the causes and changes, and the output digest. Two
/// revisions are the same record only when every one agrees.
pub fn revision_digest(
    chain_id: &str,
    revision: u32,
    predecessor_id: &str,
    causes: &[RevisionCause],
    changes: &Changes,
    output_digest: &str,
) -> String {
    let document = JsonValue::Object(BTreeMap::from([
        ("chain_id".into(), s(chain_id)),
        ("revision".into(), JsonValue::Integer(i64::from(revision))),
        ("predecessor_id".into(), s(predecessor_id)),
        (
            "causes".into(),
            JsonValue::Array(causes.iter().map(|c| s(c.as_str())).collect()),
        ),
        ("changes".into(), changes.document()),
        ("output_digest".into(), s(output_digest)),
    ]));
    sha256_hex(canonical_json(&document).as_bytes())
}

// ------------------------------------------------------------ dispositions

/// A person's disposition of one exact revision, as requested.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DispositionRequest {
    /// Session-bound request key, idempotent per actor.
    pub key: String,
    /// The exact revision: a 24.1 evaluation ID (revision 1) or a revision ID.
    pub revision_id: String,
    pub kind: DispositionKind,
    /// Exactly for `needs_reconsideration`.
    pub concern: Option<Concern>,
    /// Exactly for `replaced`: the person's own verdict.
    pub verdict: Option<Verdict>,
    /// 1–2,000 bytes of the person's words (attributed data).
    pub rationale: String,
    /// 0–8 evidence references, each verified at write time.
    pub references: Vec<CitationSource>,
}

/// A revision ID: a 24.1 evaluation (`eval-`) or a revision (`rev-`).
pub fn valid_revision_id(id: &str) -> bool {
    let hex = |rest: &str| {
        rest.len() == 40 && rest.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    };
    id.strip_prefix("eval-").is_some_and(hex) || id.strip_prefix("rev-").is_some_and(hex)
}

/// Why a disposition request is refused before anything is read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DispositionRefusal {
    /// The request is malformed (shape, bounds, vocabulary).
    Invalid,
    /// `replaced` on a deterministic revision: a rule verdict is changed only
    /// by corrected facts or a new criterion version.
    NotReplaceable,
}

impl DispositionRequest {
    /// The structural rules the database also enforces.
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && valid_revision_id(&self.revision_id)
            && (self.kind == DispositionKind::NeedsReconsideration) == self.concern.is_some()
            && (self.kind == DispositionKind::Replaced) == self.verdict.is_some()
            && !self.rationale.trim().is_empty()
            && text_ok(&self.rationale, MAX_DISPOSITION_RATIONALE_BYTES)
            && self.references.len() <= MAX_DISPOSITION_REFERENCES
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
    /// Whether this disposition may be saved on a revision of `origin`.
    pub fn check(&self, origin: Origin) -> Result<(), DispositionRefusal> {
        if !self.is_valid() {
            return Err(DispositionRefusal::Invalid);
        }
        if self.kind == DispositionKind::Replaced && origin != Origin::ModelProposal {
            return Err(DispositionRefusal::NotReplaceable);
        }
        Ok(())
    }
}

/// A stored disposition, as effective-outcome derivation reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Decision {
    pub kind: DispositionKind,
    pub verdict: Option<Verdict>,
}

/// The effective outcome of a chain head under its latest disposition.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Effective {
    pub verdict: Option<Verdict>,
    pub origin: EffectiveOrigin,
    pub review: ReviewState,
}

/// The head's outcome overlaid by its effective (latest) disposition:
/// `replaced` gives the person's verdict with origin `human`; `accepted`
/// keeps it, labelled accepted; `needs_reconsideration` keeps it, pending.
/// No disposition is `unreviewed`. A deterministic head is never replaced
/// (a stored `replaced` on one is ignored, never applied).
pub fn effective(head: &Outcome, decision: Option<Decision>) -> Effective {
    let origin = match head.origin {
        Origin::Deterministic => EffectiveOrigin::Deterministic,
        Origin::ModelProposal => EffectiveOrigin::ModelProposal,
    };
    match decision {
        None => Effective {
            verdict: head.verdict,
            origin,
            review: ReviewState::Unreviewed,
        },
        Some(Decision {
            kind: DispositionKind::Replaced,
            verdict: Some(verdict),
        }) if head.origin == Origin::ModelProposal => Effective {
            verdict: Some(verdict),
            origin: EffectiveOrigin::Human,
            review: ReviewState::Replaced,
        },
        Some(Decision {
            kind: DispositionKind::Accepted,
            ..
        }) => Effective {
            verdict: head.verdict,
            origin,
            review: ReviewState::Accepted,
        },
        Some(Decision {
            kind: DispositionKind::NeedsReconsideration,
            ..
        }) => Effective {
            verdict: head.verdict,
            origin,
            review: ReviewState::PendingReconsideration,
        },
        Some(_) => Effective {
            verdict: head.verdict,
            origin,
            review: ReviewState::Unreviewed,
        },
    }
}

/// The canonical document of a stored disposition (its own digest covers it).
#[allow(clippy::too_many_arguments)]
pub fn disposition_document(
    id: &str,
    task_id: &str,
    actor_id: &str,
    request: &DispositionRequest,
    chain_id: &str,
    revision: u32,
    references: &[(CitationSource, String)],
) -> JsonValue {
    JsonValue::Object(BTreeMap::from([
        ("record".into(), s("disposition")),
        ("id".into(), s(id)),
        ("task_id".into(), s(task_id)),
        ("actor_id".into(), s(actor_id)),
        ("key".into(), s(&request.key)),
        ("revision_id".into(), s(&request.revision_id)),
        ("chain_id".into(), s(chain_id)),
        ("revision".into(), JsonValue::Integer(i64::from(revision))),
        ("kind".into(), s(request.kind.as_str())),
        (
            "concern".into(),
            request.concern.map_or(JsonValue::Null, |c| s(c.as_str())),
        ),
        (
            "verdict".into(),
            request.verdict.map_or(JsonValue::Null, |v| s(v.as_str())),
        ),
        ("rationale".into(), s(&request.rationale)),
        (
            "references".into(),
            JsonValue::Array(
                references
                    .iter()
                    .map(|(source, sha)| {
                        JsonValue::Object(BTreeMap::from([
                            ("original_id".into(), s(&source.original_id)),
                            (
                                "locator".into(),
                                source
                                    .locator
                                    .as_ref()
                                    .map_or(JsonValue::Null, |l| s(&l.render())),
                            ),
                            ("quote".into(), s(&source.quote)),
                            ("original_sha256".into(), s(sha)),
                            ("verification".into(), s("verified")),
                        ]))
                    })
                    .collect(),
            ),
        ),
    ]))
}

/// Decode a stored disposition document's request part and references.
pub fn disposition_from(
    document: &JsonValue,
) -> Option<(DispositionRequest, Vec<(CitationSource, String)>)> {
    let JsonValue::Object(map) = document else {
        return None;
    };
    let text = |key: &str| match map.get(key)? {
        JsonValue::String(v) => Some(v.clone()),
        _ => None,
    };
    let optional = |key: &str| match map.get(key)? {
        JsonValue::String(v) => Some(Some(v.clone())),
        JsonValue::Null => Some(None),
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
    let request = DispositionRequest {
        key: text("key")?,
        revision_id: text("revision_id")?,
        kind: DispositionKind::parse(&text("kind")?)?,
        concern: match optional("concern")? {
            Some(c) => Some(Concern::parse(&c)?),
            None => None,
        },
        verdict: match optional("verdict")? {
            Some(v) => Some(Verdict::parse(&v)?),
            None => None,
        },
        rationale: text("rationale")?,
        references: references.iter().map(|(r, _)| r.clone()).collect(),
    };
    request.is_valid().then_some((request, references))
}

// ------------------------------------------------------------ carry_facts

/// A successor basis carries every effective fact of the basis it
/// supersedes, by reference, except the (subject, name) pairs listed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CarryFacts {
    /// The successor basis: an ID, or the key of the basis of the same answer.
    pub basis: String,
    /// (subject, fact name) pairs not carried.
    pub except: Vec<(String, String)>,
}
impl CarryFacts {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.basis)
            && self.except.len() <= MAX_CARRY_EXCEPT
            && self
                .except
                .iter()
                .all(|(subject, name)| valid_subject(subject) && valid_name(name))
            && self
                .except
                .iter()
                .enumerate()
                .all(|(i, e)| !self.except[..i].contains(e))
    }
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
fn string(max: usize) -> ArgumentSchema {
    ArgumentSchema::String {
        max_bytes: max as u32,
        enumeration: vec![],
    }
}

/// The Story 24.3a answer field, offered only when assessment is composed.
pub fn answer_fields() -> Vec<(&'static str, ArgumentSchema)> {
    let except = obj(vec![
        ("subject", string(crate::assessment::MAX_SUBJECT_BYTES)),
        ("name", string(crate::assessment::MAX_NAME_BYTES)),
    ]);
    vec![(
        "carry_facts",
        ArgumentSchema::Array {
            items: Box::new(obj(vec![
                ("basis", string(128)),
                (
                    "except",
                    ArgumentSchema::Array {
                        items: Box::new(except),
                        max_items: MAX_CARRY_EXCEPT as u32,
                    },
                ),
            ])),
            max_items: MAX_CARRIES as u32,
        },
    )]
}

pub fn decode_carry(value: &JsonValue) -> Option<CarryFacts> {
    let JsonValue::Object(map) = value else {
        return None;
    };
    let JsonValue::String(basis) = map.get("basis")? else {
        return None;
    };
    let JsonValue::Array(items) = map.get("except")? else {
        return None;
    };
    let except = items
        .iter()
        .map(|item| {
            let JsonValue::Object(pair) = item else {
                return None;
            };
            match (pair.get("subject")?, pair.get("name")?) {
                (JsonValue::String(subject), JsonValue::String(name)) => {
                    Some((subject.clone(), name.clone()))
                }
                _ => None,
            }
        })
        .collect::<Option<Vec<_>>>()?;
    let carry = CarryFacts {
        basis: basis.clone(),
        except,
    };
    carry.is_valid().then_some(carry)
}

#[cfg(test)]
mod tests;
