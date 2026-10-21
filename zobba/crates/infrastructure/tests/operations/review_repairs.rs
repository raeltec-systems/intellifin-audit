//! Focused regressions for the accepted independent review repairs.
use super::*;
use zobba_domain::task::Observation;

pub async fn verify(f: &mut Fixture, admin: &mut PgConnection, holder: &mut PgConnection) {
    exact_producing_claim(f).await;
    delegation_cannot_change_accountable_owner(f, admin).await;
    unresolved_pages_reach_every_attempt(f).await;
    source_revision_revokes_projection(f).await;
    refusal_is_terminal_despite_timestamp_order(f, admin).await;
    expiry_is_checked_after_deferred_writes(f, admin, holder).await;
}

async fn exact_producing_claim(f: &Fixture) {
    let case = f.case("review-exact-claim", true, 0).await;
    let operation = f.admit(&case, "review-exact-claim-operation").await;
    for change_process in [false, true] {
        let mut forged = case.basis.clone();
        if change_process {
            forged.process_instance = "forged-process".into();
        } else {
            forged.claim_id = "forged-claim".into();
        }
        assert_eq!(
            f.operations
                .admit(
                    "actor-a",
                    &selected("a"),
                    &forged,
                    "forged-operation",
                    &case.request
                )
                .await,
            Err(OperationError::Fenced)
        );
        assert!(matches!(
            f.operations.consume(&forged, &operation.id).await,
            Err(OperationError::Fenced)
        ));
    }
    let replacement = execution(
        f.tasks
            .coordinate(&route(&case.receipt), &case.basis.worker_id)
            .await
            .unwrap(),
    );
    assert_eq!(replacement.owner_epoch, case.basis.owner_epoch);
    assert_ne!(replacement.claim_id, case.basis.claim_id);
    assert_eq!(
        f.operations
            .admit(
                "actor-a",
                &selected("a"),
                &case.basis,
                "abandoned-operation",
                &case.request
            )
            .await,
        Err(OperationError::Fenced)
    );
    assert!(matches!(
        f.operations.consume(&case.basis, &operation.id).await,
        Err(OperationError::Fenced)
    ));
    // A lost admission ACK followed by same-owner replacement is still the same
    // logical operation, with no remote effect to reconcile before first consume.
    let recovered = f
        .operations
        .admit(
            "actor-a",
            &selected("a"),
            &replacement,
            "review-exact-claim-operation",
            &case.request,
        )
        .await
        .unwrap();
    assert_eq!(recovered.id, operation.id);
    let inert = f.tasks.consume(&replacement).await.unwrap();
    let active = f
        .operations
        .admit(
            "actor-a",
            &selected("a"),
            &replacement,
            "active-consumed-producer",
            &case.request,
        )
        .await
        .unwrap();
    let external = f
        .operations
        .consume(&replacement, &active.id)
        .await
        .unwrap();
    f.operations
        .observe(&external, SourceFact::Completed)
        .await
        .unwrap();
    f.tasks
        .observe(&inert, Observation::Completed)
        .await
        .unwrap();
    // The receipt is terminal even before the coordinator incorporates it.
    assert_eq!(
        f.operations
            .admit(
                "actor-a",
                &selected("a"),
                &replacement,
                "terminal-producer",
                &case.request
            )
            .await,
        Err(OperationError::Fenced)
    );
    assert!(matches!(
        f.operations.consume(&replacement, &operation.id).await,
        Err(OperationError::Fenced)
    ));
}

async fn delegation_cannot_change_accountable_owner(f: &Fixture, admin: &mut PgConnection) {
    admin.execute("INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES('org-a','actor-b',ARRAY['auditor']) ON CONFLICT DO NOTHING; INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-a','actor-b') ON CONFLICT DO NOTHING").await.unwrap();
    let victim = f.case("review-delegation-victim", true, 0).await;
    let other = f
        .tasks
        .admit(
            "actor-b",
            &selected("a"),
            &TaskCommand {
                context: None,
                key: "review-delegation-other".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Other accountable actor".into()),
            },
        )
        .await
        .unwrap();
    let mut other_policy = policy(PolicyKind::Task, &other.task_id);
    other_policy.actor_id = "actor-b".into();
    f.operations
        .save_policy("actor-b", &selected("a"), &other_policy)
        .await
        .unwrap();
    let mut delegated = policy(PolicyKind::Delegation, "review-owned-delegation");
    delegated.actor_id = "actor-a".into();
    delegated.parent = Some(victim.authority.task.reference());
    f.operations
        .save_policy("actor-a", &selected("a"), &delegated)
        .await
        .unwrap();
    let mut takeover = delegated.clone();
    takeover.version += 1;
    takeover.actor_id = "actor-b".into();
    takeover.parent = Some(other_policy.reference());
    assert_eq!(
        f.operations
            .save_policy("actor-b", &selected("a"), &takeover)
            .await,
        Err(OperationError::Denied)
    );
    // Existing ownership does not authorize attaching another owner's root either.
    takeover.actor_id = "actor-a".into();
    assert_eq!(
        f.operations
            .save_policy("actor-a", &selected("a"), &takeover)
            .await,
        Err(OperationError::Denied)
    );
    delegated.version += 1;
    f.operations
        .save_policy("actor-a", &selected("a"), &delegated)
        .await
        .unwrap();
    // This actor remains a valid historical Task owner, but the fixture's
    // separate cross-scope denial checks require its original org-B audience.
    admin.execute("DELETE FROM public.engagement_assignments WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' AND actor_id='actor-b'; DELETE FROM public.organisation_memberships WHERE organisation_id='org-a' AND actor_id='actor-b'").await.unwrap();
}

async fn unresolved_pages_reach_every_attempt(f: &Fixture) {
    let case = f.case("review-unresolved-pagination", true, 0).await;
    let inert = f.tasks.consume(&case.basis).await.unwrap();
    let mut expected = std::collections::BTreeSet::new();
    for n in 0..61 {
        assert!(f.tasks.current(&case.basis).await.unwrap());
        let operation = f.admit(&case, &format!("review-page-{n}")).await;
        let consumed = f
            .operations
            .consume(&case.basis, &operation.id)
            .await
            .unwrap();
        expected.insert(consumed.attempt_id);
    }
    let mut seen = std::collections::BTreeSet::new();
    let mut cursor = None;
    let mut pages = 0;
    loop {
        let page = f
            .operations
            .unresolved(
                "actor-a",
                &selected("a"),
                &case.receipt.task_id,
                cursor.as_deref(),
            )
            .await
            .unwrap();
        assert!(page.attempts.len() <= 50);
        for attempt in page.attempts {
            assert!(seen.insert(attempt.id));
        }
        pages += 1;
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(pages, 2);
    assert_eq!(
        seen, expected,
        "earlier unresolved attempts must not starve later ones"
    );
    f.tasks
        .observe(&inert, Observation::Completed)
        .await
        .unwrap();
}

async fn source_revision_revokes_projection(f: &mut Fixture) {
    let case = f.case("review-source-revision", true, 0).await;
    let operation = f.admit(&case, "review-source-revision-operation").await;
    let old = f.authority.account.clone();
    let mut changed = old.clone();
    changed.version += 1;
    changed.account.as_mut().unwrap().source.ledger_id = "other-ledger".into();
    f.operations
        .save_policy("actor-manager", &selected("a"), &changed)
        .await
        .unwrap();
    assert_eq!(
        f.operations
            .get("actor-a", &selected("a"), &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Revoked
    );
    assert!(matches!(
        f.operations.consume(&case.basis, &operation.id).await,
        Err(OperationError::Denied)
    ));
    let mut restored = old;
    restored.version = changed.version + 1;
    f.operations
        .save_policy("actor-manager", &selected("a"), &restored)
        .await
        .unwrap();
    f.authority.account = restored;
}

async fn expiry_is_checked_after_deferred_writes(
    f: &Fixture,
    admin: &mut PgConnection,
    holder: &mut PgConnection,
) {
    for expiry_kind in ["request", "decision", "policy", "owner"] {
        let mut case = f
            .case(
                &format!("review-expiry-{expiry_kind}"),
                expiry_kind != "decision",
                0,
            )
            .await;
        let deadline = now() + 2;
        if matches!(expiry_kind, "request" | "policy") {
            case.request.expires_at = deadline;
        }
        if expiry_kind == "policy" {
            let mut revision = case.authority.task.clone();
            revision.version += 1;
            revision.hard.rules[0].expires_at = deadline;
            revision.standing.rules[0].expires_at = deadline;
            f.operations
                .save_policy("actor-a", &selected("a"), &revision)
                .await
                .unwrap();
        }
        let operation = f
            .admit(&case, &format!("review-expiry-{expiry_kind}-operation"))
            .await;
        if expiry_kind == "decision" {
            let mut decision = exact(&operation, "review-expiring-decision");
            decision.expires_at = deadline;
            f.operations
                .decide("actor-a", &selected("a"), &decision)
                .await
                .unwrap();
        }
        if expiry_kind == "owner" {
            sqlx::query("UPDATE public.tasks SET owner_until=to_timestamp($2) WHERE id=$1")
                .bind(&case.receipt.task_id)
                .bind(deadline as f64)
                .execute(&mut *admin)
                .await
                .unwrap();
        }
        // The trigger blocks the actual deferred write barrier. The authority
        // read must happen after flushing it, not just before commit is called.
        gate(admin, holder, "operation_attempts").await;
        let repo = f.operations.clone();
        let basis = case.basis.clone();
        let id = operation.id.clone();
        let pending = tokio::spawn(async move { repo.consume(&basis, &id).await });
        wait_for_blockers(admin, 1).await;
        while now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        release(holder).await;
        let result = pending.await.unwrap();
        ungate(admin, "operation_attempts").await;
        let expected = match expiry_kind {
            "owner" => OperationError::Fenced,
            "decision" => OperationError::NeedsDecision,
            _ => OperationError::Denied,
        };
        assert!(
            matches!(result, Err(error) if error == expected),
            "expired {expiry_kind} must refuse at final authority check, not a database timeout"
        );
        let attempts: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM public.operation_attempts WHERE operation_id=$1",
        )
        .bind(&operation.id)
        .fetch_one(&mut *admin)
        .await
        .unwrap();
        assert_eq!(attempts, 0, "expiry must roll back attempted consumption");
    }
}

async fn refusal_is_terminal_despite_timestamp_order(f: &Fixture, admin: &mut PgConnection) {
    let case = f.case("review-terminal-refusal", true, 0).await;
    let operation = f.admit(&case, "review-terminal-refusal-operation").await;
    let allow = exact(&operation, "review-first-allow");
    f.operations
        .decide("actor-a", &selected("a"), &allow)
        .await
        .unwrap();
    let mut refusal = exact(&operation, "review-fresh-refusal");
    refusal.allow = false;
    f.operations
        .decide("actor-a", &selected("a"), &refusal)
        .await
        .unwrap();
    // Deliberately reorder wall-clock evidence; persisted refusal remains final.
    sqlx::query("UPDATE public.operation_decisions SET created_at=clock_timestamp()-interval '1 minute' WHERE operation_id=$1 AND allow=false").bind(&operation.id).execute(&mut *admin).await.unwrap();
    assert_eq!(
        f.operations
            .get("actor-a", &selected("a"), &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Revoked
    );
    assert!(matches!(
        f.operations.consume(&case.basis, &operation.id).await,
        Err(OperationError::Denied)
    ));
}
