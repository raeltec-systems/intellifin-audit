//! Real PostgreSQL Admin/session fences and immutable methodology configuration.
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use zobba_application::{
    methodology::*,
    task::{TaskCommands, TaskError},
};
use zobba_domain::{
    identity::Scope,
    task::{CommandKind, Decision, TaskCommand, WakeupRoute},
};
use zobba_infrastructure::{
    database_options,
    fixture::seed_local_configured,
    identity::{IdentityRepository, secret_hash},
    methodology::MethodologyRepository,
    migrate,
    task::TaskRepository,
};
mod support;
const ISSUER: &str = "https://127.0.0.1:4443";
fn save(key: &str, revision: u64) -> SaveMethodology {
    serde_json::from_value(serde_json::json!({"key":key,"expected_revision":revision,"supersedes":null,"undo_of":null,
 "assignment":{"kind":"firm","client_id":null,"engagement_id":null},"applicability":{"audit_area":null,"period_start":null,"period_end":null},
 "activation":{"mode":"new_tasks","available_at":0},"definition":{"name":"Firm requirements","neutral_starter":false,"default_context":{"audit_area":"Revenue","period_start":"2026-01-01","period_end":"2026-12-31"},"templates":[{"id":"workpaper","version":"v1","name":"Revenue workpaper","sections":[{"id":"basis","title":"Basis","content":"Procedure\nEvidence\nConclusion","required":true}]}],
 "requirements":[{"id":"revenue","label":"Revenue","mandatory":true,"criteria":["Obtain supporting evidence"],"populations":null,"evidence_checks":null,"ratings":null,"templates":[{"id":"workpaper","version":"v1"}],"review_rules":["Review supporting evidence"],"suitable_skills":null}]},
 "source":{"kind":"authored","reference":null,"note":"Synthetic fixture"}})).unwrap()
}
fn replacement_save(key: &str, revision: u64) -> SaveMethodology {
    let mut command = save(key, revision);
    command.definition.templates[0].version = "v2".into();
    command.definition.requirements[0]
        .templates
        .as_mut()
        .unwrap()[0]
        .version = "v2".into();
    command
}
fn selected() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}
async fn wait_blocked(observer: &mut PgConnection, count: i64) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let waiting:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity a WHERE a.datname=current_database() AND a.application_name='methodology-contract' AND a.state='active' AND cardinality(pg_blocking_pids(a.pid))>0").fetch_one(&mut *observer).await.unwrap();
        if waiting >= count {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "expected {count} blocked methodology requests, saw {waiting}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}
#[tokio::test]
async fn postgres_methodology_contract() {
    let config = support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&config.migration).await.unwrap();
    config.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migrate(
        &config.migration,
        database_options(&config.runtime).unwrap().get_username(),
    )
    .await
    .unwrap();
    seed_local_configured(ISSUER, &config.migration)
        .await
        .unwrap();
    let pool = PgPoolOptions::new()
        .max_connections(6)
        .connect_with(
            database_options(&config.runtime)
                .unwrap()
                .application_name("methodology-contract"),
        )
        .await
        .unwrap();
    let mut observer = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut observer).await;
    let identities = IdentityRepository::new(pool.clone());
    let admin_token = identities
        .establish_session(ISSUER, "admin-only", "Admin", None)
        .await
        .unwrap();
    let auditor_token = identities
        .establish_session(ISSUER, "auditor-a", "Auditor", None)
        .await
        .unwrap();
    let manager_token = identities
        .establish_session(ISSUER, "manager-a", "Manager", None)
        .await
        .unwrap();
    let repo =
        MethodologyRepository::new(pool.clone()).with_session_hash(secret_hash(&admin_token));
    let auditor =
        MethodologyRepository::new(pool.clone()).with_session_hash(secret_hash(&auditor_token));
    let manager =
        MethodologyRepository::new(pool.clone()).with_session_hash(secret_hash(&manager_token));
    assert_eq!(
        repo.snapshot("actor-admin", "org-a")
            .await
            .unwrap()
            .revision,
        0
    );
    assert_eq!(
        repo.snapshot("actor-admin", "org-b").await,
        Err(MethodologyError::Denied)
    );
    assert_eq!(
        auditor.snapshot("actor-a", "org-a").await,
        Err(MethodologyError::Denied)
    );
    for table in [
        "methodology_versions",
        "methodology_assignments",
        "methodology_events",
        "methodology_recalls",
        "task_methodology_bindings",
        "task_methodology_heads",
        "task_methodology_changes",
    ] {
        assert!(
            sqlx::query(&format!("SELECT * FROM public.{table}"))
                .execute(&pool)
                .await
                .is_err()
        );
        assert!(
            sqlx::query(&format!("DELETE FROM public.{table}"))
                .execute(&pool)
                .await
                .is_err()
        );
    }
    let first = save("first", 0);
    let receipt = repo.save("actor-admin", "org-a", &first).await.unwrap();
    assert_eq!(receipt.revision, 1);
    assert_eq!(
        repo.save("actor-admin", "org-a", &first).await.unwrap(),
        receipt
    );
    let before = repo.snapshot("actor-admin", "org-a").await.unwrap();
    let mut changed = first.clone();
    changed.definition.name = "Different meaning".into();
    assert_eq!(
        repo.save("actor-admin", "org-a", &changed).await,
        Err(MethodologyError::Conflict)
    );
    let stale = save("stale", 0);
    assert_eq!(
        repo.save("actor-admin", "org-a", &stale).await,
        Err(MethodologyError::Conflict)
    );
    let mut invalid = save("invalid", 1);
    invalid.assignment = AssignmentScope {
        kind: AssignmentKind::Client,
        client_id: Some("foreign-client".into()),
        engagement_id: None,
    };
    assert_eq!(
        repo.save("actor-admin", "org-a", &invalid).await,
        Err(MethodologyError::Invalid)
    );
    let mut reused_template = save("reused-template-version", 1);
    reused_template.supersedes = Some(receipt.version_id.clone());
    reused_template.definition.templates[0].sections[0].content =
        "Changed content under the old version".into();
    assert_eq!(
        repo.save("actor-admin", "org-a", &reused_template).await,
        Err(MethodologyError::Invalid)
    );
    let mut missing_template = save("missing-template-version", 1);
    missing_template.definition.requirements[0]
        .templates
        .as_mut()
        .unwrap()[0]
        .version = "missing".into();
    assert_eq!(
        repo.save("actor-admin", "org-a", &missing_template).await,
        Err(MethodologyError::Invalid)
    );
    let mut dates = save("changed-dates", 1);
    dates.supersedes = Some(receipt.version_id.clone());
    dates.applicability = Applicability {
        audit_area: None,
        period_start: Some("2025-01-01".into()),
        period_end: Some("2025-12-31".into()),
    };
    assert_eq!(
        repo.save("actor-admin", "org-a", &dates).await,
        Err(MethodologyError::Invalid),
        "a supersession cannot silently remove historical applicability"
    );
    assert_eq!(repo.snapshot("actor-admin", "org-a").await.unwrap(), before);
    let tasks = TaskRepository::new(pool.clone());
    let s = selected();
    let command = TaskCommand {
        key: "create-method-task".into(),
        kind: CommandKind::Create,
        task_id: None,
        cycle_id: None,
        content: Some("Inspect a methodology basis".into()),
        context: None,
    };
    let task = tasks.admit("actor-a", &s, &command).await.unwrap();
    let basis = auditor
        .task_basis("actor-a", &s, &task.task_id)
        .await
        .unwrap();
    assert_eq!(basis.current.execution_epoch, 1);
    assert_eq!(
        basis.current.resolution.version_ids,
        vec![receipt.version_id.clone()]
    );
    assert_eq!(
        basis.current.resolution.context.audit_area.as_deref(),
        Some("Revenue")
    );
    assert_eq!(
        basis.current.resolution.requirements[0]
            .requirement
            .criteria
            .as_ref()
            .unwrap(),
        &["Obtain supporting evidence"]
    );
    assert_eq!(
        basis.current.resolution.templates[0].template.sections[0].content,
        "Procedure\nEvidence\nConclusion"
    );
    assert_eq!(
        repo.task_basis("actor-admin", &s, &task.task_id).await,
        Err(MethodologyError::Denied)
    );
    // Concurrent global revisions: exactly one Admin Save wins, irrespective of scope.
    let mut left = save("left", 1);
    left.supersedes = Some(receipt.version_id.clone());
    left.definition.name = "Version left".into();
    let mut right = save("right", 1);
    right.supersedes = Some(receipt.version_id.clone());
    right.definition.name = "Version right".into();
    let (left_result, right_result) = tokio::join!(
        repo.save("actor-admin", "org-a", &left),
        manager.save("actor-manager", "org-a", &right)
    );
    assert_eq!(
        usize::from(left_result.is_ok()) + usize::from(right_result.is_ok()),
        1
    );
    let winner = left_result.or(right_result).unwrap();
    let after = auditor
        .task_basis("actor-a", &s, &task.task_id)
        .await
        .unwrap();
    assert_eq!(after.current, basis.current);
    assert!(after.pending.is_none());
    assert_eq!(after.notices.len(), 1);
    assert_eq!(after.notices[0].impact.retained_tasks, 1);
    // Undo is a new attributable successor; original bytes remain immutable.
    let mut undo = save("undo", 2);
    undo.supersedes = Some(winner.version_id);
    undo.undo_of = Some(receipt.version_id.clone());
    let undone = repo.save("actor-admin", "org-a", &undo).await.unwrap();
    assert_eq!(undone.revision, 3);
    let all = repo.snapshot("actor-admin", "org-a").await.unwrap();
    assert_eq!(all.versions.len(), 3);
    assert_eq!(all.versions[0].command, first);
    // Current recall overlays pinning without rewriting the immutable original basis.
    let recall = RecallMethodology {
        key: "recall".into(),
        expected_revision: 3,
        version_id: receipt.version_id.clone(),
        reason: "Faulty original criteria".into(),
    };
    let recalled = repo.recall("actor-admin", "org-a", &recall).await.unwrap();
    assert_eq!(
        repo.recall("actor-admin", "org-a", &recall).await.unwrap(),
        recalled
    );
    let after = auditor
        .task_basis("actor-a", &s, &task.task_id)
        .await
        .unwrap();
    assert!(after.recalled);
    assert_eq!(after.current, basis.current);
    assert!(after.pending.is_some());
    // Both serialisation orders of Save versus Create produce one complete basis.
    let mut prior = undone.version_id;
    let mut capacity_task = String::new();
    for (index, save_first) in [false, true].into_iter().enumerate() {
        let mut update = replacement_save(&format!("race-save-{index}"), 4 + index as u64);
        update.supersedes = Some(prior.clone());
        update.definition.name = format!("Race successor {index}");
        let create = TaskCommand {
            key: format!("race-create-{index}"),
            kind: CommandKind::Create,
            task_id: None,
            cycle_id: None,
            content: Some("Atomic race basis".into()),
            context: None,
        };
        let mut blocker = owner.begin().await.unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
            .execute(&mut *blocker)
            .await
            .unwrap();
        let first_repo = repo.clone();
        let first_tasks = tasks.clone();
        let scope = s.clone();
        let (saved, created) = if save_first {
            let saved =
                tokio::spawn(async move { first_repo.save("actor-admin", "org-a", &update).await });
            wait_blocked(&mut observer, 1).await;
            let created =
                tokio::spawn(async move { first_tasks.admit("actor-a", &scope, &create).await });
            (saved, created)
        } else {
            let created =
                tokio::spawn(async move { first_tasks.admit("actor-a", &scope, &create).await });
            wait_blocked(&mut observer, 1).await;
            let saved =
                tokio::spawn(async move { first_repo.save("actor-admin", "org-a", &update).await });
            (saved, created)
        };
        wait_blocked(&mut observer, 2).await;
        blocker.commit().await.unwrap();
        let saved = saved.await.unwrap().unwrap();
        let created = created.await.unwrap().unwrap();
        let race_basis = auditor
            .task_basis("actor-a", &s, &created.task_id)
            .await
            .unwrap();
        assert_eq!(
            race_basis.current.resolution.version_ids,
            vec![if save_first {
                saved.version_id.clone()
            } else {
                prior
            }]
        );
        capacity_task = created.task_id;
        prior = saved.version_id;
    }
    // A Save queued before logout must recheck exactly that session after the lock.
    let mut blocker = owner.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
        .execute(&mut *blocker)
        .await
        .unwrap();
    let queued_repo = repo.clone();
    let queued = tokio::spawn(async move {
        queued_repo
            .save("actor-admin", "org-a", &replacement_save("queued", 6))
            .await
    });
    wait_blocked(&mut observer, 1).await;
    identities.logout(&admin_token).await.unwrap();
    blocker.commit().await.unwrap();
    assert_eq!(queued.await.unwrap(), Err(MethodologyError::Denied));
    assert_eq!(
        manager
            .snapshot("actor-manager", "org-a")
            .await
            .unwrap()
            .revision,
        6
    );
    assert_eq!(
        repo.save("actor-admin", "org-a", &first).await,
        Err(MethodologyError::Denied),
        "even exact retries require current session authority"
    );
    // Opposite session order: once Save holds the exact session row, logout
    // waits for that accepted transaction and cannot erase the committed receipt.
    let renewed = identities
        .establish_session(ISSUER, "admin-only", "Admin", None)
        .await
        .unwrap();
    let mut accepted = zobba_infrastructure::scope::begin_actor(&pool, "actor-admin")
        .await
        .unwrap();
    let mut final_save = replacement_save("save-before-logout", 6);
    final_save.supersedes = Some(prior.clone());
    let value: serde_json::Value =
        sqlx::query_scalar("SELECT public.methodology_write($1,$2,$3,$4,$5,$6,$7)")
            .bind("actor-admin")
            .bind(secret_hash(&renewed))
            .bind("org-a")
            .bind("save")
            .bind(serde_json::to_value(final_save).unwrap())
            .bind("accepted-session-event")
            .bind("accepted-session-version")
            .fetch_one(&mut *accepted)
            .await
            .unwrap();
    assert_eq!(value["revision"], 7);
    let logout = tokio::spawn(async move { identities.logout(&renewed).await });
    wait_blocked(&mut observer, 1).await;
    accepted.commit().await.unwrap();
    logout.await.unwrap().unwrap();
    assert_eq!(
        manager
            .snapshot("actor-manager", "org-a")
            .await
            .unwrap()
            .revision,
        7
    );
    // Membership revocation that wins the organisation lock also defeats a
    // previously authenticated Save, with another continuity Admin retained.
    let revoked_token = IdentityRepository::new(pool.clone())
        .establish_session(ISSUER, "admin-only", "Admin", None)
        .await
        .unwrap();
    let revoked_repo =
        MethodologyRepository::new(pool.clone()).with_session_hash(secret_hash(&revoked_token));
    let mut narrowing = owner.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
        .execute(&mut *narrowing)
        .await
        .unwrap();
    sqlx::query("UPDATE public.organisation_memberships SET active=false WHERE organisation_id='org-a' AND actor_id='actor-admin'").execute(&mut *narrowing).await.unwrap();
    let refused = tokio::spawn(async move {
        revoked_repo
            .save(
                "actor-admin",
                "org-a",
                &replacement_save("revoked-admin", 7),
            )
            .await
    });
    wait_blocked(&mut observer, 1).await;
    narrowing.commit().await.unwrap();
    assert_eq!(refused.await.unwrap(), Err(MethodologyError::Denied));
    assert_eq!(
        manager
            .snapshot("actor-manager", "org-a")
            .await
            .unwrap()
            .revision,
        7
    );
    // Configuration capacity may refuse further Saves, never a safety recall.
    let mut revision = 7;
    let initial_count = manager
        .snapshot("actor-manager", "org-a")
        .await
        .unwrap()
        .versions
        .len();
    for index in initial_count..128 {
        let receipt = manager
            .save(
                "actor-manager",
                "org-a",
                &replacement_save(&format!("capacity-{index}"), revision),
            )
            .await
            .unwrap();
        revision = receipt.revision;
    }
    assert_eq!(
        manager
            .save(
                "actor-manager",
                "org-a",
                &replacement_save("at-capacity", revision)
            )
            .await,
        Err(MethodologyError::Capacity)
    );
    let before = auditor
        .task_basis("actor-a", &s, &capacity_task)
        .await
        .unwrap();
    let recall_at_capacity = RecallMethodology {
        key: "recall-at-capacity".into(),
        expected_revision: revision,
        version_id: prior,
        reason: "Safety restriction remains available at capacity".into(),
    };
    manager
        .recall("actor-manager", "org-a", &recall_at_capacity)
        .await
        .unwrap();
    let after = auditor
        .task_basis("actor-a", &s, &capacity_task)
        .await
        .unwrap();
    assert!(after.recalled);
    assert_eq!(before.current, after.current);
    assert_eq!(before.history, after.history);
    // Activating a successor of a scheduled version retires the entire
    // superseded ancestry; Save time does not leave the old ancestor competing.
    let foreign_identities = IdentityRepository::new(pool.clone());
    let foreign_admin = foreign_identities
        .establish_session(ISSUER, "admin-b-only", "Foreign admin", None)
        .await
        .unwrap();
    let foreign_auditor = foreign_identities
        .establish_session(ISSUER, "auditor-b", "Foreign auditor", None)
        .await
        .unwrap();
    let foreign_repo =
        MethodologyRepository::new(pool.clone()).with_session_hash(secret_hash(&foreign_admin));
    let foreign_read =
        MethodologyRepository::new(pool.clone()).with_session_hash(secret_hash(&foreign_auditor));
    let ancestor = foreign_repo
        .save("actor-admin-b", "org-b", &save("ancestor", 0))
        .await
        .unwrap();
    let mut scheduled = save("scheduled-successor", 1);
    scheduled.supersedes = Some(ancestor.version_id);
    scheduled.activation.available_at = sqlx::query_scalar::<_, i64>(
        "SELECT floor(extract(epoch FROM clock_timestamp()))::bigint+3600",
    )
    .fetch_one(&mut owner)
    .await
    .unwrap();
    let scheduled = foreign_repo
        .save("actor-admin-b", "org-b", &scheduled)
        .await
        .unwrap();
    let mut immediate = save("immediate-descendant", 2);
    immediate.supersedes = Some(scheduled.version_id);
    let descendant = foreign_repo
        .save("actor-admin-b", "org-b", &immediate)
        .await
        .unwrap();
    let foreign_scope = Scope {
        organisation_id: "org-b".into(),
        client_id: "client-b".into(),
        engagement_id: "engagement-b".into(),
    };
    let created = tasks
        .admit(
            "actor-b",
            &foreign_scope,
            &TaskCommand {
                key: "ancestry-create".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Inspect availability ancestry".into()),
                context: None,
            },
        )
        .await
        .unwrap();
    let basis = foreign_read
        .task_basis("actor-b", &foreign_scope, &created.task_id)
        .await
        .unwrap();
    assert_eq!(basis.current.resolution.status, ResolutionStatus::Resolved);
    assert_eq!(
        basis.current.resolution.version_ids,
        vec![descendant.version_id.clone()]
    );
    // Equal wall-clock timestamps cannot confuse producing-basis attribution.
    // These are real immutable bind/apply writes; SQL, not the supplied JSON,
    // assigns their effective Task epochs under the ordinary organisation lock.
    let mut bind_tx = zobba_infrastructure::scope::begin(&pool, "actor-b", &foreign_scope)
        .await
        .unwrap();
    bind_tx.execute("SELECT pg_advisory_xact_lock(hashtextextended('org-b',205)); SELECT id FROM public.engagements WHERE organisation_id='org-b' AND client_id='client-b' AND id='engagement-b' FOR UPDATE;").await.unwrap();
    bind_tx.execute("INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation) VALUES('org-b','client-b','engagement-b','same-second-task','same-second-cycle','actor-b','Test producing association','Test producing association','ready','none'); INSERT INTO public.task_cycles VALUES('org-b','client-b','engagement-b','same-second-task','same-second-cycle','active');").await.unwrap();
    let first_binding = Binding {
        context_command_id: None,
        id: "same-second-original".into(),
        candidate_version_ids: basis.current.candidate_version_ids.clone(),
        execution_epoch: 999,
        bound_at: 1700000000,
        actor_id: "actor-b".into(),
        resolution: basis.current.resolution.clone(),
    };
    sqlx::query("SELECT public.methodology_task('same-second-task','bind',$1)")
        .bind(serde_json::json!({"binding":first_binding,"context":TaskContext::default()}))
        .execute(&mut *bind_tx)
        .await
        .unwrap();
    bind_tx.commit().await.unwrap();
    let mut active = save("same-second-active", 3);
    active.supersedes = Some(descendant.version_id);
    active.activation.mode = ActivationMode::ActiveTasks;
    active.definition.name = "Explicit active successor".into();
    foreign_repo
        .save("actor-admin-b", "org-b", &active)
        .await
        .unwrap();
    let config_version = foreign_repo
        .snapshot("actor-admin-b", "org-b")
        .await
        .unwrap()
        .versions
        .pop()
        .unwrap();
    let resolved = zobba_domain::methodology::resolve(
        &[config_version.candidate()],
        &foreign_scope,
        &basis.current.resolution.context.to_domain(),
        i64::MAX,
    );
    let second_binding = Binding {
        context_command_id: None,
        id: "same-second-successor".into(),
        candidate_version_ids: vec![config_version.id.clone()],
        execution_epoch: 999,
        bound_at: first_binding.bound_at,
        actor_id: "actor-admin-b".into(),
        resolution: resolved.into(),
    };
    let mut apply_tx = zobba_infrastructure::scope::begin(&pool, "actor-b", &foreign_scope)
        .await
        .unwrap();
    apply_tx.execute("SELECT pg_advisory_xact_lock(hashtextextended('org-b',205)); SELECT id FROM public.engagements WHERE organisation_id='org-b' AND client_id='client-b' AND id='engagement-b' FOR UPDATE; UPDATE public.tasks SET execution_epoch=7 WHERE id='same-second-task';").await.unwrap();
    let applied: serde_json::Value =
        sqlx::query_scalar("SELECT public.methodology_task('same-second-task','apply',$1)")
            .bind(serde_json::to_value(second_binding).unwrap())
            .fetch_one(&mut *apply_tx)
            .await
            .unwrap();
    assert_eq!(applied, true);
    for (epoch, expected) in [
        (1, "same-second-original"),
        (3, "same-second-original"),
        (7, "same-second-original"),
        (8, "same-second-successor"),
    ] {
        let actual: serde_json::Value =
            sqlx::query_scalar("SELECT public.methodology_task('same-second-task','basis',$1)")
                .bind(serde_json::json!({"execution_epoch":epoch}))
                .fetch_one(&mut *apply_tx)
                .await
                .unwrap();
        assert_eq!(actual, expected);
    }
    apply_tx.commit().await.unwrap();
    let associated = foreign_read
        .task_basis("actor-b", &foreign_scope, "same-second-task")
        .await
        .unwrap();
    assert_eq!(associated.history[0].bound_at, associated.current.bound_at);
    assert_eq!(associated.history[0].execution_epoch, 1);
    assert_eq!(associated.current.execution_epoch, 8);
    // A Missing conditional candidate remains pinned through unrelated active
    // edits, then contributes its mandatory fields when defaults resolve context.
    let mut seed = owner.begin().await.unwrap();
    seed.execute("INSERT INTO public.organisations VALUES('org-context','Context organisation'); INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-context','actor-manager',ARRAY['admin','auditor']); INSERT INTO public.clients VALUES('org-context','client-context','Context client'); INSERT INTO public.engagements VALUES('org-context','client-context','engagement-context','Context engagement'); INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-context','client-context','engagement-context','actor-manager');").await.unwrap();
    seed.commit().await.unwrap();
    let context_scope = Scope {
        organisation_id: "org-context".into(),
        client_id: "client-context".into(),
        engagement_id: "engagement-context".into(),
    };
    let mut conditional = save("conditional-missing", 0);
    conditional.applicability.audit_area = Some("Inventory".into());
    conditional.definition.default_context = TaskContext::default();
    let conditional = manager
        .save("actor-manager", "org-context", &conditional)
        .await
        .unwrap();
    let no_context = tasks
        .admit(
            "actor-manager",
            &context_scope,
            &TaskCommand {
                key: "missing-context-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Resolve conditional requirements explicitly".into()),
                context: None,
            },
        )
        .await
        .unwrap();
    let missing = manager
        .task_basis("actor-manager", &context_scope, &no_context.task_id)
        .await
        .unwrap();
    assert_eq!(
        missing.current.resolution.status,
        ResolutionStatus::Incomplete
    );
    assert!(missing.current.resolution.version_ids.is_empty());
    assert_eq!(
        missing.current.candidate_version_ids,
        vec![conditional.version_id.clone()]
    );
    let mut narrow = save("active-default-context", 1);
    narrow.assignment = AssignmentScope {
        kind: AssignmentKind::Engagement,
        client_id: Some(context_scope.client_id.clone()),
        engagement_id: Some(context_scope.engagement_id.clone()),
    };
    narrow.definition.default_context.audit_area = Some("Inventory".into());
    narrow.definition.requirements[0].id = "engagement-extra".into();
    narrow.activation.mode = ActivationMode::ActiveTasks;
    let narrow_receipt = manager
        .save("actor-manager", "org-context", &narrow)
        .await
        .unwrap();
    let route = WakeupRoute {
        id: no_context.task_id.clone(),
        actor_id: "actor-manager".into(),
        scope: context_scope.clone(),
        task_id: no_context.task_id.clone(),
    };
    tasks.coordinate(&route, "context-worker").await.unwrap();
    let resolved = manager
        .task_basis("actor-manager", &context_scope, &no_context.task_id)
        .await
        .unwrap();
    assert_eq!(
        resolved.current.resolution.status,
        ResolutionStatus::Resolved
    );
    assert!(
        resolved
            .current
            .resolution
            .version_ids
            .contains(&conditional.version_id)
    );
    assert!(
        resolved
            .current
            .resolution
            .version_ids
            .contains(&narrow_receipt.version_id)
    );
    assert_eq!(resolved.current.resolution.requirements.len(), 2);
    // A Task created between a future active Save and its cutoff joins the
    // durable cohort and wakes a fresh coordinator, including while paused.
    let mut future = narrow.clone();
    future.key = "future-created-cohort".into();
    future.expected_revision = 2;
    future.supersedes = Some(narrow_receipt.version_id.clone());
    future.activation.available_at = sqlx::query_scalar::<_, i64>(
        "SELECT floor(extract(epoch FROM clock_timestamp()))::bigint+2",
    )
    .fetch_one(&mut owner)
    .await
    .unwrap();
    let future_receipt = manager
        .save("actor-manager", "org-context", &future)
        .await
        .unwrap();
    let cohort = tasks
        .admit(
            "actor-manager",
            &context_scope,
            &TaskCommand {
                key: "created-after-scheduled-save".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Apply scheduled firm methodology".into()),
                context: None,
            },
        )
        .await
        .unwrap();
    let original = manager
        .task_basis("actor-manager", &context_scope, &cohort.task_id)
        .await
        .unwrap();
    assert!(original.pending.is_some());
    assert!(
        original
            .current
            .resolution
            .version_ids
            .contains(&narrow_receipt.version_id)
    );
    assert!(
        !original
            .current
            .candidate_version_ids
            .contains(&future_receipt.version_id)
    );
    tasks
        .admit(
            "actor-manager",
            &context_scope,
            &TaskCommand {
                key: "pause-cohort".into(),
                kind: CommandKind::Pause,
                task_id: Some(cohort.task_id.clone()),
                cycle_id: Some(cohort.cycle_id.clone()),
                content: None,
                context: None,
            },
        )
        .await
        .unwrap();
    let route = WakeupRoute {
        id: cohort.task_id.clone(),
        actor_id: "actor-manager".into(),
        scope: context_scope.clone(),
        task_id: cohort.task_id.clone(),
    };
    assert_eq!(
        tasks.coordinate(&route, "cohort-worker").await.unwrap(),
        Decision::Idle
    );
    let wake:bool=sqlx::query_scalar("SELECT pending AND available_at=to_timestamp($2::bigint) FROM public.task_wakeups WHERE task_id=$1").bind(&cohort.task_id).bind(future.activation.available_at).fetch_one(&mut owner).await.unwrap();
    assert!(wake);
    tokio::time::timeout(std::time::Duration::from_secs(6), async {
        loop {
            let due: bool =
                sqlx::query_scalar("SELECT clock_timestamp()>=to_timestamp($1::bigint)")
                    .bind(future.activation.available_at)
                    .fetch_one(&mut owner)
                    .await
                    .unwrap();
            if due {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await
        }
    })
    .await
    .unwrap();
    assert_eq!(
        TaskRepository::new(pool.clone())
            .coordinate(&route, "cohort-worker")
            .await
            .unwrap(),
        Decision::Idle
    );
    let activated = manager
        .task_basis("actor-manager", &context_scope, &cohort.task_id)
        .await
        .unwrap();
    assert!(
        activated
            .current
            .resolution
            .version_ids
            .contains(&future_receipt.version_id)
    );
    assert!(
        !activated
            .current
            .resolution
            .version_ids
            .contains(&narrow_receipt.version_id)
    );
    assert!(activated.pending.is_none());
    assert!(activated.current.execution_epoch > original.current.execution_epoch);
    // The resolver and cohort share one captured availability instant even
    // when the bind statement executes after the scheduled cutoff.
    let captured_at = future.activation.available_at - 1;
    let mut crossed = zobba_infrastructure::scope::begin(&pool, "actor-manager", &context_scope)
        .await
        .unwrap();
    crossed.execute("SELECT pg_advisory_xact_lock(hashtextextended('org-context',205)); SELECT id FROM public.engagements WHERE organisation_id='org-context' AND client_id='client-context' AND id='engagement-context' FOR UPDATE").await.unwrap();
    let available:serde_json::Value=sqlx::query_scalar("SELECT public.methodology_candidates('org-context','client-context','engagement-context',$1)").bind(captured_at).fetch_one(&mut *crossed).await.unwrap();
    let available: Vec<VersionRecord> = serde_json::from_value(available).unwrap();
    let candidates: Vec<_> = available.iter().map(VersionRecord::candidate).collect();
    let original_resolution: Resolution = zobba_domain::methodology::resolve(
        &candidates,
        &context_scope,
        &zobba_domain::methodology::TaskContext::default(),
        captured_at,
    )
    .into();
    assert!(
        original_resolution
            .version_ids
            .contains(&narrow_receipt.version_id)
    );
    assert!(
        !original_resolution
            .version_ids
            .contains(&future_receipt.version_id)
    );
    let original_pool = candidates
        .iter()
        .filter(|candidate| candidate.available_at <= captured_at)
        .map(|candidate| candidate.version_id.clone())
        .collect();
    let old_instant = Binding {
        context_command_id: None,
        id: "crossed-cutoff-binding".into(),
        execution_epoch: 999,
        candidate_version_ids: original_pool,
        bound_at: captured_at,
        actor_id: "actor-manager".into(),
        resolution: original_resolution,
    };
    crossed.execute("INSERT INTO public.tasks(organisation_id,client_id,engagement_id,id,cycle_id,accountable_actor,objective,working_brief,state,cessation) VALUES('org-context','client-context','engagement-context','crossed-cutoff-task','crossed-cutoff-cycle','actor-manager','Cutoff capture fixture','Cutoff capture fixture','ready','none'); INSERT INTO public.task_cycles VALUES('org-context','client-context','engagement-context','crossed-cutoff-task','crossed-cutoff-cycle','active')").await.unwrap();
    sqlx::query("SELECT public.methodology_task('crossed-cutoff-task','bind',$1)")
        .bind(serde_json::json!({"binding":old_instant,"context":TaskContext::default()}))
        .execute(&mut *crossed)
        .await
        .unwrap();
    let allowed: serde_json::Value =
        sqlx::query_scalar("SELECT public.methodology_task('crossed-cutoff-task','allowed',NULL)")
            .fetch_one(&mut *crossed)
            .await
            .unwrap();
    assert_eq!(
        allowed, false,
        "crossing cutoff cannot leave stale unused work admissible"
    );
    crossed.commit().await.unwrap();
    let crossed_basis = manager
        .task_basis("actor-manager", &context_scope, "crossed-cutoff-task")
        .await
        .unwrap();
    assert!(
        crossed_basis
            .pending
            .unwrap()
            .resolution
            .version_ids
            .contains(&future_receipt.version_id)
    );
    // Configuration assignment selectors fail explicitly at their documented
    // bounded capacity; they never silently omit an engagement.
    owner.execute("INSERT INTO public.engagements SELECT 'org-context','client-context','extra-'||n::text,'Extra '||n::text FROM generate_series(1,512) AS values(n)").await.unwrap();
    assert_eq!(
        manager.snapshot("actor-manager", "org-context").await,
        Err(MethodologyError::Capacity)
    );
    // Neutral bindings still consume history bytes even though the organisation
    // has no saved version documents. Seed complete immutable neutral history
    // near the cap, then prove a refused Guide cannot leave accepted intent or
    // a pending context that will fail forever at its safe boundary.
    let mut seed = owner.begin().await.unwrap();
    seed.execute("INSERT INTO public.organisations VALUES('org-neutral-capacity','Neutral history capacity'); INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-neutral-capacity','actor-manager',ARRAY['admin','auditor']); INSERT INTO public.clients VALUES('org-neutral-capacity','client-neutral-capacity','Neutral client'); INSERT INTO public.engagements VALUES('org-neutral-capacity','client-neutral-capacity','engagement-neutral-capacity','Neutral engagement'); INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-neutral-capacity','client-neutral-capacity','engagement-neutral-capacity','actor-manager')").await.unwrap();
    seed.commit().await.unwrap();
    let neutral_scope = Scope {
        organisation_id: "org-neutral-capacity".into(),
        client_id: "client-neutral-capacity".into(),
        engagement_id: "engagement-neutral-capacity".into(),
    };
    let neutral = tasks
        .admit(
            "actor-manager",
            &neutral_scope,
            &TaskCommand {
                key: "neutral-history-capacity".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Inspect neutral methodology capacity".into()),
                context: None,
            },
        )
        .await
        .unwrap();
    let mut seed = owner.begin().await.unwrap();
    // Each fixture row has the exact valid neutral resolution, fresh immutable
    // identity and increasing producing epoch. No padding or malformed JSON is
    // used to reach the real byte budget.
    sqlx::query(r#"WITH original AS (
        SELECT b.*,octet_length(b.document::text) AS original_bytes FROM public.task_methodology_bindings b WHERE b.task_id=$1
       ), candidates AS (
        SELECT original.*,jsonb_set(jsonb_set(document,'{id}',to_jsonb('neutral-capacity-'||lpad(n::text,6,'0'))),'{execution_epoch}',to_jsonb(n+1)) AS next_document,n
        FROM original CROSS JOIN generate_series(1,2000) AS values(n)
       ), sized AS (
        SELECT *,original_bytes+sum(octet_length(next_document::text)) OVER(ORDER BY n) AS history_bytes FROM candidates
       ) INSERT INTO public.task_methodology_bindings(organisation_id,client_id,engagement_id,task_id,id,document)
        SELECT organisation_id,client_id,engagement_id,task_id,next_document->>'id',next_document FROM sized WHERE history_bytes<=1048576"#)
        .bind(&neutral.task_id).execute(&mut *seed).await.unwrap();
    sqlx::query("UPDATE public.task_methodology_heads h SET binding_id=(SELECT b.id FROM public.task_methodology_bindings b WHERE b.task_id=h.task_id ORDER BY (b.document->>'execution_epoch')::bigint DESC LIMIT 1) WHERE h.task_id=$1")
        .bind(&neutral.task_id).execute(&mut *seed).await.unwrap();
    sqlx::query("UPDATE public.tasks t SET execution_epoch=(SELECT (b.document->>'execution_epoch')::bigint FROM public.task_methodology_heads h JOIN public.task_methodology_bindings b ON (b.organisation_id,b.task_id,b.id)=(h.organisation_id,h.task_id,h.binding_id) WHERE h.task_id=t.id) WHERE t.id=$1")
        .bind(&neutral.task_id).execute(&mut *seed).await.unwrap();
    let remaining:i64=sqlx::query_scalar("SELECT 1048576-sum(octet_length(document::text))::bigint FROM public.task_methodology_bindings WHERE task_id=$1")
        .bind(&neutral.task_id).fetch_one(&mut *seed).await.unwrap();
    let next_size:i32=sqlx::query_scalar("SELECT octet_length(b.document::text) FROM public.task_methodology_heads h JOIN public.task_methodology_bindings b ON (b.organisation_id,b.task_id,b.id)=(h.organisation_id,h.task_id,h.binding_id) WHERE h.task_id=$1")
        .bind(&neutral.task_id).fetch_one(&mut *seed).await.unwrap();
    assert!(remaining >= 0 && remaining < i64::from(next_size));
    seed.commit().await.unwrap();
    assert!(
        manager
            .snapshot("actor-manager", "org-neutral-capacity")
            .await
            .unwrap()
            .versions
            .is_empty()
    );
    let state_sql = r#"SELECT jsonb_build_object(
        'task',(SELECT to_jsonb(t) FROM public.tasks t WHERE id=$1),
        'head',(SELECT to_jsonb(h) FROM public.task_methodology_heads h WHERE task_id=$1),
        'commands',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.task_commands c WHERE task_id=$1),
        'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.cursor) FROM public.task_events e WHERE task_id=$1),
        'changes',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.event_id) FROM public.task_methodology_changes c WHERE task_id=$1),
        'bindings',(SELECT md5(string_agg(document::text,'' ORDER BY id)) FROM public.task_methodology_bindings WHERE task_id=$1),
        'counter',(SELECT to_jsonb(c) FROM public.task_counters c WHERE organisation_id='org-neutral-capacity'),
        'wakeup',(SELECT to_jsonb(w) FROM public.task_wakeups w WHERE task_id=$1))"#;
    let before: serde_json::Value = sqlx::query_scalar(state_sql)
        .bind(&neutral.task_id)
        .fetch_one(&mut owner)
        .await
        .unwrap();
    let guide = TaskCommand {
        key: "refuse-unreserved-neutral-guide".into(),
        kind: CommandKind::Guide,
        task_id: Some(neutral.task_id.clone()),
        cycle_id: Some(neutral.cycle_id.clone()),
        content: Some("Supply an explicit area near history capacity".into()),
        context: Some(zobba_domain::methodology::TaskContext {
            audit_area: Some("Inventory".into()),
            period_start: Some("2025-01-01".into()),
            period_end: Some("2025-12-31".into()),
        }),
    };
    for _ in 0..2 {
        assert_eq!(
            tasks.admit("actor-manager", &neutral_scope, &guide).await,
            Err(TaskError::Capacity)
        );
        let after: serde_json::Value = sqlx::query_scalar(state_sql)
            .bind(&neutral.task_id)
            .fetch_one(&mut owner)
            .await
            .unwrap();
        assert_eq!(
            before, after,
            "capacity refusal must roll back intent, command, pending context and all Task effects"
        );
    }
    assert!(
        manager
            .task_basis("actor-manager", &neutral_scope, &neutral.task_id)
            .await
            .unwrap()
            .pending
            .is_none()
    );
    assert!(
        matches!(
            tasks
                .coordinate(
                    &WakeupRoute {
                        id: neutral.task_id.clone(),
                        actor_id: "actor-manager".into(),
                        scope: neutral_scope,
                        task_id: neutral.task_id,
                    },
                    "neutral-capacity-worker"
                )
                .await
                .unwrap(),
            Decision::Execute(_)
        ),
        "the original neutral basis remains runnable after refusal"
    );
    review_continue_cohort(&mut owner, &pool, &manager).await;
    review_cutoff_and_historical_templates(&mut owner, &pool, &manager).await;
    pool.close().await;
}

async fn seed_review_scope(owner: &mut PgConnection, suffix: &str) -> Scope {
    let scope = Scope {
        organisation_id: format!("org-{suffix}"),
        client_id: format!("client-{suffix}"),
        engagement_id: format!("engagement-{suffix}"),
    };
    let mut tx = owner.begin().await.unwrap();
    sqlx::query("INSERT INTO public.organisations VALUES($1,'Review fixture')")
        .bind(&scope.organisation_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES($1,'actor-manager',ARRAY['admin','auditor'])").bind(&scope.organisation_id).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO public.clients VALUES($1,$2,'Review client')")
        .bind(&scope.organisation_id)
        .bind(&scope.client_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO public.engagements VALUES($1,$2,$3,'Review engagement')")
        .bind(&scope.organisation_id)
        .bind(&scope.client_id)
        .bind(&scope.engagement_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES($1,$2,$3,'actor-manager')").bind(&scope.organisation_id).bind(&scope.client_id).bind(&scope.engagement_id).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    scope
}
async fn wait_until_cutoff(owner: &mut PgConnection, cutoff: i64) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let reached: bool =
                sqlx::query_scalar("SELECT clock_timestamp()>=to_timestamp($1::bigint)")
                    .bind(cutoff)
                    .fetch_one(&mut *owner)
                    .await
                    .unwrap();
            if reached {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
async fn captured_review_binding(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    scope: &Scope,
    task: &str,
    at: i64,
    id: &str,
) -> Binding {
    let candidates: serde_json::Value =
        sqlx::query_scalar("SELECT public.methodology_task($1,'candidates',$2)")
            .bind(task)
            .bind(serde_json::json!({"at":at}))
            .fetch_one(&mut **tx)
            .await
            .unwrap();
    let candidates: Vec<VersionRecord> = serde_json::from_value(candidates).unwrap();
    let sources: serde_json::Value =
        sqlx::query_scalar("SELECT public.methodology_task($1,'templates',$2)")
            .bind(task)
            .bind(serde_json::json!({"at":at}))
            .fetch_one(&mut **tx)
            .await
            .unwrap();
    let sources: Vec<VersionRecord> = serde_json::from_value(sources).unwrap();
    Binding {
        context_command_id: None,
        id: id.into(),
        execution_epoch: 0,
        candidate_version_ids: candidates.iter().map(|v| v.id.clone()).collect(),
        bound_at: at,
        actor_id: "actor-manager".into(),
        resolution: zobba_domain::methodology::resolve_with_templates(
            &candidates
                .iter()
                .map(VersionRecord::candidate)
                .collect::<Vec<_>>(),
            &sources
                .iter()
                .map(VersionRecord::template_source)
                .collect::<Vec<_>>(),
            scope,
            &zobba_domain::methodology::TaskContext::default(),
            at,
        )
        .into(),
    }
}
async fn review_cutoff_and_historical_templates(
    owner: &mut PgConnection,
    pool: &PgPool,
    repo: &MethodologyRepository,
) {
    let tasks = TaskRepository::new(pool.clone());
    let scope = seed_review_scope(owner, "review-cutoff").await;
    let original = repo
        .save(
            "actor-manager",
            &scope.organisation_id,
            &save("cutoff-original", 0),
        )
        .await
        .unwrap();
    let created = tasks
        .admit(
            "actor-manager",
            &scope,
            &TaskCommand {
                key: "cutoff-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Prove exact resolution acknowledgement cutoff".into()),
                context: None,
            },
        )
        .await
        .unwrap();
    let mut first = save("cutoff-first", 1);
    first.supersedes = Some(original.version_id);
    first.activation.mode = ActivationMode::ActiveTasks;
    let first = repo
        .save("actor-manager", &scope.organisation_id, &first)
        .await
        .unwrap();
    let mut later = save("cutoff-later", 2);
    later.supersedes = Some(first.version_id.clone());
    later.activation.mode = ActivationMode::ActiveTasks;
    later.activation.available_at =
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint+2")
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    let later_receipt = repo
        .save("actor-manager", &scope.organisation_id, &later)
        .await
        .unwrap();
    let mut tx = zobba_infrastructure::scope::begin(pool, "actor-manager", &scope)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,205))")
        .bind(&scope.organisation_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    let at: i64 = sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert!(at < later.activation.available_at);
    let binding = captured_review_binding(
        &mut tx,
        &scope,
        &created.task_id,
        at,
        "cutoff-first-binding",
    )
    .await;
    assert_eq!(binding.resolution.version_ids, vec![first.version_id]);
    // The candidate query really executes before cutoff; the owned apply really
    // executes after it. A condition barrier replaces timing assumptions.
    wait_until_cutoff(owner, later.activation.available_at).await;
    let applied: serde_json::Value =
        sqlx::query_scalar("SELECT public.methodology_task($1,'apply',$2)")
            .bind(&created.task_id)
            .bind(serde_json::to_value(binding).unwrap())
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(applied, true);
    tx.commit().await.unwrap();
    let untouched:bool=sqlx::query_scalar("SELECT applied_binding_id IS NULL FROM public.task_methodology_changes WHERE task_id=$1 AND event_id=$2").bind(&created.task_id).bind(&later_receipt.event_id).fetch_one(&mut *owner).await.unwrap();
    assert!(
        untouched,
        "activation unincluded in the captured resolution must remain pending"
    );
    let mut wake_tx = zobba_infrastructure::scope::begin(pool, "actor-manager", &scope)
        .await
        .unwrap();
    let wake: serde_json::Value =
        sqlx::query_scalar("SELECT public.methodology_task($1,'next',NULL)")
            .bind(&created.task_id)
            .fetch_one(&mut *wake_tx)
            .await
            .unwrap();
    assert_eq!(
        wake, later.activation.available_at,
        "an activation that crossed the resolution cutoff retains an immediate due wake"
    );
    wake_tx.commit().await.unwrap();
    let pending = repo
        .task_basis("actor-manager", &scope, &created.task_id)
        .await
        .unwrap();
    assert_eq!(
        pending.pending.unwrap().resolution.version_ids,
        vec![later_receipt.version_id.clone()]
    );
    let route = WakeupRoute {
        id: created.task_id.clone(),
        actor_id: "actor-manager".into(),
        scope: scope.clone(),
        task_id: created.task_id.clone(),
    };
    assert!(matches!(
        tasks.coordinate(&route, "cutoff-worker").await.unwrap(),
        Decision::Execute(_)
    ));
    // Recall-only reconciliation must also acknowledge only its captured cutoff.
    // Abandon the unused claim through Pause so no consumed fact blocks this test.
    tasks
        .admit(
            "actor-manager",
            &scope,
            &TaskCommand {
                key: "pause-cutoff".into(),
                kind: CommandKind::Pause,
                task_id: Some(created.task_id.clone()),
                cycle_id: Some(created.cycle_id.clone()),
                content: None,
                context: None,
            },
        )
        .await
        .unwrap();
    let mut future = save("recall-cutoff-future", 3);
    future.supersedes = Some(later_receipt.version_id.clone());
    future.activation.mode = ActivationMode::ActiveTasks;
    future.activation.available_at =
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint+2")
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    let future_receipt = repo
        .save("actor-manager", &scope.organisation_id, &future)
        .await
        .unwrap();
    let recalled = repo
        .recall(
            "actor-manager",
            &scope.organisation_id,
            &RecallMethodology {
                key: "recall-cutoff".into(),
                expected_revision: 4,
                version_id: later_receipt.version_id,
                reason: "Recall-only cutoff regression".into(),
            },
        )
        .await
        .unwrap();
    let mut tx = zobba_infrastructure::scope::begin(pool, "actor-manager", &scope)
        .await
        .unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,205))")
        .bind(&scope.organisation_id)
        .execute(&mut *tx)
        .await
        .unwrap();
    let at: i64 = sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    assert!(at < future.activation.available_at);
    let binding = captured_review_binding(
        &mut tx,
        &scope,
        &created.task_id,
        at,
        "recall-cutoff-unused-binding",
    )
    .await;
    wait_until_cutoff(owner, future.activation.available_at).await;
    let applied: serde_json::Value =
        sqlx::query_scalar("SELECT public.methodology_task($1,'apply',$2)")
            .bind(&created.task_id)
            .bind(serde_json::to_value(binding).unwrap())
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(
        applied, false,
        "recall overlay preserves original producing binding"
    );
    tx.commit().await.unwrap();
    let acknowledgements:Vec<(String,bool)>=sqlx::query_as("SELECT event_id,applied_binding_id IS NOT NULL FROM public.task_methodology_changes WHERE task_id=$1 AND event_id IN ($2,$3) ORDER BY event_id").bind(&created.task_id).bind(&recalled.event_id).bind(&future_receipt.event_id).fetch_all(&mut *owner).await.unwrap();
    assert!(acknowledgements.contains(&(recalled.event_id, true)));
    assert!(acknowledgements.contains(&(future_receipt.event_id, false)));

    // A successor reuses an exact historical template without reimporting its
    // ancestor's requirements. The exact source remains attributable and recallable.
    let scope = seed_review_scope(owner, "review-templates").await;
    let original_command = save("historical-template-original", 0);
    let original = repo
        .save("actor-manager", &scope.organisation_id, &original_command)
        .await
        .unwrap();
    let mut successor = save("historical-template-successor", 1);
    successor.supersedes = Some(original.version_id.clone());
    successor.definition.templates.clear();
    successor.definition.requirements[0].criteria =
        Some(vec!["Use the successor's criterion".into()]);
    let successor_receipt = repo
        .save("actor-manager", &scope.organisation_id, &successor)
        .await
        .unwrap();
    let task = tasks
        .admit(
            "actor-manager",
            &scope,
            &TaskCommand {
                key: "historical-template-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Use an exact predecessor template".into()),
                context: None,
            },
        )
        .await
        .unwrap();
    let basis = repo
        .task_basis("actor-manager", &scope, &task.task_id)
        .await
        .unwrap();
    assert_eq!(basis.current.resolution.status, ResolutionStatus::Resolved);
    assert_eq!(
        basis.current.resolution.version_ids,
        vec![successor_receipt.version_id.clone()]
    );
    assert_eq!(
        basis.current.resolution.requirements[0]
            .requirement
            .criteria,
        Some(vec!["Use the successor's criterion".into()])
    );
    assert_eq!(
        basis.current.resolution.templates[0].source_version_id,
        original.version_id
    );
    assert_eq!(
        basis.current.resolution.templates[0].template,
        original_command.definition.templates[0]
    );
    let recalled = repo
        .recall(
            "actor-manager",
            &scope.organisation_id,
            &RecallMethodology {
                key: "historical-template-recall".into(),
                expected_revision: 2,
                version_id: original.version_id.clone(),
                reason: "Restrict the exact original template source".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(recalled.impact.affected_tasks, 1);
    let after = repo
        .task_basis("actor-manager", &scope, &task.task_id)
        .await
        .unwrap();
    assert!(after.recalled);
    assert_eq!(
        after.current, basis.current,
        "recall cannot rewrite historical content or attribution"
    );
    let mut tx = zobba_infrastructure::scope::begin(pool, "actor-manager", &scope)
        .await
        .unwrap();
    let allowed: serde_json::Value =
        sqlx::query_scalar("SELECT public.methodology_task($1,'allowed',NULL)")
            .bind(&task.task_id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(allowed, false);
    tx.commit().await.unwrap();
    let before = repo
        .snapshot("actor-manager", &scope.organisation_id)
        .await
        .unwrap();
    let mut duplicate = save("redeclare-recalled-template", 3);
    duplicate.supersedes = Some(successor_receipt.version_id);
    assert_eq!(
        repo.save("actor-manager", &scope.organisation_id, &duplicate)
            .await,
        Err(MethodologyError::Invalid)
    );
    assert_eq!(
        before,
        repo.snapshot("actor-manager", &scope.organisation_id)
            .await
            .unwrap()
    );
    let later = tasks
        .admit(
            "actor-manager",
            &scope,
            &TaskCommand {
                key: "recalled-historical-template-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Inspect a restricted historical template".into()),
                context: None,
            },
        )
        .await
        .unwrap();
    let later = repo
        .task_basis("actor-manager", &scope, &later.task_id)
        .await
        .unwrap();
    assert!(later.recalled);
    assert_eq!(later.current.resolution.status, ResolutionStatus::Recalled);
    assert_eq!(
        later.current.resolution.templates[0].source_version_id,
        original.version_id
    );
}

async fn review_continue_cohort(
    owner: &mut PgConnection,
    pool: &PgPool,
    repo: &MethodologyRepository,
) {
    let scope = seed_review_scope(owner, "review-continue").await;
    let tasks = TaskRepository::new(pool.clone());
    let original = repo
        .save(
            "actor-manager",
            &scope.organisation_id,
            &save("continue-original", 0),
        )
        .await
        .unwrap();
    let mut stopped = Vec::new();
    for key in ["continue-before-cutoff", "continue-after-cutoff"] {
        let task = tasks
            .admit(
                "actor-manager",
                &scope,
                &TaskCommand {
                    key: key.into(),
                    kind: CommandKind::Create,
                    task_id: None,
                    cycle_id: None,
                    content: Some("Continue preserves exact methodology cohort eligibility".into()),
                    context: None,
                },
            )
            .await
            .unwrap();
        let basis = repo
            .task_basis("actor-manager", &scope, &task.task_id)
            .await
            .unwrap();
        tasks
            .admit(
                "actor-manager",
                &scope,
                &TaskCommand {
                    key: format!("stop-{key}"),
                    kind: CommandKind::Stop,
                    task_id: Some(task.task_id.clone()),
                    cycle_id: Some(task.cycle_id.clone()),
                    content: None,
                    context: None,
                },
            )
            .await
            .unwrap();
        stopped.push((task, basis.current));
    }
    let mut future = save("continue-future-active", 1);
    future.supersedes = Some(original.version_id.clone());
    future.activation.mode = ActivationMode::ActiveTasks;
    future.activation.available_at =
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint+3")
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    let future_receipt = repo
        .save("actor-manager", &scope.organisation_id, &future)
        .await
        .unwrap();
    assert_eq!(
        future_receipt.impact.affected_tasks, 0,
        "both Tasks were stopped when the scheduled Save was admitted"
    );
    let mut new_only = save("continue-new-only-excluded", 2);
    new_only.assignment = AssignmentScope {
        kind: AssignmentKind::Client,
        client_id: Some(scope.client_id.clone()),
        engagement_id: None,
    };
    new_only.definition.requirements[0].id = "new-only-requirement".into();
    let new_only = repo
        .save("actor-manager", &scope.organisation_id, &new_only)
        .await
        .unwrap();
    // A later revision with a later cutoff must not hide the first future
    // activation in either inspection or the coordinator's captured read.
    let mut distant = save("continue-distant-active", 3);
    distant.activation.mode = ActivationMode::ActiveTasks;
    distant.activation.available_at = future.activation.available_at + 3600;
    distant.applicability.audit_area = Some("Inventory".into());
    let distant = repo
        .save("actor-manager", &scope.organisation_id, &distant)
        .await
        .unwrap();
    let early = &stopped[0];
    let command = TaskCommand {
        key: "continue-before-cutoff-command".into(),
        kind: CommandKind::Continue,
        task_id: Some(early.0.task_id.clone()),
        cycle_id: Some(early.0.cycle_id.clone()),
        content: None,
        context: None,
    };
    let admitted = tasks
        .admit("actor-manager", &scope, &command)
        .await
        .unwrap();
    assert_eq!(
        tasks
            .admit("actor-manager", &scope, &command)
            .await
            .unwrap(),
        admitted
    );
    let before = repo
        .task_basis("actor-manager", &scope, &early.0.task_id)
        .await
        .unwrap();
    assert_eq!(before.current, early.1);
    let pending = before.pending.unwrap();
    assert_eq!(
        pending.id, future_receipt.event_id,
        "earliest future activation must remain visible despite later revisions"
    );
    assert_eq!(
        pending.resolution.version_ids,
        vec![future_receipt.version_id.clone()]
    );
    assert!(
        !pending
            .resolution
            .version_ids
            .contains(&new_only.version_id)
    );
    let before_cutoff: bool =
        sqlx::query_scalar("SELECT clock_timestamp()<to_timestamp($1::bigint)")
            .bind(future.activation.available_at)
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    assert!(
        before_cutoff,
        "Continue must actually execute before the activation cutoff"
    );
    wait_until_cutoff(owner, future.activation.available_at).await;
    let route = WakeupRoute {
        id: early.0.task_id.clone(),
        actor_id: "actor-manager".into(),
        scope: scope.clone(),
        task_id: early.0.task_id.clone(),
    };
    assert!(matches!(
        tasks
            .coordinate(&route, "continue-cohort-worker")
            .await
            .unwrap(),
        Decision::Execute(_)
    ));
    let after = repo
        .task_basis("actor-manager", &scope, &early.0.task_id)
        .await
        .unwrap();
    assert_eq!(
        after.current.resolution.version_ids,
        vec![future_receipt.version_id]
    );
    assert!(
        !after
            .current
            .candidate_version_ids
            .contains(&new_only.version_id)
    );
    assert_eq!(after.pending.unwrap().id, distant.event_id);
    let late = &stopped[1];
    tasks
        .admit(
            "actor-manager",
            &scope,
            &TaskCommand {
                key: "continue-after-cutoff-command".into(),
                kind: CommandKind::Continue,
                task_id: Some(late.0.task_id.clone()),
                cycle_id: Some(late.0.cycle_id.clone()),
                content: None,
                context: None,
            },
        )
        .await
        .unwrap();
    let late_basis = repo
        .task_basis("actor-manager", &scope, &late.0.task_id)
        .await
        .unwrap();
    assert_eq!(late_basis.current, late.1);
    let late_pending = late_basis.pending.unwrap();
    assert_eq!(
        late_pending.id, distant.event_id,
        "only the still-future activation joins a late Continue"
    );
    assert_eq!(
        late_pending.resolution.version_ids,
        vec![original.version_id],
        "post-cutoff Continue cannot retroactively import the missed version"
    );
    let route = WakeupRoute {
        id: late.0.task_id.clone(),
        actor_id: "actor-manager".into(),
        scope: scope.clone(),
        task_id: late.0.task_id.clone(),
    };
    assert!(matches!(
        tasks
            .coordinate(&route, "continue-late-worker")
            .await
            .unwrap(),
        Decision::Execute(_)
    ));
    assert_eq!(
        repo.task_basis("actor-manager", &scope, &late.0.task_id)
            .await
            .unwrap()
            .current,
        late.1
    );
}
