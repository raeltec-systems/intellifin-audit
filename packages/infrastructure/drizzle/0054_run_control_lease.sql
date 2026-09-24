CREATE TABLE "run_control_lease" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"epoch" integer NOT NULL,
	"holder_id" text,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_control_lease_epoch" CHECK ("run_control_lease"."epoch" > 0),
	CONSTRAINT "run_control_lease_holder_expiry" CHECK (("run_control_lease"."holder_id" IS NULL) = ("run_control_lease"."expires_at" IS NULL)),
	CONSTRAINT "run_control_lease_duration" CHECK ("run_control_lease"."expires_at" IS NULL OR ("run_control_lease"."expires_at" > "run_control_lease"."updated_at" AND "run_control_lease"."expires_at" <= "run_control_lease"."updated_at" + interval '120 seconds'))
);
--> statement-breakpoint
ALTER TABLE "run_control_lease" ADD CONSTRAINT "run_control_lease_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Keep the fence after release and never reuse an old control epoch. Manager takeover
-- has no authority in this version: a live holder must release before another acquires.
CREATE FUNCTION guard_run_control_lease() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM audit_run WHERE run_id = OLD.run_id) THEN
      RAISE EXCEPTION 'Run control fencing cannot be removed' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.epoch <> 1 THEN
      RAISE EXCEPTION 'Run control starts at epoch one' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Run control identity and time are monotonic' USING ERRCODE = '23514';
  END IF;
  IF NEW.epoch = OLD.epoch THEN
    IF NOT coalesce(OLD.holder_id IS NOT NULL
      AND NEW.holder_id = OLD.holder_id
      AND NEW.updated_at < OLD.expires_at
      AND NEW.expires_at >= OLD.expires_at, false) THEN
      RAISE EXCEPTION 'Only a live holder may renew its current epoch' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.epoch = OLD.epoch + 1 THEN
    IF OLD.holder_id IS NOT NULL AND NEW.holder_id IS NOT NULL
       AND OLD.expires_at > NEW.updated_at THEN
      RAISE EXCEPTION 'A live controller must release before reacquisition' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Run control epochs advance exactly once per transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER run_control_lease_guard BEFORE INSERT OR UPDATE OR DELETE ON run_control_lease
FOR EACH ROW EXECUTE FUNCTION guard_run_control_lease();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (54);
