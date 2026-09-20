ALTER TABLE "run_interaction_command" DROP CONSTRAINT "run_interaction_command_kind";--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD COLUMN "answer_anchor" jsonb;--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD COLUMN "answer_option_id" text;--> statement-breakpoint
ALTER TABLE "run_wait" ADD COLUMN "answer_command_id" uuid;--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD CONSTRAINT "run_interaction_command_kind" CHECK (((
    ("run_interaction_command"."kind" = 'answer' AND "run_interaction_command"."interpretation_version" = 'confirmed-answer-v1'
      AND "run_interaction_command"."deferred_anchor" IS NULL AND "run_interaction_command"."deferred_control_epoch" IS NULL AND "run_interaction_command"."resume_anchor" IS NULL
      AND "run_interaction_command"."answer_anchor" IS NOT NULL AND jsonb_typeof("run_interaction_command"."answer_anchor")='object'
      AND "run_interaction_command"."answer_anchor" ?& ARRAY['runId','waitId','kind','runRevision','openedAt','deadline','raisedEventId','questionDigest']
      AND ("run_interaction_command"."answer_anchor" - ARRAY['runId','waitId','kind','runRevision','openedAt','deadline','raisedEventId','questionDigest']::text[])='{}'::jsonb
      AND "run_interaction_command"."answer_anchor"->'runId'=to_jsonb("run_interaction_command"."run_id"::text)
      AND jsonb_typeof("run_interaction_command"."answer_anchor"->'waitId')='string'
      AND ("run_interaction_command"."answer_anchor"->>'waitId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND jsonb_typeof("run_interaction_command"."answer_anchor"->'raisedEventId')='string'
      AND ("run_interaction_command"."answer_anchor"->>'raisedEventId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND "run_interaction_command"."answer_anchor"->>'kind' IN ('choose-candidate','unnamed-value','retry-or-skip')
      AND "run_interaction_command"."answer_anchor"->'runRevision'=to_jsonb("run_interaction_command"."expected_run_revision")
      AND jsonb_typeof("run_interaction_command"."answer_anchor"->'openedAt')='string' AND jsonb_typeof("run_interaction_command"."answer_anchor"->'deadline')='string'
      AND ("run_interaction_command"."answer_anchor"->>'openedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      AND ("run_interaction_command"."answer_anchor"->>'deadline') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      AND jsonb_typeof("run_interaction_command"."answer_anchor"->'questionDigest')='string' AND ("run_interaction_command"."answer_anchor"->>'questionDigest') ~ '^[a-f0-9]{64}$'
      AND "run_interaction_command"."answer_option_id" IS NOT NULL AND "run_interaction_command"."answer_option_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
    OR ("run_interaction_command"."answer_anchor" IS NULL AND "run_interaction_command"."answer_option_id" IS NULL AND (
    ("run_interaction_command"."kind" = 'stop' AND "run_interaction_command"."interpretation_version" = 'confirmed-stop-v1' AND "run_interaction_command"."deferred_anchor" IS NULL AND "run_interaction_command"."deferred_control_epoch" IS NULL AND "run_interaction_command"."resume_anchor" IS NULL) OR
    ("run_interaction_command"."kind" = 'pause-now' AND "run_interaction_command"."interpretation_version" = 'exact-safety-v1' AND "run_interaction_command"."deferred_anchor" IS NULL AND "run_interaction_command"."deferred_control_epoch" IS NULL AND "run_interaction_command"."resume_anchor" IS NULL)
    OR
    ("run_interaction_command"."kind" = 'pause-after-inspection' AND "run_interaction_command"."interpretation_version" = 'confirmed-inspection-v1' AND "run_interaction_command"."resume_anchor" IS NULL
      AND "run_interaction_command"."deferred_control_epoch" IS NOT NULL AND "run_interaction_command"."deferred_control_epoch" > 0 AND "run_interaction_command"."deferred_anchor" IS NOT NULL
      AND jsonb_typeof("run_interaction_command"."deferred_anchor") = 'object'
      AND "run_interaction_command"."deferred_anchor" ?& ARRAY['workItemId','subjectKey','registrationId','runRevision','planDigest']
      AND ("run_interaction_command"."deferred_anchor" - ARRAY['workItemId','subjectKey','registrationId','runRevision','planDigest']::text[]) = '{}'::jsonb
      AND jsonb_typeof("run_interaction_command"."deferred_anchor"->'workItemId') = 'string'
      AND ("run_interaction_command"."deferred_anchor"->>'workItemId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND jsonb_typeof("run_interaction_command"."deferred_anchor"->'registrationId') = 'string'
      AND ("run_interaction_command"."deferred_anchor"->>'registrationId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND jsonb_typeof("run_interaction_command"."deferred_anchor"->'subjectKey') IN ('string','null')
      AND ("run_interaction_command"."deferred_anchor"->>'subjectKey' IS NULL OR octet_length("run_interaction_command"."deferred_anchor"->>'subjectKey') BETWEEN 1 AND 512)
      AND jsonb_typeof("run_interaction_command"."deferred_anchor"->'runRevision') = 'number'
      AND ("run_interaction_command"."deferred_anchor"->>'runRevision') ~ '^[0-9]+$'
      AND ("run_interaction_command"."deferred_anchor"->>'runRevision')::numeric <= 2147483647
      AND ("run_interaction_command"."deferred_anchor"->>'runRevision')::integer = "run_interaction_command"."expected_run_revision"
      AND jsonb_typeof("run_interaction_command"."deferred_anchor"->'planDigest') = 'string'
      AND ("run_interaction_command"."deferred_anchor"->>'planDigest') ~ '^[a-f0-9]{64}$'
      AND "run_interaction_command"."deferred_anchor"->>'planDigest' = "run_interaction_command"."plan_digest"
    )
    OR ("run_interaction_command"."kind" = 'resume' AND "run_interaction_command"."interpretation_version" = 'confirmed-resume-v1'
      AND "run_interaction_command"."deferred_anchor" IS NULL AND "run_interaction_command"."deferred_control_epoch" IS NULL
      AND "run_interaction_command"."resume_anchor" IS NOT NULL AND jsonb_typeof("run_interaction_command"."resume_anchor") = 'object'
      AND "run_interaction_command"."resume_anchor" ?& ARRAY['waitId','pausedAt','deadline','controlEpoch']
      AND ("run_interaction_command"."resume_anchor" - ARRAY['waitId','pausedAt','deadline','controlEpoch']::text[]) = '{}'::jsonb
      AND jsonb_typeof("run_interaction_command"."resume_anchor"->'waitId') = 'string'
      AND ("run_interaction_command"."resume_anchor"->>'waitId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND jsonb_typeof("run_interaction_command"."resume_anchor"->'pausedAt') = 'string'
      AND ("run_interaction_command"."resume_anchor"->>'pausedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      AND jsonb_typeof("run_interaction_command"."resume_anchor"->'deadline') = 'string'
      AND ("run_interaction_command"."resume_anchor"->>'deadline') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      AND jsonb_typeof("run_interaction_command"."resume_anchor"->'controlEpoch') = 'number'
      AND ("run_interaction_command"."resume_anchor"->>'controlEpoch') ~ '^[0-9]+$'
      AND ("run_interaction_command"."resume_anchor"->>'controlEpoch')::numeric BETWEEN 1 AND 2147483647
    )
  )))) IS TRUE);--> statement-breakpoint
ALTER TABLE "run_wait" ADD CONSTRAINT "run_wait_answer_command" CHECK ("run_wait"."answer_command_id" IS NULL OR ("run_wait"."closure_kind" IS NOT DISTINCT FROM 'answer' AND "run_wait"."closed_at" IS NOT NULL));
--> statement-breakpoint
-- Shared by storage guards and the authorized history read: JSON equality preserves types.
CREATE FUNCTION conversation_answer_receipt_valid(cmd run_interaction_command, fact audit_events)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(cmd.kind='answer' AND fact.aggregate_id=cmd.run_id::text
    AND fact.event_type='execution.escalation-answered' AND fact.source='web' AND fact.outcome='success'
    AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id
    AND fact.payload = jsonb_build_object('waitId',cmd.answer_anchor->'waitId','kind',cmd.answer_anchor->'kind',
      'answerOptionId',cmd.answer_option_id,'closureKind','answer','priorState','AWAITING_AUDITOR',
      'state',CASE WHEN cmd.answer_option_id='abort' THEN 'CANCELED' ELSE 'RUNNING' END,
      'occurredAt',to_char(fact.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'commandId',cmd.command_id::text,'planDigest',cmd.plan_digest,'expectedRunRevision',cmd.expected_run_revision,
      'questionAnchor',cmd.answer_anchor)
    AND EXISTS (SELECT 1 FROM run_wait w JOIN audit_events raised ON raised.event_id::text=cmd.answer_anchor->>'raisedEventId'
      WHERE w.run_id=cmd.run_id AND to_jsonb(w.wait_id::text)=cmd.answer_anchor->'waitId'
        AND to_jsonb(w.kind)=cmd.answer_anchor->'kind' AND w.closure_kind='answer'
        AND w.answer_command_id=cmd.command_id AND w.actor=cmd.actor_id AND w.answer_option_id=cmd.answer_option_id AND w.closed_at=fact.occurred_at
        AND w.closed_at<w.deadline
        AND to_jsonb(to_char(w.opened_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))=cmd.answer_anchor->'openedAt'
        AND to_jsonb(to_char(w.deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))=cmd.answer_anchor->'deadline'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.options) o WHERE o->'id'=to_jsonb(cmd.answer_option_id))
        AND raised.aggregate_id=cmd.run_id::text AND raised.event_type='execution.escalation-raised'
        AND raised.source='platform' AND raised.outcome='success' AND raised.actor_type='system' AND raised.actor_id='escalation-platform'
        AND raised.payload->'waitId'=cmd.answer_anchor->'waitId' AND raised.payload->'kind'=cmd.answer_anchor->'kind'
        AND raised.payload->'deadline'=cmd.answer_anchor->'deadline'
        AND raised.payload->'optionIds'=(SELECT jsonb_agg(o->'id' ORDER BY ordinal)
          FROM jsonb_array_elements(w.options) WITH ORDINALITY options(o,ordinal))), false)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION run_interaction_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Interaction command identity is immutable' USING ERRCODE='23514';
  ELSIF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM audit_run WHERE run_id=OLD.run_id) THEN
      RAISE EXCEPTION 'Interaction command survives with its Run' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM run_conversation_message m
    JOIN audit_events e ON e.aggregate_id=m.run_id::text AND e.sequence=m.source_event_sequence
    WHERE m.message_id=NEW.message_id AND m.run_id=NEW.run_id
      AND m.actor_id=NEW.actor_id AND m.request_key=NEW.request_key
      AND m.semantic_fingerprint=NEW.semantic_fingerprint AND m.kind='auditor-message'
      AND e.event_type='review.conversation-received' AND e.source='web' AND e.outcome='success'
      AND e.actor_type='human' AND e.actor_id=NEW.actor_id
      AND ((NEW.kind='pause-now' AND e.payload->>'intent'='pause-now')
        OR (NEW.kind='pause-after-inspection' AND e.payload->>'intent'='deferred-pause-proposal')
        OR (NEW.kind='resume' AND e.payload->>'intent'='resume')
        OR (NEW.kind='stop' AND e.payload->>'intent'='stop-confirmation')
        OR (NEW.kind='answer' AND e.payload->>'intent'='answer-request-proposal'
          AND e.payload->'questionAnchor'=NEW.answer_anchor AND e.payload->'answerOptionId'=to_jsonb(NEW.answer_option_id)))
      AND e.payload->>'messageId'=NEW.message_id::text
      AND e.payload->>'semanticFingerprint'=NEW.semantic_fingerprint) THEN
    RAISE EXCEPTION 'Interaction command must bind its exact intake' USING ERRCODE='23514';
  END IF;
  IF NEW.kind='answer' AND NOT EXISTS (SELECT 1 FROM run_wait w JOIN audit_events e ON e.event_id::text=NEW.answer_anchor->>'raisedEventId'
    JOIN audit_run r ON r.run_id=w.run_id
    WHERE w.run_id=NEW.run_id AND w.wait_id::text=NEW.answer_anchor->>'waitId' AND w.closed_at IS NULL
      AND w.kind=NEW.answer_anchor->>'kind' AND r.revision=NEW.expected_run_revision AND r.state='AWAITING_AUDITOR'
      AND w.deadline>clock_timestamp() AND w.opened_at=(NEW.answer_anchor->>'openedAt')::timestamptz
      AND w.deadline=(NEW.answer_anchor->>'deadline')::timestamptz
      AND e.aggregate_id=NEW.run_id::text AND e.event_type='execution.escalation-raised'
      AND e.payload->'waitId'=NEW.answer_anchor->'waitId' AND e.payload->'kind'=NEW.answer_anchor->'kind'
      AND e.payload->'deadline'=NEW.answer_anchor->'deadline'
      AND e.payload->'optionIds'=(SELECT jsonb_agg(o->'id' ORDER BY ordinal)
        FROM jsonb_array_elements(w.options) WITH ORDINALITY options(o,ordinal))
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.options) o WHERE o->'id'=to_jsonb(NEW.answer_option_id))) THEN
    RAISE EXCEPTION 'Answer proposal requires its exact current question' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION run_interaction_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cmd run_interaction_command%ROWTYPE; prior run_interaction_transition%ROWTYPE; fact audit_events%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Interaction receipts are immutable' USING ERRCODE='23514';
  ELSIF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM run_interaction_command WHERE command_id=OLD.command_id) THEN RAISE EXCEPTION 'Interaction receipts survive with their command' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO cmd FROM run_interaction_command WHERE command_id=NEW.command_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interaction command missing' USING ERRCODE='23514'; END IF;
  SELECT * INTO prior FROM run_interaction_transition WHERE command_id=NEW.command_id ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence<>coalesce(prior.sequence,0)+1 OR NOT coalesce((
    (prior.state IS NULL AND NEW.state='received') OR (prior.state='received' AND NEW.state='interpreted') OR
    (prior.state='interpreted' AND (NEW.state IN ('queued','refused') OR (cmd.kind IN ('resume','stop','answer') AND NEW.state='applied'))) OR (prior.state='queued' AND NEW.state IN ('applied','superseded'))
  ),false) THEN RAISE EXCEPTION 'Invalid interaction transition' USING ERRCODE='23514'; END IF;
  IF NEW.source_event_id IS NOT NULL THEN
    SELECT * INTO fact FROM audit_events WHERE event_id=NEW.source_event_id;
    IF NOT FOUND OR fact.aggregate_id<>cmd.run_id::text OR fact.payload->>'commandId' IS DISTINCT FROM cmd.command_id::text
      OR NEW.created_at<>fact.occurred_at OR NOT coalesce((
        (cmd.kind='answer' AND NEW.state='applied' AND conversation_answer_receipt_valid(cmd,fact)) OR
        (cmd.kind='stop' AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success'
          AND EXISTS (SELECT 1 FROM audit_run r WHERE r.run_id=cmd.run_id AND r.cancel_requested_command_id=cmd.command_id
            AND r.cancel_requested_by=fact.actor_id AND r.cancel_requested_session=fact.session_id
            AND r.cancel_requested_at=(fact.payload->>'requestedAt')::timestamptz AND r.cancel_reason=fact.payload->>'reason')
          AND ((NEW.state='queued' AND fact.event_type='lifecycle.run-cancel-requested' AND fact.source='web'
              AND fact.payload->>'performedBy'='worker' AND fact.payload->>'state'='RUNNING' AND prior.state='interpreted')
            OR (NEW.state='applied' AND fact.event_type='lifecycle.run-canceled' AND fact.payload->>'state'='CANCELED'
              AND fact.payload->>'priorState' IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR')
              AND EXISTS (SELECT 1 FROM audit_run r WHERE r.run_id=cmd.run_id AND r.state='CANCELED')
              AND fact.payload->>'performedBy'=fact.source
              AND ((fact.source='web' AND prior.state='interpreted' AND fact.payload->>'priorState' IN ('QUEUED','PAUSED','AWAITING_AUDITOR'))
                OR (fact.source='worker' AND prior.state='queued' AND fact.payload->>'priorState'='RUNNING'))))) OR
        (NEW.state='applied' AND cmd.kind='resume' AND fact.event_type='lifecycle.run-resumed'
          AND fact.source='web' AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success'
          AND fact.payload->'waitId'=cmd.resume_anchor->'waitId'
          AND fact.payload->'pausedAt'=cmd.resume_anchor->'pausedAt'
          AND fact.payload->'deadline'=cmd.resume_anchor->'deadline'
          AND fact.payload->'controlEpoch'=cmd.resume_anchor->'controlEpoch'
          AND fact.payload->'expectedRunRevision'=to_jsonb(cmd.expected_run_revision)
          AND fact.payload->'planDigest'=to_jsonb(cmd.plan_digest)
          AND fact.payload->>'closureKind'='resume' AND fact.payload->>'priorState'='PAUSED' AND fact.payload->>'state'='RUNNING'
          AND EXISTS (SELECT 1 FROM run_wait w WHERE w.run_id=cmd.run_id AND w.wait_id::text=cmd.resume_anchor->>'waitId'
            AND w.kind='pause' AND w.closure_kind='resume' AND w.actor=cmd.actor_id
            AND w.closed_at=(fact.payload->>'occurredAt')::timestamptz)) OR
        (NEW.state='queued' AND cmd.kind='pause-now' AND fact.event_type='lifecycle.run-pause-requested' AND fact.source='web' AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success') OR
        (NEW.state='queued' AND cmd.kind='pause-after-inspection' AND fact.event_type='lifecycle.run-deferred-pause-requested' AND fact.source='web' AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success'
          AND fact.payload->'workItemId'=cmd.deferred_anchor->'workItemId' AND fact.payload->'registrationId'=cmd.deferred_anchor->'registrationId'
          AND fact.payload ? 'subjectKey' AND fact.payload->'subjectKey' IS NOT DISTINCT FROM cmd.deferred_anchor->'subjectKey' AND fact.payload->'expectedControlEpoch'=to_jsonb(cmd.deferred_control_epoch)
          AND fact.payload->'runRevision'=to_jsonb(cmd.expected_run_revision) AND fact.payload->'planDigest'=to_jsonb(cmd.plan_digest)
          AND EXISTS (SELECT 1 FROM run_deferred_pause latch WHERE latch.command_id=cmd.command_id
            AND latch.requested_by=fact.actor_id AND latch.session_id=fact.session_id
            AND latch.requested_at=(fact.payload->>'requestedAt')::timestamptz)) OR
        (NEW.state='applied' AND fact.event_type='lifecycle.run-paused' AND fact.source='worker' AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success'
          AND (cmd.kind='pause-now' OR (cmd.kind='pause-after-inspection' AND fact.payload->>'pauseMode'='after-inspection' AND fact.payload->'workItemId'=cmd.deferred_anchor->'workItemId' AND fact.payload->'registrationId'=cmd.deferred_anchor->'registrationId' AND fact.payload ? 'subjectKey' AND fact.payload->'subjectKey' IS NOT DISTINCT FROM cmd.deferred_anchor->'subjectKey'))) OR
        (NEW.state='superseded' AND cmd.kind='pause-now' AND fact.event_type='lifecycle.pause-superseded' AND fact.source='worker' AND fact.actor_type='system' AND fact.actor_id='result-sealer' AND fact.outcome='failure' AND fact.payload->>'requestedBy'=cmd.actor_id) OR
        (NEW.state='superseded' AND cmd.kind='pause-after-inspection' AND fact.event_type='lifecycle.deferred-pause-superseded' AND fact.source IN ('worker','web') AND fact.actor_type='system' AND fact.actor_id='deferred-pause-coordinator' AND fact.outcome='failure' AND fact.payload->>'requestedBy'=cmd.actor_id
          AND fact.payload->'workItemId'=cmd.deferred_anchor->'workItemId' AND fact.payload->'registrationId'=cmd.deferred_anchor->'registrationId' AND fact.payload ? 'subjectKey' AND fact.payload->'subjectKey' IS NOT DISTINCT FROM cmd.deferred_anchor->'subjectKey')
      ),false) THEN RAISE EXCEPTION 'Interaction receipt requires its exact domain event' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
CREATE FUNCTION guard_conversation_answer_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cmd run_interaction_command%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND ((OLD.event_type='execution.escalation-answered' AND OLD.payload ? 'commandId') OR
    EXISTS (SELECT 1 FROM run_interaction_command c WHERE c.answer_anchor->>'raisedEventId'=OLD.event_id::text)) THEN
    RAISE EXCEPTION 'Question and answer receipts are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.event_type<>'execution.escalation-answered' OR NOT NEW.payload ? 'commandId' THEN RETURN NEW; END IF;
  SELECT * INTO cmd FROM run_interaction_command WHERE command_id::text=NEW.payload->>'commandId';
  IF cmd.command_id IS NULL OR NOT conversation_answer_receipt_valid(cmd,NEW) THEN
    RAISE EXCEPTION 'Answer fact requires its exact proposal and closed wait' USING ERRCODE='23514';
  END IF;
  -- Validate the transition when the fact is created, not when history is read or
  -- deferred constraints run: a later Pause/new wait may be valid in this transaction.
  IF cmd.answer_option_id<>'abort' AND NOT EXISTS (SELECT 1 FROM audit_run r
    WHERE r.run_id=cmd.run_id AND r.state='RUNNING' AND r.revision=cmd.expected_run_revision+1) THEN
    RAISE EXCEPTION 'Answer fact requires its authoritative Run transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER conversation_answer_fact_guard BEFORE INSERT OR UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION guard_conversation_answer_fact();
--> statement-breakpoint
CREATE FUNCTION conversation_answer_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact audit_events%ROWTYPE; cmd run_interaction_command%ROWTYPE;
BEGIN
  IF NEW.event_type<>'execution.escalation-answered' OR NOT NEW.payload ? 'commandId' THEN RETURN NEW; END IF;
  SELECT * INTO cmd FROM run_interaction_command WHERE command_id::text=NEW.payload->>'commandId';
  SELECT * INTO fact FROM audit_events WHERE event_id=NEW.event_id;
  IF cmd.command_id IS NULL OR NOT conversation_answer_receipt_valid(cmd,fact) OR NOT EXISTS
    (SELECT 1 FROM run_interaction_transition t WHERE t.command_id=cmd.command_id AND t.state='applied'
      AND t.source_event_id=NEW.event_id AND t.created_at=NEW.occurred_at) THEN
    RAISE EXCEPTION 'Answered question requires its atomic applied receipt' USING ERRCODE='23514';
  END IF;
  IF cmd.answer_option_id='abort' AND NOT EXISTS (SELECT 1 FROM audit_run r JOIN run_result rr ON rr.run_id=r.run_id
    JOIN run_evidence_package ep ON ep.run_id=r.run_id WHERE r.run_id=cmd.run_id AND r.state='CANCELED'
    AND rr.run_state='CANCELED' AND rr.outcome='CANCELED' AND rr.sealed AND ep.run_state='CANCELED') THEN
    RAISE EXCEPTION 'Abort answer requires sealed cancellation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER conversation_answer_consistency AFTER INSERT ON audit_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION conversation_answer_consistency();
--> statement-breakpoint
CREATE FUNCTION retain_conversation_answer_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ((OLD.event_type='execution.escalation-answered' AND OLD.payload ? 'commandId') OR
    EXISTS (SELECT 1 FROM run_interaction_command c WHERE c.answer_anchor->>'raisedEventId'=OLD.event_id::text))
    AND EXISTS (SELECT 1 FROM audit_run WHERE run_id::text=OLD.aggregate_id) THEN
    RAISE EXCEPTION 'Question and answer receipts survive with their Run' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER retain_conversation_answer_fact AFTER DELETE ON audit_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retain_conversation_answer_fact();
--> statement-breakpoint
CREATE FUNCTION guard_wait_answer_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.answer_command_id IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Accepted conversational wait closure is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER wait_answer_command_guard BEFORE UPDATE ON run_wait
FOR EACH ROW EXECUTE FUNCTION guard_wait_answer_command();
--> statement-breakpoint
CREATE FUNCTION wait_answer_command_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE addressed run_wait%ROWTYPE; cmd run_interaction_command%ROWTYPE; fact audit_events%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN addressed=OLD; ELSE addressed=NEW; END IF;
  IF addressed.answer_command_id IS NULL OR NOT EXISTS (SELECT 1 FROM audit_run WHERE run_id=addressed.run_id) THEN RETURN NULL; END IF;
  SELECT * INTO cmd FROM run_interaction_command WHERE command_id=addressed.answer_command_id;
  SELECT e.* INTO fact FROM run_interaction_transition t JOIN audit_events e ON e.event_id=t.source_event_id
    WHERE t.command_id=addressed.answer_command_id AND t.state='applied' AND t.created_at=e.occurred_at;
  IF cmd.command_id IS NULL OR fact.event_id IS NULL OR NOT conversation_answer_receipt_valid(cmd,fact) THEN
    RAISE EXCEPTION 'Conversational wait closure requires its authoritative event and receipt' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER wait_answer_command_consistency AFTER INSERT OR UPDATE OR DELETE ON run_wait
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wait_answer_command_consistency();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (59);
