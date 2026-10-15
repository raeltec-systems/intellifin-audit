-- Authority is never manufactured by an upgrade. Freeze the three inputs before
-- inspecting existing data; any refusal rolls back the entire migration.
DO $isolation$
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'admin continuity upgrade requires READ COMMITTED'
   USING ERRCODE='0A000', HINT='Retry the complete migration transaction at READ COMMITTED.';
 END IF;
END
$isolation$;
LOCK TABLE public.organisations, public.organisation_memberships, public.identities IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
BEGIN
 IF EXISTS (
  SELECT 1 FROM public.organisations o WHERE NOT EXISTS (
   SELECT 1 FROM public.organisation_memberships m JOIN public.identities i ON i.id=m.actor_id
   WHERE m.organisation_id=o.id AND m.active AND m.expires_at IS NULL AND 'admin'=ANY(m.roles) AND i.active
  )
 ) THEN
  RAISE EXCEPTION 'admin continuity requires explicit remediation'
   USING ERRCODE='Z0007', HINT='Run the Admin continuity preflight in zobba/README.md and explicitly establish an active non-expiring Admin linked to an active identity in each reported organisation before retrying.';
 END IF;
END
$preflight$;

-- Identity lifecycle checks include inactive, expired and non-Admin memberships.
CREATE INDEX organisation_memberships_actor_organisation ON public.organisation_memberships(actor_id,organisation_id);

CREATE FUNCTION public.admin_continuity_assert(org text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF EXISTS(SELECT 1 FROM public.organisations WHERE id=org)
 AND NOT EXISTS(SELECT 1 FROM public.organisation_memberships m JOIN public.identities i ON i.id=m.actor_id
  WHERE m.organisation_id=org AND m.active AND m.expires_at IS NULL AND 'admin'=ANY(m.roles) AND i.active)
 THEN RAISE EXCEPTION 'last active non-expiring admin' USING ERRCODE='Z0004',
  DETAIL=format('Organisation: %s',org),
  HINT='Establish another active non-expiring Admin linked to an active identity first.';
 END IF;
END
$body$;

-- Advisory locks serialize current snapshots only. Explicitly refuse mutation
-- under snapshot isolation, rather than pretending a wait refreshes that snapshot.
-- Membership provisioning additionally locks its identity so a concurrent owner
-- deactivation cannot miss a newly inserted membership while it remains invisible.
CREATE FUNCTION public.admin_continuity_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE org text; orgs text[];
BEGIN
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'admin continuity mutations require READ COMMITTED'
   USING ERRCODE='0A000', HINT='Retry the complete transaction at READ COMMITTED.';
 END IF;
 IF TG_TABLE_NAME='organisation_memberships' THEN
  IF TG_OP='INSERT' THEN orgs=ARRAY[NEW.organisation_id];
  ELSIF TG_OP='DELETE' THEN orgs=ARRAY[OLD.organisation_id];
  ELSE orgs=ARRAY[OLD.organisation_id,NEW.organisation_id]; END IF;
 ELSIF TG_TABLE_NAME='organisations' THEN
  IF TG_OP='INSERT' THEN orgs=ARRAY[NEW.id];
  ELSIF TG_OP='DELETE' THEN orgs=ARRAY[OLD.id];
  ELSE orgs=ARRAY[OLD.id,NEW.id]; END IF;
 ELSE
  SELECT array_agg(m.organisation_id ORDER BY m.organisation_id) INTO orgs
   FROM public.organisation_memberships m WHERE m.actor_id=OLD.id;
 END IF;
 FOR org IN SELECT DISTINCT v FROM unnest(orgs) AS o(v) ORDER BY v LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 END LOOP;
 IF TG_TABLE_NAME='organisation_memberships' AND TG_OP<>'DELETE' THEN
  IF NEW.active AND NEW.expires_at IS NULL AND 'admin'=ANY(NEW.roles) THEN
   PERFORM id FROM public.identities WHERE id=NEW.actor_id FOR SHARE;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$body$;

-- Deferred checks admit first provisioning and replacement in one transaction.
-- The BEFORE trigger retains the organisation fence through this final check.
CREATE FUNCTION public.admin_continuity_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE org text;
BEGIN
 IF TG_TABLE_NAME='organisation_memberships' THEN
  IF TG_OP<>'INSERT' THEN PERFORM public.admin_continuity_assert(OLD.organisation_id); END IF;
  IF TG_OP='INSERT' THEN PERFORM public.admin_continuity_assert(NEW.organisation_id);
  ELSIF TG_OP='UPDATE' AND NEW.organisation_id IS DISTINCT FROM OLD.organisation_id THEN
   PERFORM public.admin_continuity_assert(NEW.organisation_id);
  END IF;
 ELSIF TG_TABLE_NAME='organisations' THEN
  IF TG_OP<>'DELETE' THEN PERFORM public.admin_continuity_assert(NEW.id); END IF;
 ELSE
  FOR org IN SELECT DISTINCT organisation_id FROM public.organisation_memberships WHERE actor_id=OLD.id ORDER BY organisation_id LOOP
   PERFORM public.admin_continuity_assert(org);
  END LOOP;
 END IF;
 RETURN NULL;
END
$body$;

CREATE FUNCTION public.admin_continuity_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
BEGIN
 RAISE EXCEPTION 'admin continuity forbids truncating authority records'
  USING ERRCODE='0A000', HINT='Use ordinary transactional lifecycle changes; audit attribution must be retained.';
END
$body$;

CREATE TRIGGER admin_continuity_lock BEFORE INSERT OR UPDATE OR DELETE ON public.organisation_memberships
 FOR EACH ROW EXECUTE FUNCTION public.admin_continuity_lock();
CREATE TRIGGER admin_continuity_lock BEFORE INSERT OR UPDATE OF id OR DELETE ON public.organisations
 FOR EACH ROW EXECUTE FUNCTION public.admin_continuity_lock();
CREATE TRIGGER admin_continuity_lock BEFORE UPDATE OF active,id OR DELETE ON public.identities
 FOR EACH ROW EXECUTE FUNCTION public.admin_continuity_lock();
CREATE CONSTRAINT TRIGGER admin_continuity_check AFTER INSERT OR UPDATE OR DELETE ON public.organisation_memberships
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.admin_continuity_check();
CREATE CONSTRAINT TRIGGER admin_continuity_check AFTER INSERT OR UPDATE OF id OR DELETE ON public.organisations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.admin_continuity_check();
CREATE CONSTRAINT TRIGGER admin_continuity_check AFTER UPDATE OF active,id OR DELETE ON public.identities
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.admin_continuity_check();
CREATE TRIGGER admin_continuity_truncate BEFORE TRUNCATE ON public.organisation_memberships
 FOR EACH STATEMENT EXECUTE FUNCTION public.admin_continuity_truncate();
CREATE TRIGGER admin_continuity_truncate BEFORE TRUNCATE ON public.organisations
 FOR EACH STATEMENT EXECUTE FUNCTION public.admin_continuity_truncate();
CREATE TRIGGER admin_continuity_truncate BEFORE TRUNCATE ON public.identities
 FOR EACH STATEMENT EXECUTE FUNCTION public.admin_continuity_truncate();
REVOKE ALL ON FUNCTION public.admin_continuity_assert(text),public.admin_continuity_lock(),public.admin_continuity_check(),public.admin_continuity_truncate() FROM PUBLIC;

ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=7) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=7;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
