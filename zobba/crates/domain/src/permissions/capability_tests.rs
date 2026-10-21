use super::*;

fn request(purpose: Purpose, action: Action) -> CanonicalOperation {
    CanonicalOperation {
        version: OPERATION_VERSION,
        purpose,
        action,
        account_id: "account".into(),
        environment_id: "environment".into(),
        destination: "owned_endpoint".into(),
        recipients: if action == Action::Send {
            vec!["a".into()]
        } else {
            vec![]
        },
        material: "Exact reviewed material".into(),
        material_digest: "a".repeat(64),
        attachments: vec![],
        resource_id: "resource".into(),
        resource_version: "version".into(),
        expires_at: 200,
    }
}

fn need(request: &CanonicalOperation) -> CapabilityNeed {
    let mut classifications: Vec<_> = request
        .attachments
        .iter()
        .map(|a| a.classification.clone())
        .collect();
    classifications.sort();
    classifications.dedup();
    CapabilityNeed {
        purpose: request.purpose,
        action: request.action,
        account_id: Some(request.account_id.clone()),
        environment_id: Some(request.environment_id.clone()),
        destination: Some(request.destination.clone()),
        resource_id: Some(request.resource_id.clone()),
        recipients: request.recipients.clone(),
        attachment_classifications: classifications,
        requires_attachments: !request.attachments.is_empty(),
        source: None,
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
        recipients: vec!["a".into(), "b".into()],
        attachment_classifications: vec!["x".into(), "y".into()],
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
        source: SourceBinding {
            source_id: "source".into(),
            ledger_id: "ledger".into(),
            endpoint_digest: "a".repeat(64),
            contract_version: 1,
        },
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

fn documents(snapshot: &mut AuthoritySnapshot) -> impl Iterator<Item = &mut PolicyDocument> {
    [
        &mut snapshot.organisation,
        &mut snapshot.engagement,
        &mut snapshot.member,
        &mut snapshot.account,
        &mut snapshot.task,
    ]
    .into_iter()
    .chain(snapshot.delegations.iter_mut())
}

fn delegate(snapshot: &mut AuthoritySnapshot) {
    for index in 0..DELEGATION_MAX {
        let mut child = snapshot.task.clone();
        child.kind = PolicyKind::Delegation;
        child.subject_id = format!("child_{index}");
        child.parent = Some(
            snapshot
                .delegations
                .last()
                .unwrap_or(&snapshot.task)
                .reference(),
        );
        snapshot.delegations.push(child);
    }
}

fn bump_chain(snapshot: &mut AuthoritySnapshot) {
    for document in documents(snapshot) {
        document.version += 1;
    }
    let mut parent = snapshot.task.reference();
    for document in &mut snapshot.delegations {
        document.parent = Some(parent);
        parent = document.reference();
    }
}

fn result(need: &CapabilityNeed, authority: &AuthoritySnapshot) -> CapabilityInspection {
    inspect_capability(need, authority, authority, 100)
}

#[test]
fn equal_action_does_not_join_different_whole_tuples() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let mut need = need(&request);
    need.account_id = None;
    need.environment_id = None;
    need.destination = None;
    need.resource_id = None;
    for field in 0..4 {
        let mut authority = snapshot(&request);
        let different = &mut authority.engagement.hard.rules[0];
        match field {
            0 => different.account_id = "other".into(),
            1 => different.environment_id = "other".into(),
            2 => different.destination = "other".into(),
            _ => different.resource_id = "other".into(),
        }
        let inspection = result(&need, &authority);
        assert_eq!(
            inspection.status,
            CapabilityStatus::Forbidden,
            "field {field}"
        );
        assert_eq!(inspection.refresh_at, None);
    }
}

#[test]
fn unrelated_account_alternatives_do_not_hide_the_eliminating_hard_bound() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let mut authority = snapshot(&request);
    let mut other_resource = rule(&request);
    other_resource.resource_id = "resource_b".into();
    let mut other_account = rule(&request);
    other_account.account_id = "other".into();
    other_account.resource_id = "resource_c".into();
    authority.engagement.hard.rules = vec![other_resource, other_account];
    let mut need = need(&request);
    need.account_id = None;
    need.resource_id = None;
    let inspection = result(&need, &authority);
    assert_eq!(inspection.status, CapabilityStatus::Forbidden);
    assert_eq!(inspection.reason, CapabilityReason::HardBounds);
    assert_eq!(
        inspection.blocking_bound,
        Some(CapabilityBound {
            accepted: true,
            kind: PolicyKind::Engagement,
            delegation_depth: None,
        })
    );
}

#[test]
fn optional_tuple_fields_narrow_and_never_create_authority() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let authority = snapshot(&request);
    for field in 0..4 {
        let mut need = need(&request);
        match field {
            0 => need.account_id = Some("other".into()),
            1 => need.environment_id = Some("other".into()),
            2 => need.destination = Some("other".into()),
            _ => need.resource_id = Some("other".into()),
        }
        assert_eq!(
            result(&need, &authority).status,
            CapabilityStatus::Forbidden
        );
    }
}

#[test]
fn alternative_rule_recipient_and_classification_correlation_survives_intersection() {
    let request = request(Purpose::AuditCoordination, Action::Send);
    let mut authority = snapshot(&request);
    let mut ax = rule(&request);
    ax.recipients = vec!["a".into()];
    ax.attachment_classifications = vec!["x".into()];
    let mut by = rule(&request);
    by.recipients = vec!["b".into()];
    by.attachment_classifications = vec!["y".into()];
    let mut ay = ax.clone();
    ay.attachment_classifications = vec!["y".into()];
    authority.organisation.hard.rules = vec![ax, by];
    authority.engagement.hard.rules = vec![ay];
    let mut need = need(&request);
    need.recipients.clear();
    need.requires_attachments = true;
    assert_eq!(
        result(&need, &authority).status,
        CapabilityStatus::Forbidden
    );
    need.requires_attachments = false;
    assert_eq!(
        result(&need, &authority).status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    need.attachment_classifications = vec!["y".into()];
    assert_eq!(
        result(&need, &authority).status,
        CapabilityStatus::Forbidden
    );
}

#[test]
fn send_requires_a_common_recipient_even_when_details_are_unknown() {
    let request = request(Purpose::AuditCoordination, Action::Send);
    let mut authority = snapshot(&request);
    authority.organisation.hard.rules[0].recipients = vec!["a".into()];
    authority.engagement.hard.rules[0].recipients = vec!["b".into()];
    let mut need = need(&request);
    need.recipients.clear();
    assert_eq!(
        result(&need, &authority).status,
        CapabilityStatus::Forbidden
    );
    for document in documents(&mut authority) {
        document.hard.rules[0].action = Action::Read;
    }
    need.action = Action::Read;
    assert_eq!(
        result(&need, &authority).status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
}

#[test]
fn attachment_free_possibility_does_not_prove_required_attachment_coverage() {
    let request = request(Purpose::AuditCoordination, Action::Read);
    let mut authority = snapshot(&request);
    authority.organisation.hard.rules[0].attachment_classifications = vec!["x".into()];
    authority.engagement.hard.rules[0].attachment_classifications = vec!["y".into()];
    let mut need = need(&request);
    assert_eq!(
        result(&need, &authority).status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    need.requires_attachments = true;
    assert_eq!(
        result(&need, &authority).status,
        CapabilityStatus::Forbidden
    );
    need.requires_attachments = false;
    need.attachment_classifications = vec!["x".into()];
    assert_eq!(
        result(&need, &authority).status,
        CapabilityStatus::Forbidden
    );
}

#[test]
fn current_widening_never_replaces_accepted_bounds_and_standing_is_only_advisory() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let mut accepted = snapshot(&request);
    accepted.task.hard.rules[0].resource_id = "old".into();
    let mut current = accepted.clone();
    current.task.version += 1;
    current.task.hard.rules.push(rule(&request));
    assert_eq!(
        inspect_capability(&need(&request), &current, &accepted, 100).status,
        CapabilityStatus::Forbidden
    );
    let mut accepted = snapshot(&request);
    for document in documents(&mut accepted) {
        document.standing.rules.clear();
    }
    let mut current = accepted.clone();
    bump_chain(&mut current);
    for document in documents(&mut current) {
        document.standing.rules = vec![rule(&request)];
    }
    let inspection = inspect_capability(&need(&request), &current, &accepted, 100);
    assert_eq!(
        inspection.status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    assert_eq!(inspection.reason, CapabilityReason::ExactDetailsRequired);
    assert_eq!(
        evaluate(&request, &current, &accepted, 100),
        PermissionVerdict::NeedsDecision
    );
}

#[test]
fn every_accepted_and_current_hard_bound_can_remove_candidates() {
    let request = request(Purpose::LiveInspection, Action::Read);
    for index in 0..5 + DELEGATION_MAX {
        for accepted_narrows in [false, true] {
            let mut accepted = snapshot(&request);
            delegate(&mut accepted);
            let mut current = accepted.clone();
            bump_chain(&mut current);
            let changed = if accepted_narrows {
                &mut accepted
            } else {
                &mut current
            };
            let document = documents(changed).nth(index).unwrap();
            document.hard.rules.clear();
            let kind = document.kind;
            let inspection = inspect_capability(&need(&request), &current, &accepted, 100);
            assert_eq!(
                inspection.status,
                CapabilityStatus::Forbidden,
                "index {index}"
            );
            assert_eq!(
                inspection.blocking_bound,
                Some(CapabilityBound {
                    accepted: accepted_narrows,
                    kind,
                    delegation_depth: index.checked_sub(5),
                })
            );
        }
    }
}

#[test]
fn every_ancestor_expiry_sets_the_refresh_deadline_and_expires_at_the_boundary() {
    let request = request(Purpose::LiveInspection, Action::Read);
    for index in 0..5 + DELEGATION_MAX {
        let mut accepted = snapshot(&request);
        delegate(&mut accepted);
        documents(&mut accepted).nth(index).unwrap().hard.rules[0].expires_at = 101;
        let compatible = inspect_capability(&need(&request), &accepted, &accepted, 100);
        assert_eq!(
            compatible.status,
            CapabilityStatus::CompatibleNeedsExactDetails
        );
        assert_eq!(compatible.refresh_at, Some(101));
        assert_eq!(
            inspect_capability(&need(&request), &accepted, &accepted, 101).status,
            CapabilityStatus::Forbidden
        );
    }
}

#[test]
fn revocations_replaced_identities_and_incomplete_chains_fail_closed() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let mut accepted = snapshot(&request);
    delegate(&mut accepted);
    for index in 0..5 + DELEGATION_MAX {
        let mut current = accepted.clone();
        bump_chain(&mut current);
        documents(&mut current).nth(index).unwrap().revoked = true;
        let inspection = inspect_capability(&need(&request), &current, &accepted, 100);
        assert_eq!(inspection.status, CapabilityStatus::Forbidden);
        assert_eq!(inspection.reason, CapabilityReason::AuthorityRevoked);
    }
    let mut current = accepted.clone();
    current.delegations.pop();
    assert_eq!(
        inspect_capability(&need(&request), &current, &accepted, 100).reason,
        CapabilityReason::AuthorityReplaced
    );
    let mut current = accepted.clone();
    current.delegations.remove(0);
    assert_eq!(
        inspect_capability(&need(&request), &current, &accepted, 100).status,
        CapabilityStatus::Unavailable
    );
    let mut current = accepted.clone();
    current.delegations[1].parent = Some(current.task.reference());
    assert_eq!(
        inspect_capability(&need(&request), &current, &accepted, 100).status,
        CapabilityStatus::Unavailable
    );
    let mut current = accepted.clone();
    bump_chain(&mut current);
    current.delegations[0].subject_id = "replacement".into();
    current.delegations[1].parent = Some(current.delegations[0].reference());
    assert!(current.is_valid());
    assert_eq!(
        inspect_capability(&need(&request), &current, &accepted, 100).reason,
        CapabilityReason::AuthorityReplaced
    );
}

#[test]
fn changed_actor_scope_task_and_same_version_tampering_are_never_compatible() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let accepted = snapshot(&request);
    for change in 0..7 {
        let mut current = accepted.clone();
        let expected = match change {
            0 => {
                current.actor_id = "other".into();
                current.member.subject_id = "other".into();
                CapabilityReason::AuthorityReplaced
            }
            1 => {
                current.scope.client_id = "other".into();
                CapabilityReason::AuthorityReplaced
            }
            2 => {
                current.task_id = "other".into();
                current.task.subject_id = "other".into();
                CapabilityReason::AuthorityReplaced
            }
            3 => {
                current.task.actor_id = "other".into();
                CapabilityReason::AuthorityIntegrity
            }
            4 => {
                current.task.version += 1;
                current.task.created_at = 101;
                CapabilityReason::AuthorityIntegrity
            }
            5 => {
                current.task.schema_version = 2;
                CapabilityReason::InvalidAuthority
            }
            _ => {
                current
                    .task
                    .hard
                    .rules
                    .push(current.task.hard.rules[0].clone());
                CapabilityReason::AuthorityIntegrity
            }
        };
        let inspection = inspect_capability(&need(&request), &current, &accepted, 100);
        assert_eq!(inspection.reason, expected, "change {change}");
        assert_eq!(
            evaluate(&request, &current, &accepted, 100),
            PermissionVerdict::Denied
        );
    }
    let mut newer_accepted = accepted.clone();
    newer_accepted.task.version += 1;
    assert_eq!(
        inspect_capability(&need(&request), &accepted, &newer_accepted, 100).reason,
        CapabilityReason::AuthorityIntegrity
    );
}

#[test]
fn complete_pair_integrity_is_checked_before_interpreting_revocation() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let accepted = snapshot(&request);
    let mut current = accepted.clone();
    current.organisation.version += 1;
    current.organisation.revoked = true;
    current.task.actor_id = "rewritten".into();
    let inspection = inspect_capability(&need(&request), &current, &accepted, 100);
    assert_eq!(inspection.status, CapabilityStatus::Unavailable);
    assert_eq!(inspection.reason, CapabilityReason::AuthorityIntegrity);
    assert_eq!(
        evaluate(&request, &current, &accepted, 100),
        PermissionVerdict::Denied
    );
}

#[test]
fn every_source_binding_component_and_trusted_adapter_constraint_is_checked() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let accepted = snapshot(&request);
    for change in 0..4 {
        let mut current = accepted.clone();
        current.account.version += 1;
        let source = &mut current.account.account.as_mut().unwrap().source;
        match change {
            0 => source.source_id = "other".into(),
            1 => source.ledger_id = "other".into(),
            2 => source.endpoint_digest = "b".repeat(64),
            _ => source.contract_version = 2,
        }
        let inspection = inspect_capability(&need(&request), &current, &accepted, 100);
        assert_eq!(
            inspection.reason,
            if change == 3 {
                CapabilityReason::InvalidAuthority
            } else {
                CapabilityReason::SourceChanged
            }
        );
        assert_eq!(
            evaluate(&request, &current, &accepted, 100),
            PermissionVerdict::Denied
        );
    }
    let mut need = need(&request);
    need.source = Some(accepted.account.account.as_ref().unwrap().source.clone());
    assert_eq!(
        result(&need, &accepted).status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    need.source.as_mut().unwrap().ledger_id = "other".into();
    assert_eq!(
        result(&need, &accepted).reason,
        CapabilityReason::SourceMismatch
    );
}

#[test]
fn live_test_and_audit_account_boundaries_match_exact_evaluation() {
    for purpose in [
        Purpose::LiveInspection,
        Purpose::TestWorkflows,
        Purpose::AuditCoordination,
    ] {
        for change in 0..8 {
            let request = request(purpose, Action::Read);
            let accepted = snapshot(&request);
            let mut current = accepted.clone();
            current.account.version += 1;
            let account = current.account.account.as_mut().unwrap();
            let applicable = match change {
                0 => {
                    account.environment_id = "other".into();
                    true
                }
                1 => {
                    account.environment = match purpose {
                        Purpose::LiveInspection => EnvironmentKind::Test,
                        _ => EnvironmentKind::Live,
                    };
                    true
                }
                2 => {
                    account.read_restriction = ReadRestriction::None;
                    purpose == Purpose::LiveInspection
                }
                3 => {
                    account.restriction_survives_takeover = false;
                    purpose == Purpose::LiveInspection
                }
                4 => {
                    account.test_environment_verified = false;
                    purpose == Purpose::TestWorkflows
                }
                5 => {
                    account.test_resources.clear();
                    purpose == Purpose::TestWorkflows
                }
                6 => {
                    account.test_cleanup_id = None;
                    purpose == Purpose::TestWorkflows
                }
                _ => {
                    account.audit_resources.clear();
                    purpose == Purpose::AuditCoordination
                }
            };
            let inspection = inspect_capability(&need(&request), &current, &accepted, 100);
            if applicable {
                assert_eq!(
                    inspection.status,
                    CapabilityStatus::Forbidden,
                    "{purpose:?}, {change}"
                );
                assert_eq!(inspection.reason, CapabilityReason::AccountBoundary);
                assert_eq!(
                    inspection.blocking_bound,
                    Some(CapabilityBound {
                        accepted: false,
                        kind: PolicyKind::Account,
                        delegation_depth: None,
                    })
                );
                assert_eq!(
                    evaluate(&request, &current, &accepted, 100),
                    PermissionVerdict::Denied
                );
            } else {
                assert_eq!(
                    inspection.status,
                    CapabilityStatus::CompatibleNeedsExactDetails
                );
                assert_eq!(
                    evaluate(&request, &current, &accepted, 100),
                    PermissionVerdict::Standing
                );
            }
        }
    }
    for action in [Action::Write, Action::Send] {
        let request = request(Purpose::LiveInspection, action);
        let authority = snapshot(&request);
        assert_eq!(
            result(&need(&request), &authority).reason,
            CapabilityReason::AccountBoundary
        );
    }
}

#[test]
fn malformed_needs_and_untrusted_time_are_unavailable() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let authority = snapshot(&request);
    for change in 0..5 {
        let mut need = need(&request);
        match change {
            0 => need.destination = Some("https://caller.invalid".into()),
            1 => need.recipients = vec!["b".into(), "a".into()],
            2 => need.attachment_classifications = vec!["x".into(), "x".into()],
            3 => need.recipients = (0..SET_MAX + 1).map(|v| format!("r{v:02}")).collect(),
            _ => {
                need.source = Some(authority.account.account.as_ref().unwrap().source.clone());
                need.source.as_mut().unwrap().contract_version = 0;
            }
        }
        assert_eq!(
            result(&need, &authority).reason,
            CapabilityReason::InvalidNeed
        );
    }
    for now in [-1, 0, MAX_TIMESTAMP + 1] {
        assert_eq!(
            inspect_capability(&need(&request), &authority, &authority, now).status,
            CapabilityStatus::Unavailable
        );
    }
}

#[test]
fn same_tuple_dominance_requires_both_sets_and_a_later_deadline() {
    let request = request(Purpose::AuditCoordination, Action::Send);
    let mut authority = snapshot(&request);
    let outer = rule(&request);
    let mut inner = outer.clone();
    inner.recipients = vec!["a".into()];
    inner.attachment_classifications = vec!["x".into()];
    inner.expires_at = 150;
    authority.organisation.hard.rules = vec![inner.clone(), outer.clone(), outer.clone()];
    let inspection = result(&need(&request), &authority);
    assert_eq!(
        inspection.status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    assert_eq!(inspection.refresh_at, Some(300));
    let mut later_inner = inner.clone();
    later_inner.expires_at = 400;
    assert!(!region_contains(&outer, &later_inner, 100));
    let mut different_class = inner.clone();
    different_class.attachment_classifications = vec!["z".into()];
    assert!(!region_contains(&outer, &different_class, 100));
    let mut different_recipient = inner;
    different_recipient.recipients = vec!["z".into()];
    assert!(!region_contains(&outer, &different_recipient, 100));
}

#[test]
fn explicit_comparison_and_region_exhaustion_are_unavailable_never_forbidden() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let authority = snapshot(&request);
    for mut budget in [
        CapabilityBudget {
            regions: 256,
            comparisons: 0,
        },
        CapabilityBudget {
            regions: 0,
            comparisons: 65_536,
        },
    ] {
        let inspection =
            inspect_capability_bounded(&need(&request), &authority, &authority, 100, &mut budget);
        assert_eq!(inspection.status, CapabilityStatus::Unavailable);
        assert_eq!(inspection.reason, CapabilityReason::QueryCapacity);
        assert_eq!(inspection.refresh_at, None);
    }
}

#[test]
fn request_work_budget_is_shared_across_needs_and_charges_only_consumed_work() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let authority = snapshot(&request);
    let first_need = need(&request);
    let mut second_need = first_need.clone();
    second_need.resource_id = None;
    let mut measured = CAPABILITY_COMPARISONS_MAX;
    let expected = inspect_capability_with_work_budget(
        &first_need,
        &authority,
        &authority,
        100,
        &mut measured,
    );
    let one_need_work = CAPABILITY_COMPARISONS_MAX - measured;
    assert!(one_need_work > 1 && one_need_work < CAPABILITY_COMPARISONS_MAX);
    assert_eq!(
        expected,
        inspect_capability(&first_need, &authority, &authority, 100)
    );
    let mut shared = 2 * one_need_work - 1;
    assert_eq!(
        inspect_capability_with_work_budget(&first_need, &authority, &authority, 100, &mut shared,),
        expected
    );
    assert_eq!(shared, one_need_work - 1);
    let exhausted =
        inspect_capability_with_work_budget(&second_need, &authority, &authority, 100, &mut shared);
    assert_eq!(exhausted.status, CapabilityStatus::Unavailable);
    assert_eq!(exhausted.reason, CapabilityReason::QueryCapacity);
    assert_eq!(shared, 0);
    assert_eq!(
        inspect_capability_with_work_budget(&first_need, &authority, &authority, 100, &mut shared,),
        exhausted
    );
    assert_eq!(shared, 0);
}

#[test]
fn early_policy_refusal_preserves_the_unused_request_budget() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let authority = snapshot(&request);
    let mut exact_need = need(&request);
    let mut full_remaining = CAPABILITY_COMPARISONS_MAX;
    assert_eq!(
        inspect_capability_with_work_budget(
            &exact_need,
            &authority,
            &authority,
            100,
            &mut full_remaining,
        )
        .status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    exact_need.resource_id = Some("outside-permitted-resource".into());
    let mut remaining = CAPABILITY_COMPARISONS_MAX;
    let forbidden = inspect_capability_with_work_budget(
        &exact_need,
        &authority,
        &authority,
        100,
        &mut remaining,
    );
    assert_eq!(forbidden.status, CapabilityStatus::Forbidden);
    assert_eq!(forbidden.reason, CapabilityReason::HardBounds);
    assert!(remaining > full_remaining && remaining < CAPABILITY_COMPARISONS_MAX);
    let before_invalid = remaining;
    exact_need.resource_id = Some("invalid resource".into());
    assert_eq!(
        inspect_capability_with_work_budget(
            &exact_need,
            &authority,
            &authority,
            100,
            &mut remaining,
        )
        .reason,
        CapabilityReason::InvalidNeed
    );
    assert_eq!(remaining, before_invalid);
}

#[test]
fn exhausted_projection_budget_retains_structural_and_source_refusals() {
    let request = request(Purpose::LiveInspection, Action::Read);
    let accepted = snapshot(&request);
    for change in 0..3 {
        let mut current = accepted.clone();
        let expected = match change {
            0 => {
                current.task.version += 1;
                current.task.revoked = true;
                CapabilityReason::AuthorityRevoked
            }
            1 => {
                current.account.version += 1;
                current.account.account.as_mut().unwrap().source.ledger_id = "replacement".into();
                CapabilityReason::SourceChanged
            }
            _ => {
                current.task.actor_id = "tampered".into();
                CapabilityReason::AuthorityIntegrity
            }
        };
        let mut remaining = 0;
        let inspection = inspect_capability_with_work_budget(
            &need(&request),
            &current,
            &accepted,
            100,
            &mut remaining,
        );
        assert_eq!(inspection.reason, expected);
        assert_eq!(
            inspection.status,
            if change == 2 {
                CapabilityStatus::Unavailable
            } else {
                CapabilityStatus::Forbidden
            }
        );
        assert_eq!(remaining, 0);
    }
    let mut empty = accepted.clone();
    empty.organisation.hard.rules.clear();
    let mut remaining = 0;
    let inspection =
        inspect_capability_with_work_budget(&need(&request), &empty, &empty, 100, &mut remaining);
    assert_eq!(inspection.status, CapabilityStatus::Forbidden);
    assert_eq!(inspection.reason, CapabilityReason::HardBounds);
    assert_eq!(remaining, 0);
}

#[test]
fn explicit_account_refusals_survive_zero_and_consumed_shared_projection_budgets() {
    let request = request(Purpose::TestWorkflows, Action::Read);
    let baseline = snapshot(&request);
    for change in 0..9 {
        let mut accepted = baseline.clone();
        let mut current = baseline.clone();
        current.account.version += 1;
        let mut required = need(&request);
        let blocked_by_accepted = match change {
            0 => {
                required.account_id = Some("another-account".into());
                true
            }
            1 => {
                required.environment_id = Some("another-environment".into());
                true
            }
            2 => {
                current.account.account.as_mut().unwrap().environment_id = "replacement".into();
                false
            }
            3 => {
                accepted
                    .account
                    .account
                    .as_mut()
                    .unwrap()
                    .test_resources
                    .clear();
                required.resource_id = None;
                true
            }
            4 => {
                current.account.account.as_mut().unwrap().test_resources = vec!["other".into()];
                false
            }
            5 => {
                required.resource_id = Some("other".into());
                true
            }
            6 => {
                current
                    .account
                    .account
                    .as_mut()
                    .unwrap()
                    .test_environment_verified = false;
                false
            }
            7 => {
                current.account.account.as_mut().unwrap().test_cleanup_id = None;
                false
            }
            _ => {
                required.purpose = Purpose::LiveInspection;
                true
            }
        };
        for starting_budget in [0, 1, CAPABILITY_COMPARISONS_MAX] {
            let mut remaining = starting_budget;
            if starting_budget == 1 {
                let earlier = inspect_capability_with_work_budget(
                    &need(&request),
                    &baseline,
                    &baseline,
                    100,
                    &mut remaining,
                );
                assert_eq!(earlier.reason, CapabilityReason::QueryCapacity);
                assert_eq!(remaining, 0, "an earlier need consumed the shared budget");
            }
            let before = remaining;
            let inspection = inspect_capability_with_work_budget(
                &required,
                &current,
                &accepted,
                100,
                &mut remaining,
            );
            assert_eq!(
                inspection.status,
                CapabilityStatus::Forbidden,
                "case {change}"
            );
            assert_eq!(inspection.reason, CapabilityReason::AccountBoundary);
            assert_eq!(
                inspection.blocking_bound,
                Some(CapabilityBound {
                    accepted: blocked_by_accepted,
                    kind: PolicyKind::Account,
                    delegation_depth: None,
                })
            );
            assert_eq!(remaining, before, "account proof needs no projection work");
        }
    }
}

#[test]
fn account_projection_shortcut_never_overrides_malformed_authority() {
    let request = request(Purpose::TestWorkflows, Action::Read);
    let mut accepted = snapshot(&request);
    delegate(&mut accepted);
    let mut required = need(&request);
    required.account_id = Some("another-account".into());
    for invalid_record in [false, true] {
        let mut current = accepted.clone();
        if invalid_record {
            current.delegations.last_mut().unwrap().actor_id = "invalid actor".into();
        } else {
            current.delegations.last_mut().unwrap().actor_id = "tampered".into();
        }
        for mut remaining in [0, CAPABILITY_COMPARISONS_MAX] {
            let before = remaining;
            let inspection = inspect_capability_with_work_budget(
                &required,
                &current,
                &accepted,
                100,
                &mut remaining,
            );
            assert_eq!(inspection.status, CapabilityStatus::Unavailable);
            assert_eq!(
                inspection.reason,
                if invalid_record {
                    CapabilityReason::InvalidAuthority
                } else {
                    CapabilityReason::AuthorityIntegrity
                }
            );
            assert_eq!(inspection.blocking_bound, None);
            assert_eq!(remaining, before);
        }
    }
}

#[test]
fn valid_policy_alternatives_can_exceed_the_fixed_projection_capacity() {
    let request = request(Purpose::AuditCoordination, Action::Send);
    let mut authority = snapshot(&request);
    let recipients: Vec<String> = (0..16).map(|v| format!("r{v:02}")).collect();
    let classifications: Vec<String> = (0..8).map(|v| format!("c{v}")).collect();
    for document in documents(&mut authority) {
        document.hard.rules[0].recipients = recipients.clone();
        document.hard.rules[0].attachment_classifications = classifications.clone();
    }
    for group in 0..3 {
        let document = documents(&mut authority).nth(group).unwrap();
        let all = document.hard.rules[0].clone();
        document.hard.rules = (0..8)
            .map(|index| {
                let mut rule = all.clone();
                if group < 2 {
                    rule.recipients.remove(index + group * 8);
                } else {
                    rule.attachment_classifications.remove(index);
                }
                rule
            })
            .collect();
    }
    assert!(authority.is_valid());
    let mut need = need(&request);
    need.recipients.clear();
    need.requires_attachments = true;
    let inspection = result(&need, &authority);
    assert_eq!(inspection.status, CapabilityStatus::Unavailable);
    assert_eq!(inspection.reason, CapabilityReason::QueryCapacity);
    let initial_budget = 2 * CAPABILITY_COMPARISONS_MAX;
    let mut shared = initial_budget;
    assert_eq!(
        inspect_capability_with_work_budget(&need, &authority, &authority, 100, &mut shared,),
        inspection
    );
    assert!(
        shared < initial_budget,
        "capacity refusal charges actual work"
    );
    assert!(
        shared >= CAPABILITY_COMPARISONS_MAX,
        "one need cannot consume the next need's per-call allowance"
    );
    // A bounded refusal does not discard unused request capacity needed to
    // inspect another, simpler need; nor does it replenish consumed capacity.
    let simple = snapshot(&request);
    let mut simple_need = need.clone();
    simple_need.requires_attachments = false;
    let before_simple = shared;
    assert_eq!(
        inspect_capability_with_work_budget(&simple_need, &simple, &simple, 100, &mut shared,)
            .status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    assert!(shared < before_simple);
}

#[test]
fn complete_operation_corpus_obeys_exact_and_projected_cross_contract() {
    let mut permitted = 0;
    let mut forbidden = 0;
    for purpose in [
        Purpose::LiveInspection,
        Purpose::TestWorkflows,
        Purpose::AuditCoordination,
    ] {
        for action in [Action::Read, Action::Write, Action::Send] {
            for recipients in [
                vec![],
                vec!["a".into()],
                vec!["b".into()],
                vec!["a".into(), "b".into()],
            ] {
                for classes in [vec![], vec!["x"], vec!["y"], vec!["x", "y"]] {
                    let mut request = request(purpose, action);
                    request.recipients = recipients.clone();
                    request.attachments = classes
                        .into_iter()
                        .enumerate()
                        .map(|(index, classification)| Attachment {
                            id: format!("attachment_{index}"),
                            digest: "b".repeat(64),
                            classification: classification.into(),
                        })
                        .collect();
                    if !request.is_valid() {
                        continue;
                    }
                    for missing_standing in [false, true] {
                        let mut accepted = snapshot(&request);
                        delegate(&mut accepted);
                        // Split one layer into correlated alternatives. No union
                        // of these rules permits recipient a with attachment y.
                        let mut ax = rule(&request);
                        ax.recipients = vec!["a".into()];
                        ax.attachment_classifications = vec!["x".into()];
                        let mut by = rule(&request);
                        by.recipients = vec!["b".into()];
                        by.attachment_classifications = vec!["y".into()];
                        accepted.engagement.hard.rules = vec![ax, by];
                        if missing_standing {
                            accepted.member.standing.rules.clear();
                        }
                        let mut current = accepted.clone();
                        bump_chain(&mut current);
                        current.engagement.hard.rules = vec![rule(&request)];
                        let verdict = evaluate(&request, &current, &accepted, 100);
                        let inspection =
                            inspect_capability(&need(&request), &current, &accepted, 100);
                        match verdict {
                            PermissionVerdict::Standing | PermissionVerdict::NeedsDecision => {
                                permitted += 1;
                                assert_eq!(
                                    inspection.status,
                                    CapabilityStatus::CompatibleNeedsExactDetails,
                                    "{request:?}"
                                );
                                assert_eq!(
                                    verdict,
                                    if missing_standing {
                                        PermissionVerdict::NeedsDecision
                                    } else {
                                        PermissionVerdict::Standing
                                    }
                                );
                            }
                            PermissionVerdict::Denied => {
                                forbidden += 1;
                                assert_eq!(
                                    inspection.status,
                                    CapabilityStatus::Forbidden,
                                    "{request:?}"
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    assert!(permitted > 50 && forbidden > 50);
}
