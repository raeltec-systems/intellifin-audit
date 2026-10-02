-- Immutable methodology configuration is an Admin control plane. Audit work
-- remains behind its existing assignment boundary; no runtime table grants.
ALTER TABLE public.task_commands ADD COLUMN methodology_context jsonb;
ALTER TABLE public.task_commands ADD CHECK(methodology_context IS NULL OR (kind IN ('create','guide') AND jsonb_typeof(methodology_context)='object' AND octet_length(methodology_context::text)<=2048));
CREATE TABLE public.methodology_versions (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 actor_id text NOT NULL REFERENCES public.identities(id),
 saved_at bigint NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 command jsonb NOT NULL CHECK(jsonb_typeof(command)='object' AND octet_length(command::text)<=1048576),
 PRIMARY KEY(organisation_id,id), UNIQUE(organisation_id,revision)
);
CREATE TABLE public.methodology_assignments (
 organisation_id text NOT NULL, version_id text NOT NULL,
 client_id text, engagement_id text, available_at bigint NOT NULL CHECK(available_at BETWEEN 0 AND 253402300799),
 supersedes text,
 PRIMARY KEY(organisation_id,version_id),
 FOREIGN KEY(organisation_id,version_id) REFERENCES public.methodology_versions(organisation_id,id),
 FOREIGN KEY(organisation_id,supersedes) REFERENCES public.methodology_versions(organisation_id,id),
 FOREIGN KEY(organisation_id,client_id) REFERENCES public.clients(organisation_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id),
 CHECK(engagement_id IS NULL OR client_id IS NOT NULL)
);
CREATE TABLE public.methodology_events (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 revision bigint NOT NULL CHECK(revision>0), kind text NOT NULL CHECK(kind IN ('save','recall')),
 command jsonb NOT NULL, receipt jsonb NOT NULL, recorded_at bigint NOT NULL,
 PRIMARY KEY(organisation_id,id), UNIQUE(organisation_id,actor_id,key), UNIQUE(organisation_id,revision)
);
CREATE TABLE public.methodology_recalls (
 organisation_id text NOT NULL, version_id text NOT NULL, event_id text NOT NULL,
 PRIMARY KEY(organisation_id,version_id),
 FOREIGN KEY(organisation_id,version_id) REFERENCES public.methodology_versions(organisation_id,id),
 FOREIGN KEY(organisation_id,event_id) REFERENCES public.methodology_events(organisation_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE public.task_methodology_bindings (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL, task_id text NOT NULL,
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'), document jsonb NOT NULL,
 PRIMARY KEY(organisation_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id)
);
CREATE TABLE public.task_methodology_heads (
 organisation_id text NOT NULL, task_id text NOT NULL, binding_id text NOT NULL,
 context jsonb NOT NULL, pending_context_command text REFERENCES public.task_commands(id), pending_context_at bigint,
 CHECK((pending_context_command IS NULL)=(pending_context_at IS NULL)),
 PRIMARY KEY(organisation_id,task_id),
 FOREIGN KEY(organisation_id,task_id,binding_id) REFERENCES public.task_methodology_bindings(organisation_id,task_id,id)
);
CREATE TABLE public.task_methodology_changes (
 organisation_id text NOT NULL, task_id text NOT NULL, event_id text NOT NULL,
 available_at bigint NOT NULL, applied_binding_id text, apply_requested boolean NOT NULL,
 PRIMARY KEY(organisation_id,task_id,event_id),
 FOREIGN KEY(organisation_id,task_id) REFERENCES public.task_methodology_heads(organisation_id,task_id),
 FOREIGN KEY(organisation_id,event_id) REFERENCES public.methodology_events(organisation_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(organisation_id,task_id,applied_binding_id) REFERENCES public.task_methodology_bindings(organisation_id,task_id,id)
);
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['methodology_versions','methodology_assignments','methodology_events','methodology_recalls','task_methodology_bindings','task_methodology_heads','task_methodology_changes'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY methodology_owner ON public.%I USING (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=''public'' AND c.relname=%L AND pg_catalog.pg_get_userbyid(c.relowner)=current_user)) WITH CHECK (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=''public'' AND c.relname=%L AND pg_catalog.pg_get_userbyid(c.relowner)=current_user))',relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $policies$;

-- Private check used only inside owner-mediated Task methods. Captured transaction
-- scope is mandatory and Admin alone never satisfies the audit role requirement.
CREATE FUNCTION public.methodology_audit(org text,client text,engagement text) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog,public AS $$
 SELECT org=current_setting('zobba.organisation_id',true) AND client=current_setting('zobba.client_id',true) AND engagement=current_setting('zobba.engagement_id',true)
 AND EXISTS(SELECT 1 FROM public.engagement_assignments a JOIN public.organisation_memberships m ON (m.organisation_id,m.actor_id)=(a.organisation_id,a.actor_id) JOIN public.identities i ON i.id=a.actor_id
 WHERE (a.organisation_id,a.client_id,a.engagement_id)=(org,client,engagement) AND a.actor_id=current_setting('zobba.actor_id',true)
 AND i.active AND a.active AND m.active AND m.roles && ARRAY['auditor','audit_manager']::text[]
 AND (a.expires_at IS NULL OR a.expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint) AND (m.expires_at IS NULL OR m.expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint))
$$;
CREATE FUNCTION public.methodology_read(actor text,session_hash text,org text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR NOT public.evidence_session_locked(actor,session_hash) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF NOT public.membership_admin(actor,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF (SELECT count(*) FROM public.engagements e WHERE e.organisation_id=org)>512 THEN RAISE EXCEPTION 'assignment options capacity' USING ERRCODE='Z0006'; END IF;
 SELECT jsonb_build_object('organisation_id',org,'revision',coalesce((SELECT max(e.revision) FROM public.methodology_events e WHERE e.organisation_id=org),0),
 'versions',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'saved_at',v.saved_at,'revision',v.revision,'command',v.command,'recalled',EXISTS(SELECT 1 FROM public.methodology_recalls r WHERE (r.organisation_id,r.version_id)=(org,v.id))) ORDER BY v.revision) FROM public.methodology_versions v WHERE v.organisation_id=org),'[]'::jsonb),
 'impacts',coalesce((SELECT jsonb_agg(e.receipt->'impact' ORDER BY e.revision) FROM public.methodology_events e WHERE e.organisation_id=org),'[]'::jsonb),
 'engagements',coalesce((SELECT jsonb_agg(jsonb_build_object('client_id',e.client_id,'client_name',c.name,'engagement_id',e.id,'engagement_name',e.name) ORDER BY e.client_id,e.id) FROM public.engagements e JOIN public.clients c ON (c.organisation_id,c.id)=(e.organisation_id,e.client_id) WHERE e.organisation_id=org),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;

-- Save and recall serialize on the same organisation fence as membership edits,
-- then lock engagements and Tasks in a stable order before exact-session proof.
CREATE FUNCTION public.methodology_write(actor text,session_hash text,org text,kind text,command jsonb,event_id text,version_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE previous public.methodology_events; prior public.methodology_versions; rev bigint; now_at bigint; result jsonb; impact jsonb; affected bigint:=0; pending_count bigint:=0; target record; mode text; available bigint; scope_doc jsonb; changes jsonb;
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR kind NOT IN ('save','recall') OR jsonb_typeof(command) IS DISTINCT FROM 'object' OR octet_length(command::text)>1048576 OR command->>'key' !~ '^[A-Za-z0-9_-]{1,128}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 IF NOT public.membership_admin(actor,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 PERFORM e.id FROM public.engagements e WHERE e.organisation_id=org ORDER BY e.client_id,e.id FOR UPDATE;
 PERFORM t.id FROM public.tasks t WHERE t.organisation_id=org ORDER BY t.client_id,t.engagement_id,t.id FOR UPDATE;
 IF NOT public.evidence_session_locked(actor,session_hash) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF NOT public.membership_admin(actor,org) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT * INTO previous FROM public.methodology_events e WHERE e.organisation_id=org AND e.actor_id=actor AND e.key=command->>'key';
 IF FOUND THEN
  IF previous.kind<>kind OR previous.command<>command THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  RETURN previous.receipt;
 END IF;
 SELECT coalesce(max(e.revision),0) INTO rev FROM public.methodology_events e WHERE e.organisation_id=org;
 IF rev IS DISTINCT FROM (command->>'expected_revision')::bigint THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
 IF kind='save' AND ((SELECT count(*) FROM public.methodology_versions v WHERE v.organisation_id=org)>=128 OR (SELECT coalesce(sum(octet_length(v.command::text)),0) FROM public.methodology_versions v WHERE v.organisation_id=org)+octet_length(command::text)>524288) THEN RAISE EXCEPTION 'capacity' USING ERRCODE='Z0006'; END IF;
 rev:=rev+1; now_at:=floor(extract(epoch FROM clock_timestamp()))::bigint;
 IF kind='save' THEN
  scope_doc:=command->'assignment'; mode:=command->'activation'->>'mode'; available:=(command->'activation'->>'available_at')::bigint;
  IF scope_doc->>'kind' NOT IN ('firm','client','engagement') OR mode NOT IN ('new_tasks','active_tasks') OR available NOT BETWEEN 0 AND 253402300799
   OR (scope_doc->>'kind'='firm' AND (scope_doc->>'client_id' IS NOT NULL OR scope_doc->>'engagement_id' IS NOT NULL))
   OR (scope_doc->>'kind'='client' AND (scope_doc->>'client_id' IS NULL OR scope_doc->>'engagement_id' IS NOT NULL))
   OR (scope_doc->>'kind'='engagement' AND (scope_doc->>'client_id' IS NULL OR scope_doc->>'engagement_id' IS NULL))
   OR (scope_doc->>'client_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.clients c WHERE (c.organisation_id,c.id)=(org,scope_doc->>'client_id')))
   OR (scope_doc->>'engagement_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(org,scope_doc->>'client_id',scope_doc->>'engagement_id')))
   THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  IF command->>'supersedes' IS NOT NULL THEN
   SELECT * INTO prior FROM public.methodology_versions v WHERE v.organisation_id=org AND v.id=command->>'supersedes';
   IF NOT FOUND OR prior.command->'assignment'<>scope_doc OR prior.command->'applicability'<>command->'applicability' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
   IF EXISTS(SELECT 1 FROM public.methodology_assignments a WHERE a.organisation_id=org AND a.supersedes=prior.id) THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  END IF;
  IF command->>'undo_of' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.methodology_versions v WHERE v.organisation_id=org AND v.id=command->>'undo_of' AND v.command->'definition'=command->'definition' AND v.command->'assignment'=command->'assignment' AND v.command->'applicability'=command->'applicability') THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  -- Template identity is immutable across every version and assignment in
  -- this organisation. Changed content requires a new template version.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(command->'definition'->'templates','[]'::jsonb)) proposed(tpl), public.methodology_versions v, LATERAL jsonb_array_elements(coalesce(v.command->'definition'->'templates','[]'::jsonb)) saved(tpl)
   WHERE v.organisation_id=org AND (proposed.tpl->>'id',proposed.tpl->>'version')=(saved.tpl->>'id',saved.tpl->>'version') AND proposed.tpl<>saved.tpl)
   THEN RAISE EXCEPTION 'template version is immutable' USING ERRCODE='Z0001'; END IF;
  -- Template references must resolve to an exact, appropriately scoped saved
  -- definition or to the immutable definitions included in this Save.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(command->'definition'->'requirements') r(v), LATERAL jsonb_array_elements(coalesce(nullif(r.v->'templates','null'::jsonb),'[]'::jsonb)) refs(ref)
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(command->'definition'->'templates','[]'::jsonb)) own(tpl) WHERE (own.tpl->>'id',own.tpl->>'version')=(refs.ref->>'id',refs.ref->>'version'))
   AND NOT EXISTS(SELECT 1 FROM public.methodology_versions v JOIN public.methodology_assignments a ON (a.organisation_id,a.version_id)=(v.organisation_id,v.id), LATERAL jsonb_array_elements(coalesce(v.command->'definition'->'templates','[]'::jsonb)) inherited(tpl)
    WHERE v.organisation_id=org AND (a.client_id IS NULL OR a.client_id=scope_doc->>'client_id') AND (a.engagement_id IS NULL OR a.engagement_id=scope_doc->>'engagement_id') AND a.available_at<=greatest(available,now_at)
    AND NOT EXISTS(SELECT 1 FROM public.methodology_recalls rc WHERE (rc.organisation_id,rc.version_id)=(org,v.id))
    AND (inherited.tpl->>'id',inherited.tpl->>'version')=(refs.ref->>'id',refs.ref->>'version')))
   THEN RAISE EXCEPTION 'invalid template reference' USING ERRCODE='Z0001'; END IF;
  -- The first authorized immutable definition remains the exact source of a
  -- template identity. Re-declaring identical content cannot bypass recall.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(command->'definition'->'requirements') r(v), LATERAL jsonb_array_elements(coalesce(nullif(r.v->'templates','null'::jsonb),'[]'::jsonb)) refs(ref)
   WHERE EXISTS(SELECT 1 FROM public.methodology_recalls rc WHERE rc.organisation_id=org AND rc.version_id=(
    SELECT v.id FROM public.methodology_versions v JOIN public.methodology_assignments a ON (a.organisation_id,a.version_id)=(v.organisation_id,v.id), LATERAL jsonb_array_elements(v.command->'definition'->'templates') tpl(v)
    WHERE v.organisation_id=org AND (a.client_id IS NULL OR a.client_id=scope_doc->>'client_id') AND (a.engagement_id IS NULL OR a.engagement_id=scope_doc->>'engagement_id') AND a.available_at<=greatest(available,now_at)
    AND (tpl.v->>'id',tpl.v->>'version')=(refs.ref->>'id',refs.ref->>'version') ORDER BY v.revision,v.id LIMIT 1)))
   THEN RAISE EXCEPTION 'recalled template source' USING ERRCODE='Z0001'; END IF;
  INSERT INTO public.methodology_versions VALUES(org,version_id,actor,now_at,rev,command);
  INSERT INTO public.methodology_assignments VALUES(org,version_id,scope_doc->>'client_id',scope_doc->>'engagement_id',available,command->>'supersedes');
  SELECT coalesce(jsonb_agg('Changed '||field ORDER BY field),jsonb_build_array('Attribution or activation changed')) INTO changes FROM jsonb_object_keys(command-'key'-'expected_revision'-'supersedes'-'undo_of') AS fields(field) WHERE prior.id IS NULL OR (prior.command->field) IS DISTINCT FROM (command->field);
 ELSE
  version_id:=command->>'version_id'; mode:='active_tasks'; available:=now_at;
  SELECT * INTO prior FROM public.methodology_versions v WHERE (v.organisation_id,v.id)=(org,version_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.methodology_recalls r WHERE (r.organisation_id,r.version_id)=(org,version_id)) THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  scope_doc:=prior.command->'assignment';
  INSERT INTO public.methodology_recalls VALUES(org,version_id,event_id);
  changes:=jsonb_build_array('Recalled: '||(command->>'reason'));
 END IF;
 IF kind='save' AND mode='active_tasks' THEN changes:=changes||jsonb_build_array('Admitted candidate pool changed; criteria remain filtered by Task context'); END IF;
 FOR target IN SELECT t.* FROM public.tasks t WHERE t.organisation_id=org AND t.state<>'stopped'
  AND (scope_doc->>'client_id' IS NULL OR t.client_id=scope_doc->>'client_id') AND (scope_doc->>'engagement_id' IS NULL OR t.engagement_id=scope_doc->>'engagement_id')
  AND EXISTS(SELECT 1 FROM public.task_methodology_heads h JOIN public.task_methodology_bindings b ON (b.organisation_id,b.task_id,b.id)=(h.organisation_id,h.task_id,h.binding_id) WHERE (h.organisation_id,h.task_id)=(org,t.id)
   AND CASE WHEN kind='recall' THEN ((b.document->'resolution'->'version_ids') ? version_id OR EXISTS(SELECT 1 FROM jsonb_array_elements(b.document->'resolution'->'templates') tpl(v) WHERE tpl.v->>'source_version_id'=version_id)) ELSE mode='active_tasks' OR
    (command->'applicability'->>'audit_area' IS NULL OR h.context->>'audit_area' IS NULL OR command->'applicability'->>'audit_area'=h.context->>'audit_area')
    AND (command->'applicability'->>'period_start' IS NULL OR h.context->>'period_start' IS NULL OR (command->'applicability'->>'period_start'<=h.context->>'period_end' AND command->'applicability'->>'period_end'>=h.context->>'period_start')) END)
  ORDER BY t.client_id,t.engagement_id,t.id LOOP
  affected:=affected+1;
  INSERT INTO public.task_methodology_changes VALUES(org,target.id,event_id,available,NULL,mode='active_tasks');
  IF mode='active_tasks' THEN
   -- Reserve a complete future binding for every queued activation and Guide.
   -- 4096 covers neutral/context/metadata even with no saved versions; 16x
   -- covers copied content, issue labels, and all nine per-field provenance
   -- entries even with the schema maximum 128-byte version identifiers.
   -- A recall only overlays restriction and never consumes a new binding.
   IF kind='save' AND (SELECT coalesce(sum(octet_length(b.document::text)),0) FROM public.task_methodology_bindings b WHERE (b.organisation_id,b.task_id)=(org,target.id)) + (4096+16*(SELECT coalesce(sum(octet_length(v.command::text)),0) FROM public.methodology_versions v WHERE v.organisation_id=org))*((SELECT count(*) FROM public.task_methodology_changes c WHERE (c.organisation_id,c.task_id)=(org,target.id) AND c.apply_requested AND c.applied_binding_id IS NULL)+(SELECT (h.pending_context_command IS NOT NULL)::int FROM public.task_methodology_heads h WHERE (h.organisation_id,h.task_id)=(org,target.id)))>1048576 THEN RAISE EXCEPTION 'capacity' USING ERRCODE='Z0006'; END IF;
   pending_count:=pending_count+1;
   IF available<=now_at THEN
    UPDATE public.task_claims SET state='abandoned' WHERE task_id=target.id AND state='admitted';
    UPDATE public.operation_claims c SET state='abandoned' WHERE c.state='admitted' AND EXISTS(SELECT 1 FROM public.operations o WHERE o.id=c.operation_id AND o.task_id=target.id);
   END IF;
   UPDATE public.task_wakeups SET pending=true,available_at=least(task_wakeups.available_at,to_timestamp(available)) WHERE task_id=target.id;
  END IF;
 END LOOP;
 impact:=jsonb_build_object('id',event_id,'version_id',version_id,'activation_mode',mode,'affected_tasks',affected,'pending_tasks',pending_count,'retained_tasks',affected-pending_count,'potentially_material',true,'diff',changes);
 result:=jsonb_build_object('event_id',event_id,'organisation_id',org,'actor_id',actor,'version_id',version_id,'revision',rev,'kind',kind,'impact',impact);
 INSERT INTO public.methodology_events VALUES(org,event_id,actor,command->>'key',rev,kind,command,result,now_at);
 RETURN result;
END $$;

-- Only configurations eligible for the current audit scope leave this function.
-- Supersession applies at availability time, independently of business dates.
CREATE FUNCTION public.methodology_candidates(org text,client text,engagement text,as_of bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF as_of NOT BETWEEN 0 AND 253402300799 THEN RAISE EXCEPTION 'invalid availability time' USING ERRCODE='Z0001'; END IF;
 IF NOT public.methodology_audit(org,client,engagement) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 WITH RECURSIVE retired(id) AS (
  SELECT a.supersedes FROM public.methodology_assignments a WHERE a.organisation_id=org AND a.supersedes IS NOT NULL AND a.available_at<=as_of
  UNION SELECT a.supersedes FROM public.methodology_assignments a JOIN retired r ON r.id=a.version_id WHERE a.organisation_id=org AND a.supersedes IS NOT NULL
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'saved_at',v.saved_at,'revision',v.revision,'command',v.command,'recalled',EXISTS(SELECT 1 FROM public.methodology_recalls r WHERE (r.organisation_id,r.version_id)=(org,v.id))) ORDER BY v.revision),'[]'::jsonb) INTO result
 FROM public.methodology_versions v JOIN public.methodology_assignments a ON (a.organisation_id,a.version_id)=(v.organisation_id,v.id)
 WHERE v.organisation_id=org AND (a.client_id IS NULL OR a.client_id=client) AND (a.engagement_id IS NULL OR a.engagement_id=engagement)
 AND NOT EXISTS(SELECT 1 FROM retired r WHERE r.id=v.id);
 RETURN result;
END $$;

-- Internal Rust adapter owns pure resolution; this function retains immutable
-- bindings, controls the head, and never changes historical receipt/claim basis.
CREATE FUNCTION public.methodology_task(task text,action text,document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_variable
DECLARE t public.tasks; head public.task_methodology_heads; latest public.methodology_events; pending public.task_commands; result jsonb; now_at bigint; recalled boolean; candidate jsonb; queued bigint; cutoff bigint;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=task;
 IF NOT FOUND OR NOT public.methodology_audit(t.organisation_id,t.client_id,t.engagement_id) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT * INTO head FROM public.task_methodology_heads h WHERE (h.organisation_id,h.task_id)=(t.organisation_id,task);
 now_at:=floor(extract(epoch FROM clock_timestamp()))::bigint;
 SELECT c.* INTO pending FROM public.task_commands c WHERE c.id=head.pending_context_command AND (c.organisation_id,c.task_id)=(t.organisation_id,task);
 IF action='basis' THEN
  IF (document->>'execution_epoch')::bigint NOT BETWEEN 0 AND t.execution_epoch THEN RAISE EXCEPTION 'invalid producing epoch' USING ERRCODE='Z0001'; END IF;
  SELECT to_jsonb(b.id) INTO result FROM public.task_methodology_bindings b WHERE (b.organisation_id,b.task_id)=(t.organisation_id,task) AND (b.document->>'execution_epoch')::bigint<=(document->>'execution_epoch')::bigint ORDER BY (b.document->>'execution_epoch')::bigint DESC LIMIT 1;
  IF result IS NULL THEN RAISE EXCEPTION 'missing producing basis' USING ERRCODE='Z0002'; END IF;
  RETURN result;
 END IF;
 IF action='bind' THEN
  document:=jsonb_set(document,'{binding,execution_epoch}',to_jsonb(t.execution_epoch),true);
  document:=jsonb_set(document,'{binding,context_command_id}','null'::jsonb,true);
  IF head.task_id IS NOT NULL THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  IF octet_length((document->'binding')::text)>1048576 THEN RAISE EXCEPTION 'binding history capacity' USING ERRCODE='Z0006'; END IF;
  INSERT INTO public.task_methodology_bindings VALUES(t.organisation_id,t.client_id,t.engagement_id,task,document->'binding'->>'id',document->'binding');
  INSERT INTO public.task_methodology_heads VALUES(t.organisation_id,task,document->'binding'->>'id',document->'binding'->'resolution'->'context',NULL,NULL);
  PERFORM public.methodology_task(task,'cohort',jsonb_build_object('at',(document->'binding'->>'bound_at')::bigint));
  RETURN '{}'::jsonb;
 END IF;
 IF action='cohort' THEN
  cutoff:=(document->>'at')::bigint;
  IF cutoff IS NULL OR cutoff NOT BETWEEN 0 AND now_at OR head.task_id IS NULL THEN RAISE EXCEPTION 'invalid cohort cutoff' USING ERRCODE='Z0001'; END IF;
  -- New and continued Tasks use the same captured eligibility instant. A Task
  -- continued after an activation cutoff retains its prior pinned methodology.
  FOR candidate IN SELECT v FROM jsonb_array_elements(public.methodology_candidates(t.organisation_id,t.client_id,t.engagement_id,cutoff)) entries(v) LOOP
   IF candidate->'command'->'activation'->>'mode'='active_tasks' AND (candidate->'command'->'activation'->>'available_at')::bigint>cutoff THEN
    INSERT INTO public.task_methodology_changes SELECT t.organisation_id,task,e.id,(candidate->'command'->'activation'->>'available_at')::bigint,NULL,true FROM public.methodology_events e WHERE e.organisation_id=t.organisation_id AND e.kind='save' AND e.receipt->>'version_id'=candidate->>'id' ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
  SELECT count(*)+(head.pending_context_command IS NOT NULL)::int INTO queued FROM public.task_methodology_changes c WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.apply_requested AND c.applied_binding_id IS NULL;
  IF queued>0 AND (SELECT coalesce(sum(octet_length(b.document::text)),0) FROM public.task_methodology_bindings b WHERE (b.organisation_id,b.task_id)=(t.organisation_id,task))+queued*(4096+16*(SELECT coalesce(sum(octet_length(v.command::text)),0) FROM public.methodology_versions v WHERE v.organisation_id=t.organisation_id))>1048576 THEN RAISE EXCEPTION 'binding history capacity' USING ERRCODE='Z0006'; END IF;
  UPDATE public.task_wakeups SET pending=true,available_at=least(task_wakeups.available_at,to_timestamp((SELECT min(c.available_at) FROM public.task_methodology_changes c WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.apply_requested AND c.applied_binding_id IS NULL))) WHERE task_id=task AND queued>0;
  RETURN '{}'::jsonb;
 END IF;
 IF action='templates' THEN
  cutoff:=(document->>'at')::bigint;
  IF cutoff IS NULL OR cutoff NOT BETWEEN 0 AND 253402300799 THEN RAISE EXCEPTION 'invalid template cutoff' USING ERRCODE='Z0001'; END IF;
  -- Exact referenced template content is immutable library data. Superseded
  -- definitions remain retrievable without importing their criteria/defaults.
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'saved_at',v.saved_at,'revision',v.revision,'command',v.command,'recalled',EXISTS(SELECT 1 FROM public.methodology_recalls r WHERE (r.organisation_id,r.version_id)=(v.organisation_id,v.id))) ORDER BY v.revision),'[]'::jsonb) FROM public.methodology_versions v JOIN public.methodology_assignments a ON (a.organisation_id,a.version_id)=(v.organisation_id,v.id) WHERE v.organisation_id=t.organisation_id AND (a.client_id IS NULL OR a.client_id=t.client_id) AND (a.engagement_id IS NULL OR a.engagement_id=t.engagement_id) AND a.available_at<=cutoff AND jsonb_array_length(v.command->'definition'->'templates')>0);
 END IF;
 IF action='context' THEN
  SELECT c.* INTO pending FROM public.task_commands c WHERE c.id=document->>'command_id' AND (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.kind='guide' AND c.author_id=current_setting('zobba.actor_id',true) AND c.author_id=document->>'actor_id' AND c.methodology_context=document->'context';
  IF NOT FOUND OR pending.methodology_context IS NULL THEN RAISE EXCEPTION 'invalid context command' USING ERRCODE='Z0001'; END IF;
  SELECT count(*)+1 INTO queued FROM public.task_methodology_changes c WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.apply_requested AND c.applied_binding_id IS NULL;
  IF (SELECT coalesce(sum(octet_length(b.document::text)),0) FROM public.task_methodology_bindings b WHERE (b.organisation_id,b.task_id)=(t.organisation_id,task))+queued*(4096+16*(SELECT coalesce(sum(octet_length(v.command::text)),0) FROM public.methodology_versions v WHERE v.organisation_id=t.organisation_id))>1048576 THEN RAISE EXCEPTION 'binding history capacity' USING ERRCODE='Z0006'; END IF;
  UPDATE public.task_methodology_heads SET pending_context_command=pending.id,pending_context_at=now_at WHERE (organisation_id,task_id)=(t.organisation_id,task);
  RETURN '{}'::jsonb;
 END IF;
 IF action='candidates' THEN
  -- Existing Tasks start from exact pinned versions. Only due, explicit active
  -- edits enter this set; intervening new-Task-only Saves never sneak in.
  RETURN (WITH RECURSIVE selected(id) AS (
    SELECT jsonb_array_elements_text(b.document->'candidate_version_ids') FROM public.task_methodology_bindings b WHERE (b.organisation_id,b.task_id,b.id)=(t.organisation_id,task,head.binding_id)
    UNION SELECT e.receipt->>'version_id' FROM public.task_methodology_changes c JOIN public.methodology_events e ON (e.organisation_id,e.id)=(c.organisation_id,c.event_id) WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.apply_requested AND c.applied_binding_id IS NULL AND c.available_at<=coalesce((document->>'at')::bigint,now_at) AND e.kind='save'
   ), ancestors(id) AS (
    SELECT a.supersedes FROM public.methodology_assignments a JOIN selected s ON s.id=a.version_id WHERE a.organisation_id=t.organisation_id AND a.supersedes IS NOT NULL
    UNION SELECT a.supersedes FROM public.methodology_assignments a JOIN ancestors p ON p.id=a.version_id WHERE a.organisation_id=t.organisation_id AND a.supersedes IS NOT NULL
   ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'actor_id',v.actor_id,'saved_at',v.saved_at,'revision',v.revision,'command',v.command,'recalled',EXISTS(SELECT 1 FROM public.methodology_recalls r WHERE (r.organisation_id,r.version_id)=(v.organisation_id,v.id))) ORDER BY v.revision),'[]'::jsonb) FROM public.methodology_versions v JOIN selected s ON s.id=v.id WHERE v.organisation_id=t.organisation_id AND NOT EXISTS(SELECT 1 FROM ancestors a WHERE a.id=v.id));
 END IF;
 IF action='apply' THEN
  -- Resolution and acknowledgement share one immutable captured cutoff. A
  -- later activation remains pending even if this statement crosses its time.
  cutoff:=(document->>'bound_at')::bigint;
  IF cutoff IS NULL OR cutoff NOT BETWEEN 0 AND now_at THEN RAISE EXCEPTION 'invalid resolution cutoff' USING ERRCODE='Z0001'; END IF;
  IF head.pending_context_command IS NULL AND NOT EXISTS(SELECT 1 FROM public.task_methodology_changes c WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.apply_requested AND c.applied_binding_id IS NULL AND c.available_at<=cutoff) THEN RETURN 'false'::jsonb; END IF;
  IF EXISTS(SELECT 1 FROM public.task_claims c WHERE c.task_id=task AND c.state='consumed' AND NOT EXISTS(SELECT 1 FROM public.task_observations o WHERE o.claim_id=c.id))
   OR EXISTS(SELECT 1 FROM public.operation_claims c JOIN public.operations o ON o.id=c.operation_id WHERE o.task_id=task AND c.state='consumed' AND NOT EXISTS(SELECT 1 FROM public.operation_receipts r WHERE r.attempt_id=c.attempt_id AND r.outcome IN ('completed','absent')))
   THEN RETURN 'false'::jsonb; END IF;
  -- Recall is a current restriction overlay, not a new version or permission.
  -- Preserve the exact original binding when only recalls are being reconciled;
  -- this path must remain available even when configuration/history is at capacity.
  IF head.pending_context_command IS NULL AND NOT EXISTS(SELECT 1 FROM public.task_methodology_changes c JOIN public.methodology_events e ON (e.organisation_id,e.id)=(c.organisation_id,c.event_id) WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.apply_requested AND c.applied_binding_id IS NULL AND c.available_at<=cutoff AND e.kind='save') THEN
   UPDATE public.task_methodology_changes SET applied_binding_id=head.binding_id WHERE (organisation_id,task_id)=(t.organisation_id,task) AND apply_requested AND applied_binding_id IS NULL AND available_at<=cutoff;
   RETURN 'false'::jsonb;
  END IF;
  document:=jsonb_set(document,'{execution_epoch}',to_jsonb(t.execution_epoch+1),true);
  document:=jsonb_set(document,'{context_command_id}',coalesce(to_jsonb(head.pending_context_command),(SELECT b.document->'context_command_id' FROM public.task_methodology_bindings b WHERE (b.organisation_id,b.task_id,b.id)=(t.organisation_id,task,head.binding_id)),'null'::jsonb),true);
  IF (SELECT coalesce(sum(octet_length(b.document::text)),0) FROM public.task_methodology_bindings b WHERE (b.organisation_id,b.task_id)=(t.organisation_id,task))+octet_length(document::text)>1048576 THEN RAISE EXCEPTION 'binding history capacity' USING ERRCODE='Z0006'; END IF;
  INSERT INTO public.task_methodology_bindings VALUES(t.organisation_id,t.client_id,t.engagement_id,task,document->>'id',document);
  UPDATE public.task_methodology_heads SET binding_id=document->>'id',context=document->'resolution'->'context',pending_context_command=NULL,pending_context_at=NULL WHERE (organisation_id,task_id)=(t.organisation_id,task);
  UPDATE public.task_methodology_changes SET applied_binding_id=document->>'id' WHERE (organisation_id,task_id)=(t.organisation_id,task) AND apply_requested AND applied_binding_id IS NULL AND available_at<=cutoff;
  UPDATE public.task_claims SET state='abandoned' WHERE task_id=task AND state='admitted';
  UPDATE public.operation_claims c SET state='abandoned' WHERE c.state='admitted' AND EXISTS(SELECT 1 FROM public.operations o WHERE o.id=c.operation_id AND o.task_id=task);
  UPDATE public.tasks SET execution_epoch=execution_epoch+1,revision=revision+1,state=CASE WHEN state IN ('paused','stopped') THEN state ELSE 'ready' END WHERE id=task;
  RETURN 'true'::jsonb;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.task_methodology_bindings b JOIN public.methodology_recalls r ON r.organisation_id=b.organisation_id AND ((b.document->'resolution'->'version_ids') ? r.version_id OR EXISTS(SELECT 1 FROM jsonb_array_elements(b.document->'resolution'->'templates') tpl(v) WHERE tpl.v->>'source_version_id'=r.version_id)) WHERE (b.organisation_id,b.task_id,b.id)=(t.organisation_id,task,head.binding_id)) INTO recalled;
 IF action='allowed' THEN RETURN to_jsonb(NOT recalled AND head.pending_context_command IS NULL AND NOT EXISTS(SELECT 1 FROM public.task_methodology_changes c WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.apply_requested AND c.applied_binding_id IS NULL AND c.available_at<=now_at)); END IF;
 IF action='next' THEN RETURN (SELECT coalesce(to_jsonb(min(c.available_at)),'null'::jsonb) FROM public.task_methodology_changes c WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.apply_requested AND c.applied_binding_id IS NULL); END IF;
 IF action<>'read' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 cutoff:=coalesce((document->>'at')::bigint,now_at);
 IF cutoff NOT BETWEEN 0 AND now_at THEN RAISE EXCEPTION 'invalid read cutoff' USING ERRCODE='Z0001'; END IF;
 SELECT e.* INTO latest FROM public.task_methodology_changes c JOIN public.methodology_events e ON (e.organisation_id,e.id)=(c.organisation_id,c.event_id) WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task) AND c.apply_requested AND c.applied_binding_id IS NULL ORDER BY (c.available_at<=cutoff) DESC,CASE WHEN c.available_at>cutoff THEN c.available_at END,e.revision DESC LIMIT 1;
 SELECT jsonb_build_object('context',head.context,'pending_context',CASE WHEN pending.id IS NULL THEN NULL ELSE jsonb_build_object('id',pending.id,'actor_id',pending.author_id,'requested_at',head.pending_context_at,'available_at',cutoff,'context',pending.methodology_context,'reason','Explicit Task context supplied by Guide: '||pending.content) END,'current',b.document,'history',coalesce((SELECT jsonb_agg(h.document ORDER BY (h.document->>'execution_epoch')::bigint,h.id) FROM public.task_methodology_bindings h WHERE (h.organisation_id,h.task_id)=(t.organisation_id,task) AND h.id<>head.binding_id),'[]'::jsonb),'recalled',recalled,'notices',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'version_id',e.receipt->>'version_id','actor_id',e.actor_id,'requested_at',e.recorded_at,'impact',(e.receipt->'impact')||jsonb_build_object('affected_tasks',1,'pending_tasks',CASE WHEN c.apply_requested AND c.applied_binding_id IS NULL THEN 1 ELSE 0 END,'retained_tasks',CASE WHEN NOT c.apply_requested THEN 1 ELSE 0 END)) ORDER BY e.revision) FROM public.task_methodology_changes c JOIN public.methodology_events e ON (e.organisation_id,e.id)=(c.organisation_id,c.event_id) WHERE (c.organisation_id,c.task_id)=(t.organisation_id,task)),'[]'::jsonb),'pending_event',CASE WHEN latest.id IS NULL THEN NULL ELSE jsonb_build_object('id',latest.id,'actor_id',latest.actor_id,'requested_at',latest.recorded_at,'available_at',coalesce((latest.command->'activation'->>'available_at')::bigint,latest.recorded_at),'reason',CASE WHEN latest.kind='recall' THEN 'Recall prevents further use; reconcile existing effects before switching' ELSE 'Admin requested a potentially material binding change at a safe boundary' END) END) INTO result FROM public.task_methodology_bindings b WHERE (b.organisation_id,b.task_id,b.id)=(t.organisation_id,task,head.binding_id);
 RETURN result;
END $$;
-- Published Tasks receive an explicit legacy neutral basis without rewriting work.
INSERT INTO public.task_methodology_bindings
 SELECT t.organisation_id,t.client_id,t.engagement_id,t.id,encode(sha256(convert_to(t.id,'UTF8')),'hex'),
 jsonb_build_object('id',encode(sha256(convert_to(t.id,'UTF8')),'hex'),'execution_epoch',0,'candidate_version_ids','[]'::jsonb,'context_command_id',NULL,'bound_at',floor(extract(epoch FROM clock_timestamp()))::bigint,'actor_id',t.accountable_actor,
 'resolution',jsonb_build_object('status','neutral','context',jsonb_build_object('audit_area',NULL,'period_start',NULL,'period_end',NULL),'version_ids','[]'::jsonb,'requirements','[]'::jsonb,'templates','[]'::jsonb,'neutral_source_version_ids',jsonb_build_array('builtin_neutral_v1'),'issues',jsonb_build_array('Task predates saved firm methodology'),'reason','Labelled neutral starter: no firm methodology was bound before this migration')) FROM public.tasks t;
INSERT INTO public.task_methodology_heads SELECT organisation_id,task_id,id,jsonb_build_object('audit_area',NULL,'period_start',NULL,'period_end',NULL),NULL,NULL FROM public.task_methodology_bindings;
REVOKE ALL ON FUNCTION public.methodology_audit(text,text,text),public.methodology_read(text,text,text),public.methodology_write(text,text,text,text,jsonb,text,text),public.methodology_candidates(text,text,text,bigint),public.methodology_task(text,text,jsonb) FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=8) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=8;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
