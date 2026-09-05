CREATE TABLE "audit_run" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"correlation_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"procedure_name" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"state" text NOT NULL,
	"kind" text NOT NULL,
	"initiator_id" text NOT NULL,
	"session_id" text NOT NULL,
	"authorization_role" text NOT NULL,
	"initiated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_run_state" CHECK ("audit_run"."state" IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR','COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')),
	CONSTRAINT "audit_run_kind" CHECK ("audit_run"."kind" IN ('STANDARD','REGRESSION')),
	CONSTRAINT "audit_run_period" CHECK ("audit_run"."period_from" >= DATE '0001-01-01' AND "audit_run"."period_to" <= DATE '9999-12-31' AND "audit_run"."period_from" <= "audit_run"."period_to"),
	CONSTRAINT "audit_run_version" CHECK ("audit_run"."version_number" > 0),
	CONSTRAINT "audit_run_authorization" CHECK ("audit_run"."authorization_role" IN ('auditor','audit-manager')),
	CONSTRAINT "audit_run_uuid_v7" CHECK (substring("audit_run"."run_id"::text, 15, 1) = '7' AND substring("audit_run"."correlation_id"::text, 15, 1) = '7')
);
--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_procedure_id_procedure_procedure_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedure"("procedure_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_version_id_procedure_version_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."procedure_version"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_run_active_standard_period" ON "audit_run" USING btree ("procedure_id","period_from","period_to") WHERE "audit_run"."kind" = 'STANDARD' AND "audit_run"."state" IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR');
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (15);
