use super::*;

fn source() -> SourceBinding {
    SourceBinding {
        source_id: "fixture-source".into(),
        ledger_id: "fixture-ledger".into(),
        endpoint_digest: "a".repeat(64),
        contract_version: 1,
    }
}

fn request(purpose: Purpose) -> CanonicalOperation {
    CanonicalOperation {
        version: 1,
        purpose,
        action: Action::Read,
        account_id: "account".into(),
        environment_id: "environment".into(),
        destination: "owned_endpoint".into(),
        recipients: vec![],
        material: "Reviewed material".into(),
        material_digest: "a".repeat(64),
        attachments: vec![],
        resource_id: "resource".into(),
        resource_version: "v1".into(),
        expires_at: 200,
    }
}
fn rule(request: &CanonicalOperation) -> PermissionRule {
    PermissionRule {
        purpose: request.purpose,
        action: request.action,
        account_id: request.account_id.clone(),
        environment_id: request.environment_id.clone(),
        destination: request.destination.clone(),
        resource_id: request.resource_id.clone(),
        recipients: request.recipients.clone(),
        attachment_classifications: vec!["audit".into()],
        expires_at: 300,
    }
}
fn snapshot(request: &CanonicalOperation) -> AuthoritySnapshot {
    let make = |kind, subject: &str| PolicyDocument {
        schema_version: 1,
        kind,
        subject_id: subject.into(),
        version: 1,
        actor_id: "actor".into(),
        created_at: 1,
        revoked: false,
        hard: PermissionBounds {
            rules: vec![rule(request)],
        },
        standing: PermissionBounds {
            rules: vec![rule(request)],
        },
        account: None,
        parent: None,
    };
    let mut account = make(PolicyKind::Account, "account");
    account.account = Some(AccountRestriction {
        source: source(),
        account_id: "account".into(),
        environment_id: "environment".into(),
        environment: match request.purpose {
            Purpose::LiveInspection => EnvironmentKind::Live,
            Purpose::TestWorkflows => EnvironmentKind::Test,
            Purpose::AuditCoordination => EnvironmentKind::Audit,
        },
        read_restriction: ReadRestriction::SourceReadOnly,
        restriction_survives_takeover: true,
        test_environment_verified: true,
        test_resources: vec!["resource".into()],
        test_cleanup_id: Some("cleanup".into()),
        audit_resources: vec!["resource".into()],
    });
    AuthoritySnapshot {
        scope: Scope {
            organisation_id: "org".into(),
            client_id: "client".into(),
            engagement_id: "engagement".into(),
        },
        actor_id: "actor".into(),
        task_id: "task".into(),
        organisation: make(PolicyKind::Organisation, "org"),
        engagement: make(PolicyKind::Engagement, "engagement"),
        member: make(PolicyKind::Member, "actor"),
        account,
        task: make(PolicyKind::Task, "task"),
        delegations: vec![],
    }
}
fn layers(snapshot: &mut AuthoritySnapshot) -> Vec<&mut PolicyDocument> {
    vec![
        &mut snapshot.organisation,
        &mut snapshot.engagement,
        &mut snapshot.member,
        &mut snapshot.account,
        &mut snapshot.task,
    ]
}
fn operation(request: CanonicalOperation) -> Operation {
    Operation {
        source: source(),
        id: "operation".into(),
        task_id: "task".into(),
        cycle_id: "cycle".into(),
        actor_id: "actor".into(),
        request,
        request_digest: "b".repeat(64),
        revision: 1,
        state: OperationState::NeedsDecision,
    }
}

#[test]
fn all_three_purposes_need_their_verified_account_boundary() {
    for purpose in [
        Purpose::LiveInspection,
        Purpose::TestWorkflows,
        Purpose::AuditCoordination,
    ] {
        let request = request(purpose);
        let accepted = snapshot(&request);
        assert_eq!(
            evaluate(&request, &accepted, &accepted, 100),
            PermissionVerdict::Standing
        );
        let mut current = accepted.clone();
        current.account.version += 1;
        current.account.account.as_mut().unwrap().environment_id =
            "same_label_other_environment".into();
        assert_eq!(
            evaluate(&request, &current, &accepted, 100),
            PermissionVerdict::Denied
        );
    }
}

#[test]
fn live_write_and_unrestricted_takeover_remain_hard_denials() {
    for action in [Action::Write, Action::Send] {
        let mut request = request(Purpose::LiveInspection);
        request.action = action;
        request.recipients = vec!["recipient".into()];
        let accepted = snapshot(&request);
        assert_eq!(
            evaluate(&request, &accepted, &accepted, 100),
            PermissionVerdict::Denied
        );
    }
    let request = request(Purpose::LiveInspection);
    for restriction in [
        ReadRestriction::None,
        ReadRestriction::ValidatedAdapter,
        ReadRestriction::SourceReadOnly,
    ] {
        let mut accepted = snapshot(&request);
        let account = accepted.account.account.as_mut().unwrap();
        account.read_restriction = restriction;
        account.restriction_survives_takeover = false;
        assert_eq!(
            evaluate(&request, &accepted, &accepted, 100),
            PermissionVerdict::Denied
        );
    }
}

#[test]
fn test_labels_do_not_replace_verification_scope_or_cleanup() {
    let mut request = request(Purpose::TestWorkflows);
    request.action = Action::Write;
    let accepted = snapshot(&request);
    assert_eq!(
        evaluate(&request, &accepted, &accepted, 100),
        PermissionVerdict::Standing
    );
    for change in 0..4 {
        let mut changed = accepted.clone();
        let account = changed.account.account.as_mut().unwrap();
        match change {
            0 => account.environment = EnvironmentKind::Live,
            1 => account.test_environment_verified = false,
            2 => account.test_resources.clear(),
            _ => account.test_cleanup_id = None,
        }
        assert_eq!(
            evaluate(&request, &changed, &changed, 100),
            PermissionVerdict::Denied
        );
    }
}

#[test]
fn audit_coordination_never_grants_operational_resource_writes() {
    let mut request = request(Purpose::AuditCoordination);
    request.action = Action::Write;
    let mut authority = snapshot(&request);
    assert_eq!(
        evaluate(&request, &authority, &authority, 100),
        PermissionVerdict::Standing
    );
    authority.account.account.as_mut().unwrap().audit_resources = vec!["different_resource".into()];
    assert_eq!(
        evaluate(&request, &authority, &authority, 100),
        PermissionVerdict::Denied
    );
}

#[test]
fn every_required_layer_narrows_immediately_and_widening_cannot_enlarge_acceptance() {
    let request = request(Purpose::LiveInspection);
    for index in 0..5 {
        let accepted = snapshot(&request);
        let mut current = accepted.clone();
        let layer = layers(&mut current).remove(index);
        layer.version += 1;
        layer.hard.rules.clear();
        assert_eq!(
            evaluate(&request, &current, &accepted, 100),
            PermissionVerdict::Denied
        );
        assert_eq!(
            evaluate(&request, &accepted, &current, 100),
            PermissionVerdict::Denied
        );

        let mut accepted = snapshot(&request);
        layers(&mut accepted).remove(index).standing.rules.clear();
        let mut current = accepted.clone();
        let layer = layers(&mut current).remove(index);
        layer.version += 1;
        layer.standing.rules = vec![rule(&request)];
        assert_eq!(
            evaluate(&request, &current, &accepted, 100),
            PermissionVerdict::NeedsDecision
        );
        let mut current = accepted.clone();
        let layer = layers(&mut current).remove(index);
        layer.version += 1;
        layer.revoked = true;
        assert_eq!(
            evaluate(&request, &current, &accepted, 100),
            PermissionVerdict::Denied
        );
    }
}

#[test]
fn accepted_scope_actor_task_and_immutable_versions_cannot_be_substituted() {
    let request = request(Purpose::LiveInspection);
    let accepted = snapshot(&request);
    for change in 0..6 {
        let mut current = accepted.clone();
        match change {
            0 => current.scope.client_id = "other".into(),
            1 => {
                current.actor_id = "other".into();
                current.member.subject_id = "other".into();
            }
            2 => {
                current.task_id = "other".into();
                current.task.subject_id = "other".into();
            }
            3 => current.organisation.actor_id = "rewritten_author".into(),
            4 => current.account.kind = PolicyKind::Member,
            _ => current.engagement.created_at = 101,
        }
        assert_eq!(
            evaluate(&request, &current, &accepted, 100),
            PermissionVerdict::Denied
        );
    }
}

#[test]
fn complete_delegation_chain_is_ordered_versioned_bounded_and_revocable() {
    let request = request(Purpose::LiveInspection);
    let mut accepted = snapshot(&request);
    for index in 0..DELEGATION_MAX {
        let mut child = accepted.task.clone();
        child.kind = PolicyKind::Delegation;
        child.subject_id = format!("child_{index}");
        child.parent = Some(
            accepted
                .delegations
                .last()
                .unwrap_or(&accepted.task)
                .reference(),
        );
        accepted.delegations.push(child);
    }
    assert!(accepted.is_valid());
    assert_eq!(
        evaluate(&request, &accepted, &accepted, 100),
        PermissionVerdict::Standing
    );
    for index in 0..DELEGATION_MAX {
        let mut current = accepted.clone();
        current.delegations[index].revoked = true;
        current.delegations[index].version += 1;
        if index + 1 < DELEGATION_MAX {
            current.delegations[index + 1].parent = Some(current.delegations[index].reference());
        }
        assert_eq!(
            evaluate(&request, &current, &accepted, 100),
            PermissionVerdict::Denied
        );
        let mut current = accepted.clone();
        current.delegations.remove(index);
        assert_eq!(
            evaluate(&request, &current, &accepted, 100),
            PermissionVerdict::Denied
        );
    }
    let mut cycle = accepted.clone();
    cycle.delegations[0].parent = Some(cycle.delegations[1].reference());
    assert!(!cycle.is_valid());
    accepted
        .delegations
        .push(accepted.delegations.last().unwrap().clone());
    assert!(!accepted.is_valid());
}

#[test]
fn decisions_bind_every_material_field_revision_and_expiry() {
    let mut original = request(Purpose::AuditCoordination);
    original.action = Action::Send;
    original.recipients = vec!["recipient".into()];
    original.attachments = vec![Attachment {
        id: "attachment".into(),
        digest: "b".repeat(64),
        classification: "audit".into(),
    }];
    let operation = operation(original.clone());
    let decision = DecisionCommand {
        key: "key".into(),
        operation_id: operation.id.clone(),
        expected_revision: 1,
        request: original,
        expires_at: 150,
        allow: true,
    };
    assert!(decision.matches(&operation, 100));
    for change in 0..15 {
        let mut changed = decision.clone();
        match change {
            0 => changed.request.version = 2,
            1 => changed.request.purpose = Purpose::TestWorkflows,
            2 => changed.request.action = Action::Write,
            3 => changed.request.account_id = "other".into(),
            4 => changed.request.environment_id = "other".into(),
            5 => changed.request.destination = "other".into(),
            6 => changed.request.recipients[0] = "other".into(),
            7 => changed.request.material.push(' '),
            8 => changed.request.material_digest = "c".repeat(64),
            9 => changed.request.attachments[0].id = "other".into(),
            10 => changed.request.attachments[0].digest = "d".repeat(64),
            11 => changed.request.attachments[0].classification = "other".into(),
            12 => changed.request.resource_id = "other".into(),
            13 => changed.request.resource_version = "v2".into(),
            _ => changed.request.expires_at += 1,
        }
        assert!(!changed.matches(&operation, 100), "field {change}");
        if changed.request.is_valid() {
            assert_ne!(
                changed.request.canonical_bytes(),
                decision.request.canonical_bytes()
            );
        }
    }
    assert!(!decision.matches(&operation, 150));
    assert!(!decision.matches(&operation, 0));
    let mut stale = operation.clone();
    stale.revision += 1;
    assert!(!decision.matches(&stale, 100));
    for state in [
        OperationState::PossiblyDispatched,
        OperationState::Accepted,
        OperationState::Completed,
        OperationState::Absent,
        OperationState::Revoked,
    ] {
        stale.revision = 1;
        stale.state = state;
        assert!(!decision.matches(&stale, 100));
    }
}

#[test]
fn malformed_unbounded_and_ambiguous_requests_have_no_canonical_encoding() {
    for change in 0..9 {
        let mut request = request(Purpose::LiveInspection);
        match change {
            0 => request.recipients = vec!["z".into(), "a".into()],
            1 => request.recipients = vec!["same".into(), "same".into()],
            2 => request.material = "x".repeat(MATERIAL_MAX + 1),
            3 => request.material = "secret\0field".into(),
            4 => request.material_digest = "A".repeat(64),
            5 => request.destination = "https://caller.invalid/path".into(),
            6 => request.account_id = "a".repeat(129),
            7 => request.expires_at = MAX_TIMESTAMP + 1,
            _ => {
                request.attachments = vec![
                    Attachment {
                        id: "same".into(),
                        digest: "a".repeat(64),
                        classification: "audit".into()
                    };
                    2
                ]
            }
        }
        assert!(!request.is_valid());
        assert!(request.canonical_bytes().is_none());
    }
    let mut first = request(Purpose::LiveInspection);
    first.account_id = "ab".into();
    first.environment_id = "c".into();
    let mut second = first.clone();
    second.account_id = "a".into();
    second.environment_id = "bc".into();
    assert_ne!(first.canonical_bytes(), second.canonical_bytes());
}

#[test]
fn expiry_and_attachment_recipient_bounds_apply_to_all_policy_layers() {
    let mut request = request(Purpose::AuditCoordination);
    request.action = Action::Send;
    request.recipients = vec!["recipient".into()];
    request.attachments = vec![Attachment {
        id: "attachment".into(),
        digest: "a".repeat(64),
        classification: "audit".into(),
    }];
    let authority = snapshot(&request);
    assert_eq!(
        evaluate(&request, &authority, &authority, 100),
        PermissionVerdict::Standing
    );
    assert_eq!(
        evaluate(&request, &authority, &authority, 200),
        PermissionVerdict::Denied
    );
    for change in 0..3 {
        let mut changed = authority.clone();
        let rule = &mut changed.organisation.hard.rules[0];
        match change {
            0 => rule.recipients.clear(),
            1 => rule.attachment_classifications.clear(),
            _ => rule.expires_at = 199,
        }
        assert_eq!(
            evaluate(&request, &changed, &changed, 100),
            PermissionVerdict::Denied
        );
    }
}

#[test]
fn source_facts_never_infer_completion_or_absence_from_pending() {
    assert!(!SourceFact::Unknown.is_resolved());
    assert!(!SourceFact::Accepted.is_resolved());
    assert!(SourceFact::Completed.is_resolved());
    assert!(SourceFact::AuthoritativelyAbsent.is_resolved());
    assert!(SourceFact::Accepted.can_follow(SourceFact::Unknown));
    assert!(SourceFact::Completed.can_follow(SourceFact::Accepted));
    assert!(!SourceFact::AuthoritativelyAbsent.can_follow(SourceFact::Accepted));
    assert!(!SourceFact::Unknown.can_follow(SourceFact::Completed));
    assert!(!SourceFact::Completed.can_follow(SourceFact::AuthoritativelyAbsent));
}
