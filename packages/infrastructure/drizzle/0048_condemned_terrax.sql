-- Story 2.9: nullable metadata; no historical content or acknowledgements are invented.
ALTER TABLE "procedure_version" ADD COLUMN "section_preparation" jsonb;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_preparation_shape" CHECK ("procedure_version"."section_preparation" IS NULL OR coalesce(jsonb_typeof("procedure_version"."section_preparation") = 'object' AND "procedure_version"."section_preparation"->'schemaVersion' = '1'::jsonb AND jsonb_typeof("procedure_version"."section_preparation"->'revision') = 'number' AND jsonb_typeof("procedure_version"."section_preparation"->'sections') = 'object', false));
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (48);
