//! Context budget planning, deterministic compaction digests and labelled data
//! envelopes for the work loop. Everything here is pure: no I/O, no model call,
//! and nothing grants Task, tool or Permissions authority. A digest lists only
//! facts the platform already owns; it is never a summary and never evidence.
use crate::{
    identity::valid_scope_id,
    model::{JsonValue, MAX_HISTORY_BYTES, MAX_HISTORY_ITEMS, MAX_INPUT_BYTES},
    work::{StepKind, TaskStep, sha256_hex},
};

/// Version of the canonical digest shape. A changed shape is a new version.
pub const DIGEST_VERSION: u64 = 1;
/// Compaction records one cycle may hold. Steps per cycle are bounded too.
pub const MAX_COMPACTIONS_PER_CYCLE: usize = 256;
/// Canonical bytes of one digest; the JSONB column is bounded independently.
pub const MAX_DIGEST_BYTES: usize = 128 * 1024;
/// Distinct knowledge references one record may name.
pub const MAX_COMPACTION_SOURCES: usize = 512;
/// Rendering allowance per message or history item (role and framing), so the
/// estimate stays above the bytes actually sent.
pub const ITEM_OVERHEAD_TOKENS: u64 = 32;
/// Composition default when neither the profile nor the Task names a limit.
pub const DEFAULT_CONTEXT_TOKENS: u64 = 128_000;
/// The planner never exceeds the request validation byte caps.
pub const MAX_CONTEXT_TOKENS: u64 = (MAX_INPUT_BYTES + MAX_HISTORY_BYTES) as u64;
/// Stale sources listed by name in the omission summary; the rest are counted.
pub const MAX_LISTED_STALE_SOURCES: usize = 32;

/// Conservative token estimate. One token never covers less than one UTF-8
/// byte, so the byte count is an upper bound on the tokens it encodes.
pub const fn estimate_tokens(text: &str) -> u64 {
    text.len() as u64
}

/// The request budget in conservative tokens: the minimum of the trusted
/// profile limit and the Task setting, within the request validation caps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ContextBudget {
    pub profile_tokens: u64,
    pub task_tokens: u64,
}

impl ContextBudget {
    pub const DEFAULT: Self = Self {
        profile_tokens: DEFAULT_CONTEXT_TOKENS,
        task_tokens: DEFAULT_CONTEXT_TOKENS,
    };
    pub fn effective(&self) -> u64 {
        self.profile_tokens
            .min(self.task_tokens)
            .min(MAX_CONTEXT_TOKENS)
    }
}

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

// Provenance of each kind of untrusted text that enters a request. It is
// carried by the data envelope and is distinct from the firm's data
// classification, which alone is bound to Permissions at disclosure.
vocabulary!(InputClass {
    TaskObjective => "task-objective",
    WorkingBrief => "working-brief",
    Knowledge => "knowledge",
    ToolResult => "tool-result",
    ModelOutput => "model-output",
    CompactionDigest => "compaction-digest",
});

// Current standing of a knowledge revision that an earlier turn used.
vocabulary!(SourceStatus {
    Current => "current",
    Withdrawn => "withdrawn",
    Corrected => "corrected",
    Invalidated => "invalidated",
});

// Why something was left out of a request. Counts never imply absence.
vocabulary!(OmissionCategory {
    StepsCompacted => "steps_compacted",
    DigestsOmitted => "digests_omitted",
    KnowledgeBudget => "knowledge_budget",
    KnowledgeUnusable => "knowledge_unusable",
    StaleSources => "stale_sources",
    StaleContent => "stale_content",
});

const ENVELOPE_KEYWORD: &str = "zobba-data";

/// Escape content so that no envelope delimiter (any ASCII-case spelling of the
/// keyword) can appear in it: backslashes are doubled and the keyword's hyphen
/// becomes `\-`. `unescape` reverses this exactly.
pub fn escape_data(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    let bytes = content.as_bytes();
    let mut i = 0;
    while i < content.len() {
        if bytes[i] == b'\\' {
            out.push_str("\\\\");
            i += 1;
            continue;
        }
        if bytes.len() - i >= ENVELOPE_KEYWORD.len()
            && bytes[i..i + ENVELOPE_KEYWORD.len()]
                .eq_ignore_ascii_case(ENVELOPE_KEYWORD.as_bytes())
        {
            // "zobba" (5 ASCII bytes) + "\-" + "data" (4 ASCII bytes), case kept.
            out.push_str(&content[i..i + 5]);
            out.push_str("\\-");
            out.push_str(&content[i + 6..i + 10]);
            i += 10;
            continue;
        }
        let ch = content[i..].chars().next().expect("char boundary");
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

pub fn unescape_data(escaped: &str) -> Option<String> {
    let mut out = String::with_capacity(escaped.len());
    let mut chars = escaped.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next()? {
                '\\' => out.push('\\'),
                '-' => out.push('-'),
                _ => return None,
            }
        } else {
            out.push(ch);
        }
    }
    Some(out)
}

/// Wrap untrusted text as labelled data. The header carries only owned values:
/// the input class and the context source identifier.
pub fn envelope(class: InputClass, source_id: &str, content: &str) -> String {
    format!(
        "[{ENVELOPE_KEYWORD} class={} source={}]\n{}\n[/{ENVELOPE_KEYWORD}]",
        class.as_str(),
        source_id,
        escape_data(content)
    )
}

/// Inverse of `envelope`, for inspection and tests.
pub fn open_envelope(text: &str) -> Option<(InputClass, String, String)> {
    let rest = text.strip_prefix(&format!("[{ENVELOPE_KEYWORD} class="))?;
    let (header, rest) = rest.split_once("]\n")?;
    let (class, source) = header.split_once(" source=")?;
    let body = rest.strip_suffix(&format!("\n[/{ENVELOPE_KEYWORD}]"))?;
    if !valid_scope_id(source) || body.to_ascii_lowercase().contains(ENVELOPE_KEYWORD) {
        return None;
    }
    Some((
        InputClass::parse(class)?,
        source.into(),
        unescape_data(body)?,
    ))
}

/// One knowledge revision named by a compaction record, with its standing at
/// the time the record was made (historical observation, not part of the digest).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourceState {
    pub id: String,
    pub revision: u64,
    pub status: SourceStatus,
}

/// A durable compaction record. `digest` is the canonical JSON built by
/// `CompactionDigest::canonical`, reproducible from immutable step and
/// invocation facts; `sources` and `omissions` record what was known when the
/// record was made.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContextCompaction {
    pub task_id: String,
    pub cycle_id: String,
    pub sequence: u32,
    pub first_ordinal: u32,
    pub last_ordinal: u32,
    pub digest: String,
    pub digest_sha256: String,
    pub sources: Vec<SourceState>,
    pub omissions: Vec<(OmissionCategory, u32)>,
    pub estimated_tokens: u64,
}

impl ContextCompaction {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.task_id)
            && valid_scope_id(&self.cycle_id)
            && (self.sequence as usize) < MAX_COMPACTIONS_PER_CYCLE
            && self.first_ordinal <= self.last_ordinal
            && (self.last_ordinal as usize) < crate::work::MAX_STEPS_PER_CYCLE
            && !self.digest.is_empty()
            && self.digest.len() <= MAX_DIGEST_BYTES
            && self.digest_sha256 == sha256_hex(self.digest.as_bytes())
            && self.sources.len() <= MAX_COMPACTION_SOURCES
            && self
                .sources
                .iter()
                .all(|s| valid_scope_id(&s.id) && s.revision > 0 && s.revision <= i64::MAX as u64)
            && self
                .sources
                .windows(2)
                .all(|p| (&p[0].id, p[0].revision) < (&p[1].id, p[1].revision))
            && self.omissions.windows(2).all(|p| p[0].0 < p[1].0)
            && self.omissions.iter().all(|(_, n)| *n > 0)
            && self.estimated_tokens <= i64::MAX as u64
    }
}

/// A record as listed for inspection: identity, range, sources, omissions and
/// estimate, without the digest body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactionSummary {
    pub sequence: u32,
    pub first_ordinal: u32,
    pub last_ordinal: u32,
    pub digest_sha256: String,
    pub sources: Vec<SourceState>,
    pub omissions: Vec<(OmissionCategory, u32)>,
    pub estimated_tokens: u64,
    /// Seconds since the Unix epoch, server clock.
    pub created_at: i64,
}

/// Fixed limitations stated in every digest of this version.
pub const DIGEST_LIMITATIONS: [&str; 3] = [
    "Facts only: recorded step facts and the knowledge revisions earlier turns used. No model, tool or source text is included, and this is not evidence.",
    "Raw steps, invocations and results remain inspectable by their identifiers.",
    "A compacted or omitted item is not evidence that material is absent.",
];

/// Exact digest inputs: step facts in ordinal order and the knowledge
/// references their invocations used (any order; normalised on output).
pub struct CompactionDigest<'a> {
    pub task_id: &'a str,
    pub cycle_id: &'a str,
    pub sequence: u32,
    pub steps: &'a [TaskStep],
    pub sources: &'a [(String, u64)],
}

fn json_string(out: &mut String, value: &str) {
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Canonical JSON writer: keys are emitted in byte order, no whitespace, absent
/// optional values are omitted. Matches a sorted-key compact JSON serialiser.
struct Object<'o> {
    out: &'o mut String,
    first: bool,
    last_key: &'static str,
}
impl<'o> Object<'o> {
    fn new(out: &'o mut String) -> Self {
        out.push('{');
        Self {
            out,
            first: true,
            last_key: "",
        }
    }
    fn key(&mut self, key: &'static str) {
        debug_assert!(self.first || key > self.last_key, "canonical key order");
        if !self.first {
            self.out.push(',');
        }
        self.first = false;
        self.last_key = key;
        json_string(self.out, key);
        self.out.push(':');
    }
    fn string(&mut self, key: &'static str, value: &str) {
        self.key(key);
        json_string(self.out, value);
    }
    fn optional(&mut self, key: &'static str, value: Option<&str>) {
        if let Some(value) = value {
            self.string(key, value);
        }
    }
    fn number(&mut self, key: &'static str, value: u64) {
        self.key(key);
        self.out.push_str(&value.to_string());
    }
    fn end(self) {
        self.out.push('}');
    }
}

/// Canonical JSON of a decoded value: object keys in byte order (the
/// `BTreeMap` order of `JsonValue`), no whitespace, the same escaping as the
/// digest writer. A stored digest is verified with this serialiser, never with
/// a third-party map ordering.
pub fn canonical_json(value: &JsonValue) -> String {
    fn write(out: &mut String, value: &JsonValue) {
        match value {
            JsonValue::Null => out.push_str("null"),
            JsonValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            JsonValue::Integer(n) => out.push_str(&n.to_string()),
            JsonValue::String(s) => json_string(out, s),
            JsonValue::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write(out, item);
                }
                out.push(']');
            }
            JsonValue::Object(map) => {
                out.push('{');
                for (i, (key, item)) in map.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    json_string(out, key);
                    out.push(':');
                    write(out, item);
                }
                out.push('}');
            }
        }
    }
    let mut out = String::new();
    write(&mut out, value);
    out
}

/// Canonical digest entry of one step: fixed vocabulary values and
/// platform-owned identifiers only. Labels, model text, tool arguments and the
/// provider-chosen call identifier are never included; the invocation, ordinal,
/// operation and attempt identify the exchange.
pub fn digest_step(step: &TaskStep) -> String {
    let mut out = String::new();
    let mut o = Object::new(&mut out);
    o.optional("attempt_id", step.attempt_id.as_deref());
    o.number("execution_epoch", step.execution_epoch);
    o.optional("fact", step.fact.map(|f| f.as_str()));
    o.number("intent_revision", step.intent_revision);
    o.optional("invocation_id", step.invocation_id.as_deref());
    o.string("kind", step.kind.as_str());
    if step.kind == StepKind::ModelTurn {
        o.number("knowledge_omitted", u64::from(step.knowledge_omitted));
    }
    o.optional("operation_id", step.operation_id.as_deref());
    o.number("ordinal", u64::from(step.ordinal));
    o.optional("reason", step.reason.map(|r| r.as_str()));
    o.string("status", step.status.as_str());
    o.end();
    out
}

impl CompactionDigest<'_> {
    /// Deterministic canonical bytes. The same inputs always produce identical
    /// text, so a digest rebuilt from the database can be compared exactly.
    pub fn canonical(&self) -> Option<String> {
        let first = self.steps.first()?.ordinal;
        let last = self.steps.last()?.ordinal;
        if self
            .steps
            .windows(2)
            .any(|p| p[1].ordinal != p[0].ordinal + 1)
        {
            return None;
        }
        let mut sources: Vec<(&str, u64)> = self
            .sources
            .iter()
            .map(|(id, revision)| (id.as_str(), *revision))
            .collect();
        sources.sort();
        sources.dedup();
        let mut out = String::new();
        let mut o = Object::new(&mut out);
        o.string("cycle_id", self.cycle_id);
        o.number("first_ordinal", u64::from(first));
        o.number("last_ordinal", u64::from(last));
        o.key("limitations");
        o.out.push('[');
        for (i, text) in DIGEST_LIMITATIONS.iter().enumerate() {
            if i > 0 {
                o.out.push(',');
            }
            json_string(o.out, text);
        }
        o.out.push(']');
        o.number("sequence", u64::from(self.sequence));
        o.key("sources");
        o.out.push('[');
        for (i, (id, revision)) in sources.iter().enumerate() {
            if i > 0 {
                o.out.push(',');
            }
            let mut source = Object::new(o.out);
            source.string("id", id);
            source.number("revision", *revision);
            source.end();
        }
        o.out.push(']');
        o.key("steps");
        o.out.push('[');
        for (i, step) in self.steps.iter().enumerate() {
            if i > 0 {
                o.out.push(',');
            }
            o.out.push_str(&digest_step(step));
        }
        o.out.push(']');
        o.string("task_id", self.task_id);
        o.number("version", DIGEST_VERSION);
        o.end();
        (out.len() <= MAX_DIGEST_BYTES).then_some(out)
    }
}

/// Fixed overhead of a digest around its step entries (identifiers, limits,
/// limitations), used to estimate a record before it is built.
pub fn digest_overhead_tokens(task_id: &str, cycle_id: &str, sources: usize) -> u64 {
    // Keys, separators and numbers of the record frame (sequence, ordinals and
    // version are at most 20 digits each), with margin.
    let base = DIGEST_LIMITATIONS
        .iter()
        .map(|l| l.len() as u64 + 3)
        .sum::<u64>()
        + task_id.len() as u64
        + cycle_id.len() as u64
        + 256;
    // Each source entry `{"id":"<128>","revision":<19 digits>}` plus a comma is
    // 170 bytes at most; 192 keeps the estimate above the actual cost.
    base + sources as u64 * 192
}

/// Cost of one recorded step as raw history and as a digest entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StepCost {
    pub ordinal: u32,
    pub kind: StepKind,
    /// Conservative tokens of the step's rendered history items.
    pub tokens: u64,
    /// History items the step contributes (zero, for example, for a turn
    /// whose proposals are represented by their own tool steps).
    pub items: usize,
    /// Tokens of its canonical digest entry plus separator.
    pub digest_tokens: u64,
}

pub struct PlanInput<'a> {
    pub budget: u64,
    /// Tiers 1-2: owned constraints, objective, method, brief, unresolved
    /// decisions and the tool catalogue, plus an exact bound on the omission
    /// summary (tier 6), which is sized only after planning.
    pub fixed_tokens: u64,
    /// The message part of `fixed_tokens`, held to the message byte cap.
    pub fixed_message_tokens: u64,
    /// Every recorded step of the cycle in ordinal order.
    pub steps: &'a [StepCost],
    /// Existing compaction records cover ordinals 0..=covered_through.
    pub covered_through: Option<u32>,
    /// Rendered cost of each existing record's digest, oldest first.
    pub digests: &'a [u64],
    /// Fixed overhead of a new record, from `digest_overhead_tokens`.
    pub new_digest_overhead: u64,
    /// Current knowledge in preference order.
    pub knowledge: &'a [u64],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    /// Index into `steps` from which steps are included as raw history.
    pub first_raw: usize,
    /// A new compaction record covering these ordinals, inclusive.
    pub compact: Option<(u32, u32)>,
    /// Whether the new record's digest fits and is included.
    pub new_digest_included: bool,
    /// The newest N existing digests are included; older ones are omitted.
    pub digests_included: usize,
    /// Per knowledge item, whether it is included.
    pub knowledge_included: Vec<bool>,
    /// Estimated tokens of everything planned (omission reserve included).
    pub estimated_tokens: u64,
    pub steps_compacted: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlanError {
    /// Tiers 1-2 alone exceed the budget: the turn must not be sent.
    ContextBudget { required: u64, budget: u64 },
}

/// Plan one request within its budget, in tier order: 1-2 fixed, 3 the newest
/// complete steps, 4 compaction digests, 5 current knowledge, 6 the omission
/// summary (reserved in tier 1-2). Steps already covered by a record are never
/// expanded again; an uncovered prefix that does not fit beside the digests of
/// earlier records is compacted, whole turns at a time. Only when every step is
/// compacted and the digests still do not fit are the oldest digests omitted
/// (and counted). Pure and deterministic.
pub fn plan(input: &PlanInput<'_>) -> Result<Plan, PlanError> {
    let budget = input.budget.min(MAX_CONTEXT_TOKENS);
    if input.fixed_tokens > budget || input.fixed_message_tokens > MAX_INPUT_BYTES as u64 {
        return Err(PlanError::ContextBudget {
            required: input.fixed_tokens,
            budget,
        });
    }
    let start = input.steps.partition_point(|s| {
        input
            .covered_through
            .is_some_and(|covered| s.ordinal <= covered)
    });
    let uncovered = &input.steps[start..];
    // Candidate cut points: whole turns (a model turn begins a unit) or none.
    let existing_digests: u64 = input.digests.iter().sum();
    let mut cuts: Vec<usize> = (0..uncovered.len())
        .filter(|&i| i == 0 || uncovered[i].kind == StepKind::ModelTurn)
        .collect();
    cuts.push(uncovered.len());
    let mut chosen = None;
    for &k in &cuts {
        let raw = &uncovered[k..];
        let raw_tokens: u64 = raw.iter().map(|s| s.tokens).sum();
        let raw_items: usize = raw.iter().map(|s| s.items).sum();
        if raw_items > MAX_HISTORY_ITEMS || raw_tokens > MAX_HISTORY_BYTES as u64 {
            continue;
        }
        let new_digest = if k > 0 {
            input.new_digest_overhead + uncovered[..k].iter().map(|s| s.digest_tokens).sum::<u64>()
        } else {
            0
        };
        // Steps already represented only by a digest keep that digest: the
        // newest raw steps never displace the record of what came before.
        let used = input.fixed_tokens + raw_tokens + existing_digests;
        if used + new_digest <= budget {
            chosen = Some((k, raw_tokens, new_digest));
            break;
        }
    }
    let (k, raw_tokens, new_digest) = chosen.unwrap_or_else(|| {
        let new = if uncovered.is_empty() {
            0
        } else {
            input.new_digest_overhead + uncovered.iter().map(|s| s.digest_tokens).sum::<u64>()
        };
        (uncovered.len(), 0, new)
    });
    let mut used = input.fixed_tokens + raw_tokens;
    let mut messages = input.fixed_message_tokens;
    let compact = (k > 0).then(|| (uncovered[0].ordinal, uncovered[k - 1].ordinal));
    let new_digest_included = compact.is_some()
        && used + new_digest <= budget
        && messages + new_digest <= MAX_INPUT_BYTES as u64;
    if new_digest_included {
        used += new_digest;
        messages += new_digest;
    }
    let mut digests_included = 0;
    for cost in input.digests.iter().rev() {
        if used + cost > budget || messages + cost > MAX_INPUT_BYTES as u64 {
            break;
        }
        used += cost;
        messages += cost;
        digests_included += 1;
    }
    let knowledge_included = input
        .knowledge
        .iter()
        .map(|cost| {
            let fits = used + cost <= budget && messages + cost <= MAX_INPUT_BYTES as u64;
            if fits {
                used += cost;
                messages += cost;
            }
            fits
        })
        .collect();
    Ok(Plan {
        first_raw: start + k,
        compact,
        new_digest_included,
        digests_included,
        knowledge_included,
        estimated_tokens: used,
        steps_compacted: (start + k) as u32,
    })
}

/// The omission summary (tier 6): counts by category and named stale sources.
pub fn omission_summary(
    omissions: &[(OmissionCategory, u32)],
    stale: &[SourceState],
) -> Option<String> {
    if omissions.is_empty() && stale.is_empty() {
        return None;
    }
    let mut text = String::from(
        "Omitted from this context (platform facts; an omission is not evidence that material is absent):",
    );
    for (category, count) in omissions {
        text.push_str(&format!("\n- {}: {count}", category.as_str()));
    }
    for source in stale.iter().take(MAX_LISTED_STALE_SOURCES) {
        text.push_str(&format!(
            "\n- knowledge {} revision {} is {}; content that depended on it is not included",
            source.id,
            source.revision,
            source.status.as_str()
        ));
    }
    if stale.len() > MAX_LISTED_STALE_SOURCES {
        text.push_str(&format!(
            "\n- {} further stale knowledge revision(s) are not listed",
            stale.len() - MAX_LISTED_STALE_SOURCES
        ));
    }
    Some(text)
}

/// Normalise omission counts: category order, zero counts dropped.
pub fn omissions(counts: &[(OmissionCategory, u32)]) -> Vec<(OmissionCategory, u32)> {
    let mut out: Vec<(OmissionCategory, u32)> = Vec::new();
    for category in OmissionCategory::ALL {
        let total = counts
            .iter()
            .filter(|(c, _)| c == category)
            .fold(0u32, |sum, (_, n)| sum.saturating_add(*n));
        if total > 0 {
            out.push((*category, total));
        }
    }
    out
}

#[cfg(test)]
mod tests;
