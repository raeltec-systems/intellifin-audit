ALTER TABLE "procedure_version" ADD COLUMN "evidence_schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "evidence_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "schedule" jsonb;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_evidence_schema" CHECK ("procedure_version"."evidence_schema_version" = 1);--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_evidence_shape" CHECK (coalesce(jsonb_typeof("procedure_version"."evidence_requirements") = 'array' AND jsonb_array_length("procedure_version"."evidence_requirements") <= 32, false));--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_schedule_shape" CHECK ("procedure_version"."schedule" IS NULL OR coalesce(jsonb_typeof("procedure_version"."schedule") = 'object' AND "procedure_version"."schedule" - 'frequency' - 'startTime' - 'periodDerivationRule' = '{}'::jsonb AND "procedure_version"."schedule"->>'frequency' IN ('once','daily','weekly','monthly') AND jsonb_typeof("procedure_version"."schedule"->'periodDerivationRule') = 'string' AND "procedure_version"."schedule"->>'periodDerivationRule' = CASE "procedure_version"."schedule"->>'frequency' WHEN 'once' THEN 'explicit-period' WHEN 'daily' THEN 'previous-calendar-day' WHEN 'weekly' THEN 'previous-monday-sunday' WHEN 'monthly' THEN 'previous-calendar-month' END AND "procedure_version"."schedule"->>'startTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false));--> statement-breakpoint
-- Existing versions receive the same structured Template defaults a newly created Draft
-- gets (`initialDraftEvidence`). Only P-1 names structured Evidence Requirements; the
-- `platformCaptured` flag follows each version's persisted Target System selection,
-- which may differ from the Template after authoring or removal of a target.
-- P-1's pinned weekly Schedule uses an editable midnight UTC default. Other Templates
-- have no Schedule default. Existing authored section fields remain unchanged.
UPDATE "procedure_version"
SET "evidence_requirements" = CASE "template_id"
  WHEN 'P-1' THEN (
    SELECT jsonb_agg(requirement || jsonb_build_object('platformCaptured', EXISTS (
      SELECT 1 FROM jsonb_array_elements("procedure_version"."targets") AS target
      WHERE target->'contract'->>'kind' IN ('web', 'desktop')
    )) ORDER BY ordinal)
    FROM jsonb_array_elements($json$[{"attributeName":"username","modelRead":false,"groundedBy":["structural-snapshot"],"screenshot":true,"recordingSegment":false},{"attributeName":"account_status","modelRead":false,"groundedBy":["structural-snapshot"],"screenshot":true,"recordingSegment":false},{"attributeName":"roles","modelRead":false,"groundedBy":["structural-snapshot"],"screenshot":true,"recordingSegment":false}]$json$::jsonb)
      WITH ORDINALITY AS defaults(requirement, ordinal)
  )
  ELSE '[]'::jsonb
END,
"schedule" = CASE "template_id"
  WHEN 'P-1' THEN '{"frequency":"weekly","startTime":"00:00","periodDerivationRule":"previous-monday-sunday"}'::jsonb
  ELSE NULL
END;
--> statement-breakpoint
-- `drizzle-kit generate` does not write this line. The compatibility range is generation
-- 11 in the same change; only release/CI runs the migrator (AD-15).
INSERT INTO "schema_meta" ("version") VALUES (11);
