-- Generation 46 (Story 5.5): an Auditor flags a Run to the Audit Managers.
--
-- `run_flag` is NOT a `run_wait`. Every mechanism that table gives a wait exists to end a
-- Run that is being HELD, and a flag holds nothing: it changes no state, has no deadline
-- and is answered by nobody. `run_wait_one_open` would also have made flagging a Run
-- mutually exclusive with pausing it, which nothing asks for.
--
-- `flagged_by` carries NO foreign key, exactly as `audit_run.initiator_id` does: a key
-- there would make deleting a user fail on a Run's own history.
--
-- `notification_escalation_context` becomes `notification_context` with three arms — one
-- per kind this table now holds. The rename is the point: the old name described one of
-- the two Run notifications FR-28 defines.

CREATE TABLE "run_flag" (
	"flag_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"flagged_by" text NOT NULL,
	"session_id" text NOT NULL,
	"flagged_at" timestamp with time zone NOT NULL,
	"note" text,
	CONSTRAINT "run_flag_note" CHECK ("run_flag"."note" IS NULL OR (btrim("run_flag"."note") <> '' AND length("run_flag"."note") <= 500))
);
--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_escalation_context";--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_kind";--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "flag_id" uuid;--> statement-breakpoint
ALTER TABLE "run_flag" ADD CONSTRAINT "run_flag_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_flag_run_idx" ON "run_flag" USING btree ("run_id","flagged_at","flag_id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_flag_id_run_flag_flag_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."run_flag"("flag_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_context" CHECK (coalesce(
    ("notification"."kind" = 'escalation' AND "notification"."run_id" IS NOT NULL AND "notification"."wait_id" IS NOT NULL AND "notification"."flag_id" IS NULL AND "notification"."escalation_kind" IN ('choose-candidate','unnamed-value','retry-or-skip') AND "notification"."deadline" IS NOT NULL)
    OR ("notification"."kind" = 'flag' AND "notification"."run_id" IS NOT NULL AND "notification"."wait_id" IS NULL AND "notification"."flag_id" IS NOT NULL AND "notification"."escalation_kind" IS NULL AND "notification"."deadline" IS NULL)
    OR ("notification"."kind" NOT IN ('escalation','flag') AND "notification"."run_id" IS NULL AND "notification"."wait_id" IS NULL AND "notification"."flag_id" IS NULL AND "notification"."escalation_kind" IS NULL AND "notification"."deadline" IS NULL AND "notification"."in_app_outcome" IS NULL AND "notification"."email_outcome" IS NULL AND "notification"."email_outcome_at" IS NULL), false));--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_kind" CHECK ("notification"."kind" IN ('submitted','approved','rejected','escalation','flag'));
--> statement-breakpoint
CREATE FUNCTION "run_flag_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A Run flag is permanent and cannot be changed';
END;
$$;--> statement-breakpoint
-- UPDATE only. A flag DELETEs with its Run, the reading that already lets a whole Run be
-- removed: taking a Run away is a different act from rewriting one record of it.
CREATE TRIGGER "run_flag_immutable" BEFORE UPDATE ON "run_flag"
  FOR EACH ROW EXECUTE FUNCTION "run_flag_immutable"();--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (46);
