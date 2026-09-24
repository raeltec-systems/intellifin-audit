CREATE TABLE "run_deferred_pause" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"subject_key" text,
	"registration_id" text NOT NULL,
	"run_revision" integer NOT NULL,
	"plan_digest" text NOT NULL,
	"requested_by" text NOT NULL,
	"session_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"expected_control_epoch" integer NOT NULL,
	"state" text DEFAULT 'PENDING' NOT NULL,
	"applied_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"superseded_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_deferred_pause_state" CHECK ((
    ("run_deferred_pause"."state"='PENDING' AND "run_deferred_pause"."applied_at" IS NULL AND "run_deferred_pause"."superseded_at" IS NULL AND "run_deferred_pause"."superseded_reason" IS NULL)
    OR ("run_deferred_pause"."state"='APPLIED' AND "run_deferred_pause"."applied_at" IS NOT NULL AND "run_deferred_pause"."superseded_at" IS NULL AND "run_deferred_pause"."superseded_reason" IS NULL)
    OR ("run_deferred_pause"."state"='SUPERSEDED' AND "run_deferred_pause"."applied_at" IS NULL AND "run_deferred_pause"."superseded_at" IS NOT NULL AND "run_deferred_pause"."superseded_reason" IS NOT NULL AND "run_deferred_pause"."superseded_reason" IN ('immediate-pause','cancellation','run-finalized'))
  )),
	CONSTRAINT "run_deferred_pause_anchor" CHECK ("run_deferred_pause"."run_revision" >= 0 AND "run_deferred_pause"."plan_digest" ~ '^[a-f0-9]{64}$' AND "run_deferred_pause"."expected_control_epoch" > 0 AND ("run_deferred_pause"."subject_key" IS NULL OR octet_length("run_deferred_pause"."subject_key") BETWEEN 1 AND 512))
);
--> statement-breakpoint
ALTER TABLE "run_interaction_command" DROP CONSTRAINT "run_interaction_command_kind";--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD COLUMN "deferred_anchor" jsonb;--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD COLUMN "deferred_control_epoch" integer;--> statement-breakpoint
ALTER TABLE "run_deferred_pause" ADD CONSTRAINT "run_deferred_pause_command_id_run_interaction_command_command_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."run_interaction_command"("command_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_deferred_pause" ADD CONSTRAINT "run_deferred_pause_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_deferred_pause" ADD CONSTRAINT "run_deferred_pause_work_item_id_run_work_item_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."run_work_item"("work_item_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "run_deferred_pause_pending" ON "run_deferred_pause" USING btree ("run_id") WHERE "run_deferred_pause"."state" = 'PENDING';--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD CONSTRAINT "run_interaction_command_kind" CHECK ((
    ("run_interaction_command"."kind" = 'pause-now' AND "run_interaction_command"."interpretation_version" = 'exact-safety-v1' AND "run_interaction_command"."deferred_anchor" IS NULL AND "run_interaction_command"."deferred_control_epoch" IS NULL)
    OR
    ("run_interaction_command"."kind" = 'pause-after-inspection' AND "run_interaction_command"."interpretation_version" = 'confirmed-inspection-v1'
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
  ));
--> statement-breakpoint
-- The existing interaction triggers are replaced so the new proposal kind can bind its
-- distinct conversation intent and its deferred domain events without weakening pause-now.
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
        OR (NEW.kind='pause-after-inspection' AND e.payload->>'intent'='deferred-pause-proposal'))
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
    (prior.state='interpreted' AND NEW.state IN ('queued','refused')) OR (prior.state='queued' AND NEW.state IN ('applied','superseded'))
  ),false) THEN RAISE EXCEPTION 'Invalid interaction transition' USING ERRCODE='23514'; END IF;
  IF NEW.source_event_id IS NOT NULL THEN
    SELECT * INTO fact FROM audit_events WHERE event_id=NEW.source_event_id;
    IF NOT FOUND OR fact.aggregate_id<>cmd.run_id::text OR fact.payload->>'commandId' IS DISTINCT FROM cmd.command_id::text
      OR NEW.created_at<>fact.occurred_at OR NOT coalesce((
        (NEW.state='queued' AND cmd.kind='pause-now' AND fact.event_type='lifecycle.run-pause-requested' AND fact.source='web' AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success') OR
        (NEW.state='queued' AND cmd.kind='pause-after-inspection' AND fact.event_type='lifecycle.run-deferred-pause-requested' AND fact.source='web' AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success'
          AND fact.payload->'workItemId'=cmd.deferred_anchor->'workItemId' AND fact.payload->'registrationId'=cmd.deferred_anchor->'registrationId'
          AND fact.payload ? 'subjectKey' AND fact.payload->'subjectKey' IS NOT DISTINCT FROM cmd.deferred_anchor->'subjectKey' AND fact.payload->'expectedControlEpoch'=to_jsonb(cmd.deferred_control_epoch)
          AND fact.payload->'runRevision'=to_jsonb(cmd.expected_run_revision) AND fact.payload->'planDigest'=to_jsonb(cmd.plan_digest)
          AND EXISTS (SELECT 1 FROM run_deferred_pause latch WHERE latch.command_id=cmd.command_id
            AND latch.requested_by=fact.actor_id AND latch.session_id=fact.session_id
            AND latch.requested_at=(fact.payload->>'requestedAt')::timestamptz)) OR
        (NEW.state='applied' AND fact.event_type='lifecycle.run-paused' AND fact.source='worker' AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success'
          AND (cmd.kind='pause-now' OR (fact.payload->>'pauseMode'='after-inspection' AND fact.payload->'workItemId'=cmd.deferred_anchor->'workItemId' AND fact.payload->'registrationId'=cmd.deferred_anchor->'registrationId' AND fact.payload ? 'subjectKey' AND fact.payload->'subjectKey' IS NOT DISTINCT FROM cmd.deferred_anchor->'subjectKey'))) OR
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
CREATE FUNCTION run_deferred_pause_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cmd run_interaction_command%ROWTYPE; item run_work_item%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM audit_run WHERE run_id=OLD.run_id) THEN RAISE EXCEPTION 'Deferred pause survives with its Run' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  ELSIF TG_OP='UPDATE' THEN
    IF NEW.command_id IS DISTINCT FROM OLD.command_id OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.work_item_id IS DISTINCT FROM OLD.work_item_id
      OR NEW.subject_key IS DISTINCT FROM OLD.subject_key OR NEW.registration_id IS DISTINCT FROM OLD.registration_id OR NEW.run_revision IS DISTINCT FROM OLD.run_revision
      OR NEW.plan_digest IS DISTINCT FROM OLD.plan_digest OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.expected_control_epoch IS DISTINCT FROM OLD.expected_control_epoch OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR OLD.state<>'PENDING' OR NEW.state NOT IN ('APPLIED','SUPERSEDED') THEN RAISE EXCEPTION 'Deferred pause identity is immutable' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO cmd FROM run_interaction_command WHERE command_id=NEW.command_id FOR UPDATE;
  IF NOT FOUND OR cmd.kind<>'pause-after-inspection' OR cmd.actor_id<>NEW.requested_by OR cmd.run_id<>NEW.run_id OR cmd.deferred_control_epoch<>NEW.expected_control_epoch
    OR cmd.deferred_anchor->>'workItemId'<>NEW.work_item_id::text OR cmd.deferred_anchor->>'subjectKey' IS DISTINCT FROM NEW.subject_key
    OR cmd.deferred_anchor->>'registrationId'<>NEW.registration_id OR (cmd.deferred_anchor->>'runRevision')::integer<>NEW.run_revision
    OR cmd.deferred_anchor->>'planDigest'<>NEW.plan_digest OR cmd.expected_run_revision<>NEW.run_revision OR cmd.plan_digest<>NEW.plan_digest THEN
    RAISE EXCEPTION 'Deferred pause must bind its immutable proposal' USING ERRCODE='23514';
  END IF;
  SELECT * INTO item FROM run_work_item WHERE work_item_id=NEW.work_item_id;
  IF NOT FOUND OR item.run_id<>NEW.run_id OR item.subject_key IS DISTINCT FROM NEW.subject_key OR item.registration_id<>NEW.registration_id THEN
    RAISE EXCEPTION 'Deferred pause target is not a Run-owned Work Item' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER run_deferred_pause_guard BEFORE INSERT OR UPDATE OR DELETE ON run_deferred_pause
FOR EACH ROW EXECUTE FUNCTION run_deferred_pause_guard();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (55);
