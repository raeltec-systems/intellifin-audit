ALTER TABLE "procedure_version" ADD COLUMN "evidence_schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "evidence_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "schedule" jsonb;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_evidence_schema" CHECK ("procedure_version"."evidence_schema_version" = 1);--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_evidence_shape" CHECK (coalesce(jsonb_typeof("procedure_version"."evidence_requirements") = 'array' AND jsonb_array_length("procedure_version"."evidence_requirements") <= 32, false));--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_schedule_shape" CHECK ("procedure_version"."schedule" IS NULL OR coalesce(jsonb_typeof("procedure_version"."schedule") = 'object' AND "procedure_version"."schedule" - 'frequency' - 'startTime' - 'periodDerivationRule' = '{}'::jsonb AND "procedure_version"."schedule"->>'frequency' IN ('once','daily','weekly','monthly') AND "procedure_version"."schedule"->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false));--> statement-breakpoint
-- Existing versions receive the same structured Template defaults a newly created Draft
-- gets (`initialDraftEvidence`). Only P-1 names structured Evidence Requirements; the
-- `platformCaptured` flag is true because P-1's default Target Systems are both
-- agent-driven (web, desktop) — the same computation `withPlatformCaptured` performs.
-- `schedule` stays NULL: the Schedule is now a real, auditor-set field, not a Template
-- default, and this changes only the promoted Evidence Requirements columns; prior
-- section edits stay.
UPDATE "procedure_version"
SET "evidence_requirements" = CASE "template_id"
  WHEN 'P-1' THEN $json$[{"attributeName":"username","modelRead":false,"groundedBy":["structural-snapshot"],"screenshot":true,"recordingSegment":false,"platformCaptured":true},{"attributeName":"account_status","modelRead":false,"groundedBy":["structural-snapshot"],"screenshot":true,"recordingSegment":false,"platformCaptured":true},{"attributeName":"roles","modelRead":false,"groundedBy":["structural-snapshot"],"screenshot":true,"recordingSegment":false,"platformCaptured":true}]$json$::jsonb
  ELSE '[]'::jsonb
END;
--> statement-breakpoint
-- `drizzle-kit generate` does not write this line. The compatibility range is generation
-- 11 in the same change; only release/CI runs the migrator (AD-15).
INSERT INTO "schema_meta" ("version") VALUES (11);