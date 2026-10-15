use serde_json::json;
use utoipa::OpenApi;
use zobba_api::knowledge::{KnowledgeCommand, KnowledgePreferenceCommand};
use zobba_application::knowledge as app;

#[test]
fn knowledge_wire_preserves_exact_prose_and_canonical_revision_strings() {
    let fixture = json!({"key":"assert-one","expected_revision":"9007199254740993","action":{"kind":"assert","assertion":{"text":"\u{feff}Exact\r\n😀 text","period":{"start":null,"end":null},"uncertainty":null,"dependencies":[]}}});
    let wire: KnowledgeCommand = serde_json::from_value(fixture.clone()).unwrap();
    let command: app::KnowledgeCommand = wire.try_into().unwrap();
    assert_eq!(command.expected_revision, 9_007_199_254_740_993);
    assert!(command.is_valid());
    assert!(
        matches!(command.action,app::KnowledgeAction::Assert { assertion } if assertion.text=="\u{feff}Exact\r\n😀 text")
    );
    for value in [
        json!(1),
        json!("01"),
        json!("-1"),
        json!("9223372036854775808"),
    ] {
        let mut changed = fixture.clone();
        changed["expected_revision"] = value;
        let converted = serde_json::from_value::<KnowledgeCommand>(changed)
            .ok()
            .and_then(|v| app::KnowledgeCommand::try_from(v).ok());
        assert!(converted.is_none());
    }
    let mut changed = fixture;
    changed["action"]["assertion"]["verified"] = json!(true);
    assert!(serde_json::from_value::<KnowledgeCommand>(changed).is_err());
}

#[test]
fn typed_preference_release_cannot_declassify_free_text() {
    let fixture = json!({"key":"publish-one","expected_revision":"12","action":{"kind":"publish","target":{"id":"preference-one","revision":"11"},"client_id":"client-a","engagement_id":"engagement-a"}});
    let wire: KnowledgePreferenceCommand = serde_json::from_value(fixture.clone()).unwrap();
    let command: app::PreferenceCommand = wire.try_into().unwrap();
    assert!(command.is_valid());
    for invalid in [
        json!({"kind":"save","value":"arbitrary private prose"}),
        json!({"kind":"publish","target":{"id":"preference-one","revision":"11"},"client_id":"client-a","engagement_id":"engagement-a","release_text":"private"}),
        json!({"kind":"promote_to_firm","target":{"id":"preference-one","revision":"11"}}),
    ] {
        let mut changed = fixture.clone();
        changed["action"] = invalid;
        assert!(serde_json::from_value::<KnowledgePreferenceCommand>(changed).is_err());
    }
}

#[test]
fn generated_knowledge_contract_keeps_current_session_and_mutation_fences() {
    let document = serde_json::to_value(zobba_api::ApiDocument::openapi()).unwrap();
    let schemas = &document["components"]["schemas"];
    assert_eq!(
        schemas["KnowledgePage"]["properties"]["items"]["maxItems"],
        50
    );
    assert_eq!(
        schemas["KnowledgeRecord"]["properties"]["dependencies"]["maxItems"],
        32
    );
    assert_eq!(
        schemas["KnowledgeRecord"]["properties"]["revision"]["type"],
        "string"
    );
    assert_eq!(
        schemas["KnowledgePage"]["properties"]["execution_epoch"]["type"],
        "string"
    );
    let routes = document["paths"]
        .as_object()
        .unwrap()
        .iter()
        .filter(|(path, _)| path.contains("knowledge"));
    let mut count = 0;
    for (_, route) in routes {
        for method in ["get", "post"] {
            if let Some(operation) = route.get(method) {
                count += 1;
                assert!(operation["responses"]["412"].is_object());
                assert!(
                    operation["parameters"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|p| p["name"] == "X-Expected-Session")
                );
                if method == "post" {
                    for name in ["Origin", "X-CSRF-Token", "X-Expected-Actor"] {
                        assert!(
                            operation["parameters"]
                                .as_array()
                                .unwrap()
                                .iter()
                                .any(|p| p["name"] == name && p["required"] == true)
                        );
                    }
                }
            }
        }
    }
    assert_eq!(count, 12);
}

#[test]
fn knowledge_inspection_declares_exact_query_parameters_and_bounds() {
    let document = serde_json::to_value(zobba_api::ApiDocument::openapi()).unwrap();
    let operation =
        &document["paths"]["/engagements/{engagement_id}/tasks/{task_id}/knowledge"]["get"];
    let parameters = operation["parameters"].as_array().unwrap();
    let mut query_names: Vec<_> = parameters
        .iter()
        .filter(|parameter| parameter["in"] == "query")
        .map(|parameter| parameter["name"].as_str().unwrap())
        .collect();
    query_names.sort_unstable();
    assert_eq!(
        query_names,
        [
            "after",
            "client_id",
            "include_inactive",
            "organisation_id",
            "text"
        ]
    );
    let query = &document["components"]["schemas"]["KnowledgeQuery"]["properties"];
    for (name, expected_schema) in [
        (
            "after",
            json!({"type":"string","minLength":1,"maxLength":128,"pattern":"^[A-Za-z0-9_-]+$"}),
        ),
        (
            "text",
            json!({"type":"string","maxLength":200,"pattern":r"^[^\u0000-\u001F\u007F-\u009F]*$"}),
        ),
        (
            "include_inactive",
            json!({"type":"boolean","default":false}),
        ),
    ] {
        let parameter = parameters.iter().find(|p| p["name"] == name).unwrap();
        assert_eq!(parameter["required"], false, "{name} is optional on GET");
        assert_eq!(parameter["schema"], expected_schema, "{name}");
        assert_eq!(parameter["description"], query[name]["description"]);
        for attribute in ["minLength", "maxLength", "pattern", "default"] {
            assert_eq!(parameter["schema"][attribute], query[name][attribute]);
        }
    }
    assert_eq!(
        operation["description"],
        "Returns at most 50 currently authorized views in C-ordered ID order after checking applicability and support. At most 1024 candidates are examined; scan_limit reports a partial scan, not absence. Exact record/revision lookup remains independent of page reachability."
    );
    assert_eq!(
        query["text"]["description"],
        "Case-insensitive Unicode lowercase substring match on authorized, applicable record text, without trimming. Empty text matches any eligible record. At most 200 Unicode scalar values; C0/C1 controls are refused."
    );
}

#[test]
fn knowledge_query_bounds_count_unicode_scalars_and_keep_exact_inputs() {
    let bounded = app::KnowledgeQuery {
        after: Some("A_9-".repeat(32)),
        text: Some("😀".repeat(200)),
        include_inactive: true,
    };
    assert!(bounded.is_valid());
    let encoded = serde_json::to_value(&bounded).unwrap();
    let wire: zobba_api::knowledge::KnowledgeQuery = serde_json::from_value(encoded).unwrap();
    assert_eq!(wire.after, bounded.after);
    assert_eq!(wire.text, bounded.text);
    assert!(wire.include_inactive);
    for text in ["".to_string(), "  MIXED é \u{200d}  ".into()] {
        assert!(
            app::KnowledgeQuery {
                text: Some(text),
                ..Default::default()
            }
            .is_valid()
        );
    }
    for text in ["😀".repeat(201), "line\nbreak".into(), "\u{0085}".into()] {
        assert!(
            !app::KnowledgeQuery {
                text: Some(text),
                ..Default::default()
            }
            .is_valid()
        );
    }
    for after in ["".to_string(), "a".repeat(129), "é".into(), "a/b".into()] {
        assert!(
            !app::KnowledgeQuery {
                after: Some(after),
                ..Default::default()
            }
            .is_valid()
        );
    }
}
