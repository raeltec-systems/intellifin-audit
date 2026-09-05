ALTER TABLE "procedure_version" ADD COLUMN "targets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD COLUMN "instructions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_targets_shape" CHECK (coalesce(jsonb_typeof("procedure_version"."targets") = 'array' AND jsonb_array_length("procedure_version"."targets") <= 32, false));--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_instructions_shape" CHECK (coalesce(jsonb_typeof("procedure_version"."instructions") = 'array' AND jsonb_array_length("procedure_version"."instructions") <= 32, false));--> statement-breakpoint
-- `drizzle-kit generate` does not write this line, so it is appended by hand and
-- `SUPPORTED_SCHEMA_MAX` is raised to 9 in the same commit (AD-15). Only the release and
-- CI migrator ever executes it; no process migrates at startup.
INSERT INTO "schema_meta" ("version") VALUES (9);
