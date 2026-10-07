//! Guarded real PostgreSQL command, fencing, receipt and transaction proofs.
//! One serial async test owns this disposable database; no real activity runs here.
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use std::time::{Duration, Instant};
use zobba_application::task::{TaskCommands, TaskDelivery, TaskError, TaskExecution};
use zobba_domain::{
    identity::Scope,
    task::{
        Cessation, ClaimBasis, CommandKind, CommandReceipt, ConsumedAttempt, Decision, Observation,
        ReceiptStatus, TaskCommand, TaskState, WakeupRoute,
    },
};
use zobba_infrastructure::{
    database_options, dispatcher::Dispatcher, fixture::seed_local_configured, migrate,
    task::TaskRepository,
};
#[path = "task/methodology_cutoff.rs"]
mod methodology_cutoff;
mod support;
use support::Configuration;

fn selected(suffix: &str) -> Scope {
    Scope {
        organisation_id: format!("org-{suffix}"),
        client_id: format!("client-{suffix}"),
        engagement_id: format!("engagement-{suffix}"),
    }
}
fn create(key: &str, content: &str) -> TaskCommand {
    TaskCommand {
        context: None,
        key: key.into(),
        kind: CommandKind::Create,
        task_id: None,
        cycle_id: None,
        content: Some(content.into()),
    }
}
fn command(key: &str, kind: CommandKind, receipt: &CommandReceipt) -> TaskCommand {
    TaskCommand {
        context: None,
        key: key.into(),
        kind,
        task_id: Some(receipt.task_id.clone()),
        cycle_id: Some(receipt.cycle_id.clone()),
        content: (kind == CommandKind::Guide).then(|| format!("Retained guidance {key}")),
    }
}
fn executed(decision: Decision) -> ClaimBasis {
    match decision {
        Decision::Execute(basis) => *basis,
        other => panic!("expected an admitted inert claim, got {other:?}"),
    }
}
async fn pool(config: &Configuration, connections: u32) -> PgPool {
    PgPoolOptions::new()
        .max_connections(connections)
        .acquire_timeout(Duration::from_secs(2))
        .connect_with(
            database_options(&config.runtime)
                .unwrap()
                .application_name("zobba-task-contract"),
        )
        .await
        .unwrap()
}
async fn clean(pool: &PgPool, expected_pid: i32) {
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(
        pid, expected_pid,
        "context proof must reuse the physical connection"
    );
    let settings: Vec<String> = sqlx::query_scalar("SELECT coalesce(current_setting(name,true),'') FROM unnest(ARRAY['zobba.actor_id','zobba.organisation_id','zobba.client_id','zobba.engagement_id','zobba.dispatcher','zobba.receipt_claim','zobba.receipt_hash','zobba.receipt_org','zobba.receipt_client','zobba.receipt_engagement']) name")
        .fetch_all(pool).await.unwrap();
    assert!(
        settings.iter().all(String::is_empty),
        "transaction-local authority leaked"
    );
    for table in [
        "tasks",
        "task_commands",
        "task_events",
        "task_wakeups",
        "task_deliveries",
        "task_claims",
        "task_receipt_slots",
        "task_observations",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
            .fetch_one(pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "unscoped connection disclosed {table}");
    }
}
async fn durable_state(admin: &mut PgConnection) -> Vec<String> {
    let mut rows = Vec::new();
    for table in [
        "tasks",
        "task_cycles",
        "task_commands",
        "task_events",
        "task_wakeups",
        "task_deliveries",
        "task_counters",
        "task_claims",
        "task_receipt_slots",
        "task_observations",
        "task_methodology_bindings",
        "task_methodology_heads",
        "task_methodology_changes",
    ] {
        rows.push(sqlx::query_scalar(&format!("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text FROM public.{table} t"))
            .fetch_one(&mut *admin).await.unwrap());
    }
    rows
}
async fn waiting_backend(admin: &mut PgConnection, wait: &str) -> i32 {
    waiting_backend_blocked_by(admin, wait, None).await
}
async fn waiting_backend_blocked_by(
    admin: &mut PgConnection,
    wait: &str,
    blocker: Option<i32>,
) -> i32 {
    let until = Instant::now() + Duration::from_secs(2);
    loop {
        if let Some(pid) = sqlx::query_scalar("SELECT pid FROM pg_stat_activity WHERE application_name='zobba-task-contract' AND wait_event=$1 AND ($2::integer IS NULL OR $2=ANY(pg_blocking_pids(pid))) ORDER BY query_start LIMIT 1")
            .bind(wait).bind(blocker).fetch_optional(&mut *admin).await.unwrap() { return pid; }
        assert!(
            Instant::now() < until,
            "admission did not reach PostgreSQL {wait} wait behind {blocker:?}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}
async fn commit_gate(admin: &mut PgConnection) {
    // Deferred execution holds a real admission at COMMIT after all five writes.
    admin.execute("CREATE FUNCTION public.task_fixture_commit_gate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_catalog.pg_advisory_xact_lock(9026030099); RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER task_fixture_commit_gate AFTER INSERT ON public.task_wakeups DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.task_fixture_commit_gate()")
        .await.unwrap();
}
async fn remove_commit_gate(admin: &mut PgConnection) {
    admin.execute("DROP TRIGGER task_fixture_commit_gate ON public.task_wakeups; DROP FUNCTION public.task_fixture_commit_gate()")
        .await.unwrap();
}
async fn admission_atomicity(
    config: &Configuration,
    admin: &mut PgConnection,
    repository: &TaskRepository,
) {
    let mut holder = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut holder).await;
    commit_gate(admin).await;
    holder
        .execute("SELECT pg_advisory_lock(9026030099)")
        .await
        .unwrap();
    let before = durable_state(admin).await;
    let rollback_command = create("rollback", "Must not be acknowledged before commit");
    let repo = repository.clone();
    let input = rollback_command.clone();
    let pending = tokio::spawn(async move { repo.admit("actor-a", &selected("a"), &input).await });
    let pid = waiting_backend(admin, "advisory").await;
    assert!(
        !pending.is_finished(),
        "uncommitted command returned a receipt"
    );
    assert_eq!(
        durable_state(admin).await,
        before,
        "staged acceptance leaked before commit"
    );
    let cancelled: bool = sqlx::query_scalar("SELECT pg_cancel_backend($1)")
        .bind(pid)
        .fetch_one(&mut *admin)
        .await
        .unwrap();
    assert!(cancelled);
    assert_eq!(pending.await.unwrap(), Err(TaskError::Unavailable));
    assert_eq!(
        durable_state(admin).await,
        before,
        "failed commit retained partial acceptance"
    );
    holder
        .execute("SELECT pg_advisory_unlock(9026030099)")
        .await
        .unwrap();
    remove_commit_gate(admin).await;
    let retry = repository
        .admit("actor-a", &selected("a"), &rollback_command)
        .await
        .unwrap();
    assert_eq!(
        retry.event_cursor, "1",
        "rolled-back event allocation left a cursor gap"
    );
    assert_eq!(
        repository
            .admit("actor-a", &selected("a"), &rollback_command)
            .await
            .unwrap(),
        retry
    );

    // The earlier command is held at COMMIT; a concurrent later command must
    // neither publish a later cursor nor acknowledge ahead of that transaction.
    commit_gate(admin).await;
    holder
        .execute("SELECT pg_advisory_lock(9026030099)")
        .await
        .unwrap();
    let repo = repository.clone();
    let first = tokio::spawn(async move {
        repo.admit(
            "actor-a",
            &selected("a"),
            &create("ordered-first", "Earlier transaction"),
        )
        .await
    });
    let first_pid = waiting_backend(admin, "advisory").await;
    let repo = repository.clone();
    let second = tokio::spawn(async move {
        repo.admit(
            "actor-a",
            &selected("a"),
            &create("ordered-second", "Later transaction"),
        )
        .await
    });
    // The organisation fence precedes the engagement row lock. The second
    // admission must wait behind this exact first admission, not merely share
    // its advisory wait type (the first is itself held by the COMMIT gate).
    let second_pid = waiting_backend_blocked_by(admin, "advisory", Some(first_pid)).await;
    assert_ne!(first_pid, second_pid);
    assert!(!first.is_finished() && !second.is_finished());
    assert_eq!(
        repository
            .events("actor-a", &selected("a"), 0)
            .await
            .unwrap()
            .len(),
        1
    );
    holder
        .execute("SELECT pg_advisory_unlock(9026030099)")
        .await
        .unwrap();
    let first = first.await.unwrap().unwrap();
    let second = second.await.unwrap().unwrap();
    assert_eq!(
        (first.event_cursor.as_str(), second.event_cursor.as_str()),
        ("2", "3")
    );
    let events = repository
        .events("actor-a", &selected("a"), 1)
        .await
        .unwrap();
    assert_eq!(
        events
            .iter()
            .map(|event| event.command_id.as_deref())
            .collect::<Vec<_>>(),
        [
            Some(first.command_id.as_str()),
            Some(second.command_id.as_str())
        ]
    );
    remove_commit_gate(admin).await;
}

async fn dispatch_boundary(
    runtime: &PgPool,
    admin: &mut PgConnection,
    local: &CommandReceipt,
    foreign: &CommandReceipt,
) {
    let before = durable_state(admin).await;
    let mut tx = runtime.begin().await.unwrap();
    tx.execute("SELECT set_config('zobba.actor_id','',true),set_config('zobba.organisation_id','',true),set_config('zobba.client_id','',true),set_config('zobba.engagement_id','',true),set_config('zobba.receipt_claim','',true),set_config('zobba.receipt_hash','',true),set_config('zobba.receipt_org','',true),set_config('zobba.receipt_client','',true),set_config('zobba.receipt_engagement','',true),set_config('zobba.dispatcher','on',true)").await.unwrap();
    let visible: Vec<String> = sqlx::query_scalar(
        "SELECT task_id FROM public.task_wakeups WHERE task_id=ANY($1) ORDER BY task_id",
    )
    .bind(vec![local.task_id.clone(), foreign.task_id.clone()])
    .fetch_all(&mut *tx)
    .await
    .unwrap();
    assert_eq!(
        visible.len(),
        2,
        "dispatcher must discover content-free routes across scopes"
    );
    for table in [
        "tasks",
        "task_commands",
        "task_events",
        "task_claims",
        "task_receipt_slots",
        "task_observations",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(count, 0, "dispatcher authority disclosed protected {table}");
    }
    // These columns remain writable by a scoped coordinator, so the negative
    // proof must exercise actual RLS with an explicitly empty actor/scope.
    for target in [&local.task_id, &foreign.task_id] {
        for assignment in [
            "pending=false",
            "available_at=clock_timestamp()+interval '1 day'",
        ] {
            let changed = sqlx::query(&format!(
                "UPDATE public.task_wakeups SET {assignment} WHERE id=$1"
            ))
            .bind(target)
            .execute(&mut *tx)
            .await
            .unwrap()
            .rows_affected();
            assert_eq!(
                changed, 0,
                "dispatcher mutated scoped scheduling: {assignment}"
            );
        }
    }
    assert_eq!(sqlx::query("UPDATE public.task_deliveries SET delivery_owner='boundary-worker',delivery_until=clock_timestamp()+interval '5 seconds' WHERE wakeup_id=$1")
        .bind(&foreign.task_id).execute(&mut *tx).await.unwrap().rows_affected(), 1,
        "dispatcher cannot acquire a content-free foreign delivery lease");
    for statement in [
        "INSERT INTO public.task_deliveries(wakeup_id) VALUES($1) ON CONFLICT DO NOTHING",
        "UPDATE public.task_deliveries SET wakeup_id=wakeup_id WHERE wakeup_id=$1",
        "DELETE FROM public.task_deliveries WHERE wakeup_id=$1",
        "UPDATE public.task_wakeups SET actor_id='actor-b' WHERE id=$1",
    ] {
        tx.execute("SAVEPOINT forbidden_delivery_write")
            .await
            .unwrap();
        let error = sqlx::query(statement)
            .bind(&foreign.task_id)
            .execute(&mut *tx)
            .await
            .unwrap_err();
        assert_eq!(
            error
                .as_database_error()
                .and_then(|error| error.code())
                .as_deref(),
            Some("42501"),
            "the negative proof must fail for permission/RLS, not malformed SQL"
        );
        tx.execute("ROLLBACK TO SAVEPOINT forbidden_delivery_write")
            .await
            .unwrap();
    }
    tx.rollback().await.unwrap();
    assert_eq!(
        durable_state(admin).await,
        before,
        "restricted DML proof changed durable scheduling"
    );

    let mut scoped = zobba_infrastructure::scope::begin(runtime, "actor-a", &selected("a"))
        .await
        .unwrap();
    assert_eq!(sqlx::query("UPDATE public.task_wakeups SET pending=false,available_at=clock_timestamp()+interval '1 second' WHERE id=$1")
        .bind(&local.task_id).execute(&mut *scoped).await.unwrap().rows_affected(), 1,
        "current scoped coordinator cannot schedule its Task");
    assert_eq!(
        sqlx::query("UPDATE public.task_wakeups SET pending=false WHERE id=$1")
            .bind(&foreign.task_id)
            .execute(&mut *scoped)
            .await
            .unwrap()
            .rows_affected(),
        0,
        "scoped coordinator changed foreign scheduling"
    );
    scoped.rollback().await.unwrap();
}

fn index_rows(plan: &[String], index: &str) -> f64 {
    let scan = plan
        .iter()
        .find(|line| line.contains(index) && line.contains("actual time="))
        .unwrap_or_else(|| panic!("expected the real planner to use {index}: {plan:?}"));
    scan.split("actual time=")
        .nth(1)
        .unwrap()
        .split("rows=")
        .nth(1)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .parse()
        .unwrap()
}

async fn retained_history_contract(
    config: &Configuration,
    admin: &mut PgConnection,
    repository: &TaskRepository,
    runtime: &PgPool,
) {
    const HISTORY: i64 = 2_048;
    let scope = selected("b");
    let receipt = repository
        .admit(
            "actor-b",
            &scope,
            &create("retained-history", "Retained history objective"),
        )
        .await
        .unwrap();
    let route = WakeupRoute {
        id: receipt.task_id.clone(),
        actor_id: "actor-b".into(),
        scope: scope.clone(),
        task_id: receipt.task_id.clone(),
    };
    let _unused = executed(
        TaskExecution::coordinate(repository, &route, "history-worker")
            .await
            .unwrap(),
    );
    repository
        .admit(
            "actor-b",
            &scope,
            &command("history-pause", CommandKind::Pause, &receipt),
        )
        .await
        .unwrap();
    assert_eq!(
        repository
            .coordinate(&route, "history-worker")
            .await
            .unwrap(),
        Decision::Idle
    );

    config.guard_connection(admin).await;
    let mut fixture = admin.begin().await.unwrap();
    let start: i64 = sqlx::query_scalar("SELECT cursor FROM public.task_counters WHERE organisation_id='org-b' AND client_id='client-b' AND engagement_id='engagement-b'")
        .fetch_one(&mut *fixture).await.unwrap();
    let intent: i64 = sqlx::query_scalar("SELECT intent_revision FROM public.tasks WHERE id=$1")
        .bind(&receipt.task_id)
        .fetch_one(&mut *fixture)
        .await
        .unwrap();
    // Guarded owner fixture builds retained, internally consistent Received and
    // Applied history without spending thousands of admission round trips.
    sqlx::query("INSERT INTO public.task_commands(organisation_id,client_id,engagement_id,id,author_id,idempotency_key,kind,target_task_id,target_cycle_id,content,task_id,cycle_id,received_cursor,intent_revision)
        SELECT 'org-b','client-b','engagement-b','history-command-'||n,'actor-b','history-key-'||n,'guide',$1,$2,'Retained guidance '||n,$1,$2,$3+2*n-1,$4+n FROM generate_series(1,$5::bigint) n")
        .bind(&receipt.task_id).bind(&receipt.cycle_id).bind(start).bind(intent).bind(HISTORY).execute(&mut *fixture).await.unwrap();
    sqlx::query("INSERT INTO public.task_events(organisation_id,client_id,engagement_id,cursor,task_id,cycle_id,command_id,kind)
        SELECT 'org-b','client-b','engagement-b',$3+2*n-1,$1,$2,'history-command-'||n,'received' FROM generate_series(1,$4::bigint) n
        UNION ALL SELECT 'org-b','client-b','engagement-b',$3+2*n,$1,$2,'history-command-'||n,'applied' FROM generate_series(1,$4::bigint) n")
        .bind(&receipt.task_id).bind(&receipt.cycle_id).bind(start).bind(HISTORY).execute(&mut *fixture).await.unwrap();
    sqlx::query("UPDATE public.task_counters SET cursor=$1 WHERE organisation_id='org-b' AND client_id='client-b' AND engagement_id='engagement-b'")
        .bind(start+2*HISTORY).execute(&mut *fixture).await.unwrap();
    sqlx::query("UPDATE public.tasks SET applied_command_cursor=$2,working_brief=$3,intent_revision=$4,applied_intent=$4,revision=revision+$5 WHERE id=$1")
        .bind(&receipt.task_id).bind(start+2*HISTORY-1).bind(format!("Retained guidance {HISTORY}")).bind(intent+HISTORY).bind(HISTORY).execute(&mut *fixture).await.unwrap();
    sqlx::query("INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation)
        SELECT 'org-b','client-b','engagement-b','stopped-history-'||n,'stopped-cycle-'||n,'actor-b','Retained stopped objective','Retained stopped brief','stopped','confirmed' FROM generate_series(1,$1::bigint) n")
        .bind(HISTORY).execute(&mut *fixture).await.unwrap();
    sqlx::query("INSERT INTO public.task_cycles(organisation_id,client_id,engagement_id,task_id,id,status)
        SELECT 'org-b','client-b','engagement-b','stopped-history-'||n,'stopped-cycle-'||n,'stopped' FROM generate_series(1,$1::bigint) n")
        .bind(HISTORY).execute(&mut *fixture).await.unwrap();
    // These synthetic rows represent migrated history. Preserve the explicit
    // neutral epoch-zero basis supplied by schema 8 for every historical Task.
    sqlx::query("INSERT INTO public.task_methodology_bindings(organisation_id,client_id,engagement_id,task_id,id,document)
        SELECT 'org-b','client-b','engagement-b','stopped-history-'||n,'stopped-methodology-'||n,
        jsonb_set(jsonb_set(b.document,'{id}',to_jsonb('stopped-methodology-'||n)),'{execution_epoch}','0'::jsonb)
        FROM generate_series(1,$1::bigint) n CROSS JOIN public.task_methodology_bindings b WHERE b.organisation_id='org-b' AND b.task_id=$2")
        .bind(HISTORY).bind(&receipt.task_id).execute(&mut *fixture).await.unwrap();
    sqlx::query("INSERT INTO public.task_methodology_heads(organisation_id,task_id,binding_id,context,pending_context_command,pending_context_at)
        SELECT organisation_id,task_id,id,document->'resolution'->'context',NULL,NULL FROM public.task_methodology_bindings
        WHERE organisation_id='org-b' AND task_id LIKE 'stopped-history-%'")
        .execute(&mut *fixture).await.unwrap();
    fixture.commit().await.unwrap();
    admin
        .execute("ANALYZE public.tasks; ANALYZE public.task_commands; ANALYZE public.task_events")
        .await
        .unwrap();

    let retained_facts: String = sqlx::query_scalar("SELECT md5(string_agg(cursor::text||':'||command_id,',' ORDER BY cursor)) FROM public.task_events WHERE kind='applied' AND command_id LIKE 'history-command-%'")
        .fetch_one(&mut *admin).await.unwrap();
    let mut accepted = Vec::new();
    for n in 0..65 {
        accepted.push(
            repository
                .admit(
                    "actor-b",
                    &scope,
                    &command(
                        &format!("pending-history-{n}"),
                        CommandKind::Guide,
                        &receipt,
                    ),
                )
                .await
                .unwrap(),
        );
    }
    let mut scoped = zobba_infrastructure::scope::begin(runtime, "actor-b", &scope)
        .await
        .unwrap();
    // Exact production predicates under the actual nonowner, forced-RLS role.
    // Do not force enable_seqscan off: the real planner must choose these bounds.
    let pending_plan: Vec<String> = sqlx::query_scalar("EXPLAIN (ANALYZE, BUFFERS) SELECT c.id,c.kind,c.content,c.cycle_id,c.intent_revision,c.received_cursor FROM public.task_commands c WHERE c.task_id=$1 AND c.received_cursor>$2 ORDER BY c.received_cursor LIMIT $3")
        .bind(&receipt.task_id).bind(start+2*HISTORY-1).bind(32_i64).fetch_all(&mut *scoped).await.unwrap();
    assert_eq!(
        index_rows(&pending_plan, "task_commands_pending"),
        32.0,
        "pending work scanned applied history instead of the next bounded batch"
    );
    assert!(
        pending_plan
            .iter()
            .any(|line| line.contains("Index Cond:") && line.contains("received_cursor >")),
        "application cursor is not an index predicate: {pending_plan:?}"
    );
    assert!(
        !pending_plan
            .iter()
            .any(|line| line.contains("task_events") || line.contains("Anti Join")),
        "pending lookup still rescans applied facts: {pending_plan:?}"
    );
    let open_plan: Vec<String> = sqlx::query_scalar(
        "EXPLAIN (ANALYZE, BUFFERS) SELECT count(*) FROM public.tasks WHERE state <> 'stopped'",
    )
    .fetch_all(&mut *scoped)
    .await
    .unwrap();
    assert_eq!(
        index_rows(&open_plan, "tasks_open_scope"),
        2.0,
        "open-task admission scanned retained stopped work or foreign scopes"
    );
    scoped.commit().await.unwrap();

    for (batch, expected) in [32_usize, 64, 65].into_iter().enumerate() {
        assert_eq!(
            repository
                .coordinate(&route, "history-worker")
                .await
                .unwrap(),
            Decision::Idle
        );
        let (cursor, applied): (i64, i64) = sqlx::query_as("SELECT applied_command_cursor,(SELECT count(*) FROM public.task_events e WHERE e.task_id=t.id AND e.kind='applied' AND e.command_id=ANY($2)) FROM public.tasks t WHERE id=$1")
            .bind(&receipt.task_id).bind(accepted.iter().map(|receipt| receipt.command_id.clone()).collect::<Vec<_>>()).fetch_one(&mut *admin).await.unwrap();
        assert_eq!(
            applied, expected as i64,
            "batch {batch} exceeded or lost the bounded application window"
        );
        assert_eq!(
            cursor.to_string(),
            accepted[expected - 1].event_cursor,
            "application cursor did not atomically follow the last Applied command"
        );
    }
    assert_eq!(
        repository
            .coordinate(&route, "history-worker")
            .await
            .unwrap(),
        Decision::Idle
    );
    let applied_order: Vec<String> = sqlx::query_scalar("SELECT command_id FROM public.task_events WHERE kind='applied' AND command_id=ANY($1) ORDER BY cursor")
        .bind(accepted.iter().map(|receipt| receipt.command_id.clone()).collect::<Vec<_>>()).fetch_all(&mut *admin).await.unwrap();
    assert_eq!(
        applied_order,
        accepted
            .iter()
            .map(|receipt| receipt.command_id.clone())
            .collect::<Vec<_>>(),
        "new commands were not Applied exactly once in Received order"
    );
    let after_facts: String = sqlx::query_scalar("SELECT md5(string_agg(cursor::text||':'||command_id,',' ORDER BY cursor)) FROM public.task_events WHERE kind='applied' AND command_id LIKE 'history-command-%'")
        .fetch_one(&mut *admin).await.unwrap();
    assert_eq!(
        after_facts, retained_facts,
        "application rewrote retained Applied history"
    );
    let now = repository
        .get("actor-b", &scope, &receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        now.state,
        TaskState::Paused,
        "retained/new guidance restarted a paused Task"
    );
    assert_eq!(now.working_brief, "Retained guidance pending-history-64");
    repository
        .admit(
            "actor-b",
            &scope,
            &create(
                "after-large-stopped-history",
                "New open work remains admissible",
            ),
        )
        .await
        .unwrap();
    let continuation = TaskCommand {
        context: None,
        key: "continue-large-stopped-history".into(),
        kind: CommandKind::Continue,
        task_id: Some("stopped-history-1".into()),
        cycle_id: Some("stopped-cycle-1".into()),
        content: None,
    };
    let continued = repository
        .admit("actor-b", &scope, &continuation)
        .await
        .unwrap();
    assert_ne!(continued.cycle_id, "stopped-cycle-1");
    let open: i64 = sqlx::query_scalar("SELECT count(*) FROM public.tasks WHERE organisation_id='org-b' AND client_id='client-b' AND engagement_id='engagement-b' AND state<>'stopped'")
        .fetch_one(&mut *admin).await.unwrap();
    assert_eq!(
        open, 4,
        "Create/Continue counted retained stopped history as open"
    );
}

#[tokio::test]
async fn durable_task_commands_and_fencing_contract() {
    let config = Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    seed_local_configured("https://127.0.0.1:4443", &config.migration)
        .await
        .unwrap();
    let mut admin = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut admin).await;
    let concurrent_pool = pool(&config, 4).await;
    let repository = TaskRepository::new(concurrent_pool.clone());
    admission_atomicity(&config, &mut admin, &repository).await;
    let a = selected("a");
    let b = selected("b");

    let original = create("identical", "Original objective remains exact");
    let mut requests = Vec::new();
    for _ in 0..12 {
        let repo = repository.clone();
        let input = original.clone();
        requests.push(tokio::spawn(async move {
            repo.admit("actor-a", &selected("a"), &input).await
        }));
    }
    let receipt = requests.remove(0).await.unwrap().unwrap();
    for request in requests {
        assert_eq!(request.await.unwrap().unwrap(), receipt);
    }
    assert_eq!(receipt.status, ReceiptStatus::Received);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM public.task_commands WHERE author_id='actor-a' AND idempotency_key='identical'").fetch_one(&mut admin).await.unwrap();
    assert_eq!(
        count, 1,
        "concurrent identical commands duplicated acceptance"
    );
    let before_context_conflict = durable_state(&mut admin).await;
    let mut changed_context = original.clone();
    changed_context.context = Some(zobba_domain::methodology::TaskContext {
        audit_area: Some("revenue".into()),
        period_start: Some("2025-01-01".into()),
        period_end: Some("2025-12-31".into()),
    });
    assert_eq!(
        repository.admit("actor-a", &a, &changed_context).await,
        Err(TaskError::Conflict),
        "changed audit context under an accepted key must not rebind the Task"
    );
    assert_eq!(durable_state(&mut admin).await, before_context_conflict);
    let changed_left = create("changed-race", "Left meaning");
    let changed_right = create("changed-race", "Right meaning");
    let (left, right) = tokio::join!(
        repository.admit("actor-a", &a, &changed_left),
        repository.admit("actor-a", &a, &changed_right)
    );
    assert_eq!(usize::from(left.is_ok()) + usize::from(right.is_ok()), 1);
    assert!(matches!(
        (&left, &right),
        (Ok(_), Err(TaskError::Conflict)) | (Err(TaskError::Conflict), Ok(_))
    ));
    let other_author = repository
        .admit("actor-manager", &a, &original)
        .await
        .unwrap();
    let foreign = repository.admit("actor-b", &b, &original).await.unwrap();
    assert_ne!(other_author.command_id, receipt.command_id);
    assert_ne!(foreign.command_id, receipt.command_id);
    dispatch_boundary(&concurrent_pool, &mut admin, &receipt, &foreign).await;
    for (actor, scope) in [("actor-b", &a), ("actor-admin", &a), ("actor-a", &b)] {
        assert_eq!(
            repository.admit(actor, scope, &original).await,
            Err(TaskError::Denied)
        );
        assert_eq!(
            repository.get(actor, scope, &receipt.task_id).await,
            Err(TaskError::Denied)
        );
    }
    assert_eq!(
        repository.get("actor-b", &b, &receipt.task_id).await,
        Err(TaskError::Denied)
    );
    let mut guessed = a.clone();
    guessed.engagement_id = "guessed".into();
    assert_eq!(
        repository.events("actor-a", &guessed, 0).await,
        Err(TaskError::Denied)
    );
    let mut missing = a.clone();
    missing.client_id.clear();
    assert_eq!(
        repository.admit("actor-a", &missing, &original).await,
        Err(TaskError::Denied)
    );

    let dispatcher = Dispatcher::new(concurrent_pool.clone());
    assert_eq!(
        TaskDelivery::take(&dispatcher, 0, "worker-a").await,
        Err(TaskError::Unavailable)
    );
    assert_eq!(
        dispatcher.take(9, "worker-a").await,
        Err(TaskError::Unavailable)
    );
    let (routes_left, routes_right) = tokio::join!(
        dispatcher.take(8, "delivery-left"),
        dispatcher.take(8, "delivery-right")
    );
    let routes_left = routes_left.unwrap();
    let routes_right = routes_right.unwrap();
    assert!(
        routes_left
            .iter()
            .all(|left| routes_right.iter().all(|right| left.id != right.id)),
        "delivery lease duplicated a live delivery"
    );
    let route = routes_left
        .iter()
        .chain(routes_right.iter())
        .find(|route| route.task_id == receipt.task_id)
        .unwrap()
        .clone();
    // A perpetually due old delivery must not starve newly accepted work.
    // Choose explicit timestamps, never generated ID ordering, to distinguish
    // delivery fairness from the earlier availability of the retried route.
    let never_delivered = repository
        .admit(
            "actor-a",
            &a,
            &create("fairness-new", "New work must receive bounded delivery"),
        )
        .await
        .unwrap();
    sqlx::query("UPDATE public.task_deliveries SET delivery_until=clock_timestamp()+interval '10 minutes' WHERE wakeup_id<>$1")
        .bind(&never_delivered.task_id).execute(&mut admin).await.unwrap();
    sqlx::query("UPDATE public.task_wakeups SET available_at=clock_timestamp()-interval '2 minutes' WHERE id=$1")
        .bind(&route.id).execute(&mut admin).await.unwrap();
    sqlx::query("UPDATE public.task_deliveries SET delivery_until=clock_timestamp()-interval '1 second' WHERE wakeup_id=$1")
        .bind(&route.id).execute(&mut admin).await.unwrap();
    sqlx::query("UPDATE public.task_wakeups SET available_at=clock_timestamp()-interval '1 minute' WHERE id=$1")
        .bind(&never_delivered.task_id).execute(&mut admin).await.unwrap();
    let first_delivery = dispatcher.take(1, "fairness-worker").await.unwrap();
    assert_eq!(first_delivery.len(), 1);
    assert_eq!(
        first_delivery[0].task_id, never_delivered.task_id,
        "an earlier retried route starved never-delivered work"
    );
    let retry_delivery = dispatcher.take(1, "fairness-worker").await.unwrap();
    assert_eq!(retry_delivery.len(), 1);
    assert_eq!(
        retry_delivery[0].id, route.id,
        "fair delivery lost the older due work"
    );
    // No local child exists after this consumed claim. Reentering the
    // coordinator under the SAME still-live owner must expose uncertainty now.
    let lost_route = &first_delivery[0];
    let lost_basis = executed(
        repository
            .coordinate(lost_route, "lost-runner")
            .await
            .unwrap(),
    );
    let lost_attempt = repository.consume(&lost_basis).await.unwrap();
    assert!(repository.current(&lost_basis).await.unwrap());
    assert_eq!(
        repository
            .coordinate(lost_route, "lost-runner")
            .await
            .unwrap(),
        Decision::Waiting
    );
    let lost = repository
        .get("actor-a", &a, &lost_basis.task_id)
        .await
        .unwrap();
    assert_eq!(
        (lost.state, lost.cessation),
        (TaskState::Waiting, Cessation::ReconciliationRequired)
    );
    repository
        .observe(&lost_attempt, Observation::NotStarted)
        .await
        .unwrap();
    assert_eq!(
        repository
            .coordinate(lost_route, "lost-runner")
            .await
            .unwrap(),
        Decision::Idle
    );

    // The actual concurrent Guide/consume order may choose either winner, but
    // neither winner permits the old basis to dispatch under the new intent.
    let race_route = routes_left
        .iter()
        .chain(routes_right.iter())
        .find(|candidate| candidate.task_id == other_author.task_id)
        .unwrap();
    let race_basis = executed(
        repository
            .coordinate(race_route, "race-worker")
            .await
            .unwrap(),
    );
    let racing_guidance = command("concurrent-guide", CommandKind::Guide, &other_author);
    let (consumption, guidance) = tokio::join!(
        repository.consume(&race_basis),
        repository.admit("actor-a", &a, &racing_guidance)
    );
    guidance.unwrap();
    let raced: (String, i64) =
        sqlx::query_as("SELECT state,intent_revision FROM public.task_claims WHERE id=$1")
            .bind(&race_basis.claim_id)
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert_eq!(raced.1, race_basis.intent_revision);
    match consumption {
        Ok(consumed) => {
            assert_eq!(raced.0, "consumed");
            // Story 22.2: guidance never cancels consumed in-flight work. It is
            // applied at the next work boundary; only Pause/Stop or ownership
            // loss end continuation. Admission still requires the new intent.
            assert!(repository.current(&race_basis).await.unwrap());
            repository
                .observe(&consumed, Observation::NotStarted)
                .await
                .unwrap();
        }
        Err(TaskError::Fenced) => assert_eq!(raced.0, "abandoned"),
        Err(error) => panic!("unexpected Guide/consume race error: {error}"),
    }
    assert!(matches!(
        repository.consume(&race_basis).await,
        Err(TaskError::Fenced)
    ));
    let after_race = executed(
        repository
            .coordinate(race_route, "race-worker")
            .await
            .unwrap(),
    );
    assert_eq!(after_race.owner_epoch, race_basis.owner_epoch);
    assert!(after_race.intent_revision > race_basis.intent_revision);

    let (left, right) = tokio::join!(
        repository.coordinate(&route, "worker-left"),
        repository.coordinate(&route, "worker-right")
    );
    let first_claim = match (left.unwrap(), right.unwrap()) {
        (Decision::Execute(basis), Decision::Idle) | (Decision::Idle, Decision::Execute(basis)) => {
            *basis
        }
        other => panic!("competing workers did not select one owner: {other:?}"),
    };
    let worker = first_claim.worker_id.clone();
    assert_eq!(
        repository.admit("actor-a", &a, &original).await.unwrap(),
        receipt,
        "Applied changed the original Received receipt"
    );
    assert_eq!(
        repository
            .events("actor-a", &a, 0)
            .await
            .unwrap()
            .iter()
            .filter(
                |event| event.command_id.as_deref() == Some(receipt.command_id.as_str())
                    && event.kind == "applied"
            )
            .count(),
        1
    );

    // Same owner, newer intent: the old admitted claim cannot cross consumption.
    let guidance = command("guide-before-consume", CommandKind::Guide, &receipt);
    let guide_receipt = repository.admit("actor-a", &a, &guidance).await.unwrap();
    let after_guide = repository
        .get("actor-a", &a, &receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        after_guide.working_brief,
        original.content.as_deref().unwrap()
    );
    assert!(matches!(
        repository.consume(&first_claim).await,
        Err(TaskError::Fenced)
    ));
    let current_claim = executed(repository.coordinate(&route, &worker).await.unwrap());
    assert_eq!(current_claim.owner_epoch, first_claim.owner_epoch);
    assert!(current_claim.intent_revision > first_claim.intent_revision);
    assert_eq!(
        repository
            .get("actor-a", &a, &receipt.task_id)
            .await
            .unwrap()
            .working_brief,
        guidance.content.as_deref().unwrap()
    );
    assert_eq!(
        repository.admit("actor-a", &a, &guidance).await.unwrap(),
        guide_receipt
    );
    let mut changed_target = guidance.clone();
    changed_target.task_id = Some(other_author.task_id.clone());
    changed_target.cycle_id = Some(other_author.cycle_id.clone());
    assert_eq!(
        repository.admit("actor-a", &a, &changed_target).await,
        Err(TaskError::Conflict)
    );
    let mut forged = current_claim.clone();
    forged.process_instance = "another-process".into();
    assert!(matches!(
        repository.consume(&forged).await,
        Err(TaskError::Fenced)
    ));
    let (first_consumption, second_consumption) = tokio::join!(
        repository.consume(&current_claim),
        repository.consume(&current_claim)
    );
    let attempt = match (first_consumption, second_consumption) {
        (Ok(attempt), Err(TaskError::Fenced)) | (Err(TaskError::Fenced), Ok(attempt)) => attempt,
        _ => panic!("concurrent one-use consumption did not admit exactly one attempt"),
    };
    assert!(
        matches!(
            repository.consume(&current_claim).await,
            Err(TaskError::Fenced)
        ),
        "one-use claim consumed twice"
    );
    assert!(repository.current(&current_claim).await.unwrap());
    let stored_digest: String = sqlx::query_scalar(
        "SELECT capability_hash FROM public.task_receipt_slots WHERE claim_id=$1",
    )
    .bind(&current_claim.claim_id)
    .fetch_one(&mut admin)
    .await
    .unwrap();
    assert!(
        stored_digest.len() == 64 && stored_digest != attempt.receipt_capability,
        "receipt capability stored in plaintext"
    );
    let mut never_read_slot = zobba_infrastructure::scope::begin(&concurrent_pool, "actor-a", &a)
        .await
        .unwrap();
    let slots: i64 = sqlx::query_scalar("SELECT count(*) FROM public.task_receipt_slots")
        .fetch_one(&mut *never_read_slot)
        .await
        .unwrap();
    assert_eq!(
        slots, 0,
        "ordinary Task authority disclosed receipt capabilities"
    );
    never_read_slot.commit().await.unwrap();

    let consumed_guidance = command("guide-after-consume", CommandKind::Guide, &receipt);
    repository
        .admit("actor-a", &a, &consumed_guidance)
        .await
        .unwrap();
    // Guidance is received at once but does not cancel the consumed attempt.
    assert!(repository.current(&current_claim).await.unwrap());
    let stop = command("stop-consumed", CommandKind::Stop, &receipt);
    let stop_receipt = repository.admit("actor-a", &a, &stop).await.unwrap();
    let stopped = repository
        .get("actor-a", &a, &receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        (stopped.state, stopped.cessation),
        (TaskState::Stopped, Cessation::Pending)
    );
    assert!(stopped.execution_epoch > current_claim.execution_epoch as u64);
    // Only a control (execution epoch) ends continuation.
    assert!(!repository.current(&current_claim).await.unwrap());
    let continuation = command("continue", CommandKind::Continue, &receipt);
    assert_eq!(
        repository.admit("actor-a", &a, &continuation).await,
        Err(TaskError::Conflict)
    );
    sqlx::query(
        "UPDATE public.tasks SET owner_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    )
    .bind(&receipt.task_id)
    .execute(&mut admin)
    .await
    .unwrap();
    assert_eq!(
        repository.coordinate(&route, "replacement").await.unwrap(),
        Decision::Waiting
    );
    let uncertain = repository
        .get("actor-a", &a, &receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        (uncertain.state, uncertain.cessation),
        (TaskState::Stopped, Cessation::ReconciliationRequired)
    );
    let retained: (String, i64) =
        sqlx::query_as("SELECT state,intent_revision FROM public.task_claims WHERE id=$1")
            .bind(&current_claim.claim_id)
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert_eq!(retained, ("consumed".into(), current_claim.intent_revision));
    assert!(matches!(
        repository.consume(&current_claim).await,
        Err(TaskError::Fenced)
    ));
    // Pool1 below makes reset assertions prove exact physical reuse on all paths.
    concurrent_pool.close().await;
    let single_pool = pool(&config, 1).await;
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&single_pool)
        .await
        .unwrap();
    let repository = TaskRepository::new(single_pool.clone());
    clean(&single_pool, pid).await;
    admin.execute("UPDATE public.organisation_memberships SET active=false WHERE organisation_id='org-a' AND actor_id='actor-a'").await.unwrap();
    assert_eq!(
        repository.admit("actor-a", &a, &original).await,
        Err(TaskError::Denied)
    );
    assert_eq!(
        repository.get("actor-a", &a, &receipt.task_id).await,
        Err(TaskError::Denied)
    );
    assert_eq!(
        repository.events("actor-a", &a, 0).await,
        Err(TaskError::Denied)
    );
    assert_eq!(
        repository.coordinate(&route, "replacement").await,
        Err(TaskError::Denied)
    );
    assert!(matches!(
        repository.consume(&current_claim).await,
        Err(TaskError::Denied)
    ));
    assert_eq!(
        repository.current(&current_claim).await,
        Err(TaskError::Denied)
    );
    clean(&single_pool, pid).await;
    for bad in ["capability", "scope", "process", "claim"] {
        let mut refused = ConsumedAttempt {
            basis: attempt.basis.clone(),
            receipt_capability: attempt.receipt_capability.clone(),
        };
        match bad {
            "capability" => refused.receipt_capability = "0".repeat(64),
            "scope" => refused.basis.scope = b.clone(),
            "process" => refused.basis.process_instance = "wrong-process".into(),
            "claim" => refused.basis.claim_id = "wrong-claim".into(),
            _ => unreachable!(),
        }
        assert_eq!(
            repository.observe(&refused, Observation::NotStarted).await,
            Err(TaskError::Denied)
        );
        clean(&single_pool, pid).await;
    }
    // This test never spawned activity. The exact producer can record that fact
    // after Stop, expiry and revocation, without seeing or changing Task state.
    repository
        .observe(&attempt, Observation::NotStarted)
        .await
        .unwrap();
    clean(&single_pool, pid).await;
    repository
        .observe(&attempt, Observation::NotStarted)
        .await
        .unwrap();
    assert_eq!(
        repository.observe(&attempt, Observation::Completed).await,
        Err(TaskError::Conflict)
    );
    clean(&single_pool, pid).await;
    let mut receipt_context =
        zobba_infrastructure::scope::begin_actor(&single_pool, "receipt-test")
            .await
            .unwrap();
    let capability_hash: String = Sha256::digest(attempt.receipt_capability.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    sqlx::query("SELECT set_config('zobba.actor_id','',true),set_config('zobba.receipt_claim',$1,true),set_config('zobba.receipt_hash',$2,true),set_config('zobba.receipt_org',$3,true),set_config('zobba.receipt_client',$4,true),set_config('zobba.receipt_engagement',$5,true)")
        .bind(&attempt.basis.claim_id).bind(capability_hash).bind(&a.organisation_id).bind(&a.client_id).bind(&a.engagement_id).execute(&mut *receipt_context).await.unwrap();
    for table in ["tasks", "task_commands", "task_events", "task_claims"] {
        let exposed: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
            .fetch_one(&mut *receipt_context)
            .await
            .unwrap();
        assert_eq!(
            exposed, 0,
            "exact receipt capability exposed protected {table}"
        );
    }
    let exposed_facts: i64 = sqlx::query_scalar("SELECT count(*) FROM public.task_observations")
        .fetch_one(&mut *receipt_context)
        .await
        .unwrap();
    assert_eq!(
        exposed_facts, 1,
        "receipt context could not read its exact immutable fact"
    );
    assert_eq!(
        sqlx::query("UPDATE public.tasks SET state='ready' WHERE id=$1")
            .bind(&receipt.task_id)
            .execute(&mut *receipt_context)
            .await
            .unwrap()
            .rows_affected(),
        0,
        "receipt capability advanced Task state"
    );
    receipt_context.rollback().await.unwrap();
    clean(&single_pool, pid).await;
    let fact_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.task_observations WHERE claim_id=$1")
            .bind(&current_claim.claim_id)
            .fetch_one(&mut admin)
            .await
            .unwrap();
    assert_eq!(fact_count, 1);
    let unchanged: String = sqlx::query_scalar("SELECT cessation FROM public.tasks WHERE id=$1")
        .bind(&receipt.task_id)
        .fetch_one(&mut admin)
        .await
        .unwrap();
    assert_eq!(
        unchanged, "reconciliation_required",
        "receipt-only transaction advanced Task authority"
    );
    assert!(
        sqlx::query("UPDATE public.task_observations SET outcome='completed'")
            .execute(&single_pool)
            .await
            .is_err()
    );
    clean(&single_pool, pid).await;
    let dispatcher = Dispatcher::new(single_pool.clone());
    // Expire delivery leases by database time; discovery remains content-free.
    admin
        .execute(
            "UPDATE public.task_deliveries SET delivery_until=clock_timestamp()-interval '1 second'",
        )
        .await
        .unwrap();
    let routes = dispatcher.take(8, "discovery").await.unwrap();
    let denied_route = routes
        .iter()
        .find(|candidate| candidate.task_id == receipt.task_id)
        .unwrap();
    assert_eq!(
        repository.coordinate(denied_route, "discovery").await,
        Err(TaskError::Denied)
    );
    dispatcher.release(denied_route, "discovery").await.unwrap();
    clean(&single_pool, pid).await;

    admin.execute("UPDATE public.organisation_memberships SET active=true WHERE organisation_id='org-a' AND actor_id='actor-a'").await.unwrap();
    assert_eq!(
        repository.coordinate(&route, "replacement").await.unwrap(),
        Decision::Idle
    );
    let confirmed = repository
        .get("actor-a", &a, &receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        (confirmed.state, confirmed.cessation),
        (TaskState::Stopped, Cessation::Confirmed)
    );
    let stopped_guidance = command("retained-while-stopped", CommandKind::Guide, &receipt);
    repository
        .admit("actor-a", &a, &stopped_guidance)
        .await
        .unwrap();
    assert_eq!(
        repository.coordinate(&route, "replacement").await.unwrap(),
        Decision::Idle
    );
    let retained = repository
        .get("actor-a", &a, &receipt.task_id)
        .await
        .unwrap();
    assert_eq!(retained.state, TaskState::Stopped);
    assert_eq!(
        retained.working_brief,
        stopped_guidance.content.as_deref().unwrap()
    );
    let next_cycle = repository
        .admit("actor-a", &a, &continuation)
        .await
        .unwrap();
    assert_ne!(next_cycle.cycle_id, receipt.cycle_id);
    let stale_stop = command("stale-cycle-stop", CommandKind::Stop, &receipt);
    assert_eq!(
        repository.admit("actor-a", &a, &stale_stop).await,
        Err(TaskError::Conflict)
    );
    assert_eq!(
        repository.admit("actor-a", &a, &stop).await.unwrap(),
        stop_receipt,
        "old immutable receipt was lost after continuation"
    );
    assert_eq!(
        repository
            .get("actor-a", &a, &receipt.task_id)
            .await
            .unwrap()
            .state,
        TaskState::Ready
    );
    let pause = command("pause-new-cycle", CommandKind::Pause, &next_cycle);
    repository.admit("actor-a", &a, &pause).await.unwrap();
    let paused_guidance = command("retained-while-paused", CommandKind::Guide, &next_cycle);
    repository
        .admit("actor-a", &a, &paused_guidance)
        .await
        .unwrap();
    assert_eq!(
        repository.coordinate(&route, "replacement").await.unwrap(),
        Decision::Idle
    );
    assert_eq!(
        repository
            .get("actor-a", &a, &receipt.task_id)
            .await
            .unwrap()
            .state,
        TaskState::Paused
    );
    let resumed = repository
        .admit(
            "actor-a",
            &a,
            &command("explicit-resume", CommandKind::Resume, &next_cycle),
        )
        .await
        .unwrap();
    assert_eq!(resumed.cycle_id, next_cycle.cycle_id);
    assert!(matches!(
        repository.consume(&current_claim).await,
        Err(TaskError::Fenced)
    ));
    assert_eq!(
        repository
            .events("actor-a", &a, 0)
            .await
            .unwrap()
            .iter()
            .filter(|event| event.task_id == receipt.task_id && event.kind == "observed")
            .count(),
        1
    );
    clean(&single_pool, pid).await;

    // Bound real admission and projection, including a full engagement of work.
    let initial = repository
        .list("actor-a", &a, None)
        .await
        .unwrap()
        .tasks
        .len();
    for index in initial..100 {
        repository
            .admit(
                "actor-a",
                &a,
                &create(&format!("capacity-{index}"), "Bounded additional objective"),
            )
            .await
            .unwrap();
    }
    assert_eq!(
        repository
            .admit("actor-a", &a, &create("capacity-overflow", "Must not fit"))
            .await,
        Err(TaskError::Capacity)
    );
    assert_eq!(
        repository
            .list("actor-a", &a, None)
            .await
            .unwrap()
            .tasks
            .len(),
        100
    );
    let full = repository.list("actor-a", &a, None).await.unwrap();
    assert!(full.next_cursor.is_none());
    // Historical stopped Tasks remain discoverable beyond the active-work cap.
    for (index, task) in full.tasks.iter().take(5).enumerate() {
        let stop = TaskCommand {
            context: None,
            key: format!("history-stop-{index}"),
            kind: CommandKind::Stop,
            task_id: Some(task.id.clone()),
            cycle_id: Some(task.cycle_id.clone()),
            content: None,
        };
        repository.admit("actor-a", &a, &stop).await.unwrap();
        repository
            .admit(
                "actor-a",
                &a,
                &create(
                    &format!("history-new-{index}"),
                    "Additional cycle-independent objective",
                ),
            )
            .await
            .unwrap();
    }
    let stopped_at_capacity = &full.tasks[0];
    let blocked_continuation = TaskCommand {
        context: None,
        key: "capacity-continue".into(),
        kind: CommandKind::Continue,
        task_id: Some(stopped_at_capacity.id.clone()),
        cycle_id: Some(stopped_at_capacity.cycle_id.clone()),
        content: None,
    };
    assert_eq!(
        repository.admit("actor-a", &a, &blocked_continuation).await,
        Err(TaskError::Capacity),
        "Continue bypassed the 100 active Task bound"
    );
    assert_eq!(
        repository
            .get("actor-a", &a, &stopped_at_capacity.id)
            .await
            .unwrap()
            .state,
        TaskState::Stopped,
        "refused continuation revived stopped work"
    );
    let first_tasks = repository.list("actor-a", &a, None).await.unwrap();
    assert_eq!(first_tasks.tasks.len(), 100);
    let next = first_tasks
        .next_cursor
        .as_deref()
        .expect("history was silently truncated");
    assert_eq!(next, first_tasks.tasks.last().unwrap().id);
    let remaining = repository.list("actor-a", &a, Some(next)).await.unwrap();
    assert_eq!(remaining.tasks.len(), 5);
    assert!(remaining.next_cursor.is_none());
    assert!(remaining.tasks.iter().all(|task| task.id.as_str() > next));
    let beyond_first_page = remaining.tasks.last().unwrap();
    assert_eq!(
        repository
            .get("actor-a", &a, &beyond_first_page.id)
            .await
            .unwrap(),
        *beyond_first_page
    );
    assert_eq!(
        repository.list("actor-a", &a, Some("bad cursor")).await,
        Err(TaskError::Invalid)
    );
    let first_page = repository.events("actor-a", &a, 0).await.unwrap();
    assert_eq!(first_page.len(), 100);
    let last = first_page.last().unwrap().cursor.parse::<u64>().unwrap();
    let second_page = repository.events("actor-a", &a, last).await.unwrap();
    assert!(!second_page.is_empty());
    assert!(
        second_page
            .iter()
            .all(|event| event.cursor.parse::<u64>().unwrap() > last)
    );
    clean(&single_pool, pid).await;
    retained_history_contract(&config, &mut admin, &repository, &single_pool).await;
    single_pool.close().await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    methodology_cutoff::verify(&config).await;
}
