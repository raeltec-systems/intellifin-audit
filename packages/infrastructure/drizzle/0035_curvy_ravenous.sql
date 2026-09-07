ALTER TABLE "notification" DROP CONSTRAINT "notification_kind";--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "wait_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "escalation_kind" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "in_app_outcome" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "email_outcome" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "email_outcome_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_wait_id_run_wait_wait_id_fk" FOREIGN KEY ("wait_id") REFERENCES "public"."run_wait"("wait_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_escalation_context" CHECK (coalesce(
    ("notification"."kind" = 'escalation' AND "notification"."run_id" IS NOT NULL AND "notification"."wait_id" IS NOT NULL AND "notification"."escalation_kind" IN ('choose-candidate','unnamed-value','retry-or-skip') AND "notification"."deadline" IS NOT NULL)
    OR ("notification"."kind" <> 'escalation' AND "notification"."run_id" IS NULL AND "notification"."wait_id" IS NULL AND "notification"."escalation_kind" IS NULL AND "notification"."deadline" IS NULL AND "notification"."in_app_outcome" IS NULL AND "notification"."email_outcome" IS NULL AND "notification"."email_outcome_at" IS NULL), false));--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_in_app_outcome" CHECK ("notification"."in_app_outcome" IS NULL OR "notification"."in_app_outcome" IN ('delivered','unconfigured','failed','superseded'));--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_email_outcome" CHECK (("notification"."email_outcome" IS NULL AND "notification"."email_outcome_at" IS NULL) OR ("notification"."email_outcome" IS NOT NULL AND "notification"."email_outcome" IN ('delivered','unconfigured','failed','superseded') AND "notification"."email_outcome_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_kind" CHECK ("notification"."kind" IN ('submitted','approved','rejected','escalation'));
--> statement-breakpoint
-- Scope delivery tracking to the actual immutable wait and its owning procedure/version.
CREATE FUNCTION notification_escalation_binding() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'escalation' AND NOT EXISTS (
    SELECT 1 FROM run_wait w JOIN audit_run r ON r.run_id = w.run_id
    WHERE w.wait_id = NEW.wait_id AND w.run_id = NEW.run_id
      AND w.kind = NEW.escalation_kind AND w.deadline = NEW.deadline
      AND r.procedure_id = NEW.procedure_id AND r.version_id = NEW.version_id
  ) THEN
    RAISE EXCEPTION 'Escalation notification context mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER notification_escalation_binding_guard BEFORE INSERT OR UPDATE ON notification
FOR EACH ROW EXECUTE FUNCTION notification_escalation_binding();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (35);
