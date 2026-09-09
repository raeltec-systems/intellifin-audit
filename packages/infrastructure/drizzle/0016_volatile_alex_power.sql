ALTER TABLE "audit_run" ADD COLUMN "request_token" uuid;
--> statement-breakpoint
-- Existing Runs predate request acknowledgement tokens; give each a unique inert identity.
UPDATE "audit_run" SET "request_token" = "run_id";
--> statement-breakpoint
ALTER TABLE "audit_run" ALTER COLUMN "request_token" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_version_owner_uidx" ON "procedure_version" USING btree ("procedure_id","version_id");
--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_version_owner_fk" FOREIGN KEY ("procedure_id","version_id") REFERENCES "public"."procedure_version"("procedure_id","version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_run_initiator_request" ON "audit_run" USING btree ("initiator_id","request_token");
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (16);
