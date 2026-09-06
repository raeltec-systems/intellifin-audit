-- Generation 27 (PR 23 review): a sealed package's Evidence rows cannot be deleted out
-- from under it.
--
-- Generation 21 froze a sealed Run's Evidence against INSERT and UPDATE and left DELETE
-- alone deliberately, because removing a WHOLE Run is what test teardown does and is a
-- different question from rewriting an outcome. That rule is unchanged. What it did not
-- cover is narrower and is NOT "removing a whole Run": deleting a `run_evidence` or
-- `population_evidence` row while its `run_evidence_package` SURVIVES leaves the package
-- claiming registered artifacts whose metadata is gone. Nothing then notices — the
-- post-Run integrity sweep verifies exactly what `readRegisteredArtifacts` returns, and the
-- deleted artifact is no longer among them, so no read fails, no finding is recorded, and
-- the Run page goes on printing "Sealed. Every artifact this Run required is registered and
-- verified" about an artifact whose only record is gone.
--
-- So the delete is refused only WHILE the package row is still there. Removing a whole Run
-- deletes `run_evidence_package` first — it has carried a real foreign key to `audit_run`
-- since generation 21, so every teardown already must — and by then this finds no package
-- and stands down. The one act it forbids is the one with no honest reading.
--
-- `OLD` on a DELETE and `NEW` otherwise. A function that read `NEW.run_id` on a DELETE
-- would dereference NULL and fail every delete, teardown included; that is why the row is
-- chosen by `TG_OP` rather than by which of the two happens to be set.

CREATE OR REPLACE FUNCTION "run_evidence_frozen_after_seal"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  target := CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
  IF EXISTS (SELECT 1 FROM run_evidence_package WHERE run_id = target) THEN
    RAISE EXCEPTION 'Evidence for Run % is frozen: its package is sealed', target
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE TRIGGER "run_evidence_frozen_after_seal" AFTER INSERT OR UPDATE OR DELETE ON "run_evidence"
  FOR EACH ROW EXECUTE FUNCTION "run_evidence_frozen_after_seal"();--> statement-breakpoint
CREATE OR REPLACE TRIGGER "population_evidence_frozen_after_seal" AFTER INSERT OR UPDATE OR DELETE ON "population_evidence"
  FOR EACH ROW EXECUTE FUNCTION "run_evidence_frozen_after_seal"();--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (27);
