//! Guarded PostgreSQL contracts for inert installation and current selection.
//! One async owner resets one explicitly disposable database; no source starts.
use std::{
    net::SocketAddr,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{Connection, Executor, PgConnection, PgPool, postgres::PgPoolOptions};
use zobba_application::{
    methodology::{self as method, MethodologyStore},
    operation::OperationStore,
    skills::*,
    task::TaskCommands,
};
use zobba_domain::{
    identity::Scope,
    permissions::{
        AccountRestriction, Action, AuthoritySnapshot, CanonicalOperation, DecisionCommand,
        EnvironmentKind, OperationState, PermissionBounds, PermissionRule, PolicyDocument,
        PolicyKind, Purpose, ReadRestriction, SourceBinding, SourceFact,
    },
    task::{CommandKind, CommandReceipt, Decision, TaskCommand, WakeupRoute},
};
use zobba_infrastructure::{
    database_options,
    fixture::seed_local_configured,
    identity::{IdentityRepository, secret_hash},
    methodology::MethodologyRepository,
    migrate,
    operation::OperationRepository,
    skills::SkillsRepository,
    task::TaskRepository,
};

mod support;

const ISSUER: &str = "https://127.0.0.1:4443";
const APP: &str = "skills-contract";
const DEFERRED_GATE: i64 = 21_030_901;

fn scope() -> Scope {
    Scope {
        organisation_id: "org-a".into(),
        client_id: "client-a".into(),
        engagement_id: "engagement-a".into(),
    }
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn source() -> SourceBinding {
    SourceBinding {
        source_id: "fixture-source".into(),
        ledger_id: "fixture-ledger".into(),
        endpoint_digest: hash(b"127.0.0.1:43199"),
        contract_version: 1,
    }
}
fn install(key: &str, revision: u64) -> InstallSkill {
    serde_json::from_value(json!({
        "key": key, "expected_revision": revision, "enabled": true,
        "assignment": {"kind":"firm","client_id":null,"engagement_id":null},
        "applicability": {"audit_area":null,"period_start":null,"period_end":null},
        "manifest": {
            "schema_version":1,"id":key,"version":"v1","name":"Reconcile evidence",
            "description":"Compare exact inputs and retain source attribution.",
            "source":{"reference":"Synthetic firm manual","revision":"2026-10-02","license":"Internal use"},
            "inputs":[{"id":"population","label":"Population","required":true}],
            "outputs":["An attributable reconciliation for review"],
            "needs":[],"method_version_ids":[],
            "resources":[{"id":"instructions","kind":"text","content":"界 Evidence\r\n\tRetain exact citations.\n"},
                {"id":"script","kind":"script","content":"#!/bin/sh\necho 'inert; never run'\n"}]
        }
    })).unwrap()
}
fn send_need() -> ToolNeed {
    ToolNeed {
        id: "send_review".into(),
        tool: "audit_send_v1".into(),
        account_id: Some("audit-account".into()),
        environment_id: Some("audit-environment".into()),
        destination: Some("owned-endpoint".into()),
        resource_id: Some("audit-resource".into()),
        recipients: vec!["recipient-a".into()],
        attachment_classifications: vec![],
        requires_attachments: false,
    }
}
fn policy(kind: PolicyKind, subject: &str) -> PolicyDocument {
    PolicyDocument {
        schema_version: 1,
        kind,
        subject_id: subject.into(),
        version: 1,
        actor_id: "actor-manager".into(),
        created_at: now(),
        revoked: false,
        hard: PermissionBounds {
            rules: vec![PermissionRule {
                purpose: Purpose::AuditCoordination,
                action: Action::Send,
                account_id: "audit-account".into(),
                environment_id: "audit-environment".into(),
                destination: "owned-endpoint".into(),
                resource_id: "audit-resource".into(),
                recipients: vec!["recipient-a".into()],
                attachment_classifications: vec!["audit".into()],
                expires_at: 4_102_444_800,
            }],
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
            audit_resources: vec!["audit-resource".into()],
        }),
    }
}
fn select(key: &str, version: &str, discovery: &Discovery) -> SelectSkill {
    SelectSkill {
        key: key.into(),
        version_id: version.into(),
        reason: "Use the attributable firm technique".into(),
        expected_catalog_revision: discovery.catalog_revision,
        expected_methodology_binding_id: discovery.methodology_binding_id.clone(),
        expected_execution_epoch: discovery.execution_epoch,
        expected_selection_revision: discovery.selection_revision,
    }
}
fn candidate<'a>(discovery: &'a Discovery, id: &str) -> &'a Candidate {
    discovery
        .candidates
        .iter()
        .find(|item| item.version.id == id)
        .unwrap()
}

struct Fixture {
    pool: PgPool,
    admin: SkillsRepository,
    auditor: SkillsRepository,
    manager: SkillsRepository,
    unqualified: SkillsRepository,
    tasks: TaskRepository,
    operations: OperationRepository,
    identities: IdentityRepository,
    admin_token: String,
    auditor_token: String,
    manager_token: String,
}
impl Fixture {
    async fn new(pool: PgPool) -> Self {
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
        let base = SkillsRepository::new(pool.clone());
        let qualified = base
            .clone()
            .with_qualification_source("127.0.0.1:43199".parse().unwrap(), source())
            .unwrap();
        Self {
            admin: base.clone().with_session_hash(secret_hash(&admin_token)),
            auditor: qualified
                .clone()
                .with_session_hash(secret_hash(&auditor_token)),
            manager: qualified.with_session_hash(secret_hash(&manager_token)),
            unqualified: base.with_session_hash(secret_hash(&auditor_token)),
            tasks: TaskRepository::new(pool.clone()).with_session_hash(secret_hash(&auditor_token)),
            operations: OperationRepository::new(pool.clone()),
            identities,
            pool,
            admin_token,
            auditor_token,
            manager_token,
        }
    }
    async fn revision(&self) -> u64 {
        self.admin
            .catalog("actor-admin", "org-a")
            .await
            .unwrap()
            .revision
    }
    async fn install(&self, key: &str) -> CatalogReceipt {
        self.admin
            .install("actor-admin", "org-a", &install(key, self.revision().await))
            .await
            .unwrap()
    }
    async fn task(&self, key: &str) -> CommandReceipt {
        self.tasks
            .admit(
                "actor-a",
                &scope(),
                &TaskCommand {
                    key: key.into(),
                    kind: CommandKind::Create,
                    task_id: None,
                    cycle_id: None,
                    content: Some("Synthetic inert skills contract".into()),
                    context: None,
                },
            )
            .await
            .unwrap()
    }
    async fn discovery(&self, task: &CommandReceipt) -> Discovery {
        self.auditor
            .discover("actor-a", &scope(), &task.task_id)
            .await
            .unwrap()
    }
    async fn status(&self, key: &str, id: &str, status: CatalogStatus) -> CatalogReceipt {
        self.admin
            .set_status(
                "actor-admin",
                "org-a",
                &ChangeSkillStatus {
                    key: key.into(),
                    expected_revision: self.revision().await,
                    version_id: id.into(),
                    status,
                    reason: "Explicit synthetic restriction".into(),
                },
            )
            .await
            .unwrap()
    }
    async fn policies(&self) {
        for document in [
            policy(PolicyKind::Organisation, "org-a"),
            policy(PolicyKind::Engagement, "engagement-a"),
            policy(PolicyKind::Member, "actor-a"),
            policy(PolicyKind::Account, "audit-account"),
        ] {
            self.operations
                .save_policy("actor-manager", &scope(), &document)
                .await
                .unwrap();
        }
    }
    async fn accept(&self, task: &CommandReceipt, expires_at: Option<i64>) -> AuthoritySnapshot {
        let mut task_policy = policy(PolicyKind::Task, &task.task_id);
        task_policy.actor_id = "actor-a".into();
        if let Some(deadline) = expires_at {
            task_policy.hard.rules[0].expires_at = deadline;
        }
        let accepted = AuthoritySnapshot {
            scope: scope(),
            actor_id: "actor-a".into(),
            task_id: task.task_id.clone(),
            organisation: policy(PolicyKind::Organisation, "org-a"),
            engagement: policy(PolicyKind::Engagement, "engagement-a"),
            member: policy(PolicyKind::Member, "actor-a"),
            account: policy(PolicyKind::Account, "audit-account"),
            task: task_policy,
            delegations: vec![],
        };
        // Equal-version documents must be byte-identical, including created_at.
        // Shared documents are read back through the stored application codec.
        let mut accepted = accepted;
        for (kind, target) in [
            (PolicyKind::Organisation, &mut accepted.organisation),
            (PolicyKind::Engagement, &mut accepted.engagement),
            (PolicyKind::Member, &mut accepted.member),
            (PolicyKind::Account, &mut accepted.account),
        ] {
            let mut tx = zobba_infrastructure::scope::begin(&self.pool, "actor-a", &scope())
                .await
                .unwrap();
            let document:String=sqlx::query_scalar("SELECT v.document FROM public.permission_heads h JOIN public.permission_versions v ON (v.organisation_id,v.policy_key,v.version)=(h.organisation_id,h.policy_key,h.current_version) WHERE h.organisation_id='org-a' AND v.kind=$1 AND v.subject_id=$2")
                .bind(kind.as_str()).bind(&target.subject_id).fetch_one(&mut *tx).await.unwrap();
            *target =
                serde_json::from_str::<zobba_application::operation::wire::StoredPolicy>(&document)
                    .unwrap()
                    .0;
            tx.commit().await.unwrap();
        }
        self.operations
            .accept_authority("actor-a", &scope(), &task.task_id, &accepted)
            .await
            .unwrap();
        accepted
    }
}

async fn side_effects(owner: &mut PgConnection) -> Vec<i64> {
    let mut result = Vec::new();
    for table in [
        "operations",
        "operation_decisions",
        "operation_attempts",
        "operation_claims",
        "task_claims",
        "task_wakeups",
        "task_commands",
    ] {
        result.push(
            sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
                .fetch_one(&mut *owner)
                .await
                .unwrap(),
        );
    }
    result
}

async fn wait_blocked(observer: &mut PgConnection, expected: i64) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    loop {
        let count:i64=sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity a WHERE a.datname=current_database() AND a.application_name=$1 AND a.state='active' AND cardinality(pg_blocking_pids(a.pid))>0")
            .bind(APP).fetch_one(&mut *observer).await.unwrap();
        if count >= expected {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "expected {expected} blocked requests, observed {count}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[tokio::test]
async fn postgres_skills_contract() {
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
        .max_connections(8)
        .connect_with(
            database_options(&config.runtime)
                .unwrap()
                .application_name(APP),
        )
        .await
        .unwrap();
    let mut observer = PgConnection::connect(&config.admin).await.unwrap();
    config.guard_connection(&mut observer).await;
    let fixture = Fixture::new(pool).await;
    catalog_selection_history(&fixture, &mut owner).await;
    methodology_and_paused_use(&fixture, &mut owner).await;
    fixture.policies().await;
    accepted_actor_and_policy_restrictions(&fixture, &mut owner).await;
    consumed_receipt_survives_recall(&fixture).await;
    restriction_race_orders(&fixture, &mut owner, &mut observer).await;
    policy_restriction_race_orders(&fixture, &mut owner, &mut observer).await;
    staged_selection_serializes_policy_and_logout(&fixture, &mut owner, &mut observer).await;
    deferred_expiry_rolls_back_selection(&fixture, &mut owner, &mut observer).await;
    deferred_method_activation_rolls_back_selection(&fixture, &mut owner, &mut observer).await;
    qualified_tool_mapping_preserves_read_write_distinction(&fixture, &mut owner).await;
    selected_history_byte_capacity(&fixture, &mut owner).await;
    selected_history_capacity(&fixture, &mut owner).await;
    catalog_capacity_keeps_restrictions_and_replay(&fixture).await;
    catalog_byte_capacity_keeps_restrictions_and_replay(&fixture, &mut owner).await;
    exact_session_replacement(&fixture).await;
    fixture.pool.close().await;
}

async fn catalog_selection_history(f: &Fixture, owner: &mut PgConnection) {
    assert_eq!(f.revision().await, 0);
    assert_eq!(
        f.auditor.catalog("actor-a", "org-a").await,
        Err(SkillsError::Denied)
    );
    assert_eq!(
        f.admin.catalog("actor-admin", "org-b").await,
        Err(SkillsError::Denied)
    );
    for table in [
        "skill_versions",
        "skill_events",
        "skill_status",
        "task_skill_selections",
    ] {
        assert!(
            sqlx::query(&format!("SELECT * FROM public.{table}"))
                .execute(&f.pool)
                .await
                .is_err()
        );
        assert!(
            sqlx::query(&format!("DELETE FROM public.{table}"))
                .execute(&f.pool)
                .await
                .is_err()
        );
    }
    let command = install("pure", 0);
    let saved = f
        .admin
        .install("actor-admin", "org-a", &command)
        .await
        .unwrap();
    assert_eq!(
        f.admin
            .install("actor-admin", "org-a", &command)
            .await
            .unwrap(),
        saved
    );
    let before = f.admin.catalog("actor-admin", "org-a").await.unwrap();
    let version = &before.versions[0];
    assert_eq!(
        version.digest,
        hash(&command.manifest.canonical_bytes().unwrap())
    );
    for (resource, digest) in command
        .manifest
        .resources
        .iter()
        .zip(&version.resource_digests)
    {
        assert_eq!(resource.id, digest.id);
        assert_eq!(hash(resource.content.as_bytes()), digest.digest);
    }
    let mut changed = command.clone();
    changed.manifest.source.revision = "different".into();
    assert_eq!(
        f.admin.install("actor-admin", "org-a", &changed).await,
        Err(SkillsError::Conflict)
    );
    changed.key = "overwrite-version".into();
    changed.expected_revision = 1;
    assert_eq!(
        f.admin.install("actor-admin", "org-a", &changed).await,
        Err(SkillsError::Conflict)
    );
    let mut invalid = install("invalid-tool", 1);
    invalid.manifest.needs.push(send_need());
    invalid.manifest.needs[0].tool = "shell_arbitrary".into();
    assert_eq!(
        f.admin.install("actor-admin", "org-a", &invalid).await,
        Err(SkillsError::Invalid)
    );
    assert_eq!(
        f.admin.catalog("actor-admin", "org-a").await.unwrap(),
        before
    );

    owner.execute("INSERT INTO public.clients VALUES('org-a','client-private','Private client'); INSERT INTO public.engagements VALUES('org-a','client-private','engagement-private','Private engagement')").await.unwrap();
    let mut private = install("private-skill", 1);
    private.assignment = method::AssignmentScope {
        kind: method::AssignmentKind::Client,
        client_id: Some("client-private".into()),
        engagement_id: None,
    };
    let private = f
        .admin
        .install("actor-admin", "org-a", &private)
        .await
        .unwrap();
    let task = f.task("pure-task").await;
    assert_eq!(
        f.admin
            .discover("actor-admin", &scope(), &task.task_id)
            .await,
        Err(SkillsError::Denied)
    );
    let before_effects = side_effects(owner).await;
    let discovery = f.discovery(&task).await;
    assert_eq!(
        &candidate(&discovery, &saved.version_id).version,
        version,
        "scoped discovery must expose the exact installed manifest inputs, outputs, source revision/license, raw Unicode resources, digests and applicability"
    );
    assert!(
        candidate(&discovery, &saved.version_id)
            .inspection
            .selectable()
    );
    assert!(
        candidate(&discovery, &saved.version_id)
            .inspection
            .authority_actor_id
            .is_none()
    );
    assert!(
        !discovery
            .candidates
            .iter()
            .any(|item| item.version.id == private.version_id)
    );
    let command = select("select-pure", &saved.version_id, &discovery);
    let chosen = f
        .manager
        .select("actor-manager", &scope(), &task.task_id, &command)
        .await
        .unwrap();
    assert_eq!(chosen.selection.selector_id, "actor-manager");
    assert_eq!(chosen.selection.task_id, task.task_id);
    assert!(chosen.selection.authority_actor_id.is_none());
    assert_eq!(
        chosen.selection.methodology.resolution.status,
        method::ResolutionStatus::Neutral
    );
    assert!(chosen.current.selectable());
    let replay = f
        .manager
        .select("actor-manager", &scope(), &task.task_id, &command)
        .await
        .unwrap();
    assert_eq!(replay.selection, chosen.selection);
    let mut changed = command.clone();
    changed.reason = "Changed meaning".into();
    assert_eq!(
        f.manager
            .select("actor-manager", &scope(), &task.task_id, &changed)
            .await,
        Err(SkillsError::Conflict)
    );
    let current = f.discovery(&task).await;
    let mut foreign = select("foreign", &private.version_id, &current);
    assert_eq!(
        f.auditor
            .select("actor-a", &scope(), &task.task_id, &foreign)
            .await,
        Err(SkillsError::Denied)
    );
    foreign.version_id = saved.version_id.clone();
    for field in 0..4 {
        let mut stale = foreign.clone();
        stale.key = format!("stale-{field}");
        match field {
            0 => stale.expected_catalog_revision -= 1,
            1 => stale.expected_selection_revision -= 1,
            2 => stale.expected_execution_epoch += 1,
            _ => stale.expected_methodology_binding_id = "old-binding".into(),
        }
        assert_eq!(
            f.auditor
                .select("actor-a", &scope(), &task.task_id, &stale)
                .await,
            Err(SkillsError::Conflict)
        );
    }
    assert_eq!(
        side_effects(owner).await,
        before_effects,
        "discover/select must not mint work or decisions"
    );
    let disabled = f
        .status("disable-pure", &saved.version_id, CatalogStatus::Disabled)
        .await;
    assert_eq!(disabled.affected_selections, 1);
    let retry = f
        .manager
        .select("actor-manager", &scope(), &task.task_id, &command)
        .await
        .unwrap();
    assert_eq!(retry.selection, chosen.selection);
    assert_eq!(retry.current.status, EligibilityStatus::Disabled);
    assert_eq!(
        f.manager
            .current_use(
                "actor-manager",
                &scope(),
                &task.task_id,
                &chosen.selection.id
            )
            .await
            .unwrap()
            .current
            .status,
        EligibilityStatus::Disabled
    );
    let fresh = f.discovery(&task).await;
    assert_eq!(
        f.auditor
            .select(
                "actor-a",
                &scope(),
                &task.task_id,
                &select("disabled-new", &saved.version_id, &fresh)
            )
            .await,
        Err(SkillsError::Ineligible)
    );
    f.status("enable-pure", &saved.version_id, CatalogStatus::Enabled)
        .await;
    assert!(
        f.manager
            .current_use(
                "actor-manager",
                &scope(),
                &task.task_id,
                &chosen.selection.id
            )
            .await
            .unwrap()
            .current
            .selectable()
    );
    let recalled = f
        .status("recall-pure", &saved.version_id, CatalogStatus::Recalled)
        .await;
    assert_eq!(recalled.affected_selections, 1);
    let after = f
        .manager
        .select("actor-manager", &scope(), &task.task_id, &command)
        .await
        .unwrap();
    assert_eq!(after.selection, chosen.selection);
    assert_eq!(after.current.status, EligibilityStatus::Recalled);
    assert_eq!(
        f.admin
            .set_status(
                "actor-admin",
                "org-a",
                &ChangeSkillStatus {
                    key: "restore-recalled".into(),
                    expected_revision: recalled.revision,
                    version_id: saved.version_id,
                    status: CatalogStatus::Enabled,
                    reason: "Forbidden restore".into()
                }
            )
            .await,
        Err(SkillsError::Conflict)
    );
}

async fn methodology_and_paused_use(f: &Fixture, owner: &mut PgConnection) {
    let methods =
        MethodologyRepository::new(f.pool.clone()).with_session_hash(secret_hash(&f.admin_token));
    let mut method:method::SaveMethodology=serde_json::from_value(json!({
        "key":"skill-method","expected_revision":0,"supersedes":null,"undo_of":null,
        "assignment":{"kind":"firm","client_id":null,"engagement_id":null},
        "applicability":{"audit_area":null,"period_start":null,"period_end":null},
        "activation":{"mode":"new_tasks","available_at":0},
        "definition":{"name":"Firm method","neutral_starter":false,
            "default_context":{"audit_area":"Revenue","period_start":"2026-01-01","period_end":"2026-12-31"},
            "templates":[{"id":"paper","version":"v1","name":"Firm workpaper","sections":[{"id":"basis","title":"Basis","content":"Retain cited evidence.","required":true}]}],
            "requirements":[{"id":"revenue","label":"Revenue","mandatory":true,"criteria":["Reconcile every exception"],"populations":null,"evidence_checks":null,
                "ratings":null,"templates":[{"id":"paper","version":"v1"}],"review_rules":["Human review"],
                "suitable_skills":[{"id":"method-technique","version":"v1"}]}]},
        "source":{"kind":"authored","reference":null,"note":"Synthetic required-method contract"}
    })).unwrap();
    let saved = methods.save("actor-admin", "org-a", &method).await.unwrap();
    let task = f.task("method-task").await;
    let mut install = install("method-technique", f.revision().await);
    install
        .manifest
        .method_version_ids
        .push(saved.version_id.clone());
    let technique = f
        .admin
        .install("actor-admin", "org-a", &install)
        .await
        .unwrap();
    let discovery = f.discovery(&task).await;
    assert!(
        candidate(&discovery, &technique.version_id)
            .inspection
            .selectable()
    );
    let chosen = f
        .auditor
        .select(
            "actor-a",
            &scope(),
            &task.task_id,
            &select("method-selection", &technique.version_id, &discovery),
        )
        .await
        .unwrap();
    let before = chosen.selection.methodology.clone();
    assert!(before.resolution.requirements[0].requirement.mandatory);
    assert_eq!(
        before.resolution.requirements[0]
            .requirement
            .suitable_skills
            .as_ref()
            .unwrap()[0]
            .id,
        "method-technique"
    );
    assert!(methodology_dependencies(&before).contains(&saved.version_id));
    method.key = "method-successor".into();
    method.expected_revision = 1;
    method.supersedes = Some(saved.version_id);
    method.definition.name = "New Tasks method".into();
    let successor = methods.save("actor-admin", "org-a", &method).await.unwrap();
    let mut newer = install.clone();
    newer.key = "method-new-only".into();
    newer.expected_revision = f.revision().await;
    newer.manifest.id = "method-new-only".into();
    newer.manifest.method_version_ids = vec![successor.version_id];
    let new_only = f
        .admin
        .install("actor-admin", "org-a", &newer)
        .await
        .unwrap();
    let current = f.discovery(&task).await;
    assert_eq!(
        candidate(&current, &new_only.version_id).inspection.status,
        EligibilityStatus::Inapplicable
    );
    assert_eq!(
        current.selections[0].selection.methodology, before,
        "latest assignments cannot replace pinned exact method"
    );
    assert!(
        candidate(&current, &technique.version_id)
            .inspection
            .selectable()
    );
    let pure = f.install("pause-pure").await;
    let pause = TaskCommand {
        key: "pause-skill-task".into(),
        kind: CommandKind::Pause,
        task_id: Some(task.task_id.clone()),
        cycle_id: Some(task.cycle_id.clone()),
        content: None,
        context: None,
    };
    f.tasks.admit("actor-a", &scope(), &pause).await.unwrap();
    let current = f.discovery(&task).await;
    let effects = side_effects(owner).await;
    let paused = f
        .auditor
        .select(
            "actor-a",
            &scope(),
            &task.task_id,
            &select("paused-selection", &pure.version_id, &current),
        )
        .await
        .unwrap();
    assert!(
        paused.current.selectable(),
        "choosing metadata does not resume a paused Task"
    );
    assert_eq!(
        f.auditor
            .current_use("actor-a", &scope(), &task.task_id, &paused.selection.id)
            .await
            .unwrap()
            .current
            .status,
        EligibilityStatus::TaskBlocked
    );
    assert_eq!(side_effects(owner).await, effects);
    let state: String = sqlx::query_scalar("SELECT state FROM public.tasks WHERE id=$1")
        .bind(&task.task_id)
        .fetch_one(&mut *owner)
        .await
        .unwrap();
    assert_eq!(state, "paused");
    assert_eq!(
        f.auditor
            .current_use("actor-a", &scope(), &task.task_id, &chosen.selection.id)
            .await
            .unwrap()
            .current
            .status,
        EligibilityStatus::MethodologyBlocked
    );
}

async fn accepted_actor_and_policy_restrictions(f: &Fixture, owner: &mut PgConnection) {
    let mut command = install("needs-send", f.revision().await);
    command.manifest.needs.push(send_need());
    let skill = f
        .admin
        .install("actor-admin", "org-a", &command)
        .await
        .unwrap();
    let task = f.task("accepted-task").await;
    let absent = f.discovery(&task).await;
    assert_eq!(
        candidate(&absent, &skill.version_id).inspection.status,
        EligibilityStatus::Unavailable
    );
    let accepted = f.accept(&task, None).await;
    let unqualified = f
        .unqualified
        .discover("actor-a", &scope(), &task.task_id)
        .await
        .unwrap();
    assert_eq!(
        candidate(&unqualified, &skill.version_id).inspection.status,
        EligibilityStatus::Unavailable
    );
    let before = side_effects(owner).await;
    let discovery = f
        .manager
        .discover("actor-manager", &scope(), &task.task_id)
        .await
        .unwrap();
    let compatible = &candidate(&discovery, &skill.version_id).inspection;
    assert!(compatible.selectable());
    assert_eq!(compatible.authority_actor_id.as_deref(), Some("actor-a"));
    assert_eq!(
        compatible.needs[0].status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    assert!(accepted.task.standing.rules.is_empty());
    let selected_command = select("accepted-selector", &skill.version_id, &discovery);
    let selected = f
        .manager
        .select("actor-manager", &scope(), &task.task_id, &selected_command)
        .await
        .unwrap();
    assert_eq!(selected.selection.selector_id, "actor-manager");
    assert_eq!(
        selected.selection.authority_actor_id.as_deref(),
        Some("actor-a")
    );
    assert!(
        f.manager
            .current_use(
                "actor-manager",
                &scope(),
                &task.task_id,
                &selected.selection.id
            )
            .await
            .unwrap()
            .current
            .selectable()
    );
    assert_eq!(side_effects(owner).await, before);

    // Several declared needs cannot cause a search for another account's grant.
    // Missing acceptance remains unavailable; an explicit mismatch against the
    // one actually accepted account is an authoritative per-need hard refusal.
    let mut other_account = policy(PolicyKind::Account, "other-account");
    other_account.account.as_mut().unwrap().account_id = "other-account".into();
    other_account.hard.rules[0].account_id = "other-account".into();
    f.operations
        .save_policy("actor-manager", &scope(), &other_account)
        .await
        .unwrap();
    let mut mixed = install("mixed-accounts", f.revision().await);
    mixed.manifest.needs.push(send_need());
    let mut other_need = send_need();
    other_need.id = "send_other_account".into();
    other_need.account_id = Some("other-account".into());
    mixed.manifest.needs.push(other_need);
    let mixed = f
        .admin
        .install("actor-admin", "org-a", &mixed)
        .await
        .unwrap();
    let mixed_task = f.task("mixed-account-task").await;
    let missing = f.discovery(&mixed_task).await;
    let inspection = &candidate(&missing, &mixed.version_id).inspection;
    assert_eq!(inspection.status, EligibilityStatus::Unavailable);
    assert!(
        inspection
            .needs
            .iter()
            .all(|need| need.status == CapabilityStatus::Unavailable)
    );
    f.accept(&mixed_task, None).await;
    let accepted_mixed = f.discovery(&mixed_task).await;
    let inspection = &candidate(&accepted_mixed, &mixed.version_id).inspection;
    assert_eq!(inspection.status, EligibilityStatus::Forbidden);
    assert_eq!(
        inspection.needs[0].status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    assert_eq!(inspection.needs[1].status, CapabilityStatus::Forbidden);
    assert_eq!(
        f.auditor
            .select(
                "actor-a",
                &scope(),
                &mixed_task.task_id,
                &select("mixed-refused", &mixed.version_id, &accepted_mixed)
            )
            .await,
        Err(SkillsError::Ineligible)
    );
    assert!(f.discovery(&mixed_task).await.selections.is_empty());

    // A teammate's nonexistent substitute member policy must not replace the
    // accountable accepted actor; loss of that accepted actor's access fences.
    sqlx::query("UPDATE public.engagement_assignments SET active=false WHERE actor_id='actor-a' AND engagement_id='engagement-a'").execute(&mut *owner).await.unwrap();
    let changed = f
        .manager
        .discover("actor-manager", &scope(), &task.task_id)
        .await
        .unwrap();
    assert_eq!(
        candidate(&changed, &skill.version_id).inspection.status,
        EligibilityStatus::Forbidden
    );
    sqlx::query("UPDATE public.engagement_assignments SET active=true WHERE actor_id='actor-a' AND engagement_id='engagement-a'").execute(&mut *owner).await.unwrap();

    // Bad persisted policy bytes yield unavailable, never an empty catalogue or
    // fabricated denial. Restore exact owned test state before further checks.
    let original:String=sqlx::query_scalar("SELECT document FROM public.permission_versions WHERE kind='task' AND subject_id=$1 AND version=1").bind(&task.task_id).fetch_one(&mut *owner).await.unwrap();
    sqlx::query("UPDATE public.permission_versions SET document='{}' WHERE kind='task' AND subject_id=$1 AND version=1").bind(&task.task_id).execute(&mut *owner).await.unwrap();
    let corrupt = f
        .manager
        .discover("actor-manager", &scope(), &task.task_id)
        .await
        .unwrap();
    assert_eq!(
        candidate(&corrupt, &skill.version_id).inspection.status,
        EligibilityStatus::Unavailable
    );
    assert!(
        corrupt
            .candidates
            .iter()
            .any(|item| item.version.id == skill.version_id)
    );
    sqlx::query("UPDATE public.permission_versions SET document=$2 WHERE kind='task' AND subject_id=$1 AND version=1").bind(&task.task_id).bind(original).execute(&mut *owner).await.unwrap();

    let mut denied = accepted.task.clone();
    denied.version += 1;
    denied.created_at = now();
    denied.hard.rules.clear();
    f.operations
        .save_policy("actor-a", &scope(), &denied)
        .await
        .unwrap();
    let retry = f
        .manager
        .select("actor-manager", &scope(), &task.task_id, &selected_command)
        .await
        .unwrap();
    assert_eq!(retry.selection, selected.selection);
    assert_eq!(retry.current.status, EligibilityStatus::Forbidden);
    assert_eq!(
        f.manager
            .current_use(
                "actor-manager",
                &scope(),
                &task.task_id,
                &selected.selection.id
            )
            .await
            .unwrap()
            .current
            .status,
        EligibilityStatus::Forbidden
    );
    let changed = f
        .manager
        .discover("actor-manager", &scope(), &task.task_id)
        .await
        .unwrap();
    assert_eq!(
        f.manager
            .select(
                "actor-manager",
                &scope(),
                &task.task_id,
                &select("forbidden-new", &skill.version_id, &changed)
            )
            .await,
        Err(SkillsError::Ineligible)
    );

    let mut unsupported = install("analysis-unsupported", f.revision().await);
    let mut need = send_need();
    need.tool = "analysis_v1".into();
    unsupported.manifest.needs.push(need);
    let unsupported = f
        .admin
        .install("actor-admin", "org-a", &unsupported)
        .await
        .unwrap();
    let changed = f
        .manager
        .discover("actor-manager", &scope(), &task.task_id)
        .await
        .unwrap();
    assert_eq!(
        candidate(&changed, &unsupported.version_id)
            .inspection
            .status,
        EligibilityStatus::Unavailable
    );

    // The server requires a real, exact source binding even for advisory inspection.
    let invalid: SocketAddr = "192.0.2.1:43199".parse().unwrap();
    assert!(matches!(
        SkillsRepository::new(f.pool.clone()).with_qualification_source(invalid, source()),
        Err(SkillsError::Invalid)
    ));
    let mut wrong = source();
    wrong.endpoint_digest = "a".repeat(64);
    assert!(matches!(
        SkillsRepository::new(f.pool.clone())
            .with_qualification_source("127.0.0.1:43199".parse().unwrap(), wrong),
        Err(SkillsError::Invalid)
    ));
}

async fn restriction_race_orders(
    f: &Fixture,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    for (index, selection_first) in [false, true].into_iter().enumerate() {
        let skill = f.install(&format!("race-skill-{index}")).await;
        let task = f.task(&format!("race-task-{index}")).await;
        let discovery = f.discovery(&task).await;
        let command = select(
            &format!("race-selection-{index}"),
            &skill.version_id,
            &discovery,
        );
        let disable = ChangeSkillStatus {
            key: format!("race-disable-{index}"),
            expected_revision: discovery.catalog_revision,
            version_id: skill.version_id.clone(),
            status: CatalogStatus::Disabled,
            reason: "Race restriction".into(),
        };
        let mut blocker = owner.begin().await.unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
            .execute(&mut *blocker)
            .await
            .unwrap();
        let selector = f.auditor.clone();
        let administrator = f.admin.clone();
        let task_id = task.task_id.clone();
        let (selected, disabled) = if selection_first {
            let selected = tokio::spawn(async move {
                selector
                    .select("actor-a", &scope(), &task_id, &command)
                    .await
            });
            wait_blocked(observer, 1).await;
            let disabled = tokio::spawn(async move {
                administrator
                    .set_status("actor-admin", "org-a", &disable)
                    .await
            });
            (selected, disabled)
        } else {
            let disabled = tokio::spawn(async move {
                administrator
                    .set_status("actor-admin", "org-a", &disable)
                    .await
            });
            wait_blocked(observer, 1).await;
            let selected = tokio::spawn(async move {
                selector
                    .select("actor-a", &scope(), &task_id, &command)
                    .await
            });
            (selected, disabled)
        };
        wait_blocked(observer, 2).await;
        blocker.commit().await.unwrap();
        let selected = selected.await.unwrap();
        let disabled = disabled.await.unwrap().unwrap();
        if selection_first {
            let selected = selected.unwrap();
            assert_eq!(disabled.affected_selections, 1);
            assert_eq!(
                f.auditor
                    .current_use("actor-a", &scope(), &task.task_id, &selected.selection.id)
                    .await
                    .unwrap()
                    .current
                    .status,
                EligibilityStatus::Disabled
            );
        } else {
            assert_eq!(selected, Err(SkillsError::Conflict));
            assert_eq!(disabled.affected_selections, 0);
            assert!(f.discovery(&task).await.selections.is_empty());
        }
    }
}

async fn deferred_expiry_rolls_back_selection(
    f: &Fixture,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    let mut install = install("deadline-skill", f.revision().await);
    install.manifest.needs.push(send_need());
    let skill = f
        .admin
        .install("actor-admin", "org-a", &install)
        .await
        .unwrap();
    let task = f.task("deadline-task").await;
    let expires = now() + 3;
    f.accept(&task, Some(expires)).await;
    let discovery = f.discovery(&task).await;
    assert!(
        candidate(&discovery, &skill.version_id)
            .inspection
            .selectable()
    );
    owner.execute("CREATE FUNCTION public.skill_deferred_deadline_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='deadline-late' THEN PERFORM pg_advisory_xact_lock(21030901); END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER skill_deadline_test AFTER INSERT ON public.task_skill_selections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.skill_deferred_deadline_test()").await.unwrap();
    let mut blocker = owner.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(DEFERRED_GATE)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let selector = f.auditor.clone();
    let task_id = task.task_id.clone();
    let command = select("deadline-late", &skill.version_id, &discovery);
    let selected = tokio::spawn(async move {
        selector
            .select("actor-a", &scope(), &task_id, &command)
            .await
    });
    wait_blocked(observer, 1).await;
    let stop = tokio::time::Instant::now() + Duration::from_secs(5);
    while now() < expires {
        assert!(tokio::time::Instant::now() < stop);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    blocker.commit().await.unwrap();
    assert_eq!(selected.await.unwrap(), Err(SkillsError::Ineligible));
    owner.execute("DROP TRIGGER skill_deadline_test ON public.task_skill_selections; DROP FUNCTION public.skill_deferred_deadline_test()").await.unwrap();
    let stored: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.task_skill_selections WHERE task_id=$1")
            .bind(&task.task_id)
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    assert_eq!(
        stored, 0,
        "deadline crossed after staged write must roll back selection atomically"
    );
    let fresh = f.discovery(&task).await;
    assert_eq!(fresh.selection_revision, 0);
    assert_eq!(
        candidate(&fresh, &skill.version_id).inspection.status,
        EligibilityStatus::Forbidden
    );
}

async fn catalog_capacity_keeps_restrictions_and_replay(f: &Fixture) {
    let snapshot = f.admin.catalog("actor-admin", "org-a").await.unwrap();
    let mut revision = snapshot.revision;
    let mut last = None;
    for index in snapshot.versions.len()..128 {
        let command = install(&format!("capacity-{index}"), revision);
        let receipt = f
            .admin
            .install("actor-admin", "org-a", &command)
            .await
            .unwrap();
        revision = receipt.revision;
        last = Some((command, receipt));
    }
    assert_eq!(
        f.admin
            .catalog("actor-admin", "org-a")
            .await
            .unwrap()
            .versions
            .len(),
        128
    );
    assert_eq!(
        f.admin
            .install(
                "actor-admin",
                "org-a",
                &install("capacity-overflow", revision)
            )
            .await,
        Err(SkillsError::Capacity)
    );
    let (command, receipt) = last.unwrap();
    assert_eq!(
        f.admin
            .install("actor-admin", "org-a", &command)
            .await
            .unwrap(),
        receipt
    );
    let disabled = f
        .status(
            "capacity-disable",
            &receipt.version_id,
            CatalogStatus::Disabled,
        )
        .await;
    let recalled = f
        .status(
            "capacity-recall",
            &receipt.version_id,
            CatalogStatus::Recalled,
        )
        .await;
    assert_eq!(recalled.revision, disabled.revision + 1);
    assert_eq!(
        f.admin
            .install("actor-admin", "org-a", &command)
            .await
            .unwrap(),
        receipt
    );
    assert_eq!(
        f.admin
            .catalog("actor-admin", "org-a")
            .await
            .unwrap()
            .versions
            .len(),
        128
    );
}

async fn catalog_byte_capacity_keeps_restrictions_and_replay(
    f: &Fixture,
    owner: &mut PgConnection,
) {
    const LIMIT: i64 = 2 * 1024 * 1024;
    // A separate seeded organisation isolates the byte boundary from org-a's
    // independent 128-version boundary. Every version enters through the real
    // runtime repository; the owner only measures persisted PostgreSQL bytes.
    let token = f
        .identities
        .establish_session(ISSUER, "admin-b-only", "Admin B", None)
        .await
        .unwrap();
    let admin = SkillsRepository::new(f.pool.clone()).with_session_hash(secret_hash(&token));
    let mut snapshot = admin.catalog("actor-admin-b", "org-b").await.unwrap();
    assert!(snapshot.versions.is_empty());
    let mut first = None;
    let before_effects = side_effects(owner).await;
    let mut refused = false;
    for index in 0..128 {
        let mut command = install(&format!("catalog-byte-{index}"), snapshot.revision);
        command.manifest.resources = (0..4)
            .map(|part| Resource {
                id: format!("large-content-{part}"),
                kind: "text".into(),
                content: "x".repeat(32_768),
            })
            .collect();
        assert!(command.is_valid());
        let requested_bytes: i64 =
            sqlx::query_scalar("SELECT octet_length($1::jsonb::text)::bigint")
                .bind(serde_json::to_string(&command).unwrap())
                .fetch_one(&mut *owner)
                .await
                .unwrap();
        assert!(
            requested_bytes < 1_048_576,
            "each command respects the individual row cap"
        );
        let result = admin.install("actor-admin-b", "org-b", &command).await;
        match result {
            Ok(receipt) => {
                if first.is_none() {
                    first = Some((command, receipt));
                }
                snapshot = admin.catalog("actor-admin-b", "org-b").await.unwrap();
            }
            Err(SkillsError::Capacity) => {
                let (rows, stored_bytes): (i64, i64) = sqlx::query_as("SELECT count(*),coalesce(sum(octet_length(command::text)),0)::bigint FROM public.skill_versions WHERE organisation_id='org-b'")
                    .fetch_one(&mut *owner).await.unwrap();
                assert!(
                    rows > 1 && rows < 128,
                    "byte capacity must precede row capacity: {rows}"
                );
                assert_eq!(rows as usize, snapshot.versions.len());
                assert!(stored_bytes <= LIMIT && stored_bytes + requested_bytes > LIMIT);
                assert_eq!(
                    admin.catalog("actor-admin-b", "org-b").await.unwrap(),
                    snapshot
                );
                let events: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM public.skill_events WHERE organisation_id='org-b'",
                )
                .fetch_one(&mut *owner)
                .await
                .unwrap();
                assert_eq!(events, rows, "failed install creates no event or revision");
                let failed_events: i64 = sqlx::query_scalar("SELECT count(*) FROM public.skill_events WHERE organisation_id='org-b' AND key=$1")
                    .bind(&command.key).fetch_one(&mut *owner).await.unwrap();
                assert_eq!(failed_events, 0);
                assert_eq!(
                    admin.install("actor-admin-b", "org-b", &command).await,
                    Err(SkillsError::Capacity)
                );
                assert_eq!(
                    admin.catalog("actor-admin-b", "org-b").await.unwrap(),
                    snapshot
                );
                refused = true;
                break;
            }
            other => panic!("unexpected byte-capacity result: {other:?}"),
        }
    }
    assert!(
        refused,
        "real cumulative command bytes must hit the 2 MiB guard"
    );
    assert_eq!(side_effects(owner).await, before_effects);
    let (original, receipt) = first.unwrap();
    assert_eq!(
        admin
            .install("actor-admin-b", "org-b", &original)
            .await
            .unwrap(),
        receipt
    );
    let mut revision = snapshot.revision;
    for (index, status) in [CatalogStatus::Disabled, CatalogStatus::Recalled]
        .into_iter()
        .enumerate()
    {
        let command = ChangeSkillStatus {
            key: format!("catalog-byte-restrict-{index}"),
            expected_revision: revision,
            version_id: receipt.version_id.clone(),
            status,
            reason: "Restrictions remain available at the cumulative byte cap".into(),
        };
        let restricted = admin
            .set_status("actor-admin-b", "org-b", &command)
            .await
            .unwrap();
        assert_eq!(restricted.revision, revision + 1);
        assert_eq!(restricted.affected_selections, 0);
        assert_eq!(
            admin
                .set_status("actor-admin-b", "org-b", &command)
                .await
                .unwrap(),
            restricted
        );
        assert_eq!(
            admin
                .install("actor-admin-b", "org-b", &original)
                .await
                .unwrap(),
            receipt
        );
        let current = admin.catalog("actor-admin-b", "org-b").await.unwrap();
        assert_eq!(current.revision, restricted.revision);
        assert_eq!(current.versions.len(), snapshot.versions.len());
        let retained = current
            .versions
            .iter()
            .find(|version| version.id == receipt.version_id)
            .unwrap();
        assert_eq!(retained.command, original);
        assert_eq!(retained.status, status);
        revision = restricted.revision;
    }
    assert_eq!(side_effects(owner).await, before_effects);
}

async fn exact_session_replacement(f: &Fixture) {
    let task = f.task("session-task").await;
    let before = f.discovery(&task).await;
    let version = before
        .candidates
        .iter()
        .find(|item| item.inspection.selectable())
        .unwrap()
        .version
        .id
        .clone();
    let command = select("session-original-selection", &version, &before);
    let chosen = f
        .auditor
        .select("actor-a", &scope(), &task.task_id, &command)
        .await
        .unwrap();
    let replacement = f
        .identities
        .establish_session(ISSUER, "auditor-a", "Auditor", Some(&f.auditor_token))
        .await
        .unwrap();
    assert_eq!(
        f.auditor.discover("actor-a", &scope(), &task.task_id).await,
        Err(SkillsError::Denied)
    );
    assert_eq!(
        f.auditor
            .select("actor-a", &scope(), &task.task_id, &command)
            .await,
        Err(SkillsError::Denied)
    );
    assert_eq!(
        f.auditor
            .current_use("actor-a", &scope(), &task.task_id, &chosen.selection.id)
            .await,
        Err(SkillsError::Denied)
    );
    let current =
        SkillsRepository::new(f.pool.clone()).with_session_hash(secret_hash(&replacement));
    assert_eq!(
        current
            .select("actor-a", &scope(), &task.task_id, &command)
            .await
            .unwrap()
            .selection,
        chosen.selection
    );
    // Replacing the same browser with a different identity never inherits old
    // private selection/catalogue disclosure or exact retry access.
    let replacement = f
        .identities
        .establish_session(ISSUER, "admin-only", "Admin", Some(&f.manager_token))
        .await
        .unwrap();
    assert_eq!(
        f.manager
            .discover("actor-manager", &scope(), &task.task_id)
            .await,
        Err(SkillsError::Denied)
    );
    let admin = SkillsRepository::new(f.pool.clone()).with_session_hash(secret_hash(&replacement));
    assert!(admin.catalog("actor-admin", "org-a").await.is_ok());
    assert_eq!(
        admin.discover("actor-admin", &scope(), &task.task_id).await,
        Err(SkillsError::Denied)
    );
}

async fn qualified_tool_mapping_preserves_read_write_distinction(
    f: &Fixture,
    owner: &mut PgConnection,
) {
    let task = f.task("read-only-test-tools").await;
    // Literal permission meaning is independent of ToolId.mapping and of the
    // manifest conversion under test. Only test reads have hard coverage.
    let read = PermissionRule {
        purpose: Purpose::TestWorkflows,
        action: Action::Read,
        account_id: "test-account".into(),
        environment_id: "test-environment".into(),
        destination: "owned-endpoint".into(),
        resource_id: "test-resource".into(),
        recipients: vec![],
        attachment_classifications: vec![],
        expires_at: 4_102_444_800,
    };
    let mut shared = Vec::new();
    for (kind, subject) in [
        (PolicyKind::Organisation, "org-a"),
        (PolicyKind::Engagement, "engagement-a"),
        (PolicyKind::Member, "actor-a"),
    ] {
        let encoded: String = sqlx::query_scalar("SELECT v.document FROM public.permission_heads h JOIN public.permission_versions v ON (v.organisation_id,v.policy_key,v.version)=(h.organisation_id,h.policy_key,h.current_version) WHERE h.organisation_id='org-a' AND v.kind=$1 AND v.subject_id=$2")
            .bind(kind.as_str()).bind(subject).fetch_one(&mut *owner).await.unwrap();
        let mut document =
            serde_json::from_str::<zobba_application::operation::wire::StoredPolicy>(&encoded)
                .unwrap()
                .0;
        document.version += 1;
        document.created_at = now();
        document.hard.rules = vec![read.clone()];
        document.standing.rules.clear();
        f.operations
            .save_policy("actor-manager", &scope(), &document)
            .await
            .unwrap();
        shared.push(document);
    }
    let mut account = policy(PolicyKind::Account, "test-account");
    account.hard.rules = vec![read.clone()];
    account.account = Some(AccountRestriction {
        source: source(),
        account_id: "test-account".into(),
        environment_id: "test-environment".into(),
        environment: EnvironmentKind::Test,
        read_restriction: ReadRestriction::None,
        restriction_survives_takeover: false,
        test_environment_verified: true,
        test_resources: vec!["test-resource".into()],
        test_cleanup_id: Some("test-cleanup".into()),
        audit_resources: vec![],
    });
    f.operations
        .save_policy("actor-manager", &scope(), &account)
        .await
        .unwrap();
    let mut task_policy = policy(PolicyKind::Task, &task.task_id);
    task_policy.actor_id = "actor-a".into();
    task_policy.hard.rules = vec![read];
    let accepted = AuthoritySnapshot {
        scope: scope(),
        actor_id: "actor-a".into(),
        task_id: task.task_id.clone(),
        organisation: shared[0].clone(),
        engagement: shared[1].clone(),
        member: shared[2].clone(),
        account,
        task: task_policy,
        delegations: vec![],
    };
    f.operations
        .accept_authority("actor-a", &scope(), &task.task_id, &accepted)
        .await
        .unwrap();
    let before_effects = side_effects(owner).await;
    let mut versions = Vec::new();
    for (key, tool) in [
        ("mapped-test-read", "test_read_v1"),
        ("mapped-test-write", "test_write_v1"),
        ("mapped-analysis", "analysis_v1"),
    ] {
        let mut command = install(key, f.revision().await);
        command.manifest.needs.push(ToolNeed {
            id: "required-tool".into(),
            tool: tool.into(),
            account_id: Some("test-account".into()),
            environment_id: Some("test-environment".into()),
            destination: Some("owned-endpoint".into()),
            resource_id: Some("test-resource".into()),
            recipients: vec![],
            attachment_classifications: vec![],
            requires_attachments: false,
        });
        versions.push(
            f.admin
                .install("actor-admin", "org-a", &command)
                .await
                .unwrap(),
        );
    }
    let discovery = f.discovery(&task).await;
    let read_inspection = &candidate(&discovery, &versions[0].version_id).inspection;
    assert_eq!(read_inspection.status, EligibilityStatus::Eligible);
    assert_eq!(
        read_inspection.needs[0].status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    let write_inspection = &candidate(&discovery, &versions[1].version_id).inspection;
    assert_eq!(write_inspection.status, EligibilityStatus::Forbidden);
    assert_eq!(
        write_inspection.needs[0].status,
        CapabilityStatus::Forbidden
    );
    assert_eq!(
        candidate(&discovery, &versions[2].version_id)
            .inspection
            .status,
        EligibilityStatus::Unavailable
    );
    assert_eq!(
        f.auditor
            .select(
                "actor-a",
                &scope(),
                &task.task_id,
                &select("mapped-write-refused", &versions[1].version_id, &discovery)
            )
            .await,
        Err(SkillsError::Ineligible)
    );
    let selected = f
        .auditor
        .select(
            "actor-a",
            &scope(),
            &task.task_id,
            &select("mapped-read-selected", &versions[0].version_id, &discovery),
        )
        .await
        .unwrap();
    assert_eq!(selected.current.status, EligibilityStatus::Eligible);
    assert_eq!(
        selected.current.needs[0].status,
        CapabilityStatus::CompatibleNeedsExactDetails
    );
    let unqualified = f
        .unqualified
        .discover("actor-a", &scope(), &task.task_id)
        .await
        .unwrap();
    assert_eq!(
        candidate(&unqualified, &versions[0].version_id)
            .inspection
            .status,
        EligibilityStatus::Unavailable
    );
    assert_eq!(
        candidate(&unqualified, &versions[1].version_id)
            .inspection
            .status,
        EligibilityStatus::Forbidden
    );
    assert_eq!(side_effects(owner).await, before_effects);
}

async fn selected_history_byte_capacity(f: &Fixture, owner: &mut PgConnection) {
    const LIMIT: i64 = 1024 * 1024;
    let skill = f.install("selection-byte-skill").await;
    let task = f.task("selection-byte-task").await;
    let mut discovery = f.discovery(&task).await;
    let mut first = None;
    let mut previous_receipt_bytes = 0;
    let mut refused = false;
    let before_effects = side_effects(owner).await;
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM public.skill_events")
        .fetch_one(&mut *owner)
        .await
        .unwrap();
    for index in 0..128 {
        // 2,000 Unicode scalars are valid prose, with 8,000 real UTF-8 bytes.
        // Together with the actual pinned method this crosses the byte guard
        // before 128 receipts, without owner-seeding or synthetic padding.
        let mut command = select(
            &format!("selection-byte-{index}"),
            &skill.version_id,
            &discovery,
        );
        command.reason = "🧭".repeat(2_000);
        assert!(command.is_valid());
        match f
            .auditor
            .select("actor-a", &scope(), &task.task_id, &command)
            .await
        {
            Ok(receipt) => {
                previous_receipt_bytes = sqlx::query_scalar::<_, i64>("SELECT octet_length(receipt::text)::bigint FROM public.task_skill_selections WHERE task_id=$1 AND id=$2")
                    .bind(&task.task_id).bind(&receipt.selection.id).fetch_one(&mut *owner).await.unwrap();
                assert!(
                    previous_receipt_bytes > LIMIT / 128,
                    "real receipts must reach byte cap before row cap"
                );
                assert!(
                    previous_receipt_bytes < LIMIT,
                    "each receipt respects the individual row cap"
                );
                assert_eq!(receipt.selection.reason, command.reason);
                if first.is_none() {
                    first = Some((command, receipt));
                }
                discovery = f.discovery(&task).await;
            }
            Err(SkillsError::Capacity) => {
                let (rows, bytes): (i64, i64) = sqlx::query_as("SELECT count(*),coalesce(sum(octet_length(receipt::text)),0)::bigint FROM public.task_skill_selections WHERE task_id=$1")
                    .bind(&task.task_id).fetch_one(&mut *owner).await.unwrap();
                assert!(
                    rows > 1 && rows < 128,
                    "byte refusal must precede the row ceiling: {rows}"
                );
                assert!(bytes <= LIMIT && bytes + previous_receipt_bytes > LIMIT);
                assert_eq!(rows as u64, discovery.selection_revision);
                let after = f.discovery(&task).await;
                assert_eq!(after.selection_revision, discovery.selection_revision);
                assert_eq!(after.catalog_revision, discovery.catalog_revision);
                assert_eq!(
                    after
                        .selections
                        .iter()
                        .map(|v| &v.selection)
                        .collect::<Vec<_>>(),
                    discovery
                        .selections
                        .iter()
                        .map(|v| &v.selection)
                        .collect::<Vec<_>>()
                );
                assert!(after.selections.iter().all(|v| v.current.selectable()));
                let missing: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM public.task_skill_selections WHERE task_id=$1 AND key=$2",
                )
                .bind(&task.task_id)
                .bind(&command.key)
                .fetch_one(&mut *owner)
                .await
                .unwrap();
                assert_eq!(missing, 0);
                assert_eq!(
                    f.auditor
                        .select("actor-a", &scope(), &task.task_id, &command)
                        .await,
                    Err(SkillsError::Capacity)
                );
                assert_eq!(
                    f.discovery(&task).await.selection_revision,
                    discovery.selection_revision
                );
                refused = true;
                break;
            }
            other => panic!("unexpected receipt byte-capacity result: {other:?}"),
        }
    }
    assert!(refused, "real cumulative receipts must hit the 1 MiB guard");
    assert_eq!(side_effects(owner).await, before_effects);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.skill_events")
            .fetch_one(&mut *owner)
            .await
            .unwrap(),
        events
    );
    let (command, original) = first.unwrap();
    assert_eq!(
        f.auditor
            .select("actor-a", &scope(), &task.task_id, &command)
            .await
            .unwrap()
            .selection,
        original.selection
    );
    let count = discovery.selection_revision;
    let catalog_revision = discovery.catalog_revision;
    for (index, (status, eligibility)) in [
        (CatalogStatus::Disabled, EligibilityStatus::Disabled),
        (CatalogStatus::Recalled, EligibilityStatus::Recalled),
    ]
    .into_iter()
    .enumerate()
    {
        let restricted = f
            .status(
                &format!("selection-byte-restrict-{index}"),
                &skill.version_id,
                status,
            )
            .await;
        assert_eq!(restricted.affected_selections, count);
        assert_eq!(restricted.revision, catalog_revision + index as u64 + 1);
        let replay = f
            .auditor
            .select("actor-a", &scope(), &task.task_id, &command)
            .await
            .unwrap();
        assert_eq!(replay.selection, original.selection);
        assert_eq!(replay.current.status, eligibility);
        let current = f.discovery(&task).await;
        assert_eq!(current.selection_revision, count);
        assert_eq!(current.selections.len(), count as usize);
        assert!(
            current
                .selections
                .iter()
                .all(|v| v.current.status == eligibility)
        );
        assert_eq!(
            current
                .selections
                .iter()
                .map(|v| &v.selection)
                .collect::<Vec<_>>(),
            discovery
                .selections
                .iter()
                .map(|v| &v.selection)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            f.auditor
                .current_use("actor-a", &scope(), &task.task_id, &original.selection.id)
                .await
                .unwrap()
                .current
                .status,
            eligibility
        );
    }
    assert_eq!(side_effects(owner).await, before_effects);
}

async fn selected_history_capacity(f: &Fixture, owner: &mut PgConnection) {
    let skill = f.install("selection-capacity-skill").await;
    let task = f.task("selection-capacity-task").await;
    let discovery = f.discovery(&task).await;
    let command = select("capacity-original", &skill.version_id, &discovery);
    let original = f
        .auditor
        .select("actor-a", &scope(), &task.task_id, &command)
        .await
        .unwrap();
    // The guarded schema owner expands an actual immutable receipt into a
    // synthetic, valid 128-row history. Production runtime cannot write tables.
    sqlx::query("INSERT INTO public.task_skill_selections(organisation_id,client_id,engagement_id,task_id,id,selector_id,key,revision,version_id,command,receipt) SELECT s.organisation_id,s.client_id,s.engagement_id,s.task_id,'capacity-selection-'||n,s.selector_id,'capacity-key-'||n,n,s.version_id,s.command||jsonb_build_object('key','capacity-key-'||n,'expected_selection_revision',n-1),s.receipt||jsonb_build_object('id','capacity-selection-'||n,'revision',n) FROM public.task_skill_selections s CROSS JOIN generate_series(2,128) n WHERE s.task_id=$1 AND s.revision=1")
        .bind(&task.task_id).execute(&mut *owner).await.unwrap();
    let full = f.discovery(&task).await;
    assert_eq!(full.selection_revision, 128);
    assert_eq!(full.selections.len(), 128);
    assert!(
        full.selections
            .iter()
            .all(|selected| selected.current.selectable())
    );
    let before = side_effects(owner).await;
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM public.skill_events")
        .fetch_one(&mut *owner)
        .await
        .unwrap();
    assert_eq!(
        f.auditor
            .select(
                "actor-a",
                &scope(),
                &task.task_id,
                &select("capacity-new", &skill.version_id, &full)
            )
            .await,
        Err(SkillsError::Capacity)
    );
    assert_eq!(f.discovery(&task).await.selection_revision, 128);
    assert_eq!(side_effects(owner).await, before);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM public.skill_events")
            .fetch_one(&mut *owner)
            .await
            .unwrap(),
        events
    );
    assert_eq!(
        f.auditor
            .select("actor-a", &scope(), &task.task_id, &command)
            .await
            .unwrap()
            .selection,
        original.selection
    );
    let disabled = f
        .status(
            "selection-capacity-disable",
            &skill.version_id,
            CatalogStatus::Disabled,
        )
        .await;
    assert_eq!(disabled.affected_selections, 128);
    let retry = f
        .auditor
        .select("actor-a", &scope(), &task.task_id, &command)
        .await
        .unwrap();
    assert_eq!(retry.selection, original.selection);
    assert_eq!(retry.current.status, EligibilityStatus::Disabled);
    let recalled = f
        .status(
            "selection-capacity-recall",
            &skill.version_id,
            CatalogStatus::Recalled,
        )
        .await;
    assert_eq!(recalled.affected_selections, 128);
    let history = f.discovery(&task).await;
    assert_eq!(history.selections.len(), 128);
    assert!(
        history
            .selections
            .iter()
            .all(|selection| selection.current.status == EligibilityStatus::Recalled)
    );
    assert_eq!(
        f.auditor
            .current_use("actor-a", &scope(), &task.task_id, &original.selection.id)
            .await
            .unwrap()
            .current
            .status,
        EligibilityStatus::Recalled
    );
}

async fn consumed_receipt_survives_recall(f: &Fixture) {
    let mut command = install("consumed-technique", f.revision().await);
    command.manifest.needs.push(send_need());
    let skill = f
        .admin
        .install("actor-admin", "org-a", &command)
        .await
        .unwrap();
    let task = f.task("consumed-skill-task").await;
    f.accept(&task, None).await;
    let route = WakeupRoute {
        id: task.task_id.clone(),
        actor_id: "actor-a".into(),
        scope: scope(),
        task_id: task.task_id.clone(),
    };
    let Decision::Execute(basis) = f
        .tasks
        .coordinate(&route, "skills-receipt-worker")
        .await
        .unwrap()
    else {
        panic!("expected exact synthetic producing basis");
    };
    let discovery = f.discovery(&task).await;
    let chosen = f
        .auditor
        .select(
            "actor-a",
            &scope(),
            &task.task_id,
            &select("consumed-choice", &skill.version_id, &discovery),
        )
        .await
        .unwrap();
    // Complete exact operation fixture exists only in this test. Discovery and
    // selection never manufacture a material/resource-version/expiry probe.
    let material = "Synthetic review receipt";
    let request = CanonicalOperation {
        version: 1,
        purpose: Purpose::AuditCoordination,
        action: Action::Send,
        account_id: "audit-account".into(),
        environment_id: "audit-environment".into(),
        destination: "owned-endpoint".into(),
        recipients: vec!["recipient-a".into()],
        material: material.into(),
        material_digest: hash(material.as_bytes()),
        attachments: vec![],
        resource_id: "audit-resource".into(),
        resource_version: "v1".into(),
        expires_at: now() + 120,
    };
    let operation = f
        .operations
        .admit(
            "actor-a",
            &scope(),
            &basis,
            "consumed-skill-operation",
            &request,
        )
        .await
        .unwrap();
    assert_eq!(
        operation.state,
        OperationState::NeedsDecision,
        "selection did not approve an exact action"
    );
    f.operations
        .decide(
            "actor-a",
            &scope(),
            &DecisionCommand {
                key: "consumed-skill-decision".into(),
                operation_id: operation.id.clone(),
                expected_revision: operation.revision,
                request,
                expires_at: operation.request.expires_at,
                allow: true,
            },
        )
        .await
        .unwrap();
    let custody = f.operations.consume(&basis, &operation.id).await.unwrap();
    f.status(
        "consumed-skill-recall",
        &skill.version_id,
        CatalogStatus::Recalled,
    )
    .await;
    assert_eq!(
        f.auditor
            .current_use("actor-a", &scope(), &task.task_id, &chosen.selection.id)
            .await
            .unwrap()
            .current
            .status,
        EligibilityStatus::Recalled
    );
    // Supply a synthetic late source receipt through the existing receipt-only
    // port. A recalled technique must not cancel consumed observation custody.
    f.operations
        .observe(&custody, SourceFact::Completed)
        .await
        .unwrap();
    let retained = f
        .operations
        .get("actor-a", &scope(), &operation.id)
        .await
        .unwrap();
    assert_eq!(retained.state, OperationState::Completed);
    assert_eq!(
        retained.methodology_binding_id,
        chosen.selection.methodology.id
    );
}

async fn deferred_method_activation_rolls_back_selection(
    f: &Fixture,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    let skill = f.install("method-cutoff-skill").await;
    let task = f.task("method-cutoff-task").await;
    let methods =
        MethodologyRepository::new(f.pool.clone()).with_session_hash(secret_hash(&f.admin_token));
    let snapshot = methods.snapshot("actor-admin", "org-a").await.unwrap();
    let latest = snapshot.versions.last().unwrap();
    let mut activation = latest.command.clone();
    activation.key = "skill-method-cutoff".into();
    activation.expected_revision = snapshot.revision;
    activation.supersedes = Some(latest.id.clone());
    activation.definition.name = "Scheduled active skill methodology".into();
    activation.activation.mode = method::ActivationMode::ActiveTasks;
    activation.activation.available_at = now() + 3;
    owner.execute("CREATE FUNCTION public.skill_deferred_method_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='method-cutoff-late' THEN PERFORM pg_advisory_xact_lock(21030902); END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER skill_method_test AFTER INSERT ON public.task_skill_selections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.skill_deferred_method_test()").await.unwrap();
    methods
        .save("actor-admin", "org-a", &activation)
        .await
        .unwrap();
    let discovery = f.discovery(&task).await;
    assert!(
        candidate(&discovery, &skill.version_id)
            .inspection
            .selectable()
    );
    let mut blocker = owner.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(DEFERRED_GATE + 1)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let selector = f.auditor.clone();
    let task_id = task.task_id.clone();
    let command = select("method-cutoff-late", &skill.version_id, &discovery);
    let pending = tokio::spawn(async move {
        selector
            .select("actor-a", &scope(), &task_id, &command)
            .await
    });
    wait_blocked(observer, 1).await;
    let stop = tokio::time::Instant::now() + Duration::from_secs(5);
    while now() < activation.activation.available_at {
        assert!(tokio::time::Instant::now() < stop);
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    blocker.commit().await.unwrap();
    assert_eq!(pending.await.unwrap(), Err(SkillsError::Ineligible));
    owner.execute("DROP TRIGGER skill_method_test ON public.task_skill_selections; DROP FUNCTION public.skill_deferred_method_test()").await.unwrap();
    let stored: i64 =
        sqlx::query_scalar("SELECT count(*) FROM public.task_skill_selections WHERE task_id=$1")
            .bind(&task.task_id)
            .fetch_one(&mut *owner)
            .await
            .unwrap();
    assert_eq!(
        stored, 0,
        "method activation after staged write must roll back technique selection"
    );
    let fresh = f.discovery(&task).await;
    assert_eq!(fresh.selection_revision, 0);
    assert_eq!(
        candidate(&fresh, &skill.version_id).inspection.status,
        EligibilityStatus::MethodologyBlocked
    );
}

async fn policy_restriction_race_orders(
    f: &Fixture,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    for (index, selection_first) in [false, true].into_iter().enumerate() {
        let mut install = install(&format!("policy-race-skill-{index}"), f.revision().await);
        install.manifest.needs.push(send_need());
        let skill = f
            .admin
            .install("actor-admin", "org-a", &install)
            .await
            .unwrap();
        let task = f.task(&format!("policy-race-task-{index}")).await;
        let accepted = f.accept(&task, None).await;
        let discovery = f.discovery(&task).await;
        assert!(
            candidate(&discovery, &skill.version_id)
                .inspection
                .selectable()
        );
        let command = select(
            &format!("policy-race-select-{index}"),
            &skill.version_id,
            &discovery,
        );
        let mut restriction = accepted.task;
        restriction.version += 1;
        restriction.created_at = now();
        restriction.hard.rules.clear();
        let before_effects = side_effects(owner).await;
        let mut blocker = owner.begin().await.unwrap();
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('org-a',205))")
            .execute(&mut *blocker)
            .await
            .unwrap();
        let selector = f.auditor.clone();
        let policies = f.operations.clone();
        let task_id = task.task_id.clone();
        let submitted = command.clone();
        let (selected, restricted) = if selection_first {
            let selected = tokio::spawn(async move {
                selector
                    .select("actor-a", &scope(), &task_id, &submitted)
                    .await
            });
            wait_blocked(observer, 1).await;
            let restricted = tokio::spawn(async move {
                policies
                    .save_policy("actor-a", &scope(), &restriction)
                    .await
            });
            (selected, restricted)
        } else {
            let restricted = tokio::spawn(async move {
                policies
                    .save_policy("actor-a", &scope(), &restriction)
                    .await
            });
            wait_blocked(observer, 1).await;
            let selected = tokio::spawn(async move {
                selector
                    .select("actor-a", &scope(), &task_id, &submitted)
                    .await
            });
            (selected, restricted)
        };
        wait_blocked(observer, 2).await;
        blocker.commit().await.unwrap();
        let selected = selected.await.unwrap();
        restricted.await.unwrap().unwrap();
        let current = f.discovery(&task).await;
        assert_eq!(
            candidate(&current, &skill.version_id).inspection.status,
            EligibilityStatus::Forbidden
        );
        if selection_first {
            let selected = selected.unwrap();
            assert_eq!(current.selection_revision, 1);
            let retry = f
                .auditor
                .select("actor-a", &scope(), &task.task_id, &command)
                .await
                .unwrap();
            assert_eq!(retry.selection, selected.selection);
            assert_eq!(retry.current.status, EligibilityStatus::Forbidden);
            assert_eq!(
                f.auditor
                    .current_use("actor-a", &scope(), &task.task_id, &selected.selection.id)
                    .await
                    .unwrap()
                    .current
                    .status,
                EligibilityStatus::Forbidden
            );
        } else {
            assert_eq!(selected, Err(SkillsError::Ineligible));
            assert_eq!(current.selection_revision, 0);
            assert!(current.selections.is_empty());
        }
        assert_eq!(side_effects(owner).await, before_effects);
    }
}

async fn staged_selection_serializes_policy_and_logout(
    f: &Fixture,
    owner: &mut PgConnection,
    observer: &mut PgConnection,
) {
    let mut install = install("staged-policy-skill", f.revision().await);
    install.manifest.needs.push(send_need());
    let skill = f
        .admin
        .install("actor-admin", "org-a", &install)
        .await
        .unwrap();
    let task = f.task("staged-policy-task").await;
    let accepted = f.accept(&task, None).await;
    let discovery = f.discovery(&task).await;
    let command = select("staged-policy-selection", &skill.version_id, &discovery);
    let mut restriction = accepted.task;
    restriction.version += 1;
    restriction.created_at = now();
    restriction.hard.rules.clear();
    owner.execute("CREATE FUNCTION public.skill_deferred_serialization_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key IN ('staged-policy-selection','staged-session-selection') THEN PERFORM pg_advisory_xact_lock(21030903); END IF; RETURN NEW; END $$; CREATE CONSTRAINT TRIGGER skill_serialization_test AFTER INSERT ON public.task_skill_selections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.skill_deferred_serialization_test()").await.unwrap();
    let mut blocker = owner.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(DEFERRED_GATE + 2)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let selector = f.auditor.clone();
    let task_id = task.task_id.clone();
    let submitted = command.clone();
    let selected = tokio::spawn(async move {
        selector
            .select("actor-a", &scope(), &task_id, &submitted)
            .await
    });
    wait_blocked(observer, 1).await;
    let selecting_pid: i32 = sqlx::query_scalar("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND query LIKE 'SET CONSTRAINTS ALL IMMEDIATE%' AND cardinality(pg_blocking_pids(pid))>0")
        .bind(APP).fetch_one(&mut *observer).await.unwrap();
    let policies = f.operations.clone();
    let restricted = tokio::spawn(async move {
        policies
            .save_policy("actor-a", &scope(), &restriction)
            .await
    });
    wait_blocked(observer, 2).await;
    let policy_waits_for_selection: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND query LIKE '%pg_advisory_xact_lock%' AND $2=ANY(pg_blocking_pids(pid)))")
        .bind(APP).bind(selecting_pid).fetch_one(&mut *observer).await.unwrap();
    assert!(
        policy_waits_for_selection,
        "a real policy writer must wait behind the staged selection's organisation fence"
    );
    assert!(!restricted.is_finished());
    blocker.commit().await.unwrap();
    let chosen = selected.await.unwrap().unwrap();
    restricted.await.unwrap().unwrap();
    assert_eq!(
        f.auditor
            .current_use("actor-a", &scope(), &task.task_id, &chosen.selection.id)
            .await
            .unwrap()
            .current
            .status,
        EligibilityStatus::Forbidden
    );
    let replay = f
        .auditor
        .select("actor-a", &scope(), &task.task_id, &command)
        .await
        .unwrap();
    assert_eq!(replay.selection, chosen.selection);
    assert_eq!(replay.current.status, EligibilityStatus::Forbidden);

    // The exact captured session is held FOR SHARE by evidence_session_locked.
    // Logout's real DELETE cannot overtake this staged mutation. Use a separate
    // session so the rest of the suite keeps its original fixture identity.
    let private_token = f
        .identities
        .establish_session(ISSUER, "auditor-a", "Dedicated staged selector", None)
        .await
        .unwrap();
    let private_selector =
        SkillsRepository::new(f.pool.clone()).with_session_hash(secret_hash(&private_token));
    let session_skill = f.install("staged-session-skill").await;
    let session_task = f.task("staged-session-task").await;
    let discovery = private_selector
        .discover("actor-a", &scope(), &session_task.task_id)
        .await
        .unwrap();
    let command = select(
        "staged-session-selection",
        &session_skill.version_id,
        &discovery,
    );
    let mut blocker = owner.begin().await.unwrap();
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(DEFERRED_GATE + 2)
        .execute(&mut *blocker)
        .await
        .unwrap();
    let selector = private_selector.clone();
    let task_id = session_task.task_id.clone();
    let submitted = command.clone();
    let selected = tokio::spawn(async move {
        selector
            .select("actor-a", &scope(), &task_id, &submitted)
            .await
    });
    wait_blocked(observer, 1).await;
    let selecting_pid: i32 = sqlx::query_scalar("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND query LIKE 'SET CONSTRAINTS ALL IMMEDIATE%' AND cardinality(pg_blocking_pids(pid))>0")
        .bind(APP).fetch_one(&mut *observer).await.unwrap();
    let identities = f.identities.clone();
    let logged_out = tokio::spawn(async move { identities.logout(&private_token).await });
    wait_blocked(observer, 2).await;
    let logout_waits_for_selection: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND state='active' AND query LIKE 'DELETE FROM public.sessions%' AND $2=ANY(pg_blocking_pids(pid)))")
        .bind(APP).bind(selecting_pid).fetch_one(&mut *observer).await.unwrap();
    assert!(
        logout_waits_for_selection,
        "session DELETE must serialize behind the selection's exact session row lock"
    );
    assert!(!logged_out.is_finished());
    blocker.commit().await.unwrap();
    let chosen = selected.await.unwrap().unwrap();
    logged_out.await.unwrap().unwrap();
    assert_eq!(
        private_selector
            .select("actor-a", &scope(), &session_task.task_id, &command)
            .await,
        Err(SkillsError::Denied)
    );
    assert_eq!(
        private_selector
            .current_use(
                "actor-a",
                &scope(),
                &session_task.task_id,
                &chosen.selection.id
            )
            .await,
        Err(SkillsError::Denied)
    );
    assert_eq!(
        private_selector
            .discover("actor-a", &scope(), &session_task.task_id)
            .await,
        Err(SkillsError::Denied)
    );
    let retained = f.discovery(&session_task).await;
    assert_eq!(retained.selection_revision, 1);
    assert_eq!(retained.selections[0].selection, chosen.selection);
    owner.execute("DROP TRIGGER skill_serialization_test ON public.task_skill_selections; DROP FUNCTION public.skill_deferred_serialization_test()").await.unwrap();
}
