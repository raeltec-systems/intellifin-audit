//! Story 22.6 AC4: an Admin methodology document becomes an editable, cited
//! proposal over actual HTTP, PostgreSQL, S3 protocol and a loopback model
//! provider. Nothing becomes effective before the ordinary validated Save.
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection};
use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use zobba_application::{
    identity::CurrentAuthority,
    model::{Capabilities, ModelProfile, ModelQualificationSource, Provider, Qualification},
};
use zobba_infrastructure::{
    RuntimeDatabase, database_options,
    evidence::s3::S3EvidenceObjects,
    identity::{IdentityRepository, secret_hash},
    migrate,
    model::{ModelRepository, native::NativeAdapter},
};

#[path = "../../infrastructure/tests/support/s3_protocol.rs"]
mod s3_protocol;
#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const NAMESPACE: &str = "6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e6e";
const PROPOSALS: &str = "/methodology/organisations/org-a/proposals";
const SNAPSHOT: &str = "/methodology/organisations/org-a";
const SAVE: &str = "/methodology/organisations/org-a/save";
const DOCUMENT: &str = "# Accounts payable method 2025\n\nAP-1 Invoice approval (mandatory)\nCriteria: Payments over 10,000 have two approvals.\nEvidence: the approval log for the period.\n\nAP-2 Vendor master changes (mandatory)\nThe change threshold is 5,000 in section 2 but 10,000 in section 4.\n";

struct Fixture;
impl ModelQualificationSource for Fixture {
    fn qualified(&self, p: &ModelProfile) -> bool {
        p.qualification == Qualification::Fixture && p.account_id == "fixture-account"
    }
}

#[derive(Clone)]
struct Browser {
    client: Client,
    address: String,
    origin: String,
    token: String,
    csrf: String,
    actor: String,
}
impl Browser {
    fn request(&self, method: Method, route: &str) -> RequestBuilder {
        self.client
            .request(method, format!("{}{route}", self.address))
            .header("Cookie", format!("__Host-zobba-session={}", self.token))
            .header("X-Expected-Session", &self.csrf)
    }
    async fn read(&self, route: &str) -> Response {
        self.request(Method::GET, route).send().await.unwrap()
    }
    async fn command(&self, route: &str, value: &Value) -> Response {
        self.request(Method::POST, route)
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("Content-Type", "application/json")
            .body(value.to_string())
            .send()
            .await
            .unwrap()
    }
    async fn sign_in(&self, identities: &IdentityRepository, issuer: &str, subject: &str) -> Self {
        let token = identities
            .establish_verified_session(issuer, subject, subject, None, None)
            .await
            .unwrap();
        let session = identities.session(&token).await.unwrap();
        Self {
            token,
            csrf: session.csrf_token,
            actor: session.identity.id,
            ..self.clone()
        }
    }
}
async fn document(response: Response, expected: StatusCode) -> Value {
    let status = response.status();
    let text = response.text().await.unwrap();
    assert_eq!(status, expected, "{text}");
    serde_json::from_str(&text).unwrap()
}

/// Answers each request in order (the last repeats), recording each body.
struct Loopback {
    endpoint: String,
    sends: Arc<AtomicUsize>,
    bodies: Arc<std::sync::Mutex<Vec<String>>>,
}
impl Loopback {
    async fn answering(replies: Vec<Vec<u8>>) -> Self {
        Self::answering_after(replies, Duration::ZERO).await
    }
    /// Answers only after `delay`, to hold a draft past the POST wait.
    async fn answering_after(replies: Vec<Vec<u8>>, delay: Duration) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/native", listener.local_addr().unwrap());
        let sends = Arc::new(AtomicUsize::new(0));
        let bodies = Arc::new(std::sync::Mutex::new(Vec::new()));
        let (count, seen) = (sends.clone(), bodies.clone());
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0u8; 4 << 20];
                let mut total = 0;
                loop {
                    let n = socket.read(&mut buffer[total..]).await.unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    total += n;
                    let text = String::from_utf8_lossy(&buffer[..total]);
                    if let Some(end) = text.find("\r\n\r\n") {
                        let length = text[..end]
                            .lines()
                            .find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .and_then(|v| v.parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if total >= end + 4 + length {
                            seen.lock().unwrap().push(
                                String::from_utf8_lossy(&buffer[end + 4..end + 4 + length])
                                    .into_owned(),
                            );
                            count.fetch_add(1, Ordering::SeqCst);
                            break;
                        }
                    }
                }
                tokio::time::sleep(delay).await;
                let index = count.load(Ordering::SeqCst).saturating_sub(1);
                let reply = replies.get(index).or(replies.last()).unwrap();
                let _ = socket.write_all(reply).await;
                let _ = socket.shutdown().await;
            }
        });
        Self {
            endpoint,
            sends,
            bodies,
        }
    }
}

fn text_reply(text: &str) -> Vec<u8> {
    let part = json!({"type":"output_text","text":text});
    let item = json!({"id":"message-1","type":"message","role":"assistant","status":"completed","content":[part.clone()]});
    let mut values = [
        json!({"type":"response.created","response":{"id":"response-1","model":"fixture-model","status":"in_progress"}}),
        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"message-1","type":"message","role":"assistant","status":"in_progress","content":[]}}),
        json!({"type":"response.content_part.added","output_index":0,"item_id":"message-1","content_index":0,"part":{"type":"output_text","text":""}}),
        json!({"type":"response.output_text.delta","output_index":0,"item_id":"message-1","content_index":0,"delta":text}),
        json!({"type":"response.output_text.done","output_index":0,"item_id":"message-1","content_index":0,"text":text}),
        json!({"type":"response.content_part.done","output_index":0,"item_id":"message-1","content_index":0,"part":part}),
        json!({"type":"response.output_item.done","output_index":0,"item":item.clone()}),
        json!({"type":"response.completed","response":{"id":"response-1","model":"fixture-model","status":"completed","output":[item],"usage":{"input_tokens":17,"output_tokens":4}}}),
    ];
    for (sequence, value) in values.iter_mut().enumerate() {
        value["sequence_number"] = json!(sequence);
    }
    let body: String = values
        .iter()
        .map(|v| {
            format!(
                "event: {}\r\ndata: {v}\r\n\r\n",
                v["type"].as_str().unwrap()
            )
        })
        .collect();
    format!(
        "HTTP/1.1 200 Fixture\r\nContent-Type: text/event-stream; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}
fn failure_reply() -> Vec<u8> {
    let body = r#"{"error":{"type":"server_error","message":"fixture"}}"#;
    format!(
        "HTTP/1.1 500 Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

fn cited(value: &str, quote: &str) -> Value {
    json!({"value": value, "quote": quote})
}
fn requirement(
    id: &str,
    label: Value,
    mandatory: (bool, &str),
    criteria: Vec<Value>,
    evidence: Vec<Value>,
) -> Value {
    json!({"id": id, "label": label, "mandatory": {"value": mandatory.0, "quote": mandatory.1},
        "criteria": criteria, "populations": [], "evidence_checks": evidence, "ratings": [], "review_rules": []})
}
fn proposal_answer() -> String {
    json!({
        "name": cited("Accounts payable method 2025", "Accounts payable method 2025"),
        "requirements": [
            requirement("AP-1", cited("Invoice approval", "AP-1 Invoice approval"), (true, "AP-1 Invoice approval (mandatory)"),
                vec![cited("Payments over 10,000 have two approvals", "Payments over 10,000 have two approvals."),
                     cited("Every invoice is matched to a purchase order", "Every invoice is matched to a purchase order.")],
                vec![cited("Approval log for the period", "the approval log for the period")]),
            requirement("AP-2", cited("Vendor master changes", "AP-2 Vendor master changes"), (true, "AP-2 Vendor master changes (mandatory)"), vec![], vec![]),
            requirement("AP-7", cited("Fraud review", "AP-7 Fraud review"), (true, ""), vec![], vec![]),
        ],
        "conflicts": [{"text": "Two different change thresholds are stated.",
            "quote": "The change threshold is 5,000 in section 2 but 10,000 in section 4."}],
        "missing_criteria": ["AP-2", "AP-9"],
    })
    .to_string()
}

fn profile() -> ModelProfile {
    ModelProfile {
        id: "loopback".into(),
        revision: 1,
        provider: Provider::OpenAi,
        model: "fixture-model".into(),
        destination: "fixture-destination".into(),
        account_id: "fixture-account".into(),
        capability_revision: "fixture-native-v1".into(),
        qualification: Qualification::Fixture,
        enabled: true,
        capabilities: Capabilities {
            tools: false,
            structured_output: true,
            reasoning: false,
            image_input: false,
        },
        max_output_tokens: 4_096,
    }
}

async fn fixture(config: &support::Configuration, admin: &mut PgConnection, issuer: &str) {
    let mut migration = PgConnection::connect_with(&database_options(&config.migration).unwrap())
        .await
        .unwrap();
    config.guard_connection(&mut migration).await;
    migration.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;").await.unwrap();
    migration.close().await.unwrap();
    config.guard_connection(admin).await;
    let runtime_role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    migrate(&config.migration, &runtime_role).await.unwrap();
    let mut tx = admin.begin().await.unwrap();
    sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('identity-admin',$1,'admin','Casey'),('identity-auditor',$1,'auditor','Robin')")
        .bind(issuer).execute(&mut *tx).await.unwrap();
    tx.execute("INSERT INTO public.organisations(id,name) VALUES('org-a','Northstar');
        INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a','Alder');
        INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-a','Audit A');
        INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-admin',ARRAY['admin']),('org-a','identity-auditor',ARRAY['auditor']);
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','identity-auditor');")
        .await.unwrap();
    tx.commit().await.unwrap();
}

fn request(key: &str, text: &str) -> Value {
    json!({"key": key, "profile_id": "loopback", "filename": "AP method 2025.md",
        "media_type": "text/markdown", "text": text})
}

#[tokio::test]
async fn an_admin_document_becomes_a_cited_proposal_with_no_effect_before_save() {
    let config = support::Configuration::from_environment();
    let issuer = std::env::var("ZOBBA_OIDC_ISSUER").expect("load fixture OIDC configuration");
    let origin = std::env::var("ZOBBA_PUBLIC_ORIGIN").expect("load fixture public origin");
    let mut admin_db = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .unwrap();
    fixture(&config, &mut admin_db, &issuer).await;
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    let identities = IdentityRepository::new(database.pool().clone());
    let provider = Loopback::answering(vec![text_reply(&proposal_answer()), failure_reply()]).await;
    let s3 = s3_protocol::Fixture::start().await;
    let objects = S3EvidenceObjects::new(
        s3_protocol::build_fixture_store(&s3.endpoint).unwrap(),
        NAMESPACE.into(),
    )
    .unwrap();
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router_with_proposals(
        database.clone(),
        auth.clone(),
        Some(objects),
        zobba_api::proposals::ProposalComposition {
            objects: None,
            transport: Some(Arc::new(
                NativeAdapter::test_loopback(
                    Provider::OpenAi,
                    &provider.endpoint,
                    Duration::from_secs(30),
                )
                .unwrap(),
            )),
            qualifications: Arc::new(Fixture),
        },
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    // The production composition: no proposal transport.
    let production_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let production_address = format!("http://{}", production_listener.local_addr().unwrap());
    let production = zobba_api::authenticated_router_with_evidence(database.clone(), auth, None);
    tokio::spawn(async move { axum::serve(production_listener, production).await.unwrap() });

    let browser = Browser {
        client: Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap(),
        address,
        origin,
        token: String::new(),
        csrf: String::new(),
        actor: String::new(),
    };
    let admin = browser.sign_in(&identities, &issuer, "admin").await;
    let auditor = browser.sign_in(&identities, &issuer, "auditor").await;
    ModelRepository::new(database.pool().clone())
        .with_session_hash(secret_hash(&admin.token))
        .save_profile(&admin.actor, "org-a", &profile())
        .await
        .unwrap();

    // Only an Admin may propose; an auditor records and sends nothing.
    let refused = auditor
        .command(PROPOSALS, &request("ap-method", DOCUMENT))
        .await;
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);
    // Only plain text is verified in-process; a PDF is refused, not guessed.
    let mut pdf = request("ap-pdf", DOCUMENT);
    pdf["media_type"] = json!("application/pdf");
    assert_eq!(
        admin.command(PROPOSALS, &pdf).await.status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(provider.sends.load(Ordering::SeqCst), 0);
    // Production has no proposal transport: refused before any record.
    let production = Browser {
        address: production_address,
        ..admin.clone()
    };
    let unavailable = document(
        production
            .command(PROPOSALS, &request("ap-method", DOCUMENT))
            .await,
        StatusCode::SERVICE_UNAVAILABLE,
    )
    .await;
    assert_eq!(unavailable["error"], "proposal_model_unavailable");
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM public.methodology_proposals")
        .fetch_one(&mut admin_db)
        .await
        .unwrap();
    assert_eq!(rows, 0);

    let proposal = document(
        admin
            .command(PROPOSALS, &request("ap-method", DOCUMENT))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(proposal["status"], "drafted", "{proposal}");
    let sha = format!("{:x}", Sha256::digest(DOCUMENT.as_bytes()));
    assert_eq!(proposal["disclosure"]["document_sha256"], sha);
    assert_eq!(proposal["disclosure"]["profile_id"], "loopback");
    assert_eq!(proposal["disclosure"]["model"], "fixture-model");
    // The provider received the attributed document under strict output.
    let bodies = provider.bodies.lock().unwrap().clone();
    assert_eq!(bodies.len(), 1);
    assert!(bodies[0].contains("Payments over 10,000 have two approvals."));
    assert!(bodies[0].contains("zobba-data class=method"));
    assert!(bodies[0].contains("\"strict\":true"));
    let sent: Value = serde_json::from_str(&bodies[0]).unwrap();
    assert_eq!(sent["tools"], json!([]), "a proposal proposes no tool");
    // Every kept field cites an exact location trusted code found.
    let citations = proposal["citations"].as_array().unwrap();
    assert!(citations.len() >= 7);
    for citation in citations {
        let start: usize = citation["location"]["start"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        let end: usize = citation["location"]["end"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(&DOCUMENT[start..end], citation["quote"].as_str().unwrap());
        let line: usize = citation["location"]["line"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(line, 1 + DOCUMENT[..start].matches('\n').count());
    }
    let definition = &proposal["definition"];
    let requirements = definition["requirements"].as_array().unwrap();
    assert_eq!(
        requirements
            .iter()
            .map(|r| r["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["AP-1", "AP-2"]
    );
    assert_eq!(
        requirements[0]["criteria"],
        json!(["Payments over 10,000 have two approvals"])
    );
    assert_eq!(proposal["missing_criteria"], json!(["AP-2"]));
    assert_eq!(proposal["conflicts"][0]["location"]["line"], "8");
    let unverified: Vec<&str> = proposal["unverified"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(unverified.contains(&"requirements[0].criteria (proposed item 1)"));
    assert!(unverified.contains(&"proposed requirement 2 (AP-7)"));
    assert_eq!(proposal["source"]["kind"], "imported_proposal");
    assert!(
        proposal["source"]["reference"]
            .as_str()
            .unwrap()
            .contains(&sha)
    );

    // The web fixture is this exact API JSON, with only opaque IDs replaced.
    let mut fixture_json = proposal.clone();
    fixture_json["id"] = json!("proposal-1");
    fixture_json["actor_id"] = json!("identity-admin");
    let text = serde_json::to_string_pretty(&fixture_json).unwrap() + "\n";
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../web/tests/fixtures/methodology-proposal.json");
    if std::env::var_os("ZOBBA_UPDATE_PROPOSAL_FIXTURE").is_some() {
        std::fs::write(&path, &text).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&path).unwrap_or_default(),
        text,
        "rerun with ZOBBA_UPDATE_PROPOSAL_FIXTURE=1"
    );
    // The disclosure preceded the result; the exact bytes are in custody.
    let events: Vec<(String, i64)> = sqlx::query_as(
        "SELECT event, created_us FROM public.methodology_proposals ORDER BY created_us, event",
    )
    .fetch_all(&mut admin_db)
    .await
    .unwrap();
    assert_eq!(
        events.iter().map(|e| e.0.as_str()).collect::<Vec<_>>(),
        ["disclosure", "result"]
    );
    assert!(events[0].1 <= events[1].1);
    // The custody object is content-addressed per organisation; the
    // proposal ID is derived from the organisation, Admin and request key.
    assert_eq!(
        proposal["id"],
        zobba_application::proposal::proposal_id("org-a", &admin.actor, "ap-method")
    );
    let reservation = format!(
        "evidence/{}/original",
        zobba_application::proposal::proposal_object_id("org-a", &sha)
    );
    let stored = s3
        .state
        .objects
        .lock()
        .unwrap()
        .get(&reservation)
        .cloned()
        .expect("custody object");
    assert_eq!(stored.len(), 1, "one immutable version");
    assert_eq!(stored[0].body, DOCUMENT.as_bytes());

    // Nothing is effective: no methodology version exists.
    let snapshot = document(admin.read(SNAPSHOT).await, StatusCode::OK).await;
    assert_eq!(snapshot["revision"], "0", "{snapshot}");

    // An exact retry is the recorded fact; nothing is sent again.
    let again = document(
        admin
            .command(PROPOSALS, &request("ap-method", DOCUMENT))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(again["id"], proposal["id"]);
    assert_eq!(provider.sends.load(Ordering::SeqCst), 1);
    let changed = admin
        .command(
            PROPOSALS,
            &request("ap-method", &format!("{DOCUMENT}More.\n")),
        )
        .await;
    assert_eq!(changed.status(), StatusCode::CONFLICT);
    let read = document(
        admin
            .read(&format!("{PROPOSALS}/{}", proposal["id"].as_str().unwrap()))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(read, proposal);
    assert_eq!(
        auditor
            .read(&format!("{PROPOSALS}/{}", proposal["id"].as_str().unwrap()))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );

    // A provider failure is recorded; no proposal is fabricated.
    let failed = document(
        admin
            .command(PROPOSALS, &request("ap-method-2", DOCUMENT))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(failed["status"], "failed");
    assert_eq!(
        failed["reason"], "model_unavailable",
        "HTTP 500 is the closed unavailable code"
    );
    assert_eq!(failed["definition"], Value::Null);
    let list = document(admin.read(PROPOSALS).await, StatusCode::OK).await;
    assert_eq!(list["proposals"].as_array().unwrap().len(), 2);
    // A retry of the failed key is the recorded failure; nothing is resent.
    let failed_again = document(
        admin
            .command(PROPOSALS, &request("ap-method-2", DOCUMENT))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(failed_again, failed);
    assert_eq!(provider.sends.load(Ordering::SeqCst), 2);
    // A document over 200,000 UTF-8 bytes is refused with a specific code,
    // whether it fits the body limit or not; nothing is recorded or sent.
    for size in [200_001, 2_200_000] {
        let big = document(
            admin
                .command(PROPOSALS, &request("ap-big", &"a".repeat(size)))
                .await,
            StatusCode::PAYLOAD_TOO_LARGE,
        )
        .await;
        assert_eq!(big["error"], "document_too_large", "{size}");
    }
    // 200,000 bytes of multi-byte text is fewer characters but still bytes.
    let multibyte = admin
        .command(PROPOSALS, &request("ap-big", &"é".repeat(100_001)))
        .await;
    assert_eq!(multibyte.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(provider.sends.load(Ordering::SeqCst), 2);
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM public.methodology_proposals")
        .fetch_one(&mut admin_db)
        .await
        .unwrap();
    assert_eq!(rows, 4);

    // A draft too large for its record is stored as a fixed failure, never
    // left uncertain. (A native response cannot carry this much; the bound
    // is enforced at the store.)
    {
        use zobba_application::proposal::{
            DraftedProposal, FieldCitation, Location, ProposalDisclosure, ProposalResult,
            ProposalStore,
        };
        let store =
            zobba_infrastructure::proposal::ProposalRepository::new(database.pool().clone())
                .with_session_hash(secret_hash(&admin.token))
                .with_qualification_source(Arc::new(Fixture));
        let drafted_definition: zobba_application::methodology::Definition =
            serde_json::from_value(proposal["definition"].clone()).unwrap();
        let disclosure = ProposalDisclosure {
            filename: "huge.md".into(),
            media_type: "text/markdown".into(),
            document_sha256: sha.clone(),
            document_size: DOCUMENT.len() as u64,
            reservation_id: "methodology-proposal-huge".into(),
            namespace: NAMESPACE.into(),
            object_version: "v1".into(),
            profile_id: "loopback".into(),
            profile_revision: 1,
            provider: "openai".into(),
            model: "fixture-model".into(),
            destination: "fixture-destination".into(),
        };
        let created = store
            .disclose(&admin.actor, "org-a", "ap-huge", "huge", &disclosure)
            .await
            .unwrap();
        assert!(created > 0, "database time");
        let huge = ProposalResult::Drafted(Box::new(DraftedProposal {
            definition: drafted_definition,
            source: serde_json::from_value(proposal["source"].clone()).unwrap(),
            citations: (0..600)
                .map(|i| FieldCitation {
                    field: format!("requirements[0].criteria[{i}]"),
                    quote: "q".repeat(2_000),
                    location: Location {
                        start: 0,
                        end: 1,
                        line: 1,
                    },
                })
                .collect(),
            conflicts: vec![],
            missing_criteria: vec![],
            unverified: vec![],
        }));
        let stored = store
            .record_result(&admin.actor, "org-a", "ap-huge", "huge", &huge)
            .await
            .unwrap();
        assert_eq!(
            stored,
            ProposalResult::Failed {
                reason: "proposal_too_large".into()
            }
        );
        let read = document(
            admin.read(&format!("{PROPOSALS}/huge")).await,
            StatusCode::OK,
        )
        .await;
        assert_eq!(read["status"], "failed");
        assert_eq!(read["reason"], "proposal_too_large");
    }

    // A draft still running when the POST stops waiting is answered as in
    // progress, not uncertain, and its result is recorded once it arrives.
    {
        let slow = Loopback::answering_after(
            vec![text_reply(&proposal_answer())],
            Duration::from_secs(12),
        )
        .await;
        let objects = S3EvidenceObjects::new(
            s3_protocol::build_fixture_store(&s3.endpoint).unwrap(),
            NAMESPACE.into(),
        )
        .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let app = zobba_api::authenticated_router_with_proposals(
            database.clone(),
            zobba_api::auth::AuthState::from_environment(&database).unwrap(),
            Some(objects),
            zobba_api::proposals::ProposalComposition {
                objects: None,
                transport: Some(Arc::new(
                    NativeAdapter::test_loopback(
                        Provider::OpenAi,
                        &slow.endpoint,
                        Duration::from_secs(30),
                    )
                    .unwrap(),
                )),
                qualifications: Arc::new(Fixture),
            },
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let slow_admin = Browser {
            address,
            ..admin.clone()
        };
        let started = std::time::Instant::now();
        let pending = document(
            slow_admin
                .command(PROPOSALS, &request("ap-slow", DOCUMENT))
                .await,
            StatusCode::OK,
        )
        .await;
        assert!(started.elapsed() < Duration::from_secs(14));
        assert_eq!(pending["status"], "in_progress", "{pending}");
        // A read is never refused because a draft is in flight.
        assert_eq!(slow_admin.read(PROPOSALS).await.status(), StatusCode::OK);
        let id = pending["id"].as_str().unwrap().to_owned();
        let mut drafted = Value::Null;
        for _ in 0..40 {
            let read = document(
                slow_admin.read(&format!("{PROPOSALS}/{id}")).await,
                StatusCode::OK,
            )
            .await;
            if read["status"] != "in_progress" {
                drafted = read;
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        assert_eq!(drafted["status"], "drafted", "{drafted}");
        assert_eq!(slow.sends.load(Ordering::SeqCst), 1);
        // The same document reuses its content-addressed custody object.
        assert_eq!(
            s3.state
                .objects
                .lock()
                .unwrap()
                .get(&reservation)
                .map(|versions| versions.len()),
            Some(1)
        );
    }

    // The Admin's existing validated Save is the only way it takes effect.
    let save = json!({
        "key": "save-imported", "expected_revision": "0", "supersedes": null, "undo_of": null,
        "assignment": {"kind": "firm", "client_id": null, "engagement_id": null},
        "applicability": {"audit_area": null, "period_start": null, "period_end": null},
        "activation": {"mode": "new_tasks", "available_at": 0},
        "definition": proposal["definition"], "source": proposal["source"],
    });
    let receipt = document(admin.command(SAVE, &save).await, StatusCode::OK).await;
    assert!(receipt["version_id"].is_string(), "{receipt}");
    let snapshot = document(admin.read(SNAPSHOT).await, StatusCode::OK).await;
    assert_eq!(snapshot["revision"], "1");

    // The facts are immutable even for a role that bypasses RLS, and a result
    // never stands without its disclosure.
    let update = sqlx::query("UPDATE public.methodology_proposals SET document='{}'::jsonb")
        .execute(&mut admin_db)
        .await
        .unwrap_err();
    assert!(
        update
            .to_string()
            .contains("investigation records are immutable"),
        "{update}"
    );
    let orphan = sqlx::query("INSERT INTO public.methodology_proposals(organisation_id,id,event,actor_id,key,document) VALUES('org-a','orphan','result','identity-admin','orphan','{\"status\":\"drafted\"}')")
        .execute(&mut admin_db)
        .await
        .unwrap_err();
    assert!(
        orphan
            .to_string()
            .contains("a proposal result follows its recorded disclosure"),
        "{orphan}"
    );
    s3.stop().await;
}
