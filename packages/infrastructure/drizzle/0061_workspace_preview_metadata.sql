-- Metadata only. Preview pixels, provider capabilities and input never enter this table.
CREATE TABLE run_workspace_preview (
  run_id uuid PRIMARY KEY REFERENCES audit_run(run_id) ON DELETE CASCADE,
  workspace_revision integer NOT NULL CHECK (workspace_revision >= 0),
  runtime_id uuid NOT NULL,
  privacy_epoch integer NOT NULL CHECK (privacy_epoch >= 0),
  mode text NOT NULL CHECK (mode IN ('unavailable','public','private','closed')),
  sequence integer NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  captured_at timestamptz,
  capture_completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  CONSTRAINT run_workspace_preview_capture CHECK (
    (captured_at IS NULL AND capture_completed_at IS NULL) OR
    (mode='public' AND captured_at IS NOT NULL AND capture_completed_at IS NOT NULL AND capture_completed_at>=captured_at))
);
--> statement-breakpoint
CREATE FUNCTION guard_workspace_preview_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM run_workspace w WHERE w.run_id=NEW.run_id AND w.revision=NEW.workspace_revision AND w.mode='local' AND w.status='OPEN') THEN
    RAISE EXCEPTION 'Preview requires the current local workspace revision' USING ERRCODE='check_violation';
  END IF;
  IF TG_OP='UPDATE' AND NEW.workspace_revision=OLD.workspace_revision AND
    (NEW.runtime_id<>OLD.runtime_id OR NEW.privacy_epoch<OLD.privacy_epoch OR
      (NEW.privacy_epoch=OLD.privacy_epoch AND (NEW.mode<>OLD.mode OR NEW.sequence<OLD.sequence))) THEN
    RAISE EXCEPTION 'Preview runtime and privacy fence cannot move backwards' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_workspace_preview_metadata BEFORE INSERT OR UPDATE ON run_workspace_preview
FOR EACH ROW EXECUTE FUNCTION guard_workspace_preview_metadata();
--> statement-breakpoint
INSERT INTO schema_meta(version) VALUES (61);
