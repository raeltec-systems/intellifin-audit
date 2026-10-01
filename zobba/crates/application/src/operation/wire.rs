//! Application-owned durable serialization. These wrappers do not validate trust
//! or authority: repositories must bound input bytes and call domain validation
//! after decoding. Unknown fields and enum values are refused. Public HTTP models
//! may encode wide integers as decimal strings independently of these stored bytes.
use serde::{Deserialize, Serialize};
use zobba_domain::{identity::Scope, permissions::*, task::ClaimBasis};

#[derive(Serialize, Deserialize)]
#[serde(remote = "Purpose", rename_all = "snake_case")]
enum PurposeWire {
    LiveInspection,
    TestWorkflows,
    AuditCoordination,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "Action", rename_all = "snake_case")]
enum ActionWire {
    Read,
    Write,
    Send,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "PolicyKind", rename_all = "snake_case")]
enum PolicyKindWire {
    Organisation,
    Engagement,
    Member,
    Account,
    Task,
    Delegation,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "EnvironmentKind", rename_all = "snake_case")]
enum EnvironmentKindWire {
    Live,
    Test,
    Audit,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "ReadRestriction", rename_all = "snake_case")]
enum ReadRestrictionWire {
    None,
    SourceReadOnly,
    ValidatedAdapter,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "OperationState", rename_all = "snake_case")]
enum OperationStateWire {
    NeedsDecision,
    Ready,
    PossiblyDispatched,
    Accepted,
    Completed,
    Absent,
    Revoked,
}

#[derive(Serialize, Deserialize)]
#[serde(remote = "SourceFact", rename_all = "snake_case")]
enum SourceFactWire {
    Unknown,
    Accepted,
    Completed,
    AuthoritativelyAbsent,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredFact(#[serde(with = "SourceFactWire")] pub SourceFact);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Scope", deny_unknown_fields)]
struct ScopeWire {
    organisation_id: String,
    client_id: String,
    engagement_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredScope(#[serde(with = "ScopeWire")] pub Scope);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Attachment", deny_unknown_fields)]
struct AttachmentWire {
    id: String,
    digest: String,
    classification: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredAttachment(#[serde(with = "AttachmentWire")] pub Attachment);

#[derive(Serialize, Deserialize)]
#[serde(remote = "CanonicalOperation", deny_unknown_fields)]
struct CanonicalOperationWire {
    version: u16,
    #[serde(with = "PurposeWire")]
    purpose: Purpose,
    #[serde(with = "ActionWire")]
    action: Action,
    account_id: String,
    environment_id: String,
    destination: String,
    recipients: Vec<String>,
    material: String,
    material_digest: String,
    #[serde(with = "attachments")]
    attachments: Vec<Attachment>,
    resource_id: String,
    resource_version: String,
    expires_at: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredCanonical(#[serde(with = "CanonicalOperationWire")] pub CanonicalOperation);

#[derive(Serialize, Deserialize)]
#[serde(remote = "PermissionRule", deny_unknown_fields)]
struct PermissionRuleWire {
    #[serde(with = "PurposeWire")]
    purpose: Purpose,
    #[serde(with = "ActionWire")]
    action: Action,
    account_id: String,
    environment_id: String,
    destination: String,
    resource_id: String,
    recipients: Vec<String>,
    attachment_classifications: Vec<String>,
    expires_at: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredRule(#[serde(with = "PermissionRuleWire")] pub PermissionRule);

#[derive(Serialize, Deserialize)]
#[serde(remote = "PermissionBounds", deny_unknown_fields)]
struct PermissionBoundsWire {
    #[serde(with = "rules")]
    rules: Vec<PermissionRule>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredBounds(#[serde(with = "PermissionBoundsWire")] pub PermissionBounds);

#[derive(Serialize, Deserialize)]
#[serde(remote = "SourceBinding", deny_unknown_fields)]
struct SourceBindingWire {
    source_id: String,
    ledger_id: String,
    endpoint_digest: String,
    contract_version: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredSource(#[serde(with = "SourceBindingWire")] pub SourceBinding);

#[derive(Serialize, Deserialize)]
#[serde(remote = "AccountRestriction", deny_unknown_fields)]
struct AccountRestrictionWire {
    #[serde(with = "SourceBindingWire")]
    source: SourceBinding,
    account_id: String,
    environment_id: String,
    #[serde(with = "EnvironmentKindWire")]
    environment: EnvironmentKind,
    #[serde(with = "ReadRestrictionWire")]
    read_restriction: ReadRestriction,
    restriction_survives_takeover: bool,
    test_environment_verified: bool,
    test_resources: Vec<String>,
    test_cleanup_id: Option<String>,
    audit_resources: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredAccount(#[serde(with = "AccountRestrictionWire")] pub AccountRestriction);

#[derive(Serialize, Deserialize)]
#[serde(remote = "PolicyReference", deny_unknown_fields)]
struct PolicyReferenceWire {
    #[serde(with = "PolicyKindWire")]
    kind: PolicyKind,
    subject_id: String,
    version: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredReference(#[serde(with = "PolicyReferenceWire")] pub PolicyReference);

#[derive(Serialize, Deserialize)]
#[serde(remote = "PolicyDocument", deny_unknown_fields)]
struct PolicyDocumentWire {
    schema_version: u16,
    #[serde(with = "PolicyKindWire")]
    kind: PolicyKind,
    subject_id: String,
    version: u64,
    actor_id: String,
    created_at: i64,
    revoked: bool,
    #[serde(with = "PermissionBoundsWire")]
    hard: PermissionBounds,
    #[serde(with = "PermissionBoundsWire")]
    standing: PermissionBounds,
    #[serde(with = "optional_account")]
    account: Option<AccountRestriction>,
    #[serde(with = "optional_parent")]
    parent: Option<PolicyReference>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredPolicy(#[serde(with = "PolicyDocumentWire")] pub PolicyDocument);

#[derive(Serialize, Deserialize)]
#[serde(remote = "AuthoritySnapshot", deny_unknown_fields)]
struct AuthoritySnapshotWire {
    #[serde(with = "ScopeWire")]
    scope: Scope,
    actor_id: String,
    task_id: String,
    #[serde(with = "PolicyDocumentWire")]
    organisation: PolicyDocument,
    #[serde(with = "PolicyDocumentWire")]
    engagement: PolicyDocument,
    #[serde(with = "PolicyDocumentWire")]
    member: PolicyDocument,
    #[serde(with = "PolicyDocumentWire")]
    account: PolicyDocument,
    #[serde(with = "PolicyDocumentWire")]
    task: PolicyDocument,
    #[serde(with = "delegations")]
    delegations: Vec<PolicyDocument>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredAuthority(#[serde(with = "AuthoritySnapshotWire")] pub AuthoritySnapshot);

#[derive(Serialize, Deserialize)]
#[serde(remote = "ClaimBasis", deny_unknown_fields)]
struct ClaimBasisWire {
    actor_id: String,
    #[serde(with = "ScopeWire")]
    scope: Scope,
    task_id: String,
    cycle_id: String,
    claim_id: String,
    worker_id: String,
    process_instance: String,
    owner_epoch: i64,
    execution_epoch: i64,
    intent_revision: i64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredBasis(#[serde(with = "ClaimBasisWire")] pub ClaimBasis);

#[derive(Serialize, Deserialize)]
#[serde(remote = "DecisionCommand", deny_unknown_fields)]
struct DecisionCommandWire {
    key: String,
    operation_id: String,
    expected_revision: u64,
    #[serde(with = "CanonicalOperationWire")]
    request: CanonicalOperation,
    expires_at: i64,
    allow: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredDecision(#[serde(with = "DecisionCommandWire")] pub DecisionCommand);

#[derive(Serialize, Deserialize)]
#[serde(remote = "OperationDecision", deny_unknown_fields)]
struct OperationDecisionWire {
    id: String,
    operation_id: String,
    actor_id: String,
    request_digest: String,
    expected_revision: u64,
    expires_at: i64,
    allowed: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredOperationDecision(#[serde(with = "OperationDecisionWire")] pub OperationDecision);

#[derive(Serialize, Deserialize)]
#[serde(remote = "Operation", deny_unknown_fields)]
struct OperationWire {
    #[serde(with = "SourceBindingWire")]
    source: SourceBinding,
    id: String,
    task_id: String,
    cycle_id: String,
    actor_id: String,
    #[serde(with = "CanonicalOperationWire")]
    request: CanonicalOperation,
    request_digest: String,
    revision: u64,
    #[serde(with = "OperationStateWire")]
    state: OperationState,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredOperation(#[serde(with = "OperationWire")] pub Operation);

#[derive(Serialize, Deserialize)]
#[serde(remote = "RevocationCommand", deny_unknown_fields)]
struct RevocationCommandWire {
    key: String,
    #[serde(with = "PolicyKindWire")]
    kind: PolicyKind,
    subject_id: String,
    expected_version: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredRevocation(#[serde(with = "RevocationCommandWire")] pub RevocationCommand);

mod attachments {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[Attachment],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredAttachment)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<Attachment>, D::Error> {
        Ok(Vec::<StoredAttachment>::deserialize(deserializer)?
            .into_iter()
            .map(|v| v.0)
            .collect())
    }
}
mod rules {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[PermissionRule],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredRule)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<PermissionRule>, D::Error> {
        Ok(Vec::<StoredRule>::deserialize(deserializer)?
            .into_iter()
            .map(|v| v.0)
            .collect())
    }
}
mod delegations {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &[PolicyDocument],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .iter()
            .cloned()
            .map(StoredPolicy)
            .collect::<Vec<_>>()
            .serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<PolicyDocument>, D::Error> {
        Ok(Vec::<StoredPolicy>::deserialize(deserializer)?
            .into_iter()
            .map(|v| v.0)
            .collect())
    }
}
mod optional_account {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &Option<AccountRestriction>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.clone().map(StoredAccount).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<AccountRestriction>, D::Error> {
        Ok(Option::<StoredAccount>::deserialize(deserializer)?.map(|v| v.0))
    }
}
mod optional_parent {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &Option<PolicyReference>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.clone().map(StoredReference).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<PolicyReference>, D::Error> {
        Ok(Option::<StoredReference>::deserialize(deserializer)?.map(|v| v.0))
    }
}
