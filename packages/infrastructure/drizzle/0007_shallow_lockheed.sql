CREATE TABLE "procedure" (
	"procedure_id" uuid PRIMARY KEY NOT NULL,
	"control_name" text NOT NULL,
	"template_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_template_vocabulary" CHECK ("procedure"."template_id" IN ('P-1', 'P-2', 'P-3', 'P-4')),
	CONSTRAINT "procedure_control_name_present" CHECK (btrim("procedure"."control_name") <> '')
);
--> statement-breakpoint
CREATE TABLE "procedure_version" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"procedure_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"state" text NOT NULL,
	"control_name" text NOT NULL,
	"template_id" text NOT NULL,
	"sections" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_version_template_vocabulary" CHECK ("procedure_version"."template_id" IN ('P-1', 'P-2', 'P-3', 'P-4')),
	CONSTRAINT "procedure_version_control_name_present" CHECK (btrim("procedure_version"."control_name") <> ''),
	CONSTRAINT "procedure_version_state_vocabulary" CHECK ("procedure_version"."state" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'RETIRED')),
	CONSTRAINT "procedure_version_number_at_least_one" CHECK ("procedure_version"."version_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "procedure_version" ADD CONSTRAINT "procedure_version_procedure_id_procedure_procedure_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedure"("procedure_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "procedure_version_procedure_number_uidx" ON "procedure_version" USING btree ("procedure_id","version_number");
--> statement-breakpoint
-- `drizzle-kit generate` does not write this line, so it is appended by hand and
-- `SUPPORTED_SCHEMA_MAX` is raised to 7 in the same commit (AD-15). Only the release and
-- CI migrator ever executes it; no process migrates at startup.
INSERT INTO "schema_meta" ("version") VALUES (7) ON CONFLICT ("version") DO NOTHING;
