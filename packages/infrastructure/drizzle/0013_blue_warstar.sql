CREATE TABLE "notification" (
	"send_key" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"procedure_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
  "procedure_name" text NOT NULL,
  "version_number" integer NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "notification_version_number" CHECK ("notification"."version_number" > 0),
  CONSTRAINT "notification_kind" CHECK ("notification"."kind" IN ('submitted','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "authorship" jsonb;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "decisions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "frozen_review" jsonb;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_id_auth_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_procedure_id_procedure_procedure_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedure"("procedure_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_version_id_procedure_version_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."procedure_version"("version_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_recipient_delivery_idx" ON "notification" USING btree ("recipient_id","delivered_at" DESC NULLS LAST,"send_key");--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_authorship_shape" CHECK ("procedure_version"."authorship" IS NULL OR coalesce(jsonb_typeof("procedure_version"."authorship") = 'object' AND jsonb_typeof("procedure_version"."authorship"->'createdBy') = 'object' AND "procedure_version"."authorship"->'createdBy'->>'type' IN ('human','platform') AND jsonb_typeof("procedure_version"."authorship"->'createdBy'->'id') = 'string' AND jsonb_typeof("procedure_version"."authorship"->'responsibleAuthorId') = 'string' AND jsonb_typeof("procedure_version"."authorship"->'humanAuthorIds') = 'array', false));--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_decisions_shape" CHECK (coalesce(jsonb_typeof("procedure_version"."decisions") = 'array', false));--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_review_shape" CHECK ("procedure_version"."frozen_review" IS NULL OR coalesce(jsonb_typeof("procedure_version"."frozen_review") = 'object' AND "procedure_version"."frozen_review"->'schemaVersion' = '1'::jsonb AND jsonb_typeof("procedure_version"."frozen_review"->'definition') = 'object' AND jsonb_typeof("procedure_version"."frozen_review"->'diff') = 'array' AND jsonb_typeof("procedure_version"."frozen_review"->'approval') = 'object', false));
--> statement-breakpoint
-- Trusted provenance comes only from immutable creation/definition-change events.
-- Operational derivation attempts/retries do not make their actor an author.
UPDATE procedure_version AS version
SET authorship = jsonb_build_object(
  'createdBy', jsonb_build_object('type', 'human', 'id', creation.actor_id),
  'responsibleAuthorId', creation.actor_id,
  'humanAuthorIds', (
    SELECT jsonb_agg(DISTINCT authored.actor_id ORDER BY authored.actor_id)
    FROM audit_events AS authored
    WHERE authored.actor_type = 'human'
      AND authored.payload->>'versionId' = version.version_id::text
      AND authored.aggregate_id = version.procedure_id::text
      AND authored.event_type IN ('lifecycle.procedure-created', 'lifecycle.procedure-draft-changed')
  )
)
FROM audit_events AS creation
WHERE creation.actor_type = 'human'
  AND creation.event_type = 'lifecycle.procedure-created'
  AND creation.payload->>'versionId' = version.version_id::text
  AND creation.aggregate_id = version.procedure_id::text
  AND version.authorship IS NULL;
--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "submitted_review" jsonb;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_submitted_review_shape" CHECK ("procedure_version"."submitted_review" IS NULL OR coalesce(jsonb_typeof("procedure_version"."submitted_review") = 'object' AND "procedure_version"."submitted_review"->'schemaVersion' = '1'::jsonb AND jsonb_typeof("procedure_version"."submitted_review"->'definition') = 'object' AND jsonb_typeof("procedure_version"."submitted_review"->'diff') = 'array', false));
--> statement-breakpoint
CREATE INDEX "notification_pending_delivery_idx" ON "notification" USING btree ("created_at","send_key") WHERE "notification"."delivered_at" IS NULL;
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (13);
