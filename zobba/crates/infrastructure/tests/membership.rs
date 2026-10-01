//! Real, disposable PostgreSQL membership authority and revocation contracts.
use sqlx::{Connection, Executor, PgConnection, postgres::PgPoolOptions};
use zobba_application::{SchemaHealth, identity::CurrentAuthority, membership::*};
use zobba_domain::{SCHEMA_VERSION, identity::Scope};
use zobba_infrastructure::{
    RuntimeDatabase, database_options,
    identity::{IdentityRepository, secret_hash},
    membership::MembershipRepository,
    migrate, scope,
};
#[path = "membership/acceptance_wait.rs"]
mod acceptance_wait;
#[path = "membership/legacy_upgrade.rs"]
mod legacy_upgrade;
#[path = "membership/revocation.rs"]
mod revocation;
mod support;
use support::Configuration;
const ISSUER: &str = "https://membership.fixture.invalid";
fn assignments() -> Vec<Assignment> {
    vec![Assignment {
        client_id: "client".into(),
        engagement_id: "engagement".into(),
    }]
}
fn save(key: &str, version: &str, target: &str, roles: &[&str], active: bool) -> SaveMember {
    SaveMember {
        assignment_mode: zobba_application::membership::AssignmentMode::Replace,
        key: key.into(),
        expected_version: version.into(),
        actor_id: target.into(),
        roles: roles.iter().map(|r| r.to_string()).collect(),
        active,
        expires_at: None,
        assignments: assignments()
            .into_iter()
            .map(|a| AssignmentChange {
                client_id: a.client_id,
                engagement_id: a.engagement_id,
                renew: false,
            })
            .collect(),
    }
}
fn invite(key: &str, version: &str, email: &str, secret: &str) -> InviteCommand {
    InviteCommand {
        key: key.into(),
        expected_version: version.into(),
        recipient_email: email.into(),
        roles: vec!["auditor".into()],
        assignments: assignments(),
        expires_in_seconds: 3600,
        secret: secret.into(),
    }
}
#[tokio::test]
async fn postgres_membership_contract() {
    let config = Configuration::from_environment();
    legacy_upgrade::verify(&config).await;
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    let options = database_options(&config.runtime).unwrap();
    migrate(&config.migration, options.get_username())
        .await
        .unwrap();
    let runtime = RuntimeDatabase::connect(&config.runtime).await.unwrap();
    assert_eq!(runtime.check().await.unwrap(), SCHEMA_VERSION);
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    admin.execute(r#"
 INSERT INTO identities(id,issuer,subject,display_name) VALUES('admin','https://membership.fixture.invalid','admin','Admin'),('second','https://membership.fixture.invalid','second','Second'),('member','https://membership.fixture.invalid','member','Member'),('other','https://membership.fixture.invalid','other','Other');
 INSERT INTO organisations VALUES('org','Organisation'),('foreign','Foreign');
 INSERT INTO clients VALUES('org','client','Client'),('foreign','client','Foreign Client');
 INSERT INTO engagements VALUES('org','client','engagement','Engagement'),('foreign','client','engagement','Foreign Engagement');
 INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('org','admin',ARRAY['admin']),('org','second',ARRAY['admin']),('org','member',ARRAY['auditor']),('org','other',ARRAY['auditor']),('foreign','member',ARRAY['auditor']);
 INSERT INTO engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org','client','engagement','member'),('org','client','engagement','other'),('foreign','client','engagement','member');
 "#).await.unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .unwrap();
    let identities = IdentityRepository::new(pool.clone());
    let admin_token = identities
        .establish_verified_session(ISSUER, "admin", "Admin", Some("Admin@example.com"), None)
        .await
        .unwrap();
    let second_token = identities
        .establish_verified_session(ISSUER, "second", "Second", Some("Second@example.com"), None)
        .await
        .unwrap();
    let repo = MembershipRepository::new(pool.clone(), ISSUER.into())
        .with_session_hash(secret_hash(&admin_token));
    let second = MembershipRepository::new(pool.clone(), ISSUER.into())
        .with_session_hash(secret_hash(&second_token));
    let snap = repo
        .snapshot("admin", "org", None, None, None)
        .await
        .unwrap();
    assert_eq!(snap.members.len(), 4);
    assert_eq!(snap.engagements.len(), 1);
    assert_eq!(snap.version, "0");
    assert_eq!(
        repo.organisations("admin", None)
            .await
            .unwrap()
            .organisations
            .len(),
        1
    );
    assert_eq!(
        repo.snapshot("admin", "foreign", None, None, None).await,
        Err(MembershipError::Denied)
    );
    assert_eq!(
        repo.snapshot("member", "org", None, None, None).await,
        Err(MembershipError::Denied)
    );
    let s = Scope {
        organisation_id: "org".into(),
        client_id: "client".into(),
        engagement_id: "engagement".into(),
    };
    assert!(
        scope::begin(&pool, "admin", &s).await.is_err(),
        "Admin has no audit authority"
    );
    assert!(
        sqlx::query("UPDATE organisation_memberships SET active=false")
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("SELECT secret_hash FROM membership_invitations")
            .execute(&pool)
            .await
            .is_err()
    );
    revocation::verify(&pool, &mut admin, &repo, ISSUER).await;
    acceptance_wait::verify(&pool, &mut admin, &repo, ISSUER, &config.admin).await;
    // Exact retry and stale/changed meaning are separate from a new grant.
    let command = save(
        "save-member",
        "0",
        "member",
        &["auditor", "audit_manager"],
        true,
    );
    let receipt = repo.save_member("admin", "org", &command).await.unwrap();
    assert_eq!(
        repo.save_member("admin", "org", &command).await.unwrap(),
        receipt
    );
    // The newly explicit default does not strand exact receipts produced by
    // the same replacement command before assignment modes were introduced.
    admin.execute("UPDATE membership_events SET meaning=jsonb_set(meaning,'{command}',(meaning->'command')-'assignment_mode') WHERE organisation_id='org' AND actor_id='admin' AND command_key='save-member'").await.unwrap();
    assert_eq!(
        repo.save_member("admin", "org", &command).await.unwrap(),
        receipt
    );
    let mut changed = command.clone();
    changed.active = false;
    assert_eq!(
        repo.save_member("admin", "org", &changed).await,
        Err(MembershipError::Conflict)
    );
    let mut stale = command.clone();
    stale.key = "stale".into();
    assert_eq!(
        repo.save_member("admin", "org", &stale).await,
        Err(MembershipError::Conflict)
    );
    // Fresh OIDC recipient proof, issuer/email matching, explicit acceptance, replay.
    let secret = "a".repeat(43);
    let issued = repo
        .invite(
            "admin",
            "org",
            &invite("invite", "1", "Named@EXAMPLE.COM", &secret),
        )
        .await
        .unwrap();
    let token = identities
        .establish_verified_session(
            ISSUER,
            "recipient",
            "Recipient",
            Some("Named@example.com"),
            None,
        )
        .await
        .unwrap();
    let hash = secret_hash(&token);
    let actor = identities.session(&token).await.unwrap().identity.id;
    let wrong = identities
        .establish_verified_session(ISSUER, "wrong", "Wrong", Some("named@example.com"), None)
        .await
        .unwrap();
    let wrong_actor = identities.session(&wrong).await.unwrap().identity.id;
    assert_eq!(
        repo.accept(&wrong_actor, &secret_hash(&wrong), &secret, "accept")
            .await,
        Err(MembershipError::InvitationRefused)
    );
    let unverified = identities
        .establish_session(ISSUER, "unverified", "Unverified", None)
        .await
        .unwrap();
    let unverified_actor = identities.session(&unverified).await.unwrap().identity.id;
    assert_eq!(
        repo.accept(
            &unverified_actor,
            &secret_hash(&unverified),
            &secret,
            "accept"
        )
        .await,
        Err(MembershipError::InvitationRefused)
    );
    admin.execute("UPDATE sessions SET verified_at=extract(epoch FROM clock_timestamp())::bigint-301 WHERE verified_at IS NOT NULL AND actor_id NOT IN ('admin','second','member','other')").await.unwrap();
    assert_eq!(
        repo.accept(&actor, &hash, &secret, "accept").await,
        Err(MembershipError::InvitationRefused)
    );
    admin.execute("UPDATE sessions SET verified_at=extract(epoch FROM clock_timestamp())::bigint WHERE verified_at IS NOT NULL").await.unwrap();
    let wrong_configuration =
        MembershipRepository::new(pool.clone(), "https://changed.fixture.invalid".into());
    assert_eq!(
        wrong_configuration
            .accept(&actor, &hash, &secret, "accept")
            .await,
        Err(MembershipError::InvitationRefused)
    );
    let preview = repo.preview(&actor, &hash, &secret).await.unwrap();
    assert_eq!(preview.organisation_id, "org");
    assert_eq!(preview.assignments.len(), 1);
    assert_eq!(
        repo.preview(&wrong_actor, &secret_hash(&wrong), &secret)
            .await,
        Err(MembershipError::InvitationRefused)
    );
    let accepted = repo.accept(&actor, &hash, &secret, "accept").await.unwrap();
    assert_eq!(accepted.invitation_id, issued.invitation_id);
    assert_eq!(
        repo.accept(&actor, &hash, &secret, "accept").await.unwrap(),
        accepted
    );
    assert_eq!(
        repo.accept(&actor, &hash, &secret, "another-key").await,
        Err(MembershipError::InvitationRefused)
    );
    let removed = repo
        .save_member(
            "admin",
            "org",
            &save("remove-recipient", &accepted.version, &actor, &[], false),
        )
        .await
        .unwrap();
    assert_eq!(
        repo.accept(&actor, &hash, &secret, "accept").await.unwrap(),
        accepted
    );
    let active: bool = sqlx::query_scalar(
        "SELECT active FROM organisation_memberships WHERE organisation_id='org' AND actor_id=$1",
    )
    .bind(&actor)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert!(!active, "acceptance retry must not regrant");
    // Concurrent demotions serialize. A stale competing version conflicts, then
    // the remaining current Admin cannot remove the last eligible Admin.
    let a = save(
        "demote-first",
        &removed.version,
        "admin",
        &["auditor"],
        true,
    );
    let b = save(
        "demote-second",
        &removed.version,
        "second",
        &["auditor"],
        true,
    );
    let (ra, rb) = tokio::join!(
        repo.save_member("admin", "org", &a),
        second.save_member("second", "org", &b)
    );
    assert_ne!(ra.is_ok(), rb.is_ok());
    let (remaining, remaining_repo, version) = if let Ok(r) = ra {
        ("second", &second, r.version)
    } else {
        ("admin", &repo, rb.unwrap().version)
    };
    assert_eq!(
        remaining_repo
            .save_member(
                remaining,
                "org",
                &save("last-admin", &version, remaining, &[], false)
            )
            .await,
        Err(MembershipError::LastAdmin)
    );
    // Session replacement invalidates an already-created repository audience.
    let old = remaining_repo.clone();
    let oldtoken = if remaining == "admin" {
        &admin_token
    } else {
        &second_token
    };
    identities
        .establish_verified_session(
            ISSUER,
            remaining,
            "Replacement",
            Some("Admin@example.com"),
            Some(oldtoken),
        )
        .await
        .unwrap();
    assert_eq!(
        old.snapshot(remaining, "org", None, None, None).await,
        Err(MembershipError::Denied)
    );

    // A verified session replaced while this repository waits for the organisation
    // fence must not disclose a snapshot after the lock eventually becomes free.
    let waiting_token = identities
        .establish_verified_session(
            ISSUER,
            remaining,
            "Waiting reader",
            Some("Admin@example.com"),
            None,
        )
        .await
        .unwrap();
    let waiting_repo = MembershipRepository::new(pool.clone(), ISSUER.into())
        .with_session_hash(secret_hash(&waiting_token));
    let mut barrier = PgConnection::connect(&config.admin).await.unwrap();
    barrier
        .execute("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('org',205))")
        .await
        .unwrap();
    let pending = tokio::spawn(async move {
        waiting_repo
            .snapshot(remaining, "org", None, None, None)
            .await
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND query LIKE '%membership_read%')").fetch_one(&mut admin).await.unwrap();
        if blocked {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "snapshot never waited at the organisation fence"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    identities.logout(&waiting_token).await.unwrap();
    barrier.execute("COMMIT").await.unwrap();
    assert_eq!(pending.await.unwrap(), Err(MembershipError::Denied));
    // Independently bounded lists preserve every page, including Admin-only orgs.
    let page_token = identities
        .establish_verified_session(
            ISSUER,
            remaining,
            "Paged reader",
            Some("Admin@example.com"),
            None,
        )
        .await
        .unwrap();
    let paged = MembershipRepository::new(pool.clone(), ISSUER.into())
        .with_session_hash(secret_hash(&page_token));
    admin.execute("INSERT INTO identities(id,issuer,subject,display_name) SELECT 'page-'||lpad(g::text,3,'0'),'https://membership.fixture.invalid','page-'||g,'Paged member' FROM generate_series(1,60) g; INSERT INTO organisation_memberships(organisation_id,actor_id,roles) SELECT 'org','page-'||lpad(g::text,3,'0'),ARRAY['auditor'] FROM generate_series(1,60) g; INSERT INTO engagements SELECT 'org','client','page-'||lpad(g::text,3,'0'),'Paged engagement' FROM generate_series(1,60) g; INSERT INTO membership_invitations(id,organisation_id,recipient_issuer,recipient_email,secret_hash,roles,assignments,inviter_actor_id,expires_at,status) SELECT 'page-'||lpad(g::text,3,'0'),'org','https://membership.fixture.invalid','paged@example.com',encode(sha256(convert_to('page-'||g,'UTF8')),'hex'),ARRAY['auditor'],'[]'::jsonb,'admin',extract(epoch FROM clock_timestamp())::bigint+3600,'pending' FROM generate_series(1,60) g; INSERT INTO organisations SELECT 'page-'||lpad(g::text,3,'0'),'Paged organisation' FROM generate_series(1,60) g").await.unwrap();
    sqlx::query("INSERT INTO organisation_memberships(organisation_id,actor_id,roles) SELECT 'page-'||lpad(g::text,3,'0'),$1,ARRAY['admin'] FROM generate_series(1,60) g").bind(remaining).execute(&mut admin).await.unwrap();
    let first = paged
        .snapshot(remaining, "org", None, None, None)
        .await
        .unwrap();
    assert_eq!(first.members.len(), 50);
    assert_eq!(first.invitations.len(), 50);
    assert_eq!(first.engagements.len(), 50);
    let second_page = paged
        .snapshot(
            remaining,
            "org",
            first.members_next_cursor.as_deref(),
            first.invitations_next_cursor.as_deref(),
            first.engagements_next_cursor.as_deref(),
        )
        .await
        .unwrap();
    assert_eq!(first.members.len() + second_page.members.len(), 65);
    assert_eq!(first.invitations.len() + second_page.invitations.len(), 61);
    // Original engagement plus the retained VG4 scope and 60 page fixtures.
    assert_eq!(first.engagements.len() + second_page.engagements.len(), 62);
    assert!(
        second_page.members_next_cursor.is_none()
            && second_page.invitations_next_cursor.is_none()
            && second_page.engagements_next_cursor.is_none()
    );
    let organisations = paged.organisations(remaining, None).await.unwrap();
    assert_eq!(organisations.organisations.len(), 50);
    let rest = paged
        .organisations(remaining, organisations.next_cursor.as_deref())
        .await
        .unwrap();
    assert_eq!(rest.organisations.len(), 11);
    assert!(rest.next_cursor.is_none());
    pool.close().await;
}
