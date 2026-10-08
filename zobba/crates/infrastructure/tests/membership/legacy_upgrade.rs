//! A valid populated schema 4 remains administrable after upgrading to the current schema.
use super::{ISSUER, support::Configuration};
use serde_json::{Value, json};
use sqlx::{Connection, Executor, PgConnection, postgres::PgPoolOptions};
use zobba_application::{BootstrapError, identity::CurrentAuthority, membership::*};
use zobba_domain::membership::MAX_MEMBERSHIP_EXPIRY;
use zobba_infrastructure::{
    database_options,
    identity::{IdentityRepository, secret_hash},
    membership::MembershipRepository,
    migrate, scope,
};

fn command(
    key: &str,
    version: &str,
    assignments: Vec<Assignment>,
    mode: AssignmentMode,
) -> SaveMember {
    SaveMember {
        key: key.into(),
        expected_version: version.into(),
        actor_id: "zz-legacy".into(),
        roles: vec!["auditor".into(), "audit_manager".into()],
        active: true,
        expires_at: None,
        assignments: assignments
            .into_iter()
            .map(|a| AssignmentChange {
                client_id: a.client_id,
                engagement_id: a.engagement_id,
                renew: false,
            })
            .collect(),
        assignment_mode: mode,
    }
}
fn plan_has_index(value: &Value, index: &str) -> bool {
    match value {
        Value::Object(map) => {
            map.get("Index Name").is_some_and(|name| name == index)
                || map.values().any(|value| plan_has_index(value, index))
        }
        Value::Array(items) => items.iter().any(|value| plan_has_index(value, index)),
        _ => false,
    }
}

pub async fn verify(config: &Configuration) {
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE TABLE public._sqlx_migrations(version bigint PRIMARY KEY,description text NOT NULL,installed_on timestamptz NOT NULL DEFAULT now(),success boolean NOT NULL,checksum bytea NOT NULL,execution_time bigint NOT NULL)").await.unwrap();
    let migrations = sqlx::migrate!("../../migrations");
    for migration in migrations.iter().take(4) {
        owner.execute(migration.sql.as_ref()).await.unwrap();
        sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES($1,$2,true,$3,0)").bind(migration.version).bind(migration.description.as_ref()).bind(migration.checksum.as_ref()).execute(&mut owner).await.unwrap();
    }
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    admin.execute(r#"
      INSERT INTO identities(id,issuer,subject,display_name) VALUES('a-000','https://membership.fixture.invalid','legacy-admin','Legacy Admin'),('zz-legacy','https://membership.fixture.invalid','legacy-member','Legacy Member'),('foreign-admin','https://membership.fixture.invalid','foreign-admin','Foreign Admin');
      INSERT INTO identities(id,issuer,subject,display_name) SELECT 'a-'||lpad(g::text,3,'0'),'https://membership.fixture.invalid','legacy-'||g,'Listed member' FROM generate_series(1,49) g;
      INSERT INTO organisations VALUES('legacy-org','Legacy Organisation');
      INSERT INTO clients VALUES('legacy-org','client','Legacy Client');
      INSERT INTO engagements SELECT 'legacy-org','client','e'||lpad(g::text,3,'0'),'Engagement '||g FROM generate_series(1,101) g;
      INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('legacy-org','a-000',ARRAY['admin']),('legacy-org','zz-legacy',ARRAY['auditor']);
      INSERT INTO organisation_memberships(organisation_id,actor_id,roles) SELECT 'legacy-org','a-'||lpad(g::text,3,'0'),ARRAY['auditor'] FROM generate_series(1,49) g;
      INSERT INTO engagement_assignments(organisation_id,client_id,engagement_id,actor_id,expires_at) SELECT 'legacy-org','client','e'||lpad(g::text,3,'0'),'zz-legacy',CASE WHEN g=1 THEN extract(epoch FROM clock_timestamp())::bigint+86400 END FROM generate_series(1,101) g;
    "#).await.unwrap();
    let version: i64 = sqlx::query_scalar("SELECT schema_version FROM zobba_bootstrap")
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(version, 4);
    let before_expiry:i64=sqlx::query_scalar("SELECT expires_at FROM engagement_assignments WHERE organisation_id='legacy-org' AND actor_id='zz-legacy' AND engagement_id='e001'").fetch_one(&mut admin).await.unwrap();
    let options = database_options(&config.runtime).unwrap();
    // Previously valid bigint values must refuse the whole v4->v5 upgrade
    // with one allowlisted actionable code, preserving both data and schema.
    for (table, scope_predicate, original) in [
        (
            "organisation_memberships",
            "organisation_id='legacy-org' AND actor_id='zz-legacy'",
            None,
        ),
        (
            "engagement_assignments",
            "organisation_id='legacy-org' AND actor_id='zz-legacy' AND engagement_id='e001'",
            Some(before_expiry),
        ),
    ] {
        for invalid in [-1, MAX_MEMBERSHIP_EXPIRY + 1] {
            sqlx::query(&format!(
                "UPDATE public.{table} SET expires_at=$1 WHERE {scope_predicate}"
            ))
            .bind(invalid)
            .execute(&mut admin)
            .await
            .unwrap();
            let before: Value = sqlx::query_scalar(&format!(
                "SELECT to_jsonb(t) FROM public.{table} t WHERE {scope_predicate}"
            ))
            .fetch_one(&mut admin)
            .await
            .unwrap();
            assert_eq!(
                migrate(&config.migration, options.get_username()).await,
                Err(BootstrapError::MembershipExpiryOutOfRange)
            );
            let after: Value = sqlx::query_scalar(&format!(
                "SELECT to_jsonb(t) FROM public.{table} t WHERE {scope_predicate}"
            ))
            .fetch_one(&mut admin)
            .await
            .unwrap();
            assert_eq!(before, after, "refused upgrade modified legacy expiry");
            let signatures: Vec<String> =
                sqlx::query_scalar(include_str!("../../src/catalog-signature.sql"))
                    .fetch_all(&mut admin)
                    .await
                    .unwrap();
            assert!(
                signatures
                    .iter()
                    .map(String::as_str)
                    .eq(include_str!("../../src/schema-v4.catalog").lines()),
                "refused upgrade changed the schema4 catalog"
            );
            let retained:(i64,i64)=sqlx::query_as("SELECT schema_version,(SELECT count(*) FROM _sqlx_migrations) FROM zobba_bootstrap").fetch_one(&mut admin).await.unwrap();
            assert_eq!(retained, (4, 4));
        }
        sqlx::query(&format!(
            "UPDATE public.{table} SET expires_at=$1 WHERE {scope_predicate}"
        ))
        .bind(original)
        .execute(&mut admin)
        .await
        .unwrap();
    }
    migrate(&config.migration, options.get_username())
        .await
        .unwrap();
    let current: (i64, i64) = sqlx::query_as("SELECT schema_version,(SELECT count(*) FROM public._sqlx_migrations) FROM public.zobba_bootstrap")
        .fetch_one(&mut admin).await.unwrap();
    assert_eq!(
        current,
        (
            i64::from(zobba_domain::SCHEMA_VERSION.0),
            i64::from(zobba_domain::SCHEMA_VERSION.0),
        ),
        "legacy authority must reach the complete schema and ledger"
    );
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .unwrap();
    let identity = IdentityRepository::new(pool.clone());
    let token = identity
        .establish_verified_session(
            ISSUER,
            "legacy-admin",
            "Legacy Admin",
            Some("legacy@example.com"),
            None,
        )
        .await
        .unwrap();
    assert_eq!(identity.session(&token).await.unwrap().identity.id, "a-000");
    let hash = secret_hash(&token);
    let repo =
        MembershipRepository::new(pool.clone(), ISSUER.into()).with_session_hash(hash.clone());
    // The oversized row is exactly the 51st look-ahead result: it must not
    // prevent the first page's unrelated members being administered.
    let first = repo
        .snapshot("a-000", "legacy-org", None, None, None)
        .await
        .unwrap();
    assert_eq!(first.members.len(), 50);
    assert!(first.members.iter().all(|m| m.actor_id != "zz-legacy"));
    let last = repo
        .snapshot(
            "a-000",
            "legacy-org",
            first.members_next_cursor.as_deref(),
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(last.members.len(), 1);
    let legacy = &last.members[0];
    assert_eq!(legacy.assignments_count, 101);
    assert!(!legacy.assignments_complete);
    assert_eq!(legacy.assignments.len(), 100);
    let mut cursor = None;
    let mut all = Vec::new();
    loop {
        let page = repo
            .member_assignments("a-000", "legacy-org", "zz-legacy", cursor.as_deref())
            .await
            .unwrap();
        assert_eq!(page.total, 101);
        assert_eq!(page.version, "0");
        assert!(page.assignments.len() <= 50);
        assert!(
            page.assignments
                .iter()
                .all(|a| a.client_name == "Legacy Client"
                    && a.engagement_name.starts_with("Engagement "))
        );
        all.extend(page.assignments);
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(all.len(), 101);
    assert_eq!(all.first().unwrap().expires_at, Some(before_expiry));
    assert_eq!(all.last().unwrap().engagement_id, "e101");
    assert_eq!(
        repo.member_assignments("a-000", "missing", "zz-legacy", None)
            .await,
        Err(MembershipError::Denied)
    );
    let preserved = repo
        .save_member(
            "a-000",
            "legacy-org",
            &command("legacy-preserve", "0", vec![], AssignmentMode::Preserve),
        )
        .await
        .unwrap();
    assert_eq!(preserved.version, "1");
    let attempted = command(
        "legacy-truncated-replace",
        "1",
        legacy.assignments.clone(),
        AssignmentMode::Replace,
    );
    assert_eq!(
        repo.save_member("a-000", "legacy-org", &attempted).await,
        Err(MembershipError::Capacity)
    );
    let still = repo
        .member_assignments("a-000", "legacy-org", "zz-legacy", None)
        .await
        .unwrap();
    assert_eq!(still.total, 101);
    assert_eq!(still.version, "1");
    assert_eq!(still.assignments[0].expires_at, Some(before_expiry));
    let removed = repo
        .save_member(
            "a-000",
            "legacy-org",
            &command(
                "legacy-remove",
                "1",
                vec![Assignment {
                    client_id: "client".into(),
                    engagement_id: "e101".into(),
                }],
                AssignmentMode::Remove,
            ),
        )
        .await
        .unwrap();
    assert_eq!(removed.version, "2");
    let complete = repo
        .snapshot("a-000", "legacy-org", Some("a-049"), None, None)
        .await
        .unwrap();
    let repaired = &complete.members[0];
    assert!(repaired.assignments_complete);
    assert_eq!(repaired.assignments_count, 100);
    assert_eq!(repaired.assignments.len(), 100);
    assert!(
        !repaired
            .assignments
            .iter()
            .any(|a| a.engagement_id == "e101")
    );
    assert!(
        repaired
            .assignments
            .iter()
            .any(|a| a.engagement_id == "e100"),
        "off-page assignment lost"
    );
    let mut ordinary = command(
        "legacy-role-save",
        "2",
        repaired.assignments.clone(),
        AssignmentMode::Replace,
    );
    ordinary.assignments[0].renew = true; // A still-future grant cannot be widened.
    repo.save_member("a-000", "legacy-org", &ordinary)
        .await
        .unwrap();
    let future = repo
        .member_assignments("a-000", "legacy-org", "zz-legacy", None)
        .await
        .unwrap();
    assert_eq!(
        future.assignments[0].expires_at,
        Some(before_expiry),
        "ordinary Save silently renewed a future assignment"
    );
    // Expiry is bounded identically in application validation and the SQL
    // authority; the accepted boundary remains readable on the next snapshot.
    let mut bounded = command(
        "legacy-max-expiry",
        "3",
        repaired.assignments.clone(),
        AssignmentMode::Replace,
    );
    bounded.expires_at = Some(MAX_MEMBERSHIP_EXPIRY);
    repo.save_member("a-000", "legacy-org", &bounded)
        .await
        .unwrap();
    let snapshot = repo
        .snapshot("a-000", "legacy-org", Some("a-049"), None, None)
        .await
        .unwrap();
    assert_eq!(snapshot.members[0].expires_at, Some(MAX_MEMBERSHIP_EXPIRY));
    let mut excessive = bounded;
    excessive.key = "legacy-bad-expiry".into();
    excessive.expected_version = "4".into();
    excessive.expires_at = Some(MAX_MEMBERSHIP_EXPIRY + 1);
    assert!(!excessive.is_valid());
    assert_eq!(
        repo.save_member("a-000", "legacy-org", &excessive).await,
        Err(MembershipError::Invalid)
    );
    let mut tx = scope::begin_actor(&pool, "a-000").await.unwrap();
    let error = sqlx::query_scalar::<_, Value>("SELECT membership_write($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind("a-000")
        .bind(&hash)
        .bind("legacy-org")
        .bind("save_member")
        .bind(serde_json::to_value(&excessive).unwrap())
        .bind("expiry-bypass-event")
        .bind("expiry-bypass-invite")
        .bind(ISSUER)
        .fetch_one(&mut *tx)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("Z0001")
    );
    tx.rollback().await.unwrap();
    // Prefix-adjacent client IDs distinguish tuple ordering from concatenated
    // cursor ordering. Each of 101 scopes must be inspectable exactly once.
    admin.execute("INSERT INTO identities(id,issuer,subject,display_name) VALUES('tuple-member','https://membership.fixture.invalid','tuple-member','Tuple Member'); INSERT INTO organisation_memberships(organisation_id,actor_id,roles) VALUES('legacy-org','tuple-member',ARRAY['auditor']); INSERT INTO clients VALUES('legacy-org','a','Tuple Client a'),('legacy-org','a-','Tuple Client a-'); INSERT INTO engagements SELECT 'legacy-org','a','e'||lpad(g::text,3,'0'),'Tuple Engagement '||g FROM generate_series(1,50) g; INSERT INTO engagements SELECT 'legacy-org','a-','e'||lpad(g::text,3,'0'),'Tuple Engagement '||g FROM generate_series(1,51) g; INSERT INTO engagement_assignments(organisation_id,client_id,engagement_id,actor_id) SELECT organisation_id,client_id,id,'tuple-member' FROM engagements WHERE organisation_id='legacy-org' AND client_id IN ('a','a-')").await.unwrap();
    let expected: Vec<(String, String)> = [("a", 50), ("a-", 51)]
        .into_iter()
        .flat_map(|(client, count)| {
            (1..=count).map(move |g| (client.to_owned(), format!("e{g:03}")))
        })
        .collect();
    let mut tuple_seen = Vec::new();
    let mut tuple_cursor = None;
    let mut cursors = Vec::new();
    loop {
        let page = repo
            .member_assignments(
                "a-000",
                "legacy-org",
                "tuple-member",
                tuple_cursor.as_deref(),
            )
            .await
            .unwrap();
        assert_eq!(page.total, 101);
        assert_eq!(page.version, "4");
        assert!(
            page.assignments
                .iter()
                .all(|a| a.client_name == format!("Tuple Client {}", a.client_id)
                    && a.engagement_name.starts_with("Tuple Engagement "))
        );
        tuple_seen.extend(
            page.assignments
                .into_iter()
                .map(|a| (a.client_id, a.engagement_id)),
        );
        tuple_cursor = page.next_cursor;
        if let Some(cursor) = &tuple_cursor {
            cursors.push(cursor.clone());
        } else {
            break;
        }
        assert!(cursors.len() <= 2, "pagination repeated a page");
    }
    assert_eq!(cursors, vec!["a.e050", "a-.e050"]);
    assert_eq!(
        tuple_seen, expected,
        "tuple pagination omitted or duplicated a scope"
    );
    for (index, chunk) in tuple_seen.chunks(50).enumerate() {
        let mut remove = command(
            &format!("tuple-remove-{index}"),
            &(4 + index).to_string(),
            chunk
                .iter()
                .map(|(client, engagement)| Assignment {
                    client_id: client.clone(),
                    engagement_id: engagement.clone(),
                })
                .collect(),
            AssignmentMode::Remove,
        );
        remove.actor_id = "tuple-member".into();
        repo.save_member("a-000", "legacy-org", &remove)
            .await
            .unwrap();
        let remaining = repo
            .member_assignments("a-000", "legacy-org", "tuple-member", None)
            .await
            .unwrap();
        assert_eq!(remaining.total, (101 - ((index + 1) * 50).min(101)) as u64);
        if index == 0 {
            assert!(remaining.assignments.iter().all(|a| a.client_id == "a-"));
        }
    }
    let remaining:i64=sqlx::query_scalar("SELECT count(*) FROM engagement_assignments WHERE organisation_id='legacy-org' AND actor_id='tuple-member' AND active").fetch_one(&mut admin).await.unwrap();
    assert_eq!(remaining, 0);
    // Sparse/no-Admin membership lookup uses actor-first indexing even when
    // thousands of unrelated tenant memberships sort before the result.
    admin.execute("INSERT INTO organisations SELECT 'foreign-'||lpad(g::text,4,'0'),'Unrelated Organisation' FROM generate_series(1,2000) g; INSERT INTO organisation_memberships(organisation_id,actor_id,roles) SELECT 'foreign-'||lpad(g::text,4,'0'),'foreign-admin',ARRAY['admin'] FROM generate_series(1,2000) g; ANALYZE organisation_memberships; ANALYZE organisations; ANALYZE membership_versions").await.unwrap();
    // EXPLAIN the exact SELECT owned by the migration, rather than a copied
    // query that could drift away from the callable function's implementation.
    let migration = include_str!("../../../../migrations/0005_membership_administration.sql");
    let (_, body) = migration
        .split_once("  (SELECT o.id,jsonb_build_object")
        .unwrap();
    let (query, _) = body.split_once(") page;").unwrap();
    let listing_sql = format!("SELECT o.id,jsonb_build_object{query}")
        .replace("m.actor_id=actor", "m.actor_id=$1")
        .replace("coalesce(members_after,", "coalesce($2,");
    let mut plans = Vec::new();
    for actor in ["a-000", "zz-legacy"] {
        let plan: Value = sqlx::query_scalar(&format!(
            "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) {listing_sql}"
        ))
        .bind(actor)
        .bind("")
        .fetch_one(&mut admin)
        .await
        .unwrap();
        assert!(
            plan_has_index(&plan, "organisation_memberships_admin_actor"),
            "actor-first organisation index was not selected: {plan}"
        );
        plans.push(json!({"actor":actor,"plan":plan}));
    }
    std::fs::write(
        "/tmp/zobba-membership-repair-plans.json",
        serde_json::to_vec_pretty(&plans).unwrap(),
    )
    .unwrap();
    assert_eq!(
        repo.organisations("a-000", None)
            .await
            .unwrap()
            .organisations
            .len(),
        1
    );
    // No direct runtime INSERT can bypass the entry point or its expiry
    // validation, and the stored database constraints also protect owner writes.
    for invalid in [-1, MAX_MEMBERSHIP_EXPIRY + 1] {
        let denied=sqlx::query("INSERT INTO organisation_memberships(organisation_id,actor_id,roles,expires_at) VALUES('legacy-org','foreign-admin',ARRAY['auditor'],$1)").bind(invalid).execute(&pool).await.unwrap_err();
        assert_eq!(
            denied.as_database_error().unwrap().code().as_deref(),
            Some("42501")
        );
        let denied=sqlx::query("INSERT INTO engagement_assignments(organisation_id,client_id,engagement_id,actor_id,expires_at) VALUES('legacy-org','client','e101','a-001',$1)").bind(invalid).execute(&pool).await.unwrap_err();
        assert_eq!(
            denied.as_database_error().unwrap().code().as_deref(),
            Some("42501")
        );
        let invalid_member=sqlx::query("UPDATE organisation_memberships SET expires_at=$1 WHERE organisation_id='legacy-org' AND actor_id='zz-legacy'").bind(invalid).execute(&mut admin).await.unwrap_err();
        assert_eq!(
            invalid_member.as_database_error().unwrap().constraint(),
            Some("organisation_memberships_expiry_range")
        );
        let invalid_assignment=sqlx::query("UPDATE engagement_assignments SET expires_at=$1 WHERE organisation_id='legacy-org' AND actor_id='zz-legacy' AND engagement_id='e001'").bind(invalid).execute(&mut admin).await.unwrap_err();
        assert_eq!(
            invalid_assignment.as_database_error().unwrap().constraint(),
            Some("engagement_assignments_expiry_range")
        );
    }
    let member_token = identity
        .establish_session(ISSUER, "legacy-member", "Legacy Member", None)
        .await
        .unwrap();
    let member_repo = MembershipRepository::new(pool.clone(), ISSUER.into())
        .with_session_hash(secret_hash(&member_token));
    assert!(
        member_repo
            .organisations("zz-legacy", None)
            .await
            .unwrap()
            .organisations
            .is_empty()
    );
    pool.close().await;
}
