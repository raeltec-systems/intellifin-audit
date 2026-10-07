-- Story 22.2 AC4 conversational engagement setup. Additive: published schemas 1-12 are unchanged.
-- An existing engagement keeps an unknown (NULL) audit period; nothing is backfilled.
ALTER TABLE public.engagements ADD COLUMN period_start date;
ALTER TABLE public.engagements ADD COLUMN period_end date;
ALTER TABLE public.engagements ADD CONSTRAINT engagements_period CHECK((period_start IS NULL)=(period_end IS NULL) AND (period_start IS NULL OR period_start<=period_end));
-- An organisation-level setup aggregate. It exists before any engagement and ends
-- by handing off to the ordinary Task Create path inside one establishing transaction.
CREATE TABLE public.engagement_setups (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 actor_id text NOT NULL REFERENCES public.identities(id),
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{1,128}$'),
 objective text NOT NULL CHECK(char_length(objective) BETWEEN 1 AND 4000 AND octet_length(objective)<=4000),
 state text NOT NULL CHECK(state IN ('objective','client','client_choice','new_client','period','confirm','established','cancelled')),
 candidates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(candidates)='array' AND jsonb_array_length(candidates)<=20 AND octet_length(candidates::text)<=16384),
 resolved_client_id text CHECK(resolved_client_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 resolved_client_name text CHECK(char_length(resolved_client_name) BETWEEN 1 AND 200),
 new_client_name text CHECK(char_length(new_client_name) BETWEEN 1 AND 200 AND new_client_name = btrim(new_client_name, U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') AND new_client_name !~ U&'[\0001-\001F\007F-\009F]'),
 period_start date,
 period_end date,
 client_id text,
 engagement_id text,
 task_id text CHECK(task_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 cycle_id text CHECK(cycle_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 receipt jsonb CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=4096),
 message_count integer NOT NULL DEFAULT 0 CHECK(message_count BETWEEN 0 AND 200),
 created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 established_at bigint CHECK(established_at > 0),
 UNIQUE(organisation_id,actor_id,idempotency_key),
 UNIQUE(id,organisation_id,actor_id),
 CHECK(resolved_client_id IS NULL OR new_client_name IS NULL),
 CHECK((resolved_client_id IS NULL)=(resolved_client_name IS NULL)),
 CHECK((period_start IS NULL)=(period_end IS NULL) AND (period_start IS NULL OR period_start<=period_end)),
 CHECK((state='established')=(client_id IS NOT NULL AND engagement_id IS NOT NULL AND task_id IS NOT NULL AND cycle_id IS NOT NULL AND receipt IS NOT NULL AND established_at IS NOT NULL)),
 CHECK(state NOT IN ('confirm','established') OR (period_start IS NOT NULL AND (resolved_client_id IS NOT NULL OR new_client_name IS NOT NULL))),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id)
);
CREATE INDEX engagement_setups_actor ON public.engagement_setups(organisation_id,actor_id,state,established_at);
-- Member messages are persisted before interpretation; Zobba turns answer one member message each.
CREATE TABLE public.engagement_setup_messages (
 organisation_id text NOT NULL,
 setup_id text NOT NULL,
 actor_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 199),
 author text NOT NULL CHECK(author IN ('member','zobba')),
 idempotency_key text CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{1,128}$'),
 kind text NOT NULL,
 content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 4000 AND octet_length(content)<=4000),
 payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16384),
 reply_to integer,
 created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 PRIMARY KEY(setup_id,ordinal),
 CHECK((author='member')=(idempotency_key IS NOT NULL)),
 CHECK((author='zobba')=(reply_to IS NOT NULL)),
 CHECK((author='member' AND kind IN ('objective','text','choose_client','new_client','confirm','cancel'))
  OR (author='zobba' AND kind IN ('question','refusal','summary','established','cancelled'))),
 FOREIGN KEY(setup_id,organisation_id,actor_id) REFERENCES public.engagement_setups(id,organisation_id,actor_id),
 FOREIGN KEY(setup_id,reply_to) REFERENCES public.engagement_setup_messages(setup_id,ordinal)
);
CREATE UNIQUE INDEX engagement_setup_messages_key ON public.engagement_setup_messages(organisation_id,actor_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX engagement_setup_messages_reply ON public.engagement_setup_messages(setup_id,reply_to) WHERE reply_to IS NOT NULL;
-- Setup rows are visible and writable only to their own actor while that actor
-- holds a current audit membership in the organisation (the membership policy
-- itself requires an active identity, an active unexpired auditor/audit_manager role).
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['engagement_setups','engagement_setup_messages'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY setup_actor ON public.%I USING (actor_id=pg_catalog.current_setting(''zobba.actor_id'',true) AND EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=%I.organisation_id AND m.actor_id=%I.actor_id)) WITH CHECK (actor_id=pg_catalog.current_setting(''zobba.actor_id'',true) AND EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=%I.organisation_id AND m.actor_id=%I.actor_id))',relation,relation,relation,relation,relation);
  EXECUTE format('CREATE POLICY setup_owner ON public.%I USING (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=''public'' AND c.relname=%L AND pg_catalog.pg_get_userbyid(c.relowner)=current_user)) WITH CHECK (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=''public'' AND c.relname=%L AND pg_catalog.pg_get_userbyid(c.relowner)=current_user))',relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $policies$;

-- Private: the exact session (locked against logout), an active identity and a
-- current audit (auditor/audit_manager) membership. Admin alone is not authority.
-- Callers hold organisation advisory lock 205 so a concurrent membership writer
-- is decided under that lock.
CREATE FUNCTION public.engagement_setup_authority(actor text, session_hash text, org text) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR NOT public.evidence_session_locked(actor,session_hash) THEN RETURN false; END IF;
 PERFORM i.id FROM public.identities i WHERE i.id=actor AND i.active FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM m.actor_id FROM public.organisation_memberships m WHERE m.organisation_id=org AND m.actor_id=actor AND m.active
  AND m.roles && ARRAY['auditor','audit_manager']::text[] AND (m.expires_at IS NULL OR m.expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint) FOR SHARE;
 RETURN FOUND;
END
$body$;

-- Organisations where the actor may establish an engagement. Names only.
CREATE FUNCTION public.engagement_setup_organisations(actor text, session_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR NOT public.evidence_session_locked(actor,session_hash) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('organisation_id',page.id,'organisation_name',page.name) ORDER BY page.id),'[]'::jsonb) FROM
  (SELECT o.id,o.name FROM public.organisation_memberships m JOIN public.organisations o ON o.id=m.organisation_id JOIN public.identities i ON i.id=m.actor_id
   WHERE m.actor_id=actor AND m.active AND i.active AND m.roles && ARRAY['auditor','audit_manager']::text[]
   AND (m.expires_at IS NULL OR m.expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint) ORDER BY o.id LIMIT 50) page);
END
$body$;

-- Clients of one organisation whose names may equal the query under simple case
-- folding. Simple folding preserves the scalar count; this is a superset
-- prefilter, and the application decides exact and folded equality itself.
-- At most 21 rows, so an over-wide match is reported rather than truncated silently.
CREATE FUNCTION public.engagement_setup_clients(actor text, session_hash text, org text, query text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR query IS NULL OR char_length(query) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 IF NOT public.engagement_setup_authority(actor,session_hash,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('client_id',page.id,'client_name',page.name) ORDER BY page.id),'[]'::jsonb) FROM
  (SELECT c.id,c.name FROM public.clients c WHERE c.organisation_id=org AND char_length(c.name)=char_length(query)
   AND lower(upper(c.name COLLATE pg_catalog."pg_c_utf8"))=lower(upper(query COLLATE pg_catalog."pg_c_utf8")) ORDER BY c.id LIMIT 21) page);
END
$body$;

-- The only path that creates a client, an engagement and an assignment at runtime.
-- Lock order: organisation advisory 205, the setup row, then the new engagement row.
-- Authority is decided after each wait. The caller then admits the first Task in
-- the same transaction; any later failure rolls every row back.
CREATE FUNCTION public.engagement_establish(actor text, session_hash text, org text, setup text, new_client text, new_engagement text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE s public.engagement_setups; chosen text; day_start bigint;
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true)
  OR coalesce(new_client,'') !~ '^[A-Za-z0-9_-]{1,128}$' OR coalesce(new_engagement,'') !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 IF NOT public.engagement_setup_authority(actor,session_hash,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT * INTO s FROM public.engagement_setups WHERE id=setup AND organisation_id=org AND actor_id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF s.state='established' THEN
  RETURN jsonb_build_object('established',true,'client_id',s.client_id,'engagement_id',s.engagement_id);
 END IF;
 IF s.state<>'confirm' THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
 day_start=floor(extract(epoch FROM clock_timestamp())/86400)::bigint*86400;
 IF (SELECT count(*) FROM public.engagement_setups e WHERE e.organisation_id=org AND e.actor_id=actor AND e.state='established' AND e.established_at>=day_start)>=20 THEN
  RAISE EXCEPTION 'daily engagement limit' USING ERRCODE='Z0006';
 END IF;
 IF s.resolved_client_id IS NULL THEN
  INSERT INTO public.clients(organisation_id,id,name) VALUES(org,new_client,s.new_client_name);
  chosen=new_client;
 ELSE
  PERFORM c.id FROM public.clients c WHERE c.organisation_id=org AND c.id=s.resolved_client_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  chosen=s.resolved_client_id;
 END IF;
 INSERT INTO public.engagements(organisation_id,client_id,id,name,period_start,period_end)
  VALUES(org,chosen,new_engagement,'Audit '||to_char(s.period_start,'YYYY-MM-DD')||' to '||to_char(s.period_end,'YYYY-MM-DD'),s.period_start,s.period_end);
 PERFORM e.id FROM public.engagements e WHERE e.organisation_id=org AND e.client_id=chosen AND e.id=new_engagement FOR UPDATE;
 IF NOT public.engagement_setup_authority(actor,session_hash,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES(org,chosen,new_engagement,actor);
 -- Administration drafts compare this version; a new assignment must invalidate them.
 INSERT INTO public.membership_versions VALUES(org,1) ON CONFLICT(organisation_id) DO UPDATE SET version=membership_versions.version+1;
 RETURN jsonb_build_object('established',false,'client_id',chosen,'engagement_id',new_engagement);
END
$body$;
REVOKE ALL ON FUNCTION public.engagement_setup_authority(text,text,text),public.engagement_setup_organisations(text,text),public.engagement_setup_clients(text,text,text,text),public.engagement_establish(text,text,text,text,text,text) FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=13) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=13;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
