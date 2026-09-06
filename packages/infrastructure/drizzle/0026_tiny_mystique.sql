-- Generation 26 (Story 3.10): cancellation requests and the rerun link.
--
-- Six columns on `audit_run` and no new table. A cancellation is one person's durable
-- request that a Run stop: the actor, the session they asked from, the time and the
-- reason. A rerun link is the terminal Run a new Run follows and the reason it exists.
--
-- The four cancellation columns are written whole or not at all, because the Canceled Run
-- Detail state states the actor, the time and the reason, and three of four is a row that
-- can say none of them. `(a IS NULL) = (b IS NULL)` is boolean = boolean and is never
-- NULL: a CHECK that evaluated to NULL would PASS, which is the trap `array_length` set
-- in generation 5 and `<> ALL` set in generation 7.
--
-- `predecessor_run_id` is a real self-referencing foreign key with NO ON DELETE action:
-- a Run whose successor names it must not be removable while the link is the only record
-- of why the successor exists. Nothing in this product deletes a Run.
--
-- There is deliberately NO constraint tying a cancellation request to a state. A Run whose
-- cancellation was requested and which then hit a limit first ends INCONCLUSIVE with the
-- request still recorded, and that is the truth about it: somebody asked, and the Run
-- ended another way before the worker reached its next boundary.

ALTER TABLE "audit_run" ADD COLUMN "predecessor_run_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "rerun_reason" text;--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "cancel_requested_by" text;--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "cancel_requested_session" text;--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_predecessor_run_id_audit_run_run_id_fk" FOREIGN KEY ("predecessor_run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_cancel_request" CHECK (("audit_run"."cancel_requested_at" IS NULL) = ("audit_run"."cancel_requested_by" IS NULL) AND ("audit_run"."cancel_requested_at" IS NULL) = ("audit_run"."cancel_requested_session" IS NULL) AND ("audit_run"."cancel_requested_at" IS NULL) = ("audit_run"."cancel_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_cancel_reason" CHECK ("audit_run"."cancel_reason" IS NULL OR (length("audit_run"."cancel_reason") BETWEEN 1 AND 500));--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_rerun_link" CHECK (("audit_run"."predecessor_run_id" IS NULL) = ("audit_run"."rerun_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_rerun_reason" CHECK ("audit_run"."rerun_reason" IS NULL OR (length("audit_run"."rerun_reason") BETWEEN 1 AND 500));--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_rerun_not_self" CHECK ("audit_run"."predecessor_run_id" IS NULL OR "audit_run"."predecessor_run_id" <> "audit_run"."run_id");--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (26);
