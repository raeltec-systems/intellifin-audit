-- Story 22.6: methods and installed skills during investigation. Additive:
-- published schemas 1-16 are unchanged. Every record is an immutable fact
-- written by trusted code under the exact claim producer's custody (or, for a
-- methodology proposal, the Admin's own session): each skill load, resource
-- fetch and script run, each method-part fetch, each method note, Zobba's own
-- investigation record per answered turn, and Admin methodology proposals.
-- `*_us` columns are database time in microseconds, the order every reader uses.

-- The worker's eligibility gate. It has no browser session: authority is the
-- exact consumed claim of the Task's current owner and execution epoch, its
-- accountable actor's current audit access, and the same immutable catalogue,
-- status, selection and method facts `skills_task` returns. Read-only.
-- Lock order: organisation advisory 205, then the engagement row, then the
-- Task row, as skills_task and skill status writers use. The worker's claim
-- transaction already holds 205 and the engagement (task::lock); taking them
-- again here is reentrant, so no lock is ever taken out of that order.
CREATE FUNCTION public.skills_work(task text,action text,document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE t public.tasks; actor text:=current_setting('zobba.actor_id',true); org text:=current_setting('zobba.organisation_id',true); client text:=current_setting('zobba.client_id',true); engagement text:=current_setting('zobba.engagement_id',true); result jsonb; rev bigint; catalog_rev bigint; authority text; observed_at bigint; method_allowed boolean; authority_actor_current boolean; claimed boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 PERFORM e.id FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(org,client,engagement) FOR UPDATE;
 SELECT * INTO t FROM public.tasks p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(org,client,engagement,task) FOR UPDATE;
 IF NOT FOUND OR NOT public.methodology_audit(org,client,engagement) OR t.accountable_actor IS DISTINCT FROM actor THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.task_claims c WHERE c.id=document->>'claim_id' AND c.process_instance=document->>'process_instance'
   AND (c.organisation_id,c.client_id,c.engagement_id,c.task_id,c.cycle_id)=(org,client,engagement,task,t.cycle_id)
   AND c.actor_id=actor AND c.state='consumed' AND c.worker_id=t.owner_id AND c.owner_epoch=t.owner_epoch AND c.execution_epoch=t.execution_epoch
   AND t.owner_until>clock_timestamp() AND t.state IN ('ready','running')
   AND NOT EXISTS(SELECT 1 FROM public.task_observations o WHERE o.claim_id=c.id)) INTO claimed;
 IF NOT claimed THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF action='fence' THEN
  observed_at:=floor(extract(epoch FROM clock_timestamp()))::bigint;
  method_allowed:=public.methodology_task(task,'allowed','{}'::jsonb)='true'::jsonb;
  SELECT (v.accepted_snapshot::jsonb)->>'actor_id' INTO authority FROM public.permission_heads h JOIN public.permission_versions v ON (v.organisation_id,v.policy_key,v.version)=(h.organisation_id,h.policy_key,h.current_version)
   WHERE h.organisation_id=org AND h.policy_key=octet_length(client)::text||':'||client||octet_length(engagement)::text||':'||engagement||'task:'||task;
  SELECT coalesce(authority=document->>'actor_id',false) AND EXISTS(SELECT 1 FROM public.identities i JOIN public.organisation_memberships m ON m.actor_id=i.id JOIN public.engagement_assignments a ON (a.organisation_id,a.actor_id)=(m.organisation_id,m.actor_id)
   WHERE i.id=authority AND i.active AND m.organisation_id=org AND m.active AND m.roles && ARRAY['auditor','audit_manager']::text[] AND (m.expires_at IS NULL OR m.expires_at>observed_at)
   AND (a.client_id,a.engagement_id)=(client,engagement) AND a.active AND (a.expires_at IS NULL OR a.expires_at>observed_at)) INTO authority_actor_current;
  IF NOT public.methodology_audit(org,client,engagement) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
  RETURN jsonb_build_object('observed_at',observed_at,'method_allowed',method_allowed,'authority_actor_current',authority_actor_current);
 END IF;
 IF action<>'inspect' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 SELECT coalesce(max(e.revision),0) INTO catalog_rev FROM public.skill_events e WHERE e.organisation_id=org;
 SELECT coalesce(max(s.revision),0) INTO rev FROM public.task_skill_selections s WHERE (s.organisation_id,s.task_id)=(org,task);
 SELECT jsonb_build_object('organisation_id',org,'revision',catalog_rev,'selection_revision',rev,
  'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'installed_at',v.installed_at,'revision',v.revision,'command',v.command,'digest',v.digest,'resource_digests',v.resource_digests,'status',s.status,'status_revision',s.revision,
  'status_event',jsonb_build_object('event_id',e.id,'actor_id',e.actor_id,'recorded_at',e.recorded_at,'revision',e.revision,'status',e.receipt->>'status','reason',e.command->>'reason')) ORDER BY v.revision) FROM public.skill_versions v JOIN public.skill_status s ON (s.organisation_id,s.version_id)=(v.organisation_id,v.id) JOIN public.skill_events e ON (e.organisation_id,e.id)=(s.organisation_id,s.event_id) WHERE v.organisation_id=org AND (v.client_id IS NULL OR v.client_id=client) AND (v.engagement_id IS NULL OR v.engagement_id=engagement)),'[]'::jsonb),
  'selections',coalesce((SELECT jsonb_agg(s.receipt ORDER BY s.revision) FROM public.task_skill_selections s WHERE (s.organisation_id,s.task_id)=(org,task)),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.skills_work(text,text,jsonb) FROM PUBLIC;

CREATE TABLE public.task_skill_uses (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('load','resource','script')),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
 version_id text NOT NULL CHECK(version_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 resource_id text CHECK(resource_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 -- The exact version as the fresh gate saw it; absent only when no such
 -- version exists in the Task's scope.
 skill_id text CHECK(skill_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 skill_version text CHECK(skill_version ~ '^[A-Za-z0-9_-]{1,128}$'),
 name text CHECK(char_length(name) BETWEEN 1 AND 200 AND name !~ '[[:cntrl:]]'),
 digest text CHECK(digest ~ '^[0-9a-f]{64}$'),
 catalog_revision bigint CHECK(catalog_revision >= 0),
 dependency_fingerprint text CHECK(dependency_fingerprint ~ '^[0-9a-f]{64}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 outcome text NOT NULL CHECK(outcome IN ('loaded','fetched','completed','failed','unavailable')),
 reason text CHECK(reason IN ('not_listed','tool_unavailable','forbidden','disabled','recalled','inapplicable','methodology_blocked','task_blocked','not_loaded','resource_missing','not_a_script','input_not_registered','invalid_program','program_failed','program_limit')),
 job_id text,
 inputs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(inputs)='array' AND jsonb_array_length(inputs) <= 8),
 output text CHECK(octet_length(output) <= 65536),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((kind='load') = (resource_id IS NULL)),
 CHECK((outcome IN ('failed','unavailable')) = (reason IS NOT NULL)),
 CHECK(CASE kind WHEN 'load' THEN outcome IN ('loaded','unavailable') WHEN 'resource' THEN outcome IN ('fetched','unavailable') ELSE outcome IN ('completed','failed','unavailable') END),
 CHECK((outcome='completed') = (output IS NOT NULL)),
 CHECK(outcome <> 'completed' OR job_id IS NOT NULL),
 CHECK(kind='script' OR (job_id IS NULL AND inputs='[]'::jsonb)),
 -- A performed use names the exact version, digest and dependency facts.
 CHECK(outcome='unavailable' OR (skill_id IS NOT NULL AND skill_version IS NOT NULL AND name IS NOT NULL AND digest IS NOT NULL AND catalog_revision IS NOT NULL AND dependency_fingerprint IS NOT NULL)),
 CHECK((skill_id IS NULL) = (digest IS NULL) AND (skill_id IS NULL) = (skill_version IS NULL) AND (skill_id IS NULL) = (name IS NULL)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,invocation_id,kind,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,job_id) REFERENCES public.analysis_jobs(organisation_id,client_id,engagement_id,id)
);
-- Exactly one load fact per invocation and version.
CREATE UNIQUE INDEX task_skill_uses_one_load ON public.task_skill_uses(organisation_id,client_id,engagement_id,invocation_id,version_id) WHERE kind='load';
CREATE UNIQUE INDEX task_skill_uses_one_job ON public.task_skill_uses(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX task_skill_uses_cycle ON public.task_skill_uses(organisation_id,client_id,engagement_id,task_id,cycle_id,created_us);
CREATE TABLE public.task_method_fetches (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
 part_id text NOT NULL CHECK(part_id ~ '^(criteria|procedure)/[A-Za-z0-9_-]{1,128}$|^template/[A-Za-z0-9_-]{1,128}/[A-Za-z0-9_-]{1,128}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 outcome text NOT NULL CHECK(outcome IN ('fetched','not_found','method_changed')),
 bytes bigint CHECK(bytes BETWEEN 0 AND 4194304),
 sha256 text CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((outcome='fetched') = (bytes IS NOT NULL) AND (bytes IS NULL) = (sha256 IS NULL)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX task_method_fetches_cycle ON public.task_method_fetches(organisation_id,client_id,engagement_id,task_id,cycle_id,created_us);
CREATE TABLE public.task_method_notes (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 63),
 source text NOT NULL CHECK(source IN ('agent','platform')),
 requirement_id text CHECK(requirement_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 kind text NOT NULL CHECK(kind IN ('gap','question','statement')),
 text text NOT NULL CHECK(octet_length(text) BETWEEN 1 AND 1000 AND btrim(text) <> '' AND text !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
 reason text CHECK(reason IN ('evidence_unavailable','action_not_permitted','tool_unavailable','criteria_missing','skill_unavailable')),
 segments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(segments)='array' AND jsonb_array_length(segments) <= 8),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 -- A gap has exactly one closed reason; only a statement points at citations;
 -- platform notes are deterministic gaps. There is no "complete" kind.
 CHECK((kind='gap') = (reason IS NOT NULL)),
 CHECK(kind='statement' OR segments='[]'::jsonb),
 CHECK(source='agent' OR (kind='gap' AND reason IN ('criteria_missing','skill_unavailable'))),
 PRIMARY KEY(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX task_method_notes_cycle ON public.task_method_notes(organisation_id,client_id,engagement_id,task_id,cycle_id,created_us);
-- Zobba's own provenance per answered turn: the method, skills, model and
-- tool catalogue the investigation used. Never the auditor's working brief.
CREATE TABLE public.task_investigation_notes (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK(document->>'methodology_binding_id' = methodology_binding_id AND (document->>'execution_epoch')::bigint = execution_epoch AND document->>'invocation_id' = invocation_id),
 PRIMARY KEY(organisation_id,client_id,engagement_id,invocation_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX task_investigation_notes_cycle ON public.task_investigation_notes(organisation_id,client_id,engagement_id,task_id,cycle_id,created_us);
-- Admin methodology proposals (configuration, not a Task). Each proposal is two
-- immutable events: the disclosure, recorded before the model is called, and
-- its result. A proposal has no effect until the Admin's own validated Save.
CREATE TABLE public.methodology_proposals (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 event text NOT NULL CHECK(event IN ('disclosure','result')),
 actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 1048576),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 -- The disclosure names the document by digest, the profile and the Admin.
 CHECK(event <> 'disclosure' OR (document->>'document_sha256' ~ '^[0-9a-f]{64}$' AND jsonb_typeof(document->'profile_id')='string' AND jsonb_typeof(document->'profile_revision')='number')),
 CHECK(event <> 'result' OR document->>'status' IN ('drafted','failed')),
 PRIMARY KEY(organisation_id,id,event)
);
CREATE UNIQUE INDEX methodology_proposals_key ON public.methodology_proposals(organisation_id,actor_id,key,event);
-- Facts must agree with what trusted code actually recorded elsewhere: each
-- belongs to its own answer invocation of this Task, cycle and actor, and is
-- bound to that turn's exact methodology binding and execution epoch.
CREATE FUNCTION public.investigation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_TABLE_NAME='methodology_proposals' THEN
  IF NEW.event='result' AND NOT EXISTS(SELECT 1 FROM public.methodology_proposals p WHERE (p.organisation_id,p.id,p.event)=(NEW.organisation_id,NEW.id,'disclosure') AND p.actor_id=NEW.actor_id AND p.key=NEW.key) THEN
   RAISE EXCEPTION 'a proposal result follows its recorded disclosure' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE i.id=NEW.invocation_id AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id
   AND i.request->'context'->'verification'->>'expected_methodology_binding_id' = NEW.methodology_binding_id
   AND (i.request->'basis'->>'execution_epoch')::bigint = NEW.execution_epoch) THEN
  RAISE EXCEPTION 'an investigation fact belongs to its answer invocation and its binding' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='task_skill_uses' THEN
  -- A resource or script of a skill that this cycle loaded under the same
  -- binding and epoch; a loaded use is never recorded for a different version.
  IF NEW.kind <> 'load' AND NEW.outcome <> 'unavailable' AND NOT EXISTS(SELECT 1 FROM public.task_skill_uses u
     WHERE (u.organisation_id,u.client_id,u.engagement_id,u.task_id,u.cycle_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id,NEW.cycle_id)
       AND u.kind='load' AND u.outcome='loaded' AND u.version_id=NEW.version_id AND u.digest=NEW.digest
       AND u.methodology_binding_id=NEW.methodology_binding_id AND u.execution_epoch=NEW.execution_epoch) THEN
   RAISE EXCEPTION 'a skill resource or script use follows a recorded load' USING ERRCODE='23514';
  END IF;
  -- A script run names a general job of this Task over exactly its inputs
  -- that ended: collected when it completed, failed or over a limit otherwise.
  IF NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.analysis_jobs j JOIN public.analysis_job_events e ON e.job_id=j.id
       AND e.status = ANY(CASE NEW.outcome WHEN 'completed' THEN ARRAY['collected'] ELSE ARRAY['collected','failed','limit_exceeded'] END)
     WHERE j.id=NEW.job_id AND j.task_id=NEW.task_id AND j.environment_id<>'document-python-3-13'
       AND (SELECT coalesce(jsonb_agg(x->>'original_id' ORDER BY x->>'original_id' COLLATE "C"),'[]'::jsonb) FROM jsonb_array_elements(j.inputs) x) = NEW.inputs) THEN
   RAISE EXCEPTION 'a script run names an ended job of its Task over its inputs' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='task_investigation_notes' THEN
  IF NEW.document->>'task_id' IS DISTINCT FROM NEW.task_id OR NEW.document->>'cycle_id' IS DISTINCT FROM NEW.cycle_id THEN
   RAISE EXCEPTION 'an investigation record names its own Task and cycle' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER investigation_guard BEFORE INSERT ON public.task_skill_uses FOR EACH ROW EXECUTE FUNCTION public.investigation_guard();
CREATE TRIGGER investigation_guard BEFORE INSERT ON public.task_method_fetches FOR EACH ROW EXECUTE FUNCTION public.investigation_guard();
CREATE TRIGGER investigation_guard BEFORE INSERT ON public.task_method_notes FOR EACH ROW EXECUTE FUNCTION public.investigation_guard();
CREATE TRIGGER investigation_guard BEFORE INSERT ON public.task_investigation_notes FOR EACH ROW EXECUTE FUNCTION public.investigation_guard();
CREATE TRIGGER investigation_guard BEFORE INSERT ON public.methodology_proposals FOR EACH ROW EXECUTE FUNCTION public.investigation_guard();
-- Every investigation record is an immutable, retained fact, even for the
-- owner: no UPDATE, DELETE or TRUNCATE. The one exception is an explicit
-- disposable fixture reset (a session setting) in a database named *_test,
-- which test harnesses use to clear synthetic data between cases.
CREATE FUNCTION public.investigation_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_OP='DELETE' AND pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'investigation records are immutable' USING ERRCODE='23514';
END $body$;
CREATE FUNCTION public.investigation_retained() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN NULL;
 END IF;
 RAISE EXCEPTION 'investigation records are retained' USING ERRCODE='23514';
END $body$;
CREATE TRIGGER investigation_immutable BEFORE UPDATE OR DELETE ON public.task_skill_uses FOR EACH ROW EXECUTE FUNCTION public.investigation_immutable();
CREATE TRIGGER investigation_immutable BEFORE UPDATE OR DELETE ON public.task_method_fetches FOR EACH ROW EXECUTE FUNCTION public.investigation_immutable();
CREATE TRIGGER investigation_immutable BEFORE UPDATE OR DELETE ON public.task_method_notes FOR EACH ROW EXECUTE FUNCTION public.investigation_immutable();
CREATE TRIGGER investigation_immutable BEFORE UPDATE OR DELETE ON public.task_investigation_notes FOR EACH ROW EXECUTE FUNCTION public.investigation_immutable();
CREATE TRIGGER investigation_immutable BEFORE UPDATE OR DELETE ON public.methodology_proposals FOR EACH ROW EXECUTE FUNCTION public.investigation_immutable();
CREATE TRIGGER investigation_retained BEFORE TRUNCATE ON public.task_skill_uses FOR EACH STATEMENT EXECUTE FUNCTION public.investigation_retained();
CREATE TRIGGER investigation_retained BEFORE TRUNCATE ON public.task_method_fetches FOR EACH STATEMENT EXECUTE FUNCTION public.investigation_retained();
CREATE TRIGGER investigation_retained BEFORE TRUNCATE ON public.task_method_notes FOR EACH STATEMENT EXECUTE FUNCTION public.investigation_retained();
CREATE TRIGGER investigation_retained BEFORE TRUNCATE ON public.task_investigation_notes FOR EACH STATEMENT EXECUTE FUNCTION public.investigation_retained();
CREATE TRIGGER investigation_retained BEFORE TRUNCATE ON public.methodology_proposals FOR EACH STATEMENT EXECUTE FUNCTION public.investigation_retained();
REVOKE ALL ON FUNCTION public.investigation_guard(),public.investigation_immutable(),public.investigation_retained() FROM PUBLIC;
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['task_skill_uses','task_method_fetches','task_method_notes','task_investigation_notes'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT USING (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)))',relation,relation,relation,relation);
  EXECUTE format('CREATE POLICY scoped_insert ON public.%I FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)) AND actor_id=pg_catalog.current_setting(''zobba.actor_id'',true))',relation,relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $policies$;
ALTER TABLE public.methodology_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.methodology_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON public.methodology_proposals FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND public.model_configuration_admin(pg_catalog.current_setting('zobba.actor_id',true),organisation_id,pg_catalog.current_setting('zobba.model_session_hash',true)));
CREATE POLICY admin_insert ON public.methodology_proposals FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND actor_id=pg_catalog.current_setting('zobba.actor_id',true) AND public.model_configuration_admin(actor_id,organisation_id,pg_catalog.current_setting('zobba.model_session_hash',true)));
REVOKE ALL ON public.methodology_proposals FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=17) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=17;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
