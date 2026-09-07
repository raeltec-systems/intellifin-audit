CREATE TABLE "evidence_read_grant" (
	"grant_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"locator" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"denial_code" text,
	"signed_url" text,
	"signed_url_expires_at" timestamp with time zone,
	"capability_media_type" text,
	"capability_digest" text,
	"capability_size" integer,
	CONSTRAINT "evidence_read_grant_locator" CHECK (length("evidence_read_grant"."locator") BETWEEN 1 AND 1024 AND btrim("evidence_read_grant"."locator") = "evidence_read_grant"."locator"),
	CONSTRAINT "evidence_read_grant_actor" CHECK (length(btrim("evidence_read_grant"."actor_id")) BETWEEN 1 AND 255),
	CONSTRAINT "evidence_read_grant_session" CHECK (length(btrim("evidence_read_grant"."session_id")) BETWEEN 1 AND 255),
	CONSTRAINT "evidence_read_grant_correlation" CHECK (length(btrim("evidence_read_grant"."correlation_id")) BETWEEN 1 AND 255),
	CONSTRAINT "evidence_read_grant_window" CHECK ("evidence_read_grant"."expires_at" > "evidence_read_grant"."requested_at" AND "evidence_read_grant"."expires_at" <= "evidence_read_grant"."requested_at" + interval '5 minutes'),
	CONSTRAINT "evidence_read_grant_status" CHECK ("evidence_read_grant"."status" IN ('pending','issued','denied','expired')),
	CONSTRAINT "evidence_read_grant_denial" CHECK ("evidence_read_grant"."denial_code" IS NULL OR "evidence_read_grant"."denial_code" IN ('expired','unauthorized','scope-mismatch','evidence-not-registered','unsupported-media-type','invalid-evidence-metadata','storage-unavailable')),
	CONSTRAINT "evidence_read_grant_url" CHECK ("evidence_read_grant"."signed_url" IS NULL OR (length("evidence_read_grant"."signed_url") BETWEEN 1 AND 4096 AND "evidence_read_grant"."signed_url" ~* '^https?://[^[:space:]#@]+$')),
	CONSTRAINT "evidence_read_grant_digest" CHECK ("evidence_read_grant"."capability_digest" IS NULL OR "evidence_read_grant"."capability_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evidence_read_grant_size" CHECK ("evidence_read_grant"."capability_size" IS NULL OR "evidence_read_grant"."capability_size" BETWEEN 0 AND 4194304),
	CONSTRAINT "evidence_read_grant_media_type" CHECK ("evidence_read_grant"."capability_media_type" IS NULL OR length(btrim("evidence_read_grant"."capability_media_type")) BETWEEN 1 AND 255),
	CONSTRAINT "evidence_read_grant_completion" CHECK (coalesce((
    ("evidence_read_grant"."status" = 'pending'
      AND "evidence_read_grant"."denial_code" IS NULL AND "evidence_read_grant"."signed_url" IS NULL AND "evidence_read_grant"."signed_url_expires_at" IS NULL
      AND "evidence_read_grant"."capability_media_type" IS NULL AND "evidence_read_grant"."capability_digest" IS NULL AND "evidence_read_grant"."capability_size" IS NULL)
    OR ("evidence_read_grant"."status" = 'issued'
      AND "evidence_read_grant"."denial_code" IS NULL AND "evidence_read_grant"."signed_url" IS NOT NULL
      AND "evidence_read_grant"."signed_url_expires_at" > "evidence_read_grant"."requested_at" AND "evidence_read_grant"."signed_url_expires_at" <= "evidence_read_grant"."expires_at"
      AND "evidence_read_grant"."capability_media_type" IS NOT NULL AND "evidence_read_grant"."capability_digest" IS NOT NULL AND "evidence_read_grant"."capability_size" IS NOT NULL)
    OR ("evidence_read_grant"."status" = 'denied'
      AND "evidence_read_grant"."denial_code" IS NOT NULL AND "evidence_read_grant"."denial_code" <> 'expired'
      AND "evidence_read_grant"."signed_url" IS NULL AND "evidence_read_grant"."signed_url_expires_at" IS NULL
      AND "evidence_read_grant"."capability_media_type" IS NULL AND "evidence_read_grant"."capability_digest" IS NULL AND "evidence_read_grant"."capability_size" IS NULL)
    OR ("evidence_read_grant"."status" = 'expired'
      AND "evidence_read_grant"."denial_code" = 'expired'
      AND "evidence_read_grant"."signed_url" IS NULL AND "evidence_read_grant"."signed_url_expires_at" IS NULL
      AND "evidence_read_grant"."capability_media_type" IS NULL AND "evidence_read_grant"."capability_digest" IS NULL AND "evidence_read_grant"."capability_size" IS NULL)
  ), false)),
	CONSTRAINT "evidence_read_grant_issued_capability_window" CHECK ("evidence_read_grant"."status" <> 'issued' OR "evidence_read_grant"."signed_url_expires_at" <= "evidence_read_grant"."requested_at" + interval '5 minutes')
);
--> statement-breakpoint
ALTER TABLE "evidence_read_grant" ADD CONSTRAINT "evidence_read_grant_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_read_grant" ADD CONSTRAINT "evidence_read_grant_evidence_id_run_evidence_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."run_evidence"("evidence_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_read_grant_pending_expiry" ON "evidence_read_grant" USING btree ("status","expires_at") WHERE "evidence_read_grant"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "evidence_read_grant_actor" ON "evidence_read_grant" USING btree ("actor_id","requested_at");
--> statement-breakpoint
-- A globally unique Evidence id is still checked against the grant's Run and kind. The
-- trigger is needed because run_evidence.evidence_id is the existing primary key rather
-- than a composite (run_id,evidence_id) key.
CREATE FUNCTION "evidence_read_grant_binding_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "run_evidence" e
    WHERE e."evidence_id" = NEW."evidence_id"
      AND e."run_id" = NEW."run_id"
      AND e."kind" = 'structural-snapshot'
      AND e."state" = 'REGISTERED'
  ) THEN
    RAISE EXCEPTION 'Evidence read grant must name a registered Structural Snapshot in its Run'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "evidence_read_grant_binding_guard"
  BEFORE INSERT ON "evidence_read_grant"
  FOR EACH ROW EXECUTE FUNCTION "evidence_read_grant_binding_guard"();
--> statement-breakpoint
-- Request identity and scope are immutable. Only a pending request can be resolved, and a
-- terminal result cannot be changed into another result or have its capability restored.
CREATE FUNCTION "evidence_read_grant_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('denied', 'expired') OR (OLD.status = 'issued' AND NEW.status NOT IN ('denied', 'expired')) THEN
    RAISE EXCEPTION 'A terminal Evidence read grant cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.grant_id IS DISTINCT FROM OLD.grant_id
    OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
    OR NEW.locator IS DISTINCT FROM OLD.locator
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'An Evidence read grant request is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('pending','issued','denied','expired') THEN
    RAISE EXCEPTION 'An Evidence read grant has an invalid state' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "evidence_read_grant_immutable"
  BEFORE UPDATE ON "evidence_read_grant"
  FOR EACH ROW EXECUTE FUNCTION "evidence_read_grant_immutable"();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (38);
