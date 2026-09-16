ALTER TABLE "run_workspace" DROP CONSTRAINT "run_workspace_identity_shape";--> statement-breakpoint
ALTER TABLE "run_workspace" ADD CONSTRAINT "run_workspace_identity_shape" CHECK ("run_workspace"."workspace_id" IS NULL OR (length("run_workspace"."workspace_id") BETWEEN 1 AND 4096));
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (50);
