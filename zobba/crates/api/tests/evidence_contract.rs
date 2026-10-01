//! The generated client describes the actual raw-byte transport and finite custody limit.
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use utoipa::OpenApi;
use zobba_api::evidence::EvidenceReservationRequest;
use zobba_domain::evidence::ReservationRequest;

#[derive(Clone, Deserialize)]
struct MetadataCase {
    name: String,
    value: Value,
    filename_valid: bool,
    source_valid: bool,
}

#[derive(Deserialize)]
struct MetadataCharacters {
    name: String,
    codepoints: Vec<u32>,
    ranges: Vec<[u32; 2]>,
    positions: Vec<String>,
    filename_valid: bool,
    source_valid: bool,
}

#[derive(Deserialize)]
struct MetadataBoundary {
    name: String,
    prefix: String,
    unit: String,
    suffix: String,
}

#[derive(Deserialize)]
struct MetadataMatrix {
    fields: BTreeMap<String, usize>,
    literals: Vec<MetadataCase>,
    characters: Vec<MetadataCharacters>,
    byte_boundaries: Vec<MetadataBoundary>,
}

impl MetadataMatrix {
    fn cases(&self, max_bytes: usize) -> Vec<MetadataCase> {
        let mut cases = self.literals.clone();
        for group in &self.characters {
            let points = group
                .codepoints
                .iter()
                .copied()
                .chain(group.ranges.iter().flat_map(|[first, last]| *first..=*last));
            for point in points {
                let character = char::from_u32(point).unwrap();
                for position in &group.positions {
                    let value = match position.as_str() {
                        "leading" => format!("{character}metadata"),
                        "trailing" => format!("metadata{character}"),
                        "internal" => format!("meta{character}data"),
                        "alone" => character.to_string(),
                        _ => panic!("unknown metadata matrix position: {position}"),
                    };
                    cases.push(MetadataCase {
                        name: format!("{}-U+{point:x}-{position}", group.name),
                        value: value.into(),
                        filename_valid: group.filename_valid,
                        source_valid: group.source_valid,
                    });
                }
            }
        }
        for boundary in &self.byte_boundaries {
            for extra in [0, 1] {
                let remaining = max_bytes + extra - boundary.prefix.len() - boundary.suffix.len();
                let value = format!(
                    "{}{}{}{}",
                    boundary.prefix,
                    boundary.unit.repeat(remaining / boundary.unit.len()),
                    "a".repeat(remaining % boundary.unit.len()),
                    boundary.suffix
                );
                assert_eq!(value.len(), max_bytes + extra);
                cases.push(MetadataCase {
                    name: format!("{}-{}-bytes", boundary.name, max_bytes + extra),
                    value: value.into(),
                    filename_valid: extra == 0,
                    source_valid: extra == 0,
                });
            }
        }
        cases
    }
}

#[test]
fn shared_browser_metadata_matrix_preserves_rust_acceptance_and_exact_values() {
    let matrix: MetadataMatrix = serde_json::from_str(include_str!(
        "../../../tests/fixtures/evidence-metadata-parity.json"
    ))
    .unwrap();
    assert_eq!(
        matrix.fields.keys().map(String::as_str).collect::<Vec<_>>(),
        [
            "account",
            "coverage",
            "filename",
            "selection",
            "source_version",
            "system"
        ]
    );
    for (field, max_bytes) in &matrix.fields {
        let cases = matrix.cases(*max_bytes);
        for case in &cases {
            let mut candidate = json!({
                "key": "request-a", "filename": "original.txt",
                "identity": { "sha256": "a".repeat(64), "size": 15 },
                "source": { "system": "Asserted ledger", "account": null,
                    "source_version": null, "selection": null, "coverage": null }
            });
            let expected = if field == "filename" {
                candidate[field] = case.value.clone();
                case.filename_valid
            } else {
                candidate["source"][field] = case.value.clone();
                case.source_valid
            };
            let parsed = serde_json::from_value::<EvidenceReservationRequest>(candidate.clone());
            let domain = parsed.map(ReservationRequest::from);
            assert_eq!(
                domain.as_ref().is_ok_and(ReservationRequest::is_valid),
                expected,
                "{field}: {}",
                case.name
            );
            if expected {
                let serialized = serde_json::to_value(EvidenceReservationRequest::from(
                    domain.expect("accepted metadata deserializes"),
                ))
                .unwrap();
                assert_eq!(serialized, candidate, "{field}: {}", case.name);
            }
        }
        println!("{field}: all {} shared cases passed", cases.len());
    }
}

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
