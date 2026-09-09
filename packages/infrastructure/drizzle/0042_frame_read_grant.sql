-- Generation 41 is already published. Replace only the grant binding trigger function,
-- leaving every existing grant, artifact and package untouched. A Live View frame is the
-- registered screenshot of one Tool Action (Story 5.3, AD-17), read through the same
-- worker-signed, actor-bound grant as a Structural Snapshot cell; the guard therefore
-- admits both registered kinds. The worker still refuses a frame locator on a snapshot and
-- a cell locator on a screenshot: the locator names the read kind and the kind must match.
CREATE OR REPLACE FUNCTION "evidence_read_grant_binding_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "run_evidence" e
    WHERE e."evidence_id" = NEW."evidence_id"
      AND e."run_id" = NEW."run_id"
      AND e."kind" IN ('structural-snapshot', 'screenshot')
      AND e."state" = 'REGISTERED'
  ) THEN
    RAISE EXCEPTION 'Evidence read grant must name a registered Structural Snapshot or screenshot in its Run'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (42);
