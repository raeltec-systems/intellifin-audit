-- Hand-edited: drizzle-kit emits a bare `ADD COLUMN ... NOT NULL`, which fails on a table
-- that already holds rows. There IS an honest backfill here, unlike generation 20's digest:
-- the Step Execution a Tool Action belongs to records its own action, and a Tool Action
-- inside a `sign-in` Step Execution is one that presented a credential — the only credential
-- this build presents to a browser. So the value is DERIVED from a stored column rather
-- than assumed from what the code happened to do when the migration was written.
ALTER TABLE "run_tool_action" ADD COLUMN "capture" text;--> statement-breakpoint
ALTER TABLE "run_tool_action" ADD COLUMN "capture_suppression" text;--> statement-breakpoint
UPDATE "run_tool_action" AS a
   SET "capture" = 'SUPPRESSED', "capture_suppression" = 'credential-entry'
  FROM "run_step_execution" AS e
 WHERE e."step_execution_id" = a."step_execution_id" AND e."action" = 'sign-in';--> statement-breakpoint
UPDATE "run_tool_action" SET "capture" = 'PERMITTED' WHERE "capture" IS NULL;--> statement-breakpoint
ALTER TABLE "run_tool_action" ALTER COLUMN "capture" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_tool_action" ADD CONSTRAINT "run_tool_action_capture" CHECK ("run_tool_action"."capture" IN ('PERMITTED','SUPPRESSED'));--> statement-breakpoint
ALTER TABLE "run_tool_action" ADD CONSTRAINT "run_tool_action_capture_reason" CHECK ("run_tool_action"."capture_suppression" IS NULL OR "run_tool_action"."capture_suppression" IN ('credential-entry'));--> statement-breakpoint
ALTER TABLE "run_tool_action" ADD CONSTRAINT "run_tool_action_capture_suppressed" CHECK (("run_tool_action"."capture"='SUPPRESSED') = ("run_tool_action"."capture_suppression" IS NOT NULL));
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (29);
