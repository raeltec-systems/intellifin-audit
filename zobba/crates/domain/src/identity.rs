//! Identity and current application authority. Provider roles are never authority.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Identity {
    pub id: String,
    pub display_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Scope {
    pub organisation_id: String,
    pub client_id: String,
    pub engagement_id: String,
}

pub const SCOPE_ID_MAX: usize = 128;
pub const SCOPE_LABEL_MAX: usize = 200;
pub const ENGAGEMENT_PAGE_SIZE: usize = 50;

pub fn valid_scope_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= SCOPE_ID_MAX
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

/// Unicode scalar count and Unicode White_Space edges; C0/C1 controls are invalid.
/// SQL and browser validation use the same explicit character ranges.
pub fn valid_scope_label(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= SCOPE_LABEL_MAX
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

impl Scope {
    pub fn is_valid(&self) -> bool {
        [&self.organisation_id, &self.client_id, &self.engagement_id]
            .iter()
            .all(|id| valid_scope_id(id))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngagementPage {
    pub engagements: Vec<Engagement>,
    pub next_cursor: Option<Scope>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuditRole {
    Auditor,
    AuditManager,
    Admin,
}

impl AuditRole {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "auditor" => Some(Self::Auditor),
            "audit_manager" => Some(Self::AuditManager),
            "admin" => Some(Self::Admin),
            _ => None,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Auditor => "auditor",
            Self::AuditManager => "audit_manager",
            Self::Admin => "admin",
        }
    }
}

pub fn has_audit_authority(roles: &[AuditRole]) -> bool {
    roles
        .iter()
        .any(|role| matches!(role, AuditRole::Auditor | AuditRole::AuditManager))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Engagement {
    pub scope: Scope,
    pub organisation_name: String,
    pub client_name: String,
    pub engagement_name: String,
    pub roles: Vec<AuditRole>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_bounds_match_unicode_and_ascii_contracts() {
        assert!(valid_scope_id(&"a".repeat(128)));
        for bad in [
            String::new(),
            "a".repeat(129),
            "scope/id".into(),
            "scope id".into(),
            "é".into(),
        ] {
            assert!(!valid_scope_id(&bad));
        }
        assert!(valid_scope_label(&"界".repeat(200)));
        for bad in [
            String::new(),
            "界".repeat(201),
            "\u{0085}label".into(),
            "label\u{00a0}".into(),
            "label\u{0001}".into(),
            "\u{3000}".into(),
        ] {
            assert!(!valid_scope_label(&bad));
        }
        assert!(valid_scope_label("Audit · 2026"));
    }
    #[test]
    fn administrative_roles_never_imply_audit_authority() {
        assert!(!has_audit_authority(&[]));
        assert!(!has_audit_authority(&[AuditRole::Admin]));
        assert!(has_audit_authority(&[AuditRole::Admin, AuditRole::Auditor]));
        assert!(has_audit_authority(&[AuditRole::AuditManager]));
        assert_eq!(AuditRole::parse("provider-admin"), None);
    }
}
