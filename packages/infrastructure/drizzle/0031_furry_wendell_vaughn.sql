ALTER TABLE "run_tool_action" DROP CONSTRAINT "run_tool_action_method";--> statement-breakpoint
ALTER TABLE "run_tool_action" ADD CONSTRAINT "run_tool_action_method" CHECK ("run_tool_action"."method" IN ('GET','HEAD','POST'));
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (31);
