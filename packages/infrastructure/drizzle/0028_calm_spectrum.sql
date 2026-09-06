CREATE TABLE "run_agent_execution" (
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
	CONSTRAINT "run_agent_execution_status" CHECK ("run_agent_execution"."status" IN ('EXECUTING','SIGNED_IN','RETRY','TERMINAL')),
	CONSTRAINT "run_agent_execution_counts" CHECK ("run_agent_execution"."revision">0 AND "run_agent_execution"."attempts">0 AND "run_agent_execution"."attempts"<=4)
);
--> statement-breakpoint
CREATE TABLE "run_tool_action" (
	"tool_action_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"step_execution_id" uuid NOT NULL,
	"work_item_id" uuid,
	"surface" text NOT NULL,
	"target_system" text NOT NULL,
	"action" text NOT NULL,
	"method" text NOT NULL,
	"destination" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"denial" text,
	"offending" text,
	"status" integer,
	"redirected" boolean NOT NULL,
	"downloads" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"diagnostic" text,
	CONSTRAINT "run_tool_action_surface" CHECK ("run_tool_action"."surface" IN ('agent','adapter')),
	CONSTRAINT "run_tool_action_outcome" CHECK ("run_tool_action"."outcome" IN ('performed','denied','failed')),
	CONSTRAINT "run_tool_action_method" CHECK ("run_tool_action"."method" IN ('GET','HEAD')),
	CONSTRAINT "run_tool_action_denial" CHECK ("run_tool_action"."denial" IS NULL OR "run_tool_action"."denial" IN ('action-not-permitted','destination-refused','origin-not-allowed','parameter-out-of-scope')),
	CONSTRAINT "run_tool_action_denied" CHECK (("run_tool_action"."outcome"='denied') = ("run_tool_action"."denial" IS NOT NULL)),
	CONSTRAINT "run_tool_action_counts" CHECK ("run_tool_action"."downloads">=0 AND ("run_tool_action"."status" IS NULL OR ("run_tool_action"."status">=100 AND "run_tool_action"."status"<=599)))
);
--> statement-breakpoint
ALTER TABLE "run_session_step" DROP CONSTRAINT "run_session_step_acquired";--> statement-breakpoint
-- Hand-edited: drizzle-kit emits a bare `ADD COLUMN ... NOT NULL`, which fails on a table
-- that already holds rows. Every existing Session Step is a Reference Source acquisition —
-- Story 4.2 is what writes the first `sign-in` row — so the default is the honest backfill
-- and it is dropped immediately, because a default here would let a later insert omit the
-- one field the ACQUIRED constraint reads.
ALTER TABLE "run_session_step" ADD COLUMN "action" text NOT NULL DEFAULT 'extract-adapter';--> statement-breakpoint
ALTER TABLE "run_session_step" ALTER COLUMN "action" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "run_agent_execution" ADD CONSTRAINT "run_agent_execution_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_tool_action" ADD CONSTRAINT "run_tool_action_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_tool_action" ADD CONSTRAINT "run_tool_action_step_execution_id_run_step_execution_step_execution_id_fk" FOREIGN KEY ("step_execution_id") REFERENCES "public"."run_step_execution"("step_execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_tool_action" ADD CONSTRAINT "run_tool_action_work_item_id_run_work_item_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."run_work_item"("work_item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_tool_action_run_idx" ON "run_tool_action" USING btree ("run_id","started_at");--> statement-breakpoint
ALTER TABLE "run_session_step" ADD CONSTRAINT "run_session_step_action" CHECK ("run_session_step"."action" IN ('sign-in','extract-adapter'));--> statement-breakpoint
ALTER TABLE "run_session_step" ADD CONSTRAINT "run_session_step_acquired" CHECK ("run_session_step"."state"<>'ACQUIRED' OR "run_session_step"."action"<>'extract-adapter' OR "run_session_step"."evidence_id" IS NOT NULL);
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (28);
