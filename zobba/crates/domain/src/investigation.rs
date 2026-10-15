//! Story 22.6: how the agent uses the Task's bound method and installed skills
//! during investigation. Everything here is pure vocabulary and validation:
//! method and skill text is attributed data, a note never marks a requirement
//! complete, and nothing in this module can admit a tool or grant authority.
use crate::identity::valid_scope_id;

/// Parts the agent may fetch in one turn (method parts and skill resources).
pub const MAX_PART_REQUESTS: usize = 8;
/// Skills the agent may load in one turn.
pub const MAX_SKILL_LOADS: usize = 4;
/// Skill scripts the agent may ask to run in one turn.
pub const MAX_SCRIPT_RUNS: usize = 2;
/// Registered originals one skill script may read.
pub const MAX_SCRIPT_INPUTS: usize = 8;
/// Method notes one answer may carry.
pub const MAX_METHOD_NOTES: usize = 32;
/// UTF-8 bytes of one note's text.
pub const MAX_NOTE_BYTES: usize = 1_000;
/// Answer segments one statement may point at for its citations.
pub const MAX_NOTE_SEGMENTS: usize = 8;
/// UTF-8 bytes of one part identifier.
pub const MAX_PART_ID_BYTES: usize = 400;

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

// What a method note says. A statement is shown as "Zobba says" with the
// verification of the citations it points at; nothing is ever "complete".
vocabulary!(NoteKind {
    Gap => "gap",
    Question => "question",
    Statement => "statement",
});

// Why a requirement could not be followed. Closed: free text never replaces it.
vocabulary!(GapReason {
    EvidenceUnavailable => "evidence_unavailable",
    ActionNotPermitted => "action_not_permitted",
    ToolUnavailable => "tool_unavailable",
    CriteriaMissing => "criteria_missing",
    SkillUnavailable => "skill_unavailable",
});

// Who recorded a note: the agent's structured answer or deterministic platform
// facts (a mandatory requirement without criteria, an unavailable skill).
vocabulary!(NoteSource {
    Agent => "agent",
    Platform => "platform",
});

// One recorded use of an installed skill.
vocabulary!(UseKind {
    Load => "load",
    Resource => "resource",
    Script => "script",
});

vocabulary!(UseOutcome {
    Loaded => "loaded",
    Fetched => "fetched",
    Completed => "completed",
    Failed => "failed",
    Unavailable => "unavailable",
});

// Closed reasons a skill use was not performed or did not produce a result.
vocabulary!(UseReason {
    NotListed => "not_listed",
    ToolUnavailable => "tool_unavailable",
    Forbidden => "forbidden",
    Disabled => "disabled",
    Recalled => "recalled",
    Inapplicable => "inapplicable",
    MethodologyBlocked => "methodology_blocked",
    TaskBlocked => "task_blocked",
    NotLoaded => "not_loaded",
    ResourceMissing => "resource_missing",
    NotAScript => "not_a_script",
    InputNotRegistered => "input_not_registered",
    InvalidProgram => "invalid_program",
    ProgramFailed => "program_failed",
    ProgramLimit => "program_limit",
});

impl UseOutcome {
    /// Outcomes that carry a closed reason.
    pub const fn has_reason(self) -> bool {
        matches!(self, Self::Failed | Self::Unavailable)
    }
}

fn text_ok(value: &str, max: usize) -> bool {
    !value.trim().is_empty()
        && value.len() <= max
        && !value
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
}

/// One gap, contextual question or statement about one method requirement.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MethodNote {
    /// The requirement it is about; None for a note about the method as a whole.
    pub requirement_id: Option<String>,
    pub kind: NoteKind,
    pub text: String,
    /// Present exactly for a gap.
    pub reason: Option<GapReason>,
    /// Answer segments whose citations support a statement, strictly ordered.
    pub segments: Vec<u32>,
}

impl MethodNote {
    pub fn is_valid(&self) -> bool {
        self.requirement_id.as_deref().is_none_or(valid_scope_id)
            && text_ok(&self.text, MAX_NOTE_BYTES)
            && (self.kind == NoteKind::Gap) == self.reason.is_some()
            && (self.kind == NoteKind::Statement || self.segments.is_empty())
            && self.segments.len() <= MAX_NOTE_SEGMENTS
            && self.segments.windows(2).all(|w| w[0] < w[1])
    }
}

/// A skill script the agent asks to run in the isolated analysis sandbox over
/// registered originals. Running it is never authority for anything else.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScriptRequest {
    pub version_id: String,
    pub resource_id: String,
    /// Strictly ordered, distinct registered original IDs.
    pub inputs: Vec<String>,
}

impl ScriptRequest {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.version_id)
            && valid_scope_id(&self.resource_id)
            && !self.inputs.is_empty()
            && self.inputs.len() <= MAX_SCRIPT_INPUTS
            && self.inputs.iter().all(|i| valid_scope_id(i))
            && self.inputs.windows(2).all(|w| w[0] < w[1])
    }
}

/// A part of the bound method or of a loaded skill the agent may fetch on
/// demand. Identifiers are built from owned identifiers only.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Part {
    /// The full criteria text of one requirement.
    Criteria(String),
    /// The populations, evidence checks, ratings and review rules of one requirement.
    Procedure(String),
    /// One resolved template, by template ID and version.
    Template(String, String),
    /// One resource of an installed skill version, by resource ID.
    SkillResource(String, String),
}

impl Part {
    pub fn id(&self) -> String {
        match self {
            Self::Criteria(requirement) => format!("criteria/{requirement}"),
            Self::Procedure(requirement) => format!("procedure/{requirement}"),
            Self::Template(id, version) => format!("template/{id}/{version}"),
            Self::SkillResource(version, resource) => format!("skill/{version}/{resource}"),
        }
    }
    pub fn parse(value: &str) -> Option<Self> {
        if value.len() > MAX_PART_ID_BYTES {
            return None;
        }
        let parts: Vec<&str> = value.split('/').collect();
        if !parts[1..].iter().all(|p| valid_scope_id(p)) {
            return None;
        }
        match parts.as_slice() {
            ["criteria", requirement] => Some(Self::Criteria((*requirement).into())),
            ["procedure", requirement] => Some(Self::Procedure((*requirement).into())),
            ["template", id, version] => Some(Self::Template((*id).into(), (*version).into())),
            ["skill", version, resource] => {
                Some(Self::SkillResource((*version).into(), (*resource).into()))
            }
            _ => None,
        }
    }
    pub const fn is_skill(&self) -> bool {
        matches!(self, Self::SkillResource(..))
    }
}

/// Whether a part identifier is well formed (its target may still not exist).
pub fn valid_part_id(value: &str) -> bool {
    Part::parse(value).is_some_and(|part| part.id() == value)
}

#[cfg(test)]
mod tests;
