//! Bounded membership commands and current-authority ports. Wire records contain
//! administration metadata only, never audit content or session recipient proof.
use serde::{Deserialize, Serialize};
use std::future::Future;
use zobba_domain::{
    identity::valid_scope_id,
    membership::{self, normalize_email},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MembershipError {
    Invalid,
    Denied,
    Conflict,
    LastAdmin,
    InvitationRefused,
    Capacity,
    Unavailable,
}
impl MembershipError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_membership",
            Self::Denied => "access_denied",
            Self::Conflict => "membership_conflict",
            Self::LastAdmin => "last_admin",
            Self::InvitationRefused => "invitation_refused",
            Self::Capacity => "membership_capacity",
            Self::Unavailable => "membership_unavailable",
        }
    }
}
impl std::fmt::Display for MembershipError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for MembershipError {}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Assignment {
    pub client_id: String,
    pub engagement_id: String,
}
/// Save-only intent. Retaining a selection never renews its stored expiry.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssignmentChange {
    pub client_id: String,
    pub engagement_id: String,
    #[serde(default)]
    pub renew: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssignmentOption {
    pub client_id: String,
    pub client_name: String,
    pub engagement_id: String,
    pub engagement_name: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrganisationSummary {
    pub organisation_id: String,
    pub organisation_name: String,
    pub version: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrganisationsPage {
    pub organisations: Vec<OrganisationSummary>,
    pub next_cursor: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    pub assignments_count: u64,
    pub assignments_complete: bool,
    pub actor_id: String,
    pub display_name: String,
    pub roles: Vec<String>,
    pub active: bool,
    pub expires_at: Option<i64>,
    pub assignments: Vec<Assignment>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberAssignment {
    pub client_id: String,
    pub client_name: String,
    pub engagement_id: String,
    pub engagement_name: String,
    pub expires_at: Option<i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberAssignmentsPage {
    pub organisation_id: String,
    pub actor_id: String,
    pub version: String,
    pub total: u64,
    pub assignments: Vec<MemberAssignment>,
    pub next_cursor: Option<String>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssignmentMode {
    #[default]
    Replace,
    Preserve,
    Remove,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Invitation {
    pub id: String,
    pub recipient_email: String,
    pub roles: Vec<String>,
    pub assignments: Vec<Assignment>,
    pub inviter_actor_id: String,
    pub expires_at: i64,
    pub status: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InvitationPreview {
    pub organisation_id: String,
    pub organisation_name: String,
    pub recipient_email: String,
    pub roles: Vec<String>,
    pub assignments: Vec<AssignmentOption>,
    pub expires_at: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub organisation_id: String,
    pub organisation_name: String,
    pub version: String,
    pub members: Vec<Member>,
    pub members_next_cursor: Option<String>,
    pub invitations: Vec<Invitation>,
    pub invitations_next_cursor: Option<String>,
    pub engagements: Vec<AssignmentOption>,
    pub engagements_next_cursor: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveMember {
    #[serde(default)]
    pub assignment_mode: AssignmentMode,
    pub key: String,
    pub expected_version: String,
    pub actor_id: String,
    pub roles: Vec<String>,
    pub active: bool,
    pub expires_at: Option<i64>,
    pub assignments: Vec<AssignmentChange>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InviteCommand {
    pub key: String,
    pub expected_version: String,
    pub recipient_email: String,
    pub roles: Vec<String>,
    pub assignments: Vec<Assignment>,
    pub expires_in_seconds: u32,
    pub secret: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RevokeInvitation {
    pub key: String,
    pub expected_version: String,
    pub invitation_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    pub event_id: String,
    pub organisation_id: String,
    pub actor_id: String,
    pub subject_actor_id: Option<String>,
    pub invitation_id: Option<String>,
    pub version: String,
    pub kind: String,
}

fn valid_assignments(assignments: &[Assignment]) -> bool {
    membership::valid_assignments(
        assignments
            .iter()
            .map(|a| (a.client_id.as_str(), a.engagement_id.as_str())),
    )
}
impl SaveMember {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && membership::valid_version(&self.expected_version)
            && valid_scope_id(&self.actor_id)
            && membership::valid_roles(&self.roles, self.active)
            && membership::valid_assignments(
                self.assignments
                    .iter()
                    .map(|a| (a.client_id.as_str(), a.engagement_id.as_str())),
            )
            && membership::valid_membership_expiry(self.expires_at)
            && match self.assignment_mode {
                AssignmentMode::Replace => true,
                AssignmentMode::Preserve => self.assignments.is_empty(),
                AssignmentMode::Remove => {
                    !self.assignments.is_empty() && self.assignments.iter().all(|a| !a.renew)
                }
            }
    }
}
impl InviteCommand {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && membership::valid_version(&self.expected_version)
            && normalize_email(&self.recipient_email).is_some()
            && membership::valid_roles(&self.roles, true)
            && valid_assignments(&self.assignments)
            && (membership::MIN_INVITATION_SECONDS..=membership::MAX_INVITATION_SECONDS)
                .contains(&self.expires_in_seconds)
            && membership::valid_invitation_secret(&self.secret)
    }
}
impl RevokeInvitation {
    pub fn is_valid(&self) -> bool {
        valid_scope_id(&self.key)
            && membership::valid_version(&self.expected_version)
            && valid_scope_id(&self.invitation_id)
    }
}

pub trait MembershipStore: Send + Sync {
    /// Preview fixed terms only for the currently verified recipient. The
    /// subsequent acceptance independently rechecks every authority predicate.
    fn preview(
        &self,
        actor: &str,
        session_hash: &str,
        secret: &str,
    ) -> impl Future<Output = Result<InvitationPreview, MembershipError>> + Send;
    fn organisations(
        &self,
        actor: &str,
        after: Option<&str>,
    ) -> impl Future<Output = Result<OrganisationsPage, MembershipError>> + Send;
    fn snapshot(
        &self,
        actor: &str,
        organisation: &str,
        members_after: Option<&str>,
        invitations_after: Option<&str>,
        engagements_after: Option<&str>,
    ) -> impl Future<Output = Result<Snapshot, MembershipError>> + Send;
    /// Inspect every effective assignment through bounded pages. Replacement
    /// requires a complete <=100 snapshot; preservation/removal retain off-page grants.
    fn member_assignments(
        &self,
        actor: &str,
        organisation: &str,
        target: &str,
        after: Option<&str>,
    ) -> impl Future<Output = Result<MemberAssignmentsPage, MembershipError>> + Send;
    fn save_member(
        &self,
        actor: &str,
        organisation: &str,
        command: &SaveMember,
    ) -> impl Future<Output = Result<Receipt, MembershipError>> + Send;
    fn invite(
        &self,
        actor: &str,
        organisation: &str,
        command: &InviteCommand,
    ) -> impl Future<Output = Result<Receipt, MembershipError>> + Send;
    fn revoke_invitation(
        &self,
        actor: &str,
        organisation: &str,
        command: &RevokeInvitation,
    ) -> impl Future<Output = Result<Receipt, MembershipError>> + Send;
    /// The adapter rechecks the exact server session, signed issuer/email and
    /// five-minute claim verification inside the transaction. A retry returns
    /// only the historical receipt and never restores revoked authority.
    fn accept(
        &self,
        actor: &str,
        session_hash: &str,
        secret: &str,
        key: &str,
    ) -> impl Future<Output = Result<Receipt, MembershipError>> + Send;
}
