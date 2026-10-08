//! A method edit never reattributes consumed effects or imports new-only policy.
use super::*;
use zobba_application::methodology::{
    ActivationMode, AssignmentKind, AssignmentScope, MethodologyStore, RecallMethodology,
    SaveMethodology,
};
use zobba_infrastructure::{
    identity::{IdentityRepository, secret_hash},
    methodology::MethodologyRepository,
};

fn save(key: &str, revision: u64, criterion: &str) -> SaveMethodology {
    serde_json::from_value(json!({
        "key":key,"expected_revision":revision,"supersedes":null,"undo_of":null,
        "assignment":{"kind":"firm","client_id":null,"engagement_id":null},
        "applicability":{"audit_area":null,"period_start":null,"period_end":null},
        "activation":{"mode":"new_tasks","available_at":0},
        "definition":{"name":"Synthetic required method","neutral_starter":false,
            "default_context":{"audit_area":"revenue","period_start":"2025-01-01","period_end":"2025-12-31"},
            "templates":[],"requirements":[{"id":"completeness","label":"Completeness","mandatory":true,
              "criteria":[criterion],"populations":null,"evidence_checks":null,"ratings":null,
              "templates":null,"review_rules":["Record accountable review"],"suitable_skills":null}]},
        "source":{"kind":"authored","reference":null,"note":"Owned synthetic execution contract"}
    })).unwrap()
}

pub(super) async fn verify(f: &Fixture, admin: &mut PgConnection) {
    let identities = IdentityRepository::new(f.pool.clone());
    let token = identities
        .establish_session("https://127.0.0.1:4443", "manager-a", "Manager", None)
        .await
        .unwrap();
    let methods = MethodologyRepository::new(f.pool.clone()).with_session_hash(secret_hash(&token));
    let a = methods
        .save(
            "actor-manager",
            "org-a",
            &save("method-A", 0, "Criterion A"),
        )
        .await
        .unwrap();
    let unused = f.case("method-unused", true, 0).await;
    let flight = f.case("method-flight", true, 0).await;
    let operation = f.admit(&flight, "method-flight-operation").await;
    let consumed = f
        .operations
        .consume(&flight.basis, &operation.id)
        .await
        .unwrap();
    let inert = f.tasks.consume(&flight.basis).await.unwrap();
    let original = methods
        .task_basis("actor-manager", &selected("a"), &flight.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(
        original.current.resolution.version_ids,
        std::slice::from_ref(&a.version_id)
    );
    assert_eq!(operation.methodology_binding_id, original.current.id);
    assert_eq!(
        operation.execution_epoch,
        flight.basis.execution_epoch as u64
    );

    let mut b_command = save("method-B-new-only", 1, "Criterion B must remain new-only");
    b_command.supersedes = Some(a.version_id.clone());
    b_command.definition.default_context.period_start = Some("2026-01-01".into());
    b_command.definition.default_context.period_end = Some("2026-12-31".into());
    let b = methods
        .save("actor-manager", "org-a", &b_command)
        .await
        .unwrap();
    assert_eq!(
        methods
            .task_basis("actor-manager", &selected("a"), &flight.receipt.task_id)
            .await
            .unwrap()
            .current,
        original.current
    );
    let new_task = f.case("method-new-only", true, 0).await;
    assert_eq!(
        methods
            .task_basis("actor-manager", &selected("a"), &new_task.receipt.task_id)
            .await
            .unwrap()
            .current
            .resolution
            .version_ids,
        std::slice::from_ref(&b.version_id)
    );

    let mut c_command = save("method-C-active-scoped", 2, "Scoped additional check");
    c_command.assignment = AssignmentScope {
        kind: AssignmentKind::Engagement,
        client_id: Some("client-a".into()),
        engagement_id: Some("engagement-a".into()),
    };
    c_command.activation.mode = ActivationMode::ActiveTasks;
    c_command.definition.default_context = Default::default();
    c_command.definition.requirements[0].id = "scoped-check".into();
    let c = methods
        .save("actor-manager", "org-a", &c_command)
        .await
        .unwrap();
    assert!(c.impact.pending_tasks >= 3);
    assert!(matches!(
        f.tasks.consume(&unused.basis).await,
        Err(TaskError::Fenced)
    ));
    assert!(
        f.tasks.current(&flight.basis).await.unwrap(),
        "a pending edit must retain the consumed child's original current basis"
    );
    assert!(matches!(
        f.operations
            .admit(
                "actor-a",
                &selected("a"),
                &flight.basis,
                "method-stale-new-operation",
                &flight.request
            )
            .await,
        Err(OperationError::Fenced)
    ));
    let pending = methods
        .task_basis("actor-manager", &selected("a"), &flight.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(pending.current, original.current);
    assert!(pending.pending.is_some());

    let next_unused = execution(
        f.tasks
            .coordinate(&route(&unused.receipt), &unused.basis.worker_id)
            .await
            .unwrap(),
    );
    assert!(next_unused.execution_epoch > unused.basis.execution_epoch);
    let rebound = methods
        .task_basis("actor-manager", &selected("a"), &unused.receipt.task_id)
        .await
        .unwrap();
    assert!(
        rebound
            .current
            .resolution
            .version_ids
            .contains(&a.version_id)
    );
    assert!(
        rebound
            .current
            .resolution
            .version_ids
            .contains(&c.version_id)
    );
    assert!(
        !rebound
            .current
            .resolution
            .version_ids
            .contains(&b.version_id),
        "active scoped change silently imported an intervening new-only firm policy"
    );
    assert_eq!(
        rebound.current.resolution.context.period_start.as_deref(),
        Some("2025-01-01")
    );

    // A joined inert child does not settle an uncertain external effect.
    f.tasks
        .observe(&inert, zobba_domain::task::Observation::Completed)
        .await
        .unwrap();
    assert_eq!(
        f.tasks
            .coordinate(&route(&flight.receipt), &flight.basis.worker_id)
            .await
            .unwrap(),
        Decision::Waiting
    );
    assert_eq!(
        methods
            .task_basis("actor-manager", &selected("a"), &flight.receipt.task_id)
            .await
            .unwrap()
            .current,
        original.current
    );
    f.operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
    f.operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
    let next_flight = execution(
        f.tasks
            .coordinate(&route(&flight.receipt), &flight.basis.worker_id)
            .await
            .unwrap(),
    );
    assert!(next_flight.execution_epoch > flight.basis.execution_epoch);
    let updated = methods
        .task_basis("actor-manager", &selected("a"), &flight.receipt.task_id)
        .await
        .unwrap();
    assert!(
        updated
            .history
            .iter()
            .any(|binding| binding == &original.current)
    );
    assert_eq!(
        updated.current.execution_epoch,
        next_flight.execution_epoch as u64
    );
    assert_ne!(updated.current.id, original.current.id);
    let history = f
        .operations
        .history(
            "actor-a",
            &selected("a"),
            &operation.id,
            &Default::default(),
        )
        .await
        .unwrap();
    assert_eq!(history.attempts.len(), 1);
    assert_eq!(history.attempts[0].id, consumed.attempt_id);
    assert_eq!(
        history.attempts[0].methodology_binding_id,
        original.current.id
    );
    assert_eq!(
        history.attempts[0].execution_epoch,
        flight.basis.execution_epoch as u64
    );
    assert_eq!(
        f.operations
            .get("actor-a", &selected("a"), &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Completed
    );
    let producing: StoredBasis = serde_json::from_str(
        &sqlx::query_scalar::<_, String>("SELECT basis FROM public.operation_attempts WHERE id=$1")
            .bind(&consumed.attempt_id)
            .fetch_one(&mut *admin)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(producing.0, flight.basis);

    // A paused Task retains a future activation wakeup without resuming itself.
    f.tasks
        .admit(
            "actor-a",
            &selected("a"),
            &command("method-pause", CommandKind::Pause, &unused.receipt),
        )
        .await
        .unwrap();
    let mut scheduled = c_command.clone();
    scheduled.key = "method-scheduled".into();
    scheduled.expected_revision = 3;
    scheduled.supersedes = Some(c.version_id.clone());
    scheduled.activation.available_at = now() + 3;
    let scheduled_receipt = methods
        .save("actor-manager", "org-a", &scheduled)
        .await
        .unwrap();
    assert_eq!(
        f.tasks
            .coordinate(&route(&unused.receipt), &unused.basis.worker_id)
            .await
            .unwrap(),
        Decision::Idle
    );
    let (pending_wakeup, activation): (bool, i64) = sqlx::query_as("SELECT pending,extract(epoch FROM available_at)::bigint FROM public.task_wakeups WHERE id=$1")
        .bind(&unused.receipt.task_id).fetch_one(&mut *admin).await.unwrap();
    assert!(pending_wakeup);
    assert_eq!(activation, scheduled.activation.available_at);
    assert_eq!(
        f.tasks
            .get("actor-a", &selected("a"), &unused.receipt.task_id)
            .await
            .unwrap()
            .state,
        TaskState::Paused
    );
    let before_activation = methods
        .task_basis("actor-manager", &selected("a"), &unused.receipt.task_id)
        .await
        .unwrap();
    assert!(
        !before_activation
            .current
            .resolution
            .version_ids
            .contains(&scheduled_receipt.version_id)
    );
    // Observe the durable timestamp rather than assuming a sleep crossed it.
    tokio::time::timeout(Duration::from_secs(6), async {
        loop {
            let due: bool =
                sqlx::query_scalar("SELECT clock_timestamp() >= to_timestamp($1::bigint)")
                    .bind(scheduled.activation.available_at)
                    .fetch_one(&mut *admin)
                    .await
                    .unwrap();
            if due {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let resumed_coordinator = TaskRepository::new(f.pool.clone());
    assert_eq!(
        resumed_coordinator
            .coordinate(&route(&unused.receipt), &unused.basis.worker_id)
            .await
            .unwrap(),
        Decision::Idle
    );
    let after_activation = methods
        .task_basis("actor-manager", &selected("a"), &unused.receipt.task_id)
        .await
        .unwrap();
    assert!(
        after_activation
            .current
            .resolution
            .version_ids
            .contains(&scheduled_receipt.version_id)
    );
    assert!(
        !after_activation
            .current
            .resolution
            .version_ids
            .contains(&c.version_id)
    );
    assert!(
        after_activation
            .current
            .resolution
            .version_ids
            .contains(&a.version_id)
    );
    assert_eq!(
        resumed_coordinator
            .get("actor-a", &selected("a"), &unused.receipt.task_id)
            .await
            .unwrap()
            .state,
        TaskState::Paused
    );

    methods
        .recall(
            "actor-manager",
            "org-a",
            &RecallMethodology {
                key: "method-recall-A".into(),
                expected_revision: 4,
                version_id: a.version_id.clone(),
                reason: "Synthetic faulty criterion".into(),
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        f.tasks.consume(&next_flight).await,
        Err(TaskError::Fenced)
    ));
    f.operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
    // Unrelated Task controls may advance epochs without changing the method.
    // Original operation and attempt inspection must still resolve their exact
    // producing binding after guidance, pause, stop, rebinding and recall.
    for (key, kind) in [
        ("method-history-guide", CommandKind::Guide),
        ("method-history-pause", CommandKind::Pause),
        ("method-history-stop", CommandKind::Stop),
    ] {
        f.tasks
            .admit(
                "actor-a",
                &selected("a"),
                &command(key, kind, &flight.receipt),
            )
            .await
            .unwrap();
    }
    let final_operation = f
        .operations
        .get("actor-a", &selected("a"), &operation.id)
        .await
        .unwrap();
    assert_eq!(final_operation.methodology_binding_id, original.current.id);
    assert_eq!(
        final_operation.execution_epoch,
        flight.basis.execution_epoch as u64
    );
    let final_history = f
        .operations
        .history(
            "actor-a",
            &selected("a"),
            &operation.id,
            &Default::default(),
        )
        .await
        .unwrap();
    assert_eq!(final_history.attempts, history.attempts);
    assert!(
        methods
            .task_basis("actor-manager", &selected("a"), &flight.receipt.task_id)
            .await
            .unwrap()
            .recalled
    );
    assert_eq!(
        f.operations
            .get("actor-a", &selected("a"), &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Completed
    );
    verify_guided_context(f, &methods).await;
    identities.logout(&token).await.unwrap();
}

async fn verify_guided_context(f: &Fixture, methods: &MethodologyRepository) {
    // Both candidates are available before the Task but outside its initial
    // defaults. Their exact pool must survive subsequent area/period discovery.
    let mut inventory = save(
        "context-inventory",
        5,
        "Count inventory under the 2025 policy",
    );
    inventory.applicability.audit_area = Some("inventory".into());
    inventory.applicability.period_start = Some("2025-01-01".into());
    inventory.applicability.period_end = Some("2025-12-31".into());
    inventory.definition.default_context = Default::default();
    inventory.definition.requirements[0].id = "inventory-required".into();
    let inventory_receipt = methods
        .save("actor-manager", "org-a", &inventory)
        .await
        .unwrap();
    let mut revenue = save(
        "context-revenue",
        6,
        "Inspect historical revenue under the 2024 policy",
    );
    revenue.applicability.audit_area = Some("revenue".into());
    revenue.applicability.period_start = Some("2024-01-01".into());
    revenue.applicability.period_end = Some("2024-12-31".into());
    revenue.definition.default_context = Default::default();
    revenue.definition.requirements[0].id = "historical-revenue-required".into();
    let revenue_receipt = methods
        .save("actor-manager", "org-a", &revenue)
        .await
        .unwrap();
    let case = f.case("context-discovery", true, 0).await;
    let original = methods
        .task_basis("actor-manager", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert!(
        original
            .current
            .candidate_version_ids
            .contains(&inventory_receipt.version_id)
    );
    assert!(
        original
            .current
            .candidate_version_ids
            .contains(&revenue_receipt.version_id)
    );
    assert!(
        !original
            .current
            .resolution
            .version_ids
            .contains(&inventory_receipt.version_id)
    );
    assert!(
        !original
            .current
            .resolution
            .version_ids
            .contains(&revenue_receipt.version_id)
    );
    let operation = f.admit(&case, "context-consumed-operation").await;
    let consumed = f
        .operations
        .consume(&case.basis, &operation.id)
        .await
        .unwrap();
    let inert = f.tasks.consume(&case.basis).await.unwrap();
    let unused_operation = f.admit(&case, "context-unused-operation").await;

    let mut late = inventory.clone();
    late.key = "context-unrelated-new-only".into();
    late.expected_revision = 7;
    late.supersedes = Some(inventory_receipt.version_id.clone());
    late.definition.requirements[0].criteria = Some(vec!["Must remain new-only".into()]);
    let late_receipt = methods.save("actor-manager", "org-a", &late).await.unwrap();
    let mut guide = command("context-guide-inventory", CommandKind::Guide, &case.receipt);
    guide.context = Some(zobba_domain::methodology::TaskContext {
        audit_area: Some("inventory".into()),
        period_start: Some("2025-01-01".into()),
        period_end: Some("2025-12-31".into()),
    });
    let receipt = f
        .tasks
        .admit("actor-a", &selected("a"), &guide)
        .await
        .unwrap();
    assert_eq!(
        f.tasks
            .admit("actor-a", &selected("a"), &guide)
            .await
            .unwrap(),
        receipt
    );
    let staged = methods
        .task_basis("actor-manager", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(staged.current, original.current);
    assert_eq!(staged.pending.as_ref().unwrap().id, receipt.command_id);
    assert_eq!(staged.pending.as_ref().unwrap().actor_id, "actor-a");
    assert_eq!(
        staged
            .pending
            .as_ref()
            .unwrap()
            .resolution
            .context
            .audit_area
            .as_deref(),
        Some("inventory")
    );
    let before = f
        .tasks
        .get("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    let mut changed = guide.clone();
    changed.context.as_mut().unwrap().audit_area = Some("revenue".into());
    assert!(matches!(
        f.tasks.admit("actor-a", &selected("a"), &changed).await,
        Err(TaskError::Conflict)
    ));
    assert_eq!(
        f.tasks
            .get("actor-a", &selected("a"), &case.receipt.task_id)
            .await
            .unwrap(),
        before
    );
    assert_eq!(
        methods
            .task_basis("actor-manager", &selected("a"), &case.receipt.task_id)
            .await
            .unwrap(),
        staged
    );
    assert!(matches!(
        f.operations
            .consume(&case.basis, &unused_operation.id)
            .await,
        Err(OperationError::Fenced)
    ));
    assert_eq!(
        f.tasks
            .coordinate(&route(&case.receipt), &case.basis.worker_id)
            .await
            .unwrap(),
        Decision::Waiting
    );
    assert_eq!(
        methods
            .task_basis("actor-manager", &selected("a"), &case.receipt.task_id)
            .await
            .unwrap()
            .current,
        original.current
    );
    f.tasks
        .observe(&inert, zobba_domain::task::Observation::Completed)
        .await
        .unwrap();
    f.operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
    let next = execution(
        f.tasks
            .coordinate(&route(&case.receipt), &case.basis.worker_id)
            .await
            .unwrap(),
    );
    let applied = methods
        .task_basis("actor-manager", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert_eq!(applied.current.execution_epoch, next.execution_epoch as u64);
    assert_eq!(
        applied.current.context_command_id.as_deref(),
        Some(receipt.command_id.as_str())
    );
    assert!(
        applied
            .current
            .resolution
            .version_ids
            .contains(&inventory_receipt.version_id)
    );
    assert!(
        !applied
            .current
            .resolution
            .version_ids
            .contains(&late_receipt.version_id)
    );
    assert!(
        !applied
            .current
            .candidate_version_ids
            .contains(&late_receipt.version_id)
    );
    assert!(
        applied
            .current
            .resolution
            .requirements
            .iter()
            .any(|r| r.requirement.id == "inventory-required" && r.requirement.mandatory)
    );

    f.tasks
        .admit(
            "actor-a",
            &selected("a"),
            &command("context-pause", CommandKind::Pause, &case.receipt),
        )
        .await
        .unwrap();
    guide.key = "context-guide-revenue".into();
    guide.context = Some(zobba_domain::methodology::TaskContext {
        audit_area: Some("revenue".into()),
        period_start: Some("2024-01-01".into()),
        period_end: Some("2024-12-31".into()),
    });
    let correction_receipt = f
        .tasks
        .admit("actor-a", &selected("a"), &guide)
        .await
        .unwrap();
    assert_eq!(
        f.tasks
            .coordinate(&route(&case.receipt), &case.basis.worker_id)
            .await
            .unwrap(),
        Decision::Idle
    );
    let corrected = methods
        .task_basis("actor-manager", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    assert!(
        corrected
            .current
            .resolution
            .version_ids
            .contains(&revenue_receipt.version_id)
    );
    assert!(
        !corrected
            .current
            .resolution
            .version_ids
            .contains(&inventory_receipt.version_id)
    );
    assert!(corrected.current.execution_epoch > applied.current.execution_epoch);
    assert_eq!(
        corrected.current.context_command_id.as_deref(),
        Some(correction_receipt.command_id.as_str())
    );
    assert_eq!(
        f.tasks
            .get("actor-a", &selected("a"), &case.receipt.task_id)
            .await
            .unwrap()
            .state,
        TaskState::Paused
    );
    let historical = f
        .operations
        .get("actor-a", &selected("a"), &operation.id)
        .await
        .unwrap();
    assert_eq!(historical.methodology_binding_id, original.current.id);
    assert_eq!(historical.state, OperationState::Completed);
    let history = f
        .operations
        .history(
            "actor-a",
            &selected("a"),
            &operation.id,
            &Default::default(),
        )
        .await
        .unwrap();
    assert_eq!(
        history.attempts[0].methodology_binding_id,
        original.current.id
    );
}
