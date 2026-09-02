-- Generation 5.
--
-- The Target System registration table and the connectivity table the WORKER writes and
-- the web only reads (FR-8, AD-2, AD-10). Both are new tables, so generation 5 is
-- backward compatible with generation 4 during a rolling deploy: a generation-4 process
-- never selects from either.
--
-- Three of the CHECK constraints are the real point. `..._actions_read_only` is FR-8's
-- "write-capable credentials are rejected" expressed at the one layer nothing can route
-- around: no command, no migration and no psql session can put an action outside the read
-- vocabulary into `permitted_actions`. `..._actions_present` refuses a registration that
-- permits nothing — written with `cardinality`, because `array_length(x, 1)` of an empty
-- array is NULL and a NULL CHECK passes, which would accept exactly the row it forbids.
-- `..._digest_format` refuses anything that is not lower-case SHA-256 hex.
--
-- No secret is stored anywhere here. `credential_ref` is an opaque REFERENCE; the value
-- it points at lives outside this database and never enters the web process.

CREATE TABLE "target_system_probe" (
	"registration_id" uuid PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"observed_by" text NOT NULL,
	CONSTRAINT "target_system_probe_state_vocabulary" CHECK ("target_system_probe"."state" IN ('reachable', 'unreachable'))
);
--> statement-breakpoint
CREATE TABLE "target_system_registration" (
	"registration_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"application_identity" text DEFAULT '' NOT NULL,
	"credential_ref" text NOT NULL,
	"permitted_actions" text[] NOT NULL,
	"attribute_label_patterns" text[] DEFAULT '{}'::text[] NOT NULL,
	"secondary_key" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "target_system_registration_kind_vocabulary" CHECK ("target_system_registration"."kind" IN ('web', 'desktop', 'api', 'versioned-file')),
	CONSTRAINT "target_system_registration_status_vocabulary" CHECK ("target_system_registration"."status" IN ('active', 'retired')),
	CONSTRAINT "target_system_registration_actions_read_only" CHECK ("target_system_registration"."permitted_actions" <@ ARRAY['navigate', 'search', 'list-records', 'open-record', 'read-attribute', 'read-metadata', 'read-file', 'capture-screenshot']::text[]),
	CONSTRAINT "target_system_registration_actions_present" CHECK (cardinality("target_system_registration"."permitted_actions") >= 1),
	CONSTRAINT "target_system_registration_digest_format" CHECK ("target_system_registration"."digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "target_system_probe" ADD CONSTRAINT "target_system_probe_registration_id_target_system_registration_registration_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."target_system_registration"("registration_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- `drizzle-kit generate` does not write this line, so it is appended by hand and
-- `SUPPORTED_SCHEMA_MAX` is raised to 5 in the same commit (AD-15). Only the release and
-- CI migrator ever executes it; no process migrates at startup.
INSERT INTO "schema_meta" ("version") VALUES (5) ON CONFLICT ("version") DO NOTHING;
