//! HTTP vocabulary and lossless revisions belong to the owned Rust contract.
use serde_json::{Value, json};
use utoipa::OpenApi;
use zobba_api::{
    methodology::{
        MethodologyBindingChange, MethodologyImpact, MethodologyResolution,
        RecallMethodologyRequest, SaveMethodologyRequest, TaskMethodologyResponse,
    },
    tasks::TaskCommandRequest,
};
use zobba_application::methodology::{self as application, RecallMethodology, SaveMethodology};
use zobba_domain::task::TaskCommand;

fn save() -> Value {
    json!({
        "key":"save-method-1", "expected_revision":"0", "supersedes":null, "undo_of":null,
        "assignment":{"kind":"firm","client_id":null,"engagement_id":null},
        "applicability":{"audit_area":null,"period_start":null,"period_end":null},
        "activation":{"mode":"new_tasks","available_at":0},
        "definition":{
            "name":"Firm review", "neutral_starter":false,
            "default_context":{"audit_area":null,"period_start":null,"period_end":null},
            "requirements":[{
                "id":"review", "label":"Review controls", "mandatory":true,
                "criteria":["Document the conclusion"], "populations":null,
                "evidence_checks":null,"ratings":null,"review_rules":null,
                "templates":[{"id":"review-template","version":"v1"}],"suitable_skills":null
            }],
            "templates":[{"id":"review-template","version":"v1","name":"Review template","sections":[
                {"id":"conclusion","title":"Conclusion","content":"Record the basis for the conclusion.","required":true}
            ]}]
        },
        "source":{"kind":"authored","reference":null,"note":null}
    })
}

fn valid_save(value: Value) -> bool {
    serde_json::from_value::<SaveMethodologyRequest>(value)
        .ok()
        .and_then(|value| SaveMethodology::try_from(value).ok())
        .is_some_and(|value| value.is_valid())
}

#[test]
fn methodology_revisions_are_canonical_lossless_decimal_strings() {
    for revision in ["0", "1", "9007199254740993", "9223372036854775806"] {
        let mut value = save();
        value["expected_revision"] = json!(revision);
        let request: SaveMethodologyRequest = serde_json::from_value(value).unwrap();
        let command = SaveMethodology::try_from(request).unwrap();
        assert_eq!(command.expected_revision.to_string(), revision);
        assert!(command.is_valid());
        let encoded = serde_json::to_value(SaveMethodologyRequest::from(command)).unwrap();
        assert_eq!(encoded["expected_revision"], revision);
    }
    for revision in [
        json!(0),
        json!(null),
        json!(""),
        json!("01"),
        json!("-1"),
        json!("1.0"),
        json!("1\n"),
        json!("9223372036854775808"),
    ] {
        let mut value = save();
        value["expected_revision"] = revision;
        assert!(!valid_save(value));
    }
}

#[test]
fn methodology_rejects_unknown_fields_and_non_owned_vocabulary_at_every_depth() {
    assert!(valid_save(save()));
    for pointer in [
        "",
        "/assignment",
        "/applicability",
        "/activation",
        "/definition",
        "/definition/default_context",
        "/definition/requirements/0",
        "/definition/requirements/0/templates/0",
        "/definition/templates/0",
        "/definition/templates/0/sections/0",
        "/source",
    ] {
        let mut value = save();
        value.pointer_mut(pointer).unwrap()["unrecognised"] = json!(true);
        assert!(!valid_save(value), "unknown field accepted at {pointer}");
    }
    for (pointer, replacement) in [
        ("/assignment/kind", json!("organisation")),
        ("/assignment/client_id", json!("unexpected-client")),
        ("/activation/mode", json!("silent_rebind")),
        ("/activation/available_at", json!(-1)),
        ("/source/kind", json!("chat_policy")),
        ("/definition/requirements/0/mandatory", json!("true")),
        (
            "/definition/requirements/0/templates/0/version",
            json!("latest version"),
        ),
        (
            "/definition/default_context/period_start",
            json!("2026-02-30"),
        ),
    ] {
        let mut value = save();
        *value.pointer_mut(pointer).unwrap() = replacement;
        assert!(!valid_save(value), "invalid value accepted at {pointer}");
    }
}

#[test]
fn save_preserves_template_contents_and_json_escaping_within_the_request_envelope() {
    let original = save();
    let command = SaveMethodology::try_from(
        serde_json::from_value::<SaveMethodologyRequest>(original.clone()).unwrap(),
    )
    .unwrap();
    let encoded = serde_json::to_value(SaveMethodologyRequest::from(command)).unwrap();
    assert_eq!(
        encoded, original,
        "the saved version must retain the authored template and exact fields"
    );

    let mut escaped = save();
    let mut requirements = Vec::new();
    for index in 0..100 {
        let mut requirement = escaped["definition"]["requirements"][0].clone();
        requirement["id"] = json!(format!("requirement-{index}"));
        requirement["criteria"] = json!(["\"".repeat(1900)]);
        requirements.push(requirement);
    }
    escaped["definition"]["requirements"] = json!(requirements);
    assert!(valid_save(escaped.clone()));
    let encoded = serde_json::to_vec(&escaped).unwrap();
    assert!(
        encoded.len() > 256 * 1024,
        "JSON escaping expands a valid bounded definition"
    );
    assert!(
        encoded.len() < 1024 * 1024,
        "the request lane admits canonical encoding of the bounded definition"
    );
}

#[test]
fn template_prose_preserves_layout_and_feff_with_distinct_text_bounds() {
    for prose in [
        "\tEvidence:\r\n  Record exact citations.\n\u{feff}Conclusion\n".to_owned(),
        "  Indented section with trailing spaces  ".to_owned(),
        "\u{feff}".to_owned(),
        "界".repeat(2000),
    ] {
        let mut original = save();
        original["definition"]["templates"][0]["sections"][0]["content"] = json!(prose);
        let request: SaveMethodologyRequest =
            serde_json::from_slice(&serde_json::to_vec(&original).unwrap()).unwrap();
        let command = SaveMethodology::try_from(request).unwrap();
        assert!(
            command.is_valid(),
            "valid template prose refused: {prose:?}"
        );
        assert_eq!(command.definition.templates[0].sections[0].content, prose);
        assert_eq!(
            serde_json::to_value(SaveMethodologyRequest::from(command)).unwrap(),
            original,
            "template prose must survive both HTTP conversions exactly"
        );
    }
    for prose in [
        "".to_owned(),
        "\r\n\t \u{00a0}\u{3000}".to_owned(),
        "Evidence\u{0000}citation".to_owned(),
        "Evidence\u{000b}citation".to_owned(),
        "Evidence\u{000c}citation".to_owned(),
        "Evidence\u{001b}citation".to_owned(),
        "Evidence\u{007f}citation".to_owned(),
        "Evidence\u{0085}citation".to_owned(),
        "Evidence\u{009f}citation".to_owned(),
        "界".repeat(2001),
    ] {
        let mut original = save();
        original["definition"]["templates"][0]["sections"][0]["content"] = json!(prose);
        assert!(
            !valid_save(original),
            "invalid template prose accepted: {prose:?}"
        );
    }
    for policy_text in [
        "  Indented policy",
        "Evidence\nConclusion",
        "Evidence\tConclusion",
    ] {
        let mut original = save();
        original["definition"]["requirements"][0]["criteria"] = json!([policy_text]);
        assert!(
            !valid_save(original),
            "policy text rules must remain distinct"
        );
    }
}

#[test]
fn resolution_preserves_neutral_contributors_and_exact_field_and_template_sources() {
    let mut command = SaveMethodology::try_from(
        serde_json::from_value::<SaveMethodologyRequest>(save()).unwrap(),
    )
    .unwrap();
    let mut requirement = command.definition.requirements.remove(0);
    requirement.review_rules = Some(vec!["Adopted review rule".into()]);
    let resolution = application::Resolution {
        status: application::ResolutionStatus::Incomplete,
        context: application::TaskContext::default(),
        version_ids: vec!["neutral-version".into(), "adopted-version".into()],
        requirements: vec![application::ResolvedRequirement {
            requirement,
            source_version_ids: vec!["neutral-version".into(), "adopted-version".into()],
            field_sources: vec![
                application::FieldSource {
                    field: "criteria".into(),
                    version_ids: vec!["neutral-version".into()],
                },
                application::FieldSource {
                    field: "review_rules".into(),
                    version_ids: vec!["adopted-version".into()],
                },
            ],
        }],
        templates: vec![application::ResolvedTemplate {
            template: command.definition.templates.remove(0),
            source_version_id: "neutral-version".into(),
        }],
        neutral_source_version_ids: vec!["neutral-version".into()],
        issues: vec!["Inherited criteria retain neutral standing".into()],
        reason: "Mixed adopted and neutral contributions".into(),
    };
    let expected = serde_json::to_value(&resolution).unwrap();
    let wire = serde_json::to_value(MethodologyResolution::from(resolution)).unwrap();
    assert_eq!(
        wire, expected,
        "attribution must remain exact across the HTTP boundary"
    );
    assert_eq!(wire["status"], "incomplete");
    assert_eq!(
        wire["neutral_source_version_ids"],
        json!(["neutral-version"])
    );
    assert_eq!(
        wire["requirements"][0]["field_sources"][0]["version_ids"],
        wire["neutral_source_version_ids"]
    );
    assert_eq!(
        wire["templates"][0]["source_version_id"],
        wire["neutral_source_version_ids"][0]
    );
    assert_eq!(
        wire["requirements"][0]["field_sources"][1]["version_ids"],
        json!(["adopted-version"])
    );

    let mut legacy = expected;
    legacy
        .as_object_mut()
        .unwrap()
        .remove("neutral_source_version_ids");
    let stored: application::Resolution = serde_json::from_value(legacy).unwrap();
    let restored = serde_json::to_value(MethodologyResolution::from(stored)).unwrap();
    assert_eq!(restored["neutral_source_version_ids"], json!([]));
}

#[test]
fn resolution_neutral_source_bound_includes_the_builtin_fallback() {
    let version_ids: Vec<_> = (0..128).map(|index| format!("neutral-{index}")).collect();
    let mut neutral_source_version_ids = version_ids.clone();
    neutral_source_version_ids.push("builtin_neutral_v1".into());
    let resolution = application::Resolution {
        status: application::ResolutionStatus::Neutral,
        context: application::TaskContext::default(),
        version_ids,
        requirements: Vec::new(),
        templates: Vec::new(),
        neutral_source_version_ids: neutral_source_version_ids.clone(),
        issues: Vec::new(),
        reason: "Saved neutral sources and the built-in fallback".into(),
    };
    let wire = serde_json::to_value(MethodologyResolution::from(resolution)).unwrap();
    assert_eq!(wire["version_ids"].as_array().unwrap().len(), 128);
    assert_eq!(
        wire["neutral_source_version_ids"].as_array().unwrap().len(),
        129
    );
    assert_eq!(
        wire["neutral_source_version_ids"],
        json!(neutral_source_version_ids)
    );
    assert_eq!(
        wire["neutral_source_version_ids"][128],
        "builtin_neutral_v1"
    );
}

#[test]
fn create_and_guide_context_is_optional_exact_and_refused_for_controls() {
    let base = json!({"key":"create-1","kind":"create","task_id":null,"cycle_id":null,"content":"Inspect receivables"});
    let decode =
        |value| TaskCommand::from(serde_json::from_value::<TaskCommandRequest>(value).unwrap());
    let omitted = decode(base.clone());
    let mut null = base.clone();
    null["context"] = Value::Null;
    assert_eq!(omitted, decode(null));
    assert!(omitted.is_valid());
    let mut explicit = base;
    explicit["context"] =
        json!({"audit_area":"Receivables","period_start":"2024-01-01","period_end":"2024-12-31"});
    assert!(decode(explicit.clone()).is_valid());
    assert_ne!(omitted, decode(explicit.clone()));
    explicit["kind"] = json!("guide");
    explicit["task_id"] = json!("task");
    explicit["cycle_id"] = json!("cycle");
    let guide = decode(explicit.clone());
    assert!(guide.is_valid());
    let mut unchanged = explicit.clone();
    unchanged.as_object_mut().unwrap().remove("context");
    let unchanged_guide = decode(unchanged.clone());
    assert!(unchanged_guide.is_valid());
    unchanged["context"] = Value::Null;
    assert_eq!(unchanged_guide, decode(unchanged));
    assert_ne!(guide, unchanged_guide);
    let mut replacement = explicit.clone();
    replacement["context"] = json!({});
    assert!(decode(replacement.clone()).is_valid());
    assert_ne!(
        decode(replacement),
        unchanged_guide,
        "an explicitly empty full replacement differs from preserving context"
    );
    for kind in ["pause", "resume", "stop", "continue"] {
        explicit["kind"] = json!(kind);
        explicit["content"] = Value::Null;
        assert!(!decode(explicit.clone()).is_valid());
    }
}

#[test]
fn recall_retains_the_exact_reason_and_refuses_revision_coercion() {
    let base = json!({"key":"recall-1","expected_revision":"12","version_id":"version-1","reason":"Incorrect required control"});
    let valid = |value| {
        serde_json::from_value::<RecallMethodologyRequest>(value)
            .ok()
            .and_then(|value| RecallMethodology::try_from(value).ok())
            .is_some_and(|value| value.is_valid())
    };
    assert!(valid(base.clone()));
    for (field, replacement) in [
        ("expected_revision", json!(12)),
        ("expected_revision", json!("012")),
        ("version_id", json!("foreign/version")),
        ("reason", json!("")),
        ("reason", json!(" leading")),
        ("force", json!(true)),
    ] {
        let mut value = base.clone();
        value[field] = replacement;
        assert!(!valid(value), "recall accepted invalid {field}");
    }
}

#[test]
fn composed_diff_and_guide_reason_preserve_valid_text_without_truncation() {
    let recall_reason = "R".repeat(2000);
    let diff = format!("Recalled: {recall_reason}");
    let impact = application::Impact {
        id: "recall-event".into(),
        version_id: "version".into(),
        activation_mode: application::ActivationMode::ActiveTasks,
        affected_tasks: 1,
        pending_tasks: 1,
        retained_tasks: 0,
        potentially_material: true,
        diff: vec![diff.clone()],
    };
    let value = serde_json::to_value(MethodologyImpact::from(impact)).unwrap();
    assert_eq!(value["diff"][0], diff);
    assert_eq!(value["diff"][0].as_str().unwrap().chars().count(), 2010);

    let guidance = "A\n".repeat(2000);
    let reason = format!("Explicit Task context supplied by Guide: {guidance}");
    let change = application::BindingChange {
        id: "guide".into(),
        actor_id: "auditor".into(),
        requested_at: 1_700_000_000,
        resolution: application::Resolution {
            status: application::ResolutionStatus::Neutral,
            context: application::TaskContext::default(),
            version_ids: Vec::new(),
            requirements: Vec::new(),
            templates: Vec::new(),
            neutral_source_version_ids: Vec::new(),
            issues: Vec::new(),
            reason: "No applicable firm configuration".into(),
        },
        reason: reason.clone(),
    };
    let value = serde_json::to_value(MethodologyBindingChange::from(change)).unwrap();
    assert_eq!(value["reason"], reason);
    assert!(value["reason"].as_str().unwrap().chars().count() <= 4096);
    assert_eq!(
        value["reason"].as_str().unwrap().matches('\n').count(),
        2000
    );
}

#[test]
fn task_basis_conversion_preserves_more_than_two_hundred_bindings_and_notices() {
    let binding = |index: u64| application::Binding {
        id: format!("binding-{index}"),
        candidate_version_ids: vec![format!("version-{index}")],
        context_command_id: Some(format!("guide-{index}")),
        execution_epoch: 9_007_199_254_740_993 + index,
        bound_at: 1_700_000_000 + index as i64,
        actor_id: "auditor".into(),
        resolution: application::Resolution {
            status: application::ResolutionStatus::Neutral,
            context: application::TaskContext::default(),
            version_ids: Vec::new(),
            requirements: Vec::new(),
            templates: Vec::new(),
            neutral_source_version_ids: Vec::new(),
            issues: Vec::new(),
            reason: "No applicable firm configuration".into(),
        },
    };
    let basis = application::TaskBasis {
        task_id: "task".into(),
        current: binding(201),
        pending: None,
        history: (0..201).map(binding).collect(),
        recalled: false,
        notices: (0..201)
            .map(|index| application::BindingNotice {
                id: format!("notice-{index}"),
                version_id: format!("version-{index}"),
                actor_id: "admin".into(),
                requested_at: 1_700_000_000 + index,
                impact: application::Impact {
                    id: format!("impact-{index}"),
                    version_id: format!("version-{index}"),
                    activation_mode: application::ActivationMode::NewTasks,
                    affected_tasks: 1,
                    pending_tasks: 0,
                    retained_tasks: 1,
                    potentially_material: true,
                    diff: vec![format!("Changed requirement {index}")],
                },
            })
            .collect(),
    };
    let response = serde_json::to_value(TaskMethodologyResponse::from(basis)).unwrap();
    assert_eq!(response["history"].as_array().unwrap().len(), 201);
    assert_eq!(response["notices"].as_array().unwrap().len(), 201);
    assert_eq!(response["history"][200]["id"], "binding-200");
    assert_eq!(response["history"][200]["context_command_id"], "guide-200");
    assert_eq!(
        response["history"][200]["candidate_version_ids"],
        json!(["version-200"])
    );
    assert_eq!(
        response["history"][200]["execution_epoch"],
        "9007199254741193"
    );
    assert_eq!(response["notices"][200]["id"], "notice-200");
    assert_eq!(
        response["notices"][200]["impact"]["diff"],
        json!(["Changed requirement 200"])
    );
}

#[test]
fn generated_contract_exposes_methodology_routes_owned_enums_and_context() {
    let document = serde_json::to_value(zobba_api::ApiDocument::openapi()).unwrap();
    let schemas = &document["components"]["schemas"];
    assert_eq!(
        schemas["MethodologyTemplateSection"]["properties"]["content"]["$ref"],
        "#/components/schemas/MethodologyTemplateProse"
    );
    let prose = &schemas["MethodologyTemplateProse"];
    assert_eq!(prose["type"], "string");
    assert_eq!(prose["minLength"], 1);
    assert_eq!(prose["maxLength"], 2000);
    let description = prose["description"].as_str().unwrap();
    for supported in [
        "Unicode White_Space",
        "LF, CR and tab",
        "Indentation",
        "U+FEFF",
    ] {
        assert!(description.contains(supported));
    }
    assert!(
        schemas["MethodologyText"]["description"]
            .as_str()
            .unwrap()
            .contains("already-trimmed")
    );
    assert_eq!(
        schemas["MethodologyAssignmentKind"]["enum"],
        json!(["firm", "client", "engagement"])
    );
    assert_eq!(
        schemas["MethodologyActivationMode"]["enum"],
        json!(["new_tasks", "active_tasks"])
    );
    assert_eq!(
        schemas["MethodologyResolutionStatus"]["enum"],
        json!(["resolved", "neutral", "incomplete", "ambiguous", "recalled"])
    );
    assert_eq!(
        schemas["MethodologySourceKind"]["enum"],
        json!(["authored", "imported_proposal", "neutral_starter"])
    );
    assert_eq!(
        schemas["SaveMethodologyRequest"]["properties"]["expected_revision"]["type"],
        "string"
    );
    assert_eq!(
        schemas["MethodologyBinding"]["properties"]["execution_epoch"]["type"],
        "string"
    );
    assert_eq!(
        schemas["MethodologyBinding"]["properties"]["execution_epoch"]["pattern"],
        "^(0|[1-9][0-9]*)$"
    );
    assert_eq!(
        schemas["MethodologyBinding"]["properties"]["candidate_version_ids"]["type"],
        "array"
    );
    assert_eq!(
        schemas["TaskMethodologyResponse"]["properties"]["history"]["maxItems"],
        4096
    );
    assert_eq!(
        schemas["TaskMethodologyResponse"]["properties"]["notices"]["maxItems"],
        256
    );
    assert_eq!(
        schemas["MethodologySnapshot"]["properties"]["impacts"]["maxItems"],
        256
    );
    assert_eq!(
        schemas["MethodologySnapshot"]["properties"]["engagements"]["maxItems"],
        512
    );
    assert_eq!(
        schemas["MethodologyResolution"]["properties"]["issues"]["maxItems"],
        32768
    );
    assert_eq!(
        schemas["MethodologyDefinition"]["properties"]["requirements"]["maxItems"],
        100
    );
    assert_eq!(
        schemas["MethodologyRequirement"]["properties"]["criteria"]["maxItems"],
        32
    );
    assert_eq!(
        schemas["MethodologyResolvedRequirement"]["properties"]["requirement"]["$ref"],
        "#/components/schemas/MethodologyResolvedRequirementFields"
    );
    for field in [
        "criteria",
        "populations",
        "evidence_checks",
        "ratings",
        "review_rules",
        "templates",
        "suitable_skills",
    ] {
        assert_eq!(
            schemas["MethodologyResolvedRequirementFields"]["properties"][field]["maxItems"],
            4096
        );
        assert_eq!(
            schemas["MethodologyRequirement"]["properties"][field]["maxItems"],
            32
        );
    }
    for (schema, field, maximum) in [
        ("MethodologyResolution", "requirements", 12800),
        ("MethodologyResolution", "templates", 4096),
        ("MethodologyResolution", "version_ids", 128),
        ("MethodologyResolution", "neutral_source_version_ids", 129),
        ("MethodologyResolvedRequirement", "source_version_ids", 128),
        ("MethodologyFieldSource", "version_ids", 128),
    ] {
        assert_eq!(schemas[schema]["properties"][field]["maxItems"], maximum);
    }
    assert!(
        schemas["MethodologyResolution"]["required"]
            .as_array()
            .unwrap()
            .contains(&json!("neutral_source_version_ids"))
    );
    assert!(schemas["TaskCommandRequest"]["properties"]["context"].is_object());
    assert!(schemas["ConversationMessageResponse"]["properties"]["context"].is_object());
    assert!(
        !schemas["ConversationMessageResponse"]["required"]
            .as_array()
            .unwrap()
            .contains(&json!("context"))
    );
    for (path, method, operation) in [
        (
            "/methodology/organisations/{organisation_id}",
            "get",
            "methodology_snapshot",
        ),
        (
            "/methodology/organisations/{organisation_id}/save",
            "post",
            "save_methodology",
        ),
        (
            "/methodology/organisations/{organisation_id}/recall",
            "post",
            "recall_methodology",
        ),
        (
            "/engagements/{engagement_id}/tasks/{task_id}/methodology",
            "get",
            "task_methodology",
        ),
    ] {
        let endpoint = &document["paths"][path][method];
        assert_eq!(endpoint["operationId"], operation);
        assert!(endpoint["responses"]["412"].is_object());
        if method == "post" {
            assert!(
                endpoint["parameters"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|parameter| parameter["name"] == "X-Expected-Actor"
                        && parameter["required"] == true)
            );
        }
    }
    for path in [
        "/engagements/{engagement_id}/task-commands",
        "/engagements/{engagement_id}/task-controls",
    ] {
        let endpoint = &document["paths"][path]["post"];
        assert!(endpoint["responses"]["412"].is_null());
        assert!(
            !endpoint["parameters"]
                .as_array()
                .unwrap()
                .iter()
                .any(|parameter| parameter["name"] == "X-Expected-Session")
        );
    }
}
