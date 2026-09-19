ALTER TABLE "run_interaction_command" DROP CONSTRAINT "run_interaction_command_kind";--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD COLUMN "resume_anchor" jsonb;--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD CONSTRAINT "run_interaction_command_kind" CHECK ((
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
  ));
--> statement-breakpoint
DROP TRIGGER run_interaction_command_guard ON run_interaction_command;
--> statement-breakpoint
DROP FUNCTION run_interaction_command_guard();
--> statement-breakpoint
CREATE FUNCTION run_interaction_command_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
        OR (NEW.kind='resume' AND e.payload->>'intent'='resume'))
      AND e.payload->>'messageId'=NEW.message_id::text
      AND e.payload->>'semanticFingerprint'=NEW.semantic_fingerprint) THEN
    RAISE EXCEPTION 'Interaction command must bind its exact intake' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER run_interaction_command_guard BEFORE INSERT OR UPDATE OR DELETE ON run_interaction_command
FOR EACH ROW EXECUTE FUNCTION run_interaction_command_guard();
--> statement-breakpoint
DROP TRIGGER run_interaction_transition_guard ON run_interaction_transition;
--> statement-breakpoint
DROP FUNCTION run_interaction_transition_guard();
--> statement-breakpoint
CREATE FUNCTION run_interaction_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    (prior.state='interpreted' AND (NEW.state IN ('queued','refused') OR (cmd.kind='resume' AND NEW.state='applied'))) OR (prior.state='queued' AND NEW.state IN ('applied','superseded'))
  ),false) THEN RAISE EXCEPTION 'Invalid interaction transition' USING ERRCODE='23514'; END IF;
  IF NEW.source_event_id IS NOT NULL THEN
    SELECT * INTO fact FROM audit_events WHERE event_id=NEW.source_event_id;
    IF NOT FOUND OR fact.aggregate_id<>cmd.run_id::text OR fact.payload->>'commandId' IS DISTINCT FROM cmd.command_id::text
      OR NEW.created_at<>fact.occurred_at OR NOT coalesce((
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
CREATE TRIGGER run_interaction_transition_guard BEFORE INSERT OR UPDATE OR DELETE ON run_interaction_transition
FOR EACH ROW EXECUTE FUNCTION run_interaction_transition_guard();
--> statement-breakpoint

INSERT INTO "schema_meta" ("version") VALUES (56);
