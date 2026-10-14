use super::*;
use crate::{
    analysis::tests::{Objects, digest},
    model::{Capabilities, ModelEvent, Provider, Qualification, Usage},
};
use std::{
    collections::BTreeMap,
    sync::Mutex,
    task::{Context, Poll, Waker},
};

const DOCUMENT: &str = "AP Method 2025\n\nAP-1 Invoice approval (mandatory)\nCriteria: Payments over 10,000 have two approvals.\nEvidence: approval log.\n\nAP-2 Vendor master changes\nThe threshold is 5,000 in section 2 but 10,000 in section 4.\n";

fn run<F: Future>(future: F) -> F::Output {
    let mut future = std::pin::pin!(future);
    let mut context = Context::from_waker(Waker::noop());
    match future.as_mut().poll(&mut context) {
        Poll::Ready(value) => value,
        Poll::Pending => panic!("synchronous fixture unexpectedly pending"),
    }
}

fn s(text: &str) -> JsonValue {
    JsonValue::String(text.into())
}
fn obj(fields: Vec<(&str, JsonValue)>) -> JsonValue {
    JsonValue::Object(
        fields
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect::<BTreeMap<_, _>>(),
    )
}
fn cited(value: &str, quote: &str) -> JsonValue {
    obj(vec![("value", s(value)), ("quote", s(quote))])
}
fn requirement(
    id: &str,
    label: JsonValue,
    mandatory: (bool, &str),
    criteria: Vec<JsonValue>,
) -> JsonValue {
    obj(vec![
        ("id", s(id)),
        ("label", label),
        (
            "mandatory",
            obj(vec![
                ("value", JsonValue::Bool(mandatory.0)),
                ("quote", s(mandatory.1)),
            ]),
        ),
        ("criteria", JsonValue::Array(criteria)),
        ("populations", JsonValue::Array(vec![])),
        (
            "evidence_checks",
            JsonValue::Array(vec![cited("Approval log", "Evidence: approval log.")]),
        ),
        ("ratings", JsonValue::Array(vec![])),
        ("review_rules", JsonValue::Array(vec![])),
    ])
}

fn answer() -> JsonValue {
    obj(vec![
        ("name", cited("AP Method 2025", "AP Method 2025")),
        (
            "requirements",
            JsonValue::Array(vec![
                requirement(
                    "AP-1",
                    cited("Invoice approval", "AP-1 Invoice approval"),
                    (true, "AP-1 Invoice approval (mandatory)"),
                    vec![
                        cited(
                            "Payments over 10,000 have two approvals",
                            "Payments over 10,000 have two approvals.",
                        ),
                        // A quote the document does not contain is discarded.
                        cited(
                            "All payments are reviewed monthly",
                            "All payments are reviewed monthly.",
                        ),
                    ],
                ),
                requirement(
                    "AP-2",
                    cited("Vendor master changes", "AP-2 Vendor master changes"),
                    (true, "AP-2 is mandatory"),
                    vec![],
                ),
                // An invented requirement whose label is not in the document.
                requirement(
                    "AP-3",
                    cited("Fraud review", "AP-3 Fraud review"),
                    (true, ""),
                    vec![],
                ),
            ]),
        ),
        (
            "conflicts",
            JsonValue::Array(vec![obj(vec![
                ("text", s("Two different thresholds are stated.")),
                (
                    "quote",
                    s("The threshold is 5,000 in section 2 but 10,000 in section 4."),
                ),
            ])]),
        ),
        (
            "missing_criteria",
            JsonValue::Array(vec![s("AP-2"), s("AP-9")]),
        ),
    ])
}

fn profile() -> ModelProfile {
    ModelProfile {
        id: "loopback".into(),
        revision: 1,
        provider: Provider::OpenAi,
        model: "fixture-model".into(),
        destination: "destination".into(),
        account_id: "account".into(),
        capability_revision: "v1".into(),
        qualification: Qualification::Fixture,
        enabled: true,
        capabilities: Capabilities {
            tools: false,
            structured_output: true,
            reasoning: false,
            image_input: false,
        },
        max_output_tokens: 4096,
    }
}

fn outcome(value: Option<JsonValue>, completion: Completion) -> TransportOutcome {
    TransportOutcome {
        events: value
            .map(|value| {
                vec![ModelEvent {
                    sequence: 0,
                    kind: EventKind::Structured {
                        item_id: "item-1".into(),
                        value,
                    },
                }]
            })
            .unwrap_or_default(),
        actual_provider: Provider::OpenAi,
        actual_model: Some("fixture-model".into()),
        response_id: Some("response-1".into()),
        usage: Usage::default(),
        completion,
    }
}

struct Transport {
    reply: Mutex<Vec<TransportOutcome>>,
    sent: Mutex<Vec<ModelRequest>>,
}
impl ModelTransport for Transport {
    async fn invoke(&self, request: &ModelRequest, _: &ModelCancellation) -> TransportOutcome {
        self.sent.lock().unwrap().push(request.clone());
        self.reply.lock().unwrap().remove(0)
    }
}

#[derive(Default)]
struct Store {
    rows: Mutex<Vec<StoredProposal>>,
    profile: Mutex<Option<ModelProfile>>,
    /// Order of facts, to prove the disclosure precedes the send.
    log: Mutex<Vec<String>>,
}
impl ProposalStore for Store {
    async fn profile(
        &self,
        _: &str,
        _: &str,
        id: &str,
    ) -> Result<Option<ModelProfile>, ProposalError> {
        Ok(self.profile.lock().unwrap().clone().filter(|p| p.id == id))
    }
    async fn by_key(
        &self,
        actor: &str,
        _: &str,
        key: &str,
    ) -> Result<Option<StoredProposal>, ProposalError> {
        Ok(self
            .rows
            .lock()
            .unwrap()
            .iter()
            .find(|p| p.actor_id == actor && p.key == key)
            .cloned())
    }
    async fn disclose(
        &self,
        actor: &str,
        _: &str,
        key: &str,
        id: &str,
        disclosure: &ProposalDisclosure,
    ) -> Result<i64, ProposalError> {
        self.log.lock().unwrap().push("disclosure".into());
        if self
            .rows
            .lock()
            .unwrap()
            .iter()
            .any(|p| p.actor_id == actor && p.key == key)
        {
            return Err(ProposalError::Conflict);
        }
        self.rows.lock().unwrap().push(StoredProposal {
            id: id.into(),
            key: key.into(),
            actor_id: actor.into(),
            disclosure: disclosure.clone(),
            result: None,
            created_us: 1_000_000,
            observed_us: 1_000_000,
        });
        Ok(1_000_000)
    }
    async fn record_result(
        &self,
        _: &str,
        _: &str,
        _: &str,
        id: &str,
        result: &ProposalResult,
    ) -> Result<ProposalResult, ProposalError> {
        self.log.lock().unwrap().push("result".into());
        let mut rows = self.rows.lock().unwrap();
        let row = rows
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or(ProposalError::Invalid)?;
        row.result = Some(result.clone());
        Ok(result.clone())
    }
    async fn proposal(
        &self,
        _: &str,
        _: &str,
        id: &str,
    ) -> Result<Option<StoredProposal>, ProposalError> {
        Ok(self
            .rows
            .lock()
            .unwrap()
            .iter()
            .find(|p| p.id == id)
            .cloned())
    }
}

fn request() -> ProposeMethodology {
    ProposeMethodology {
        key: "ap-method".into(),
        profile_id: "loopback".into(),
        filename: "AP method 2025.md".into(),
        media_type: "text/markdown".into(),
        text: DOCUMENT.into(),
    }
}

#[test]
fn every_kept_field_cites_its_exact_document_location() {
    let drafted = draft(&answer(), DOCUMENT).unwrap();
    let requirements = &drafted.definition.requirements;
    assert_eq!(
        requirements
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        ["AP-1", "AP-2"],
        "an invented requirement is not kept"
    );
    assert_eq!(
        requirements[0].criteria,
        Some(vec!["Payments over 10,000 have two approvals".to_string()])
    );
    assert!(requirements[0].mandatory);
    // The mandatory flag of AP-2 is not supported by the document.
    assert!(!requirements[1].mandatory);
    for citation in &drafted.citations {
        let location = &citation.location;
        assert_eq!(
            &DOCUMENT[location.start as usize..location.end as usize],
            citation.quote,
            "{}",
            citation.field
        );
        assert_eq!(
            location.line,
            1 + DOCUMENT[..location.start as usize].matches('\n').count() as u64
        );
    }
    let fields: Vec<&str> = drafted.citations.iter().map(|c| c.field.as_str()).collect();
    for field in [
        "name",
        "requirements[0].label",
        "requirements[0].mandatory",
        "requirements[0].criteria[0]",
        "requirements[0].evidence_checks[0]",
        "requirements[1].label",
    ] {
        assert!(fields.contains(&field), "{field} is cited");
    }
    assert!(
        drafted
            .unverified
            .contains(&"requirements[0].criteria (proposed item 1)".to_string())
    );
    assert!(
        drafted
            .unverified
            .contains(&"requirements[1].mandatory".to_string())
    );
    assert!(
        drafted
            .unverified
            .contains(&"proposed requirement 2 (AP-3)".to_string())
    );
    // Missing criteria are computed, not taken from the model's list (AP-9).
    assert_eq!(drafted.missing_criteria, ["AP-2"]);
    assert_eq!(drafted.conflicts.len(), 1);
    assert_eq!(drafted.conflicts[0].location.line, 8);
}

#[test]
fn nothing_verified_means_no_proposal() {
    let empty = obj(vec![
        ("name", cited("Invented", "Invented")),
        (
            "requirements",
            JsonValue::Array(vec![requirement(
                "X-1",
                cited("Made up", "Made up"),
                (true, ""),
                vec![],
            )]),
        ),
        ("conflicts", JsonValue::Array(vec![])),
        ("missing_criteria", JsonValue::Array(vec![])),
    ]);
    assert!(draft(&empty, DOCUMENT).is_none());
    assert!(locate(DOCUMENT, "   ").is_none());
    assert!(locate(DOCUMENT, &"x".repeat(MAX_QUOTE_BYTES + 1)).is_none());
}

#[test]
fn disclosure_is_recorded_before_the_send_and_a_retry_never_resends() {
    let store = Store::default();
    *store.profile.lock().unwrap() = Some(profile());
    let objects = Objects::default();
    let transport = Transport {
        reply: Mutex::new(vec![outcome(Some(answer()), Completion::Succeeded)]),
        sent: Mutex::new(vec![]),
    };
    let proposals = Proposals {
        store: &store,
        objects: &objects,
        transport: Some(&transport),
    };
    let cancel = ModelCancellation::new();
    let stored = run(proposals.propose("admin", "org-a", &request(), &cancel)).unwrap();
    assert_eq!(*store.log.lock().unwrap(), ["disclosure", "result"]);
    assert_eq!(
        stored.disclosure.document_sha256,
        digest(DOCUMENT.as_bytes())
    );
    assert_eq!(stored.disclosure.profile_id, "loopback");
    let ProposalResult::Drafted(drafted) = stored.result.clone().unwrap() else {
        panic!("drafted")
    };
    assert_eq!(drafted.source.kind, "imported_proposal");
    assert!(
        drafted
            .source
            .reference
            .as_deref()
            .unwrap()
            .contains(&digest(DOCUMENT.as_bytes()))
    );
    // The exact bytes are in custody.
    let sent = transport.sent.lock().unwrap().clone();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        sent[0].disclosure.material_digest,
        digest(DOCUMENT.as_bytes())
    );
    assert!(
        sent[0].catalogue.tools.is_empty(),
        "a proposal proposes no tool"
    );
    assert!(sent[0].messages[1].text.contains("Payments over 10,000"));
    // Exact retry: the recorded fact, no second send.
    let again = run(proposals.propose("admin", "org-a", &request(), &cancel)).unwrap();
    assert_eq!(again.id, stored.id);
    assert_eq!(stored.id, proposal_id("org-a", "admin", "ap-method"));
    assert_eq!(
        sent[0].key,
        format!("proposal-{}", stored.id),
        "the request key names the proposal"
    );
    assert_eq!(
        stored.disclosure.reservation_id,
        proposal_object_id("org-a", &digest(DOCUMENT.as_bytes()))
    );
    // The disclosure expiry is the database time of the disclosure.
    assert_eq!(
        sent[0].disclosure.expires_at,
        1 + PROPOSAL_SEND_WINDOW_US / 1_000_000
    );
    assert_eq!(transport.sent.lock().unwrap().len(), 1);
    // The same key with another document is a conflict.
    let mut other = request();
    other.text.push_str("More.");
    assert_eq!(
        run(proposals.propose("admin", "org-a", &other, &cancel)).unwrap_err(),
        ProposalError::Conflict
    );
}

#[test]
fn an_uncertain_send_is_reported_and_not_sent_again() {
    let store = Store::default();
    *store.profile.lock().unwrap() = Some(profile());
    let objects = Objects::default();
    // A disclosure exists without a result: possibly sent.
    run(store.disclose(
        "admin",
        "org-a",
        "ap-method",
        "p1",
        &ProposalDisclosure {
            filename: "AP method 2025.md".into(),
            media_type: "text/markdown".into(),
            document_sha256: digest(DOCUMENT.as_bytes()),
            document_size: DOCUMENT.len() as u64,
            reservation_id: "methodology-proposal-p1".into(),
            namespace: "n".into(),
            object_version: "v1".into(),
            profile_id: "loopback".into(),
            profile_revision: 1,
            provider: "openai".into(),
            model: "fixture-model".into(),
            destination: "destination".into(),
        },
    ))
    .unwrap();
    let transport = Transport {
        reply: Mutex::new(vec![]),
        sent: Mutex::new(vec![]),
    };
    let proposals = Proposals {
        store: &store,
        objects: &objects,
        transport: Some(&transport),
    };
    let stored =
        run(proposals.propose("admin", "org-a", &request(), &ModelCancellation::new())).unwrap();
    assert!(stored.result.is_none());
    assert!(transport.sent.lock().unwrap().is_empty());
}

#[test]
fn provider_failure_is_recorded_and_no_proposal_is_fabricated() {
    for (reply, reason) in [
        (
            outcome(None, Completion::Failed(ModelError::Provider)),
            "model_provider_error",
        ),
        (outcome(None, Completion::Refused), "model_refused"),
        (outcome(None, Completion::Succeeded), "model_malformed"),
    ] {
        let store = Store::default();
        *store.profile.lock().unwrap() = Some(profile());
        let objects = Objects::default();
        let transport = Transport {
            reply: Mutex::new(vec![reply]),
            sent: Mutex::new(vec![]),
        };
        let proposals = Proposals {
            store: &store,
            objects: &objects,
            transport: Some(&transport),
        };
        let stored =
            run(proposals.propose("admin", "org-a", &request(), &ModelCancellation::new()))
                .unwrap();
        assert_eq!(
            stored.result,
            Some(ProposalResult::Failed {
                reason: reason.into()
            })
        );
        assert_eq!(*store.log.lock().unwrap(), ["disclosure", "result"]);
    }
}

#[test]
fn no_transport_or_unusable_profile_records_and_sends_nothing() {
    let store = Store::default();
    let objects = Objects::default();
    let none: Proposals<'_, Store, Objects, Transport> = Proposals {
        store: &store,
        objects: &objects,
        transport: None,
    };
    let cancel = ModelCancellation::new();
    assert_eq!(
        run(none.propose("admin", "org-a", &request(), &cancel)).unwrap_err(),
        ProposalError::Unavailable
    );
    let transport = Transport {
        reply: Mutex::new(vec![]),
        sent: Mutex::new(vec![]),
    };
    let proposals = Proposals {
        store: &store,
        objects: &objects,
        transport: Some(&transport),
    };
    // No usable profile.
    assert_eq!(
        run(proposals.propose("admin", "org-a", &request(), &cancel)).unwrap_err(),
        ProposalError::Unavailable
    );
    let mut text_only = profile();
    text_only.capabilities.structured_output = false;
    *store.profile.lock().unwrap() = Some(text_only);
    assert_eq!(
        run(proposals.propose("admin", "org-a", &request(), &cancel)).unwrap_err(),
        ProposalError::Unavailable
    );
    assert!(store.log.lock().unwrap().is_empty());
    assert!(transport.sent.lock().unwrap().is_empty());
    // Only plain text documents are accepted for in-process verification.
    let mut pdf = request();
    pdf.media_type = "application/pdf".into();
    assert!(!pdf.is_valid());
}

#[test]
fn short_or_ambiguous_quotes_never_verify() {
    // Too short to mean something.
    assert!(locate(DOCUMENT, "AP-1").is_none());
    assert!(locate(DOCUMENT, "(mandatory)").is_none());
    // Three words are enough even when short.
    assert!(locate("a b c d", "a b c").is_some());
    // A quote that occurs more than once is ambiguous.
    let repeated = "The threshold is ten thousand.\nThe threshold is ten thousand.\n";
    assert!(locate(repeated, "The threshold is ten thousand.").is_none());
    assert!(locate(DOCUMENT, "Payments over 10,000 have two approvals.").is_some());
}

#[test]
fn over_limit_values_and_an_invalid_name_are_listed_as_unverified() {
    let mut document = String::from("Method name line\n");
    let mut criteria = Vec::new();
    for i in 0..(MAX_FIELD_VALUES + 2) {
        let line = format!("Criterion number {i} applies here.");
        document.push_str(&line);
        document.push('\n');
        criteria.push(cited(&format!("Criterion {i}"), &line));
    }
    document.push_str("REQ-1 Requirement label\n");
    let value = obj(vec![
        // A name that is not a valid label (a control character) is not kept.
        ("name", cited("Bad\u{7}name", "Method name line")),
        (
            "requirements",
            JsonValue::Array(vec![obj(vec![
                ("id", s("REQ-1")),
                (
                    "label",
                    cited("Requirement label", "REQ-1 Requirement label"),
                ),
                (
                    "mandatory",
                    obj(vec![("value", JsonValue::Bool(false)), ("quote", s(""))]),
                ),
                ("criteria", JsonValue::Array(criteria)),
                ("populations", JsonValue::Array(vec![])),
                ("evidence_checks", JsonValue::Array(vec![])),
                ("ratings", JsonValue::Array(vec![])),
                ("review_rules", JsonValue::Array(vec![])),
            ])]),
        ),
        ("conflicts", JsonValue::Array(vec![])),
        ("missing_criteria", JsonValue::Array(vec![])),
    ]);
    let drafted = draft(&value, &document).unwrap();
    assert_eq!(drafted.definition.name, "Imported methodology proposal");
    assert!(drafted.unverified.contains(&"name".to_string()));
    assert!(!drafted.citations.iter().any(|c| c.field == "name"));
    assert_eq!(
        drafted.definition.requirements[0]
            .criteria
            .as_ref()
            .unwrap()
            .len(),
        MAX_FIELD_VALUES
    );
    for index in [MAX_FIELD_VALUES, MAX_FIELD_VALUES + 1] {
        assert!(drafted.unverified.contains(&format!(
            "requirements[0].criteria (proposed item {index}, over the limit)"
        )));
    }
}

#[test]
fn a_failed_key_is_returned_on_retry_without_a_second_send() {
    let store = Store::default();
    *store.profile.lock().unwrap() = Some(profile());
    let objects = Objects::default();
    let transport = Transport {
        reply: Mutex::new(vec![outcome(None, Completion::Refused)]),
        sent: Mutex::new(vec![]),
    };
    let proposals = Proposals {
        store: &store,
        objects: &objects,
        transport: Some(&transport),
    };
    let cancel = ModelCancellation::new();
    let first = run(proposals.propose("admin", "org-a", &request(), &cancel)).unwrap();
    assert!(matches!(first.result, Some(ProposalResult::Failed { .. })));
    let again = run(proposals.propose("admin", "org-a", &request(), &cancel)).unwrap();
    assert_eq!(again.result, first.result);
    assert_eq!(transport.sent.lock().unwrap().len(), 1);
    // An exact retry is answered with no object store or transport at all.
    assert_eq!(
        exact_retry(again.clone(), &request(), &digest(DOCUMENT.as_bytes()))
            .unwrap()
            .id,
        first.id
    );
}

#[test]
fn a_disclosure_without_result_is_in_progress_then_uncertain() {
    let mut stored = StoredProposal {
        id: "p".into(),
        key: "k".into(),
        actor_id: "admin".into(),
        disclosure: ProposalDisclosure {
            filename: "f.md".into(),
            media_type: "text/markdown".into(),
            document_sha256: "0".repeat(64),
            document_size: 1,
            reservation_id: "r".into(),
            namespace: "n".into(),
            object_version: "v".into(),
            profile_id: "loopback".into(),
            profile_revision: 1,
            provider: "openai".into(),
            model: "m".into(),
            destination: "d".into(),
        },
        result: None,
        created_us: 0,
        observed_us: PROPOSAL_SEND_WINDOW_US - 1,
    };
    assert!(stored.in_progress());
    stored.observed_us = PROPOSAL_SEND_WINDOW_US;
    assert!(!stored.in_progress());
}
