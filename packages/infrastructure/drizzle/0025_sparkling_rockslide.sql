-- Generation 25 (Story 3.9): the sealed Result.
--
-- `run_result` holds one row per Run, written by `CompleteRun` at the terminal transition,
-- in the SAME transaction as the terminal Run state and the Evidence package seal. It
-- carries the System Outcome, the addendum §E.1 row that decided it, the Gate verdict that
-- row read, the version's own scope statement verbatim, and the published document.
--
-- The CHECKs pin the outcome vocabulary, the §E.1 row-to-outcome mapping, the
-- outcome-to-Run-state agreement, and that a `PASS` is impossible while the Gate did not
-- pass — the story's central rule stated where nothing can route around it. The triggers
-- below are here because their rules are not CHECKs: one spans rows, the other spans time.
--
-- There is NO backfill and no default, for generation 20's reason one story along: an
-- outcome is a decision over facts that were never all recorded together, and SQL cannot
-- take it. Inventing one for a Run that concluded before this generation existed would put
-- a fabricated audit conclusion into the row an auditor reads. Generations 24 and 25 are
-- unreleased, so the only Runs affected are in developer databases; a terminal one there
-- makes the trigger below refuse the next write to that Run, and the fix is to delete it.

CREATE TABLE "run_result" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"outcome" text NOT NULL,
	"outcome_row" text NOT NULL,
	"sealed" boolean NOT NULL,
	"run_state" text NOT NULL,
	"gate_passed" boolean NOT NULL,
	"sealed_at" timestamp with time zone NOT NULL,
	"scope" text,
	"publication" jsonb NOT NULL,
	CONSTRAINT "run_result_outcome" CHECK ("run_result"."outcome" IN ('CANCELED','RUN_FAILED','INCONCLUSIVE','PENDING_CONFIRMATION','CONTROL_FAILURE','PASS')),
	CONSTRAINT "run_result_row" CHECK ("run_result"."outcome_row" = CASE "run_result"."outcome" WHEN 'CANCELED' THEN 'canceled' WHEN 'RUN_FAILED' THEN 'run-failed' WHEN 'PENDING_CONFIRMATION' THEN 'pending-confirmation' WHEN 'CONTROL_FAILURE' THEN 'control-failure' WHEN 'PASS' THEN 'pass' ELSE "run_result"."outcome_row" END AND "run_result"."outcome_row" IN ('canceled','run-failed','gate-failed','pending-confirmation','unevaluated','control-failure','pass') AND ("run_result"."outcome" <> 'INCONCLUSIVE' OR "run_result"."outcome_row" IN ('gate-failed','unevaluated'))),
	CONSTRAINT "run_result_sealed" CHECK ("run_result"."sealed" = ("run_result"."outcome" <> 'PENDING_CONFIRMATION')),
	CONSTRAINT "run_result_version" CHECK ("run_result"."version" >= 1),
	CONSTRAINT "run_result_run_state" CHECK ("run_result"."run_state" IN ('COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')),
	CONSTRAINT "run_result_state_agrees" CHECK (CASE WHEN "run_result"."outcome" IN ('CANCELED','RUN_FAILED','INCONCLUSIVE') THEN "run_result"."run_state" = "run_result"."outcome" ELSE "run_result"."run_state" = 'COMPLETED' END),
	CONSTRAINT "run_result_pass_requires_gate" CHECK ("run_result"."outcome" <> 'PASS' OR "run_result"."gate_passed"),
	CONSTRAINT "run_result_scope" CHECK ("run_result"."scope" IS NULL OR length("run_result"."scope") <= 10000),
	CONSTRAINT "run_result_publication" CHECK (coalesce(jsonb_typeof("run_result"."publication")='object',false))
);
--> statement-breakpoint
ALTER TABLE "run_result" ADD CONSTRAINT "run_result_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- A sealed Result is immutable, and the outcome never changes afterwards.
--
-- UPDATE only. DELETE stays permitted: removing a whole Run takes its Result with it, which
-- is a different act from rewriting an outcome — the same line generations 21, 23 and 24
-- draw. The ONE permitted update is the sealing of the one unsealed outcome there is
-- (`PENDING_CONFIRMATION`, which §E.1 itself marks unsealed), and it must raise the version
-- by exactly one and must seal: a "sealing" that left the Result pending, or that moved the
-- version by anything else, would be an outcome changing under another name.
CREATE FUNCTION "run_result_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sealed THEN
    RAISE EXCEPTION 'A sealed Result is immutable (Run %)', OLD.run_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT NEW.sealed OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'An unsealed Result may only be sealed, once, raising its version (Run %)', OLD.run_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_result_immutable" BEFORE UPDATE ON "run_result"
  FOR EACH ROW EXECUTE FUNCTION "run_result_immutable"();--> statement-breakpoint

-- A terminal Run has a Result.
--
-- DEFERRABLE INITIALLY DEFERRED, so the order inside the terminal transaction does not
-- matter and a producer may write its state, append its events and complete last. This is
-- the forcing function behind "compute the outcome in the transaction that completes the
-- Run": a path that forgets does not ship a Run nobody can read, it fails to commit —
-- exactly as generation 21's trigger does for the Evidence package.
CREATE FUNCTION "audit_run_requires_result"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')
     AND NOT EXISTS (SELECT 1 FROM run_result WHERE run_id = NEW.run_id)
  THEN
    RAISE EXCEPTION 'Run % reached % without a sealed Result', NEW.run_id, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "audit_run_requires_result" AFTER INSERT OR UPDATE ON "audit_run"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "audit_run_requires_result"();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (25);
