-- Generation 22 (Story 3.6): corroboration against the stored Structural Snapshot.
--
-- `run_observation` gains the rollup of the per-attribute corroboration verdicts its own
-- `identity` and `attributes` already carry, and two CHECKs put below the command what
-- until now only a TypeScript validator said: the per-attribute verdict vocabulary, and
-- the derivation of the rollup from the attributes it claims to summarise. A row whose
-- rollup disagrees with its own data cannot be stored by a command, a migration or a psql
-- session.
--
-- `run_observation_evaluation` then carries the rollup too, and the composite foreign key
-- widens from `(observation_id, coverage)` to `(observation_id, coverage, corroboration)`.
-- That is what makes "an Observation its own stored snapshot contradicts can never be
-- Compliant" a foreign key rather than a rule in one command — the Story 3.4 shape, one
-- column along. Claiming `MATCHED` in the evaluation row does not help: the triple has to
-- exist in `run_observation`.
--
-- Unlike generation 20's digest, this column HAS an honest backfill and gets one. A digest
-- is SHA-256 over RFC 8785 canonical JSON and SQL has no canonicalizer, so there was
-- nothing truthful to write; a rollup is derived from columns that are already there, so
-- the UPDATE below computes exactly what the CHECK will then require. An existing row,
-- registered before anything corroborated, carries no verdict on any attribute and is
-- `UNJUDGED` — which is what it is.
--
-- Two orderings below are load-bearing. The unique index has to exist BEFORE the foreign
-- key that references it (drizzle-kit emits it after, and it is moved up by hand here, as
-- in generation 20). And both backfills have to run before the foreign key is added, since
-- adding one validates every existing row.
ALTER TABLE "run_observation_evaluation" DROP CONSTRAINT "run_observation_evaluation_coverage_fk";--> statement-breakpoint
DROP INDEX "run_observation_coverage_key";--> statement-breakpoint
ALTER TABLE "run_observation" ADD COLUMN "corroboration" text;--> statement-breakpoint
UPDATE "run_observation" SET "corroboration" = CASE
  WHEN jsonb_path_exists(coalesce("identity",'null'::jsonb), '$.corroboration ? (@ == "contradictory")')
    OR jsonb_path_exists("attributes", '$[*].corroboration ? (@ == "contradictory")') THEN 'CONTRADICTORY'
  WHEN jsonb_path_exists(coalesce("identity",'null'::jsonb), '$.corroboration ? (@.type() == "string")')
    OR jsonb_path_exists("attributes", '$[*].corroboration ? (@.type() == "string")') THEN 'MATCHED'
  ELSE 'UNJUDGED' END;--> statement-breakpoint
ALTER TABLE "run_observation" ALTER COLUMN "corroboration" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ADD COLUMN "corroboration" text;--> statement-breakpoint
UPDATE "run_observation_evaluation" e SET "corroboration" = o."corroboration"
  FROM "run_observation" o WHERE o."observation_id" = e."observation_id";--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ALTER COLUMN "corroboration" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "run_observation_coverage_key" ON "run_observation" USING btree ("observation_id","coverage","corroboration");--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ADD CONSTRAINT "run_observation_evaluation_coverage_fk" FOREIGN KEY ("observation_id","coverage","corroboration") REFERENCES "public"."run_observation"("observation_id","coverage","corroboration") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_observation" ADD CONSTRAINT "run_observation_attribute_corroboration" CHECK (NOT jsonb_path_exists(coalesce("run_observation"."identity",'null'::jsonb), '$.corroboration ? (@.type() != "null" && (@.type() != "string" || (@ != "matched" && @ != "contradictory" && @ != "model-read")))') AND NOT jsonb_path_exists("run_observation"."attributes", '$[*].corroboration ? (@.type() != "null" && (@.type() != "string" || (@ != "matched" && @ != "contradictory" && @ != "model-read")))'));--> statement-breakpoint
ALTER TABLE "run_observation" ADD CONSTRAINT "run_observation_corroboration" CHECK ("run_observation"."corroboration" IN ('MATCHED','CONTRADICTORY','UNJUDGED'));--> statement-breakpoint
ALTER TABLE "run_observation" ADD CONSTRAINT "run_observation_corroboration_state" CHECK ("run_observation"."corroboration" = CASE WHEN jsonb_path_exists(coalesce("run_observation"."identity",'null'::jsonb), '$.corroboration ? (@ == "contradictory")') OR jsonb_path_exists("run_observation"."attributes", '$[*].corroboration ? (@ == "contradictory")') THEN 'CONTRADICTORY' WHEN jsonb_path_exists(coalesce("run_observation"."identity",'null'::jsonb), '$.corroboration ? (@.type() == "string")') OR jsonb_path_exists("run_observation"."attributes", '$[*].corroboration ? (@.type() == "string")') THEN 'MATCHED' ELSE 'UNJUDGED' END);--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ADD CONSTRAINT "run_observation_evaluation_corroboration" CHECK ("run_observation_evaluation"."corroboration" IN ('MATCHED','CONTRADICTORY','UNJUDGED') AND ("run_observation_evaluation"."value" <> 'COMPLIANT' OR "run_observation_evaluation"."corroboration" <> 'CONTRADICTORY'));
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (22);
