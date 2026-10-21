//! Installed techniques are immutable attributable content, never authority.
//! Resources are bounded UTF-8 data. No executable, filesystem, URL-fetching or
//! operation-admission interface exists in this module.
use std::collections::BTreeSet;

use crate::{
    identity::{valid_scope_id, valid_scope_label},
    methodology::{Applicability, ResolutionStatus, TaskContext, valid_text},
    permissions::{Action, CapabilityNeed, Purpose},
};

pub const MANIFEST_VERSION: u16 = 1;
pub const MAX_INPUTS: usize = 32;
pub const MAX_OUTPUTS: usize = 32;
pub const MAX_NEEDS: usize = 16;
pub const MAX_METHOD_VERSIONS: usize = 32;
pub const MAX_RESOURCES: usize = 16;
pub const MAX_RESOURCE_BYTES: usize = 32_768;
pub const MAX_RESOURCE_TOTAL_BYTES: usize = 131_072;
pub const MAX_MANIFEST_BYTES: usize = 200_000;

/// This vocabulary is owned by the server. A manifest cannot add a mapping or
/// assert that an adapter is qualified. Analysis is recognized but unsupported.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolId {
    LiveReadV1,
    TestReadV1,
    TestWriteV1,
    TestSendV1,
    AuditReadV1,
    AuditWriteV1,
    AuditSendV1,
    AnalysisV1,
}

impl ToolId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LiveReadV1 => "live_read_v1",
            Self::TestReadV1 => "test_read_v1",
            Self::TestWriteV1 => "test_write_v1",
            Self::TestSendV1 => "test_send_v1",
            Self::AuditReadV1 => "audit_read_v1",
            Self::AuditWriteV1 => "audit_write_v1",
            Self::AuditSendV1 => "audit_send_v1",
            Self::AnalysisV1 => "analysis_v1",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "live_read_v1" => Some(Self::LiveReadV1),
            "test_read_v1" => Some(Self::TestReadV1),
            "test_write_v1" => Some(Self::TestWriteV1),
            "test_send_v1" => Some(Self::TestSendV1),
            "audit_read_v1" => Some(Self::AuditReadV1),
            "audit_write_v1" => Some(Self::AuditWriteV1),
            "audit_send_v1" => Some(Self::AuditSendV1),
            "analysis_v1" => Some(Self::AnalysisV1),
            _ => None,
        }
    }

    pub const fn mapping(self) -> Option<(Purpose, Action)> {
        match self {
            Self::LiveReadV1 => Some((Purpose::LiveInspection, Action::Read)),
            Self::TestReadV1 => Some((Purpose::TestWorkflows, Action::Read)),
            Self::TestWriteV1 => Some((Purpose::TestWorkflows, Action::Write)),
            Self::TestSendV1 => Some((Purpose::TestWorkflows, Action::Send)),
            Self::AuditReadV1 => Some((Purpose::AuditCoordination, Action::Read)),
            Self::AuditWriteV1 => Some((Purpose::AuditCoordination, Action::Write)),
            Self::AuditSendV1 => Some((Purpose::AuditCoordination, Action::Send)),
            Self::AnalysisV1 => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Source {
    pub reference: String,
    pub revision: String,
    pub license: String,
}

impl Source {
    pub fn is_valid(&self) -> bool {
        [&self.reference, &self.revision, &self.license]
            .into_iter()
            .all(|value| valid_text(value))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Input {
    pub id: String,
    pub label: String,
    /// Declared input requirement; does not assert that concrete material,
    /// attachments, classifications or evidence have been supplied or trusted.
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ToolNeed {
    pub id: String,
    pub tool: ToolId,
    pub account_id: Option<String>,
    pub environment_id: Option<String>,
    pub destination: Option<String>,
    pub resource_id: Option<String>,
    pub recipients: Vec<String>,
    pub attachment_classifications: Vec<String>,
    pub requires_attachments: bool,
}

impl ToolNeed {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.id)
            && [
                &self.account_id,
                &self.environment_id,
                &self.destination,
                &self.resource_id,
            ]
            .into_iter()
            .all(|value| value.as_deref().is_none_or(valid_scope_id))
            && ordered_ids(&self.recipients, crate::permissions::SET_MAX)
            && ordered_ids(
                &self.attachment_classifications,
                crate::permissions::SET_MAX,
            )
    }

    /// Only a server-owned tool mapping establishes purpose/action. The caller
    /// must separately establish adapter qualification before querying policy.
    /// No CanonicalOperation is manufactured by this projection.
    pub fn capability_need(&self) -> Option<CapabilityNeed> {
        if !self.is_valid() {
            return None;
        }
        let (purpose, action) = self.tool.mapping()?;
        Some(CapabilityNeed {
            purpose,
            action,
            account_id: self.account_id.clone(),
            environment_id: self.environment_id.clone(),
            destination: self.destination.clone(),
            resource_id: self.resource_id.clone(),
            recipients: self.recipients.clone(),
            attachment_classifications: self.attachment_classifications.clone(),
            requires_attachments: self.requires_attachments,
            source: None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceKind {
    Text,
    Script,
}

impl ResourceKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Script => "script",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "text" => Some(Self::Text),
            "script" => Some(Self::Script),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Resource {
    pub id: String,
    pub kind: ResourceKind,
    pub content: String,
}

impl Resource {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.id)
            && !self.content.trim().is_empty()
            && self.content.len() <= MAX_RESOURCE_BYTES
            && !self
                .content
                .chars()
                .any(|value| value.is_control() && !matches!(value, '\n' | '\r' | '\t'))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    pub schema_version: u16,
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub source: Source,
    pub inputs: Vec<Input>,
    pub outputs: Vec<String>,
    /// All needs are conjunctive. A forbidden/unsupported need is never dropped.
    pub needs: Vec<ToolNeed>,
    /// Every listed exact methodology version must be present in the Task's
    /// current resolution. An empty list permits independent techniques.
    pub method_version_ids: Vec<String>,
    pub resources: Vec<Resource>,
}

impl Manifest {
    pub fn is_valid(&self) -> bool {
        self.valid_structure() && self.encode().len() <= MAX_MANIFEST_BYTES
    }

    fn valid_structure(&self) -> bool {
        self.schema_version == MANIFEST_VERSION
            && valid_scope_id(&self.id)
            && valid_scope_id(&self.version)
            && valid_scope_label(&self.name)
            && valid_text(&self.description)
            && self.source.is_valid()
            && self.inputs.len() <= MAX_INPUTS
            && self
                .inputs
                .iter()
                .all(|input| valid_scope_id(&input.id) && valid_scope_label(&input.label))
            && unique_ids(self.inputs.iter().map(|input| input.id.as_str()))
            && self.outputs.len() <= MAX_OUTPUTS
            && self.outputs.iter().all(|output| valid_text(output))
            && self.needs.len() <= MAX_NEEDS
            && self.needs.iter().all(ToolNeed::is_valid)
            && unique_ids(self.needs.iter().map(|need| need.id.as_str()))
            && ordered_ids(&self.method_version_ids, MAX_METHOD_VERSIONS)
            && self.resources.len() <= MAX_RESOURCES
            && self.resources.iter().all(Resource::is_valid)
            && unique_ids(self.resources.iter().map(|resource| resource.id.as_str()))
            && self
                .resources
                .iter()
                .map(|resource| resource.content.len())
                .sum::<usize>()
                <= MAX_RESOURCE_TOTAL_BYTES
    }

    /// Versioned, length-framed UTF-8 encoding. Infrastructure hashes these exact
    /// bytes with SHA-256, and each resource's content bytes separately. No trim,
    /// Unicode normalization, newline rewriting or source retrieval occurs.
    pub fn canonical_bytes(&self) -> Option<Vec<u8>> {
        if !self.valid_structure() {
            return None;
        }
        let bytes = self.encode();
        (bytes.len() <= MAX_MANIFEST_BYTES).then_some(bytes)
    }

    fn encode(&self) -> Vec<u8> {
        fn field(out: &mut Vec<u8>, value: &str) {
            out.extend_from_slice(&(value.len() as u32).to_be_bytes());
            out.extend_from_slice(value.as_bytes());
        }
        fn count(out: &mut Vec<u8>, value: usize) {
            out.extend_from_slice(&(value as u32).to_be_bytes());
        }
        fn strings(out: &mut Vec<u8>, values: &[String]) {
            count(out, values.len());
            for value in values {
                field(out, value);
            }
        }
        let mut out = b"zobba-skill-manifest\0".to_vec();
        out.extend_from_slice(&self.schema_version.to_be_bytes());
        for value in [
            &self.id,
            &self.version,
            &self.name,
            &self.description,
            &self.source.reference,
            &self.source.revision,
            &self.source.license,
        ] {
            field(&mut out, value);
        }
        count(&mut out, self.inputs.len());
        for input in &self.inputs {
            field(&mut out, &input.id);
            field(&mut out, &input.label);
            out.push(u8::from(input.required));
        }
        strings(&mut out, &self.outputs);
        count(&mut out, self.needs.len());
        for need in &self.needs {
            field(&mut out, &need.id);
            field(&mut out, need.tool.as_str());
            for value in [
                &need.account_id,
                &need.environment_id,
                &need.destination,
                &need.resource_id,
            ] {
                out.push(u8::from(value.is_some()));
                if let Some(value) = value {
                    field(&mut out, value);
                }
            }
            strings(&mut out, &need.recipients);
            strings(&mut out, &need.attachment_classifications);
            out.push(u8::from(need.requires_attachments));
        }
        strings(&mut out, &self.method_version_ids);
        count(&mut out, self.resources.len());
        for resource in &self.resources {
            field(&mut out, &resource.id);
            field(&mut out, resource.kind.as_str());
            field(&mut out, &resource.content);
        }
        out
    }
}

fn unique_ids<'a>(mut values: impl Iterator<Item = &'a str>) -> bool {
    let mut seen = BTreeSet::new();
    values.all(|value| seen.insert(value))
}

fn ordered_ids(values: &[String], max: usize) -> bool {
    values.len() <= max
        && values.iter().all(|value| valid_scope_id(value))
        && values.windows(2).all(|pair| pair[0] < pair[1])
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MethodCompatibility {
    Applicable,
    Inapplicable,
    Unavailable,
}

/// Call with the immutable *current* binding resolution, never its candidate
/// pool or newly resolved catalogue assignments. Pending/recall fences remain
/// independent current-use checks performed by the repository.
pub fn method_compatibility(
    manifest: &Manifest,
    applicability: &Applicability,
    context: &TaskContext,
    status: ResolutionStatus,
    version_ids: &[String],
) -> MethodCompatibility {
    if !manifest.is_valid() || !applicability.is_valid() || !context.is_valid() {
        return MethodCompatibility::Unavailable;
    }
    if let (Some(expected), Some(actual)) = (&applicability.audit_area, &context.audit_area)
        && expected != actual
    {
        return MethodCompatibility::Inapplicable;
    }
    if let (Some(start), Some(end), Some(actual_start), Some(actual_end)) = (
        &applicability.period_start,
        &applicability.period_end,
        &context.period_start,
        &context.period_end,
    ) && (actual_end < start || actual_start > end)
    {
        return MethodCompatibility::Inapplicable;
    }
    if applicability.audit_area.is_some() && context.audit_area.is_none()
        || applicability.period_start.is_some() && context.period_start.is_none()
    {
        return MethodCompatibility::Unavailable;
    }
    if let (Some(start), Some(end), Some(actual_start), Some(actual_end)) = (
        &applicability.period_start,
        &applicability.period_end,
        &context.period_start,
        &context.period_end,
    ) && (actual_start < start || actual_end > end)
    {
        return MethodCompatibility::Unavailable;
    }
    if manifest
        .method_version_ids
        .iter()
        .any(|version| !version_ids.contains(version))
    {
        return MethodCompatibility::Inapplicable;
    }
    if !manifest.method_version_ids.is_empty() && status != ResolutionStatus::Resolved {
        return MethodCompatibility::Unavailable;
    }
    MethodCompatibility::Applicable
}

#[cfg(test)]
mod tests;
