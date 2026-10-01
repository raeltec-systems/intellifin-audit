//! The published client contract and actual request adapters share one bounded vocabulary.
use serde_json::{Value, json};
use utoipa::OpenApi;
use zobba_api::membership::{InviteMemberRequest, SaveMemberRequest};
use zobba_application::membership::{InviteCommand, SaveMember};
use zobba_domain::membership::MAX_MEMBERSHIP_EXPIRY;

fn save() -> Value {
    json!({
        "key":"save-1", "expected_version":"0", "actor_id":"member-1",
        "roles":["auditor"], "active":true, "expires_at":null, "assignments":[],
    })
}

fn valid_save(value: Value) -> bool {
    serde_json::from_value::<SaveMemberRequest>(value)
        .is_ok_and(|request| SaveMember::from(request).is_valid())
}

#[test]
fn membership_save_rejects_invalid_vocabulary_versions_identifiers_and_expiry() {
    assert!(
        valid_save(save()),
        "omitted assignment mode retains replacement compatibility"
    );
    for (field, value) in [
        ("roles", json!(["owner"])),
        ("roles", json!(["auditor", "auditor"])),
        ("roles", json!([])),
        ("key", json!("")),
        ("key", json!("save-1\n")),
        ("key", json!("a".repeat(129))),
        ("actor_id", json!("other/member")),
        ("expected_version", json!("01")),
        ("expected_version", json!("-1")),
        ("expected_version", json!("9223372036854775808")),
        ("expires_at", json!(0)),
        ("expires_at", json!(MAX_MEMBERSHIP_EXPIRY + 1)),
        ("assignment_mode", json!("append")),
        (
            "assignments",
            json!([{"client_id":"foreign/client","engagement_id":"engagement"}]),
        ),
    ] {
        let mut command = save();
        command[field] = value;
        assert!(
            !valid_save(command),
            "invalid {field} reached the application"
        );
    }
    for expiry in [1, MAX_MEMBERSHIP_EXPIRY] {
        let mut command = save();
        command["expires_at"] = json!(expiry);
        command["expected_version"] = json!(i64::MAX.to_string());
        assert!(valid_save(command));
    }
}

#[test]
fn legacy_assignment_modes_cannot_silently_replace_unseen_assignments() {
    let mut command = save();
    command["assignment_mode"] = json!("preserve");
    assert!(valid_save(command.clone()));
    command["assignments"] = json!([{"client_id":"client","engagement_id":"engagement"}]);
    assert!(
        !valid_save(command.clone()),
        "preserve cannot carry a replacement set"
    );
    command["assignment_mode"] = json!("remove");
    assert!(valid_save(command.clone()));
    command["assignments"][0]["renew"] = json!(true);
    assert!(
        !valid_save(command.clone()),
        "remove cannot also renew authority"
    );
    command["assignments"] = json!([]);
    assert!(
        !valid_save(command),
        "remove must identify a nonempty explicit selection"
    );
}

#[test]
fn assignment_renewal_is_a_scope_specific_boolean_with_canonical_false_default() {
    let mut omitted = save();
    omitted["assignments"] = json!([{"client_id":"client","engagement_id":"engagement"}]);
    let mut explicit = omitted.clone();
    explicit["assignments"][0]["renew"] = json!(false);
    let decode =
        |value| SaveMember::from(serde_json::from_value::<SaveMemberRequest>(value).unwrap());
    assert_eq!(decode(omitted.clone()), decode(explicit.clone()));
    assert!(valid_save(explicit.clone()));
    explicit["assignments"][0]["renew"] = json!(true);
    assert!(valid_save(explicit.clone()));
    assert_ne!(decode(omitted.clone()), decode(explicit));
    for value in [json!(null), json!("true"), json!(1), json!({}), json!([])] {
        let mut invalid = omitted.clone();
        invalid["assignments"][0]["renew"] = value;
        assert!(!valid_save(invalid), "renew accepts only a JSON boolean");
    }
    omitted["renew"] = json!(true);
    assert!(
        !valid_save(omitted),
        "a global renewal flag is not part of Save"
    );
}

#[test]
fn one_hundred_assignment_renewals_fit_the_existing_request_body_bound() {
    let mut command = save();
    command["key"] = json!("k".repeat(128));
    command["actor_id"] = json!("a".repeat(128));
    command["expected_version"] = json!(i64::MAX.to_string());
    command["roles"] = json!(["auditor", "audit_manager", "admin"]);
    command["expires_at"] = json!(MAX_MEMBERSHIP_EXPIRY);
    command["assignment_mode"] = json!("replace");
    command["assignments"] = json!(
        (0..100)
            .map(|index| json!({
                "client_id":format!("{}{index:03}", "c".repeat(125)),
                "engagement_id":"e".repeat(128),
                "renew":false,
            }))
            .collect::<Vec<_>>()
    );
    assert!(valid_save(command.clone()));
    assert!(serde_json::to_vec(&command).unwrap().len() <= 32 * 1024);
}

#[test]
fn invitation_request_limits_match_the_owned_validator() {
    let command = json!({
        "key":"invite-1", "expected_version":"0", "recipient_email":"Named@EXAMPLE.COM",
        "roles":["auditor"], "assignments":[], "expires_in_seconds":300,
        "secret":"a".repeat(43),
    });
    let valid = |value| {
        serde_json::from_value::<InviteMemberRequest>(value)
            .is_ok_and(|request| InviteCommand::from(request).is_valid())
    };
    assert!(valid(command.clone()));
    for (field, value) in [
        ("roles", json!(["provider-admin"])),
        ("recipient_email", json!("Display <named@example.com>")),
        (
            "recipient_email",
            json!(format!("{}@example.com", "a".repeat(65))),
        ),
        ("recipient_email", json!("named@example..com")),
        ("recipient_email", json!("named@example.com\n")),
        ("secret", json!("a".repeat(42))),
        ("secret", json!("a".repeat(44))),
        ("secret", json!(format!("{}=", "a".repeat(42)))),
        ("expires_in_seconds", json!(299)),
        ("expires_in_seconds", json!(604801)),
        (
            "assignments",
            json!(vec![
                json!({"client_id":"client","engagement_id":"engagement"});
                101
            ]),
        ),
        (
            "assignments",
            json!([{"client_id":"client","engagement_id":"engagement","renew":true}]),
        ),
    ] {
        let mut invalid = command.clone();
        invalid[field] = value;
        assert!(
            !valid(invalid),
            "invalid {field} reached invitation persistence"
        );
    }
}

#[test]
fn generated_contract_exposes_shared_vocabulary_bounds_and_invalid_examples() {
    let document = serde_json::to_value(zobba_api::ApiDocument::openapi()).unwrap();
    let schemas = &document["components"]["schemas"];
    assert_eq!(
        schemas["MembershipRole"]["enum"],
        json!(["auditor", "audit_manager", "admin"])
    );
    assert_eq!(
        schemas["MembershipInvitationStatus"]["enum"],
        json!(["pending", "accepted", "revoked", "expired"])
    );
    assert_eq!(
        schemas["MembershipReceiptKind"]["enum"],
        json!(["save_member", "invite", "revoke_invitation", "accept"])
    );
    assert_eq!(
        schemas["MembershipAssignmentMode"]["enum"],
        json!(["replace", "preserve", "remove"])
    );
    for (name, minimum, maximum) in [
        ("MembershipIdentifier", 1, 128),
        ("MembershipVersion", 1, 19),
        ("MembershipRecipientEmail", 3, 254),
        ("MembershipInvitationSecret", 43, 43),
        ("MembershipAssignmentCursor", 3, 257),
    ] {
        assert_eq!(schemas[name]["type"], "string");
        assert_eq!(schemas[name]["minLength"], minimum);
        assert_eq!(schemas[name]["maxLength"], maximum);
        assert!(schemas[name]["pattern"].as_str().unwrap().starts_with('^'));
    }
    for name in [
        "SaveMemberRequest",
        "InviteMemberRequest",
        "MembershipMember",
        "MembershipInvitation",
        "InvitationPreviewResponse",
    ] {
        assert_eq!(
            schemas[name]["properties"]["roles"]["items"]["$ref"],
            "#/components/schemas/MembershipRole"
        );
        assert_eq!(schemas[name]["properties"]["roles"]["maxItems"], 3);
        assert_eq!(schemas[name]["properties"]["assignments"]["maxItems"], 100);
    }
    assert_eq!(
        schemas["SaveMemberRequest"]["properties"]["expires_at"]["maximum"],
        MAX_MEMBERSHIP_EXPIRY
    );
    assert_eq!(
        schemas["SaveMemberRequest"]["properties"]["assignments"]["items"]["$ref"],
        "#/components/schemas/MembershipAssignmentChange"
    );
    assert_eq!(
        schemas["MembershipAssignmentChange"]["properties"]["renew"]["type"],
        "boolean"
    );
    assert_eq!(
        schemas["MembershipAssignmentChange"]["properties"]["renew"]["default"],
        false
    );
    assert!(
        !schemas["MembershipAssignmentChange"]["required"]
            .as_array()
            .unwrap()
            .contains(&json!("renew"))
    );
    assert!(schemas["MembershipAssignment"]["properties"]["renew"].is_null());
    assert_eq!(
        schemas["InviteMemberRequest"]["properties"]["assignments"]["items"]["$ref"],
        "#/components/schemas/MembershipAssignment"
    );
    for (name, field) in [
        ("MembershipOrganisations", "organisations"),
        ("MembershipSnapshot", "members"),
        ("MembershipSnapshot", "invitations"),
        ("MembershipSnapshot", "engagements"),
        ("MembershipMemberAssignments", "assignments"),
    ] {
        assert_eq!(schemas[name]["properties"][field]["maxItems"], 50);
    }
    let path = &document["paths"]["/membership/organisations/{organisation_id}/members"]["post"];
    let examples = &path["responses"]["400"]["content"]["application/json"]["examples"];
    assert!(
        examples["unknownRole"]["description"]
            .as_str()
            .unwrap()
            .contains("owner")
    );
    assert_eq!(
        examples["outOfRangeExpiry"]["value"],
        json!({"error":"invalid_membership"})
    );
    assert!(document["paths"]["/membership/organisations/{organisation_id}/members/{actor_id}/assignments"]["get"].is_object());
}
