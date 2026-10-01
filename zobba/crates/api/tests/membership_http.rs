//! Real HTTP, opaque-session and PostgreSQL membership contract. This test owns
//! only a guarded disposable schema. Signed OIDC verification has its own suite;
//! these sessions enter through the same repository port as its verified callback.
use reqwest::{Client, Method, RequestBuilder, Response, StatusCode};
use serde_json::{Value, json};
use sqlx::{Connection, Executor, PgConnection};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    time::timeout,
};
use zobba_application::identity::CurrentAuthority;
use zobba_infrastructure::{
    RuntimeDatabase, database_options,
    identity::{IdentityRepository, random_secret, secret_hash},
    migrate,
};

#[path = "../../infrastructure/tests/support/mod.rs"]
mod support;

const ORGANISATIONS: &str = "/membership/organisations";
const ORGANISATION: &str = "/membership/organisations/org-a";
const MEMBERS: &str = "/membership/organisations/org-a/members";
const INVITATIONS: &str = "/membership/organisations/org-a/invitations";
const ACCEPT: &str = "/membership/invitations/accept";
const PREVIEW: &str = "/membership/invitations/preview";
const ENGAGEMENT: &str = "/engagements/engagement-a?organisation_id=org-a&client_id=client-a";

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
    }

    fn get(&self, route: &str) -> RequestBuilder {
        self.request(Method::GET, route)
            .header("X-Expected-Session", &self.csrf)
    }

    fn post(&self, route: &str) -> RequestBuilder {
        self.request(Method::POST, route)
            .header("Origin", &self.origin)
            .header("X-CSRF-Token", &self.csrf)
            .header("X-Expected-Actor", &self.actor)
            .header("X-Expected-Session", &self.csrf)
            .header("Content-Type", "application/json")
    }

    async fn read(&self, route: &str) -> Response {
        self.get(route).send().await.unwrap()
    }

    async fn command(&self, route: &str, body: &Value) -> Response {
        self.post(route)
            .body(body.to_string())
            .send()
            .await
            .unwrap()
    }

    async fn sign_in(
        &self,
        identities: &IdentityRepository,
        issuer: &str,
        subject: &str,
        email: Option<&str>,
        previous: Option<&str>,
    ) -> Self {
        let token = identities
            .establish_verified_session(issuer, subject, subject, email, previous)
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

    async fn version(&self) -> Value {
        document(self.read(ORGANISATION).await, StatusCode::OK).await["version"].clone()
    }

    async fn issue(&self, key: &str, recipient: &str) -> (Value, Value) {
        let command = json!({
            "key": key,
            "expected_version": self.version().await,
            "recipient_email": recipient,
            "roles": ["auditor"],
            "assignments": [{"client_id":"client-a","engagement_id":"engagement-a"}],
            "expires_in_seconds": 600,
            "secret": random_secret().unwrap(),
        });
        let receipt = document(self.command(INVITATIONS, &command).await, StatusCode::OK).await;
        (command, receipt)
    }
}

async fn document(response: Response, expected: StatusCode) -> Value {
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["content-type"], "application/json");
    assert!(
        !response.headers().contains_key("set-cookie"),
        "membership responses cannot replace or clear the current session"
    );
    let status = response.status();
    let text = response.text().await.unwrap();
    assert_eq!(status, expected, "{text}");
    serde_json::from_str(&text).unwrap()
}

async fn refused(response: Response, status: StatusCode, code: &str) {
    assert_eq!(document(response, status).await, json!({"error":code}));
}

// The database commits and the API answers, but a test-owned proxy discards the
// acknowledgement. The browser must recover with the original exact command.
async fn lose_acknowledgement(browser: &Browser, route: &str, body: &Value) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_address = format!("http://{}", listener.local_addr().unwrap());
    let upstream = browser.address.strip_prefix("http://").unwrap().to_owned();
    let proxy = tokio::spawn(async move {
        let (mut downstream, _) = listener.accept().await.unwrap();
        let mut head = Vec::new();
        while !head.ends_with(b"\r\n\r\n") {
            head.push(downstream.read_u8().await.unwrap());
            assert!(head.len() <= 16_384);
        }
        let length: usize = std::str::from_utf8(&head)
            .unwrap()
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length: ")
                    .map(str::to_owned)
            })
            .unwrap()
            .parse()
            .unwrap();
        assert!(length < 32 * 1024);
        let mut body = vec![0; length];
        downstream.read_exact(&mut body).await.unwrap();
        let mut server = TcpStream::connect(upstream).await.unwrap();
        server.write_all(&head).await.unwrap();
        server.write_all(&body).await.unwrap();
        let mut response = Vec::new();
        server.read_to_end(&mut response).await.unwrap();
        assert!(response.starts_with(b"HTTP/1.1 200 "));
        drop(downstream);
    });
    let response = Browser {
        address: proxy_address,
        ..browser.clone()
    }
    .post(route)
    .header("Connection", "close")
    .body(body.to_string())
    .send()
    .await;
    assert!(response.is_err(), "the committed acknowledgement was lost");
    timeout(Duration::from_secs(10), proxy)
        .await
        .unwrap()
        .unwrap();
}

fn save(key: &str, version: Value, actor: &str, roles: &[&str], active: bool) -> Value {
    json!({
        "key": key, "expected_version": version, "actor_id": actor,
        "roles": roles, "active": active, "expires_at": null, "assignments": [],
    })
}

fn acceptance(key: &str, invitation: &Value) -> Value {
    json!({"key":key,"secret":invitation["secret"]})
}

async fn fixture(config: &support::Configuration, admin: &mut PgConnection, issuer: &str) {
    let mut migration = PgConnection::connect_with(&database_options(&config.migration).unwrap())
        .await
        .unwrap();
    config.guard_connection(&mut migration).await;
    migration.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC;").await.unwrap();
    let owns_schema: bool = sqlx::query_scalar("SELECT nspowner=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user) FROM pg_catalog.pg_namespace WHERE nspname='public'")
        .fetch_one(&mut migration).await.unwrap();
    assert!(owns_schema, "fixture reset preserves migration ownership");
    migration.close().await.unwrap();
    config.guard_connection(admin).await;
    let runtime_role = database_options(&config.runtime)
        .unwrap()
        .get_username()
        .to_owned();
    migrate(&config.migration, &runtime_role).await.unwrap();
    let mut tx = admin.begin().await.unwrap();
    let tables = [
        "organisations",
        "clients",
        "engagements",
        "organisation_memberships",
        "engagement_assignments",
    ];
    for table in tables {
        tx.execute(format!("ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY").as_str())
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO public.identities(id,issuer,subject,display_name) VALUES('identity-admin',$1,'admin','Casey'),('identity-combined',$1,'combined','Alex'),('identity-auditor',$1,'auditor','Robin'),('identity-foreign',$1,'foreign','Foreign')")
        .bind(issuer).execute(&mut *tx).await.unwrap();
    tx.execute("INSERT INTO public.organisations(id,name) VALUES('org-a','Northstar'),('org-b','Private foreign organisation');
        INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-a','Alder'),('org-b','client-b','Private foreign client');
        INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-a','Audit A'),('org-b','client-b','engagement-b','Private foreign engagement');
        INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','identity-admin',ARRAY['admin']),('org-a','identity-combined',ARRAY['admin','auditor']),('org-a','identity-auditor',ARRAY['auditor']),('org-b','identity-foreign',ARRAY['admin']);
        INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','identity-admin'),('org-a','client-a','engagement-a','identity-combined'),('org-a','client-a','engagement-a','identity-auditor');")
        .await.unwrap();
    for table in tables {
        tx.execute(format!("ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY; ALTER TABLE public.{table} FORCE ROW LEVEL SECURITY").as_str()).await.unwrap();
    }
    tx.commit().await.unwrap();
}

async fn audiences(admin: &Browser, combined: &Browser, auditor: &Browser) {
    let page = document(admin.read(ORGANISATIONS).await, StatusCode::OK).await;
    assert_eq!(page["organisations"].as_array().unwrap().len(), 1);
    assert_eq!(page["organisations"][0]["organisation_id"], "org-a");
    assert!(page["next_cursor"].is_null());
    let snapshot = document(admin.read(ORGANISATION).await, StatusCode::OK).await;
    assert_eq!(snapshot["members"].as_array().unwrap().len(), 3);
    assert_eq!(snapshot["engagements"][0]["engagement_name"], "Audit A");
    assert_eq!(snapshot["version"], "0");
    assert!(!snapshot.to_string().contains("Private foreign"));
    assert_eq!(snapshot.as_object().unwrap().len(), 9);
    assert_eq!(
        document(auditor.read(ORGANISATIONS).await, StatusCode::OK).await,
        json!({"organisations":[],"next_cursor":null})
    );
    for (browser, path) in [
        (auditor, ORGANISATION),
        (admin, "/membership/organisations/org-b"),
        (admin, "/membership/organisations/org-missing"),
    ] {
        refused(
            browser.read(path).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    // Even an explicit assignment gives an Admin-only actor no audit authority.
    assert_eq!(
        document(admin.read("/engagements").await, StatusCode::OK).await["engagements"],
        json!([])
    );
    for path in [
        ENGAGEMENT,
        "/engagements/engagement-a/tasks?organisation_id=org-a&client_id=client-a",
        "/engagements/engagement-a/conversation?organisation_id=org-a&client_id=client-a",
        "/engagements/engagement-a/operations?organisation_id=org-a&client_id=client-a&task_id=guessed-task",
    ] {
        refused(
            admin.read(path).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    assert_eq!(
        document(combined.read(ENGAGEMENT).await, StatusCode::OK).await["engagement_id"],
        "engagement-a"
    );
    document(combined.read(ORGANISATION).await, StatusCode::OK).await;
}

async fn session_fences(admin: &Browser, auditor: &Browser) {
    let command = save(
        "fenced-save",
        json!("0"),
        "identity-auditor",
        &["auditor"],
        true,
    );
    refused(
        admin
            .client
            .get(format!("{}{ORGANISATIONS}", admin.address))
            .send()
            .await
            .unwrap(),
        StatusCode::UNAUTHORIZED,
        "authentication_required",
    )
    .await;
    for (name, value) in [
        ("X-Expected-Actor", "identity-auditor"),
        ("X-CSRF-Token", "obsolete"),
        ("Origin", "https://foreign.example"),
    ] {
        let response = admin
            .post(MEMBERS)
            .header(name, value)
            .body(command.to_string())
            .send()
            .await
            .unwrap();
        refused(response, StatusCode::FORBIDDEN, "access_denied").await;
    }
    for name in ["Origin", "X-CSRF-Token", "X-Expected-Actor"] {
        let mut request = admin
            .post(MEMBERS)
            .body(command.to_string())
            .build()
            .unwrap();
        request.headers_mut().remove(name);
        refused(
            admin.client.execute(request).await.unwrap(),
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    // Missing actor and body-supplied actor cannot choose the editor.
    let response = admin
        .request(Method::POST, MEMBERS)
        .header("Origin", &admin.origin)
        .header("X-CSRF-Token", &admin.csrf)
        .header("Content-Type", "application/json")
        .body(command.to_string())
        .send()
        .await
        .unwrap();
    refused(response, StatusCode::FORBIDDEN, "access_denied").await;
    for response in [
        admin
            .get(ORGANISATION)
            .header("X-Expected-Session", "obsolete")
            .send()
            .await
            .unwrap(),
        admin
            .post(MEMBERS)
            .header("X-Expected-Session", "obsolete")
            .body(command.to_string())
            .send()
            .await
            .unwrap(),
    ] {
        refused(response, StatusCode::PRECONDITION_FAILED, "session_changed").await;
    }
    let forged_editor = Browser {
        actor: admin.actor.clone(),
        ..auditor.clone()
    };
    refused(
        forged_editor.command(MEMBERS, &command).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        auditor.command(MEMBERS, &command).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    for route in [
        "/membership/organisations/org-b/members",
        "/membership/organisations/org-missing/members",
    ] {
        refused(
            admin.command(route, &command).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    let old_audience = Browser {
        csrf: admin.csrf.clone(),
        ..auditor.clone()
    };
    refused(
        old_audience.read(ORGANISATION).await,
        StatusCode::PRECONDITION_FAILED,
        "session_changed",
    )
    .await;
    assert_eq!(
        admin.version().await,
        "0",
        "all refused mutations are inert"
    );
}

async fn saves(admin: &Browser, combined: &Browser, auditor: &Browser) {
    let mut command = save(
        "save-auditor",
        admin.version().await,
        &auditor.actor,
        &["auditor", "audit_manager"],
        true,
    );
    command["assignments"] = json!([{"client_id":"client-a","engagement_id":"engagement-a"}]);
    lose_acknowledgement(admin, MEMBERS, &command).await;
    let receipt = document(admin.command(MEMBERS, &command).await, StatusCode::OK).await;
    assert_eq!(receipt["actor_id"], admin.actor);
    assert_eq!(receipt["subject_actor_id"], auditor.actor);
    assert_eq!(receipt["kind"], "save_member");
    assert_eq!(receipt["version"], "1");
    assert_eq!(
        document(admin.command(MEMBERS, &command).await, StatusCode::OK).await,
        receipt
    );
    let mut explicit_false = command.clone();
    explicit_false["assignments"][0]["renew"] = json!(false);
    assert_eq!(
        document(
            admin.command(MEMBERS, &explicit_false).await,
            StatusCode::OK
        )
        .await,
        receipt,
        "omitted renewal and explicit false have the same exact retry meaning"
    );
    let mut changed_renewal = explicit_false.clone();
    changed_renewal["assignments"][0]["renew"] = json!(true);
    refused(
        admin.command(MEMBERS, &changed_renewal).await,
        StatusCode::CONFLICT,
        "membership_conflict",
    )
    .await;
    changed_renewal["key"] = json!("invalid-remove-renewal");
    changed_renewal["expected_version"] = admin.version().await;
    changed_renewal["assignment_mode"] = json!("remove");
    refused(
        admin.command(MEMBERS, &changed_renewal).await,
        StatusCode::BAD_REQUEST,
        "invalid_membership",
    )
    .await;
    let mut invalid_renewal = explicit_false.clone();
    invalid_renewal["assignments"][0]["renew"] = json!("true");
    refused(
        admin.command(MEMBERS, &invalid_renewal).await,
        StatusCode::BAD_REQUEST,
        "invalid_membership",
    )
    .await;
    let mut changed = command.clone();
    changed["roles"] = json!(["auditor"]);
    refused(
        admin.command(MEMBERS, &changed).await,
        StatusCode::CONFLICT,
        "membership_conflict",
    )
    .await;
    let mut stale = command.clone();
    stale["key"] = json!("stale-version");
    refused(
        admin.command(MEMBERS, &stale).await,
        StatusCode::CONFLICT,
        "membership_conflict",
    )
    .await;
    let mut foreign = command.clone();
    foreign["key"] = json!("foreign-assignment");
    foreign["expected_version"] = admin.version().await;
    foreign["assignments"] = json!([{"client_id":"client-b","engagement_id":"engagement-b"}]);
    refused(
        admin.command(MEMBERS, &foreign).await,
        StatusCode::BAD_REQUEST,
        "invalid_membership",
    )
    .await;
    let mut forged = command.clone();
    forged["recipient_proof"] = json!({"email":"forged@example.com"});
    refused(
        admin.command(MEMBERS, &forged).await,
        StatusCode::BAD_REQUEST,
        "invalid_membership",
    )
    .await;
    assert_eq!(admin.version().await, "1");

    let mut expiry = command.clone();
    expiry["key"] = json!("expiry-boundary");
    expiry["expected_version"] = admin.version().await;
    expiry["expires_at"] = json!(253402300800_i64);
    refused(
        admin.command(MEMBERS, &expiry).await,
        StatusCode::BAD_REQUEST,
        "invalid_membership",
    )
    .await;
    assert_eq!(
        admin.version().await,
        "1",
        "invalid expiry cannot poison a later snapshot"
    );
    expiry["expires_at"] = json!(zobba_domain::membership::MAX_MEMBERSHIP_EXPIRY);
    document(admin.command(MEMBERS, &expiry).await, StatusCode::OK).await;
    let snapshot = document(admin.read(ORGANISATION).await, StatusCode::OK).await;
    let member = snapshot["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["actor_id"] == auditor.actor)
        .unwrap();
    assert_eq!(
        member["expires_at"],
        zobba_domain::membership::MAX_MEMBERSHIP_EXPIRY
    );

    let demote = save(
        "demote-combined",
        admin.version().await,
        &combined.actor,
        &["auditor"],
        true,
    );
    document(admin.command(MEMBERS, &demote).await, StatusCode::OK).await;
    refused(
        combined.read(ORGANISATION).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let last = save(
        "last-admin",
        admin.version().await,
        &admin.actor,
        &[],
        false,
    );
    refused(
        admin.command(MEMBERS, &last).await,
        StatusCode::CONFLICT,
        "last_admin",
    )
    .await;
    // Restore the second administrator so subsequent invitation revocation can
    // remove the original editor and prove retries use current authority.
    let restore = save(
        "restore-combined",
        admin.version().await,
        &combined.actor,
        &["admin", "auditor"],
        true,
    );
    document(admin.command(MEMBERS, &restore).await, StatusCode::OK).await;
}

async fn proof_refusals(
    admin: &Browser,
    identities: &IdentityRepository,
    issuer: &str,
    connection: &mut PgConnection,
) -> Browser {
    let (invitation, issued) = admin
        .issue("invite-recipient", "Named.Person@EXAMPLE.COM")
        .await;
    assert_eq!(issued["actor_id"], admin.actor);
    assert_eq!(issued["kind"], "invite");
    assert_eq!(
        document(
            admin.command(INVITATIONS, &invitation).await,
            StatusCode::OK
        )
        .await,
        issued
    );
    let page = document(admin.read(ORGANISATION).await, StatusCode::OK).await;
    let projected = &page["invitations"][0];
    assert_eq!(projected["recipient_email"], "Named.Person@example.com");
    assert_eq!(projected["inviter_actor_id"], admin.actor);
    assert_eq!(projected["status"], "pending");
    assert_eq!(projected.as_object().unwrap().len(), 7);
    for secret in [
        invitation["secret"].as_str().unwrap(),
        "secret_hash",
        "verified_email",
        "recipient_proof",
    ] {
        assert!(!page.to_string().contains(secret));
    }
    let accept = acceptance("accept-recipient", &invitation);
    let preview = json!({"secret":invitation["secret"]});
    let no_proof = admin
        .sign_in(identities, issuer, "recipient", None, None)
        .await;
    refused(
        no_proof.command(ACCEPT, &accept).await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;
    refused(
        no_proof.command(PREVIEW, &preview).await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;
    for (subject, signed_issuer, email) in [
        ("wrong-recipient", issuer, "Elsewhere@example.com"),
        ("wrong-local-case", issuer, "named.Person@example.com"),
        (
            "wrong-issuer",
            "https://wrong-issuer.example",
            "Named.Person@example.com",
        ),
    ] {
        let wrong = admin
            .sign_in(identities, signed_issuer, subject, Some(email), None)
            .await;
        refused(
            wrong.command(ACCEPT, &accept).await,
            StatusCode::FORBIDDEN,
            "invitation_refused",
        )
        .await;
        refused(
            wrong.command(PREVIEW, &preview).await,
            StatusCode::FORBIDDEN,
            "invitation_refused",
        )
        .await;
    }
    let recipient = admin
        .sign_in(
            identities,
            issuer,
            "recipient",
            Some("Named.Person@example.com"),
            Some(&no_proof.token),
        )
        .await;
    refused(
        no_proof.read("/auth/session").await,
        StatusCode::UNAUTHORIZED,
        "authentication_required",
    )
    .await;
    let wire = document(recipient.read("/auth/session").await, StatusCode::OK).await;
    assert_eq!(wire.as_object().unwrap().len(), 2);
    assert!(!wire.to_string().contains("Named.Person"));
    for offset in [-301_i64, 60] {
        sqlx::query("UPDATE public.sessions SET verified_at=extract(epoch FROM clock_timestamp())::bigint+$1 WHERE token_hash=$2")
            .bind(offset).bind(secret_hash(&recipient.token)).execute(&mut *connection).await.unwrap();
        refused(
            recipient.command(ACCEPT, &accept).await,
            StatusCode::FORBIDDEN,
            "invitation_refused",
        )
        .await;
        refused(
            recipient.command(PREVIEW, &preview).await,
            StatusCode::FORBIDDEN,
            "invitation_refused",
        )
        .await;
    }
    let recipient = admin
        .sign_in(
            identities,
            issuer,
            "recipient",
            Some("Named.Person@EXAMPLE.COM"),
            Some(&recipient.token),
        )
        .await;
    assert_eq!(
        document(recipient.command(PREVIEW, &preview).await, StatusCode::OK).await,
        json!({
            "organisation_id":"org-a", "organisation_name":"Northstar",
            "recipient_email":"Named.Person@example.com", "roles":["auditor"],
            "assignments":[{
                "client_id":"client-a", "client_name":"Alder",
                "engagement_id":"engagement-a", "engagement_name":"Audit A",
            }],
            "expires_at":projected["expires_at"],
        })
    );
    assert_eq!(
        document(recipient.read("/engagements").await, StatusCode::OK).await["engagements"],
        json!([]),
        "preview discloses fixed terms but grants no audit authority"
    );
    let mut forged = accept.clone();
    forged["verified_email"] = json!("Named.Person@example.com");
    refused(
        recipient.command(ACCEPT, &forged).await,
        StatusCode::BAD_REQUEST,
        "invalid_membership",
    )
    .await;
    lose_acknowledgement(&recipient, ACCEPT, &accept).await;
    let receipt = document(recipient.command(ACCEPT, &accept).await, StatusCode::OK).await;
    assert_eq!(receipt["actor_id"], recipient.actor);
    assert_eq!(receipt["subject_actor_id"], recipient.actor);
    assert_eq!(receipt["invitation_id"], issued["invitation_id"]);
    assert_eq!(receipt["kind"], "accept");
    assert_eq!(
        document(recipient.command(ACCEPT, &accept).await, StatusCode::OK).await,
        receipt
    );
    let mut second_key = accept.clone();
    second_key["key"] = json!("reuse-invitation");
    refused(
        recipient.command(ACCEPT, &second_key).await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;
    document(recipient.read(ENGAGEMENT).await, StatusCode::OK).await;

    let revoke = save(
        "remove-recipient",
        admin.version().await,
        &recipient.actor,
        &[],
        false,
    );
    document(admin.command(MEMBERS, &revoke).await, StatusCode::OK).await;
    refused(
        recipient.read(ENGAGEMENT).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    assert_eq!(
        document(recipient.command(ACCEPT, &accept).await, StatusCode::OK).await,
        receipt
    );
    refused(
        recipient.read(ENGAGEMENT).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let snapshot = document(admin.read(ORGANISATION).await, StatusCode::OK).await;
    let member = snapshot["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|member| member["actor_id"] == recipient.actor)
        .unwrap();
    assert_eq!(
        member["active"], false,
        "exact retry recovers history without regrant"
    );
    assert_eq!(member["roles"], json!([]));
    assert_eq!(member["assignments"], json!([]));
    sqlx::query("UPDATE public.sessions SET verified_at=extract(epoch FROM clock_timestamp())::bigint-301 WHERE token_hash=$1")
        .bind(secret_hash(&recipient.token)).execute(&mut *connection).await.unwrap();
    refused(
        recipient.command(ACCEPT, &accept).await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;
    admin
        .sign_in(
            identities,
            issuer,
            "recipient",
            Some("Named.Person@example.com"),
            Some(&recipient.token),
        )
        .await
}

async fn invitation_lifecycle(
    admin: &Browser,
    combined: &Browser,
    recipient: &Browser,
    identities: &IdentityRepository,
    issuer: &str,
    connection: &mut PgConnection,
) {
    // An existing membership, even inactive, must never be overwritten by an
    // invitation. The original accepted receipt is also bound to its secret.
    let (existing, _) = admin
        .issue("invite-existing", "Named.Person@example.com")
        .await;
    refused(
        recipient
            .command(ACCEPT, &acceptance("existing-recipient", &existing))
            .await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;
    refused(
        recipient
            .command(ACCEPT, &acceptance("accept-recipient", &existing))
            .await,
        StatusCode::CONFLICT,
        "membership_conflict",
    )
    .await;

    let candidate = admin
        .sign_in(
            identities,
            issuer,
            "candidate",
            Some("Candidate@example.com"),
            None,
        )
        .await;
    let (revoked, issued) = admin.issue("invite-revoked", "Candidate@example.com").await;
    let preview = json!({"secret":revoked["secret"]});
    document(candidate.command(PREVIEW, &preview).await, StatusCode::OK).await;
    let revoke = json!({"key":"revoke-invitation","expected_version":admin.version().await,"invitation_id":issued["invitation_id"]});
    let route = format!("{INVITATIONS}/revoke");
    let revoked_receipt = document(admin.command(&route, &revoke).await, StatusCode::OK).await;
    assert_eq!(
        document(admin.command(&route, &revoke).await, StatusCode::OK).await,
        revoked_receipt
    );
    refused(
        candidate.command(PREVIEW, &preview).await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;
    // A successful preview cannot authorize acceptance after the Admin revokes.
    refused(
        candidate
            .command(ACCEPT, &acceptance("accept-revoked", &revoked))
            .await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;
    let (expired, issued) = admin.issue("invite-expired", "Candidate@example.com").await;
    sqlx::query("UPDATE public.membership_invitations SET expires_at=extract(epoch FROM clock_timestamp())::bigint-1 WHERE id=$1")
        .bind(issued["invitation_id"].as_str().unwrap()).execute(&mut *connection).await.unwrap();
    refused(
        candidate
            .command(ACCEPT, &acceptance("accept-expired", &expired))
            .await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;
    let snapshot = document(admin.read(ORGANISATION).await, StatusCode::OK).await;
    let expired_view = snapshot["invitations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["id"] == issued["invitation_id"])
        .unwrap();
    assert_eq!(expired_view["status"], "expired");
    refused(
        candidate
            .command(
                ACCEPT,
                &json!({"key":"unknown-invitation","secret":random_secret().unwrap()}),
            )
            .await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;

    let (departed, _) = admin
        .issue("invite-departed", "Candidate@example.com")
        .await;
    let remove = save(
        "remove-inviter",
        combined.version().await,
        &admin.actor,
        &[],
        false,
    );
    document(combined.command(MEMBERS, &remove).await, StatusCode::OK).await;
    refused(
        candidate
            .command(ACCEPT, &acceptance("accept-departed", &departed))
            .await,
        StatusCode::FORBIDDEN,
        "invitation_refused",
    )
    .await;
    refused(
        admin.command(INVITATIONS, &departed).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    let mut previous_save = save(
        "save-auditor",
        json!("0"),
        "identity-auditor",
        &["auditor", "audit_manager"],
        true,
    );
    previous_save["assignments"] = json!([{"client_id":"client-a","engagement_id":"engagement-a"}]);
    refused(
        admin.command(MEMBERS, &previous_save).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        admin.command(&route, &revoke).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    refused(
        admin.read(ORGANISATION).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    assert_eq!(
        document(admin.read(ORGANISATIONS).await, StatusCode::OK).await["organisations"],
        json!([])
    );
    assert_eq!(
        document(candidate.read("/engagements").await, StatusCode::OK).await["engagements"],
        json!([])
    );
}

async fn legacy_assignment_pages(
    editor: &Browser,
    auditor: &Browser,
    connection: &mut PgConnection,
) {
    // The connection was guarded before fixture mutation. This synthetic legacy
    // member has a schema-4-valid assignment set larger than a replacement Save.
    for index in 0..100 {
        let id = format!("legacy-{index:03}");
        sqlx::query("INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a',$1,$2)")
            .bind(&id).bind(format!("Legacy engagement {index}")).execute(&mut *connection).await.unwrap();
        sqlx::query("INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id,expires_at) VALUES('org-a','client-a',$1,'identity-auditor',$2)")
            .bind(&id).bind(zobba_domain::membership::MAX_MEMBERSHIP_EXPIRY).execute(&mut *connection).await.unwrap();
    }
    let snapshot = document(editor.read(ORGANISATION).await, StatusCode::OK).await;
    let member = snapshot["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["actor_id"] == auditor.actor)
        .unwrap();
    assert_eq!(member["assignments_count"], 101);
    assert_eq!(member["assignments_complete"], false);
    assert_eq!(member["assignments"].as_array().unwrap().len(), 100);
    let route = format!("{MEMBERS}/{}/assignments", auditor.actor);
    refused(
        auditor.read(&route).await,
        StatusCode::FORBIDDEN,
        "access_denied",
    )
    .await;
    for route in [
        "/membership/organisations/org-b/members/identity-foreign/assignments",
        "/membership/organisations/org-missing/members/identity-foreign/assignments",
    ] {
        refused(
            editor.read(route).await,
            StatusCode::FORBIDDEN,
            "access_denied",
        )
        .await;
    }
    let mut assignments = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let page_route = cursor
            .as_ref()
            .map_or_else(|| route.clone(), |cursor| format!("{route}?after={cursor}"));
        let page = document(editor.read(&page_route).await, StatusCode::OK).await;
        assert_eq!(page["organisation_id"], "org-a");
        assert_eq!(page["actor_id"], auditor.actor);
        assert_eq!(page["version"], snapshot["version"]);
        assert_eq!(page["total"], 101);
        assert!(page["assignments"].as_array().unwrap().len() <= 50);
        assignments.extend(page["assignments"].as_array().unwrap().iter().cloned());
        cursor = page["next_cursor"].as_str().map(str::to_owned);
        if cursor.is_none() {
            break;
        }
        assert!(assignments.len() <= 100, "bounded cursor must advance");
    }
    assert_eq!(assignments.len(), 101);
    let ids: std::collections::BTreeSet<_> = assignments
        .iter()
        .map(|value| value["engagement_id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 101);
    assert_eq!(assignments.last().unwrap()["engagement_id"], "legacy-099");
    assert_eq!(
        assignments.last().unwrap()["expires_at"],
        zobba_domain::membership::MAX_MEMBERSHIP_EXPIRY
    );

    let mut command = save(
        "preserve-legacy-assignments",
        editor.version().await,
        &auditor.actor,
        &["auditor"],
        true,
    );
    command["assignment_mode"] = json!("preserve");
    command["expires_at"] = json!(zobba_domain::membership::MAX_MEMBERSHIP_EXPIRY);
    document(editor.command(MEMBERS, &command).await, StatusCode::OK).await;
    let page = document(
        editor
            .read(&format!("{route}?after=client-a.legacy-098"))
            .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(page["total"], 101);
    assert_eq!(
        page["assignments"][0]["expires_at"],
        zobba_domain::membership::MAX_MEMBERSHIP_EXPIRY
    );

    command["key"] = json!("remove-offpage-assignment");
    command["expected_version"] = editor.version().await;
    command["assignment_mode"] = json!("remove");
    command["assignments"] = json!([{"client_id":"client-a","engagement_id":"legacy-099"}]);
    document(editor.command(MEMBERS, &command).await, StatusCode::OK).await;
    let page = document(editor.read(&route).await, StatusCode::OK).await;
    assert_eq!(page["total"], 100);
    let snapshot = document(editor.read(ORGANISATION).await, StatusCode::OK).await;
    let member = snapshot["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["actor_id"] == auditor.actor)
        .unwrap();
    assert_eq!(member["assignments_complete"], true);
    assert_eq!(member["assignments_count"], 100);
}

#[tokio::test]
async fn membership_http_current_authority_exact_retries_and_verified_recipient() {
    let config = support::Configuration::from_environment();
    let issuer =
        std::env::var("ZOBBA_OIDC_ISSUER").expect("load the local fixture OIDC configuration");
    let origin =
        std::env::var("ZOBBA_PUBLIC_ORIGIN").expect("load the local fixture public origin");
    let mut connection = PgConnection::connect_with(&database_options(&config.admin).unwrap())
        .await
        .unwrap();
    fixture(&config, &mut connection, &issuer).await;
    let database = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    let identities = IdentityRepository::new(database.pool().clone());
    let auth = zobba_api::auth::AuthState::from_environment(&database).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!("http://{}", listener.local_addr().unwrap());
    let app = zobba_api::authenticated_router(database.clone(), auth);
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = stopped.await;
            })
            .await
            .unwrap();
    });
    let browser = Browser {
        client: Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap(),
        address,
        origin,
        token: String::new(),
        csrf: String::new(),
        actor: String::new(),
    };
    let admin = browser
        .sign_in(&identities, &issuer, "admin", None, None)
        .await;
    let combined = browser
        .sign_in(&identities, &issuer, "combined", None, None)
        .await;
    let auditor = browser
        .sign_in(&identities, &issuer, "auditor", None, None)
        .await;
    audiences(&admin, &combined, &auditor).await;
    session_fences(&admin, &auditor).await;
    saves(&admin, &combined, &auditor).await;
    let recipient = proof_refusals(&admin, &identities, &issuer, &mut connection).await;
    invitation_lifecycle(
        &admin,
        &combined,
        &recipient,
        &identities,
        &issuer,
        &mut connection,
    )
    .await;
    legacy_assignment_pages(&combined, &auditor, &mut connection).await;
    stop.send(()).unwrap();
    server.await.unwrap();
    database.pool().close().await;
    connection.close().await.unwrap();
}
