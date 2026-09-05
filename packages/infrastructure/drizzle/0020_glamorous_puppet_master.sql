-- Generation 20 (Story 3.4): Observation registration.
--
-- `run_observation` gains the digest over its wire record, the coverage state derived
-- from `found` plus the absence proof, and §B's retained capture-time source. Two new
-- tables hold the per-Observation §H check outcomes and §B.1's per-condition evaluations.
--
-- The three columns are added NOT NULL WITHOUT a backfill, on purpose. A digest is
-- SHA-256 over RFC 8785 canonical JSON and SQL has no canonicalizer, so there is nothing
-- honest to backfill one with; inventing a value would give every generation-19 row a
-- digest that agrees with nothing. Generation 19 landed on this branch and has never been
-- released, so `run_observation` is empty in CI (a fresh database, migrated from 0000) and
-- in production (which has never had the table). The only place it can hold rows is a
-- developer database, where this ALTER fails loudly with "column contains null values" and
-- the fix is `DELETE FROM run_observation` — which is the fail-closed direction: refusing
-- is better than fabricating a digest for a row nobody can verify.
--
-- The statement ORDER below is load-bearing: `run_observation_evaluation`'s composite
-- foreign key references `(observation_id, coverage)`, so the unique index over those two
-- columns has to exist before the constraint that points at it. drizzle-kit emits the
-- index last; it is moved up here.
CREATE TABLE "run_observation_check" (
	"observation_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"check_name" text NOT NULL,
	"outcome" text NOT NULL,
	"diagnostic" text,
	CONSTRAINT "run_observation_check_observation_id_check_name_pk" PRIMARY KEY("observation_id","check_name"),
	CONSTRAINT "run_observation_check_name" CHECK ("run_observation_check"."check_name" IN ('identity-corroboration','search-completeness','ambiguous-match','required-evidence','freshness','observation-corroboration')),
	CONSTRAINT "run_observation_check_outcome" CHECK ("run_observation_check"."outcome" IN ('PASS','FAIL') AND ("run_observation_check"."outcome" = 'PASS') = ("run_observation_check"."diagnostic" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "run_observation_evaluation" (
	"observation_id" uuid NOT NULL,
	"coverage" text NOT NULL,
	"run_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"origin" text NOT NULL,
	"value" text NOT NULL,
	"confirmation" text,
	"confidence" numeric(7, 6),
	"rationale" text,
	"diagnostic" text,
	"evidence_ids" jsonb NOT NULL,
	CONSTRAINT "run_observation_evaluation_observation_id_condition_id_pk" PRIMARY KEY("observation_id","condition_id"),
	CONSTRAINT "run_observation_evaluation_origin" CHECK ("run_observation_evaluation"."origin" IN ('RULE','AGENT_JUDGED','HUMAN')),
	CONSTRAINT "run_observation_evaluation_value" CHECK ("run_observation_evaluation"."value" IN ('COMPLIANT','EXCEPTION','UNEVALUATED')),
	CONSTRAINT "run_observation_evaluation_confirmation" CHECK ("run_observation_evaluation"."confirmation" IS NULL OR ("run_observation_evaluation"."origin" = 'AGENT_JUDGED' AND "run_observation_evaluation"."confirmation" IN ('pending','confirmed','rejected'))),
	CONSTRAINT "run_observation_evaluation_confidence" CHECK ("run_observation_evaluation"."confidence" IS NULL OR ("run_observation_evaluation"."origin" = 'AGENT_JUDGED' AND "run_observation_evaluation"."confidence" >= 0 AND "run_observation_evaluation"."confidence" <= 1)),
	CONSTRAINT "run_observation_evaluation_coverage" CHECK ("run_observation_evaluation"."value" <> 'COMPLIANT' OR "run_observation_evaluation"."coverage" = 'COVERED'),
	CONSTRAINT "run_observation_evaluation_evidence" CHECK (coalesce(jsonb_typeof("run_observation_evaluation"."evidence_ids") = 'array' AND jsonb_array_length("run_observation_evaluation"."evidence_ids") <= 16, false))
);
--> statement-breakpoint
ALTER TABLE "run_observation" ADD COLUMN "digest" text NOT NULL;--> statement-breakpoint
ALTER TABLE "run_observation" ADD COLUMN "coverage" text NOT NULL;--> statement-breakpoint
ALTER TABLE "run_observation" ADD COLUMN "observed_at_source" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "run_observation_coverage_key" ON "run_observation" USING btree ("observation_id","coverage");--> statement-breakpoint
ALTER TABLE "run_observation" ADD CONSTRAINT "run_observation_digest" CHECK ("run_observation"."digest" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "run_observation" ADD CONSTRAINT "run_observation_coverage" CHECK ("run_observation"."coverage" IN ('COVERED','UNINSPECTED','AMBIGUOUS') AND ("run_observation"."found" = 'ambiguous') = ("run_observation"."coverage" = 'AMBIGUOUS') AND ("run_observation"."found" <> 'true' OR "run_observation"."coverage" = 'COVERED'));--> statement-breakpoint
ALTER TABLE "run_observation_check" ADD CONSTRAINT "run_observation_check_observation_id_run_observation_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."run_observation"("observation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_observation_check" ADD CONSTRAINT "run_observation_check_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ADD CONSTRAINT "run_observation_evaluation_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ADD CONSTRAINT "run_observation_evaluation_coverage_fk" FOREIGN KEY ("observation_id","coverage") REFERENCES "public"."run_observation"("observation_id","coverage") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_observation_check_run_idx" ON "run_observation_check" USING btree ("run_id","check_name");--> statement-breakpoint
CREATE INDEX "run_observation_evaluation_run_idx" ON "run_observation_evaluation" USING btree ("run_id","value");
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (20);
