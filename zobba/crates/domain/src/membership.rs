//! Organisation administration is separate from audit authority.
use crate::identity::{AuditRole, valid_scope_id};

pub const PAGE_SIZE: usize = 50;
pub const MAX_ASSIGNMENTS: usize = 100;
/// Last representable browser membership expiry: 9999-12-31T23:59:59Z.
pub const MAX_MEMBERSHIP_EXPIRY: i64 = 253_402_300_799;

pub fn valid_membership_expiry(value: Option<i64>) -> bool {
    value.is_none_or(|expiry| (1..=MAX_MEMBERSHIP_EXPIRY).contains(&expiry))
}
pub const MIN_INVITATION_SECONDS: u32 = 300;
pub const MAX_INVITATION_SECONDS: u32 = 7 * 24 * 60 * 60;
pub const RECIPIENT_PROOF_SECONDS: i64 = 300;

/// Preserve the case-sensitive local part. Only the ASCII domain is folded.
/// This deliberately supports a bounded ordinary address rather than display
/// names, quoted local parts, internationalised domains or provider aliases.
pub fn normalize_email(value: &str) -> Option<String> {
    if value.len() > 254 || !value.is_ascii() {
        return None;
    }
    let (local, domain) = value.split_once('@')?;
    if local.is_empty()
        || local.len() > 64
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
        || !local
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".!#$%&'*+-/=?^_`{|}~".contains(&byte))
        || domain.is_empty()
        || domain.len() > 253
        || domain.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        return None;
    }
    Some(format!("{local}@{}", domain.to_ascii_lowercase()))
}

pub fn valid_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 19
        && (value == "0" || !value.starts_with('0'))
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && value.parse::<i64>().is_ok_and(|version| version >= 0)
}

pub fn valid_roles(roles: &[String], active: bool) -> bool {
    roles.len() <= 3
        && (!active || !roles.is_empty())
        && roles.iter().all(|role| AuditRole::parse(role).is_some())
        && roles
            .iter()
            .enumerate()
            .all(|(index, role)| !roles[..index].contains(role))
}

pub fn valid_assignments<'a>(values: impl IntoIterator<Item = (&'a str, &'a str)>) -> bool {
    let assignments: Vec<_> = values.into_iter().take(MAX_ASSIGNMENTS + 1).collect();
    assignments.len() <= MAX_ASSIGNMENTS
        && assignments
            .iter()
            .all(|(client, engagement)| valid_scope_id(client) && valid_scope_id(engagement))
        && assignments
            .iter()
            .enumerate()
            .all(|(index, assignment)| !assignments[..index].contains(assignment))
}

pub fn valid_invitation_secret(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recipient_identity_preserves_local_case_and_rejects_ambiguous_addresses() {
        assert_eq!(
            normalize_email("Named.Person@EXAMPLE.COM"),
            Some("Named.Person@example.com".into())
        );
        assert_ne!(
            normalize_email("Named@example.com"),
            normalize_email("named@example.com")
        );
        for value in [
            "a@",
            "@example.com",
            " a@example.com",
            "a@example.com\n",
            "a@@example.com",
            "a@-example.com",
            "a@example..com",
            ".a@example.com",
            "a..b@example.com",
            "é@example.com",
            "\"a\"@example.com",
        ] {
            assert_eq!(normalize_email(value), None, "{value:?}");
        }
    }
    #[test]
    fn expiry_bounds_match_the_owned_wire_timestamp_range() {
        assert!(valid_membership_expiry(None));
        assert!(valid_membership_expiry(Some(1)));
        assert!(valid_membership_expiry(Some(MAX_MEMBERSHIP_EXPIRY)));
        for invalid in [-1, 0, MAX_MEMBERSHIP_EXPIRY + 1, i64::MAX] {
            assert!(!valid_membership_expiry(Some(invalid)));
        }
    }
    #[test]
    fn commands_are_bounded_and_roles_do_not_invent_authority() {
        assert!(valid_roles(&["admin".into()], true));
        assert!(!valid_roles(&["provider-admin".into()], true));
        assert!(!valid_roles(&["admin".into(), "admin".into()], true));
        assert!(!valid_roles(&[], true));
        assert!(valid_roles(&[], false));
        assert!(valid_version("0"));
        assert!(valid_version("9223372036854775807"));
        for value in ["", "01", "-1", "1.0", "9223372036854775808"] {
            assert!(!valid_version(value));
        }
        assert!(!valid_assignments([
            ("client", "engagement"),
            ("client", "engagement")
        ]));
        assert!(!valid_assignments([("foreign/client", "engagement")]));
        assert!(valid_invitation_secret(&"a".repeat(43)));
        assert!(!valid_invitation_secret(&"a".repeat(44)));
    }
}
