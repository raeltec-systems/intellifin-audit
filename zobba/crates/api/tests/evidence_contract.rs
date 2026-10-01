//! The generated client describes the actual raw-byte transport and finite custody limit.
use serde_json::{Value, json};
use utoipa::OpenApi;

#[test]
fn evidence_upload_and_download_describe_raw_binary_not_json_integer_arrays() {
    let document = serde_json::to_value(zobba_api::ApiDocument::openapi()).unwrap();
    let upload = &document["paths"]["/engagements/{engagement_id}/evidence-reservations/{reservation_id}/upload"]
        ["put"]["requestBody"]["content"];
    let download = &document["paths"]["/engagements/{engagement_id}/evidence/{evidence_id}/download"]
        ["get"]["responses"]["200"]["content"];
    for content in [upload, download] {
        assert_eq!(
            content.as_object().unwrap().keys().collect::<Vec<_>>(),
            ["application/octet-stream"]
        );
        let schema = &content["application/octet-stream"]["schema"];
        assert_eq!(schema["$ref"], "#/components/schemas/EvidenceBinary");
        let body = &document["components"]["schemas"]["EvidenceBinary"];
        assert_eq!(body["type"], "string");
        assert_eq!(body["format"], "binary");
        assert!(body.get("items").is_none());
        assert!(
            body.get("contentEncoding").is_none(),
            "raw bytes are not base64 text"
        );
    }
    let published: Value = serde_json::from_str(include_str!("../../../openapi.json")).unwrap();
    assert_eq!(
        published, document,
        "regenerate the owned OpenAPI and TypeScript client together"
    );
}

#[test]
fn finite_reservation_limit_is_documented_as_conflict_without_retry_after() {
    let document = serde_json::to_value(zobba_api::ApiDocument::openapi()).unwrap();
    let responses = &document["paths"]["/engagements/{engagement_id}/evidence-reservations"]["post"]
        ["responses"];
    let durable = &responses["409"];
    assert!(
        durable["description"]
            .as_str()
            .unwrap()
            .contains("evidence_reservation_limit")
    );
    assert!(
        durable["description"]
            .as_str()
            .unwrap()
            .contains("finish an existing reservation")
    );
    assert!(durable.get("headers").is_none());
    assert_eq!(
        durable["content"]["application/json"]["schema"],
        json!({"$ref":"#/components/schemas/ErrorResponse"})
    );
}
