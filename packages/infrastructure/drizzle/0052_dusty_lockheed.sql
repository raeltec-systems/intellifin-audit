CREATE TABLE "run_conversation_content" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" text,
	"content_epoch" integer DEFAULT 1 NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "run_conversation_content_bound" CHECK ("run_conversation_content"."ciphertext" IS NULL OR (octet_length("run_conversation_content"."ciphertext") <= 90000 AND "run_conversation_content"."ciphertext" ~ '^v1\.[A-Za-z0-9_-]+$')),
	CONSTRAINT "run_conversation_content_removal" CHECK (("run_conversation_content"."ciphertext" IS NULL) = ("run_conversation_content"."removed_at" IS NOT NULL) AND "run_conversation_content"."content_epoch" >= 1)
);
--> statement-breakpoint
CREATE TABLE "run_conversation_message" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"parent_message_id" uuid,
	"request_key" uuid,
	"semantic_fingerprint" text,
	"context_revision" text,
	"source_ordinal" integer,
	"reply_to_wait_id" uuid,
	"source_event_sequence" integer,
	CONSTRAINT "run_conversation_sequence_bound" CHECK ("run_conversation_message"."sequence" BETWEEN 1 AND 1000000),
	CONSTRAINT "run_conversation_kind" CHECK ("run_conversation_message"."kind" IN ('auditor-message','platform-event','agent-explanation','decision-request','command-receipt','finding','evidence-reference','security-notice','annotation')),
	CONSTRAINT "run_conversation_request_binding" CHECK (("run_conversation_message"."request_key" IS NULL) = ("run_conversation_message"."semantic_fingerprint" IS NULL) AND ("run_conversation_message"."semantic_fingerprint" IS NULL OR "run_conversation_message"."semantic_fingerprint" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "run_conversation_source_ordinal" CHECK ("run_conversation_message"."source_ordinal" IS NULL OR "run_conversation_message"."source_ordinal" BETWEEN 1 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "run_conversation_content" ADD CONSTRAINT "run_conversation_content_message_id_run_conversation_message_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."run_conversation_message"("message_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_conversation_message" ADD CONSTRAINT "run_conversation_message_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_conversation_sequence" ON "run_conversation_message" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "run_conversation_request" ON "run_conversation_message" USING btree ("run_id","actor_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "run_conversation_response" ON "run_conversation_message" USING btree ("parent_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_conversation_source_event" ON "run_conversation_message" USING btree ("run_id","source_event_sequence");--> statement-breakpoint
CREATE INDEX "run_conversation_actor_created" ON "run_conversation_message" USING btree ("actor_id","created_at");
--> statement-breakpoint
CREATE FUNCTION run_conversation_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    RAISE EXCEPTION 'Conversation metadata is immutable' USING ERRCODE='23514';
  ELSIF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM audit_run WHERE run_id=OLD.run_id) THEN
      RAISE EXCEPTION 'Conversation metadata survives with its Run' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.parent_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM run_conversation_message p WHERE p.message_id=NEW.parent_message_id
      AND p.run_id=NEW.run_id AND p.kind='auditor-message'
  ) THEN RAISE EXCEPTION 'Conversation response belongs to its Run request' USING ERRCODE='23514'; END IF;
  IF NEW.source_event_sequence IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM audit_events e WHERE e.aggregate_id=NEW.run_id::text AND e.sequence=NEW.source_event_sequence
  ) THEN RAISE EXCEPTION 'Conversation event reference belongs to its Run' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER run_conversation_metadata_guard BEFORE INSERT OR UPDATE OR DELETE ON run_conversation_message
FOR EACH ROW EXECUTE FUNCTION run_conversation_metadata_guard();
--> statement-breakpoint
CREATE FUNCTION run_conversation_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM run_conversation_message WHERE message_id=OLD.message_id) THEN
      RAISE EXCEPTION 'Remove governed content through its tombstone' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.message_id IS DISTINCT FROM OLD.message_id OR OLD.ciphertext IS NULL OR
    NEW.ciphertext IS NOT NULL OR NEW.removed_at IS NULL OR NEW.content_epoch<>OLD.content_epoch+1 THEN
    RAISE EXCEPTION 'Governed content permits removal, never silent replacement' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER run_conversation_content_guard BEFORE UPDATE OR DELETE ON run_conversation_content
FOR EACH ROW EXECUTE FUNCTION run_conversation_content_guard();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (52);
