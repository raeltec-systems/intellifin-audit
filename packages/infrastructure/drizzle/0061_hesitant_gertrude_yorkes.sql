CREATE TABLE "run_workspace_preview" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"workspace_revision" integer NOT NULL,
	"runtime_id" uuid NOT NULL,
	"privacy_epoch" integer NOT NULL,
	"mode" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone,
	"capture_completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_workspace_preview_workspace_revision_check" CHECK ("run_workspace_preview"."workspace_revision" >= 0),
	CONSTRAINT "run_workspace_preview_privacy_epoch_check" CHECK ("run_workspace_preview"."privacy_epoch" >= 0),
	CONSTRAINT "run_workspace_preview_sequence_check" CHECK ("run_workspace_preview"."sequence" >= 0),
	CONSTRAINT "run_workspace_preview_mode_check" CHECK ("run_workspace_preview"."mode" IN ('unavailable','public','private','closed')),
	CONSTRAINT "run_workspace_preview_capture" CHECK (("run_workspace_preview"."captured_at" IS NULL AND "run_workspace_preview"."capture_completed_at" IS NULL) OR ("run_workspace_preview"."mode"='public' AND "run_workspace_preview"."captured_at" IS NOT NULL AND "run_workspace_preview"."capture_completed_at" IS NOT NULL AND "run_workspace_preview"."capture_completed_at">="run_workspace_preview"."captured_at"))
);
--> statement-breakpoint
ALTER TABLE "run_workspace_preview" ADD CONSTRAINT "run_workspace_preview_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION guard_workspace_preview_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM run_workspace w WHERE w.run_id=NEW.run_id
    AND w.workspace_id=NEW.workspace_id AND w.revision>=NEW.workspace_revision
    AND w.mode='local' AND w.status IN ('OPEN','PROVISIONING')) THEN
    RAISE EXCEPTION 'Preview requires the current local workspace identity' USING ERRCODE='check_violation';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM run_workspace w WHERE w.run_id=NEW.run_id
      AND w.revision=NEW.workspace_revision AND w.status='OPEN') THEN
      RAISE EXCEPTION 'Preview first claim requires an open workspace' USING ERRCODE='check_violation';
    END IF;
  ELSIF NEW.workspace_id=OLD.workspace_id THEN
    IF NEW.workspace_revision<>OLD.workspace_revision OR NEW.runtime_id<>OLD.runtime_id
      OR NEW.privacy_epoch<OLD.privacy_epoch
      OR (NEW.privacy_epoch=OLD.privacy_epoch AND (NEW.mode<>OLD.mode OR NEW.sequence<OLD.sequence)) THEN
      RAISE EXCEPTION 'Preview runtime and privacy fence cannot move backwards' USING ERRCODE='check_violation';
    END IF;
  ELSIF NEW.workspace_revision<=OLD.workspace_revision OR NOT EXISTS
    (SELECT 1 FROM run_workspace w WHERE w.run_id=NEW.run_id
      AND w.revision=NEW.workspace_revision AND w.status='OPEN') THEN
    RAISE EXCEPTION 'Preview replacement requires a new open workspace generation' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_workspace_preview_metadata BEFORE INSERT OR UPDATE ON run_workspace_preview
FOR EACH ROW EXECUTE FUNCTION guard_workspace_preview_metadata();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (61);
