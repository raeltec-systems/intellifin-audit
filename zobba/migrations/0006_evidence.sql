-- Immutable reservations quarantine incomplete uploads; originals exist only after
-- independent version-pinned read-back. Runtime has no UPDATE or DELETE privilege.
CREATE TABLE public.evidence_reservations (
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 request text NOT NULL CHECK(octet_length(request) BETWEEN 1 AND 32768),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 size bigint NOT NULL CHECK(size BETWEEN 0 AND 10485760),
 namespace text NOT NULL CHECK(namespace ~ '^[0-9a-f]{64}$'),
 reserved_at bigint NOT NULL DEFAULT extract(epoch FROM pg_catalog.clock_timestamp())::bigint,
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,actor_id,key)
);
CREATE TABLE public.evidence_originals (
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 request text NOT NULL CHECK(octet_length(request) BETWEEN 1 AND 32768),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 size bigint NOT NULL CHECK(size BETWEEN 0 AND 10485760),
 namespace text NOT NULL CHECK(namespace ~ '^[0-9a-f]{64}$'),
 reserved_at bigint NOT NULL DEFAULT extract(epoch FROM pg_catalog.clock_timestamp())::bigint,
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,id),
 version text NOT NULL CHECK(octet_length(version) BETWEEN 1 AND 512 AND version <> 'null' AND version !~ '[[:cntrl:]]'),
 registered_at bigint NOT NULL DEFAULT extract(epoch FROM pg_catalog.clock_timestamp())::bigint,
 FOREIGN KEY(organisation_id,client_id,engagement_id,id) REFERENCES public.evidence_reservations(organisation_id,client_id,engagement_id,id)
);
-- Opaque identifiers use the same byte ordering as the browser and cursor contract,
-- independently of the deployment database's default locale.
CREATE INDEX evidence_reservations_owner ON public.evidence_reservations(organisation_id,client_id,engagement_id,actor_id,id COLLATE "C");
CREATE INDEX evidence_originals_scope ON public.evidence_originals(organisation_id,client_id,engagement_id,id COLLATE "C");
ALTER TABLE public.evidence_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.evidence_reservations FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(evidence_reservations.organisation_id,evidence_reservations.client_id,evidence_reservations.engagement_id)) AND actor_id=pg_catalog.current_setting('zobba.actor_id',true));
CREATE POLICY scoped_insert ON public.evidence_reservations FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(evidence_reservations.organisation_id,evidence_reservations.client_id,evidence_reservations.engagement_id)) AND actor_id=pg_catalog.current_setting('zobba.actor_id',true));
ALTER TABLE public.evidence_originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_originals FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.evidence_originals FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(evidence_originals.organisation_id,evidence_originals.client_id,evidence_originals.engagement_id)));
CREATE POLICY scoped_insert ON public.evidence_originals FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(evidence_originals.organisation_id,evidence_originals.client_id,evidence_originals.engagement_id)) AND actor_id=pg_catalog.current_setting('zobba.actor_id',true) AND EXISTS(SELECT 1 FROM public.evidence_reservations r WHERE (r.id,r.organisation_id,r.client_id,r.engagement_id,r.actor_id,r.key,r.request,r.digest,r.size,r.namespace,r.reserved_at)=(evidence_originals.id,evidence_originals.organisation_id,evidence_originals.client_id,evidence_originals.engagement_id,evidence_originals.actor_id,evidence_originals.key,evidence_originals.request,evidence_originals.digest,evidence_originals.size,evidence_originals.namespace,evidence_originals.reserved_at)));
REVOKE ALL ON public.evidence_reservations,public.evidence_originals FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=6) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=6;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
-- Lock only the captured session, without granting runtime session UPDATE.
-- Logout/session replacement DELETE serializes against this row lock.
CREATE FUNCTION public.evidence_session_locked(actor text,session_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) THEN RETURN false; END IF;
 PERFORM s.token_hash FROM public.sessions s JOIN public.identities i ON i.id=s.actor_id
 WHERE s.token_hash=session_hash AND s.actor_id=actor AND i.active
 AND s.expires_at>extract(epoch FROM clock_timestamp())::bigint FOR SHARE OF s;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.sessions s JOIN public.identities i ON i.id=s.actor_id
 WHERE s.token_hash=session_hash AND s.actor_id=actor AND i.active
 AND s.expires_at>extract(epoch FROM clock_timestamp())::bigint);
END $$;
REVOKE ALL ON FUNCTION public.evidence_session_locked(text,text) FROM PUBLIC;
