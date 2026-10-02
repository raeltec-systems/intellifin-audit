//! Pure request-budget and memo tests. The lazy pool is never acquired and no
//! database, adapter, operation or service is contacted by these tests.
use super::*;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use zobba_domain::permissions::{
    AccountRestriction, Action, CapabilityReason, EnvironmentKind, PermissionBounds,
    PermissionRule, PolicyDocument, PolicyKind, Purpose, ReadRestriction,
};

const OBSERVED_AT: i64 = 1_000_000;
const RESOURCE_A: &str = "audit-resource-a";
const RESOURCE_B: &str = "audit-resource-b";

fn source() -> SourceBinding {
    SourceBinding {
        source_id: "fixture-source".into(),
        ledger_id: "fixture-ledger".into(),
        endpoint_digest: hash(b"127.0.0.1:43199"),
        contract_version: 1,
    }
}

fn repository() -> SkillsRepository {
    let pool = PgPoolOptions::new()
        .min_connections(0)
        .max_connections(1)
        .connect_lazy_with(
            PgConnectOptions::new()
                .host("127.0.0.1")
                .port(1)
                .database("skills_unit_test"),
        );
    SkillsRepository::new(pool)
        .with_qualification_source("127.0.0.1:43199".parse().unwrap(), source())
        .unwrap()
}

fn policy(kind: PolicyKind, subject_id: &str) -> PolicyDocument {
    PolicyDocument {
        schema_version: 1,
        kind,
        subject_id: subject_id.into(),
        version: 1,
        actor_id: "actor-manager".into(),
        created_at: OBSERVED_AT - 100,
        revoked: false,
        hard: PermissionBounds {
            rules: [RESOURCE_A, RESOURCE_B]
                .into_iter()
                .map(|resource| PermissionRule {
                    purpose: Purpose::AuditCoordination,
                    action: Action::Send,
                    account_id: "audit-account".into(),
                    environment_id: "audit-environment".into(),
                    destination: "owned-endpoint".into(),
                    resource_id: resource.into(),
                    recipients: vec!["recipient-a".into()],
                    attachment_classifications: vec!["audit".into()],
                    expires_at: OBSERVED_AT + 3_600,
                })
                .collect(),
        },
        standing: PermissionBounds { rules: vec![] },
        parent: None,
        account: (kind == PolicyKind::Account).then(|| AccountRestriction {
            source: source(),
            account_id: "audit-account".into(),
            environment_id: "audit-environment".into(),
            environment: EnvironmentKind::Audit,
            read_restriction: ReadRestriction::None,
            restriction_survives_takeover: false,
            test_environment_verified: false,
            test_resources: vec![],
            test_cleanup_id: None,
            audit_resources: vec![RESOURCE_A.into(), RESOURCE_B.into()],
        }),
    }
}

fn authority() -> AuthoritySnapshot {
    let mut task = policy(PolicyKind::Task, "task-a");
    task.actor_id = "actor-a".into();
    let result = AuthoritySnapshot {
        scope: Scope {
            organisation_id: "org-a".into(),
            client_id: "client-a".into(),
            engagement_id: "engagement-a".into(),
        },
        actor_id: "actor-a".into(),
        task_id: "task-a".into(),
        organisation: policy(PolicyKind::Organisation, "org-a"),
        engagement: policy(PolicyKind::Engagement, "engagement-a"),
        member: policy(PolicyKind::Member, "actor-a"),
        account: policy(PolicyKind::Account, "audit-account"),
        task,
        delegations: vec![],
    };
    assert!(result.is_valid());
    result
}

fn need(id: &str, resource: &str) -> ToolNeed {
    ToolNeed {
        id: id.into(),
        tool: "audit_send_v1".into(),
        account_id: Some("audit-account".into()),
        environment_id: Some("audit-environment".into()),
        destination: Some("owned-endpoint".into()),
        resource_id: Some(resource.into()),
        recipients: vec!["recipient-a".into()],
        attachment_classifications: vec![],
        requires_attachments: false,
    }
}

fn version(id: &str, need_id: &str, resource: &str) -> SkillVersion {
    let mut command: InstallSkill = serde_json::from_value(json!({
        "key": id, "expected_revision": 0, "enabled": true,
        "assignment": {"kind":"firm","client_id":null,"engagement_id":null},
        "applicability": {"audit_area":null,"period_start":null,"period_end":null},
        "manifest": {
            "schema_version":1,"id":id,"version":"v1","name":"Review evidence",
            "description":"Retain attributable inputs and an exact technique version.",
            "source":{"reference":"Synthetic firm manual","revision":"revision-1","license":"Internal use"},
            "inputs":[],"outputs":["A reviewable result"],"needs":[],"method_version_ids":[],
            "resources":[{"id":"instructions","kind":"text","content":"Retain exact citations.\r\n"}]
        }
    }))
    .unwrap();
    command.manifest.needs = vec![need(need_id, resource)];
    let (digest, resource_digests) = manifest_digests(&command.manifest).unwrap();
    let result = SkillVersion {
        id: id.into(),
        actor_id: "actor-admin".into(),
        installed_at: OBSERVED_AT - 50,
        revision: 1,
        command,
        digest,
        resource_digests,
        status: CatalogStatus::Enabled,
        status_revision: 1,
        status_event: StatusEvent {
            event_id: "event-install".into(),
            actor_id: "actor-admin".into(),
            recorded_at: OBSERVED_AT - 50,
            revision: 1,
            status: CatalogStatus::Enabled,
            reason: None,
        },
    };
    verify_version(&result).unwrap();
    result
}

fn inspection_basis(versions: Vec<SkillVersion>) -> TaskInspection {
    let accepted = authority();
    TaskInspection {
        stored: StoredInspection {
            revision: 4,
            selection_revision: 1,
            versions,
            selections: vec![],
        },
        methodology: serde_json::from_value(json!({
            "id":"neutral-binding","execution_epoch":1,"candidate_version_ids":[],
            "context_command_id":null,"bound_at":OBSERVED_AT-40,"actor_id":"actor-a",
            "resolution":{"status":"neutral","context":{"audit_area":null,"period_start":null,"period_end":null},
                "version_ids":[],"requirements":[],"templates":[],"neutral_source_version_ids":["builtin_neutral_v1"],
                "issues":[],"reason":"Labelled neutral starter"}
        }))
        .unwrap(),
        execution_epoch: 4,
        task_state: "ready".into(),
        method_allowed: true,
        authority: Some(accepted.clone()),
        current_authority: Ok(accepted),
        authority_actor_current: true,
        authority_fingerprint: "authority-snapshot-1".into(),
        observed_at: OBSERVED_AT,
        memo: RefCell::new(InspectionMemo::default()),
    }
}

fn selection(basis: &TaskInspection, version: &SkillVersion) -> Selection {
    Selection {
        id: "selection-a".into(),
        task_id: "task-a".into(),
        selector_id: "actor-reviewer".into(),
        authority_actor_id: Some("actor-a".into()),
        selected_at: OBSERVED_AT - 1,
        revision: 1,
        version_id: version.id.clone(),
        skill_id: version.command.manifest.id.clone(),
        skill_version: version.command.manifest.version.clone(),
        digest: version.digest.clone(),
        reason: "Retain this attributable technique".into(),
        methodology: basis.methodology.clone(),
        execution_epoch: basis.execution_epoch,
        catalog_revision: basis.stored.revision,
        dependency_fingerprint: "f".repeat(64),
    }
}

fn assert_query_capacity(basis: &TaskInspection, inspection: &Inspection) {
    assert_eq!(inspection.status, EligibilityStatus::Unavailable);
    assert_eq!(inspection.needs[0].status, CapabilityStatus::Unavailable);
    assert!(!inspection.selectable());
    assert!(
        basis
            .memo
            .borrow()
            .capabilities
            .values()
            .any(|result| result.reason == CapabilityReason::QueryCapacity)
    );
}

#[tokio::test]
async fn exhausted_request_budget_preserves_catalog_metadata_and_selection_receipt() {
    let repository = repository();
    let version = version("skill-a", "send-a", RESOURCE_A);
    let mut basis = inspection_basis(vec![version.clone()]);
    let receipt = selection(&basis, &version);
    basis.stored.selections.push(receipt.clone());
    basis.memo.borrow_mut().remaining_comparisons = 0;

    let inspection = repository.eligibility(&basis, &version).unwrap();
    assert_query_capacity(&basis, &inspection);
    assert_eq!(inspection.version_id, version.id);
    assert_eq!(inspection.digest, version.digest);
    assert_eq!(inspection.authority_actor_id.as_deref(), Some("actor-a"));
    let history = repository.selection_view(&basis, &receipt).unwrap();
    assert_eq!(history.selection, receipt);
    assert_eq!(history.current, inspection);
    assert_eq!(basis.stored.versions, vec![version]);
    assert_eq!(basis.stored.selections, vec![receipt]);
    assert_eq!(basis.memo.borrow().remaining_comparisons, 0);
}

#[tokio::test]
async fn equivalent_queries_share_work_across_manifest_and_need_display_ids() {
    let repository = repository();
    let first = version("skill-a", "send-a", RESOURCE_A);
    let second = version("skill-b", "different-display-id", RESOURCE_A);
    assert_ne!(first.digest, second.digest);
    let basis = inspection_basis(vec![first.clone(), second.clone()]);
    assert_eq!(basis.memo.borrow().remaining_comparisons, 1_048_576);

    let first_inspection = repository.eligibility(&basis, &first).unwrap();
    assert_eq!(first_inspection.status, EligibilityStatus::Eligible);
    let remaining = basis.memo.borrow().remaining_comparisons;
    assert!(remaining < REQUEST_CAPABILITY_COMPARISONS_MAX);
    let second_inspection = repository.eligibility(&basis, &second).unwrap();
    assert_eq!(second_inspection.status, EligibilityStatus::Eligible);
    assert_eq!(second_inspection.version_id, second.id);
    assert_eq!(second_inspection.digest, second.digest);
    assert_eq!(second_inspection.needs[0].id, "different-display-id");
    assert_eq!(basis.memo.borrow().remaining_comparisons, remaining);
    assert_eq!(basis.memo.borrow().capabilities.len(), 1);
    assert_eq!(basis.memo.borrow().versions.len(), 2);
}

#[tokio::test]
async fn distinct_queries_exhaust_one_shared_budget_without_reviving_or_denial() {
    let repository = repository();
    let first = version("skill-a", "send-a", RESOURCE_A);
    let second = version("skill-b", "send-b", RESOURCE_B);
    let basis = inspection_basis(vec![first.clone(), second.clone()]);
    // Both complete queries are compatible with a normal request budget. This
    // deterministic smaller allowance fits one query, but not both together.
    for version in [&first, &second] {
        let independent = inspection_basis(vec![version.clone()]);
        assert_eq!(
            repository
                .eligibility(&independent, version)
                .unwrap()
                .status,
            EligibilityStatus::Eligible
        );
    }
    basis.memo.borrow_mut().remaining_comparisons = 32;
    let first_inspection = repository.eligibility(&basis, &first).unwrap();
    assert_eq!(first_inspection.status, EligibilityStatus::Eligible);
    assert!((1..32).contains(&basis.memo.borrow().remaining_comparisons));
    let second_inspection = repository.eligibility(&basis, &second).unwrap();
    assert_query_capacity(&basis, &second_inspection);
    assert_eq!(basis.memo.borrow().remaining_comparisons, 0);
    assert_eq!(basis.memo.borrow().capabilities.len(), 2);
    assert_eq!(
        repository.eligibility(&basis, &first).unwrap(),
        first_inspection,
        "completed inspection remains available after other queries exhaust work"
    );
}

#[tokio::test]
async fn history_reuses_version_inspection_but_fences_each_selection_basis() {
    let repository = repository();
    let version = version("skill-a", "send-a", RESOURCE_A);
    let basis = inspection_basis(vec![version.clone()]);
    let inspection = repository.eligibility(&basis, &version).unwrap();
    assert_eq!(inspection.status, EligibilityStatus::Eligible);
    let remaining = basis.memo.borrow().remaining_comparisons;
    let receipt = selection(&basis, &version);

    let mut old_binding = receipt.clone();
    old_binding.id = "selection-old-binding".into();
    old_binding.methodology.id = "previous-binding".into();
    let mut old_epoch = receipt.clone();
    old_epoch.id = "selection-old-epoch".into();
    old_epoch.execution_epoch -= 1;
    for stale in [&old_binding, &old_epoch] {
        let view = repository.selection_view(&basis, stale).unwrap();
        assert_eq!(view.selection, *stale);
        assert_eq!(view.current.status, EligibilityStatus::MethodologyBlocked);
        assert_eq!(
            view.current.needs[0].status,
            CapabilityStatus::CompatibleNeedsExactDetails
        );
    }
    let current = repository.selection_view(&basis, &receipt).unwrap();
    assert_eq!(current.selection, receipt);
    assert_eq!(current.current, inspection);
    assert_eq!(basis.memo.borrow().remaining_comparisons, remaining);
    assert_eq!(basis.memo.borrow().versions.len(), 1);
    assert_eq!(basis.memo.borrow().capabilities.len(), 1);
}

#[test]
fn exact_source_binding_participates_in_capability_cache_identity() {
    let basis = inspection_basis(vec![]);
    let accepted = basis.authority.as_ref().unwrap();
    let current = basis.current_authority.as_ref().unwrap();
    let mut query = need("send-a", RESOURCE_A)
        .to_domain()
        .unwrap()
        .capability_need()
        .unwrap();
    query.source = Some(source());
    let compatible = basis.capability(&query, current, accepted);
    assert_eq!(
        compatible.status,
        permissions::CapabilityStatus::CompatibleNeedsExactDetails
    );
    let remaining = basis.memo.borrow().remaining_comparisons;
    query.source.as_mut().unwrap().ledger_id = "different-ledger".into();
    let changed = basis.capability(&query, current, accepted);
    assert_eq!(changed.status, permissions::CapabilityStatus::Forbidden);
    assert_eq!(changed.reason, CapabilityReason::SourceMismatch);
    assert_eq!(basis.memo.borrow().capabilities.len(), 2);
    assert_eq!(basis.memo.borrow().remaining_comparisons, remaining);
}

#[tokio::test]
async fn fresh_task_inspections_do_not_reuse_prior_source_or_budget_results() {
    let repository = repository();
    let version = version("skill-a", "send-a", RESOURCE_A);
    let original = inspection_basis(vec![version.clone()]);
    let original_inspection = repository.eligibility(&original, &version).unwrap();
    assert_eq!(original_inspection.status, EligibilityStatus::Eligible);

    let mut changed = inspection_basis(vec![version.clone()]);
    let current = changed.current_authority.as_mut().unwrap();
    current.account.version += 1;
    current.account.account.as_mut().unwrap().source.ledger_id = "replacement-ledger".into();
    assert!(current.is_valid());
    changed.authority_fingerprint = "authority-source-replaced".into();
    assert!(changed.memo.borrow().capabilities.is_empty());
    assert!(changed.memo.borrow().versions.is_empty());
    let changed_inspection = repository.eligibility(&changed, &version).unwrap();
    assert_eq!(changed_inspection.status, EligibilityStatus::Forbidden);
    assert!(
        changed
            .memo
            .borrow()
            .capabilities
            .values()
            .any(|result| result.reason == CapabilityReason::SourceChanged)
    );
    assert_ne!(
        original_inspection.dependency_fingerprint,
        changed_inspection.dependency_fingerprint
    );

    let exhausted = inspection_basis(vec![version.clone()]);
    exhausted.memo.borrow_mut().remaining_comparisons = 0;
    let exhausted_inspection = repository.eligibility(&exhausted, &version).unwrap();
    assert_query_capacity(&exhausted, &exhausted_inspection);
    assert_eq!(
        repository.eligibility(&original, &version).unwrap(),
        original_inspection,
        "a later inspection cannot mutate the earlier request's memo"
    );
}

#[tokio::test]
async fn eligibility_retains_only_redacted_accepted_and_current_blocking_bounds() {
    let repository = repository();
    let version = version("skill-a", "send-a", RESOURCE_A);
    for accepted_bound in [true, false] {
        let mut basis = inspection_basis(vec![version.clone()]);
        if accepted_bound {
            let accepted = basis.authority.as_mut().unwrap();
            accepted.member.hard.rules.clear();
            basis.current_authority = Ok(accepted.clone());
        } else {
            let current = basis.current_authority.as_mut().unwrap();
            current.member.version += 1;
            current.member.hard.rules.clear();
        }
        let inspection = repository.eligibility(&basis, &version).unwrap();
        assert_eq!(inspection.status, EligibilityStatus::Forbidden);
        assert_eq!(
            serde_json::to_value(&inspection.needs[0].blocking_bound).unwrap(),
            json!({"accepted":accepted_bound,"kind":"member","delegation_depth":null}),
            "only the accepted/current flag, bound kind and depth cross the port"
        );
    }
}
