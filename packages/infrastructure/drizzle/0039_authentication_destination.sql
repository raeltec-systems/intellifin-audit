ALTER TABLE "target_system_registration" ADD COLUMN "authentication_destination" text;--> statement-breakpoint
ALTER TABLE "target_system_registration" ADD CONSTRAINT "target_system_registration_authentication_destination_shape" CHECK ("target_system_registration"."authentication_destination" IS NULL OR (
        "target_system_registration"."kind" = 'web'
        AND
        length("target_system_registration"."authentication_destination") BETWEEN 1 AND 2048
        AND btrim("target_system_registration"."authentication_destination") = "target_system_registration"."authentication_destination"
        AND "target_system_registration"."authentication_destination" ~* '^https?://[^[:space:]?#@]+$'
      ));
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (39) ON CONFLICT ("version") DO NOTHING;
