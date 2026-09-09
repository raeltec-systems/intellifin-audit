ALTER TABLE "run_evidence" DROP CONSTRAINT "run_evidence_kind";--> statement-breakpoint
ALTER TABLE "run_evidence" ADD CONSTRAINT "run_evidence_kind" CHECK ("run_evidence"."kind" IN ('reference-source','adapter-extraction','structural-snapshot','screenshot'));--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (33);
