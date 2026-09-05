CREATE TABLE "population_evidence" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"evidence_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"envelope_key" text NOT NULL,
	"raw_digest" text,
	"envelope_digest" text,
	"size" integer,
	CONSTRAINT "population_evidence_evidence_id_unique" UNIQUE("evidence_id"),
	CONSTRAINT "population_evidence_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "population_evidence_envelope_key_unique" UNIQUE("envelope_key"),
	CONSTRAINT "population_evidence_digest" CHECK ("population_evidence"."raw_digest" IS NULL OR "population_evidence"."raw_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "population_evidence_size" CHECK ("population_evidence"."size" IS NULL OR "population_evidence"."size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "population_execution" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"attempt_started_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"diagnostic" text,
	CONSTRAINT "population_execution_status" CHECK ("population_execution"."status" IN ('ACQUIRING','RETRY','POPULATION_READY','TERMINAL')),
	CONSTRAINT "population_execution_counts" CHECK ("population_execution"."revision">0 AND "population_execution"."attempts">0 AND "population_execution"."attempts"<=5)
);
--> statement-breakpoint
CREATE TABLE "population_row" (
	"run_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"values" jsonb NOT NULL,
	"disposition" text NOT NULL,
	"reasons" jsonb NOT NULL,
	CONSTRAINT "population_row_run_id_ordinal_pk" PRIMARY KEY("run_id","ordinal"),
	CONSTRAINT "population_row_disposition" CHECK ("population_row"."disposition" IN ('included','excluded','indeterminate')),
	CONSTRAINT "population_row_ordinal" CHECK ("population_row"."ordinal">0)
);
--> statement-breakpoint
CREATE TABLE "population_snapshot" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"included" integer NOT NULL,
	"excluded" integer NOT NULL,
	"indeterminate" integer NOT NULL,
	"rows_digest" text,
	"checks" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "population_evidence" ADD CONSTRAINT "population_evidence_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "population_execution" ADD CONSTRAINT "population_execution_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "population_row" ADD CONSTRAINT "population_row_run_id_population_snapshot_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."population_snapshot"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "population_snapshot" ADD CONSTRAINT "population_snapshot_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (18);

--> statement-breakpoint
ALTER TABLE "population_evidence" ADD COLUMN "state" text NOT NULL;--> statement-breakpoint
ALTER TABLE "population_execution" ADD COLUMN "step_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "population_execution" ADD COLUMN "attempt_id" uuid NOT NULL;

--> statement-breakpoint
ALTER TABLE "population_execution" DROP CONSTRAINT "population_execution_counts";--> statement-breakpoint
ALTER TABLE "population_evidence" ADD CONSTRAINT "population_evidence_state" CHECK ("population_evidence"."state" IN ('RESERVED','REGISTERED','ABANDONED') AND ("population_evidence"."state"<>'REGISTERED' OR ("population_evidence"."raw_digest" IS NOT NULL AND "population_evidence"."envelope_digest" IS NOT NULL AND "population_evidence"."size" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "population_execution" ADD CONSTRAINT "population_execution_counts" CHECK ("population_execution"."revision">0 AND "population_execution"."attempts">0 AND "population_execution"."attempts"<=4);
