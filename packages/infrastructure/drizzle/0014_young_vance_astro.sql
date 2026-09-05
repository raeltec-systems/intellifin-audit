CREATE TABLE "procedure_change" (
	"change_id" text PRIMARY KEY NOT NULL,
	"version_ids" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedure_configuration" (
	"revision" text PRIMARY KEY NOT NULL,
	"configuration" jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procedure_succession" (
	"successor_id" uuid PRIMARY KEY NOT NULL,
	"predecessor_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"activated_at" timestamp with time zone,
	"handover_at" timestamp with time zone,
	CONSTRAINT "procedure_succession_no_self" CHECK ("procedure_succession"."predecessor_id" <> "procedure_succession"."successor_id"),
	CONSTRAINT "procedure_succession_boundary" CHECK ("procedure_succession"."handover_at" IS NULL OR ("procedure_succession"."activated_at" IS NOT NULL AND "procedure_succession"."handover_at" > "procedure_succession"."activated_at"))
);
--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "lifecycle" jsonb;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "platform_origin" jsonb;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "configuration_revision" text;--> statement-breakpoint
ALTER TABLE "procedure_succession" ADD CONSTRAINT "procedure_succession_successor_id_procedure_version_version_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."procedure_version"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_succession" ADD CONSTRAINT "procedure_succession_predecessor_id_procedure_version_version_id_fk" FOREIGN KEY ("predecessor_id") REFERENCES "public"."procedure_version"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_succession" ADD CONSTRAINT "procedure_succession_procedure_id_procedure_procedure_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedure"("procedure_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_succession_activated_predecessor" ON "procedure_succession" USING btree ("predecessor_id") WHERE "procedure_succession"."activated_at" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION protect_procedure_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN ('APPROVED', 'ACTIVE', 'RETIRED') OR OLD.frozen_review IS NOT NULL THEN
    -- Explicit operational allowlist: late attempts never replace a reviewed plan.
    IF (to_jsonb(NEW) - ARRAY['state','updated_at','plan_attempts','lifecycle']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['state','updated_at','plan_attempts','lifecycle']) THEN
      RAISE EXCEPTION 'Approved Procedure Version definition is immutable';
    END IF;
    IF NEW.state <> OLD.state AND NOT ((OLD.state = 'APPROVED' AND NEW.state = 'ACTIVE') OR (OLD.state = 'ACTIVE' AND NEW.state = 'RETIRED')) THEN
      RAISE EXCEPTION 'Approved Procedure Version cannot return to authoring';
    END IF;
    IF OLD.lifecycle IS NOT NULL AND NEW.lifecycle IS DISTINCT FROM OLD.lifecycle AND NOT (OLD.state = 'APPROVED' AND NEW.state = 'ACTIVE') THEN
      RAISE EXCEPTION 'Recorded activation metadata is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER procedure_definition_immutable BEFORE UPDATE ON procedure_version FOR EACH ROW EXECUTE FUNCTION protect_procedure_definition();
--> statement-breakpoint
CREATE FUNCTION protect_procedure_succession() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM procedure_version WHERE version_id = NEW.predecessor_id AND procedure_id = NEW.procedure_id)
     OR NOT EXISTS (SELECT 1 FROM procedure_version WHERE version_id = NEW.successor_id AND procedure_id = NEW.procedure_id) THEN
    RAISE EXCEPTION 'Succession endpoints must belong to the same Procedure';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.activated_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Activated succession is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER procedure_succession_integrity BEFORE INSERT OR UPDATE ON procedure_succession FOR EACH ROW EXECUTE FUNCTION protect_procedure_succession();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (14);
