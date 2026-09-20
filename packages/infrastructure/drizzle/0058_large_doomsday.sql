ALTER TABLE "run_control_lease" ADD COLUMN "renewal_request_key" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_control_renewal_request_uidx" ON "audit_events" USING btree ("aggregate_id","actor_id",("payload"->>'requestKey')) WHERE "audit_events"."event_type" = 'lifecycle.run-control-lease-renewed' AND "audit_events"."payload" ? 'requestKey';--> statement-breakpoint
-- Keyed renewals are immutable receipts retained for the lifetime of their Run.
-- Historical unkeyed events remain readable without migration or reinterpretation.
CREATE FUNCTION guard_control_renewal_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lease run_control_lease%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.event_type = 'lifecycle.run-control-lease-renewed' AND OLD.payload ? 'requestKey')
       OR (NEW.event_type = 'lifecycle.run-control-lease-renewed' AND NEW.payload ? 'requestKey') THEN
      RAISE EXCEPTION 'Controller renewal receipts are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.event_type <> 'lifecycle.run-control-lease-renewed' THEN RETURN NEW; END IF;
  IF NOT NEW.payload ? 'requestKey' THEN
    RAISE EXCEPTION 'New controller renewals require a request identity' USING ERRCODE = '23514';
  END IF;
  IF NOT coalesce(NEW.actor_type = 'human' AND NEW.source = 'web' AND NEW.outcome = 'success'
    AND length(btrim(NEW.actor_id)) > 0 AND length(btrim(NEW.session_id)) > 0
    AND length(btrim(NEW.correlation_id)) > 0
    AND NEW.aggregate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND jsonb_typeof(NEW.payload->'requestKey') = 'string'
    AND NEW.payload->>'requestKey' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false) THEN
    RAISE EXCEPTION 'Invalid controller renewal identity' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO lease FROM run_control_lease WHERE run_id = NEW.aggregate_id::uuid;
  IF lease.run_id IS NULL OR lease.renewal_request_key::text IS DISTINCT FROM NEW.payload->>'requestKey' OR
    NOT coalesce(lease.holder_id = NEW.actor_id AND lease.expires_at = lease.updated_at + interval '120 seconds', false) THEN
    RAISE EXCEPTION 'Controller renewal receipt requires its transaction lease write' USING ERRCODE = '23514';
  END IF;
  IF NEW.payload IS DISTINCT FROM jsonb_build_object(
    'operation','renew','requestKey',NEW.payload->>'requestKey',
    'expectedEpoch',lease.epoch,'priorEpoch',lease.epoch,'epoch',lease.epoch,
    'priorHolderId',lease.holder_id,'holderId',lease.holder_id,
    'expiresAt',to_char(lease.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt',to_char(lease.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) THEN
    RAISE EXCEPTION 'Controller renewal receipt must exactly match its lease write' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER control_renewal_receipt_guard BEFORE INSERT OR UPDATE ON audit_events
FOR EACH ROW EXECUTE FUNCTION guard_control_renewal_receipt();
--> statement-breakpoint
CREATE FUNCTION retain_control_renewal_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.event_type = 'lifecycle.run-control-lease-renewed' AND OLD.payload ? 'requestKey' THEN
    IF NOT coalesce(OLD.aggregate_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', false) THEN
      RAISE EXCEPTION 'Invalid retained controller renewal identity' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM audit_run WHERE run_id = OLD.aggregate_id::uuid) THEN
      RAISE EXCEPTION 'Controller renewal receipts survive through Run lifetime' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER control_renewal_receipt_retained AFTER DELETE ON audit_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION retain_control_renewal_receipt();
--> statement-breakpoint
-- Every marked renewal must acquire its exact durable event before commit, including
-- multiple renewals or release/reacquire within the same outer transaction.
CREATE FUNCTION bind_control_renewal_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.renewal_request_key IS NOT NULL AND EXISTS (SELECT 1 FROM audit_run WHERE run_id=NEW.run_id)
    AND NOT EXISTS (SELECT 1 FROM audit_events e
      WHERE e.aggregate_id=NEW.run_id::text AND e.actor_id=NEW.holder_id
        AND e.event_type='lifecycle.run-control-lease-renewed'
        AND e.payload ? 'requestKey' AND e.payload->>'requestKey'=NEW.renewal_request_key::text
        AND e.actor_type='human' AND e.source='web' AND e.outcome='success'
        AND e.payload=jsonb_build_object('operation','renew','requestKey',NEW.renewal_request_key::text,
          'expectedEpoch',NEW.epoch,'priorEpoch',NEW.epoch,'epoch',NEW.epoch,
          'priorHolderId',NEW.holder_id,'holderId',NEW.holder_id,
          'expiresAt',to_char(NEW.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'updatedAt',to_char(NEW.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) THEN
    RAISE EXCEPTION 'Controller renewal requires its exact retained event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER control_renewal_event_bound AFTER INSERT OR UPDATE ON run_control_lease
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bind_control_renewal_event();
--> statement-breakpoint
CREATE FUNCTION guard_control_renewal_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.renewal_request_key IS NOT NULL THEN
      RAISE EXCEPTION 'Acquisition cannot carry a renewal receipt' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.epoch <> OLD.epoch THEN
    IF NEW.renewal_request_key IS NOT NULL THEN
      RAISE EXCEPTION 'An epoch transition clears renewal identity' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.renewal_request_key IS NULL THEN
    RAISE EXCEPTION 'A live renewal cannot remove its receipt identity' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER control_renewal_marker_guard BEFORE INSERT OR UPDATE ON run_control_lease
FOR EACH ROW EXECUTE FUNCTION guard_control_renewal_marker();
--> statement-breakpoint
INSERT INTO "schema_meta" ("version") VALUES (58);
