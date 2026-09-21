-- New drafts use compiler2. Historical row versions and approval bytes are untouched.
ALTER TABLE procedure_version ALTER COLUMN plan_compiler_version SET DEFAULT '2';
--> statement-breakpoint
ALTER TABLE procedure_version DROP CONSTRAINT procedure_version_plan_shape;
--> statement-breakpoint
ALTER TABLE procedure_version ADD CONSTRAINT procedure_version_plan_shape CHECK(compiled_plan IS NULL OR coalesce(jsonb_typeof(compiled_plan)='object' AND (
  (compiled_plan->'schemaVersion'='1'::jsonb AND compiled_plan->>'compilerVersion'='1' AND NOT compiled_plan ? 'capabilityGraph') OR
  (compiled_plan->'schemaVersion'='2'::jsonb AND compiled_plan->>'compilerVersion'='2' AND jsonb_typeof(compiled_plan->'capabilityGraph')='object')
),false));
--> statement-breakpoint
-- Canonical compiler2 strategy adjunct. Parent sequences this after0060..0062.
CREATE TABLE run_strategy_opportunity (
  opportunity_id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES audit_run(run_id) ON DELETE CASCADE,
  anchor jsonb NOT NULL, tool jsonb NOT NULL, parameters jsonb NOT NULL, created_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX run_strategy_opportunity_run_key ON run_strategy_opportunity(run_id,opportunity_id);
--> statement-breakpoint
CREATE TABLE run_strategy_cursor (
  run_id uuid PRIMARY KEY REFERENCES audit_run(run_id) ON DELETE CASCADE, opportunity_id uuid,
  FOREIGN KEY(run_id,opportunity_id) REFERENCES run_strategy_opportunity(run_id,opportunity_id)
);
--> statement-breakpoint
CREATE TABLE run_strategy_selection (
  command_id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES audit_run(run_id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL, message_id uuid NOT NULL REFERENCES run_conversation_message(message_id) ON DELETE CASCADE,
  actor_id text NOT NULL, session_id text NOT NULL, expected_control_epoch integer NOT NULL,
  interpretation_digest text NOT NULL, created_at timestamptz NOT NULL,
  CONSTRAINT run_strategy_selection_epoch CHECK(expected_control_epoch>0 AND interpretation_digest ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY(run_id,opportunity_id) REFERENCES run_strategy_opportunity(run_id,opportunity_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX run_strategy_selection_message ON run_strategy_selection(message_id);
--> statement-breakpoint
CREATE UNIQUE INDEX run_strategy_selection_run_key ON run_strategy_selection(run_id,command_id);
--> statement-breakpoint
CREATE TABLE run_strategy_transition (
  command_id uuid NOT NULL REFERENCES run_strategy_selection(command_id) ON DELETE CASCADE,
  sequence integer NOT NULL, state text NOT NULL, tool_action_id uuid, reason_code text NOT NULL,
  source_event_id uuid NOT NULL REFERENCES audit_events(event_id), created_at timestamptz NOT NULL,
  PRIMARY KEY(command_id,sequence), CONSTRAINT run_strategy_transition_sequence CHECK(sequence>0 AND state IN('interpreted','queued','dispatched','applied','refused','superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX run_strategy_transition_action ON run_strategy_transition(tool_action_id,state);
--> statement-breakpoint
-- Evidence bytes are governed by the registered artifact digest. The application repeats
-- the shared structural-snapshot/query/completion validator before publication and claim;
-- SQL binds that published capability to the exact immutable registered action/evidence.
CREATE FUNCTION run_strategy_opportunity_valid(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT coalesce((SELECT
  jsonb_typeof(o.anchor)='object' AND o.anchor ?& ARRAY['runId','workItemId','attemptId','stepExecutionId','targetSystemId','subjectKey','planDigest','graphDigest','nodeId','snapshotEvidenceId','prerequisiteEvidenceIds','prerequisiteActionIds']
  AND (o.anchor-ARRAY['runId','workItemId','attemptId','stepExecutionId','targetSystemId','subjectKey','planDigest','graphDigest','nodeId','snapshotEvidenceId','prerequisiteEvidenceIds','prerequisiteActionIds']::text[])='{}'::jsonb
  AND o.anchor->'runId'=to_jsonb(o.run_id::text) AND o.anchor->'snapshotEvidenceId'=to_jsonb(o.opportunity_id::text)
  AND o.anchor->>'nodeId'='p1.full-name' AND o.anchor->>'planDigest' ~ '^[a-f0-9]{64}$' AND o.anchor->>'graphDigest' ~ '^[a-f0-9]{64}$'
  AND jsonb_array_length(o.anchor->'prerequisiteEvidenceIds')=1 AND jsonb_array_length(o.anchor->'prerequisiteActionIds')=1
  AND v.compiled_plan->'schemaVersion'='2'::jsonb AND v.compiled_plan->>'compilerVersion'='2'
  AND v.compiled_plan->'inputs'->>'templateId'='P-1'
  AND v.frozen_review->'definition'->'compiledPlan'=v.compiled_plan
  AND v.frozen_review->'definition'->'toolConfiguration'->>'interpreterContract'='executable-plan-v2'
  AND v.compiled_plan->'capabilityGraph'=jsonb_build_object('schemaVersion',1,'nodes',
    coalesce((SELECT jsonb_agg(node ORDER BY ord,node_order) FROM jsonb_array_elements(v.compiled_plan->'inputs'->'targets') WITH ORDINALITY target(value,ord)
      CROSS JOIN LATERAL (VALUES
        (1,jsonb_build_object('id','p1.employee-id','targetSystemId',target.value->>'registrationId','action','inspect-record','lookupKey','employee_id','predecessors','[]'::jsonb,'maxAttempts',1)),
        (2,jsonb_build_object('id','p1.full-name','targetSystemId',target.value->>'registrationId','action','inspect-record','lookupKey','full_name','predecessors',jsonb_build_array(jsonb_build_object('nodeId','p1.employee-id','outcome','complete-zero-match')),'maxAttempts',1))
      ) n(node_order,node) WHERE target.value->'contract'->>'kind'='web'),'[]'::jsonb))
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.compiled_plan->'inputs'->'targets') target
    WHERE target->>'registrationId'=w.registration_id AND target->'contract'->>'kind'='web')
  AND o.anchor->'workItemId'=to_jsonb(w.work_item_id::text) AND o.anchor->'subjectKey'=to_jsonb(w.subject_key)
  AND o.anchor->'targetSystemId'=to_jsonb(w.registration_id) AND p.disposition='included'
  AND p.values->'employee_id'=to_jsonb(w.subject_key) AND jsonb_typeof(p.values->'full_name')='string'
  AND s.work_item_id=w.work_item_id AND s.action='inspect-record' AND o.anchor->'stepExecutionId'=to_jsonb(s.step_execution_id::text)
  AND a.action='search' AND a.outcome='performed' AND a.capture='PERMITTED' AND a.work_item_id=w.work_item_id AND a.step_execution_id=s.step_execution_id
  AND a.target_system=w.registration_id AND a.completed_at IS NOT NULL AND a.completed_at<=o.created_at
  AND jsonb_array_length(a.parameters)=1 AND a.parameters->0->'value'=to_jsonb(w.subject_key)
  AND e.state='REGISTERED' AND e.kind='structural-snapshot' AND e.registration_id=w.registration_id
  AND source_e.state='REGISTERED' AND source_e.kind='structural-snapshot' AND source_e.registration_id=w.registration_id
  AND source_action.work_item_id=w.work_item_id AND source_action.step_execution_id=s.step_execution_id AND source_action.target_system=w.registration_id
  AND source_action.outcome='performed' AND source_action.capture='PERMITTED'
  AND o.tool->>'action'='search' AND jsonb_typeof(o.tool)='object' AND o.tool ?& ARRAY['toolId','action','destination','locator','description','parameterNames']
  AND (o.tool-ARRAY['toolId','action','destination','locator','description','parameterNames']::text[])='{}'::jsonb
  AND o.tool->>'destination'=source_capture.source_location AND o.tool->'parameterNames'='[]'::jsonb
  AND jsonb_array_length(o.parameters)=1 AND o.parameters->0->'value'=p.values->'full_name'
  AND jsonb_typeof(o.parameters->0->'name')='string' AND length(o.parameters->0->>'name')>0
  AND NOT EXISTS(SELECT 1 FROM run_tool_action prior WHERE prior.run_id=o.run_id AND prior.step_execution_id=s.step_execution_id
      AND prior.action='search' AND prior.outcome='performed' AND prior.completed_at<=o.created_at AND prior.parameters->0->'value'=p.values->'full_name')
FROM run_strategy_opportunity o JOIN audit_run r ON r.run_id=o.run_id JOIN procedure_version v ON v.version_id=r.version_id
JOIN run_work_item w ON w.run_id=o.run_id AND to_jsonb(w.work_item_id::text)=o.anchor->'workItemId'
JOIN population_row p ON p.run_id=o.run_id AND p.values->'employee_id'=o.anchor->'subjectKey'
JOIN run_step_execution s ON s.run_id=o.run_id AND to_jsonb(s.step_execution_id::text)=o.anchor->'stepExecutionId'
JOIN run_evidence e ON e.run_id=o.run_id AND to_jsonb(e.evidence_id::text)=o.anchor->'prerequisiteEvidenceIds'->0
JOIN run_evidence_capture ec ON ec.run_id=o.run_id AND ec.evidence_id=e.evidence_id
JOIN run_tool_action a ON a.run_id=o.run_id AND a.tool_action_id=ec.tool_action_id AND to_jsonb(a.tool_action_id::text)=o.anchor->'prerequisiteActionIds'->0
JOIN run_evidence source_e ON source_e.run_id=o.run_id AND source_e.evidence_id=o.opportunity_id
JOIN run_evidence_capture source_capture ON source_capture.run_id=o.run_id AND source_capture.evidence_id=source_e.evidence_id
JOIN run_tool_action source_action ON source_action.run_id=o.run_id AND source_action.tool_action_id=source_capture.tool_action_id
WHERE o.opportunity_id=id),false)
$$;
--> statement-breakpoint
CREATE FUNCTION guard_run_strategy_opportunity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a jsonb; stage run_agent_work%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Strategy opportunity is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO stage FROM run_agent_work WHERE run_id=NEW.run_id;
 a:=NEW.anchor;
 IF NOT run_strategy_opportunity_valid(NEW.opportunity_id) OR stage.status IS DISTINCT FROM 'EXECUTING' OR a->'attemptId' IS DISTINCT FROM to_jsonb(stage.attempt_id::text)
   OR a->'workItemId' IS DISTINCT FROM to_jsonb(stage.work_item_id::text) THEN RAISE EXCEPTION 'Strategy opportunity requires exact committed capability evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER run_strategy_opportunity_validate AFTER INSERT OR UPDATE ON run_strategy_opportunity FOR EACH ROW EXECUTE FUNCTION guard_run_strategy_opportunity();
--> statement-breakpoint
CREATE FUNCTION guard_run_strategy_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Strategy proposal is immutable' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM audit_run WHERE run_id=NEW.run_id FOR UPDATE;
 PERFORM 1 FROM auth_user WHERE id=NEW.actor_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM run_conversation_message m JOIN audit_events e ON e.aggregate_id=m.run_id::text AND e.sequence=m.source_event_sequence
   JOIN run_strategy_cursor c ON c.run_id=m.run_id AND c.opportunity_id=NEW.opportunity_id
   JOIN user_role role ON role.user_id=NEW.actor_id AND role.role IN('auditor','audit-manager')
   JOIN run_control_lease l ON l.run_id=m.run_id AND l.holder_id=NEW.actor_id AND l.epoch=NEW.expected_control_epoch AND l.expires_at>clock_timestamp()
   JOIN audit_run r ON r.run_id=m.run_id AND r.state='RUNNING' AND r.cancel_requested_at IS NULL AND r.pause_requested_at IS NULL
   WHERE m.message_id=NEW.message_id AND m.run_id=NEW.run_id AND m.actor_id=NEW.actor_id AND m.kind='auditor-message'
   AND e.event_type='review.conversation-received' AND e.actor_id=NEW.actor_id AND e.session_id=NEW.session_id
   AND e.payload->>'intent'='strategy-proposal' AND e.payload->'messageId'=to_jsonb(NEW.message_id::text))
 THEN RAISE EXCEPTION 'Strategy proposal requires exact authorized governed intake' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER run_strategy_selection_validate BEFORE INSERT OR UPDATE ON run_strategy_selection FOR EACH ROW EXECUTE FUNCTION guard_run_strategy_selection();
--> statement-breakpoint
CREATE FUNCTION guard_run_strategy_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c run_strategy_selection%ROWTYPE; o run_strategy_opportunity%ROWTYPE; prior run_strategy_transition%ROWTYPE; f audit_events%ROWTYPE; a run_tool_action%ROWTYPE; st run_agent_work%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Strategy transitions are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM run_strategy_selection WHERE command_id=NEW.command_id;
 PERFORM 1 FROM audit_run WHERE run_id=c.run_id FOR UPDATE;
 SELECT * INTO o FROM run_strategy_opportunity WHERE opportunity_id=c.opportunity_id;
 SELECT * INTO prior FROM run_strategy_transition WHERE command_id=NEW.command_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(prior.sequence,0)+1 OR NOT (
   (prior.command_id IS NULL AND NEW.state='interpreted') OR
   (prior.state='interpreted' AND NEW.state IN('queued','refused')) OR
   (prior.state='queued' AND NEW.state IN('dispatched','superseded')) OR
   (prior.state='dispatched' AND NEW.state IN('applied','superseded')))
 THEN RAISE EXCEPTION 'Invalid strategy transition' USING ERRCODE='23514'; END IF;
 SELECT * INTO f FROM audit_events WHERE event_id=NEW.source_event_id;
 IF f.event_id IS NULL OR f.event_type<>'lifecycle.run-strategy-'||NEW.state OR f.aggregate_id<>c.run_id::text OR f.occurred_at<>NEW.created_at
   OR f.correlation_id<>c.command_id::text OR f.session_id<>c.session_id OR f.payload<>jsonb_build_object('commandId',c.command_id::text,'opportunityId',c.opportunity_id::text,
     'nodeId',o.anchor->>'nodeId','workItemId',o.anchor->>'workItemId','attemptId',o.anchor->>'attemptId','stepExecutionId',o.anchor->>'stepExecutionId',
     'expectedControlEpoch',c.expected_control_epoch,'toolActionId',NEW.tool_action_id::text,'reasonCode',NEW.reason_code)
   OR f.source<>CASE WHEN NEW.state IN('interpreted','queued','refused') THEN 'web' ELSE 'worker' END
   OR f.actor_type<>CASE WHEN NEW.state IN('interpreted','queued','refused') THEN 'human' ELSE 'system' END
   OR f.actor_id<>CASE WHEN NEW.state IN('interpreted','queued','refused') THEN c.actor_id ELSE 'strategy-coordinator' END
   OR f.outcome<>CASE WHEN NEW.state IN('refused','superseded') THEN 'failure' ELSE 'success' END
 THEN RAISE EXCEPTION 'Strategy transition must match its exact audit fact' USING ERRCODE='23514'; END IF;
 IF NEW.state IN('queued','dispatched') THEN
   PERFORM 1 FROM auth_user WHERE id=c.actor_id FOR UPDATE;
   SELECT * INTO st FROM run_agent_work WHERE run_id=c.run_id;
   IF NOT EXISTS(SELECT 1 FROM run_strategy_cursor cursor JOIN audit_run r ON r.run_id=cursor.run_id
     JOIN user_role role ON role.user_id=c.actor_id AND role.role IN('auditor','audit-manager')
     JOIN run_control_lease l ON l.run_id=r.run_id AND l.holder_id=c.actor_id AND l.epoch=c.expected_control_epoch AND l.expires_at>clock_timestamp()
     JOIN run_step_execution s ON s.run_id=r.run_id AND to_jsonb(s.step_execution_id::text)=o.anchor->'stepExecutionId' AND s.state='RUNNING'
     WHERE cursor.run_id=c.run_id AND cursor.opportunity_id=c.opportunity_id AND r.state='RUNNING' AND r.cancel_requested_at IS NULL AND r.pause_requested_at IS NULL)
     OR NOT run_strategy_opportunity_valid(o.opportunity_id)
     OR EXISTS(SELECT 1 FROM run_tool_action WHERE run_id=c.run_id AND to_jsonb(step_execution_id::text)=o.anchor->'stepExecutionId' AND action='search' AND outcome='performed' AND completed_at>o.created_at)
     OR st.status IS DISTINCT FROM 'EXECUTING' OR o.anchor->'workItemId' IS DISTINCT FROM to_jsonb(st.work_item_id::text) OR o.anchor->'attemptId' IS DISTINCT FROM to_jsonb(st.attempt_id::text)
   THEN RAISE EXCEPTION 'Strategy authority or inspection changed' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.state='dispatched' THEN
   IF NEW.tool_action_id IS NULL OR EXISTS(SELECT 1 FROM run_strategy_transition t JOIN run_strategy_selection other ON other.command_id=t.command_id
     WHERE other.run_id=c.run_id AND other.opportunity_id=c.opportunity_id AND t.state='dispatched')
   THEN RAISE EXCEPTION 'Strategy opportunity is consumed once' USING ERRCODE='23514'; END IF;
 ELSIF NEW.state='applied' THEN
   SELECT * INTO a FROM run_tool_action WHERE tool_action_id=NEW.tool_action_id;
   IF NEW.tool_action_id IS DISTINCT FROM prior.tool_action_id OR a.tool_action_id IS NULL OR a.run_id<>c.run_id
     OR to_jsonb(a.work_item_id::text)<>o.anchor->'workItemId' OR to_jsonb(a.step_execution_id::text)<>o.anchor->'stepExecutionId'
     OR a.target_system<>o.anchor->>'targetSystemId' OR a.action<>'search' OR a.outcome<>'performed' OR a.completed_at IS NULL
     OR a.destination<>o.tool->>'destination' OR a.parameters<>o.parameters
   THEN RAISE EXCEPTION 'Applied strategy requires its exact committed action' USING ERRCODE='23514'; END IF;
 ELSIF NEW.state='superseded' AND NEW.tool_action_id IS DISTINCT FROM prior.tool_action_id THEN
   RAISE EXCEPTION 'Supersession preserves reserved action identity' USING ERRCODE='23514';
 ELSIF NEW.state IN('interpreted','queued','refused') AND NEW.tool_action_id IS NOT NULL THEN
   RAISE EXCEPTION 'Unconsumed strategy cannot claim an action' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER run_strategy_transition_validate BEFORE INSERT OR UPDATE ON run_strategy_transition FOR EACH ROW EXECUTE FUNCTION guard_run_strategy_transition();
--> statement-breakpoint
CREATE FUNCTION retain_run_strategy_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid;
BEGIN
 IF TG_TABLE_NAME='run_strategy_transition' THEN SELECT run_id INTO owner FROM run_strategy_selection WHERE command_id=OLD.command_id;
 ELSE owner:=OLD.run_id; END IF;
 IF owner IS NOT NULL AND EXISTS(SELECT 1 FROM audit_run WHERE run_id=owner) THEN
   RAISE EXCEPTION 'Strategy history survives with its Run' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER retain_run_strategy_opportunity AFTER DELETE ON run_strategy_opportunity DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retain_run_strategy_fact();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER retain_run_strategy_selection AFTER DELETE ON run_strategy_selection DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retain_run_strategy_fact();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER retain_run_strategy_transition AFTER DELETE ON run_strategy_transition DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retain_run_strategy_fact();
--> statement-breakpoint
-- No proposal or audit receipt may commit without the corresponding retained ledger fact.
CREATE FUNCTION complete_run_strategy_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid; command uuid;
BEGIN
 IF TG_TABLE_NAME='audit_events' THEN
   IF NEW.event_type NOT IN('lifecycle.run-strategy-interpreted','lifecycle.run-strategy-queued','lifecycle.run-strategy-dispatched','lifecycle.run-strategy-applied','lifecycle.run-strategy-refused','lifecycle.run-strategy-superseded') THEN RETURN NULL; END IF;
   IF NOT EXISTS(SELECT 1 FROM run_strategy_transition t WHERE t.source_event_id=NEW.event_id)
     THEN RAISE EXCEPTION 'Strategy audit fact requires exact retained transition' USING ERRCODE='23514'; END IF;
 ELSE
   owner:=NEW.run_id; command:=NEW.command_id;
   IF EXISTS(SELECT 1 FROM audit_run WHERE run_id=owner) AND (
     NOT EXISTS(SELECT 1 FROM run_strategy_transition WHERE command_id=command AND sequence=1 AND state='interpreted') OR
     NOT EXISTS(SELECT 1 FROM run_conversation_message WHERE run_id=owner AND parent_message_id=NEW.message_id AND kind='command-receipt'))
   THEN RAISE EXCEPTION 'Strategy selection requires its initial interpretation and governed reply' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER complete_run_strategy_selection AFTER INSERT ON run_strategy_selection DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_run_strategy_fact();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER complete_run_strategy_event AFTER INSERT ON audit_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION complete_run_strategy_fact();
