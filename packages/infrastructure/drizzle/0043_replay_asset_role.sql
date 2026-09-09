-- Story 5.2: what an artifact is FOR, beside what it IS.
--
-- `evidence` is what a Run concluded from; `replay` is what it is watched by. The same
-- kind sits on both sides — the screenshot an Observation is grounded in is Evidence, the
-- screenshot captured after every Tool Action so the session can be replayed is not — so
-- the distinction cannot be read out of `kind`, and reading it out of a naming convention
-- would make it a convention anybody could satisfy by typing.
--
-- Every row this table has ever held was written by a producer that froze bytes a Run
-- concluded from, so the backfill is STRUCTURAL rather than a guess: `evidence` is what
-- they were. `population_evidence` is not touched at all — a population is Evidence by
-- definition and that table has no other role to hold.
--
-- Hand-edited: drizzle-kit emits a bare `ADD COLUMN ... NOT NULL`, which fails on a table
-- that already holds rows. Add with a DEFAULT, then drop the default so a later producer
-- must say which role it means rather than inheriting one.
ALTER TABLE "run_evidence" ADD COLUMN "role" text DEFAULT 'evidence' NOT NULL;--> statement-breakpoint
ALTER TABLE "run_evidence" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "run_evidence" ADD CONSTRAINT "run_evidence_role" CHECK ("run_evidence"."role" IN ('evidence','replay'));--> statement-breakpoint
-- A replay artifact never gates a seal. `sealPackageDecision` enforces it in the domain;
-- this is the layer nothing can route around, so a raw writer cannot mint a required
-- replay row and make a Run INCOMPLETE for a frame nobody concluded anything from.
ALTER TABLE "run_evidence" ADD CONSTRAINT "run_evidence_replay_never_required" CHECK ("run_evidence"."role" <> 'replay' OR "run_evidence"."required" = false);--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (43);
