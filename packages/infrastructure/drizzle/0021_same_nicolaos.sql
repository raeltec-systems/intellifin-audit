-- Generation 21 (Story 3.5): the sealed Evidence package.
--
-- Two new tables and one new column, plus the four rules a command must not be able to
-- route around. Everything a CHECK can say is said as a CHECK; the three cross-row rules
-- are constraint triggers, which is the only mechanism PostgreSQL offers for an invariant
-- that spans rows, and each of them is a rule this story exists to guarantee:
--
--   1. a Run may not reach a terminal state without a sealed Evidence package;
--   2. a SEALED package may not exist while a required artifact of that Run is
--      unregistered;
--   3. once a package row exists, that Run's Evidence rows are frozen, and the package row
--      itself can never be updated.
--
-- The `required` column is BACKFILLED rather than added bare, because there is an honest
-- value to backfill it with: `isRequiredArtifact` in
-- `packages/domain/src/runs/evidence.ts` says a population and a Reference Source are
-- required and an adapter extraction is not, which is exactly the expression below. That
-- is the difference from generation 20's digest column, where SQL had no canonicalizer and
-- the only honest option was to fail loudly.
ALTER TABLE "population_evidence" ADD COLUMN "required" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "population_evidence" ALTER COLUMN "required" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "run_evidence" ADD COLUMN "required" boolean NOT NULL DEFAULT false;--> statement-breakpoint
UPDATE "run_evidence" SET "required" = ("kind" = 'reference-source');--> statement-breakpoint
ALTER TABLE "run_evidence" ALTER COLUMN "required" DROP DEFAULT;--> statement-breakpoint
CREATE TABLE "run_evidence_integrity" (
	"finding_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"finding" text NOT NULL,
	"expected_digest" text NOT NULL,
	"observed_digest" text,
	"expected_size" integer,
	"observed_size" integer,
	"detected_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_evidence_integrity_finding" CHECK ("run_evidence_integrity"."finding" IN ('object-missing','size-mismatch','digest-mismatch')),
	CONSTRAINT "run_evidence_integrity_digest" CHECK ("run_evidence_integrity"."expected_digest" ~ '^[0-9a-f]{64}$' AND ("run_evidence_integrity"."observed_digest" IS NULL OR "run_evidence_integrity"."observed_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "run_evidence_integrity_size" CHECK (("run_evidence_integrity"."expected_size" IS NULL OR "run_evidence_integrity"."expected_size">=0) AND ("run_evidence_integrity"."observed_size" IS NULL OR "run_evidence_integrity"."observed_size">=0)),
	CONSTRAINT "run_evidence_integrity_observed" CHECK (("run_evidence_integrity"."finding"='object-missing') = ("run_evidence_integrity"."observed_digest" IS NULL AND "run_evidence_integrity"."observed_size" IS NULL)),
	CONSTRAINT "run_evidence_integrity_disagrees" CHECK (("run_evidence_integrity"."finding"<>'digest-mismatch' OR "run_evidence_integrity"."observed_digest" IS DISTINCT FROM "run_evidence_integrity"."expected_digest") AND ("run_evidence_integrity"."finding"<>'size-mismatch' OR ("run_evidence_integrity"."observed_size" IS NOT NULL AND "run_evidence_integrity"."expected_size" IS NOT NULL AND "run_evidence_integrity"."observed_size" <> "run_evidence_integrity"."expected_size")))
);
--> statement-breakpoint
CREATE TABLE "run_evidence_package" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"run_state" text NOT NULL,
	"sealed_at" timestamp with time zone NOT NULL,
	"required_total" integer NOT NULL,
	"registered" integer NOT NULL,
	"missing_required" jsonb NOT NULL,
	"abandoned" jsonb NOT NULL,
	CONSTRAINT "run_evidence_package_state" CHECK ("run_evidence_package"."state" IN ('SEALED','INCOMPLETE')),
	CONSTRAINT "run_evidence_package_run_state" CHECK ("run_evidence_package"."run_state" IN ('COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')),
	CONSTRAINT "run_evidence_package_counts" CHECK ("run_evidence_package"."required_total">=0 AND "run_evidence_package"."registered">=0),
	CONSTRAINT "run_evidence_package_shape" CHECK (coalesce(jsonb_typeof("run_evidence_package"."missing_required")='array',false) AND coalesce(jsonb_typeof("run_evidence_package"."abandoned")='array',false)),
	CONSTRAINT "run_evidence_package_complete" CHECK (("run_evidence_package"."state"='SEALED') = (jsonb_typeof("run_evidence_package"."missing_required")='array' AND jsonb_array_length("run_evidence_package"."missing_required")=0))
);
--> statement-breakpoint
ALTER TABLE "run_evidence_integrity" ADD CONSTRAINT "run_evidence_integrity_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_evidence_package" ADD CONSTRAINT "run_evidence_package_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_evidence_integrity_artifact" ON "run_evidence_integrity" USING btree ("evidence_id","object_key","finding");--> statement-breakpoint
ALTER TABLE "population_evidence" ADD CONSTRAINT "population_evidence_abandoned" CHECK ("population_evidence"."state"<>'ABANDONED' OR "population_evidence"."raw_digest" IS NULL);--> statement-breakpoint
ALTER TABLE "run_evidence" ADD CONSTRAINT "run_evidence_abandoned" CHECK ("run_evidence"."state"<>'ABANDONED' OR "run_evidence"."digest" IS NULL);--> statement-breakpoint

-- Rule 2: a SEALED package while a required artifact is unregistered.
--
-- Checked at INSERT, which is the only way a package row is ever written (rule 3 refuses
-- every UPDATE). `SealPackage` abandons every open reservation BEFORE it inserts, so by
-- the time this runs the artifacts are settled and an unregistered required one is a real
-- gap, not a pending upload.
CREATE FUNCTION "run_evidence_package_sealable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'SEALED' AND (
       EXISTS (SELECT 1 FROM run_evidence
               WHERE run_id = NEW.run_id AND required AND state <> 'REGISTERED')
       OR EXISTS (SELECT 1 FROM population_evidence
                  WHERE run_id = NEW.run_id AND required AND state <> 'REGISTERED'))
  THEN
    RAISE EXCEPTION 'Evidence package for Run % cannot be SEALED: a required artifact is not REGISTERED', NEW.run_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_evidence_package_sealable" AFTER INSERT ON "run_evidence_package"
  FOR EACH ROW EXECUTE FUNCTION "run_evidence_package_sealable"();--> statement-breakpoint

-- Rule 3a: a sealed package is immutable.
--
-- UPDATE only. A DELETE is how a whole Run is removed (test teardown does exactly that,
-- and removing a Run is governed by whether its rows may be deleted at all, not by this
-- story); an UPDATE is how a sealed outcome would be rewritten, and that is what "no later
-- mutation can change a sealed outcome" forbids.
CREATE FUNCTION "run_evidence_package_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A sealed Evidence package is immutable (Run %)', OLD.run_id
    USING ERRCODE = 'check_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_evidence_package_immutable" BEFORE UPDATE ON "run_evidence_package"
  FOR EACH ROW EXECUTE FUNCTION "run_evidence_package_immutable"();--> statement-breakpoint

-- Rule 3b: once the package is sealed, the Run's Evidence rows are frozen.
--
-- Not deferred, deliberately. `SealPackage` abandons and THEN inserts the package row, so
-- inside the sealing transaction these updates see no package row and are allowed; every
-- later transaction sees one and is refused. A registered artifact appearing after the
-- seal would make "abandoned" a lie about the same artifact.
CREATE FUNCTION "run_evidence_frozen_after_seal"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM run_evidence_package WHERE run_id = NEW.run_id) THEN
    RAISE EXCEPTION 'Evidence for Run % is frozen: its package is sealed', NEW.run_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_evidence_frozen_after_seal" AFTER INSERT OR UPDATE ON "run_evidence"
  FOR EACH ROW EXECUTE FUNCTION "run_evidence_frozen_after_seal"();--> statement-breakpoint
CREATE TRIGGER "population_evidence_frozen_after_seal" AFTER INSERT OR UPDATE ON "population_evidence"
  FOR EACH ROW EXECUTE FUNCTION "run_evidence_frozen_after_seal"();--> statement-breakpoint

-- Rule 1: a terminal Run has a sealed Evidence package.
--
-- DEFERRABLE INITIALLY DEFERRED, so the order inside the terminal transaction does not
-- matter and a producer may write its state, append its event and seal last. This is the
-- forcing function for "run SealPackage on EVERY terminal transition": a path that forgets
-- it does not ship a Run with an unsealed package, it fails to commit.
CREATE FUNCTION "audit_run_requires_seal"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')
     AND NOT EXISTS (SELECT 1 FROM run_evidence_package WHERE run_id = NEW.run_id)
  THEN
    RAISE EXCEPTION 'Run % reached % without a sealed Evidence package', NEW.run_id, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "audit_run_requires_seal" AFTER INSERT OR UPDATE ON "audit_run"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "audit_run_requires_seal"();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (21);
