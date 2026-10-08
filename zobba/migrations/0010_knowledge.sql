-- Previous command schemas recorded order but no wall-clock receipt time.
-- Preserve that unknown legacy fact, and capture server time for new commands.
ALTER TABLE public.task_commands ADD COLUMN received_at bigint CHECK(received_at IS NULL OR received_at BETWEEN 0 AND 253402300799);
ALTER TABLE public.task_commands ALTER COLUMN received_at SET DEFAULT floor(extract(epoch FROM pg_catalog.clock_timestamp()))::bigint;
-- Append-only scoped working knowledge. Source originals and Task commands keep
-- their existing owners; derived history never updates them or grants authority.
CREATE FUNCTION public.knowledge_audit(actor text,org text,client text,engagement text) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT org=current_setting('zobba.organisation_id',true)
 AND EXISTS(SELECT 1 FROM public.engagement_assignments a JOIN public.organisation_memberships m ON (m.organisation_id,m.actor_id)=(a.organisation_id,a.actor_id) JOIN public.identities i ON i.id=a.actor_id
 WHERE (a.organisation_id,a.client_id,a.engagement_id)=(org,client,engagement) AND a.actor_id=actor
 AND i.active AND a.active AND m.active AND m.roles && ARRAY['auditor','audit_manager']::text[]
 AND (a.expires_at IS NULL OR a.expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint) AND (m.expires_at IS NULL OR m.expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint))
$$;
CREATE TABLE public.knowledge_records (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 revision bigint NOT NULL CHECK(revision>0),
 actor_id text NOT NULL REFERENCES public.identities(id),
 client_id text, engagement_id text, owner_id text REFERENCES public.identities(id),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=65536),
 PRIMARY KEY(organisation_id,id,revision),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id),
 CHECK((owner_id IS NOT NULL AND client_id IS NULL AND engagement_id IS NULL) OR (owner_id IS NULL AND client_id IS NOT NULL AND engagement_id IS NOT NULL))
);
CREATE INDEX knowledge_records_page ON public.knowledge_records(organisation_id,id COLLATE "C",revision DESC);
CREATE TABLE public.knowledge_events (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 client_id text, engagement_id text, owner_id text REFERENCES public.identities(id),
 command jsonb NOT NULL CHECK(jsonb_typeof(command)='object' AND octet_length(command::text)<=65536),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=65536),
 PRIMARY KEY(organisation_id,id), UNIQUE(organisation_id,actor_id,key),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id),
 CHECK((owner_id IS NOT NULL AND client_id IS NULL AND engagement_id IS NULL) OR (owner_id IS NULL AND client_id IS NOT NULL AND engagement_id IS NOT NULL))
);
CREATE TABLE public.knowledge_invalidations (
 organisation_id text NOT NULL, id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 record_id text NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 actor_id text NOT NULL REFERENCES public.identities(id), client_id text, engagement_id text, owner_id text REFERENCES public.identities(id),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=16384),
 PRIMARY KEY(organisation_id,id), FOREIGN KEY(organisation_id,record_id,revision) REFERENCES public.knowledge_records(organisation_id,id,revision),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id),
 CHECK((owner_id IS NOT NULL AND client_id IS NULL AND engagement_id IS NULL) OR (owner_id IS NULL AND client_id IS NOT NULL AND engagement_id IS NOT NULL))
);
CREATE INDEX knowledge_invalidations_record ON public.knowledge_invalidations(organisation_id,record_id,revision);
CREATE TABLE public.knowledge_publications (
 organisation_id text NOT NULL, id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 record_id text NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 actor_id text NOT NULL REFERENCES public.identities(id), client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text, kind text NOT NULL CHECK(kind IN ('preference','reuse')),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=16384),
 PRIMARY KEY(organisation_id,id), FOREIGN KEY(organisation_id,record_id,revision) REFERENCES public.knowledge_records(organisation_id,id,revision),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX knowledge_publications_scope ON public.knowledge_publications(organisation_id,client_id,engagement_id,task_id,id COLLATE "C");
CREATE TABLE public.knowledge_withdrawals (
 organisation_id text NOT NULL, publication_id text NOT NULL, actor_id text NOT NULL REFERENCES public.identities(id),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=16384),
 PRIMARY KEY(organisation_id,publication_id), FOREIGN KEY(organisation_id,publication_id) REFERENCES public.knowledge_publications(organisation_id,id)
);
CREATE TABLE public.knowledge_layout_events (
 organisation_id text NOT NULL REFERENCES public.organisations(id), actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'), opening_id text NOT NULL CHECK(opening_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 ordinal bigint NOT NULL CHECK(ordinal>0), document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=16384),
 PRIMARY KEY(organisation_id,actor_id,key), UNIQUE(organisation_id,actor_id,ordinal)
);
CREATE TABLE public.knowledge_source_corrections (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 original_id text NOT NULL, revision bigint NOT NULL CHECK(revision>0), replacement_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id), document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=16384),
 PRIMARY KEY(organisation_id,original_id,revision),
 FOREIGN KEY(organisation_id,client_id,engagement_id,original_id) REFERENCES public.evidence_originals(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,replacement_id) REFERENCES public.evidence_originals(organisation_id,client_id,engagement_id,id), CHECK(original_id<>replacement_id)
);
CREATE TABLE public.knowledge_captures (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 original_id text NOT NULL, actor_id text NOT NULL REFERENCES public.identities(id),
 revision bigint NOT NULL CHECK(revision>0), document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=16384),
 PRIMARY KEY(organisation_id,original_id,revision), FOREIGN KEY(organisation_id,client_id,engagement_id,original_id) REFERENCES public.evidence_originals(organisation_id,client_id,engagement_id,id)
);
-- Primary-source authority is a database floor. The repository independently
-- checks every dependency and the destination Task's accountable actor before
-- ranking or disclosure. Runtime can only append; it cannot rewrite history.
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['knowledge_records','knowledge_events','knowledge_invalidations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY knowledge_read ON public.%I FOR SELECT USING (organisation_id=current_setting(''zobba.organisation_id'',true) AND (owner_id=current_setting(''zobba.actor_id'',true) OR (owner_id IS NULL AND public.knowledge_audit(current_setting(''zobba.actor_id'',true),organisation_id,client_id,engagement_id))))',relation);
  EXECUTE format('CREATE POLICY knowledge_insert ON public.%I FOR INSERT WITH CHECK (actor_id=current_setting(''zobba.actor_id'',true) AND organisation_id=current_setting(''zobba.organisation_id'',true) AND (owner_id=actor_id OR (owner_id IS NULL AND public.knowledge_audit(actor_id,organisation_id,client_id,engagement_id))))',relation);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['knowledge_publications','knowledge_source_corrections','knowledge_captures'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  IF relation='knowledge_publications' THEN
   EXECUTE format('CREATE POLICY knowledge_read ON public.%I FOR SELECT USING (organisation_id=current_setting(''zobba.organisation_id'',true) AND (actor_id=current_setting(''zobba.actor_id'',true) OR public.knowledge_audit(current_setting(''zobba.actor_id'',true),organisation_id,client_id,engagement_id)))',relation);
  ELSE
   EXECUTE format('CREATE POLICY knowledge_read ON public.%I FOR SELECT USING (public.knowledge_audit(current_setting(''zobba.actor_id'',true),organisation_id,client_id,engagement_id))',relation);
  END IF;
  EXECUTE format('CREATE POLICY knowledge_insert ON public.%I FOR INSERT WITH CHECK (actor_id=current_setting(''zobba.actor_id'',true) AND public.knowledge_audit(actor_id,organisation_id,client_id,engagement_id))',relation);
 END LOOP;
END $policies$;
ALTER TABLE public.knowledge_layout_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_layout_events FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_owner ON public.knowledge_layout_events USING (organisation_id=current_setting('zobba.organisation_id',true) AND actor_id=current_setting('zobba.actor_id',true)) WITH CHECK (organisation_id=current_setting('zobba.organisation_id',true) AND actor_id=current_setting('zobba.actor_id',true));
ALTER TABLE public.knowledge_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_withdrawals FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_read ON public.knowledge_withdrawals FOR SELECT USING (EXISTS(SELECT 1 FROM public.knowledge_publications p WHERE (p.organisation_id,p.id)=(knowledge_withdrawals.organisation_id,knowledge_withdrawals.publication_id)));
CREATE POLICY knowledge_insert ON public.knowledge_withdrawals FOR INSERT WITH CHECK (actor_id=current_setting('zobba.actor_id',true) AND EXISTS(SELECT 1 FROM public.knowledge_publications p WHERE (p.organisation_id,p.id,p.actor_id)=(knowledge_withdrawals.organisation_id,knowledge_withdrawals.publication_id,knowledge_withdrawals.actor_id)));
-- Owner-only reads support the typed release eligibility function, with no
-- private document returned and no runtime table-owner membership.
DO $owner_policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['knowledge_records','knowledge_events','knowledge_invalidations','knowledge_publications','knowledge_withdrawals','knowledge_layout_events','knowledge_source_corrections','knowledge_captures'] LOOP
  EXECUTE format('CREATE POLICY knowledge_owner_read ON public.%I FOR SELECT USING (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=''public'' AND c.relname=%L AND pg_catalog.pg_get_userbyid(c.relowner)=current_user))',relation,relation);
 END LOOP;
END $owner_policies$;
-- Narrow typed value release checks private-origin withdrawal without returning
-- any private source text, events or conversation. Editing creates a successor
-- and deliberately does not change an already released exact value.
CREATE FUNCTION public.knowledge_release_active(org text,publication text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.knowledge_publications; origin public.knowledge_records; released jsonb; expected jsonb; value text;
BEGIN
 SELECT * INTO p FROM public.knowledge_publications x WHERE (x.organisation_id,x.id)=(org,publication);
 IF NOT FOUND OR p.kind<>'preference' OR NOT public.knowledge_audit(current_setting('zobba.actor_id',true),org,p.client_id,p.engagement_id) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT * INTO origin FROM public.knowledge_records r WHERE (r.organisation_id,r.id,r.revision)=(org,p.record_id,p.revision);
 IF NOT FOUND OR origin.owner_id IS DISTINCT FROM p.actor_id OR origin.actor_id IS DISTINCT FROM p.actor_id
  OR origin.client_id IS NOT NULL OR origin.engagement_id IS NOT NULL OR p.task_id IS NOT NULL
  OR origin.document->>'kind' IS DISTINCT FROM 'preference'
  OR origin.document->>'actor_id' IS DISTINCT FROM p.actor_id
  OR origin.document->>'id' IS DISTINCT FROM p.record_id
  OR origin.document->'revision' IS DISTINCT FROM to_jsonb(p.revision)
  OR origin.document->'scope' IS DISTINCT FROM jsonb_build_object('kind','personal','organisation_id',org,'client_id',NULL,'engagement_id',NULL,'owner_id',p.actor_id)
  OR origin.document->'preference'->>'name' IS DISTINCT FROM 'task_inspection_layout'
  OR coalesce(origin.document->'preference'->>'value','') NOT IN ('standard','expanded')
  OR p.document->'private_origin' IS DISTINCT FROM jsonb_build_object('id',p.record_id,'revision',p.revision)
 THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 released:=p.document->'record'; value:=origin.document->'preference'->>'value';
 IF jsonb_typeof(released->'recorded_at') IS DISTINCT FROM 'number' OR coalesce(released->>'recorded_at','') !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF (released->>'recorded_at')::numeric>253402300799 THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 expected:=jsonb_build_object('id',p.id,'revision',1,'actor_id',p.actor_id,'recorded_at',released->'recorded_at',
  'scope',jsonb_build_object('kind','engagement','organisation_id',org,'client_id',p.client_id,'engagement_id',p.engagement_id,'owner_id',NULL),
  'kind','published_preference','text','Optional task inspection layout: '||CASE value WHEN 'expanded' THEN 'Expanded' ELSE 'Standard' END,
  'period',jsonb_build_object('start',NULL,'end',NULL),'certainty','explicit_preference','uncertainty',NULL,'dependencies','[]'::jsonb,
  'source',NULL,'direction',NULL,'supersedes',NULL,
  'preference',jsonb_build_object('name','task_inspection_layout','value',value,'inferred',false,'rule',NULL,'observation_ids','[]'::jsonb));
 IF released IS DISTINCT FROM expected THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM public.knowledge_withdrawals w WHERE (w.organisation_id,w.publication_id)=(org,publication))
 AND NOT EXISTS(SELECT 1 FROM public.knowledge_invalidations i WHERE (i.organisation_id,i.record_id,i.revision)=(org,p.record_id,p.revision) AND i.document->>'destination_task_id' IS NULL);
END $$;
REVOKE ALL ON public.knowledge_records,public.knowledge_events,public.knowledge_invalidations,public.knowledge_publications,public.knowledge_withdrawals,public.knowledge_layout_events,public.knowledge_source_corrections,public.knowledge_captures FROM PUBLIC;
REVOKE ALL ON FUNCTION public.knowledge_audit(text,text,text,text),public.knowledge_release_active(text,text) FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=10) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=10;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
