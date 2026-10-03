//! Real gateway regressions for expiry inside final model validation. All clock
//! and synchronization controls are confined to this disposable test fixture.
use super::*;
use std::{
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicUsize},
    },
    time::Instant,
};
use zobba_application::{
    knowledge::{
        Assertion, Dependency, KnowledgeAction, KnowledgeCommand, KnowledgeQuery, KnowledgeRecord,
        KnowledgeStore, Period, RecordReference, RecordStatus, VerificationItem, VerifyKnowledge,
    },
    methodology::MethodologyStore,
    model::*,
};
use zobba_infrastructure::{
    identity::{IdentityRepository, secret_hash},
    knowledge::KnowledgeRepository,
    methodology::MethodologyRepository,
    model::{ModelRepository, bind_disclosure},
};

#[derive(Clone, Copy, Debug)]
enum Expiry {
    Lease,
    Request,
    Approval,
    SourceAssignment,
}

struct ValidationGate {
    profile: ModelProfile,
    hold_validation: bool,
    armed: AtomicBool,
    calls: AtomicUsize,
    entered: tokio::sync::Notify,
    entered_at: Mutex<Option<Instant>>,
    released: Mutex<bool>,
    release: Condvar,
}
impl ValidationGate {
    fn new(profile: ModelProfile, hold_validation: bool) -> Self {
        Self {
            profile,
            hold_validation,
            armed: AtomicBool::new(false),
            calls: AtomicUsize::new(0),
            entered: tokio::sync::Notify::new(),
            entered_at: Mutex::new(None),
            released: Mutex::new(false),
            release: Condvar::new(),
        }
    }
    fn release(&self) {
        // Cleanup must also work during panic unwinding after a gate failure.
        *self
            .released
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
        self.release.notify_all();
    }
}
impl ModelQualificationSource for ValidationGate {
    fn qualified(&self, profile: &ModelProfile) -> bool {
        assert_eq!(profile, &self.profile);
        if self.armed.load(Ordering::SeqCst) {
            let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
            assert!(call <= 2, "one early and one final model validation");
            if call == 2 {
                *self.entered_at.lock().unwrap() = Some(Instant::now());
                if !self.hold_validation {
                    self.entered.notify_one();
                    return true;
                }
                // Hand the worker's queued I/O/timer work back to Tokio before
                // this synchronous test-only source waits. Merely adding a
                // second worker does not release work queued on this worker.
                let released = tokio::task::block_in_place(|| {
                    self.entered.notify_one();
                    let (released, _) = self
                        .release
                        .wait_timeout_while(
                            self.released
                                .lock()
                                .unwrap_or_else(std::sync::PoisonError::into_inner),
                            Duration::from_millis(1500),
                            |released| !*released,
                        )
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    *released
                });
                // Assert only after dropping the guard so a failed wait cannot
                // poison cleanup's mutex or panic again from ReleaseOnDrop.
                assert!(released, "final validation gate must release below 2s");
            }
        }
        true
    }
}
// Release even when a controller assertion fails; never strand the runtime on
// the synchronous qualification source while unwinding the async test.
struct ReleaseOnDrop(Arc<ValidationGate>);
impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        self.0.release();
    }
}

fn profile() -> ModelProfile {
    ModelProfile {
        id: "expiry-model".into(),
        revision: 1,
        provider: Provider::OpenAi,
        model: "expiry-fixture-model".into(),
        destination: "owned-model-endpoint".into(),
        account_id: "qualification-account".into(),
        capability_revision: "expiry-fixture-v1".into(),
        qualification: Qualification::Fixture,
        enabled: true,
        capabilities: Capabilities {
            tools: true,
            structured_output: false,
            reasoning: false,
        },
        max_output_tokens: 128,
    }
}

async fn assert_knowledge(
    knowledge: &KnowledgeRepository,
    selected: &Scope,
    task_id: &str,
    key: &str,
    dependencies: Vec<Dependency>,
) -> KnowledgeRecord {
    let page = knowledge
        .inspect("actor-a", selected, task_id, &KnowledgeQuery::default())
        .await
        .unwrap();
    knowledge
        .mutate(
            "actor-a",
            selected,
            task_id,
            &KnowledgeCommand {
                key: key.into(),
                expected_revision: page.revision,
                action: KnowledgeAction::Assert {
                    assertion: Assertion {
                        text: "Synthetic attributed source context".into(),
                        period: Period::default(),
                        uncertainty: Some("Local regression fixture assertion".into()),
                        dependencies,
                    },
                },
            },
        )
        .await
        .unwrap()
        .record
        .unwrap()
        .record
}

async fn source_context(
    pool: &PgPool,
    inspector: &mut PgConnection,
    task_id: &str,
) -> RecordReference {
    let source_scope = Scope {
        engagement_id: "engagement-support".into(),
        ..scope()
    };
    inspector.execute("INSERT INTO public.engagements(organisation_id,client_id,id,name) VALUES('org-a','client-a','engagement-support','Synthetic independent support')").await.unwrap();
    inspector.execute("INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES('org-a','client-a','engagement-support','actor-a')").await.unwrap();
    let source_task = TaskRepository::new(pool.clone())
        .admit(
            "actor-a",
            &source_scope,
            &TaskCommand {
                context: None,
                key: "expiry-support-task".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Synthetic independently scoped context".into()),
            },
        )
        .await
        .unwrap();
    let session = IdentityRepository::new(pool.clone())
        .establish_session("https://localhost:9443", "auditor-a", "Auditor", None)
        .await
        .unwrap();
    let knowledge = KnowledgeRepository::new(pool.clone()).with_session_hash(secret_hash(&session));
    let source = assert_knowledge(
        &knowledge,
        &source_scope,
        &source_task.task_id,
        "expiry-support-assertion",
        vec![],
    )
    .await;
    let local = assert_knowledge(
        &knowledge,
        &scope(),
        task_id,
        "expiry-consuming-assertion",
        vec![Dependency::Knowledge {
            id: source.id,
            revision: source.revision,
            scope: source.scope,
        }],
    )
    .await;
    RecordReference {
        id: local.id,
        revision: local.revision,
    }
}

async fn fixture(
    pool: &PgPool,
    inspector: &mut PgConnection,
    endpoint: &Endpoint,
    expiry: Expiry,
    gate: Arc<ValidationGate>,
) -> (ClaimBasis, Operation, i64) {
    let tasks = TaskRepository::new(pool.clone());
    let operations =
        OperationRepository::new(pool.clone()).with_model_qualification_source(gate.clone());
    let receipt = tasks
        .admit(
            "actor-a",
            &scope(),
            &TaskCommand {
                context: None,
                key: "final-validation-expiry".into(),
                kind: CommandKind::Create,
                task_id: None,
                cycle_id: None,
                content: Some("Synthetic final validation expiry".into()),
            },
        )
        .await
        .unwrap();
    // Build additional source records before starting the consuming owner lease.
    let source_reference = if matches!(expiry, Expiry::SourceAssignment) {
        Some(source_context(pool, inspector, &receipt.task_id).await)
    } else {
        None
    };
    let basis = match tasks
        .coordinate(
            &WakeupRoute {
                id: receipt.task_id.clone(),
                actor_id: "actor-a".into(),
                scope: scope(),
                task_id: receipt.task_id.clone(),
            },
            "expiry-fixture",
        )
        .await
        .unwrap()
    {
        Decision::Execute(basis) => *basis,
        other => panic!("expected current work, got {other:?}"),
    };
    let now: i64 =
        sqlx::query_scalar("SELECT floor(extract(epoch FROM clock_timestamp()))::bigint")
            .fetch_one(&mut *inspector)
            .await
            .unwrap();
    // Prepare with runway, then start dispatch near this real clock boundary.
    // The normal five-second owner lease is never lengthened by the fixture.
    let deadline = now + 4;
    let request = CanonicalOperation {
        version: 1,
        purpose: Purpose::TestWorkflows,
        action: Action::Write,
        account_id: "qualification-account".into(),
        environment_id: "qualification-environment".into(),
        destination: "owned-effect-store".into(),
        recipients: vec![],
        material: "Synthetic exact effect".into(),
        material_digest: format!("{:x}", Sha256::digest(b"Synthetic exact effect")),
        attachments: vec![],
        resource_id: "synthetic-record".into(),
        resource_version: "version-1".into(),
        expires_at: if matches!(expiry, Expiry::Request) {
            deadline
        } else {
            now + 600
        },
    };
    let mut disclosure = request.clone();
    disclosure.action = Action::Send;
    disclosure.destination = gate.profile.destination.clone();
    disclosure.recipients = vec!["owned-model-recipient".into()];
    disclosure.expires_at = now + 600;
    let rule = |request: &CanonicalOperation| PermissionRule {
        purpose: request.purpose,
        action: request.action,
        account_id: request.account_id.clone(),
        environment_id: request.environment_id.clone(),
        destination: request.destination.clone(),
        resource_id: request.resource_id.clone(),
        recipients: request.recipients.clone(),
        attachment_classifications: vec!["public".into()],
        expires_at: now + 3600,
    };
    let document = |kind, subject_id: String| PolicyDocument {
        schema_version: 1,
        kind,
        subject_id,
        version: 1,
        actor_id: "actor-manager".into(),
        created_at: now,
        revoked: false,
        hard: PermissionBounds {
            rules: vec![rule(&request), rule(&disclosure)],
        },
        // Request expiry is independent of any decision. Lease and approval
        // cases require exact approval for Write; model disclosure stays valid.
        standing: PermissionBounds {
            rules: if matches!(expiry, Expiry::Request) {
                vec![rule(&request), rule(&disclosure)]
            } else {
                vec![rule(&disclosure)]
            },
        },
        parent: None,
        account: (kind == PolicyKind::Account).then(|| AccountRestriction {
            source: endpoint.source.clone(),
            account_id: request.account_id.clone(),
            environment_id: request.environment_id.clone(),
            environment: EnvironmentKind::Test,
            read_restriction: ReadRestriction::None,
            restriction_survives_takeover: false,
            test_environment_verified: true,
            test_resources: vec![request.resource_id.clone()],
            test_cleanup_id: Some("qualification-cleanup".into()),
            audit_resources: vec![],
        }),
    };
    let mut authority = AuthoritySnapshot {
        scope: scope(),
        actor_id: "actor-a".into(),
        task_id: basis.task_id.clone(),
        organisation: document(PolicyKind::Organisation, "org-a".into()),
        engagement: document(PolicyKind::Engagement, "engagement-a".into()),
        member: document(PolicyKind::Member, "actor-a".into()),
        account: document(PolicyKind::Account, request.account_id.clone()),
        task: document(PolicyKind::Task, basis.task_id.clone()),
        delegations: vec![],
    };
    for policy in [
        &authority.organisation,
        &authority.engagement,
        &authority.member,
        &authority.account,
    ] {
        operations
            .save_policy("actor-manager", &scope(), policy)
            .await
            .unwrap();
    }
    authority.task.actor_id = "actor-a".into();
    operations
        .accept_authority("actor-a", &scope(), &basis.task_id, &authority)
        .await
        .unwrap();
    let session = IdentityRepository::new(pool.clone())
        .establish_session("https://localhost:9443", "manager-a", "Manager", None)
        .await
        .unwrap();
    let session_hash = secret_hash(&session);
    let models = ModelRepository::new(pool.clone())
        .with_session_hash(session_hash.clone())
        .with_qualification_source(gate.clone());
    let methods = MethodologyRepository::new(pool.clone()).with_session_hash(session_hash);
    let binding = methods
        .task_basis("actor-manager", &scope(), &basis.task_id)
        .await
        .unwrap();
    let catalogue = ToolCatalog {
        id: "expiry-tools".into(),
        revision: 1,
        enabled: true,
        tools: vec![ToolDescriptor {
            name: "write_exact".into(),
            version: 1,
            description: "Write exactly this synthetic effect".into(),
            operation: request.clone(),
            input_schema: ArgumentSchema::for_operation(&request),
            output_schema: ArgumentSchema::Boolean,
            effect: Effect::Write,
            cancellation: CancellationSemantics::LocalOnly,
            idempotency: IdempotencySemantics::ExactKey,
            reconciliation: ReconciliationSemantics::SourceLookup,
            completeness: OutputCompleteness::Complete,
        }],
    };
    models
        .save_profile("actor-manager", "org-a", &gate.profile)
        .await
        .unwrap();
    models
        .save_catalogue("actor-manager", "org-a", &catalogue)
        .await
        .unwrap();
    let mut model_request = ModelRequest {
        key: "expiry-invocation".into(),
        basis: basis.clone(),
        profile: gate.profile.clone(),
        catalogue,
        disclosure,
        context: ContextManifest {
            verification: VerifyKnowledge {
                expected_execution_epoch: basis.execution_epoch as u64,
                expected_methodology_binding_id: binding.current.id,
                exact: false,
                include_inactive: false,
                items: vec![],
            },
            entries: vec![ContextEntry {
                source_id: "owned-objective".into(),
                input_class: "public".into(),
                knowledge: None,
            }],
        },
        input_classes: vec!["public".into()],
        messages: vec![ModelMessage {
            role: MessageRole::User,
            text: "Propose the exact synthetic operation.".into(),
            source_id: Some("owned-objective".into()),
        }],
        history: vec![],
        effort: Effort::None,
        max_output_tokens: 128,
        structured_output: None,
    };
    if let Some(reference) = source_reference {
        model_request
            .context
            .verification
            .items
            .push(VerificationItem {
                id: reference.id.clone(),
                revision: reference.revision,
                status: RecordStatus::Current,
            });
        model_request.context.entries[0].knowledge = Some(reference);
    }
    bind_disclosure(&mut model_request).unwrap();
    let permit = match models
        .prepare("actor-a", &scope(), &model_request)
        .await
        .unwrap()
    {
        PreparedInvocation::Dispatch(permit) => permit,
        PreparedInvocation::Recovered(_) => panic!("fixture invocation must be new"),
    };
    // Only a recorded local model fixture, never an outbound provider call.
    models
        .complete(
            &permit,
            &TransportOutcome {
                events: vec![ModelEvent {
                    sequence: 0,
                    kind: EventKind::ToolProposal {
                        call_id: "expiry-call".into(),
                        name: "write_exact".into(),
                        arguments: operation_arguments(&request),
                    },
                }],
                actual_provider: gate.profile.provider,
                actual_model: Some(gate.profile.model.clone()),
                response_id: Some("expiry-response".into()),
                usage: Usage::default(),
                completion: Completion::Succeeded,
            },
        )
        .await
        .unwrap();
    let operation = models
        .admit_tool(
            "actor-a",
            &scope(),
            &basis,
            &permit.invocation_id,
            "expiry-call",
            "expiry-operation",
        )
        .await
        .unwrap();
    if !matches!(expiry, Expiry::Request) {
        assert_eq!(operation.state, OperationState::NeedsDecision);
        operations
            .decide(
                "actor-a",
                &scope(),
                &DecisionCommand {
                    key: "expiry-exact-approval".into(),
                    operation_id: operation.id.clone(),
                    expected_revision: operation.revision,
                    request: operation.request.clone(),
                    expires_at: if matches!(expiry, Expiry::Approval) {
                        deadline
                    } else {
                        now + 600
                    },
                    allow: true,
                },
            )
            .await
            .unwrap();
    }
    assert_eq!(
        operations
            .get("actor-a", &scope(), &operation.id)
            .await
            .unwrap()
            .state,
        OperationState::Ready
    );
    if matches!(expiry, Expiry::Lease) {
        sqlx::query("UPDATE public.tasks SET owner_until=to_timestamp($2) WHERE id=$1")
            .bind(&basis.task_id)
            .bind(deadline as f64)
            .execute(inspector)
            .await
            .unwrap();
    } else if matches!(expiry, Expiry::SourceAssignment) {
        let assignment = sqlx::query("UPDATE public.engagement_assignments SET expires_at=$1 WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-support' AND actor_id='actor-a'")
            .bind(deadline).execute(inspector).await.unwrap();
        assert_eq!(assignment.rows_affected(), 1);
    }
    (basis, operation, deadline)
}

async fn source_assignment_current(inspector: &mut PgConnection) -> bool {
    sqlx::query_scalar("SELECT active AND expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint FROM public.engagement_assignments WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-support' AND actor_id='actor-a'")
        .fetch_one(inspector).await.unwrap()
}

/// Dropping this owned connection also releases its session advisory lock, so
/// controller failure cannot strand the dispatch transaction on the test gate.
struct PolicyReadGate {
    holder: PgConnection,
    backend: i32,
}
impl PolicyReadGate {
    async fn install(configuration: &support::Configuration, inspector: &mut PgConnection) -> Self {
        let runtime = database_options(&configuration.runtime).unwrap();
        let runtime = runtime.get_username();
        inspector.execute(format!(
            "CREATE SEQUENCE public.expiry_permissions_entered;
             CREATE FUNCTION public.expiry_final_permissions() RETURNS boolean
             LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
               IF (SELECT is_called FROM public.expiry_staged) THEN
                 IF NOT coalesce(nullif(current_setting('zobba.knowledge_checks',true),''),'[]')::jsonb
                    @> '[[\"actor-a\",\"org-a\",\"client-a\",\"engagement-support\"]]'::jsonb
                 THEN RAISE EXCEPTION 'foreign source was not validated'; END IF;
                 PERFORM nextval('public.expiry_permissions_entered');
                 PERFORM pg_advisory_xact_lock(206,921);
               END IF;
               RETURN true;
             END $$;
             REVOKE ALL ON FUNCTION public.expiry_final_permissions() FROM PUBLIC;
             GRANT EXECUTE ON FUNCTION public.expiry_final_permissions() TO {runtime};
             CREATE POLICY expiry_final_permissions ON public.permission_versions AS RESTRICTIVE
             FOR SELECT TO {runtime} USING(public.expiry_final_permissions())"
        ).as_str()).await.unwrap();
        let mut holder = PgConnection::connect(&configuration.admin).await.unwrap();
        configuration.guard_connection(&mut holder).await;
        holder
            .execute("SELECT pg_advisory_lock(206,921)")
            .await
            .unwrap();
        let backend = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut holder)
            .await
            .unwrap();
        Self { holder, backend }
    }

    async fn entered(&self, inspector: &mut PgConnection) -> Instant {
        timeout(Duration::from_millis(500), async {
            loop {
                let waiting: bool = sqlx::query_scalar(
                    "SELECT is_called AND EXISTS(SELECT 1 FROM pg_stat_activity
                     WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid)))
                     FROM public.expiry_permissions_entered",
                )
                .bind(self.backend)
                .fetch_one(&mut *inspector)
                .await
                .unwrap();
                if waiting {
                    break Instant::now();
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("final policy reads must block after current source validation")
    }

    async fn release(&mut self) {
        let unlocked: bool = sqlx::query_scalar("SELECT pg_advisory_unlock(206,921)")
            .fetch_one(&mut self.holder)
            .await
            .unwrap();
        assert!(unlocked, "release the exact owned policy-read gate");
    }
}

async fn authority_now(
    inspector: &mut PgConnection,
    basis: &ClaimBasis,
    operation: &Operation,
) -> (bool, bool, bool) {
    sqlx::query_as(
        "SELECT owner_until>clock_timestamp(),
         $2>floor(extract(epoch FROM clock_timestamp()))::bigint,
         coalesce((SELECT allow AND expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint
                   FROM public.operation_decisions WHERE operation_id=$3),true)
         FROM public.tasks WHERE id=$1",
    )
    .bind(&basis.task_id)
    .bind(operation.request.expires_at)
    .bind(&operation.id)
    .fetch_one(inspector)
    .await
    .unwrap()
}

async fn facts(inspector: &mut PgConnection) -> serde_json::Value {
    // Compare admitted/history facts without retaining opaque receipt custody.
    sqlx::query_scalar(
        "SELECT jsonb_build_object(
         'invocations',(SELECT jsonb_agg(to_jsonb(i)-'receipt_hash') FROM public.model_invocations i),
         'results',(SELECT jsonb_agg(to_jsonb(r)) FROM public.model_results r),
         'bindings',(SELECT jsonb_agg(to_jsonb(b)) FROM public.model_tool_bindings b),
         'operations',(SELECT jsonb_agg(to_jsonb(o)) FROM public.operations o),
         'decisions',(SELECT jsonb_agg(to_jsonb(d)) FROM public.operation_decisions d),
         'knowledge',(SELECT jsonb_agg(to_jsonb(k) ORDER BY k.id,k.revision) FROM public.knowledge_records k),
         'knowledge_events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.knowledge_events e),
         'wakeups',(SELECT jsonb_agg(to_jsonb(w) ORDER BY w.id) FROM public.task_wakeups w),
         'deliveries',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.wakeup_id) FROM public.task_deliveries d))",
    )
    .fetch_one(inspector)
    .await
    .unwrap()
}

async fn verify_expiry(expiry: Expiry) {
    let _database = DATABASE.lock().await;
    let configuration = support::Configuration::from_environment();
    let mut owner = PgConnection::connect(&configuration.migration)
        .await
        .unwrap();
    configuration.guard_connection(&mut owner).await;
    owner.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC").await.unwrap();
    migrate(
        &configuration.migration,
        database_options(&configuration.runtime)
            .unwrap()
            .get_username(),
    )
    .await
    .unwrap();
    seed_local_configured("https://localhost:9443", &configuration.migration)
        .await
        .unwrap();
    let mut inspector = PgConnection::connect(&configuration.admin).await.unwrap();
    configuration.guard_connection(&mut inspector).await;
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(database_options(&configuration.runtime).unwrap())
        .await
        .unwrap();
    let endpoint = Endpoint::start().await;
    let gate = Arc::new(ValidationGate::new(
        profile(),
        !matches!(expiry, Expiry::SourceAssignment),
    ));
    let (basis, operation, deadline) =
        fixture(&pool, &mut inspector, &endpoint, expiry, gate.clone()).await;
    // Give task::wake a distinct staged transition. The deferred trigger must
    // observe pending=true, and rollback must restore this pending=false fact.
    let wakeup = sqlx::query("UPDATE public.task_wakeups SET pending=false WHERE task_id=$1")
        .bind(&basis.task_id)
        .execute(&mut inspector)
        .await
        .unwrap();
    assert_eq!(wakeup.rows_affected(), 1);
    let before = facts(&mut inspector).await;
    // The nontransactional sequence proves the deferred trigger ran while all
    // dispatch records were visible inside their owning transaction. No trigger
    // changes production clocks or bypasses an authority or storage check.
    inspector
        .execute(
            "CREATE SEQUENCE public.expiry_staged;
         CREATE FUNCTION public.expiry_staged() RETURNS trigger LANGUAGE plpgsql
         SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
           IF (SELECT count(*) FROM public.operation_attempts)<>1
           OR (SELECT count(*) FROM public.operation_claims WHERE state='consumed')<>1
           OR (SELECT count(*) FROM public.operation_receipt_producers)<>1
           OR (SELECT count(*) FROM public.operation_receipt_slots)<>1
           OR (SELECT count(*) FROM public.task_wakeups w JOIN public.operations o ON o.task_id=w.task_id WHERE w.pending)<>1
           THEN RAISE EXCEPTION 'dispatch staging incomplete'; END IF;
           PERFORM nextval('public.expiry_staged'); RETURN NEW;
         END $$;
         REVOKE ALL ON FUNCTION public.expiry_staged() FROM PUBLIC;
         CREATE CONSTRAINT TRIGGER expiry_staged AFTER INSERT ON public.operation_receipt_slots
         DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.expiry_staged()",
        )
        .await
        .unwrap();
    let mut policy_gate = if matches!(expiry, Expiry::SourceAssignment) {
        Some(PolicyReadGate::install(&configuration, &mut inspector).await)
    } else {
        None
    };
    let remaining: f64 = sqlx::query_scalar(
        "SELECT $1::double precision-extract(epoch FROM clock_timestamp())::double precision",
    )
    .bind(deadline as f64)
    .fetch_one(&mut inspector)
    .await
    .unwrap();
    assert!(
        remaining > 1.1,
        "fixture must be valid with dispatch runway"
    );
    tokio::time::sleep(Duration::from_secs_f64(remaining - 1.0)).await;
    assert_eq!(
        authority_now(&mut inspector, &basis, &operation).await,
        (true, true, true)
    );
    let store =
        OperationRepository::new(pool.clone()).with_model_qualification_source(gate.clone());
    let gateway = Gateway::qualification(endpoint.address, endpoint.source.clone()).unwrap();
    let _release_on_failure = ReleaseOnDrop(gate.clone());
    gate.armed.store(true, Ordering::SeqCst);
    let dispatch = tokio::spawn({
        let basis = basis.clone();
        let id = operation.id.clone();
        async move {
            let started = Instant::now();
            let result = gateway.dispatch(&store, &basis, &id).await;
            (result, started.elapsed())
        }
    });
    timeout(Duration::from_millis(500), gate.entered.notified())
        .await
        .expect("must enter final validation while all authority is valid");
    let validation_entered = gate
        .entered_at
        .lock()
        .unwrap()
        .expect("the second qualification call must record actual gate entry");
    let held = if let Some(policy_gate) = &policy_gate {
        policy_gate.entered(&mut inspector).await
    } else {
        validation_entered
    };
    assert_eq!(gate.calls.load(Ordering::SeqCst), 2);
    let staged: (bool, i64) =
        sqlx::query_as("SELECT is_called,last_value FROM public.expiry_staged")
            .fetch_one(&mut inspector)
            .await
            .unwrap();
    assert_eq!(
        staged,
        (true, 1),
        "deferred dispatch writes were flushed before final validation"
    );
    assert_eq!(
        authority_now(&mut inspector, &basis, &operation).await,
        (true, true, true)
    );
    if policy_gate.is_some() {
        assert!(source_assignment_current(&mut inspector).await);
    }
    timeout(Duration::from_millis(1200), async {
        loop {
            let expired: bool = sqlx::query_scalar("SELECT clock_timestamp()>=to_timestamp($1)")
                .bind(deadline as f64)
                .fetch_one(&mut inspector)
                .await
                .unwrap();
            if expired {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("real expiry must occur below the gateway store deadline");
    assert!(
        held.elapsed() >= Duration::from_millis(400),
        "prove a controlled delay at the selected final boundary"
    );
    let expected_authority = match expiry {
        Expiry::Lease => (false, true, true),
        Expiry::Request => (true, false, true),
        Expiry::Approval => (true, true, false),
        Expiry::SourceAssignment => (true, true, true),
    };
    assert_eq!(
        authority_now(&mut inspector, &basis, &operation).await,
        expected_authority
    );
    if policy_gate.is_some() {
        assert!(!source_assignment_current(&mut inspector).await);
    }
    let controlled_delay = held.elapsed();
    let delay_phase = if let Some(policy_gate) = &mut policy_gate {
        policy_gate.release().await;
        "final_policy_reads"
    } else {
        "final_model_validation"
    };
    gate.release();
    let (outcome, elapsed) = dispatch.await.unwrap();
    assert!(
        elapsed < Duration::from_secs(2),
        "must refuse through authority, before gateway timeout: {elapsed:?}"
    );
    let expected = match expiry {
        Expiry::Lease => OperationError::Fenced,
        Expiry::Request => OperationError::Denied,
        Expiry::Approval => OperationError::NeedsDecision,
        Expiry::SourceAssignment => OperationError::Denied,
    };
    assert_eq!(outcome, Err(expected));
    assert_eq!(endpoint.connections(), 0, "zero accepted wire connections");
    assert!(
        endpoint.events().is_empty(),
        "zero gateway sends or lookups"
    );
    assert_eq!(endpoint.effects(&operation.id), 0);
    // Acquire the sole runtime connection to await sqlx's queued rollback before
    // inspecting externally. No staged claim/capability may survive refusal.
    drop(pool.acquire().await.unwrap());
    for table in [
        "operation_attempts",
        "operation_claims",
        "operation_receipt_producers",
        "operation_receipt_slots",
        "operation_receipts",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}"))
            .fetch_one(&mut inspector)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table} must roll back");
    }
    assert!(
        before == facts(&mut inspector).await,
        "invocation, admission, approval and wakeup facts must remain intact"
    );
    eprintln!(
        "expiry={expiry:?} outcome={outcome:?} dispatch_elapsed={elapsed:?} delay_phase={delay_phase} controlled_delay={controlled_delay:?} staged_flush=1 connections=0 sends=0 dispatch_rows=0 historical_facts_unchanged=true"
    );
    if policy_gate.is_some() {
        inspector.execute("DROP POLICY expiry_final_permissions ON public.permission_versions; DROP FUNCTION public.expiry_final_permissions(); DROP SEQUENCE public.expiry_permissions_entered").await.unwrap();
    }
    inspector.execute("DROP TRIGGER expiry_staged ON public.operation_receipt_slots; DROP FUNCTION public.expiry_staged(); DROP SEQUENCE public.expiry_staged").await.unwrap();
    pool.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lease_expiry_during_final_model_validation_refuses_gateway_dispatch() {
    verify_expiry(Expiry::Lease).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn request_expiry_during_final_model_validation_refuses_gateway_dispatch() {
    verify_expiry(Expiry::Request).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn exact_approval_expiry_during_final_model_validation_refuses_gateway_dispatch() {
    verify_expiry(Expiry::Approval).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn source_assignment_expiry_during_final_policy_reads_refuses_gateway_dispatch() {
    verify_expiry(Expiry::SourceAssignment).await;
}
