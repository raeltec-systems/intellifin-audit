//! A confirmed deferred-write barrier crosses a real scheduled-method cutoff.
use super::*;
use zobba_application::methodology::{MethodologyStore, SaveMethodology};
use zobba_infrastructure::{
    identity::{IdentityRepository, secret_hash},
    methodology::MethodologyRepository,
};

pub(super) async fn verify(config: &Configuration) {
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    const ISSUER: &str = "https://127.0.0.1:4443";
    seed_local_configured(ISSUER, &config.migration)
        .await
        .unwrap();
    let runtime = pool(config, 4).await;
    let repository = TaskRepository::new(runtime.clone());
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let session = IdentityRepository::new(runtime.clone())
        .establish_session(ISSUER, "admin-only", "Admin", None)
        .await
        .unwrap();
    let methods =
        MethodologyRepository::new(runtime.clone()).with_session_hash(secret_hash(&session));
    let scope = selected("a");
    let created = repository
        .admit(
            "actor-a",
            &scope,
            &create("consume-cutoff", "Preserve the exact pre-cutoff claim"),
        )
        .await
        .unwrap();
    let cutoff: i64 =
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint+3")
            .fetch_one(&mut admin)
            .await
            .unwrap();
    let save: SaveMethodology = serde_json::from_value(serde_json::json!({
        "key":"consume-cutoff-policy", "expected_revision":0,
        "supersedes":null, "undo_of":null,
        "assignment":{"kind":"firm","client_id":null,"engagement_id":null},
        "applicability":{"audit_area":null,"period_start":null,"period_end":null},
        "activation":{"mode":"active_tasks","available_at":cutoff},
        "definition":{"name":"Scheduled consumption boundary","neutral_starter":false,
            "default_context":{"audit_area":null,"period_start":null,"period_end":null},
            "requirements":[],"templates":[]},
        "source":{"kind":"authored","reference":null,"note":"Synthetic cutoff proof"}
    }))
    .unwrap();
    methods.save("actor-admin", "org-a", &save).await.unwrap();
    let route = WakeupRoute {
        id: created.task_id.clone(),
        actor_id: "actor-a".into(),
        scope: scope.clone(),
        task_id: created.task_id.clone(),
    };
    let claim = executed(
        repository
            .coordinate(&route, "consume-cutoff-worker")
            .await
            .unwrap(),
    );
    admin.execute("CREATE FUNCTION public.task_fixture_consume_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock(9026212013); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER task_fixture_consume_gate AFTER INSERT ON public.task_receipt_slots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.task_fixture_consume_gate()")
        .await.unwrap();
    let mut holder = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut holder).await;
    let blocker: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut holder)
        .await
        .unwrap();
    holder
        .execute("SELECT pg_advisory_lock(9026212013)")
        .await
        .unwrap();
    let before = durable_state(&mut admin).await;
    let worker = repository.clone();
    let original = claim.clone();
    let consuming = tokio::spawn(async move { worker.consume(&original).await });
    waiting_backend_blocked_by(&mut admin, "advisory", Some(blocker)).await;
    assert!(
        !consuming.is_finished(),
        "the exact deferred receipt write must be blocked after initial eligibility"
    );
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let due: bool = sqlx::query_scalar("SELECT clock_timestamp()>=to_timestamp($1)")
                .bind(cutoff as f64)
                .fetch_one(&mut admin)
                .await
                .unwrap();
            if due {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("database clock did not reach the scheduled cutoff");
    holder
        .execute("SELECT pg_advisory_unlock(9026212013)")
        .await
        .unwrap();
    assert!(matches!(consuming.await.unwrap(), Err(TaskError::Fenced)));
    let owner_live: bool =
        sqlx::query_scalar("SELECT owner_until>clock_timestamp() FROM public.tasks WHERE id=$1")
            .bind(&created.task_id)
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert!(
        owner_live,
        "methodology cutoff, not owner expiry, fences this claim"
    );
    assert_eq!(
        durable_state(&mut admin).await,
        before,
        "cutoff refusal must roll back the claim, receipt capability, state, event and counter"
    );
    admin.execute("DROP TRIGGER task_fixture_consume_gate ON public.task_receipt_slots; DROP FUNCTION public.task_fixture_consume_gate()")
        .await.unwrap();
    let replacement = executed(
        repository
            .coordinate(&route, "consume-cutoff-worker")
            .await
            .unwrap(),
    );
    assert!(replacement.execution_epoch > claim.execution_epoch);
    let accepted = repository.consume(&replacement).await.unwrap();
    repository
        .observe(&accepted, Observation::NotStarted)
        .await
        .unwrap();
    runtime.close().await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
}
