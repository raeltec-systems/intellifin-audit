CREATE TABLE "run_interaction_command" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"request_key" uuid NOT NULL,
	"semantic_fingerprint" text NOT NULL,
	"plan_digest" text NOT NULL,
	"expected_run_revision" integer NOT NULL,
	"interpretation_version" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_interaction_command_kind" CHECK ("run_interaction_command"."kind" = 'pause-now' AND "run_interaction_command"."interpretation_version" = 'exact-safety-v1'),
	CONSTRAINT "run_interaction_command_envelope" CHECK ("run_interaction_command"."expected_run_revision" >= 0 AND "run_interaction_command"."plan_digest" ~ '^[a-f0-9]{64}$' AND "run_interaction_command"."semantic_fingerprint" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "run_interaction_transition" (
	"command_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"state" text NOT NULL,
	"reason_code" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"source_event_id" uuid,
	CONSTRAINT "run_interaction_transition_command_id_sequence_pk" PRIMARY KEY("command_id","sequence"),
	CONSTRAINT "run_interaction_transition_state" CHECK ("run_interaction_transition"."state" IN ('received','interpreted','queued','applied','refused','superseded')),
	CONSTRAINT "run_interaction_transition_bounds" CHECK ("run_interaction_transition"."sequence" BETWEEN 1 AND 1000 AND "run_interaction_transition"."reason_code" ~ '^[a-z][a-z0-9-]{0,79}$'),
	CONSTRAINT "run_interaction_transition_event_binding" CHECK (("run_interaction_transition"."state" IN ('queued','applied','superseded')) = ("run_interaction_transition"."source_event_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "pause_requested_command_id" uuid;--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD CONSTRAINT "run_interaction_command_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_interaction_command" ADD CONSTRAINT "run_interaction_command_message_id_run_conversation_message_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."run_conversation_message"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_interaction_transition" ADD CONSTRAINT "run_interaction_transition_command_id_run_interaction_command_command_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."run_interaction_command"("command_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_interaction_command_request" ON "run_interaction_command" USING btree ("run_id","actor_id","kind","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "run_interaction_command_message" ON "run_interaction_command" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_interaction_transition_event" ON "run_interaction_transition" USING btree ("source_event_id");--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_pause_command" CHECK ("audit_run"."pause_requested_command_id" IS NULL OR "audit_run"."pause_requested_at" IS NOT NULL);--> statement-breakpoint
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
    WHERE m.message_id=NEW.message_id
    AND m.run_id=NEW.run_id AND m.actor_id=NEW.actor_id AND m.request_key=NEW.request_key
    AND m.semantic_fingerprint=NEW.semantic_fingerprint AND m.kind='auditor-message'
    AND e.event_type='review.conversation-received' AND e.source='web' AND e.outcome='success'
    AND e.actor_type='human' AND e.actor_id=NEW.actor_id
    AND e.payload->>'intent'='pause-now' AND e.payload->>'messageId'=NEW.message_id::text
    AND e.payload->>'semanticFingerprint'=NEW.semantic_fingerprint) THEN
    RAISE EXCEPTION 'Interaction command must bind its exact intake' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER run_interaction_command_guard BEFORE INSERT OR UPDATE OR DELETE ON run_interaction_command
FOR EACH ROW EXECUTE FUNCTION run_interaction_command_guard();
--> statement-breakpoint
CREATE FUNCTION run_interaction_transition_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cmd run_interaction_command%ROWTYPE;
  prior run_interaction_transition%ROWTYPE;
  fact audit_events%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Interaction receipts are immutable' USING ERRCODE='23514';
  ELSIF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM run_interaction_command WHERE command_id=OLD.command_id) THEN
      RAISE EXCEPTION 'Interaction receipts survive with their command' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO cmd FROM run_interaction_command WHERE command_id=NEW.command_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interaction command missing' USING ERRCODE='23514'; END IF;
  SELECT * INTO prior FROM run_interaction_transition WHERE command_id=NEW.command_id ORDER BY sequence DESC LIMIT 1;
  IF NEW.sequence<>coalesce(prior.sequence,0)+1 OR NOT coalesce((
    (prior.state IS NULL AND NEW.state='received') OR
    (prior.state='received' AND NEW.state='interpreted') OR
    (prior.state='interpreted' AND NEW.state IN ('queued','refused')) OR
    (prior.state='queued' AND NEW.state IN ('applied','superseded'))
  ),false) THEN RAISE EXCEPTION 'Invalid interaction transition' USING ERRCODE='23514'; END IF;
  IF NEW.source_event_id IS NOT NULL THEN
    SELECT * INTO fact FROM audit_events WHERE event_id=NEW.source_event_id;
    IF NOT FOUND OR fact.aggregate_id<>cmd.run_id::text
      OR fact.payload->>'commandId' IS DISTINCT FROM cmd.command_id::text
      OR NEW.created_at<>fact.occurred_at OR NOT coalesce((
        (NEW.state='queued' AND fact.event_type='lifecycle.run-pause-requested' AND fact.source='web'
          AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success') OR
        (NEW.state='applied' AND fact.event_type='lifecycle.run-paused' AND fact.source='worker'
          AND fact.actor_type='human' AND fact.actor_id=cmd.actor_id AND fact.outcome='success') OR
        (NEW.state='superseded' AND fact.event_type='lifecycle.pause-superseded' AND fact.source='worker'
          AND fact.actor_type='system' AND fact.actor_id='result-sealer' AND fact.outcome='failure'
          AND fact.payload->>'requestedBy'=cmd.actor_id)
      ),false) THEN RAISE EXCEPTION 'Interaction receipt requires its exact domain event' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER run_interaction_transition_guard BEFORE INSERT OR UPDATE OR DELETE ON run_interaction_transition
FOR EACH ROW EXECUTE FUNCTION run_interaction_transition_guard();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (53);
