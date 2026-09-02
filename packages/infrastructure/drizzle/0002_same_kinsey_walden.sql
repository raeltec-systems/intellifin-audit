CREATE TABLE "audit_event_heads" (
	"aggregate_id" text PRIMARY KEY NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"last_event_hash" text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	CONSTRAINT "audit_event_heads_sequence_nonnegative" CHECK ("audit_event_heads"."last_sequence" >= 0),
	CONSTRAINT "audit_event_heads_hash_format" CHECK ("audit_event_heads"."last_event_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"outcome" text NOT NULL,
	"session_id" text NOT NULL,
	"correlation_id" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"payload" jsonb NOT NULL,
	"previous_hash" text NOT NULL,
	"event_hash" text NOT NULL,
	CONSTRAINT "audit_events_sequence_positive" CHECK ("audit_events"."sequence" > 0),
	CONSTRAINT "audit_events_previous_hash_format" CHECK ("audit_events"."previous_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "audit_events_event_hash_format" CHECK ("audit_events"."event_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_aggregate_id_audit_event_heads_aggregate_id_fk" FOREIGN KEY ("aggregate_id") REFERENCES "public"."audit_event_heads"("aggregate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_aggregate_sequence_uidx" ON "audit_events" USING btree ("aggregate_id","sequence");--> statement-breakpoint
CREATE INDEX "audit_events_correlation_idx" ON "audit_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "audit_events_type_time_idx" ON "audit_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
-- Generation 2 is backward compatible with generation 1 during rolling deploys.
-- Only the release/CI migrator executes this statement (AD-15).
INSERT INTO "schema_meta" ("version") VALUES (2) ON CONFLICT ("version") DO NOTHING;
