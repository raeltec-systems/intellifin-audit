-- Story 5.4: pause a Running Run, and resume it.
--
-- A pause is a WAIT, not a new mechanism. Reusing `run_wait` is what gives it the
-- `run_wait_one_open` unique index -- which is exactly why "a Run waiting on an answer
-- cannot be paused" and a paused Run cannot raise an Escalation -- plus the durable wake
-- at the deadline, the Run-revision compare-and-set and the recovery sweep. Two copies of
-- any of those would agree on every case anybody tried and diverge on the first one
-- nobody did.
--
-- Three tables move, and each addition pairs a fact with the CHECK that pins it:
--
--   * `audit_run` gains the pause REQUEST marker. Written whole or not at all, like the
--     cancellation marker beside it, and unlike that one it is CLEARED by the boundary
--     that honours it -- so a marker still present at a terminal transition is a request
--     no boundary ever reached, which is exactly AD-16's `lifecycle.pause-superseded`.
--
--   * `run_step_execution` gains `SUPERSEDED` and the reason it was. A pause interrupts an
--     attempt: nothing failed, so `diagnostic` stays NULL and `FAILED` would be a lie, and
--     leaving it `RUNNING` would make an interrupted attempt indistinguishable from a live
--     one. Its Tool Actions stay on the Timeline; the resume starts a new attempt.
--
--   * `run_wait` gains the `pause` kind, `opened_at`, `opened_by`, and a closure CHECK
--     that now pins the closure to the KIND. An Escalation closes by `answer` and a pause
--     by `resume`, so "a pause can never be answered" stops being a rule two commands
--     remember and becomes something the database refuses to hold.
--
-- `opened_at` is added NULLABLE, backfilled and only then made NOT NULL, because
-- `ADD COLUMN ... NOT NULL` fails on a table that already holds rows. The backfill is
-- EXACT rather than a guess: every wait this table has ever held is an Escalation, and
-- every one was created with `deadline = opened_at + AWAITING_AUDITOR_TIMEOUT_MS`, which
-- is four hours. No DEFAULT is used at any point, so the next producer has to say when its
-- wait opened rather than silently inheriting `now()`.

ALTER TABLE "run_step_execution" DROP CONSTRAINT "run_step_execution_state";--> statement-breakpoint
ALTER TABLE "run_wait" DROP CONSTRAINT "run_wait_kind";--> statement-breakpoint
ALTER TABLE "run_wait" DROP CONSTRAINT "run_wait_closure";--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "pause_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "pause_requested_by" text;--> statement-breakpoint
ALTER TABLE "audit_run" ADD COLUMN "pause_requested_session" text;--> statement-breakpoint
ALTER TABLE "run_step_execution" ADD COLUMN "superseded_by" text;--> statement-breakpoint
ALTER TABLE "run_wait" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
UPDATE "run_wait" SET "opened_at" = "deadline" - interval '4 hours' WHERE "opened_at" IS NULL;--> statement-breakpoint
ALTER TABLE "run_wait" ALTER COLUMN "opened_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_wait" ADD COLUMN "opened_by" text;--> statement-breakpoint
ALTER TABLE "audit_run" ADD CONSTRAINT "audit_run_pause_request" CHECK (("audit_run"."pause_requested_at" IS NULL) = ("audit_run"."pause_requested_by" IS NULL) AND ("audit_run"."pause_requested_at" IS NULL) = ("audit_run"."pause_requested_session" IS NULL));--> statement-breakpoint
ALTER TABLE "run_step_execution" ADD CONSTRAINT "run_step_execution_superseded" CHECK (("run_step_execution"."state"='SUPERSEDED') = ("run_step_execution"."superseded_by" IS NOT NULL) AND ("run_step_execution"."superseded_by" IS NULL OR "run_step_execution"."superseded_by" IN ('resume')));--> statement-breakpoint
ALTER TABLE "run_step_execution" ADD CONSTRAINT "run_step_execution_state" CHECK ("run_step_execution"."state" IN ('RUNNING','SUCCEEDED','FAILED','SUPERSEDED'));--> statement-breakpoint
ALTER TABLE "run_wait" ADD CONSTRAINT "run_wait_opened_by" CHECK (("run_wait"."kind"='pause') = ("run_wait"."opened_by" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "run_wait" ADD CONSTRAINT "run_wait_kind" CHECK ("run_wait"."kind" IN ('choose-candidate','unnamed-value','retry-or-skip','pause'));--> statement-breakpoint
ALTER TABLE "run_wait" ADD CONSTRAINT "run_wait_closure" CHECK (("run_wait"."closed_at" IS NULL AND "run_wait"."closure_kind" IS NULL AND "run_wait"."answer_option_id" IS NULL AND "run_wait"."actor" IS NULL) OR ("run_wait"."closed_at" IS NOT NULL AND "run_wait"."closure_kind" IS NOT DISTINCT FROM 'answer' AND "run_wait"."kind" IS DISTINCT FROM 'pause' AND "run_wait"."answer_option_id" IS NOT NULL AND "run_wait"."actor" IS NOT NULL) OR ("run_wait"."closed_at" IS NOT NULL AND "run_wait"."closure_kind" IS NOT DISTINCT FROM 'resume' AND "run_wait"."kind" IS NOT DISTINCT FROM 'pause' AND "run_wait"."answer_option_id" IS NOT DISTINCT FROM 'resume' AND "run_wait"."actor" IS NOT NULL) OR ("run_wait"."closed_at" IS NOT NULL AND "run_wait"."closure_kind" IS NOT DISTINCT FROM 'timeout' AND "run_wait"."answer_option_id" IS NULL AND "run_wait"."actor" IS NOT DISTINCT FROM 'wait-wake'));--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (45);
