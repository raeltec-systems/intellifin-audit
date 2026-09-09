CREATE TABLE "run_evaluation_review_command" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"expected_review_revision" integer NOT NULL,
	"action" text NOT NULL,
	"replacement_value" text,
	"rationale" text,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"decision_id" uuid,
	"review_revision" integer,
	"result_version" integer,
	"result_outcome" text,
	"result_sealed" boolean,
	"refusal_code" text,
	"processed_at" timestamp with time zone,
	CONSTRAINT "run_evaluation_review_command_revision" CHECK ("run_evaluation_review_command"."expected_review_revision" >= 0),
	CONSTRAINT "run_evaluation_review_command_action" CHECK ("run_evaluation_review_command"."action" IN ('confirm','reject')),
	CONSTRAINT "run_evaluation_review_command_replacement" CHECK (coalesce(
    ("run_evaluation_review_command"."action" = 'confirm' AND "run_evaluation_review_command"."replacement_value" IS NULL)
    OR ("run_evaluation_review_command"."action" = 'reject' AND "run_evaluation_review_command"."replacement_value" IN ('COMPLIANT','EXCEPTION','UNEVALUATED')),
    false)),
	CONSTRAINT "run_evaluation_review_command_rationale" CHECK (coalesce(
    ("run_evaluation_review_command"."action" = 'confirm' AND "run_evaluation_review_command"."rationale" IS NULL)
    OR ("run_evaluation_review_command"."action" = 'reject' AND "run_evaluation_review_command"."rationale" IS NOT NULL AND length("run_evaluation_review_command"."rationale") BETWEEN 1 AND 4000 AND btrim("run_evaluation_review_command"."rationale") <> ''),
    false)),
	CONSTRAINT "run_evaluation_review_command_actor" CHECK (length(btrim("run_evaluation_review_command"."actor_id")) BETWEEN 1 AND 255),
	CONSTRAINT "run_evaluation_review_command_session" CHECK (length(btrim("run_evaluation_review_command"."session_id")) BETWEEN 1 AND 255),
	CONSTRAINT "run_evaluation_review_command_status" CHECK ("run_evaluation_review_command"."status" IN ('PENDING','SUCCEEDED','REFUSED')),
	CONSTRAINT "run_evaluation_review_command_completion" CHECK (coalesce((
    ("run_evaluation_review_command"."status" = 'PENDING'
      AND "run_evaluation_review_command"."decision_id" IS NULL AND "run_evaluation_review_command"."review_revision" IS NULL AND "run_evaluation_review_command"."result_version" IS NULL
      AND "run_evaluation_review_command"."result_outcome" IS NULL AND "run_evaluation_review_command"."result_sealed" IS NULL AND "run_evaluation_review_command"."refusal_code" IS NULL
      AND "run_evaluation_review_command"."processed_at" IS NULL)
    OR
    ("run_evaluation_review_command"."status" = 'SUCCEEDED'
      AND "run_evaluation_review_command"."decision_id" IS NOT NULL AND "run_evaluation_review_command"."review_revision" >= 1 AND "run_evaluation_review_command"."result_version" >= 1
      AND "run_evaluation_review_command"."result_outcome" IN ('CANCELED','RUN_FAILED','INCONCLUSIVE','PENDING_CONFIRMATION','CONTROL_FAILURE','PASS')
      AND "run_evaluation_review_command"."result_sealed" IS NOT NULL AND "run_evaluation_review_command"."refusal_code" IS NULL AND "run_evaluation_review_command"."processed_at" IS NOT NULL)
    OR
    ("run_evaluation_review_command"."status" = 'REFUSED'
      AND "run_evaluation_review_command"."decision_id" IS NULL AND "run_evaluation_review_command"."review_revision" IS NULL AND "run_evaluation_review_command"."result_version" IS NULL
      AND "run_evaluation_review_command"."result_outcome" IS NULL AND "run_evaluation_review_command"."result_sealed" IS NULL
      AND "run_evaluation_review_command"."refusal_code" IN ('malformed','unauthorized','unknown','not-completed','sealed','not-pending','stale-revision','rationale-required','invalid-replacement')
      AND "run_evaluation_review_command"."processed_at" IS NOT NULL)
  ), false))
);
--> statement-breakpoint
ALTER TABLE "run_evaluation_review_command" ADD CONSTRAINT "run_evaluation_review_command_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_evaluation_review_command" ADD CONSTRAINT "run_evaluation_review_command_evaluation_fk" FOREIGN KEY ("observation_id","condition_id") REFERENCES "public"."run_observation_evaluation"("observation_id","condition_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_evaluation_review_command_target_uidx" ON "run_evaluation_review_command" USING btree ("run_id","observation_id","condition_id","expected_review_revision") WHERE "run_evaluation_review_command"."status" = 'PENDING';--> statement-breakpoint
CREATE FUNCTION "run_evaluation_review_command_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'A terminal evaluation review command cannot be changed';
  END IF;
  IF NEW.command_id IS DISTINCT FROM OLD.command_id
    OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.observation_id IS DISTINCT FROM OLD.observation_id
    OR NEW.condition_id IS DISTINCT FROM OLD.condition_id
    OR NEW.expected_review_revision IS DISTINCT FROM OLD.expected_review_revision
    OR NEW.action IS DISTINCT FROM OLD.action
    OR NEW.replacement_value IS DISTINCT FROM OLD.replacement_value
    OR NEW.rationale IS DISTINCT FROM OLD.rationale
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
  THEN
    RAISE EXCEPTION 'An evaluation review command request is immutable';
  END IF;
  IF NEW.status NOT IN ('PENDING', 'SUCCEEDED', 'REFUSED') THEN
    RAISE EXCEPTION 'An evaluation review command has an invalid state transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_evaluation_review_command_immutable"
  BEFORE UPDATE ON "run_evaluation_review_command"
  FOR EACH ROW EXECUTE FUNCTION "run_evaluation_review_command_immutable"();--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (37);
