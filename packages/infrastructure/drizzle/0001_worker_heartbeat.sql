CREATE TABLE "worker_heartbeat" (
	"hostname" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- AD-15: the release pipeline alone applies migrations and it alone records the
-- schema generation each process checks at startup. Story 1.1 ships generation 1.
INSERT INTO "schema_meta" ("version") VALUES (1) ON CONFLICT ("version") DO NOTHING;
