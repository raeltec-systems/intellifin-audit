//! Repository regressions for retained Task acceptance and shared policy heads.
use super::*;

pub async fn verify(f: &mut Fixture, admin: &mut PgConnection) {
    ordinary_task_revisions_preserve_the_accepted_upper_bound(f).await;
    shared_revisions_cross_engagement_boundaries(f, admin).await;
}

async fn ordinary_task_revisions_preserve_the_accepted_upper_bound(f: &Fixture) {
    let case = f.case("task-policy-retained-acceptance", false, 0).await;
    let original = f.admit(&case, "task-policy-before-revision").await;
    assert_eq!(original.state, OperationState::NeedsDecision);

    let mut revision = case.authority.task.clone();
    revision.version += 1;
    revision.created_at = now();
    f.operations
        .save_policy("actor-a", &selected("a"), &revision)
        .await
        .unwrap();
    let after_harmless = f.admit(&case, "task-policy-after-harmless").await;
    assert_eq!(
        after_harmless.state,
        OperationState::NeedsDecision,
        "an ordinary policy revision must retain the accepted authority needed for new admissions"
    );

    revision.version += 1;
    revision.created_at = now();
    revision.hard.rules.clear();
    f.operations
        .save_policy("actor-a", &selected("a"), &revision)
        .await
        .unwrap();
    assert!(matches!(
        f.operations
            .admit(
                "actor-a",
                &selected("a"),
                &case.basis,
                "task-policy-after-narrowing",
                &case.request,
            )
            .await,
        Err(OperationError::Denied)
    ));

    revision.version += 1;
    revision.created_at = now();
    revision.hard = case.authority.task.hard.clone();
    revision.standing = revision.hard.clone();
    f.operations
        .save_policy("actor-a", &selected("a"), &revision)
        .await
        .unwrap();
    let after_widening = f
        .admit(&case, "task-policy-after-unaccepted-widening")
        .await;
    assert_eq!(
        after_widening.state,
        OperationState::NeedsDecision,
        "wider current standing rules must not widen the retained accepted upper bound"
    );
    assert!(matches!(
        f.operations.consume(&case.basis, &after_widening.id).await,
        Err(OperationError::NeedsDecision)
    ));

    let mut accepted = case.authority.clone();
    revision.version += 1;
    revision.created_at = now();
    accepted.task = revision;
    f.operations
        .accept_authority("actor-a", &selected("a"), &case.receipt.task_id, &accepted)
        .await
        .unwrap();
    let after_acceptance = f
        .admit(&case, "task-policy-after-explicit-acceptance")
        .await;
    assert_eq!(after_acceptance.state, OperationState::Ready);
    assert_eq!(
        f.operations
            .get("actor-a", &selected("a"), &after_widening.id)
            .await
            .unwrap()
            .state,
        OperationState::NeedsDecision,
        "new Task acceptance cannot rewrite an earlier operation's immutable authority snapshot"
    );
    let consumed = f
        .operations
        .consume(&case.basis, &after_acceptance.id)
        .await
        .expect("explicitly accepted standing authority admits subsequent operations");
    f.operations
        .observe(&consumed, SourceFact::Completed)
        .await
        .unwrap();
}

async fn shared_revisions_cross_engagement_boundaries(f: &mut Fixture, admin: &mut PgConnection) {
    let other = Scope {
        organisation_id: selected("a").organisation_id,
        client_id: "client-policy-other".into(),
        engagement_id: "engagement-policy-other".into(),
    };
    admin.execute("INSERT INTO public.clients(organisation_id,id,name) VALUES('org-a','client-policy-other','Shared policy other client'); INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-policy-other','engagement-policy-other','Shared policy other engagement'); INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-policy-other','engagement-policy-other','actor-manager')").await.unwrap();

    for kind in [
        PolicyKind::Organisation,
        PolicyKind::Member,
        PolicyKind::Account,
    ] {
        let name = format!("shared-policy-{}", kind.as_str());
        let case = f.case(&name, true, 0).await;
        let operation = f.admit(&case, &format!("{name}-operation")).await;
        let retained = match kind {
            PolicyKind::Organisation => f.authority.organisation.clone(),
            PolicyKind::Member => f.authority.member.clone(),
            PolicyKind::Account => f.authority.account.clone(),
            _ => unreachable!(),
        };
        let mut narrowed = retained.clone();
        narrowed.version += 1;
        narrowed.created_at = now();
        narrowed.hard.rules.clear();
        f.operations
            .save_policy("actor-manager", &other, &narrowed)
            .await
            .expect("a shared policy revision resolves the same current head from engagement B");
        assert!(
            matches!(
                f.operations.consume(&case.basis, &operation.id).await,
                Err(OperationError::Denied)
            ),
            "a shared {kind:?} revision from engagement B must immediately constrain an operation accepted in engagement A"
        );
        assert_eq!(
            f.operations
                .get("actor-a", &selected("a"), &operation.id)
                .await
                .unwrap()
                .state,
            OperationState::Revoked
        );
        let attempts: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM public.operation_attempts WHERE operation_id=$1",
        )
        .bind(&operation.id)
        .fetch_one(&mut *admin)
        .await
        .unwrap();
        assert_eq!(
            attempts, 0,
            "cross-engagement narrowing precedes dispatch cutoff"
        );

        // Restore the permitted content as a successor through that same other
        // engagement and update only the fixture's current shared binding.
        let mut restored = retained;
        restored.version = narrowed.version + 1;
        restored.created_at = now();
        f.operations
            .save_policy("actor-manager", &other, &restored)
            .await
            .unwrap();
        match kind {
            PolicyKind::Organisation => f.authority.organisation = restored,
            PolicyKind::Member => f.authority.member = restored,
            PolicyKind::Account => f.authority.account = restored,
            _ => unreachable!(),
        }
    }
}
