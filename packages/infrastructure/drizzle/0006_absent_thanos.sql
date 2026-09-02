-- Generation 6.
--
-- The Population Source binding table (FR-6, FR-41). One new table, so generation 6 is
-- backward compatible with generation 5 during a rolling deploy: a generation-5 process
-- never selects from it.
--
-- Four of the CHECK constraints are the real point.
--
--   `..._sensitive_fields_declared` is FR-41's masking rule at the one layer nothing can
--   route around: `sensitive_fields <@ declared_schema` means no command, no migration
--   and no psql session can store a mask over a field the schema does not declare. Such
--   a mask hides nothing while reading, in a list view, exactly like protection.
--
--   `..._schema_present` refuses a binding that declares no fields at all. It is written
--   with `cardinality`, because `array_length(x, 1)` of an empty array is NULL and a
--   NULL CHECK PASSES -- the obvious spelling accepts exactly the row it forbids.
--
--   `..._location_matches_kind` holds both directions. A versioned file or read-only API
--   with no location points at nothing; a manual upload WITH one holds a value the
--   digest deliberately drops, so the row would say something the frozen contract does
--   not.
--
--   `..._digest_format` refuses anything that is not lower-case SHA-256 hex.
--
-- No credential is stored here and there is no column one could go in. A `read-only-api`
-- binding names a location; the credential a Run uses belongs to the Target System
-- registration, which already proved it read-only.

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
	CONSTRAINT "population_source_binding_schema_present" CHECK (cardinality("population_source_binding"."declared_schema") >= 1),
	CONSTRAINT "population_source_binding_sensitive_fields_declared" CHECK ("population_source_binding"."sensitive_fields" <@ "population_source_binding"."declared_schema"),
	CONSTRAINT "population_source_binding_location_matches_kind" CHECK (("population_source_binding"."kind" = 'manual-upload' AND "population_source_binding"."location" = '') OR ("population_source_binding"."kind" <> 'manual-upload' AND btrim("population_source_binding"."location") <> '')),
	CONSTRAINT "population_source_binding_digest_format" CHECK ("population_source_binding"."digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
-- `drizzle-kit generate` does not write this line, so it is appended by hand and
-- `SUPPORTED_SCHEMA_MAX` is raised to 6 in the same commit (AD-15). Only the release and
-- CI migrator ever executes it; no process migrates at startup.
INSERT INTO "schema_meta" ("version") VALUES (6) ON CONFLICT ("version") DO NOTHING;
