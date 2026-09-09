CREATE TABLE "run_initiation_request" (
	"initiator_id" text NOT NULL,
	"request_token" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	CONSTRAINT "run_initiation_request_initiator_id_request_token_pk" PRIMARY KEY("initiator_id","request_token")
);
--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD CONSTRAINT "run_initiation_request_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "run_initiation_request" ("initiator_id", "request_token", "run_id") SELECT "initiator_id", "request_token", "run_id" FROM "audit_run";
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (17);
