CREATE TABLE "procedure_authoring_request" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"record" jsonb NOT NULL,
	CONSTRAINT "procedure_authoring_record_shape" CHECK (jsonb_typeof("procedure_authoring_request"."record") = 'object' AND coalesce("procedure_authoring_request"."record"->>'state' IN ('pending','ready','failed','accepted','rejected'), false))
);
--> statement-breakpoint
ALTER TABLE "procedure_authoring_request" ADD CONSTRAINT "procedure_authoring_request_version_id_procedure_version_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."procedure_version"("version_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_authoring_request" ADD CONSTRAINT "procedure_authoring_request_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_authoring_actor_created" ON "procedure_authoring_request" USING btree ("actor_id","created_at");
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (49);
