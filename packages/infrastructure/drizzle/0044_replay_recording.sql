-- Story 5.2: the provider's own session recording, copied into platform storage at Run end.
--
-- A SIBLING of the Evidence package and deliberately NOT a `run_evidence` row. The copy
-- happens at the terminal RELEASE, which is after `completeRun` has already sealed the
-- package — and generation 21 freezes a sealed Run's Evidence, so an Evidence row written
-- here would either be refused outright or would sit outside the seal that names what this
-- Run froze. Both are wrong, and the second is worse: the Result would publish an artifact
-- list that did not include it, which is a Result stating something untrue about itself.
--
-- The recording is not something a Run concluded from, so it does not belong in the
-- package at all. `run_evidence.role` (generation 43) says what an in-package artifact is
-- FOR; this table is where the replay-role artifact that arrives AFTER the seal lives.
--
-- ON DELETE CASCADE, like `run_workspace`: operational Replay state that records no audit
-- outcome, so removing a whole Run takes it along and no existing teardown has to learn a
-- new table name. A foreign key nobody knows about does not fail its own suite — it leaves
-- rows behind and fails an unrelated one later, on a count.
CREATE TABLE "run_replay_recording" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"object_key" text NOT NULL,
	"media_type" text NOT NULL,
	"digest" text,
	"size" bigint,
	"state" text NOT NULL,
	"copied_at" timestamp with time zone,
	"diagnostic" text,
	CONSTRAINT "run_replay_recording_state" CHECK ("run_replay_recording"."state" IN ('RESERVED','REGISTERED','UNAVAILABLE')),
	CONSTRAINT "run_replay_recording_digest" CHECK ("run_replay_recording"."digest" IS NULL OR "run_replay_recording"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "run_replay_recording_registered" CHECK ("run_replay_recording"."state" <> 'REGISTERED' OR ("run_replay_recording"."digest" IS NOT NULL AND "run_replay_recording"."size" IS NOT NULL AND "run_replay_recording"."copied_at" IS NOT NULL)),
	CONSTRAINT "run_replay_recording_unavailable" CHECK (("run_replay_recording"."state" = 'UNAVAILABLE') = ("run_replay_recording"."diagnostic" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "run_replay_recording" ADD CONSTRAINT "run_replay_recording_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (44);
