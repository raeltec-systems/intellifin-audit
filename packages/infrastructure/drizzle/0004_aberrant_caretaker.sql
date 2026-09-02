ALTER TABLE "user_role" ADD CONSTRAINT "user_role_assigned_by_auth_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Generation 4 only adds a foreign key on a column generation 3 already had, and every
-- existing row holds NULL there, so it is backward compatible with generation 3 during a
-- rolling deploy. Only the release/CI migrator executes this statement (AD-15);
-- `drizzle-kit generate` does not write it, so it is appended by hand and
-- `SUPPORTED_SCHEMA_MAX` is raised to 4 in the same commit.
INSERT INTO "schema_meta" ("version") VALUES (4) ON CONFLICT ("version") DO NOTHING;
