CREATE TABLE "schema_meta" (
	"version" integer PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
