-- Generation 4.
--
-- `assigned_by` becomes a real reference now that Story 1.5 writes it for real: an
-- attribution column that can hold any string is not an attribution. `SET NULL` rather
-- than `CASCADE`, because removing the administrator who granted a role must not remove
-- the role — that would be a silent privilege revocation nothing audited.
--
-- The UPDATE runs first and is deliberate. Adding a foreign key validates every existing
-- row, so one value that does not match a user fails the whole migration and, with it,
-- the release. Every row today holds NULL and `seed-identity.mts` only ever writes NULL,
-- so this clears nothing in practice — it is here so that a release cannot be stopped by
-- data written before the column had a meaning.
UPDATE "user_role"
   SET "assigned_by" = NULL
 WHERE "assigned_by" IS NOT NULL
   AND "assigned_by" NOT IN (SELECT "id" FROM "auth_user");--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_assigned_by_auth_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."auth_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_user_email_lower_uidx" ON "auth_user" USING btree (lower("email"));--> statement-breakpoint
-- Generation 4 adds a foreign key on a column generation 3 already had, and a unique
-- index on an expression over a column it already had, so it is backward compatible with
-- generation 3 during a rolling deploy. Only the release/CI migrator executes this
-- statement (AD-15); `drizzle-kit generate` does not write it, so it is appended by hand
-- and `SUPPORTED_SCHEMA_MAX` is raised to 4 in the same commit.
INSERT INTO "schema_meta" ("version") VALUES (4) ON CONFLICT ("version") DO NOTHING;
