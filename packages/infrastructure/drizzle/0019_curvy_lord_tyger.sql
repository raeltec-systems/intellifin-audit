CREATE TABLE "run_evidence" (
	"evidence_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"registration_id" text NOT NULL,
	"object_key" text NOT NULL,
	"media_type" text,
	"digest" text,
	"size" integer,
	"state" text NOT NULL,
	CONSTRAINT "run_evidence_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "run_evidence_kind" CHECK ("run_evidence"."kind" IN ('reference-source','adapter-extraction')),
	CONSTRAINT "run_evidence_digest" CHECK ("run_evidence"."digest" IS NULL OR "run_evidence"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "run_evidence_size" CHECK ("run_evidence"."size" IS NULL OR "run_evidence"."size" >= 0),
	CONSTRAINT "run_evidence_state" CHECK ("run_evidence"."state" IN ('RESERVED','REGISTERED','ABANDONED') AND ("run_evidence"."state"<>'REGISTERED' OR ("run_evidence"."digest" IS NOT NULL AND "run_evidence"."size" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "run_execution" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"run_started_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"attempt_started_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"attempt_id" uuid NOT NULL,
	"diagnostic" text,
	CONSTRAINT "run_execution_status" CHECK ("run_execution"."status" IN ('EXECUTING','RETRY','EXTRACTION_COMPLETE','TERMINAL')),
	CONSTRAINT "run_execution_counts" CHECK ("run_execution"."revision">0 AND "run_execution"."attempts">0 AND "run_execution"."attempts"<=4)
);
--> statement-breakpoint
CREATE TABLE "run_observation" (
	"observation_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"population_record_key" text NOT NULL,
	"target_system" text NOT NULL,
	"found" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"step_execution_id" uuid NOT NULL,
	"capture_method" text NOT NULL,
	"match_origin" text NOT NULL,
	"identity" jsonb,
	"attributes" jsonb NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	CONSTRAINT "run_observation_schema" CHECK ("run_observation"."schema_version" = 1),
	CONSTRAINT "run_observation_found" CHECK ("run_observation"."found" IN ('true','false','ambiguous')),
	CONSTRAINT "run_observation_capture" CHECK ("run_observation"."capture_method" IN ('agent','adapter')),
	CONSTRAINT "run_observation_origin" CHECK ("run_observation"."match_origin" IN ('platform','human-matched')),
	CONSTRAINT "run_observation_identity" CHECK (("run_observation"."found" = 'true') = ("run_observation"."identity" IS NOT NULL) AND ("run_observation"."identity" IS NULL OR jsonb_typeof("run_observation"."identity") = 'object')),
	CONSTRAINT "run_observation_attributes" CHECK (coalesce(jsonb_typeof("run_observation"."attributes") = 'array' AND jsonb_array_length("run_observation"."attributes") <= 64, false)),
	CONSTRAINT "run_observation_evidence" CHECK (coalesce(jsonb_typeof("run_observation"."evidence_ids") = 'array' AND jsonb_array_length("run_observation"."evidence_ids") BETWEEN 1 AND 16, false))
);
--> statement-breakpoint
CREATE TABLE "run_session_step" (
	"run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"registration_id" text NOT NULL,
	"display_name" text NOT NULL,
	"state" text NOT NULL,
	"attempts" integer NOT NULL,
	"diagnostic" text,
	"evidence_id" uuid,
	CONSTRAINT "run_session_step_run_id_step_id_pk" PRIMARY KEY("run_id","step_id"),
	CONSTRAINT "run_session_step_state" CHECK ("run_session_step"."state" IN ('PENDING','IN_PROGRESS','ACQUIRED','FAILED')),
	CONSTRAINT "run_session_step_counts" CHECK ("run_session_step"."ordinal">0 AND "run_session_step"."attempts">=0),
	CONSTRAINT "run_session_step_acquired" CHECK ("run_session_step"."state"<>'ACQUIRED' OR "run_session_step"."evidence_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "run_step_execution" (
	"step_execution_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"plan_step_id" text NOT NULL,
	"work_item_id" uuid,
	"action" text NOT NULL,
	"state" text NOT NULL,
	"attempt" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"diagnostic" text,
	CONSTRAINT "run_step_execution_state" CHECK ("run_step_execution"."state" IN ('RUNNING','SUCCEEDED','FAILED')),
	CONSTRAINT "run_step_execution_action" CHECK ("run_step_execution"."action" IN ('create-workspace','acquire-population','sign-in','extract-adapter','inspect-record','capture-observation','evaluate-conditions')),
	CONSTRAINT "run_step_execution_attempt" CHECK ("run_step_execution"."attempt">0)
);
--> statement-breakpoint
CREATE TABLE "run_work_item" (
	"work_item_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"registration_id" text NOT NULL,
	"display_name" text NOT NULL,
	"state" text NOT NULL,
	"attempts" integer NOT NULL,
	"cycles" integer NOT NULL,
	"diagnostic" text,
	"evidence_id" uuid,
	"observations" integer NOT NULL,
	CONSTRAINT "run_work_item_state" CHECK ("run_work_item"."state" IN ('PENDING','IN_PROGRESS','AWAITING','OBSERVED','UNINSPECTED','AMBIGUOUS','FAILED')),
	CONSTRAINT "run_work_item_counts" CHECK ("run_work_item"."ordinal">0 AND "run_work_item"."attempts">=0 AND "run_work_item"."cycles">=0 AND "run_work_item"."cycles"<=2 AND "run_work_item"."observations">=0)
);
--> statement-breakpoint
ALTER TABLE "run_evidence" ADD CONSTRAINT "run_evidence_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_execution" ADD CONSTRAINT "run_execution_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_observation" ADD CONSTRAINT "run_observation_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_observation" ADD CONSTRAINT "run_observation_work_item_id_run_work_item_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."run_work_item"("work_item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_session_step" ADD CONSTRAINT "run_session_step_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_session_step" ADD CONSTRAINT "run_session_step_evidence_id_run_evidence_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."run_evidence"("evidence_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step_execution" ADD CONSTRAINT "run_step_execution_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step_execution" ADD CONSTRAINT "run_step_execution_work_item_id_run_work_item_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."run_work_item"("work_item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_work_item" ADD CONSTRAINT "run_work_item_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_work_item" ADD CONSTRAINT "run_work_item_evidence_id_run_evidence_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."run_evidence"("evidence_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_observation_item_record" ON "run_observation" USING btree ("work_item_id","population_record_key");--> statement-breakpoint
CREATE INDEX "run_step_execution_run_idx" ON "run_step_execution" USING btree ("run_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_work_item_run_step" ON "run_work_item" USING btree ("run_id","step_id");
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (19);
