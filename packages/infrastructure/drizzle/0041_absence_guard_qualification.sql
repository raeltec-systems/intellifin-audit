-- Generation40 is already published. Replace only its trigger function, leaving every
-- existing Observation, proof, digest and sealed package untouched. PostgreSQL's PL/pgSQL
-- FOUND variable conflicts with an unqualified found column; qualify all relation columns.
CREATE OR REPLACE FUNCTION run_observation_absence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Absence provenance is immutable' USING ERRCODE = '23514';
  ELSIF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM run_observation AS o WHERE o.observation_id=OLD.observation_id) THEN
      RAISE EXCEPTION 'Absence provenance survives while its Observation exists' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM r.run_id FROM audit_run AS r WHERE r.run_id=NEW.run_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM run_observation AS o
    WHERE o.observation_id=NEW.observation_id AND o.run_id=NEW.run_id AND o.found='false') THEN
    RAISE EXCEPTION 'Absence provenance must name its absent Observation' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM run_evidence_package AS p WHERE p.run_id=NEW.run_id) THEN
    RAISE EXCEPTION 'A sealed Run cannot acquire retrospective absence provenance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (41);
