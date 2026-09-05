-- Generation 24 (Story 3.8): the Run-level Evidence Quality Gate.
--
-- `run_gate_check` holds one row per addendum §H check, written once when the last Work
-- Item completes, in the SAME transaction as the terminal Run state and the Evidence
-- package seal. Twenty rows, always: a row that found nothing is a PASS that was actually
-- evaluated, and an absent row would be indistinguishable from a row nobody wrote.
--
-- `population_snapshot.generated_at` is the snapshot's own declared generation time. §H's
-- freshness row has to name WHICH way a snapshot is unfit — stale, future-dated or unknown
-- — and the stored pass/failed boolean beside it cannot. It is nullable and it is NOT
-- backfilled: a row written before this column existed reads as "unknown", which §H makes
-- INCONCLUSIVE. That is the fail-closed direction, and inventing a generation time for a
-- snapshot nobody measured would put a fabricated fact into an audit conclusion.
--
-- The CHECKs pin the §H row vocabulary, the closed diagnostic vocabulary (by jsonb
-- containment, which refuses a number, an object and an undeclared spelling alike), the
-- PASS/FAIL-and-diagnostic agreement, and the bound on every named identity list. The
-- trigger below is here because its rule is not a CHECK: it spans time rather than a row.

CREATE TABLE "run_gate_check" (
	"run_id" uuid NOT NULL,
	"check_name" text NOT NULL,
	"outcome" text NOT NULL,
	"diagnostics" jsonb NOT NULL,
	"target_systems" jsonb NOT NULL,
	"work_items" jsonb NOT NULL,
	"records" jsonb NOT NULL,
	"total" integer NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_gate_check_run_id_check_name_pk" PRIMARY KEY("run_id","check_name"),
	CONSTRAINT "run_gate_check_name" CHECK ("run_gate_check"."check_name" IN ('workspace-access','population-acquisition','count-reconciliation-file','count-reconciliation-inclusion','empty-population','per-record-coverage','identity-corroboration','search-completeness','required-evidence','observation-corroboration','condition-completeness','extraction-completeness','schema','mandatory-values','duplicate-primary-keys','ambiguous-match','unnamed-value','snapshot-freshness','observation-freshness','integrity')),
	CONSTRAINT "run_gate_check_outcome" CHECK ("run_gate_check"."outcome" IN ('PASS','FAIL') AND coalesce(jsonb_typeof("run_gate_check"."diagnostics")='array',false) AND ("run_gate_check"."outcome"='PASS') = (jsonb_array_length("run_gate_check"."diagnostics")=0)),
	CONSTRAINT "run_gate_check_diagnostics" CHECK ("run_gate_check"."diagnostics" <@ '["session-step-failed","target-access-denied","acquisition-incomplete","declaration-absent","declaration-contradictory","declared-count-mismatch","declared-digest-mismatch","rows-unaccounted","exclusion-reason-missing","population-empty","record-uncovered","record-uninspected","record-ambiguous","identity-uncorroborated","absence-unproven","evidence-missing","observation-contradicted","condition-evaluation-missing","extraction-incomplete","acquisition-unavailable","schema-field-missing","schema-field-undeclared","mandatory-identifier-empty","mandatory-value-missing","timestamp-unparseable","duplicate-primary-key","ambiguous-match","unnamed-value","snapshot-stale","snapshot-future-dated","snapshot-generation-unknown","observation-stale","integrity-mismatch"]'::jsonb),
	CONSTRAINT "run_gate_check_affected" CHECK (coalesce(jsonb_typeof("run_gate_check"."target_systems")='array' AND jsonb_array_length("run_gate_check"."target_systems")<=32,false) AND coalesce(jsonb_typeof("run_gate_check"."work_items")='array' AND jsonb_array_length("run_gate_check"."work_items")<=32,false) AND coalesce(jsonb_typeof("run_gate_check"."records")='array' AND jsonb_array_length("run_gate_check"."records")<=32,false) AND "run_gate_check"."total">=0),
	CONSTRAINT "run_gate_check_pass_names_nothing" CHECK ("run_gate_check"."outcome"<>'PASS' OR (jsonb_array_length("run_gate_check"."target_systems")=0 AND jsonb_array_length("run_gate_check"."work_items")=0 AND jsonb_array_length("run_gate_check"."records")=0 AND "run_gate_check"."total"=0))
);
--> statement-breakpoint
ALTER TABLE "population_snapshot" ADD COLUMN "generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run_gate_check" ADD CONSTRAINT "run_gate_check_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_gate_check_run_idx" ON "run_gate_check" USING btree ("run_id","outcome");
--> statement-breakpoint
-- A Gate failure is never repaired by re-running a check.
--
-- The command already writes the rows once and reads them back before deciding, but that
-- is a habit; this is the rule. `saveGateChecks` inserts with ON CONFLICT DO NOTHING, so
-- nothing in the product needs an UPDATE — and nothing outside it may have one either.
-- DELETE is deliberately still permitted: removing a Run takes its Gate rows with it,
-- which is a different act from rewriting one row's outcome.
CREATE FUNCTION "run_gate_check_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A Gate check is decided once and cannot be changed (Run %)', OLD.run_id
    USING ERRCODE = 'raise_exception';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_gate_check_immutable" BEFORE UPDATE ON "run_gate_check"
  FOR EACH ROW EXECUTE FUNCTION "run_gate_check_immutable"();--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (24);
