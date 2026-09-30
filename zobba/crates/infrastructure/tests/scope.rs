//! Destructive, guarded synthetic PostgreSQL proof. Every runtime request shares ONE connection.
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use std::time::Duration;
use zobba_domain::identity::Scope;
use zobba_infrastructure::{
    database_options, migrate,
    scope::{self, ScopeError},
};
mod support;
use support::Configuration;

fn selected(org: &str, client: &str, engagement: &str) -> Scope {
    Scope {
        organisation_id: org.into(),
        client_id: client.into(),
        engagement_id: engagement.into(),
    }
}
async fn names(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>) -> Vec<String> {
    sqlx::query_scalar("SELECT name FROM public.engagements ORDER BY name")
        .fetch_all(&mut **tx)
        .await
        .unwrap()
}
async fn clean(pool: &PgPool, expected_pid: i32) {
    let (pid, actor, org, client, engagement): (i32,String,String,String,String) = sqlx::query_as("SELECT pg_catalog.pg_backend_pid(), COALESCE(pg_catalog.current_setting('zobba.actor_id',true),''), COALESCE(pg_catalog.current_setting('zobba.organisation_id',true),''), COALESCE(pg_catalog.current_setting('zobba.client_id',true),''), COALESCE(pg_catalog.current_setting('zobba.engagement_id',true),'')")
        .fetch_one(pool).await.unwrap();
    assert_eq!(
        pid, expected_pid,
        "proof must reuse the same physical connection"
    );
    assert_eq!(
        (actor, org, client, engagement),
        (String::new(), String::new(), String::new(), String::new())
    );
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM public.engagements")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(rows, 0, "missing actor context must not disclose rows");
}

#[tokio::test]
async fn scoped_authority_and_pool_contract() {
    let config = Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    let options = database_options(&config.runtime).unwrap();
    migrate(&config.migration, options.get_username())
        .await
        .unwrap();
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    admin.execute(r#"
      INSERT INTO public.identities(id,issuer,subject,display_name) VALUES
        ('alice','https://fixture.invalid','alice','Alice'), ('bob','https://fixture.invalid','bob','Bob'),
        ('manager','https://fixture.invalid','manager','Manager'),('admin','https://fixture.invalid','admin','Admin');
      INSERT INTO public.organisations VALUES ('oa','Org A'),('ob','Org B');
      INSERT INTO public.clients VALUES ('oa','ca','Client A'),('oa','ca2','Client A2'),('ob','cb','Client B');
      INSERT INTO public.engagements VALUES ('oa','ca','ea','A engagement'),('oa','ca2','ea2','A second'),('ob','cb','eb','B engagement');
      INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES
        ('oa','alice',ARRAY['auditor']),('ob','bob',ARRAY['audit_manager']),
        ('oa','manager',ARRAY['admin','audit_manager']),('oa','admin',ARRAY['admin']);
      INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES
        ('oa','ca','ea','alice'),('oa','ca2','ea2','alice'),('ob','cb','eb','bob'),
        ('oa','ca','ea','manager'),('oa','ca','ea','admin');
    "#).await.unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(2))
        .connect_with(options)
        .await
        .unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_catalog.pg_backend_pid()")
        .fetch_one(&pool)
        .await
        .unwrap();
    clean(&pool, pid).await;
    let a = selected("oa", "ca", "ea");
    let b = selected("ob", "cb", "eb");

    // Actor-only chooser: no foreign organisations, clients, assignments or membership.
    let mut chooser = scope::begin_actor(&pool, "alice").await.unwrap();
    assert_eq!(names(&mut chooser).await, ["A engagement", "A second"]);
    for (table, wanted) in [
        ("organisations", 1_i64),
        ("clients", 2),
        ("organisation_memberships", 1),
        ("engagement_assignments", 2),
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
            .fetch_one(&mut *chooser)
            .await
            .unwrap();
        assert_eq!(count, wanted, "actor-only {table}");
    }
    let written = sqlx::query("UPDATE public.engagements SET name='chooser write'")
        .execute(&mut *chooser)
        .await
        .unwrap()
        .rows_affected();
    assert_eq!(written, 0, "chooser has no DML scope");
    chooser.commit().await.unwrap();
    clean(&pool, pid).await;

    for (actor, scope, wanted) in [
        ("alice", &a, "A engagement"),
        ("bob", &b, "B engagement"),
        ("manager", &a, "A engagement"),
    ] {
        let mut tx = scope::begin(&pool, actor, scope).await.unwrap();
        assert_eq!(names(&mut tx).await, [wanted]);
        let joined:Vec<(String,String,String)>=sqlx::query_as("SELECT o.name,c.name,e.name FROM public.engagements e JOIN public.clients c ON (c.organisation_id,c.id)=(e.organisation_id,e.client_id) JOIN public.organisations o ON o.id=c.organisation_id").fetch_all(&mut *tx).await.unwrap();
        assert_eq!(joined.len(), 1, "scoped joins must not widen audience");
        tx.commit().await.unwrap();
        clean(&pool, pid).await;
    }
    for (actor, scope) in [("alice", &b), ("bob", &a), ("admin", &a), ("unknown", &a)] {
        assert!(matches!(
            scope::begin(&pool, actor, scope).await,
            Err(ScopeError::Denied)
        ));
        clean(&pool, pid).await;
    }
    for bad in [
        selected("oa", "cb", "eb"),
        selected("ob", "ca", "ea"),
        selected("oa", "ca2", "ea"),
        selected("oa", "ca", "guessed"),
        selected("", "ca", "ea"),
    ] {
        assert!(matches!(
            scope::begin(&pool, "alice", &bad).await,
            Err(ScopeError::Denied)
        ));
        clean(&pool, pid).await;
    }
    let mut only_admin = scope::begin_actor(&pool, "admin").await.unwrap();
    assert!(names(&mut only_admin).await.is_empty());
    only_admin.rollback().await.unwrap();

    // Actual allowed DML, followed by denied same-client/foreign-scope DML with the SAME SQL grant.
    let mut tx = scope::begin(&pool, "alice", &a).await.unwrap();
    assert_eq!(
        sqlx::query("UPDATE public.engagements SET name='changed' WHERE id='ea'")
            .execute(&mut *tx)
            .await
            .unwrap()
            .rows_affected(),
        1
    );
    for foreign in ["ea2", "eb"] {
        assert_eq!(
            sqlx::query("UPDATE public.engagements SET name='leak' WHERE id=$1")
                .bind(foreign)
                .execute(&mut *tx)
                .await
                .unwrap()
                .rows_affected(),
            0
        );
    }
    tx.rollback().await.unwrap();
    clean(&pool, pid).await;
    let mut tx = scope::begin(&pool, "alice", &a).await.unwrap();
    assert_eq!(
        names(&mut tx).await,
        ["A engagement"],
        "rollback restores writes"
    );
    assert!(
        sqlx::query("UPDATE public.engagements SET organisation_id='ob'")
            .execute(&mut *tx)
            .await
            .is_err(),
        "runtime may not rewrite scoped identities"
    );
    tx.rollback().await.unwrap();
    clean(&pool, pid).await;
    // Commit a legitimate name write, and verify it only through its exact scope.
    let mut tx = scope::begin(&pool, "alice", &a).await.unwrap();
    sqlx::query("UPDATE public.engagements SET name='A accepted'")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    clean(&pool, pid).await;
    let mut tx = scope::begin(&pool, "alice", &a).await.unwrap();
    assert_eq!(names(&mut tx).await, ["A accepted"]);
    tx.commit().await.unwrap();

    // Relational scope consistency is enforced even for trusted fixture administration.
    for bad in [
        "INSERT INTO public.engagements VALUES('oa','cb','bad','bad')",
        "INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('oa','ca2','ea','alice')",
        "INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('ob','cb','eb','alice')",
    ] {
        let error = admin
            .execute(bad)
            .await
            .expect_err("mismatched composite reference admitted");
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("23503")
        );
    }

    // Fresh membership, assignment, roles, and identity are checked on the next statement/request.
    for (revoke, restore) in [
        (
            "UPDATE public.organisation_memberships SET active=false WHERE actor_id='alice'",
            "UPDATE public.organisation_memberships SET active=true WHERE actor_id='alice'",
        ),
        (
            "UPDATE public.organisation_memberships SET roles=ARRAY['admin'] WHERE actor_id='alice'",
            "UPDATE public.organisation_memberships SET roles=ARRAY['auditor'] WHERE actor_id='alice'",
        ),
        (
            "UPDATE public.organisation_memberships SET expires_at=1 WHERE actor_id='alice'",
            "UPDATE public.organisation_memberships SET expires_at=NULL WHERE actor_id='alice'",
        ),
        (
            "UPDATE public.engagement_assignments SET active=false WHERE actor_id='alice'",
            "UPDATE public.engagement_assignments SET active=true WHERE actor_id='alice'",
        ),
        (
            "UPDATE public.engagement_assignments SET expires_at=1 WHERE actor_id='alice'",
            "UPDATE public.engagement_assignments SET expires_at=NULL WHERE actor_id='alice'",
        ),
        (
            "UPDATE public.identities SET active=false WHERE id='alice'",
            "UPDATE public.identities SET active=true WHERE id='alice'",
        ),
    ] {
        let mut tx = scope::begin(&pool, "alice", &a).await.unwrap();
        admin.execute(revoke).await.unwrap();
        assert!(
            names(&mut tx).await.is_empty(),
            "existing transaction ignored changed authority"
        );
        assert_eq!(
            sqlx::query("UPDATE public.engagements SET name='revoked'")
                .execute(&mut *tx)
                .await
                .unwrap()
                .rows_affected(),
            0
        );
        tx.commit().await.unwrap();
        assert!(matches!(
            scope::begin(&pool, "alice", &a).await,
            Err(ScopeError::Denied)
        ));
        clean(&pool, pid).await;
        admin.execute(restore).await.unwrap();
    }
    admin.execute("DELETE FROM public.engagement_assignments WHERE actor_id='alice' AND engagement_id='ea'").await.unwrap();
    assert!(matches!(
        scope::begin(&pool, "alice", &a).await,
        Err(ScopeError::Denied)
    ));
    admin.execute("INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('oa','ca','ea','alice')").await.unwrap();

    // Dropping a future while SQL is active rolls back scope and pending writes.
    let cancelled = tokio::time::timeout(Duration::from_millis(30), async {
        let mut tx = scope::begin(&pool, "alice", &a).await.unwrap();
        sqlx::query("UPDATE public.engagements SET name='cancelled'")
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("SELECT pg_catalog.pg_sleep(0.2)")
            .execute(&mut *tx)
            .await
            .unwrap();
        tx.commit().await.unwrap();
    })
    .await;
    assert!(cancelled.is_err());
    clean(&pool, pid).await;
    let mut tx = scope::begin(&pool, "alice", &a).await.unwrap();
    assert_eq!(names(&mut tx).await, ["A accepted"]);
    tx.commit().await.unwrap();
    clean(&pool, pid).await;
    pool.close().await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    println!(
        "scope matrix passed: one connection, actor chooser, two organisations/three clients, joins, real granted DML, guessed/mismatched IDs, Admin-only refusal, composite FKs, current removal/demotion/expiry/invalidation, commit/rollback/cancellation"
    );
}
