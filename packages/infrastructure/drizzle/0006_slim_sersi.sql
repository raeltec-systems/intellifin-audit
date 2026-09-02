-- Generation 6.
--
-- The Population Source binding table (FR-6, FR-41) — the other half of what a Procedure
-- Version freezes. Story 1.6 froze what the agent may READ; this freezes where the
-- population comes FROM.
--
-- Every CHECK here is the layer nothing can route around. Two of them were tightened
-- after review found the same trap twice, one operator apart:
--
--   * `cardinality(x) >= 1` counts ELEMENTS, not names, so `ARRAY[NULL]` and `ARRAY['']`
--     both passed a rule meaning "declares at least one field". A NULL element then
--     leaves the repository typed `string[]`, and an empty name is a field nothing can
--     ever match. `array_position(x, NULL) IS NULL` is the NULL test that works —
--     `NULL <> ALL(x)` returns NULL, and a NULL CHECK PASSES, which is the same trap
--     `array_length` sets.
--   * `sensitive_fields <@ declared_schema` is NULL, and therefore passes, when
--     `sensitive_fields` holds a NULL element.
--
-- The generation-5 constraint on `target_system_registration.permitted_actions` had the
-- first hole too, so this generation replaces it. Generation 5 has never been applied
-- outside a test database — production is at generation 4 — so this is a correction in
-- flight rather than a migration of live data.
--
-- No secret is stored here. A binding names a LOCATION; the credential a Run uses
-- belongs to the Target System registration, which already proves it read-only.

CREATE TABLE "population_source_binding" (
	"binding_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"declared_schema" text[] NOT NULL,
	"declared_count_mechanism" text NOT NULL,
	"sensitive_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "population_source_binding_kind_vocabulary" CHECK ("population_source_binding"."kind" IN ('manual-upload', 'versioned-file', 'read-only-api')),
	CONSTRAINT "population_source_binding_mechanism_vocabulary" CHECK ("population_source_binding"."declared_count_mechanism" IN ('cover-sheet', 'count-endpoint', 'none')),
	CONSTRAINT "population_source_binding_status_vocabulary" CHECK ("population_source_binding"."status" IN ('active', 'retired')),
	CONSTRAINT "population_source_binding_schema_present" CHECK (cardinality("population_source_binding"."declared_schema") >= 1
        AND array_position("population_source_binding"."declared_schema", NULL) IS NULL
        AND '' <> ALL ("population_source_binding"."declared_schema")),
	CONSTRAINT "population_source_binding_sensitive_fields_declared" CHECK ("population_source_binding"."sensitive_fields" <@ "population_source_binding"."declared_schema"
        AND array_position("population_source_binding"."sensitive_fields", NULL) IS NULL),
	CONSTRAINT "population_source_binding_location_matches_kind" CHECK (("population_source_binding"."kind" = 'manual-upload' AND "population_source_binding"."location" = '') OR ("population_source_binding"."kind" <> 'manual-upload' AND btrim("population_source_binding"."location") <> '')),
	CONSTRAINT "population_source_binding_digest_format" CHECK ("population_source_binding"."digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "target_system_registration" DROP CONSTRAINT "target_system_registration_actions_present";--> statement-breakpoint
ALTER TABLE "target_system_registration" ADD CONSTRAINT "target_system_registration_actions_present" CHECK (cardinality("target_system_registration"."permitted_actions") >= 1
        AND array_position("target_system_registration"."permitted_actions", NULL) IS NULL);--> statement-breakpoint
-- `drizzle-kit generate` does not write this line, so it is appended by hand and
-- `SUPPORTED_SCHEMA_MAX` is raised to 6 in the same commit (AD-15). Only the release and
-- CI migrator ever executes it; no process migrates at startup.
INSERT INTO "schema_meta" ("version") VALUES (6) ON CONFLICT ("version") DO NOTHING;
