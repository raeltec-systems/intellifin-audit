-- Generation 23 (Story 3.7): the permanent Exception a deterministic evaluation raises.
--
-- One row per Observation whose evaluation recorded at least one `EXCEPTION`, written in
-- the SAME transaction as that evaluation, the Observation and the audit event that
-- carries its digest. `exception_id` is DERIVED from the Run and the Observation rather
-- than minted, so a redelivered batch reaches the row it already wrote; the unique index
-- on `observation_id` says the same thing where no command can route around it.
--
-- `fingerprint` is HMAC-SHA-256 over the RFC 8785 canonical JSON of the finding's identity
-- and `fingerprint_key_id` is retained beside it, so a rotated key still says which key
-- signed which row.
--
-- The two triggers below are here because neither rule is a CHECK: both span rows or span
-- time, which is why generation 21 reached for triggers too.
--
--   1. An Exception can never be UPDATEd. It is the durable record of a control failure;
--      rewriting one is the whole threat.
--   2. An Exception can never be DELETEd while the Observation it was raised on still
--      exists. Removing a whole Observation is a different act — it takes the record and
--      its digest with it, and the registration event still names both — so the foreign
--      key cascades and the deferred check passes at commit. Deleting only the finding
--      does not.
--
-- The delete guard is a DEFERRED CONSTRAINT trigger on purpose: a cascade from
-- `run_observation` deletes the parent first and the child after, and an immediate trigger
-- would see a row that is about to be gone.
CREATE TABLE "run_exception" (
	"exception_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"target_system" text NOT NULL,
	"population_record_key" text NOT NULL,
	"condition_ids" jsonb NOT NULL,
	"diagnostics" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"fingerprint_key_id" text NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_exception_conditions" CHECK (coalesce(jsonb_typeof("run_exception"."condition_ids") = 'array' AND jsonb_array_length("run_exception"."condition_ids") BETWEEN 1 AND 64, false)),
	CONSTRAINT "run_exception_diagnostics" CHECK (coalesce(jsonb_typeof("run_exception"."diagnostics") = 'array' AND jsonb_array_length("run_exception"."diagnostics") <= 64, false)),
	CONSTRAINT "run_exception_fingerprint" CHECK ("run_exception"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "run_exception_key_id" CHECK (length("run_exception"."fingerprint_key_id") BETWEEN 1 AND 1024)
);
--> statement-breakpoint
ALTER TABLE "run_exception" ADD CONSTRAINT "run_exception_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_exception" ADD CONSTRAINT "run_exception_observation_id_run_observation_observation_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."run_observation"("observation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_exception" ADD CONSTRAINT "run_exception_work_item_id_run_work_item_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."run_work_item"("work_item_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_exception_observation" ON "run_exception" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "run_exception_run_idx" ON "run_exception" USING btree ("run_id","raised_at");--> statement-breakpoint
CREATE INDEX "run_exception_fingerprint_idx" ON "run_exception" USING btree ("fingerprint");
--> statement-breakpoint
CREATE FUNCTION "run_exception_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'An Exception is permanent and cannot be changed';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_exception_immutable" BEFORE UPDATE ON "run_exception"
  FOR EACH ROW EXECUTE FUNCTION "run_exception_immutable"();--> statement-breakpoint
CREATE FUNCTION "run_exception_undeletable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "run_observation" WHERE "observation_id" = OLD."observation_id") THEN
    RAISE EXCEPTION 'An Exception is permanent and cannot be deleted while its Observation exists';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "run_exception_undeletable" AFTER DELETE ON "run_exception"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "run_exception_undeletable"();--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (23);
