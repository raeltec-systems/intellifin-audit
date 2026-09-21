-- Draft migration 0062; parent sequences journal/snapshot/schema_meta after 0060 and 0061.
ALTER TABLE run_flag ADD COLUMN interaction_command_id uuid;
--> statement-breakpoint
ALTER TABLE run_flag ADD CONSTRAINT run_flag_interaction_command_id_run_interaction_command_command_id_fk FOREIGN KEY (interaction_command_id) REFERENCES run_interaction_command(command_id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE UNIQUE INDEX run_flag_interaction_command ON run_flag(interaction_command_id);
--> statement-breakpoint
ALTER TABLE run_interaction_command ADD COLUMN flag_anchor jsonb;
--> statement-breakpoint
ALTER TABLE run_interaction_command DROP CONSTRAINT run_interaction_command_kind;
--> statement-breakpoint
ALTER TABLE run_interaction_command ADD CONSTRAINT run_interaction_command_kind CHECK ((("run_interaction_command"."kind"='flag' AND "run_interaction_command"."interpretation_version"='confirmed-flag-v1'
      AND "run_interaction_command"."deferred_anchor" IS NULL AND "run_interaction_command"."deferred_control_epoch" IS NULL AND "run_interaction_command"."resume_anchor" IS NULL
      AND "run_interaction_command"."answer_anchor" IS NULL AND "run_interaction_command"."answer_option_id" IS NULL
      AND "run_interaction_command"."flag_anchor" IS NOT NULL AND jsonb_typeof("run_interaction_command"."flag_anchor")='object'
      AND "run_interaction_command"."flag_anchor" ?& ARRAY['noteDigest','noteLength']
      AND ("run_interaction_command"."flag_anchor" - ARRAY['noteDigest','noteLength']::text[])='{}'::jsonb
      AND (("run_interaction_command"."flag_anchor"->'noteDigest'='null'::jsonb AND "run_interaction_command"."flag_anchor"->'noteLength'='0'::jsonb)
        OR (jsonb_typeof("run_interaction_command"."flag_anchor"->'noteDigest')='string' AND ("run_interaction_command"."flag_anchor"->>'noteDigest') ~ '^[a-f0-9]{64}$'
          AND jsonb_typeof("run_interaction_command"."flag_anchor"->'noteLength')='number' AND ("run_interaction_command"."flag_anchor"->>'noteLength') ~ '^[0-9]+$'
          AND ("run_interaction_command"."flag_anchor"->>'noteLength')::numeric BETWEEN 1 AND 500))) OR ("run_interaction_command"."flag_anchor" IS NULL AND (((
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
  )))) IS TRUE))) IS TRUE);
--> statement-breakpoint
CREATE FUNCTION conversation_flag_receipt_valid(cmd run_interaction_command, fact audit_events)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(cmd.kind='flag' AND fact.event_type='lifecycle.run-flagged' AND fact.source='web'
    AND fact.outcome='success' AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id
    AND fact.aggregate_id=cmd.run_id::text AND fact.payload->>'state' IN ('RUNNING','PAUSED','AWAITING_AUDITOR')
    AND EXISTS (SELECT 1 FROM run_flag f WHERE f.flag_id=CASE WHEN jsonb_typeof(fact.payload->'flagId')='string'
      AND fact.payload->>'flagId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (fact.payload->>'flagId')::uuid ELSE NULL END
      AND f.interaction_command_id=cmd.command_id AND f.flagged_at>=cmd.created_at AND f.run_id=cmd.run_id AND f.flagged_by=cmd.actor_id AND f.session_id=fact.session_id AND f.flagged_at=fact.occurred_at
      AND cmd.flag_anchor=jsonb_build_object('noteDigest',CASE WHEN f.note IS NULL THEN NULL ELSE encode(sha256(convert_to(f.note,'UTF8')),'hex') END,
        'noteLength',CASE WHEN f.note IS NULL THEN 0 ELSE (SELECT sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END)::int FROM regexp_split_to_table(f.note,'') ch) END)
      AND fact.payload=jsonb_build_object('commandId',cmd.command_id::text,'flagId',f.flag_id::text,
        'state',fact.payload->>'state','flaggedAt',to_char(f.flagged_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'noteDigest',cmd.flag_anchor->'noteDigest','noteLength',cmd.flag_anchor->'noteLength')),false)
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
        OR (NEW.kind='flag' AND e.payload->>'intent'='flag-proposal' AND e.payload->'flagAnchor'=NEW.flag_anchor)
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
    (prior.state='interpreted' AND (NEW.state IN ('queued','refused') OR (cmd.kind IN ('resume','stop','answer','flag') AND NEW.state='applied'))) OR (prior.state='queued' AND NEW.state IN ('applied','superseded'))
  ),false) THEN RAISE EXCEPTION 'Invalid interaction transition' USING ERRCODE='23514'; END IF;
  IF NEW.source_event_id IS NOT NULL THEN
    SELECT * INTO fact FROM audit_events WHERE event_id=NEW.source_event_id;
    IF NOT FOUND OR fact.aggregate_id<>cmd.run_id::text OR fact.payload->>'commandId' IS DISTINCT FROM cmd.command_id::text
      OR NEW.created_at<>fact.occurred_at OR NOT coalesce((
        (cmd.kind='flag' AND NEW.state='applied' AND conversation_flag_receipt_valid(cmd,fact)) OR
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
CREATE FUNCTION guard_conversation_flag_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cmd run_interaction_command%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND ((OLD.event_type='lifecycle.run-flagged' AND OLD.payload ? 'commandId') OR (NEW.event_type='lifecycle.run-flagged' AND NEW.payload ? 'commandId')) THEN
    RAISE EXCEPTION 'Conversational flag facts are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.event_type<>'lifecycle.run-flagged' OR NOT NEW.payload ? 'commandId' THEN RETURN NEW; END IF;
  IF NOT coalesce(jsonb_typeof(NEW.payload->'commandId')='string' AND NEW.payload->>'commandId' ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false) THEN
    RAISE EXCEPTION 'Conversational flag requires valid command identity' USING ERRCODE='23514';
  END IF;
  SELECT * INTO cmd FROM run_interaction_command WHERE command_id=(NEW.payload->>'commandId')::uuid;
  IF cmd.command_id IS NULL OR NOT conversation_flag_receipt_valid(cmd,NEW) THEN
    RAISE EXCEPTION 'Conversational flag fact requires its exact flag and proposal' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM audit_run WHERE run_id=cmd.run_id FOR UPDATE;
  PERFORM 1 FROM auth_user WHERE id=cmd.actor_id FOR UPDATE;
  PERFORM 1 FROM run_conversation_message m JOIN run_conversation_content c USING(message_id)
    WHERE m.run_id=cmd.run_id AND (m.message_id=cmd.message_id OR (m.parent_message_id=cmd.message_id AND m.kind='command-receipt'))
    ORDER BY c.message_id FOR UPDATE OF c;
  IF NOT EXISTS (SELECT 1 FROM audit_run r JOIN user_role u ON u.user_id=cmd.actor_id
    WHERE r.run_id=cmd.run_id AND r.state=NEW.payload->>'state' AND u.role IN ('auditor','audit-manager')) OR
    NOT EXISTS (SELECT 1 FROM run_interaction_transition WHERE command_id=cmd.command_id AND state='interpreted') OR
    EXISTS (SELECT 1 FROM run_interaction_transition WHERE command_id=cmd.command_id AND state IN ('queued','applied','refused','superseded')) OR
    (SELECT count(*) FROM run_conversation_message m JOIN run_conversation_content c USING(message_id)
      WHERE m.run_id=cmd.run_id AND (m.message_id=cmd.message_id OR (m.parent_message_id=cmd.message_id AND m.kind='command-receipt'))
        AND c.ciphertext IS NOT NULL AND c.removed_at IS NULL)<>2 THEN
    RAISE EXCEPTION 'Conversational flag requires current authority and readable interpreted proposal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER conversation_flag_fact_guard BEFORE INSERT OR UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION guard_conversation_flag_fact();
--> statement-breakpoint
CREATE UNIQUE INDEX conversation_flag_command_fact ON audit_events ((payload->>'commandId')) WHERE event_type='lifecycle.run-flagged' AND payload ? 'commandId';
--> statement-breakpoint
CREATE FUNCTION conversation_flag_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cmd run_interaction_command%ROWTYPE; fact audit_events%ROWTYPE;
BEGIN
  IF NEW.event_type<>'lifecycle.run-flagged' OR NOT NEW.payload ? 'commandId' THEN RETURN NEW; END IF;
  SELECT * INTO cmd FROM run_interaction_command WHERE command_id=(NEW.payload->>'commandId')::uuid;
  SELECT * INTO fact FROM audit_events WHERE event_id=NEW.event_id;
  IF cmd.command_id IS NULL OR NOT conversation_flag_receipt_valid(cmd,fact) OR NOT EXISTS
    (SELECT 1 FROM run_interaction_transition WHERE command_id=cmd.command_id AND state='applied'
      AND source_event_id=NEW.event_id AND created_at=NEW.occurred_at) THEN
    RAISE EXCEPTION 'Conversational flag requires its atomic applied receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER conversation_flag_consistency AFTER INSERT ON audit_events DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION conversation_flag_consistency();
--> statement-breakpoint
CREATE FUNCTION retain_conversation_flag_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.event_type='lifecycle.run-flagged' AND OLD.payload ? 'commandId' AND EXISTS (SELECT 1 FROM audit_run WHERE run_id::text=OLD.aggregate_id) THEN
    RAISE EXCEPTION 'Conversational flag facts survive with their Run' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER retain_conversation_flag_fact AFTER DELETE ON audit_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retain_conversation_flag_fact();
--> statement-breakpoint
CREATE FUNCTION retain_conversation_flag() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM audit_run WHERE run_id=OLD.run_id) AND (OLD.interaction_command_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM audit_events WHERE event_type='lifecycle.run-flagged' AND aggregate_id=OLD.run_id::text
      AND payload ? 'commandId' AND payload->>'flagId'=OLD.flag_id::text)) THEN
    RAISE EXCEPTION 'Conversational flag survives with its Run' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER retain_conversation_flag AFTER DELETE ON run_flag DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retain_conversation_flag();

--> statement-breakpoint
CREATE FUNCTION conversation_flag_row_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cmd run_interaction_command%ROWTYPE;
BEGIN
  IF NEW.interaction_command_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO cmd FROM run_interaction_command WHERE command_id=NEW.interaction_command_id;
  IF cmd.command_id IS NULL OR NOT EXISTS (SELECT 1 FROM audit_events e JOIN run_interaction_transition t ON t.source_event_id=e.event_id
    WHERE e.event_type='lifecycle.run-flagged' AND e.aggregate_id=NEW.run_id::text
      AND t.command_id=cmd.command_id AND t.state='applied' AND t.created_at=e.occurred_at
      AND conversation_flag_receipt_valid(cmd,e) AND e.payload->>'flagId'=NEW.flag_id::text) THEN
    RAISE EXCEPTION 'Conversational flag row requires its exact atomic fact and receipt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER conversation_flag_row_consistency AFTER INSERT ON run_flag DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION conversation_flag_row_consistency();
