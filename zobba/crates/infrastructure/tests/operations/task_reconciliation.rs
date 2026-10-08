//! Regression orders discovered by independent Story 20.5 review.
use super::*;

async fn observe(f: &Fixture, attempt: &ConsumedOperation, fact: SourceFact) {
    if fact == SourceFact::AuthoritativelyAbsent {
        let observer = f
            .operations
            .recover("actor-a", &selected("a"), &attempt.attempt_id)
            .await
            .unwrap();
        f.operations.observe(&observer, fact).await.unwrap();
    } else {
        f.operations.observe(attempt, fact).await.unwrap();
    }
}

async fn state(f: &Fixture, case: &Case) -> (TaskState, Cessation) {
    let state = f
        .tasks
        .get("actor-a", &selected("a"), &case.receipt.task_id)
        .await
        .unwrap();
    (state.state, state.cessation)
}

async fn coordinate(f: &Fixture, case: &Case) -> Decision {
    f.tasks
        .coordinate(&route(&case.receipt), &case.basis.worker_id)
        .await
        .unwrap()
}

pub(super) async fn verify(f: &Fixture) {
    // The previously missing order: coordination sees uncertainty before lookup.
    let case = f.case("reconcile-absent-after-wait", true, 0).await;
    let op = f.admit(&case, "reconcile-absent-after-wait-op").await;
    let attempt = f.operations.consume(&case.basis, &op.id).await.unwrap();
    assert_eq!(coordinate(f, &case).await, Decision::Waiting);
    assert_eq!(
        state(f, &case).await,
        (TaskState::Waiting, Cessation::ReconciliationRequired)
    );
    observe(f, &attempt, SourceFact::AuthoritativelyAbsent).await;
    let next = execution(coordinate(f, &case).await);
    assert_eq!(next.cycle_id, case.basis.cycle_id);
    assert_eq!(next.intent_revision, case.basis.intent_revision);
    assert_eq!(next.execution_epoch, case.basis.execution_epoch);
    assert_ne!(next.claim_id, case.basis.claim_id);
    assert_ne!(next.process_instance, case.basis.process_instance);
    assert_eq!(state(f, &case).await, (TaskState::Ready, Cessation::None));
    let retried = f.operations.consume(&next, &op.id).await.unwrap();
    assert_eq!(retried.operation_id, attempt.operation_id);
    assert_ne!(retried.attempt_id, attempt.attempt_id);
    observe(f, &retried, SourceFact::Completed).await;

    // Source completion proves an effect, never a reason to dispatch it again.
    let case = f.case("reconcile-completed-after-wait", true, 0).await;
    let op = f.admit(&case, "reconcile-completed-after-wait-op").await;
    let attempt = f.operations.consume(&case.basis, &op.id).await.unwrap();
    assert_eq!(coordinate(f, &case).await, Decision::Waiting);
    observe(f, &attempt, SourceFact::Completed).await;
    assert_eq!(coordinate(f, &case).await, Decision::Idle);
    assert_eq!(
        state(f, &case).await,
        (TaskState::Waiting, Cessation::Confirmed)
    );
    assert!(f.operations.consume(&case.basis, &op.id).await.is_err());

    // Accepted guidance withdraws the old intent; terminal facts cannot restore it.
    let case = f.case("reconcile-guidance-before-absence", true, 0).await;
    let op = f.admit(&case, "reconcile-guidance-before-absence-op").await;
    let attempt = f.operations.consume(&case.basis, &op.id).await.unwrap();
    assert_eq!(coordinate(f, &case).await, Decision::Waiting);
    f.tasks
        .admit(
            "actor-a",
            &selected("a"),
            &command("reconcile-new-guidance", CommandKind::Guide, &case.receipt),
        )
        .await
        .unwrap();
    observe(f, &attempt, SourceFact::AuthoritativelyAbsent).await;
    // Story 22.2: guidance to a waiting Task resumes its work, but only under the
    // new applied intent. The old intent's operation is never retried.
    let resumed = execution(coordinate(f, &case).await);
    assert!(resumed.intent_revision > case.basis.intent_revision);
    assert_eq!(state(f, &case).await, (TaskState::Ready, Cessation::None));
    assert!(f.operations.consume(&case.basis, &op.id).await.is_err());
    assert!(
        f.operations.consume(&resumed, &op.id).await.is_err(),
        "an operation admitted under the withdrawn intent is not consumable"
    );

    // Every control/terminal-fact combination, on both sides of coordination.
    for control in [CommandKind::Pause, CommandKind::Stop] {
        for fact in [SourceFact::Completed, SourceFact::AuthoritativelyAbsent] {
            for coordinate_first in [false, true] {
                let name = format!(
                    "reconcile-{}-{}-{}",
                    control.as_str(),
                    fact.as_str(),
                    coordinate_first
                );
                let case = f.case(&name, true, 0).await;
                let op = f.admit(&case, &format!("{name}-op")).await;
                let attempt = f.operations.consume(&case.basis, &op.id).await.unwrap();
                f.tasks
                    .admit(
                        "actor-a",
                        &selected("a"),
                        &command(&format!("{name}-control"), control, &case.receipt),
                    )
                    .await
                    .unwrap();
                let expected = if control == CommandKind::Pause {
                    TaskState::Paused
                } else {
                    TaskState::Stopped
                };
                assert_eq!(state(f, &case).await, (expected, Cessation::Pending));
                if coordinate_first {
                    assert_eq!(coordinate(f, &case).await, Decision::Waiting);
                    assert_eq!(
                        state(f, &case).await,
                        (expected, Cessation::ReconciliationRequired)
                    );
                }
                observe(f, &attempt, fact).await;
                assert_eq!(coordinate(f, &case).await, Decision::Idle);
                assert_eq!(state(f, &case).await, (expected, Cessation::Confirmed));
                assert!(f.operations.consume(&case.basis, &op.id).await.is_err());
                let restart = if control == CommandKind::Pause {
                    CommandKind::Resume
                } else {
                    CommandKind::Continue
                };
                let resumed = f
                    .tasks
                    .admit(
                        "actor-a",
                        &selected("a"),
                        &command(&format!("{name}-restart"), restart, &case.receipt),
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    resumed.cycle_id == case.receipt.cycle_id,
                    control == CommandKind::Pause
                );
                assert_eq!(state(f, &case).await, (TaskState::Ready, Cessation::None));
            }
        }
    }

    // An unresolved inert child independently prevents recovery from executing.
    for coordinate_first in [false, true] {
        let name = format!("reconcile-inert-and-external-{coordinate_first}");
        let case = f.case(&name, true, 0).await;
        let inert = f.tasks.consume(&case.basis).await.unwrap();
        let op = f.admit(&case, &format!("{name}-op")).await;
        let attempt = f.operations.consume(&case.basis, &op.id).await.unwrap();
        if coordinate_first {
            assert_eq!(coordinate(f, &case).await, Decision::Waiting);
        }
        observe(f, &attempt, SourceFact::AuthoritativelyAbsent).await;
        if coordinate_first {
            assert_eq!(coordinate(f, &case).await, Decision::Waiting);
            assert_eq!(
                state(f, &case).await,
                (TaskState::Waiting, Cessation::ReconciliationRequired)
            );
        }
        f.tasks
            .observe(&inert, zobba_domain::task::Observation::Completed)
            .await
            .unwrap();
        let next = execution(coordinate(f, &case).await);
        let retried = f.operations.consume(&next, &op.id).await.unwrap();
        observe(f, &retried, SourceFact::Completed).await;
    }

    // Existing guidance cancellation may advance new intent after the old child
    // joins, but neither that basis nor a terminal receipt revives its old work.
    let case = f.case("reconcile-guided-inert", true, 0).await;
    let inert = f.tasks.consume(&case.basis).await.unwrap();
    let op = f.admit(&case, "reconcile-guided-inert-op").await;
    let attempt = f.operations.consume(&case.basis, &op.id).await.unwrap();
    assert_eq!(coordinate(f, &case).await, Decision::Waiting);
    f.tasks
        .admit(
            "actor-a",
            &selected("a"),
            &command(
                "reconcile-guided-inert-guide",
                CommandKind::Guide,
                &case.receipt,
            ),
        )
        .await
        .unwrap();
    observe(f, &attempt, SourceFact::AuthoritativelyAbsent).await;
    f.tasks
        .observe(&inert, zobba_domain::task::Observation::Cancelled)
        .await
        .unwrap();
    let next = execution(coordinate(f, &case).await);
    assert_eq!(next.intent_revision, case.basis.intent_revision + 1);
    assert_eq!(state(f, &case).await, (TaskState::Ready, Cessation::None));
    assert!(f.operations.consume(&next, &op.id).await.is_err());

    // Absence of one effect does not settle another pending effect in this Task.
    let case = f.case("reconcile-two-external", true, 0).await;
    let left = f.admit(&case, "reconcile-two-external-left").await;
    let right = f.admit(&case, "reconcile-two-external-right").await;
    let left = f.operations.consume(&case.basis, &left.id).await.unwrap();
    let right = f.operations.consume(&case.basis, &right.id).await.unwrap();
    assert_eq!(coordinate(f, &case).await, Decision::Waiting);
    observe(f, &left, SourceFact::AuthoritativelyAbsent).await;
    assert_eq!(coordinate(f, &case).await, Decision::Waiting);
    observe(f, &right, SourceFact::Completed).await;
    let next = execution(coordinate(f, &case).await);
    let retry = f
        .operations
        .consume(&next, &left.operation_id)
        .await
        .unwrap();
    observe(f, &retry, SourceFact::Completed).await;
    assert!(
        f.operations
            .consume(&next, &right.operation_id)
            .await
            .is_err()
    );
}
