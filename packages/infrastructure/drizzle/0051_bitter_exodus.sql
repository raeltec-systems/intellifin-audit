CREATE TABLE "run_review_snapshot" (
	"snapshot_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revision" text NOT NULL,
	"query_digest" text NOT NULL,
	"cursor_key" text NOT NULL,
	"counts" jsonb NOT NULL,
	"row_count" integer NOT NULL,
	CONSTRAINT "run_review_snapshot_lifetime" CHECK ("run_review_snapshot"."expires_at" > "run_review_snapshot"."created_at" AND "run_review_snapshot"."expires_at" <= "run_review_snapshot"."created_at" + interval '10 minutes'),
	CONSTRAINT "run_review_snapshot_bounds" CHECK ("run_review_snapshot"."row_count" BETWEEN 0 AND 10000 AND jsonb_typeof("run_review_snapshot"."counts") = 'object'),
	CONSTRAINT "run_review_snapshot_secrets" CHECK ("run_review_snapshot"."cursor_key" ~ '^[a-f0-9]{64}$' AND "run_review_snapshot"."query_digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "run_review_snapshot_row" (
	"snapshot_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"row" jsonb NOT NULL,
	CONSTRAINT "run_review_snapshot_row_snapshot_id_position_pk" PRIMARY KEY("snapshot_id","position"),
	CONSTRAINT "run_review_snapshot_row_bounds" CHECK ("run_review_snapshot_row"."position" BETWEEN 0 AND 9999 AND jsonb_typeof("run_review_snapshot_row"."row") = 'object')
);
--> statement-breakpoint
ALTER TABLE "run_review_snapshot" ADD CONSTRAINT "run_review_snapshot_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_review_snapshot" ADD CONSTRAINT "run_review_snapshot_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_review_snapshot_row" ADD CONSTRAINT "run_review_snapshot_row_snapshot_id_run_review_snapshot_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."run_review_snapshot"("snapshot_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_review_snapshot_owner" ON "run_review_snapshot" USING btree ("actor_id","run_id","created_at");--> statement-breakpoint
CREATE INDEX "run_review_snapshot_expiry" ON "run_review_snapshot" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "run_observation_review_record" ON "run_observation" USING btree ("run_id","target_system","population_record_key");
--> statement-breakpoint
-- Presentation snapshots are insert-only for their lifetime. Expiry/owner eviction
-- deletes a whole snapshot; it never rewrites audit evidence or a sealed Result.
CREATE FUNCTION protect_review_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Review snapshots are immutable; create a fresh snapshot' USING ERRCODE='23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER review_snapshot_immutable BEFORE UPDATE ON run_review_snapshot
FOR EACH ROW EXECUTE FUNCTION protect_review_snapshot_update();
--> statement-breakpoint
CREATE TRIGGER review_snapshot_row_immutable BEFORE UPDATE ON run_review_snapshot_row
FOR EACH ROW EXECUTE FUNCTION protect_review_snapshot_update();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (51);
