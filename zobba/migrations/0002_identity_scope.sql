-- Identity/session records are a narrow control plane before tenant selection.
CREATE TABLE public.identities (
    id text PRIMARY KEY,
    issuer text NOT NULL,
    subject text NOT NULL,
    display_name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    UNIQUE (issuer, subject)
);
CREATE TABLE public.login_attempts (
    state_hash text PRIMARY KEY,
    browser_hash text NOT NULL,
    nonce text NOT NULL,
    pkce_verifier text NOT NULL,
    expires_at bigint NOT NULL
);
CREATE INDEX login_attempts_expiry ON public.login_attempts(expires_at, state_hash);
CREATE TABLE public.sessions (
    token_hash text PRIMARY KEY,
    actor_id text NOT NULL REFERENCES public.identities(id),
    csrf_token text NOT NULL,
    expires_at bigint NOT NULL
);
CREATE INDEX sessions_expiry ON public.sessions(expires_at, token_hash);
CREATE TABLE public.organisations (
    id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200 AND name = btrim(name, U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') AND name !~ U&'[\0001-\001F\007F-\009F]')
);
CREATE TABLE public.clients (
    organisation_id text NOT NULL REFERENCES public.organisations(id),
    id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200 AND name = btrim(name, U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') AND name !~ U&'[\0001-\001F\007F-\009F]'),
    PRIMARY KEY (organisation_id, id)
);
CREATE TABLE public.engagements (
    organisation_id text NOT NULL,
    client_id text NOT NULL,
    id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,128}$'),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200 AND name = btrim(name, U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') AND name !~ U&'[\0001-\001F\007F-\009F]'),
    PRIMARY KEY (organisation_id, client_id, id),
    FOREIGN KEY (organisation_id, client_id) REFERENCES public.clients(organisation_id, id)
);
CREATE TABLE public.organisation_memberships (
    organisation_id text NOT NULL REFERENCES public.organisations(id),
    actor_id text NOT NULL REFERENCES public.identities(id),
    roles text[] NOT NULL CHECK (roles <@ ARRAY['auditor', 'audit_manager', 'admin']::text[]),
    active boolean NOT NULL DEFAULT true,
    expires_at bigint,
    PRIMARY KEY (organisation_id, actor_id)
);
CREATE TABLE public.engagement_assignments (
    organisation_id text NOT NULL,
    client_id text NOT NULL,
    engagement_id text NOT NULL,
    actor_id text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    expires_at bigint,
    PRIMARY KEY (organisation_id, client_id, engagement_id, actor_id),
    FOREIGN KEY (organisation_id, client_id, engagement_id) REFERENCES public.engagements(organisation_id, client_id, id),
    FOREIGN KEY (organisation_id, actor_id) REFERENCES public.organisation_memberships(organisation_id, actor_id)
);

-- Policies form an acyclic chain: membership -> assignment -> engagement/client/org.
-- Actor context is transaction-local and is set only from a verified server session.
ALTER TABLE public.organisation_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisation_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY current_membership ON public.organisation_memberships FOR SELECT USING (
    actor_id = pg_catalog.current_setting('zobba.actor_id', true)
    AND active AND (expires_at IS NULL OR expires_at > EXTRACT(EPOCH FROM pg_catalog.statement_timestamp())::bigint)
    AND roles && ARRAY['auditor', 'audit_manager']::text[]
    AND EXISTS (SELECT 1 FROM public.identities i WHERE i.id = actor_id AND i.active)
    AND (COALESCE(pg_catalog.current_setting('zobba.organisation_id', true), '') = '' OR organisation_id = pg_catalog.current_setting('zobba.organisation_id', true))
);
ALTER TABLE public.engagement_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY current_assignment ON public.engagement_assignments FOR SELECT USING (
    actor_id = pg_catalog.current_setting('zobba.actor_id', true)
    AND active AND (expires_at IS NULL OR expires_at > EXTRACT(EPOCH FROM pg_catalog.statement_timestamp())::bigint)
    AND EXISTS (SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id = engagement_assignments.organisation_id AND m.actor_id = engagement_assignments.actor_id)
    AND (COALESCE(pg_catalog.current_setting('zobba.client_id', true), '') = '' OR client_id = pg_catalog.current_setting('zobba.client_id', true))
    AND (COALESCE(pg_catalog.current_setting('zobba.engagement_id', true), '') = '' OR engagement_id = pg_catalog.current_setting('zobba.engagement_id', true))
);
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations FORCE ROW LEVEL SECURITY;
CREATE POLICY assigned_organisation ON public.organisations FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.engagement_assignments a WHERE a.organisation_id = organisations.id)
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients FORCE ROW LEVEL SECURITY;
CREATE POLICY assigned_client ON public.clients FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.engagement_assignments a WHERE a.organisation_id = clients.organisation_id AND a.client_id = clients.id)
);
ALTER TABLE public.engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagements FORCE ROW LEVEL SECURITY;
CREATE POLICY assigned_engagement ON public.engagements FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.engagement_assignments a WHERE a.organisation_id = engagements.organisation_id AND a.client_id = engagements.client_id AND a.engagement_id = engagements.id)
);
CREATE POLICY scoped_engagement_update ON public.engagements FOR UPDATE USING (
    organisation_id = pg_catalog.current_setting('zobba.organisation_id', true)
    AND client_id = pg_catalog.current_setting('zobba.client_id', true)
    AND id = pg_catalog.current_setting('zobba.engagement_id', true)
    AND EXISTS (SELECT 1 FROM public.engagement_assignments a WHERE a.organisation_id = engagements.organisation_id AND a.client_id = engagements.client_id AND a.engagement_id = engagements.id)
) WITH CHECK (
    organisation_id = pg_catalog.current_setting('zobba.organisation_id', true)
    AND client_id = pg_catalog.current_setting('zobba.client_id', true)
    AND id = pg_catalog.current_setting('zobba.engagement_id', true)
    AND EXISTS (SELECT 1 FROM public.engagement_assignments a WHERE a.organisation_id = engagements.organisation_id AND a.client_id = engagements.client_id AND a.engagement_id = engagements.id)
);
REVOKE ALL ON public.identities, public.login_attempts, public.sessions, public.organisations, public.clients, public.engagements, public.organisation_memberships, public.engagement_assignments FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK (schema_version = 2) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version = 2;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;

-- Durable first-provision marker: reruns cannot recreate revoked fixture authority.
ALTER TABLE public.zobba_bootstrap ADD COLUMN local_fixture_issuer text;
