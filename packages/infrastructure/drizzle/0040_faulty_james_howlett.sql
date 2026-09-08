CREATE TABLE "run_observation_absence" (
	"observation_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"proof" jsonb,
	"expected_query_keys" jsonb NOT NULL,
	"digest" text NOT NULL,
	CONSTRAINT "run_observation_absence_digest" CHECK ("run_observation_absence"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "run_observation_absence_proof" CHECK ("run_observation_absence"."proof" IS NULL OR (jsonb_typeof("run_observation_absence"."proof") = 'object' AND octet_length("run_observation_absence"."proof"::text) <= 4194304)),
	CONSTRAINT "run_observation_absence_expected" CHECK (jsonb_typeof("run_observation_absence"."expected_query_keys") = 'array' AND jsonb_array_length("run_observation_absence"."expected_query_keys") <= 64 AND octet_length("run_observation_absence"."expected_query_keys"::text) <= 4194304)
);
--> statement-breakpoint
ALTER TABLE "run_observation_absence" ADD CONSTRAINT "run_observation_absence_observation_id_run_observation_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."run_observation"("observation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_observation_absence" ADD CONSTRAINT "run_observation_absence_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_observation_absence_run" ON "run_observation_absence" USING btree ("run_id");
--> statement-breakpoint
-- Provenance is captured atomically beside its absent Observation. Historical rows are
-- deliberately not backfilled, and a sealed Run cannot gain a retrospective proof.
CREATE FUNCTION run_observation_absence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Absence provenance is immutable' USING ERRCODE = '23514';
  ELSIF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM run_observation WHERE observation_id=OLD.observation_id) THEN
      RAISE EXCEPTION 'Absence provenance survives while its Observation exists' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM run_id FROM audit_run WHERE run_id=NEW.run_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM run_observation
    WHERE observation_id=NEW.observation_id AND run_id=NEW.run_id AND found='false') THEN
    RAISE EXCEPTION 'Absence provenance must name its absent Observation' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM run_evidence_package WHERE run_id=NEW.run_id) THEN
    RAISE EXCEPTION 'A sealed Run cannot acquire retrospective absence provenance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER run_observation_absence_guard BEFORE INSERT OR UPDATE OR DELETE ON run_observation_absence
FOR EACH ROW EXECUTE FUNCTION run_observation_absence_guard();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (40);
