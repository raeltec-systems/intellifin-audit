CREATE TABLE "run_agent_turn" (
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"work_item_id" uuid NOT NULL,
	"step_execution_id" uuid NOT NULL,
	"snapshot_evidence_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reserved_tokens" integer NOT NULL,
	"response" jsonb,
	"diagnostic" text,
	CONSTRAINT "run_agent_turn_run_id_sequence_pk" PRIMARY KEY("run_id","sequence"),
	CONSTRAINT "run_agent_turn_status" CHECK ("run_agent_turn"."status" IN ('RESERVED','COMPLETED','FAILED')),
	CONSTRAINT "run_agent_turn_counts" CHECK ("run_agent_turn"."sequence">0 AND "run_agent_turn"."reserved_tokens">0),
	CONSTRAINT "run_agent_turn_response" CHECK (("run_agent_turn"."status"='COMPLETED')=("run_agent_turn"."response" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "run_agent_work" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"run_started_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"attempt_id" uuid NOT NULL,
	"work_item_id" uuid,
	"wait_id" uuid,
	"pending_wait" jsonb,
	"next_turn" integer NOT NULL,
	"tokens" integer NOT NULL,
	"reserved_tokens" integer NOT NULL,
	"model" jsonb,
	"diagnostic" text,
	CONSTRAINT "run_agent_work_status" CHECK ("run_agent_work"."status" IN ('EXECUTING','RETRY','WAITING','COMPLETE','TERMINAL')),
	CONSTRAINT "run_agent_work_counts" CHECK ("run_agent_work"."revision">0 AND "run_agent_work"."next_turn">0 AND "run_agent_work"."tokens">=0 AND "run_agent_work"."reserved_tokens">=0)
);
--> statement-breakpoint
CREATE TABLE "run_evidence_capture" (
	"evidence_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"tool_action_id" uuid NOT NULL,
	"source_location" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_wait" (
	"wait_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"options" jsonb NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"closure_kind" text,
	"answer_option_id" text,
	"actor" text,
	CONSTRAINT "run_wait_kind" CHECK ("run_wait"."kind" IN ('choose-candidate','unnamed-value','retry-or-skip')),
	CONSTRAINT "run_wait_options" CHECK (jsonb_typeof("run_wait"."options")='array' AND jsonb_array_length("run_wait"."options")>0),
	CONSTRAINT "run_wait_closure" CHECK (("run_wait"."closed_at" IS NULL AND "run_wait"."closure_kind" IS NULL AND "run_wait"."answer_option_id" IS NULL AND "run_wait"."actor" IS NULL) OR ("run_wait"."closed_at" IS NOT NULL AND "run_wait"."closure_kind" IS NOT NULL AND "run_wait"."closure_kind"='answer' AND "run_wait"."answer_option_id" IS NOT NULL AND "run_wait"."actor" IS NOT NULL) OR ("run_wait"."closed_at" IS NOT NULL AND "run_wait"."closure_kind" IS NOT NULL AND "run_wait"."actor" IS NOT NULL AND "run_wait"."closure_kind"='timeout' AND "run_wait"."answer_option_id" IS NULL AND "run_wait"."actor"='wait-wake'))
);
--> statement-breakpoint
DROP INDEX "run_work_item_run_step";--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_work_item" ADD COLUMN "subject_key" text;--> statement-breakpoint
ALTER TABLE "run_agent_turn" ADD CONSTRAINT "run_agent_turn_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_agent_turn" ADD CONSTRAINT "run_agent_turn_work_item_id_run_work_item_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."run_work_item"("work_item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_agent_turn" ADD CONSTRAINT "run_agent_turn_step_execution_id_run_step_execution_step_execution_id_fk" FOREIGN KEY ("step_execution_id") REFERENCES "public"."run_step_execution"("step_execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_agent_turn" ADD CONSTRAINT "run_agent_turn_snapshot_evidence_id_run_evidence_evidence_id_fk" FOREIGN KEY ("snapshot_evidence_id") REFERENCES "public"."run_evidence"("evidence_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_agent_work" ADD CONSTRAINT "run_agent_work_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_agent_work" ADD CONSTRAINT "run_agent_work_work_item_id_run_work_item_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."run_work_item"("work_item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_evidence_capture" ADD CONSTRAINT "run_evidence_capture_evidence_id_run_evidence_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."run_evidence"("evidence_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_evidence_capture" ADD CONSTRAINT "run_evidence_capture_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_evidence_capture" ADD CONSTRAINT "run_evidence_capture_tool_action_id_run_tool_action_tool_action_id_fk" FOREIGN KEY ("tool_action_id") REFERENCES "public"."run_tool_action"("tool_action_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_wait" ADD CONSTRAINT "run_wait_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_wait_one_open" ON "run_wait" USING btree ("run_id") WHERE "run_wait"."closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "run_wait_deadline" ON "run_wait" USING btree ("deadline") WHERE "run_wait"."closed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "run_work_item_run_step" ON "run_work_item" USING btree ("run_id","step_id",coalesce("subject_key",''));--> statement-breakpoint
-- A Run revision covers real row changes, including cancellation/pause and wait answers.
-- Existing commands may provide old+1; the trigger derives exactly one increment.
CREATE FUNCTION "run_revision_transition"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'revision') IS DISTINCT FROM (to_jsonb(OLD)-'revision') THEN
    NEW.revision := OLD.revision + 1;
  ELSE
    NEW.revision := OLD.revision;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_revision_transition" BEFORE UPDATE ON "audit_run"
FOR EACH ROW EXECUTE FUNCTION "run_revision_transition"();--> statement-breakpoint

CREATE FUNCTION "run_wait_close_once"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'A closed wait is immutable' USING ERRCODE='check_violation';
  END IF;
  IF NEW.wait_id IS DISTINCT FROM OLD.wait_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.options IS DISTINCT FROM OLD.options
    OR NEW.deadline IS DISTINCT FROM OLD.deadline THEN
    RAISE EXCEPTION 'Wait identity and question are immutable' USING ERRCODE='check_violation';
  END IF;
  IF NEW.closed_at IS NULL THEN
    RAISE EXCEPTION 'An open wait can only be closed' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_wait_close_once" BEFORE UPDATE ON "run_wait"
FOR EACH ROW EXECUTE FUNCTION "run_wait_close_once"();--> statement-breakpoint

CREATE FUNCTION "validate_agent_capture_binding"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Capture provenance is immutable' USING ERRCODE='check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM run_evidence e JOIN run_tool_action a ON a.tool_action_id=NEW.tool_action_id
    WHERE e.evidence_id=NEW.evidence_id AND e.run_id=NEW.run_id AND a.run_id=NEW.run_id
      AND e.kind IN ('structural-snapshot','screenshot') AND e.state='REGISTERED'
      AND a.outcome='performed' AND a.capture='PERMITTED'
      AND a.target_system=e.registration_id AND a.destination=NEW.source_location
  ) THEN
    RAISE EXCEPTION 'Capture must link registered Evidence to its permitted reading action in the same Run'
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "validate_agent_capture_binding" BEFORE INSERT OR UPDATE ON "run_evidence_capture"
FOR EACH ROW EXECUTE FUNCTION "validate_agent_capture_binding"();--> statement-breakpoint
CREATE TRIGGER "agent_capture_frozen_after_seal" AFTER INSERT OR UPDATE OR DELETE ON "run_evidence_capture"
FOR EACH ROW EXECUTE FUNCTION "run_evidence_frozen_after_seal"();--> statement-breakpoint

CREATE FUNCTION "validate_agent_turn"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'RESERVED' OR NEW.status NOT IN ('COMPLETED','FAILED')
      OR NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.sequence IS DISTINCT FROM OLD.sequence
      OR NEW.work_item_id IS DISTINCT FROM OLD.work_item_id OR NEW.step_execution_id IS DISTINCT FROM OLD.step_execution_id
      OR NEW.snapshot_evidence_id IS DISTINCT FROM OLD.snapshot_evidence_id OR NEW.reserved_tokens IS DISTINCT FROM OLD.reserved_tokens THEN
      RAISE EXCEPTION 'Model turn history is immutable after completion' USING ERRCODE='check_violation';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM run_work_item w JOIN run_step_execution s ON s.step_execution_id=NEW.step_execution_id
      JOIN run_evidence e ON e.evidence_id=NEW.snapshot_evidence_id
    WHERE w.work_item_id=NEW.work_item_id AND w.run_id=NEW.run_id
      AND s.run_id=NEW.run_id AND s.work_item_id=NEW.work_item_id
      AND e.run_id=NEW.run_id AND e.registration_id=w.registration_id
      AND e.kind='structural-snapshot' AND e.state='REGISTERED'
  ) THEN
    RAISE EXCEPTION 'Model turn scope must match its registered snapshot and Work Item' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "validate_agent_turn" BEFORE INSERT OR UPDATE ON "run_agent_turn"
FOR EACH ROW EXECUTE FUNCTION "validate_agent_turn"();--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (34);
