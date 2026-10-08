-- Explicit Admin installation stores immutable, inert packages. Runtime reads and
-- writes only through scoped owner functions; installation grants no audit access.
CREATE TABLE public.skill_versions (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 actor_id text NOT NULL REFERENCES public.identities(id),
 installed_at bigint NOT NULL CHECK(installed_at BETWEEN 0 AND 253402300799),
 revision bigint NOT NULL CHECK(revision>0),
 command jsonb NOT NULL CHECK(jsonb_typeof(command)='object' AND octet_length(command::text)<=1048576),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 resource_digests jsonb NOT NULL CHECK(jsonb_typeof(resource_digests)='array' AND jsonb_array_length(resource_digests)<=32),
 client_id text, engagement_id text,
 PRIMARY KEY(organisation_id,id), UNIQUE(organisation_id,revision),
 FOREIGN KEY(organisation_id,client_id) REFERENCES public.clients(organisation_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id),
 CHECK(engagement_id IS NULL OR client_id IS NOT NULL)
);
CREATE UNIQUE INDEX skill_versions_manifest_identity ON public.skill_versions(organisation_id,(command->'manifest'->>'id'),(command->'manifest'->>'version'));
CREATE TABLE public.skill_events (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 revision bigint NOT NULL CHECK(revision>0), kind text NOT NULL CHECK(kind IN ('install','status')),
 command jsonb NOT NULL, receipt jsonb NOT NULL, recorded_at bigint NOT NULL,
 CHECK(kind='install' OR (jsonb_typeof(command->'reason') IS NOT DISTINCT FROM 'string' AND char_length(command->>'reason') BETWEEN 1 AND 2000 AND command->>'reason' !~ U&'[\0001-\001F\007F-\009F]')),
 PRIMARY KEY(organisation_id,id), UNIQUE(organisation_id,actor_id,key), UNIQUE(organisation_id,revision)
);
CREATE INDEX skill_events_version_history ON public.skill_events(organisation_id,(receipt->>'version_id'),revision DESC);
CREATE TABLE public.skill_status (
 organisation_id text NOT NULL, version_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('enabled','disabled','recalled')),
 revision bigint NOT NULL CHECK(revision>0), event_id text NOT NULL,
 PRIMARY KEY(organisation_id,version_id),
 FOREIGN KEY(organisation_id,version_id) REFERENCES public.skill_versions(organisation_id,id),
 FOREIGN KEY(organisation_id,event_id) REFERENCES public.skill_events(organisation_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE public.task_skill_selections (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL, task_id text NOT NULL,
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 selector_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 revision bigint NOT NULL CHECK(revision>0), version_id text NOT NULL,
 command jsonb NOT NULL CHECK(jsonb_typeof(command)='object' AND octet_length(command::text)<=16384),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=1048576),
 PRIMARY KEY(organisation_id,task_id,id), UNIQUE(organisation_id,task_id,selector_id,key), UNIQUE(organisation_id,task_id,revision),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,version_id) REFERENCES public.skill_versions(organisation_id,id)
);
-- The leading organisation/version pair also bounds restriction-impact counts.
CREATE INDEX task_skill_selections_version ON public.task_skill_selections(organisation_id,version_id,client_id,engagement_id,task_id COLLATE "C",revision);
CREATE INDEX task_skill_selections_scope ON public.task_skill_selections(organisation_id,client_id,engagement_id,task_id COLLATE "C",revision,version_id);
CREATE INDEX skills_client_choices ON public.clients(organisation_id,id COLLATE "C");
CREATE INDEX skills_engagement_choices ON public.engagements(organisation_id,client_id,id COLLATE "C");
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['skill_versions','skill_events','skill_status','task_skill_selections'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY skills_owner ON public.%I USING (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=''public'' AND c.relname=%L AND pg_catalog.pg_get_userbyid(c.relowner)=current_user)) WITH CHECK (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=''public'' AND c.relname=%L AND pg_catalog.pg_get_userbyid(c.relowner)=current_user))',relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $policies$;

CREATE FUNCTION public.skills_read(actor text,session_hash text,org text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR NOT public.evidence_session_locked(actor,session_hash) OR NOT public.membership_admin(actor,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT jsonb_build_object('organisation_id',org,'revision',coalesce((SELECT max(e.revision) FROM public.skill_events e WHERE e.organisation_id=org),0),
 'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'installed_at',v.installed_at,'revision',v.revision,'command',v.command,'digest',v.digest,'resource_digests',v.resource_digests,'status',s.status,'status_revision',s.revision,
 'status_event',jsonb_build_object('event_id',e.id,'actor_id',e.actor_id,'recorded_at',e.recorded_at,'revision',e.revision,'status',e.receipt->>'status','reason',e.command->>'reason')) ORDER BY v.revision) FROM public.skill_versions v JOIN public.skill_status s ON (s.organisation_id,s.version_id)=(v.organisation_id,v.id) JOIN public.skill_events e ON (e.organisation_id,e.id)=(s.organisation_id,s.event_id) WHERE v.organisation_id=org),'[]'::jsonb)) INTO result;
 IF NOT public.evidence_session_locked(actor,session_hash) OR NOT public.membership_admin(actor,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 RETURN result;
END $$;

-- Assignment choices and append-only status history are independently paged.
-- Neither their size nor their failure can hide catalogue restriction controls.
-- Identifier cursors share the browser's ASCII ordering in every database locale.
CREATE FUNCTION public.skills_admin(actor text,session_hash text,org text,action text,document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE result jsonb; page jsonb; kind text; client text; cursor text; before_revision bigint; version text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR NOT public.evidence_session_locked(actor,session_hash) OR NOT public.membership_admin(actor,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF jsonb_typeof(document) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 IF action='assignment_options' THEN
  kind:=document->>'kind'; client:=document->>'client_id'; cursor:=document->>'after';
  IF kind IS NULL OR kind NOT IN ('client','engagement') OR (cursor IS NOT NULL AND cursor !~ '^[A-Za-z0-9_-]{1,128}$')
   OR (kind='client' AND client IS NOT NULL) OR (kind='engagement' AND coalesce(client,'') !~ '^[A-Za-z0-9_-]{1,128}$') THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  IF kind='client' THEN
   SELECT coalesce(jsonb_agg(v ORDER BY id COLLATE "C"),'[]'::jsonb) INTO page FROM
    (SELECT c.id,jsonb_build_object('client_id',c.id,'client_name',c.name) v FROM public.clients c WHERE c.organisation_id=org AND c.id COLLATE "C">coalesce(cursor,'') COLLATE "C" ORDER BY c.id COLLATE "C" LIMIT 51) candidates;
   result:=jsonb_build_object('clients',page-50,'engagements','[]'::jsonb,'next_after',CASE WHEN jsonb_array_length(page)>50 THEN page->49->>'client_id' END);
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE (c.organisation_id,c.id)=(org,client)) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
   SELECT coalesce(jsonb_agg(v ORDER BY id COLLATE "C"),'[]'::jsonb) INTO page FROM
    (SELECT e.id,jsonb_build_object('client_id',e.client_id,'client_name',c.name,'engagement_id',e.id,'engagement_name',e.name) v FROM public.engagements e JOIN public.clients c ON (c.organisation_id,c.id)=(e.organisation_id,e.client_id) WHERE (e.organisation_id,e.client_id)=(org,client) AND e.id COLLATE "C">coalesce(cursor,'') COLLATE "C" ORDER BY e.id COLLATE "C" LIMIT 51) candidates;
   result:=jsonb_build_object('clients','[]'::jsonb,'engagements',page-50,'next_after',CASE WHEN jsonb_array_length(page)>50 THEN page->49->>'engagement_id' END);
  END IF;
 ELSIF action='history' THEN
  version:=document->>'version_id';
  IF coalesce(version,'') !~ '^[A-Za-z0-9_-]{1,128}$' OR (document->>'before_revision' IS NOT NULL AND (document->>'before_revision' !~ '^[1-9][0-9]{0,18}$' OR (document->>'before_revision')::numeric>9223372036854775807)) THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  before_revision:=(document->>'before_revision')::bigint;
  IF NOT EXISTS(SELECT 1 FROM public.skill_versions v WHERE (v.organisation_id,v.id)=(org,version)) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
  SELECT coalesce(jsonb_agg(v ORDER BY revision DESC),'[]'::jsonb) INTO page FROM
   (SELECT e.revision,jsonb_build_object('event_id',e.id,'actor_id',e.actor_id,'recorded_at',e.recorded_at,'revision',e.revision,'status',e.receipt->>'status','reason',e.command->>'reason') v FROM public.skill_events e WHERE e.organisation_id=org AND e.receipt->>'version_id'=version AND (before_revision IS NULL OR e.revision<before_revision) ORDER BY e.revision DESC LIMIT 51) candidates;
  result:=jsonb_build_object('version_id',version,'events',page-50,'next_before_revision',CASE WHEN jsonb_array_length(page)>50 THEN (page->49->>'revision')::bigint END);
 ELSE RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001';
 END IF;
 IF NOT public.evidence_session_locked(actor,session_hash) OR NOT public.membership_admin(actor,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 RETURN result;
END $$;

-- Audit impact is scoped before projection, pagination or any disclosure.
-- Admin alone cannot inspect Task references. A null version lists currently
-- disabled/recalled selections so an auditor need not know catalogue identifiers.
CREATE FUNCTION public.skills_impact(version text,document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE actor text:=current_setting('zobba.actor_id',true); org text:=current_setting('zobba.organisation_id',true); client text:=current_setting('zobba.client_id',true); engagement text:=current_setting('zobba.engagement_id',true); after_task text; after_revision bigint; page jsonb; result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 PERFORM e.id FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(org,client,engagement) FOR UPDATE;
 IF NOT FOUND OR NOT public.methodology_audit(org,client,engagement) OR NOT public.evidence_session_locked(actor,document->>'session_hash') THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF jsonb_typeof(document) IS DISTINCT FROM 'object' OR (version IS NOT NULL AND version !~ '^[A-Za-z0-9_-]{1,128}$') THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 IF document->'after' IS NOT NULL AND document->'after'<>'null'::jsonb THEN
  IF jsonb_typeof(document->'after') IS DISTINCT FROM 'object' OR coalesce(document->'after'->>'task_id','') !~ '^[A-Za-z0-9_-]{1,128}$' OR coalesce(document->'after'->>'revision','') !~ '^[1-9][0-9]{0,18}$' OR (document->'after'->>'revision')::numeric>9223372036854775807 THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  after_task:=document->'after'->>'task_id'; after_revision:=(document->'after'->>'revision')::bigint;
 END IF;
 IF version IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.skill_versions v WHERE (v.organisation_id,v.id)=(org,version) AND (v.client_id IS NULL OR v.client_id=client) AND (v.engagement_id IS NULL OR v.engagement_id=engagement)) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT coalesce(jsonb_agg(v ORDER BY task_id COLLATE "C",revision),'[]'::jsonb) INTO page FROM
  (SELECT s.task_id,s.revision,jsonb_build_object('task_id',s.task_id,'selection_id',s.id,'selector_id',s.selector_id,'selected_at',s.receipt->'selected_at','selection_revision',s.revision,'version_id',s.version_id,'skill_id',s.receipt->>'skill_id','skill_version',s.receipt->>'skill_version','digest',s.receipt->>'digest','methodology_binding_id',s.receipt->'methodology'->>'id','execution_epoch',s.receipt->'execution_epoch','catalog_revision',s.receipt->'catalog_revision','status',status.status,'status_revision',status.revision) v
   FROM public.task_skill_selections s JOIN public.skill_status status ON (status.organisation_id,status.version_id)=(s.organisation_id,s.version_id)
   WHERE (s.organisation_id,s.client_id,s.engagement_id)=(org,client,engagement) AND (CASE WHEN version IS NULL THEN status.status IN ('disabled','recalled') ELSE s.version_id=version END) AND (after_task IS NULL OR (s.task_id COLLATE "C",s.revision)>(after_task COLLATE "C",after_revision))
   ORDER BY s.task_id COLLATE "C",s.revision LIMIT 51) candidates;
 result:=jsonb_build_object('organisation_id',org,'client_id',client,'engagement_id',engagement,'version_id',version,'selections',page-50,'next_after',CASE WHEN jsonb_array_length(page)>50 THEN jsonb_build_object('task_id',page->49->>'task_id','revision',(page->49->>'selection_revision')::bigint) END);
 IF NOT public.methodology_audit(org,client,engagement) OR NOT public.evidence_session_locked(actor,document->>'session_hash') THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 RETURN result;
END $$;

-- The shared organisation fence serializes catalogue changes, methodology,
-- Permissions and Task selection. Restrictions remain writable at capacity.
CREATE FUNCTION public.skills_write(actor text,session_hash text,org text,kind text,command jsonb,event_id text,version_id text,digest text,resource_digests jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE previous public.skill_events; prior public.skill_versions; rev bigint; now_at bigint; result jsonb; affected bigint:=0; status text; scope_doc jsonb;
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR kind NOT IN ('install','status') OR jsonb_typeof(command) IS DISTINCT FROM 'object' OR octet_length(command::text)>1048576 OR coalesce(command->>'key','') !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 IF NOT public.evidence_session_locked(actor,session_hash) OR NOT public.membership_admin(actor,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT * INTO previous FROM public.skill_events e WHERE e.organisation_id=org AND e.actor_id=actor AND e.key=command->>'key';
 IF FOUND THEN
  IF previous.kind<>kind OR previous.command<>command THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  RETURN previous.receipt;
 END IF;
 SELECT coalesce(max(e.revision),0) INTO rev FROM public.skill_events e WHERE e.organisation_id=org;
 IF rev IS DISTINCT FROM (command->>'expected_revision')::bigint THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
 rev:=rev+1; now_at:=floor(extract(epoch FROM clock_timestamp()))::bigint;
 IF kind='install' THEN
  IF (SELECT count(*) FROM public.skill_versions v WHERE v.organisation_id=org)>=128 OR (SELECT coalesce(sum(octet_length(v.command::text)),0) FROM public.skill_versions v WHERE v.organisation_id=org)+octet_length(command::text)>2097152 THEN RAISE EXCEPTION 'capacity' USING ERRCODE='Z0006'; END IF;
  scope_doc:=command->'assignment';
  IF coalesce(scope_doc->>'kind','') NOT IN ('firm','client','engagement') OR jsonb_typeof(command->'enabled') IS DISTINCT FROM 'boolean'
   OR (scope_doc->>'kind'='firm' AND (scope_doc->>'client_id' IS NOT NULL OR scope_doc->>'engagement_id' IS NOT NULL))
   OR (scope_doc->>'kind'='client' AND (scope_doc->>'client_id' IS NULL OR scope_doc->>'engagement_id' IS NOT NULL))
   OR (scope_doc->>'kind'='engagement' AND (scope_doc->>'client_id' IS NULL OR scope_doc->>'engagement_id' IS NULL))
   OR (scope_doc->>'client_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients c WHERE (c.organisation_id,c.id)=(org,scope_doc->>'client_id')))
   OR (scope_doc->>'engagement_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(org,scope_doc->>'client_id',scope_doc->>'engagement_id')))
   OR coalesce(command->'manifest'->>'id','') !~ '^[A-Za-z0-9_-]{1,128}$' OR coalesce(command->'manifest'->>'version','') !~ '^[A-Za-z0-9_-]{1,128}$'
   OR coalesce(digest,'') !~ '^[a-f0-9]{64}$' OR jsonb_typeof(resource_digests) IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  IF EXISTS(SELECT 1 FROM public.skill_versions v WHERE v.organisation_id=org AND (v.command->'manifest'->>'id',v.command->'manifest'->>'version')=(command->'manifest'->>'id',command->'manifest'->>'version')) THEN RAISE EXCEPTION 'immutable version conflict' USING ERRCODE='Z0003'; END IF;
  status:=CASE WHEN (command->>'enabled')::boolean THEN 'enabled' ELSE 'disabled' END;
  INSERT INTO public.skill_versions VALUES(org,version_id,actor,now_at,rev,command,digest,resource_digests,scope_doc->>'client_id',scope_doc->>'engagement_id');
 ELSE
  version_id:=command->>'version_id'; status:=command->>'status';
  IF status IS NULL OR status NOT IN ('enabled','disabled','recalled') THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  SELECT * INTO prior FROM public.skill_versions v WHERE (v.organisation_id,v.id)=(org,version_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.skill_status s WHERE (s.organisation_id,s.version_id)=(org,version_id) AND s.status='recalled') THEN RAISE EXCEPTION 'recalled version is immutable' USING ERRCODE='Z0003'; END IF;
  SELECT count(*) INTO affected FROM public.task_skill_selections s WHERE (s.organisation_id,s.version_id)=(org,version_id);
 END IF;
 result:=jsonb_build_object('event_id',event_id,'organisation_id',org,'actor_id',actor,'version_id',version_id,'revision',rev,'status',status,'affected_selections',affected);
 INSERT INTO public.skill_events VALUES(org,event_id,actor,command->>'key',rev,kind,command,result,now_at);
 INSERT INTO public.skill_status VALUES(org,version_id,status,rev,event_id) ON CONFLICT ON CONSTRAINT skill_status_pkey DO UPDATE SET status=excluded.status,revision=excluded.revision,event_id=excluded.event_id;
 SET CONSTRAINTS ALL IMMEDIATE;
 IF NOT public.evidence_session_locked(actor,session_hash) OR NOT public.membership_admin(actor,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 RETURN result;
END $$;

-- Caller supplies only its captured session and a server-validated document.
-- Audit scope, exact immutable Task basis and status are rechecked in storage.
CREATE FUNCTION public.skills_task(task text,action text,document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE t public.tasks; actor text:=current_setting('zobba.actor_id',true); org text:=current_setting('zobba.organisation_id',true); client text:=current_setting('zobba.client_id',true); engagement text:=current_setting('zobba.engagement_id',true); previous public.task_skill_selections; version public.skill_versions; result jsonb; command jsonb; rev bigint; catalog_rev bigint; binding text; authority text; observed_at bigint; method_allowed boolean; authority_actor_current boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 PERFORM e.id FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(org,client,engagement) FOR UPDATE;
 SELECT * INTO t FROM public.tasks p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(org,client,engagement,task) FOR UPDATE;
 IF NOT FOUND OR NOT public.methodology_audit(org,client,engagement) OR NOT public.evidence_session_locked(actor,document->>'session_hash') THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 -- Called after all earlier loads and deferred writes. All time-sensitive
 -- predicates share this server observation, without another network round trip.
 IF action IN ('authority_actor','fence') THEN
  observed_at:=floor(extract(epoch FROM clock_timestamp()))::bigint;
  IF action='fence' THEN method_allowed:=public.methodology_task(task,'allowed','{}'::jsonb)='true'::jsonb; END IF;
  SELECT (v.accepted_snapshot::jsonb)->>'actor_id' INTO authority FROM public.permission_heads h JOIN public.permission_versions v ON (v.organisation_id,v.policy_key,v.version)=(h.organisation_id,h.policy_key,h.current_version)
   WHERE h.organisation_id=org AND h.policy_key=octet_length(client)::text||':'||client||octet_length(engagement)::text||':'||engagement||'task:'||task;
  SELECT coalesce(authority=document->>'actor_id',false) AND EXISTS(SELECT 1 FROM public.identities i JOIN public.organisation_memberships m ON m.actor_id=i.id JOIN public.engagement_assignments a ON (a.organisation_id,a.actor_id)=(m.organisation_id,m.actor_id)
   WHERE i.id=authority AND i.active AND m.organisation_id=org AND m.active AND m.roles && ARRAY['auditor','audit_manager']::text[] AND (m.expires_at IS NULL OR m.expires_at>observed_at)
   AND (a.client_id,a.engagement_id)=(client,engagement) AND a.active AND (a.expires_at IS NULL OR a.expires_at>observed_at)) INTO authority_actor_current;
  IF NOT public.methodology_audit(org,client,engagement) OR NOT public.evidence_session_locked(actor,document->>'session_hash') THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
  IF action='fence' THEN RETURN jsonb_build_object('observed_at',observed_at,'method_allowed',method_allowed,'authority_actor_current',authority_actor_current); END IF;
  RETURN to_jsonb(authority_actor_current);
 END IF;
 SELECT coalesce(max(e.revision),0) INTO catalog_rev FROM public.skill_events e WHERE e.organisation_id=org;
 SELECT coalesce(max(s.revision),0) INTO rev FROM public.task_skill_selections s WHERE (s.organisation_id,s.task_id)=(org,task);
 IF action='inspect' THEN
  SELECT jsonb_build_object('organisation_id',org,'revision',catalog_rev,'selection_revision',rev,
   'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'installed_at',v.installed_at,'revision',v.revision,'command',v.command,'digest',v.digest,'resource_digests',v.resource_digests,'status',s.status,'status_revision',s.revision,
   'status_event',jsonb_build_object('event_id',e.id,'actor_id',e.actor_id,'recorded_at',e.recorded_at,'revision',e.revision,'status',e.receipt->>'status','reason',e.command->>'reason')) ORDER BY v.revision) FROM public.skill_versions v JOIN public.skill_status s ON (s.organisation_id,s.version_id)=(v.organisation_id,v.id) JOIN public.skill_events e ON (e.organisation_id,e.id)=(s.organisation_id,s.event_id) WHERE v.organisation_id=org AND (v.client_id IS NULL OR v.client_id=client) AND (v.engagement_id IS NULL OR v.engagement_id=engagement)),'[]'::jsonb),
   'selections',coalesce((SELECT jsonb_agg(s.receipt ORDER BY s.revision) FROM public.task_skill_selections s WHERE (s.organisation_id,s.task_id)=(org,task)),'[]'::jsonb)) INTO result;
  RETURN result;
 END IF;
 IF action='replay' THEN
  RETURN coalesce((SELECT jsonb_build_object('command',s.command,'receipt',s.receipt) FROM public.task_skill_selections s WHERE (s.organisation_id,s.task_id,s.selector_id,s.key)=(org,task,actor,document->>'key')),'null'::jsonb);
 END IF;
 IF action<>'select' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 command:=document->'command'; result:=document->'receipt';
 IF jsonb_typeof(command) IS DISTINCT FROM 'object' OR jsonb_typeof(result) IS DISTINCT FROM 'object' OR coalesce(command->>'key','') !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 SELECT * INTO previous FROM public.task_skill_selections s WHERE (s.organisation_id,s.task_id,s.selector_id,s.key)=(org,task,actor,command->>'key');
 IF FOUND THEN
  IF previous.command<>command THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  RETURN previous.receipt;
 END IF;
 SELECT h.binding_id INTO binding FROM public.task_methodology_heads h WHERE (h.organisation_id,h.task_id)=(org,task);
 IF catalog_rev IS DISTINCT FROM (command->>'expected_catalog_revision')::bigint OR rev IS DISTINCT FROM (command->>'expected_selection_revision')::bigint OR t.execution_epoch IS DISTINCT FROM (command->>'expected_execution_epoch')::bigint OR binding IS DISTINCT FROM command->>'expected_methodology_binding_id' THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
 IF public.methodology_task(task,'allowed','{}'::jsonb) IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'methodology unavailable' USING ERRCODE='Z0002'; END IF;
 SELECT v.* INTO version FROM public.skill_versions v JOIN public.skill_status s ON (s.organisation_id,s.version_id)=(v.organisation_id,v.id) WHERE v.organisation_id=org AND v.id=command->>'version_id' AND s.status='enabled' AND (v.client_id IS NULL OR v.client_id=client) AND (v.engagement_id IS NULL OR v.engagement_id=engagement);
 IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF result->'methodology' IS DISTINCT FROM (SELECT b.document FROM public.task_methodology_bindings b WHERE (b.organisation_id,b.task_id,b.id)=(org,task,binding)) THEN RAISE EXCEPTION 'invalid method receipt' USING ERRCODE='Z0001'; END IF;
 result:=result||jsonb_build_object('task_id',task,'execution_epoch',t.execution_epoch,'selector_id',actor,'selected_at',floor(extract(epoch FROM clock_timestamp()))::bigint,'revision',rev+1,'catalog_revision',catalog_rev,'version_id',version.id,'skill_id',version.command->'manifest'->>'id','skill_version',version.command->'manifest'->>'version','digest',version.digest,'reason',command->>'reason');
 IF rev>=128 OR (SELECT coalesce(sum(octet_length(s.receipt::text)),0) FROM public.task_skill_selections s WHERE (s.organisation_id,s.task_id)=(org,task))+octet_length(result::text)>1048576 THEN RAISE EXCEPTION 'selection history capacity' USING ERRCODE='Z0006'; END IF;
 INSERT INTO public.task_skill_selections VALUES(org,client,engagement,task,result->>'id',actor,command->>'key',rev+1,version.id,command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.skills_read(text,text,text),public.skills_admin(text,text,text,text,jsonb),public.skills_impact(text,jsonb),public.skills_write(text,text,text,text,jsonb,text,text,text,jsonb),public.skills_task(text,text,jsonb) FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=9) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=9;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
