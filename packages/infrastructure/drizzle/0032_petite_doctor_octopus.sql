-- Generation 32 (owner decisions, 2026-09-06).
--
-- Three of the five decisions need storage, and they are one migration because they are one
-- release:
--
--  * `run_initiation_request` becomes a record of what a token was DECIDED to mean, so a
--    replayed request answers the same thing every time and never walks a caller into a Run
--    they did not initiate.
--  * `run_evidence` and `population_evidence` gain FR-31's capture provenance, per artifact.
--  * `population_snapshot` gains the declared and retrieved record counts, so the §H
--    reconciliation can be shown as two numbers rather than as a pass/fail word.
--
-- Every backfill here is HONEST or absent. A capture time nobody measured and no Step
-- Execution can be attributed to stays NULL, exactly as generation 20 refused to backfill a
-- digest and generation 24 refused to default a snapshot's generation time to `now()`.

-- ---------------------------------------------------------------- request decisions ---
-- Added nullable first: `NOT NULL` on a column an existing row has no value for fails the
-- whole migration, and with it the release.
ALTER TABLE "run_initiation_request" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD COLUMN "procedure_id" uuid;--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD COLUMN "period_from" date;--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD COLUMN "period_to" date;--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD COLUMN "refusal" text;--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD COLUMN "refused_run_id" uuid;--> statement-breakpoint

-- The SUBJECT of an existing token, from the Run it was bound to. That is exactly what the
-- old `replay` read to decide `RUN_TOKEN_REUSED`, so this preserves each existing token's
-- meaning rather than inventing one.
UPDATE "run_initiation_request" r
SET "procedure_id" = a."procedure_id", "period_from" = a."period_from", "period_to" = a."period_to"
FROM "audit_run" a
WHERE a."run_id" = r."run_id";--> statement-breakpoint

-- A row whose bound Run was created by SOMEBODY ELSE, or by this caller under a different
-- token, was never a record of a Run this request created: it is the acknowledgement the old
-- code wrote when it refused the request because an active Run already held the Procedure and
-- period. `{ok: false, reason: RUN_ALREADY_ACTIVE, existingRunId}` is literally what that
-- request was answered with, so recording it as that refusal states what happened. What
-- changes is only what a REPLAY of it now returns, which is the decision.
UPDATE "run_initiation_request" r
SET "run_id" = NULL, "refusal" = 'already-active', "refused_run_id" = r."run_id"
FROM "audit_run" a
WHERE a."run_id" = r."run_id"
  AND (a."initiator_id" IS DISTINCT FROM r."initiator_id" OR a."request_token" IS DISTINCT FROM r."request_token");--> statement-breakpoint

ALTER TABLE "run_initiation_request" ALTER COLUMN "procedure_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_initiation_request" ALTER COLUMN "period_from" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_initiation_request" ALTER COLUMN "period_to" SET NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------- capture provenance ---
ALTER TABLE "population_evidence" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "population_evidence" ADD COLUMN "capture_method" text;--> statement-breakpoint
ALTER TABLE "population_evidence" ADD COLUMN "capture_time_source" text;--> statement-breakpoint
ALTER TABLE "run_evidence" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run_evidence" ADD COLUMN "capture_method" text;--> statement-breakpoint
ALTER TABLE "run_evidence" ADD COLUMN "capture_time_source" text;--> statement-breakpoint

-- Release-only metadata enrichment. Drizzle runs the migration inside one transaction.
-- Exclusive locks prevent a concurrent application write while only these two named
-- guards are suspended. Rollback restores the guards; no runtime bypass is introduced.
LOCK TABLE "run_evidence", "population_evidence" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "run_evidence" DISABLE TRIGGER "run_evidence_frozen_after_seal";--> statement-breakpoint
ALTER TABLE "population_evidence" DISABLE TRIGGER "population_evidence_frozen_after_seal";--> statement-breakpoint

-- The capture METHOD of every existing row is `adapter`, and that is structural rather than a
-- guess: `run_evidence_kind` admits only `reference-source` and `adapter-extraction`, both of
-- which are written exclusively by the adapter stage, and `population_evidence` has exactly
-- one writer, which is population acquisition. No agent path has ever registered an artifact.
UPDATE "run_evidence" SET "capture_method" = 'adapter' WHERE "capture_method" IS NULL;--> statement-breakpoint
UPDATE "population_evidence" SET "capture_method" = 'adapter' WHERE "capture_method" IS NULL;--> statement-breakpoint

-- The capture TIME of an existing `run_evidence` row is RECOVERED, not measured: an artifact
-- is uploaded, verified and registered inside the Step Execution that produced it, so that
-- step's completion is a real instant for these bytes. It is marked `step-execution` so a
-- reader can tell it from one measured at registration, and only a REGISTERED artifact gets
-- one — a reservation nothing was written to captured nothing.
UPDATE "run_evidence" e
SET "captured_at" = s."completed_at", "capture_time_source" = 'step-execution'
FROM (
  SELECT p."evidence_id", max(x."completed_at") AS "completed_at"
  FROM (
    SELECT w."evidence_id" AS "evidence_id", w."run_id" AS "run_id", w."step_id" AS "step_id"
    FROM "run_work_item" w WHERE w."evidence_id" IS NOT NULL
    UNION ALL
    SELECT n."evidence_id" AS "evidence_id", n."run_id" AS "run_id", n."step_id" AS "step_id"
    FROM "run_session_step" n WHERE n."evidence_id" IS NOT NULL
  ) p
  JOIN "run_step_execution" x
    ON x."run_id" = p."run_id" AND x."plan_step_id" = p."step_id" AND x."completed_at" IS NOT NULL
  GROUP BY p."evidence_id"
) s
WHERE s."evidence_id" = e."evidence_id"
  AND e."state" = 'REGISTERED'
  AND e."captured_at" IS NULL;--> statement-breakpoint

-- `population_evidence.captured_at` is DELIBERATELY not backfilled. Nothing recorded when the
-- population artifact was captured and no Step Execution produced it — that is the gap this
-- generation closes going forward, and a number invented for it would be a fact nobody
-- measured entering an immutable record. Those rows keep saying so, in words, on the surface.

ALTER TABLE "run_evidence" ENABLE TRIGGER "run_evidence_frozen_after_seal";--> statement-breakpoint
ALTER TABLE "population_evidence" ENABLE TRIGGER "population_evidence_frozen_after_seal";--> statement-breakpoint

-- ------------------------------------------------------------ reconciliation counts ---
ALTER TABLE "population_snapshot" ADD COLUMN "declared_count" integer;--> statement-breakpoint
ALTER TABLE "population_snapshot" ADD COLUMN "retrieved_count" integer;--> statement-breakpoint

-- Exact, not estimated: `includePopulation` maps every parsed row to exactly one row and the
-- three dispositions partition them, so this IS the number of records retrieved. The CHECK
-- below then pins that identity for every row, old and new.
UPDATE "population_snapshot"
SET "retrieved_count" = "included" + "excluded" + "indeterminate"
WHERE "retrieved_count" IS NULL;--> statement-breakpoint
ALTER TABLE "population_snapshot" ALTER COLUMN "retrieved_count" SET NOT NULL;--> statement-breakpoint

-- `declared_count` is NOT backfilled. The declaration lives inside the frozen acquisition
-- envelope in object storage, which SQL cannot read; writing the retrieved count in its place
-- would make every unreconciled population look reconciled, which is the one thing this
-- column exists to prevent.

-- ------------------------------------------------------------------------ constraints ---
ALTER TABLE "run_initiation_request" ADD CONSTRAINT "run_initiation_request_refused_run_id_audit_run_run_id_fk" FOREIGN KEY ("refused_run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "population_evidence" ADD CONSTRAINT "population_evidence_capture_method" CHECK ("population_evidence"."capture_method" IS NULL OR "population_evidence"."capture_method" IN ('agent','adapter'));--> statement-breakpoint
ALTER TABLE "population_evidence" ADD CONSTRAINT "population_evidence_capture_time" CHECK (("population_evidence"."captured_at" IS NULL) = ("population_evidence"."capture_time_source" IS NULL) AND ("population_evidence"."capture_time_source" IS NULL OR "population_evidence"."capture_time_source" IN ('registration','step-execution')));--> statement-breakpoint
ALTER TABLE "population_snapshot" ADD CONSTRAINT "population_snapshot_counts" CHECK ("population_snapshot"."included" >= 0 AND "population_snapshot"."excluded" >= 0 AND "population_snapshot"."indeterminate" >= 0 AND "population_snapshot"."retrieved_count" >= 0 AND ("population_snapshot"."declared_count" IS NULL OR "population_snapshot"."declared_count" >= 0));--> statement-breakpoint
ALTER TABLE "population_snapshot" ADD CONSTRAINT "population_snapshot_retrieved" CHECK ("population_snapshot"."retrieved_count" = "population_snapshot"."included" + "population_snapshot"."excluded" + "population_snapshot"."indeterminate");--> statement-breakpoint
ALTER TABLE "run_evidence" ADD CONSTRAINT "run_evidence_capture_method" CHECK ("run_evidence"."capture_method" IS NULL OR "run_evidence"."capture_method" IN ('agent','adapter'));--> statement-breakpoint
ALTER TABLE "run_evidence" ADD CONSTRAINT "run_evidence_capture_time" CHECK (("run_evidence"."captured_at" IS NULL) = ("run_evidence"."capture_time_source" IS NULL) AND ("run_evidence"."capture_time_source" IS NULL OR "run_evidence"."capture_time_source" IN ('registration','step-execution')));--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD CONSTRAINT "run_initiation_request_decision" CHECK (("run_initiation_request"."run_id" IS NULL) <> ("run_initiation_request"."refusal" IS NULL));--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD CONSTRAINT "run_initiation_request_refusal" CHECK ("run_initiation_request"."refusal" IS NULL OR "run_initiation_request"."refusal" IN ('already-active','no-owner','predecessor-active'));--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD CONSTRAINT "run_initiation_request_refused_run" CHECK ("run_initiation_request"."refused_run_id" IS NULL OR "run_initiation_request"."refusal" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "run_initiation_request" ADD CONSTRAINT "run_initiation_request_period" CHECK ("run_initiation_request"."period_from" <= "run_initiation_request"."period_to");--> statement-breakpoint

-- The generation this migration establishes. Bumped in the same commit as
-- `SUPPORTED_SCHEMA_MIN`/`MAX` in `packages/infrastructure/src/db/compat.ts`; a build whose
-- range does not match its own migrations is a startup guard turned into a delayed crash,
-- and `db/schema-range.test.ts` fails when the two disagree.
INSERT INTO "schema_meta" ("version") VALUES (32);
