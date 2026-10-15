use serde_json::{Value, json};
use utoipa::OpenApi;
use zobba_api::skills::{ChangeSkillStatusRequest, InstallSkillRequest, SelectSkillRequest};
use zobba_application::skills::{ChangeSkillStatus, InstallSkill, SelectSkill};

fn install() -> Value {
    json!({"key":"install-one","expected_revision":"9007199254740993", "assignment":{"kind":"firm","client_id":null,"engagement_id":null},"applicability":{"audit_area":null,"period_start":null,"period_end":null},"enabled":true,
    "manifest":{"schema_version":1,"id":"inspect-support","version":"v1","name":"Firm technique","description":"Inspect supporting material without granting authority","source":{"reference":"firm-package","revision":"original-revision","license":"Internal firm use"},"inputs":[{"id":"evidence","label":"Supporting evidence","required":true}],"outputs":["Attributed inspection notes"],"needs":[],"method_version_ids":[],"resources":[{"id":"instructions","kind":"script","content":"  Treat this as inert text.\r\n\tNever launch.\n"}]}})
}
fn valid(value: Value) -> bool {
    serde_json::from_value::<InstallSkillRequest>(value)
        .ok()
        .and_then(|wire| InstallSkill::try_from(wire).ok())
        .is_some_and(|command| command.is_valid())
}
#[test]
fn skill_wire_preserves_exact_resource_unicode_and_large_revisions() {
    for text in ["\u{feff}", "\u{feff}Firm", "  Indented\r\n\tData\n", "界"] {
        let mut fixture = install();
        fixture["manifest"]["resources"][0]["content"] = json!(text);
        let wire: InstallSkillRequest = serde_json::from_value(fixture.clone()).unwrap();
        let command = InstallSkill::try_from(wire).unwrap();
        assert!(command.is_valid());
        assert_eq!(command.expected_revision, 9_007_199_254_740_993);
        assert_eq!(command.manifest.resources[0].content, text);
        assert_eq!(
            serde_json::to_value(InstallSkillRequest::from(command)).unwrap(),
            fixture
        );
    }
    let mut fixture = install();
    fixture["manifest"]["name"] = json!("\u{feff}");
    assert!(valid(fixture));
}
#[test]
fn skill_wire_refuses_unknown_tools_privilege_fields_and_invalid_bounds() {
    for value in [
        json!(1),
        json!("01"),
        json!("-1"),
        json!("9223372036854775808"),
    ] {
        let mut fixture = install();
        fixture["expected_revision"] = value;
        assert!(!valid(fixture));
    }
    for (field, value) in [
        ("schema_version", json!(2)),
        ("id", json!("../skill")),
        ("name", json!(" leading")),
        ("outputs", json!(["bad\npolicy"])),
        ("policy_override", json!(true)),
    ] {
        let mut fixture = install();
        fixture["manifest"][field] = value;
        assert!(!valid(fixture), "accepted {field}");
    }
    for content in [
        "".to_owned(),
        " \t\r\n\u{3000}".to_owned(),
        "bad\0resource".to_owned(),
        "x".repeat(32769),
        "界".repeat(10923),
    ] {
        let mut fixture = install();
        fixture["manifest"]["resources"][0]["content"] = json!(content);
        assert!(!valid(fixture));
    }
    let need = json!({"id":"need","tool":"shell_v1","account_id":null,"environment_id":null,"destination":null,"resource_id":null,"recipients":[],"attachment_classifications":[],"requires_attachments":false});
    let mut fixture = install();
    fixture["manifest"]["needs"] = json!([need]);
    assert!(!valid(fixture.clone()));
    fixture["manifest"]["needs"][0]["tool"] = json!("analysis_v1");
    assert!(
        valid(fixture.clone()),
        "recognized unavailable needs remain installable"
    );
    fixture["manifest"]["needs"][0]["authority_actor_id"] = json!("other");
    assert!(!valid(fixture));
    let mut fixture = install();
    fixture["manifest"]["resources"][0]["kind"] = json!("executable");
    assert!(!valid(fixture));
}
#[test]
fn selection_and_status_accept_only_exact_canonical_browser_basis() {
    let base = json!({"key":"select-one","version_id":"catalog-one","reason":"Optional inspection technique","expected_catalog_revision":"12","expected_methodology_binding_id":"binding-one","expected_execution_epoch":"9007199254740993","expected_selection_revision":"0"});
    let valid_selection = |value| {
        serde_json::from_value::<SelectSkillRequest>(value)
            .ok()
            .and_then(|wire| SelectSkill::try_from(wire).ok())
            .is_some_and(|command| command.is_valid())
    };
    assert!(valid_selection(base.clone()));
    for (field, value) in [
        ("expected_execution_epoch", json!(12)),
        ("expected_catalog_revision", json!("012")),
        ("authority_actor_id", json!("viewer-policy")),
        ("policy_snapshot", json!({})),
        ("reason", json!("")),
    ] {
        let mut fixture = base.clone();
        fixture[field] = value;
        assert!(!valid_selection(fixture));
    }
    let status = json!({"key":"recall-one","expected_revision":"12","version_id":"catalog-one","status":"recalled","reason":"Faulty technique"});
    let command = ChangeSkillStatus::try_from(
        serde_json::from_value::<ChangeSkillStatusRequest>(status.clone()).unwrap(),
    )
    .unwrap();
    assert!(command.is_valid());
    let mut invalid = status;
    invalid["status"] = json!("execute");
    assert!(serde_json::from_value::<ChangeSkillStatusRequest>(invalid).is_err());
}
#[test]
fn generated_skill_contract_retains_limits_fences_and_no_execution_route() {
    let value = serde_json::to_value(zobba_api::ApiDocument::openapi()).unwrap();
    let schemas = &value["components"]["schemas"];
    for (field, maximum) in [
        ("inputs", 32),
        ("outputs", 32),
        ("needs", 16),
        ("method_version_ids", 32),
        ("resources", 16),
    ] {
        assert_eq!(
            schemas["SkillManifest"]["properties"][field]["maxItems"],
            maximum
        );
    }
    for schema in ["SkillInspection", "SkillNeedInspection"] {
        assert_eq!(schemas[schema]["properties"]["reason"]["maxLength"], 256);
    }
    assert_eq!(
        schemas["TaskSkillsResponse"]["properties"]["selections"]["maxItems"],
        128
    );
    assert_eq!(
        schemas["SkillSelection"]["properties"]["execution_epoch"]["type"],
        "string"
    );
    assert_eq!(
        schemas["SkillResourceKind"]["enum"],
        json!(["text", "script"])
    );
    assert_eq!(
        schemas["SkillTool"]["enum"],
        json!([
            "live_read_v1",
            "test_read_v1",
            "test_write_v1",
            "test_send_v1",
            "audit_read_v1",
            "audit_write_v1",
            "audit_send_v1",
            "analysis_v1"
        ])
    );
    for (path, method) in [
        ("/skills/organisations/{organisation_id}", "get"),
        ("/skills/organisations/{organisation_id}/assignments", "get"),
        (
            "/skills/organisations/{organisation_id}/versions/{version_id}/history",
            "get",
        ),
        ("/engagements/{engagement_id}/skills/impacts", "get"),
        ("/skills/organisations/{organisation_id}/install", "post"),
        ("/skills/organisations/{organisation_id}/status", "post"),
        ("/engagements/{engagement_id}/tasks/{task_id}/skills", "get"),
        (
            "/engagements/{engagement_id}/tasks/{task_id}/skills/select",
            "post",
        ),
        (
            "/engagements/{engagement_id}/tasks/{task_id}/skills/selections/{selection_id}",
            "get",
        ),
    ] {
        let route = &value["paths"][path][method];
        assert!(route["responses"]["412"].is_object());
        if method == "post" {
            assert!(
                route["parameters"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|parameter| parameter["name"] == "X-Expected-Actor"
                        && parameter["required"] == true)
            );
        }
    }
    assert!(!value["paths"].as_object().unwrap().keys().any(
        |path| path.contains("skills") && (path.contains("invoke") || path.contains("execute"))
    ));
    assert!(
        schemas["SkillCatalogSnapshot"]["properties"]
            .get("engagements")
            .is_none()
    );
    for (schema, field) in [
        ("SkillAssignmentPage", "clients"),
        ("SkillAssignmentPage", "engagements"),
        ("SkillStatusHistory", "events"),
        ("SkillSelectionImpactPage", "selections"),
    ] {
        assert_eq!(schemas[schema]["properties"][field]["maxItems"], 50);
    }
    assert_eq!(
        schemas["SkillStatusEvent"]["properties"]["reason"]["maxLength"],
        2000
    );
    assert_eq!(
        schemas["SkillCapabilityBound"]["properties"]["delegation_depth"]["maximum"],
        7
    );
    assert_eq!(
        schemas["SkillCapabilityBoundKind"]["enum"],
        json!([
            "organisation",
            "engagement",
            "member",
            "account",
            "task",
            "delegation"
        ])
    );
    let properties = schemas["SkillCapabilityBound"]["properties"]
        .as_object()
        .unwrap();
    assert_eq!(
        properties.len(),
        3,
        "bound provenance discloses no subject or rule values"
    );
    assert!(properties.contains_key("accepted"));
    assert!(properties.contains_key("kind"));
    assert!(properties.contains_key("delegation_depth"));
}

#[test]
fn redacted_bound_and_status_history_keep_provenance_and_exact_large_revisions() {
    use zobba_application::skills as application;
    use zobba_domain::permissions;
    let need = application::ToolNeed {
        id: "declared-need".into(),
        tool: "audit_read_v1".into(),
        account_id: None,
        environment_id: None,
        destination: None,
        resource_id: None,
        recipients: vec![],
        attachment_classifications: vec![],
        requires_attachments: false,
    };
    for accepted in [false, true] {
        let bound = permissions::CapabilityBound {
            accepted,
            kind: permissions::PolicyKind::Delegation,
            delegation_depth: Some(7),
        };
        let domain = permissions::CapabilityInspection {
            status: permissions::CapabilityStatus::Forbidden,
            reason: permissions::CapabilityReason::HardBounds,
            refresh_at: Some(253_402_300_799),
            blocking_bound: Some(bound),
        };
        let wire = zobba_api::skills::SkillNeedInspection::from(
            application::NeedInspection::from_domain(&need, domain),
        );
        assert_eq!(
            serde_json::to_value(wire).unwrap()["blocking_bound"],
            json!({"accepted":accepted,"kind":"delegation","delegation_depth":7})
        );
    }
    let history = application::StatusHistory {
        version_id: "version-a".into(),
        next_before_revision: Some(9_007_199_254_740_993),
        events: vec![application::StatusEvent {
            event_id: "event-a".into(),
            actor_id: "admin-a".into(),
            recorded_at: 253_402_300_799,
            revision: 9_007_199_254_740_994,
            status: application::CatalogStatus::Disabled,
            reason: Some("😀".repeat(2000)),
        }],
    };
    let wire = serde_json::to_value(zobba_api::skills::SkillStatusHistory::from(history)).unwrap();
    assert_eq!(wire["next_before_revision"], "9007199254740993");
    assert_eq!(wire["events"][0]["revision"], "9007199254740994");
    assert_eq!(wire["events"][0]["reason"], "😀".repeat(2000));
}

#[test]
fn assignment_and_impact_cursors_have_exact_bounded_shapes() {
    use zobba_application::skills::{AssignmentKind, AssignmentOptionsQuery, ImpactCursor};
    assert!(
        AssignmentOptionsQuery {
            kind: AssignmentKind::Client,
            client_id: None,
            after: Some("client-a".into())
        }
        .is_valid()
    );
    assert!(
        AssignmentOptionsQuery {
            kind: AssignmentKind::Engagement,
            client_id: Some("client-a".into()),
            after: None
        }
        .is_valid()
    );
    assert!(
        !AssignmentOptionsQuery {
            kind: AssignmentKind::Client,
            client_id: Some("client-a".into()),
            after: None
        }
        .is_valid()
    );
    assert!(
        !AssignmentOptionsQuery {
            kind: AssignmentKind::Engagement,
            client_id: None,
            after: None
        }
        .is_valid()
    );
    for revision in [0, i64::MAX as u64 + 1] {
        assert!(
            !ImpactCursor {
                task_id: "task-a".into(),
                revision
            }
            .is_valid()
        );
    }
    let cursor = ImpactCursor {
        task_id: "task-a".into(),
        revision: 9_007_199_254_740_993,
    };
    assert!(cursor.is_valid());
    assert_eq!(
        serde_json::to_value(zobba_api::skills::SkillImpactCursor::from(cursor)).unwrap(),
        json!({"task_id":"task-a","revision":"9007199254740993"})
    );
}
