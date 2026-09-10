-- Generation 47: a Run that ends withdraws the question it was holding.
--
-- From the PR 29 review. `RUN_CANCEL_TRANSITIONS` gives a `PAUSED` and an
-- `AWAITING_AUDITOR` Run to the COMMAND — no worker is holding either — so cancelling one
-- performed the terminal transition and left its wait `closed_at` NULL for ever. Two
-- things followed, and the second is the one that grows:
--
--   * the row asserted that a question was open about a Run that is over, which nobody can
--     ever answer and which no later write could correct; and
--   * `recoverableWaits` reads open waits in a BOUNDED page, so enough of these starve the
--     sweep whose whole job is finding waits whose wake was lost.
--
-- The inbox and the bell were never affected: their one visibility predicate requires
-- `AWAITING_AUDITOR`, and a cancelled Run is `CANCELED`, so the STATE excluded it — which
-- is exactly why this could sit unnoticed behind two surfaces that looked right.
--
-- Three statements of one rule, in the order this codebase always uses: the producer
-- cannot ask for the contradiction (`completeRun` withdraws before it seals), the domain
-- would not honour it, and the database refuses to hold it (the constraint trigger below).

ALTER TABLE "run_wait" DROP CONSTRAINT "run_wait_closure";--> statement-breakpoint
-- The backfill is STRUCTURAL, not a guess. Every row it touches is a wait left open on a
-- Run that is already terminal, which is the defect itself; the instant is the Result's own
-- `sealed_at`, which is when that Run ended. Generation 25 makes a terminal Run's Result
-- mandatory, so the join is total and the `WHERE` cannot reach a Run that is still going.
--
-- It runs BETWEEN the drop and the add deliberately: `withdrawn` is not a value the old
-- CHECK admits, so the same statement under it would be refused.
UPDATE "run_wait" AS w
SET "closed_at" = r."sealed_at",
    "closure_kind" = 'withdrawn',
    "actor" = 'run-terminal'
FROM "run_result" AS r
JOIN "audit_run" AS a ON a."run_id" = r."run_id"
WHERE w."run_id" = r."run_id"
  AND w."closed_at" IS NULL
  AND a."state" IN ('COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED');--> statement-breakpoint
ALTER TABLE "run_wait" ADD CONSTRAINT "run_wait_closure" CHECK (("run_wait"."closed_at" IS NULL AND "run_wait"."closure_kind" IS NULL AND "run_wait"."answer_option_id" IS NULL AND "run_wait"."actor" IS NULL) OR ("run_wait"."closed_at" IS NOT NULL AND "run_wait"."closure_kind" IS NOT DISTINCT FROM 'answer' AND "run_wait"."kind" IS DISTINCT FROM 'pause' AND "run_wait"."answer_option_id" IS NOT NULL AND "run_wait"."actor" IS NOT NULL) OR ("run_wait"."closed_at" IS NOT NULL AND "run_wait"."closure_kind" IS NOT DISTINCT FROM 'resume' AND "run_wait"."kind" IS NOT DISTINCT FROM 'pause' AND "run_wait"."answer_option_id" IS NOT DISTINCT FROM 'resume' AND "run_wait"."actor" IS NOT NULL) OR ("run_wait"."closed_at" IS NOT NULL AND "run_wait"."closure_kind" IS NOT DISTINCT FROM 'timeout' AND "run_wait"."answer_option_id" IS NULL AND "run_wait"."actor" IS NOT DISTINCT FROM 'wait-wake') OR ("run_wait"."closed_at" IS NOT NULL AND "run_wait"."closure_kind" IS NOT DISTINCT FROM 'withdrawn' AND "run_wait"."answer_option_id" IS NULL AND "run_wait"."actor" IS NOT DISTINCT FROM 'run-terminal'));--> statement-breakpoint
-- A terminal Run holds no open wait.
--
-- DEFERRABLE INITIALLY DEFERRED, so a producer may withdraw the wait anywhere inside its
-- terminal transaction — the shape generations 21 and 25 already use for the Evidence
-- package and the Result. This is the forcing function behind "withdraw in the transaction
-- that ends the Run": a path that forgets does not ship a row claiming an open question, it
-- fails to commit.
--
-- It fires on `audit_run` and not on `run_wait`, because the transition that creates the
-- contradiction is the Run's, and a wait may legitimately be opened, held and closed while
-- the Run is active.
CREATE FUNCTION "audit_run_no_open_wait"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IN ('COMPLETED','INCONCLUSIVE','RUN_FAILED','CANCELED')
     AND EXISTS (SELECT 1 FROM run_wait WHERE run_id = NEW.run_id AND closed_at IS NULL)
  THEN
    RAISE EXCEPTION 'Run % reached % holding an open wait', NEW.run_id, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "audit_run_no_open_wait" AFTER INSERT OR UPDATE ON "audit_run"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "audit_run_no_open_wait"();--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (47);
