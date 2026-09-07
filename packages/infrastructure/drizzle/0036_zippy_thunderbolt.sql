CREATE TABLE "run_evaluation_review" (
	"decision_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"observation_id" uuid NOT NULL,
	"condition_id" text NOT NULL,
	"review_revision" integer NOT NULL,
	"action" text NOT NULL,
	"original_origin" text NOT NULL,
	"original_value" text NOT NULL,
	"original_confirmation" text NOT NULL,
	"original_confidence" numeric(7, 6),
	"original_rationale" text,
	"original_evidence_ids" jsonb NOT NULL,
	"effective_origin" text NOT NULL,
	"effective_value" text NOT NULL,
	"effective_confirmation" text,
	"replacement_value" text,
	"rejection_rationale" text,
	"actor_id" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_evaluation_review_revision" CHECK ("run_evaluation_review"."review_revision" >= 1),
	CONSTRAINT "run_evaluation_review_action" CHECK ("run_evaluation_review"."action" IN ('confirm','reject')),
	CONSTRAINT "run_evaluation_review_original_origin" CHECK ("run_evaluation_review"."original_origin" = 'AGENT_JUDGED'),
	CONSTRAINT "run_evaluation_review_original_value" CHECK ("run_evaluation_review"."original_value" IN ('COMPLIANT','EXCEPTION','UNEVALUATED')),
	CONSTRAINT "run_evaluation_review_original_confirmation" CHECK ("run_evaluation_review"."original_confirmation" = 'pending'),
	CONSTRAINT "run_evaluation_review_original_confidence" CHECK ("run_evaluation_review"."original_confidence" IS NULL OR ("run_evaluation_review"."original_confidence" >= 0 AND "run_evaluation_review"."original_confidence" <= 1)),
	CONSTRAINT "run_evaluation_review_original_rationale" CHECK ("run_evaluation_review"."original_rationale" IS NULL OR length("run_evaluation_review"."original_rationale") BETWEEN 1 AND 8192),
	CONSTRAINT "run_evaluation_review_original_evidence" CHECK (coalesce(jsonb_typeof("run_evaluation_review"."original_evidence_ids") = 'array' AND jsonb_array_length("run_evaluation_review"."original_evidence_ids") BETWEEN 1 AND 16, false)),
	CONSTRAINT "run_evaluation_review_effective_origin" CHECK ("run_evaluation_review"."effective_origin" IN ('AGENT_JUDGED','HUMAN')),
	CONSTRAINT "run_evaluation_review_effective_value" CHECK ("run_evaluation_review"."effective_value" IN ('COMPLIANT','EXCEPTION','UNEVALUATED')),
	CONSTRAINT "run_evaluation_review_effective_confirmation" CHECK ("run_evaluation_review"."effective_confirmation" IS NULL OR "run_evaluation_review"."effective_confirmation" = 'confirmed'),
	CONSTRAINT "run_evaluation_review_replacement_value" CHECK ("run_evaluation_review"."replacement_value" IS NULL OR "run_evaluation_review"."replacement_value" IN ('COMPLIANT','EXCEPTION','UNEVALUATED')),
	CONSTRAINT "run_evaluation_review_rejection_rationale" CHECK ("run_evaluation_review"."rejection_rationale" IS NULL OR length("run_evaluation_review"."rejection_rationale") BETWEEN 1 AND 4000),
	CONSTRAINT "run_evaluation_review_shape" CHECK (coalesce((
    ("run_evaluation_review"."action" = 'confirm'
      AND "run_evaluation_review"."effective_origin" = 'AGENT_JUDGED'
      AND "run_evaluation_review"."effective_value" = "run_evaluation_review"."original_value"
      AND "run_evaluation_review"."effective_confirmation" = 'confirmed'
      AND "run_evaluation_review"."replacement_value" IS NULL
      AND "run_evaluation_review"."rejection_rationale" IS NULL)
    OR
    ("run_evaluation_review"."action" = 'reject'
      AND "run_evaluation_review"."effective_origin" = 'HUMAN'
      AND "run_evaluation_review"."effective_confirmation" IS NULL
      AND "run_evaluation_review"."replacement_value" IS NOT NULL
      AND "run_evaluation_review"."rejection_rationale" IS NOT NULL
      AND btrim("run_evaluation_review"."rejection_rationale") <> '')
  ), false)),
	CONSTRAINT "run_evaluation_review_condition" CHECK (length("run_evaluation_review"."condition_id") BETWEEN 1 AND 255),
	CONSTRAINT "run_evaluation_review_actor" CHECK (length(btrim("run_evaluation_review"."actor_id")) BETWEEN 1 AND 255)
);
--> statement-breakpoint
CREATE TABLE "run_result_review" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "run_result_review_revision" CHECK ("run_result_review"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ADD COLUMN "agent_proposed_value" text;--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ADD COLUMN "agent_proposed_confidence" numeric(7, 6);--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ADD COLUMN "agent_proposed_rationale" text;--> statement-breakpoint
ALTER TABLE "run_evaluation_review" ADD CONSTRAINT "run_evaluation_review_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_evaluation_review" ADD CONSTRAINT "run_evaluation_review_evaluation_fk" FOREIGN KEY ("observation_id","condition_id") REFERENCES "public"."run_observation_evaluation"("observation_id","condition_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_result_review" ADD CONSTRAINT "run_result_review_run_id_run_result_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run_result"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_evaluation_review_target_uidx" ON "run_evaluation_review" USING btree ("run_id","observation_id","condition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_evaluation_review_revision_uidx" ON "run_evaluation_review" USING btree ("run_id","review_revision");--> statement-breakpoint
ALTER TABLE "run_observation_evaluation" ADD CONSTRAINT "run_observation_evaluation_agent_proposal" CHECK (coalesce((
    ("run_observation_evaluation"."agent_proposed_value" IS NULL AND "run_observation_evaluation"."agent_proposed_confidence" IS NULL AND "run_observation_evaluation"."agent_proposed_rationale" IS NULL)
    OR (
      "run_observation_evaluation"."origin" = 'AGENT_JUDGED'
      AND "run_observation_evaluation"."agent_proposed_value" IN ('COMPLIANT','EXCEPTION','UNEVALUATED')
      AND "run_observation_evaluation"."agent_proposed_confidence" >= 0 AND "run_observation_evaluation"."agent_proposed_confidence" <= 1
      AND length("run_observation_evaluation"."agent_proposed_rationale") BETWEEN 1 AND 8192
    )
  ), false));
--> statement-breakpoint
-- Evaluation rows are the original machine record copied by every review decision. The
-- registration path is insert-only, so allowing a later UPDATE would let a raw writer
-- change the target after a reviewer had acted on it. DELETE remains available for the
-- existing disposable Observation teardown path.
CREATE FUNCTION "run_observation_evaluation_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'An observation evaluation is immutable' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_observation_evaluation_immutable" BEFORE UPDATE ON "run_observation_evaluation"
  FOR EACH ROW EXECUTE FUNCTION "run_observation_evaluation_immutable"();--> statement-breakpoint
-- Every Result that already exists gets a review aggregate at revision zero. New Results
-- are created with the same row by the review repository before a decision can advance it.
INSERT INTO "run_result_review" ("run_id", "revision")
SELECT "run_id", 0 FROM "run_result"
ON CONFLICT ("run_id") DO NOTHING;--> statement-breakpoint
-- A review decision is admitted only through the same lock order as the repository:
-- audit_run, run_result, run_result_review, then the original evaluation/Observation.
-- The application copies the original fields, but this trigger binds those copies to the
-- rows that are actually present when the immutable ledger entry is written.
CREATE FUNCTION "run_evaluation_review_binding_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_run_state text;
  result_sealed boolean;
  result_outcome text;
  result_run_state text;
  current_review_revision integer;
  evaluation_origin text;
  evaluation_value text;
  evaluation_confirmation text;
  evaluation_confidence numeric;
  evaluation_rationale text;
  evaluation_evidence_ids jsonb;
  observation_coverage text;
  observation_corroboration text;
BEGIN
  -- Lock order is deliberate. The repository already owns these locks, so these reads
  -- serialize raw SQL writers without ever taking a child lock before its Run parent.
  SELECT state INTO current_run_state
  FROM "audit_run"
  WHERE run_id = NEW.run_id
  FOR UPDATE;
  IF NOT FOUND OR current_run_state <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Evaluation review requires a Completed Run' USING ERRCODE = '23514';
  END IF;

  SELECT sealed, outcome, run_state
    INTO result_sealed, result_outcome, result_run_state
  FROM "run_result"
  WHERE run_id = NEW.run_id
  FOR UPDATE;
  IF NOT FOUND OR result_sealed OR result_outcome <> 'PENDING_CONFIRMATION' OR result_run_state <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Evaluation review requires an unsealed pending Result' USING ERRCODE = '23514';
  END IF;

  SELECT revision INTO current_review_revision
  FROM "run_result_review"
  WHERE run_id = NEW.run_id
  FOR UPDATE;
  IF NOT FOUND OR current_review_revision IS DISTINCT FROM NEW.review_revision THEN
    RAISE EXCEPTION 'Evaluation review revision is not current' USING ERRCODE = '23514';
  END IF;

  SELECT origin, value, confirmation, confidence, rationale, evidence_ids
    INTO evaluation_origin, evaluation_value, evaluation_confirmation,
      evaluation_confidence, evaluation_rationale, evaluation_evidence_ids
  FROM "run_observation_evaluation"
  WHERE run_id = NEW.run_id
    AND observation_id = NEW.observation_id
    AND condition_id = NEW.condition_id
  FOR SHARE;
  IF NOT FOUND OR evaluation_origin <> 'AGENT_JUDGED' OR evaluation_confirmation <> 'pending' THEN
    RAISE EXCEPTION 'Evaluation review must target a pending Agent-Judged evaluation' USING ERRCODE = '23514';
  END IF;
  IF evaluation_origin IS DISTINCT FROM NEW.original_origin
    OR evaluation_value IS DISTINCT FROM NEW.original_value
    OR evaluation_confirmation IS DISTINCT FROM NEW.original_confirmation
    OR evaluation_confidence IS DISTINCT FROM NEW.original_confidence
    OR evaluation_rationale IS DISTINCT FROM NEW.original_rationale
    OR evaluation_evidence_ids IS DISTINCT FROM NEW.original_evidence_ids THEN
    RAISE EXCEPTION 'Evaluation review does not preserve the original evaluation' USING ERRCODE = '23514';
  END IF;

  -- A Compliant EFFECTIVE decision is valid only when the original Observation itself is
  -- covered and its stored Structural Snapshot is matched. This check must use the
  -- effective value: rejecting an original Exception or Unevaluated proposal to Compliant
  -- needs the same evidence floor as confirming an original Compliant proposal.
  IF NEW.effective_value = 'COMPLIANT' THEN
    SELECT coverage, corroboration
      INTO observation_coverage, observation_corroboration
    FROM "run_observation"
    WHERE observation_id = NEW.observation_id
    FOR SHARE;
    IF NOT FOUND OR observation_coverage <> 'COVERED' OR observation_corroboration <> 'MATCHED' THEN
      RAISE EXCEPTION 'Compliant evaluation review requires a covered matched Observation' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_evaluation_review_binding_guard" BEFORE INSERT ON "run_evaluation_review"
  FOR EACH ROW EXECUTE FUNCTION "run_evaluation_review_binding_guard"();--> statement-breakpoint
-- A ledger decision is append-only. The aggregate revision is the only mutable review row;
-- its child history cannot be rewritten by a command, migration or raw SQL writer.
CREATE FUNCTION "run_evaluation_review_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'An evaluation review decision is immutable' USING ERRCODE = '23514';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "run_evaluation_review_immutable" BEFORE UPDATE ON "run_evaluation_review"
  FOR EACH ROW EXECUTE FUNCTION "run_evaluation_review_immutable"();--> statement-breakpoint
-- Deleting the ledger directly is forbidden while its original evaluation remains. A
-- disposable teardown may delete the parent evaluation; the composite FK cascades the
-- ledger row and this deferred check observes that the parent is gone at commit.
CREATE FUNCTION "run_evaluation_review_undeletable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "run_observation_evaluation"
    WHERE observation_id = OLD.observation_id AND condition_id = OLD.condition_id
  ) THEN
    RAISE EXCEPTION 'An evaluation review decision cannot be deleted while its evaluation exists' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "run_evaluation_review_undeletable" AFTER DELETE ON "run_evaluation_review"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "run_evaluation_review_undeletable"();--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (36) ON CONFLICT ("version") DO NOTHING;
