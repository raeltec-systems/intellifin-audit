CREATE TABLE "run_control_transfer" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"request_key" uuid NOT NULL,
	"expected_epoch" integer NOT NULL,
	"prior_holder_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_control_transfer_epoch" CHECK ("run_control_transfer"."expected_epoch" BETWEEN 1 AND 2147483646),
	CONSTRAINT "run_control_transfer_fingerprint" CHECK ("run_control_transfer"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "run_control_transfer_holder" CHECK ("run_control_transfer"."actor_id" <> "run_control_transfer"."prior_holder_id")
);
--> statement-breakpoint
CREATE TABLE "run_control_transfer_content" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" text,
	"content_epoch" integer DEFAULT 1 NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "run_control_transfer_content_bound" CHECK ("run_control_transfer_content"."ciphertext" IS NULL OR (octet_length("run_control_transfer_content"."ciphertext") <= 90000 AND "run_control_transfer_content"."ciphertext" ~ '^v1\.[A-Za-z0-9_-]+$')),
	CONSTRAINT "run_control_transfer_content_removal" CHECK (("run_control_transfer_content"."ciphertext" IS NULL) = ("run_control_transfer_content"."removed_at" IS NOT NULL) AND "run_control_transfer_content"."content_epoch" >= 1)
);
--> statement-breakpoint
CREATE TABLE "run_control_transfer_receipt" (
	"command_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_permission_grant" (
	"user_id" text NOT NULL,
	"permission" text NOT NULL,
	"granted" boolean NOT NULL,
	"revision" integer NOT NULL,
	"assigned_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_permission_grant_user_id_permission_pk" PRIMARY KEY("user_id","permission"),
	CONSTRAINT "user_permission_vocabulary" CHECK ("user_permission_grant"."permission" = 'run.control-transfer'),
	CONSTRAINT "user_permission_revision" CHECK ("user_permission_grant"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "run_control_lease" ADD COLUMN "transfer_command_id" uuid;--> statement-breakpoint
ALTER TABLE "run_control_transfer" ADD CONSTRAINT "run_control_transfer_run_id_audit_run_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."audit_run"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_control_transfer_content" ADD CONSTRAINT "run_control_transfer_content_command_id_run_control_transfer_command_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."run_control_transfer"("command_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_control_transfer_receipt" ADD CONSTRAINT "run_control_transfer_receipt_command_id_run_control_transfer_command_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."run_control_transfer"("command_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_control_transfer_receipt" ADD CONSTRAINT "run_control_transfer_receipt_event_id_audit_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."audit_events"("event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permission_grant" ADD CONSTRAINT "user_permission_grant_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_control_transfer_request_uidx" ON "run_control_transfer" USING btree ("run_id","actor_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "run_control_transfer_run_command_uidx" ON "run_control_transfer" USING btree ("run_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_control_transfer_receipt_event_uidx" ON "run_control_transfer_receipt" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "run_control_lease" ADD CONSTRAINT "run_control_lease_transfer_fk" FOREIGN KEY ("run_id","transfer_command_id") REFERENCES "public"."run_control_transfer"("run_id","command_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE run_control_lease ALTER CONSTRAINT run_control_lease_transfer_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE run_control_transfer_receipt ALTER CONSTRAINT run_control_transfer_receipt_event_id_audit_events_event_id_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- Absent role/grant rows still serialize on the stable identity.
CREATE FUNCTION lock_permission_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Role identity is immutable' USING ERRCODE='23514';
  END IF;
  target = CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  PERFORM 1 FROM auth_user WHERE id=target FOR UPDATE;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_role_identity_lock BEFORE INSERT OR UPDATE OR DELETE ON user_role
FOR EACH ROW EXECUTE FUNCTION lock_permission_identity();
--> statement-breakpoint
CREATE FUNCTION guard_permission_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM auth_user WHERE id=OLD.user_id) THEN
      RAISE EXCEPTION 'Permission revocation retains its revision' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  PERFORM 1 FROM auth_user WHERE id IN (NEW.user_id,NEW.assigned_by) ORDER BY id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM user_role WHERE user_id=NEW.assigned_by AND role='poc-administrator') THEN
    RAISE EXCEPTION 'Permission administration requires current administrator authority' USING ERRCODE='23514';
  END IF;
  IF NEW.granted AND NOT EXISTS (SELECT 1 FROM user_role WHERE user_id=NEW.user_id AND role='audit-manager') THEN
    RAISE EXCEPTION 'Only a current manager may hold transfer permission' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.revision<>1 OR NOT NEW.granted THEN RAISE EXCEPTION 'Permission starts with an explicit first grant' USING ERRCODE='23514'; END IF;
  ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.permission IS DISTINCT FROM OLD.permission OR
    NEW.revision<>OLD.revision+1 OR NEW.granted=OLD.granted OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'Permission identity and revision are immutable and monotonic' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER permission_grant_guard BEFORE INSERT OR UPDATE OR DELETE ON user_permission_grant
FOR EACH ROW EXECUTE FUNCTION guard_permission_grant();
--> statement-breakpoint
CREATE FUNCTION permission_role_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
  target=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  IF EXISTS (SELECT 1 FROM user_permission_grant WHERE user_id=target AND granted)
    AND NOT EXISTS (SELECT 1 FROM user_role WHERE user_id=target AND role='audit-manager') THEN
    RAISE EXCEPTION 'Role removal must revoke transfer permission atomically' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER permission_role_consistency AFTER INSERT OR UPDATE OR DELETE ON user_role
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION permission_role_consistency();
--> statement-breakpoint
CREATE FUNCTION bind_permission_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth_user WHERE id=NEW.user_id) AND NOT EXISTS (
    SELECT 1 FROM audit_events e WHERE e.event_type='configuration.user-permission-changed' AND e.aggregate_id='platform'
      AND e.source='web' AND e.outcome='success' AND e.actor_type='human' AND e.actor_id=NEW.assigned_by
      AND e.payload->'subjectUserId'=to_jsonb(NEW.user_id) AND e.payload->'permission'=to_jsonb(NEW.permission)
      AND e.payload->'revision'=to_jsonb(NEW.revision) AND e.payload->'priorRevision'=to_jsonb(NEW.revision-1)
      AND e.payload->'granted'=to_jsonb(NEW.granted) AND e.payload->'priorGranted'=to_jsonb(NOT NEW.granted)) THEN
    RAISE EXCEPTION 'Permission change requires its exact atomic audit event' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER permission_event_bound AFTER INSERT OR UPDATE ON user_permission_grant
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bind_permission_event();
--> statement-breakpoint
CREATE UNIQUE INDEX audit_events_permission_revision_uidx ON audit_events
((payload->>'subjectUserId'),(payload->>'permission'),(payload->>'revision')) WHERE event_type='configuration.user-permission-changed';
--> statement-breakpoint
CREATE FUNCTION guard_permission_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grant_row user_permission_grant%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (OLD.event_type='configuration.user-permission-changed' OR NEW.event_type='configuration.user-permission-changed') THEN
    RAISE EXCEPTION 'Permission receipts are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.event_type<>'configuration.user-permission-changed' THEN RETURN NEW; END IF;
  SELECT * INTO grant_row FROM user_permission_grant WHERE user_id=NEW.payload->>'subjectUserId' AND permission=NEW.payload->>'permission';
  IF grant_row.user_id IS NULL OR NEW.aggregate_id<>'platform' OR NEW.actor_type<>'human' OR NEW.source<>'web' OR NEW.outcome<>'success'
    OR NEW.actor_id<>grant_row.assigned_by OR NOT coalesce(NEW.payload->>'cause' IN ('administration','role-change'),false)
    OR NEW.payload IS DISTINCT FROM jsonb_build_object('subjectUserId',grant_row.user_id,'permission',grant_row.permission,
      'priorGranted',NOT grant_row.granted,'granted',grant_row.granted,'priorRevision',grant_row.revision-1,'revision',grant_row.revision,'cause',NEW.payload->>'cause') THEN
    RAISE EXCEPTION 'Permission receipt requires its exact grant transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER permission_event_guard BEFORE INSERT OR UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION guard_permission_event();
--> statement-breakpoint
CREATE FUNCTION retain_permission_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.event_type='configuration.user-permission-changed' AND EXISTS (SELECT 1 FROM auth_user WHERE id=OLD.payload->>'subjectUserId') THEN
    RAISE EXCEPTION 'Permission receipts survive with their identity' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER permission_event_retained AFTER DELETE ON audit_events DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION retain_permission_event();
--> statement-breakpoint
CREATE FUNCTION guard_control_transfer_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Transfer proposal identity is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM audit_run WHERE run_id=OLD.run_id) THEN RAISE EXCEPTION 'Transfer proposal survives with its Run' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  PERFORM 1 FROM audit_run WHERE run_id=NEW.run_id FOR UPDATE;
  PERFORM 1 FROM auth_user WHERE id=NEW.actor_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM audit_run r JOIN run_control_lease l USING(run_id)
      JOIN user_role role ON role.user_id=NEW.actor_id AND role.role='audit-manager'
      JOIN user_permission_grant g ON g.user_id=NEW.actor_id AND g.permission='run.control-transfer' AND g.granted
    WHERE r.run_id=NEW.run_id AND r.state IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR') AND l.epoch=NEW.expected_epoch
      AND l.holder_id=NEW.prior_holder_id AND l.holder_id<>NEW.actor_id AND l.expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Transfer proposal requires exact live controller and manager grant' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER control_transfer_proposal_guard BEFORE INSERT OR UPDATE OR DELETE ON run_control_transfer
FOR EACH ROW EXECUTE FUNCTION guard_control_transfer_proposal();
--> statement-breakpoint
CREATE FUNCTION guard_control_transfer_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM run_control_transfer WHERE command_id=OLD.command_id) THEN
      RAISE EXCEPTION 'Transfer content tombstone survives with its proposal' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.command_id<>OLD.command_id OR OLD.removed_at IS NOT NULL OR NEW.content_epoch<>OLD.content_epoch+1
    OR NEW.ciphertext IS NOT NULL OR NEW.removed_at IS NULL THEN
    RAISE EXCEPTION 'Transfer content requires monotonic governance and cannot restore removed content' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER control_transfer_content_guard BEFORE UPDATE OR DELETE ON run_control_transfer_content
FOR EACH ROW EXECUTE FUNCTION guard_control_transfer_content();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_run_control_lease() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposal run_control_transfer%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM audit_run WHERE run_id=OLD.run_id) THEN RAISE EXCEPTION 'Run control fencing cannot be removed' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.epoch<>1 OR NEW.transfer_command_id IS NOT NULL THEN RAISE EXCEPTION 'Run control starts at epoch one without a transfer' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.run_id IS DISTINCT FROM OLD.run_id OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'Run control identity and time are monotonic' USING ERRCODE='23514';
  END IF;
  IF NEW.transfer_command_id IS DISTINCT FROM OLD.transfer_command_id THEN
    PERFORM 1 FROM audit_run WHERE run_id=NEW.run_id FOR UPDATE;
    SELECT * INTO proposal FROM run_control_transfer WHERE command_id=NEW.transfer_command_id AND run_id=NEW.run_id;
    PERFORM 1 FROM auth_user WHERE id=proposal.actor_id FOR UPDATE;
    IF proposal.command_id IS NULL OR EXISTS (SELECT 1 FROM run_control_transfer_receipt WHERE command_id=proposal.command_id)
      OR NOT coalesce(NEW.epoch=OLD.epoch+1 AND OLD.epoch=proposal.expected_epoch AND OLD.holder_id=proposal.prior_holder_id
        AND NEW.holder_id=proposal.actor_id AND NEW.holder_id<>OLD.holder_id AND OLD.expires_at>clock_timestamp()
        AND NEW.updated_at>=proposal.created_at AND NEW.updated_at<=clock_timestamp()
        AND NEW.updated_at>=clock_timestamp()-interval '5 seconds' AND NEW.expires_at=NEW.updated_at+interval '120 seconds',false)
      OR NOT EXISTS (SELECT 1 FROM audit_run WHERE run_id=NEW.run_id AND state IN ('QUEUED','RUNNING','PAUSED','AWAITING_AUDITOR'))
      OR NOT EXISTS (SELECT 1 FROM user_role r JOIN user_permission_grant g ON g.user_id=r.user_id AND g.permission='run.control-transfer'
        WHERE r.user_id=proposal.actor_id AND r.role='audit-manager' AND g.granted)
      OR NOT EXISTS (SELECT 1 FROM run_control_transfer_content WHERE command_id=proposal.command_id AND ciphertext IS NOT NULL AND removed_at IS NULL) THEN
      RAISE EXCEPTION 'Live controller transfer requires its exact granted manager proposal' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.epoch=OLD.epoch THEN
    IF NOT coalesce(OLD.holder_id IS NOT NULL AND NEW.holder_id=OLD.holder_id AND NEW.updated_at<OLD.expires_at AND NEW.expires_at>=OLD.expires_at,false) THEN
      RAISE EXCEPTION 'Only a live holder may renew its current epoch' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.epoch=OLD.epoch+1 THEN
    IF OLD.holder_id IS NOT NULL AND NEW.holder_id IS NOT NULL AND OLD.expires_at>NEW.updated_at THEN
      RAISE EXCEPTION 'A live controller must release before reacquisition' USING ERRCODE='23514';
    END IF;
  ELSE RAISE EXCEPTION 'Run control epochs advance exactly once per transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION control_transfer_receipt_valid(proposal run_control_transfer, fact audit_events) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(fact.aggregate_id=proposal.run_id::text AND fact.actor_type='human' AND fact.actor_id=proposal.actor_id
    AND fact.source='web' AND fact.outcome='success' AND fact.event_type='lifecycle.run-control-lease-transferred'
    AND fact.payload=jsonb_build_object('operation','transfer','commandId',proposal.command_id::text,'requestKey',proposal.request_key::text,
      'expectedEpoch',proposal.expected_epoch,'priorEpoch',proposal.expected_epoch,'priorHolderId',proposal.prior_holder_id,
      'epoch',proposal.expected_epoch+1,'holderId',proposal.actor_id,'reasonRef',proposal.command_id::text,
      'updatedAt',to_char(fact.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt',to_char((fact.occurred_at+interval '120 seconds') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),false)
$$;
--> statement-breakpoint
CREATE FUNCTION guard_control_transfer_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposal run_control_transfer%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND (OLD.event_type='lifecycle.run-control-lease-transferred' OR NEW.event_type='lifecycle.run-control-lease-transferred') THEN
    RAISE EXCEPTION 'Transfer facts are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.event_type<>'lifecycle.run-control-lease-transferred' THEN RETURN NEW; END IF;
  IF NOT coalesce(jsonb_typeof(NEW.payload->'commandId')='string' AND
    NEW.payload->>'commandId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false) THEN
    RAISE EXCEPTION 'Transfer fact requires a valid command identity' USING ERRCODE='23514';
  END IF;
  SELECT * INTO proposal FROM run_control_transfer WHERE command_id=(NEW.payload->>'commandId')::uuid;
  IF proposal.command_id IS NULL OR NOT control_transfer_receipt_valid(proposal,NEW) OR NOT EXISTS (
    SELECT 1 FROM run_control_lease WHERE run_id=proposal.run_id AND transfer_command_id=proposal.command_id
      AND holder_id=proposal.actor_id AND epoch=proposal.expected_epoch+1 AND updated_at=NEW.occurred_at
      AND expires_at=NEW.occurred_at+interval '120 seconds') THEN
    RAISE EXCEPTION 'Transfer fact requires its exact authoritative lease transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER control_transfer_fact_guard BEFORE INSERT OR UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION guard_control_transfer_fact();
--> statement-breakpoint
CREATE FUNCTION guard_control_transfer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Transfer receipts are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM run_control_transfer WHERE command_id=OLD.command_id) THEN RAISE EXCEPTION 'Transfer receipt survives with its proposal' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM run_control_transfer c JOIN audit_events e ON e.event_id=NEW.event_id
    WHERE c.command_id=NEW.command_id AND control_transfer_receipt_valid(c,e)) THEN
    RAISE EXCEPTION 'Transfer receipt requires its exact domain event' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER control_transfer_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON run_control_transfer_receipt
FOR EACH ROW EXECUTE FUNCTION guard_control_transfer_receipt();
--> statement-breakpoint
CREATE FUNCTION bind_control_transfer_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='run_control_lease' THEN
    IF TG_OP='INSERT' OR NEW.transfer_command_id IS NOT DISTINCT FROM OLD.transfer_command_id THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM audit_run WHERE run_id=NEW.run_id) AND NOT EXISTS (SELECT 1 FROM run_control_transfer c
      JOIN run_control_transfer_receipt receipt ON receipt.command_id=c.command_id JOIN audit_events e ON e.event_id=receipt.event_id
      WHERE c.command_id=NEW.transfer_command_id AND c.run_id=NEW.run_id AND control_transfer_receipt_valid(c,e)
        AND NEW.epoch=c.expected_epoch+1 AND NEW.holder_id=c.actor_id AND NEW.updated_at=e.occurred_at) THEN
      RAISE EXCEPTION 'Transferred lease requires its exact atomic receipt' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.event_type='lifecycle.run-control-lease-transferred' AND NOT EXISTS (SELECT 1 FROM run_control_transfer_receipt
    WHERE event_id=NEW.event_id AND command_id::text=NEW.payload->>'commandId') THEN
    RAISE EXCEPTION 'Transfer fact requires its atomic receipt' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER control_transfer_lease_bound AFTER UPDATE ON run_control_lease DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bind_control_transfer_event();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER control_transfer_fact_bound AFTER INSERT ON audit_events DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bind_control_transfer_event();
--> statement-breakpoint
CREATE FUNCTION retain_control_transfer_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.event_type='lifecycle.run-control-lease-transferred' AND EXISTS (SELECT 1 FROM audit_run WHERE run_id::text=OLD.aggregate_id) THEN
    RAISE EXCEPTION 'Transfer facts survive with their Run' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER control_transfer_fact_retained AFTER DELETE ON audit_events DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION retain_control_transfer_fact();
--> statement-breakpoint
INSERT INTO schema_meta(version) VALUES (60);
