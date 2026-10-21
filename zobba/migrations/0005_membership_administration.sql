-- Narrow owner-mediated administration. FORCE RLS remains enabled everywhere;
-- only current_user equal to the table owner can use these additional policies.
-- A valid schema-4 bigint outside the supported timestamp range needs an
-- explicit operator correction. Validated checks fail the entire upgrade
-- atomically; never truncate the value or silently widen existing authority.
ALTER TABLE public.organisation_memberships ADD CONSTRAINT organisation_memberships_expiry_range CHECK(expires_at IS NULL OR expires_at BETWEEN 1 AND 253402300799);
ALTER TABLE public.engagement_assignments ADD CONSTRAINT engagement_assignments_expiry_range CHECK(expires_at IS NULL OR expires_at BETWEEN 1 AND 253402300799);
ALTER TABLE public.sessions ADD COLUMN verified_issuer text;
ALTER TABLE public.sessions ADD COLUMN verified_email text;
ALTER TABLE public.sessions ADD COLUMN verified_at bigint;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_verified_recipient CHECK (
 (verified_issuer IS NULL AND verified_email IS NULL AND verified_at IS NULL) OR
 (verified_issuer IS NOT NULL AND verified_email IS NOT NULL AND verified_at IS NOT NULL
  AND octet_length(verified_issuer) BETWEEN 1 AND 2048 AND octet_length(verified_email) BETWEEN 3 AND 320 AND verified_at > 0));
-- Actor-first organisation enumeration and member-first assignment pages keep
-- unrelated tenants and colleagues out of administration lookup work.
CREATE INDEX organisation_memberships_admin_actor ON public.organisation_memberships(actor_id,organisation_id) INCLUDE(expires_at) WHERE active AND 'admin'=ANY(roles);
CREATE INDEX engagement_assignments_member_page ON public.engagement_assignments(organisation_id,actor_id,client_id,engagement_id) INCLUDE(expires_at) WHERE active;
CREATE TABLE public.membership_versions (
 organisation_id text PRIMARY KEY REFERENCES public.organisations(id),
 version bigint NOT NULL CHECK(version >= 0)
);
CREATE TABLE public.membership_invitations (
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 recipient_issuer text NOT NULL CHECK(octet_length(recipient_issuer) BETWEEN 1 AND 2048),
 recipient_email text NOT NULL CHECK(octet_length(recipient_email) BETWEEN 3 AND 320),
 secret_hash text NOT NULL UNIQUE CHECK(secret_hash ~ '^[0-9a-f]{64}$'),
 roles text[] NOT NULL CHECK(cardinality(roles) BETWEEN 1 AND 3 AND roles <@ ARRAY['auditor','audit_manager','admin']::text[]),
 assignments jsonb NOT NULL CHECK(jsonb_typeof(assignments)='array' AND jsonb_array_length(assignments)<=100),
 inviter_actor_id text NOT NULL REFERENCES public.identities(id),
 expires_at bigint NOT NULL,
 status text NOT NULL CHECK(status IN ('pending','revoked','accepted')),
 accepted_actor_id text REFERENCES public.identities(id),
 CHECK((status='accepted')=(accepted_actor_id IS NOT NULL))
);
CREATE INDEX membership_invitations_page ON public.membership_invitations(organisation_id,id);
CREATE TABLE public.membership_events (
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 actor_id text NOT NULL REFERENCES public.identities(id),
 command_key text NOT NULL CHECK(octet_length(command_key) BETWEEN 1 AND 128),
 meaning jsonb NOT NULL CHECK(octet_length(meaning::text)<=32768),
 receipt jsonb NOT NULL CHECK(octet_length(receipt::text)<=4096),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(organisation_id,actor_id,command_key)
);
CREATE INDEX membership_events_actor ON public.membership_events(actor_id,command_key);
ALTER TABLE public.membership_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.membership_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.membership_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_events FORCE ROW LEVEL SECURITY;
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['organisations','clients','engagements','organisation_memberships','engagement_assignments','membership_versions','membership_invitations','membership_events','tasks','task_claims','task_counters','task_events','task_wakeups','task_observations','operations','operation_claims','operation_receipts','permission_versions','permission_heads'] LOOP
  EXECUTE pg_catalog.format('CREATE POLICY membership_owner ON public.%I USING (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=''public'' AND c.relname=%L AND pg_catalog.pg_get_userbyid(c.relowner)=current_user)) WITH CHECK (EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=''public'' AND c.relname=%L AND pg_catalog.pg_get_userbyid(c.relowner)=current_user))',relation,relation,relation);
 END LOOP;
END
$policies$;

CREATE FUNCTION public.membership_admin(actor text, org text) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog,public AS $body$
 SELECT EXISTS(SELECT 1 FROM public.organisation_memberships m JOIN public.identities i ON i.id=m.actor_id
 WHERE m.organisation_id=org AND m.actor_id=actor AND i.active AND m.active AND 'admin'=ANY(m.roles)
 AND (m.expires_at IS NULL OR m.expires_at>extract(epoch FROM clock_timestamp())::bigint))
$body$;

CREATE FUNCTION public.membership_session(actor text, session_hash text) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path=pg_catalog,public AS $body$
 SELECT EXISTS(SELECT 1 FROM public.sessions s JOIN public.identities i ON i.id=s.actor_id
 WHERE s.token_hash=session_hash AND s.actor_id=actor AND i.active AND s.expires_at>extract(epoch FROM clock_timestamp())::bigint)
$body$;

CREATE FUNCTION public.membership_validate(org text, command jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
DECLARE role_count integer;
BEGIN
 IF jsonb_typeof(command->'roles') IS DISTINCT FROM 'array' OR jsonb_typeof(command->'assignments') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 SELECT count(DISTINCT v)::integer INTO role_count FROM jsonb_array_elements_text(command->'roles') AS r(v);
 IF role_count NOT BETWEEN 0 AND 3 OR (role_count=0 AND coalesce((command->>'active')::boolean,true)) OR role_count<>jsonb_array_length(command->'roles')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(command->'roles') AS r(v) WHERE v NOT IN ('auditor','audit_manager','admin'))
 OR jsonb_array_length(command->'assignments')>100
 OR (command->>'expires_at' IS NOT NULL AND (command->>'expires_at')::bigint NOT BETWEEN 1 AND 253402300799)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') AS a(v) WHERE NOT EXISTS(SELECT 1 FROM public.engagements e WHERE e.organisation_id=org AND e.client_id=v->>'client_id' AND e.id=v->>'engagement_id'))
 OR (SELECT count(DISTINCT (v->>'client_id',v->>'engagement_id')) FROM jsonb_array_elements(command->'assignments') a(v))<>jsonb_array_length(command->'assignments')
 THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
END
$body$;

CREATE FUNCTION public.membership_read(actor text, session_hash text, org text, members_after text, invitations_after text, engagements_after text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE result jsonb; members jsonb; invitations jsonb; engagements jsonb; orgs jsonb;
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR NOT public.membership_session(actor,session_hash) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF org IS NULL THEN
  SELECT coalesce(jsonb_agg(v ORDER BY id),'[]'::jsonb) INTO orgs FROM
  (SELECT o.id,jsonb_build_object('organisation_id',o.id,'organisation_name',o.name,'version',coalesce(v.version,0)::text) v FROM public.organisation_memberships m JOIN public.organisations o ON o.id=m.organisation_id LEFT JOIN public.membership_versions v ON v.organisation_id=m.organisation_id WHERE m.actor_id=actor AND m.active AND 'admin'=ANY(m.roles) AND (m.expires_at IS NULL OR m.expires_at>extract(epoch FROM clock_timestamp())::bigint) AND m.organisation_id>coalesce(members_after,'') ORDER BY m.organisation_id LIMIT 51) page;
  RETURN jsonb_build_object('organisations',orgs - 50,'next_cursor',CASE WHEN jsonb_array_length(orgs)>50 THEN orgs->49->>'organisation_id' END);
 END IF;
 -- Read responses share the same organisation fence as role changes. After
 -- waiting, recheck the current actor before projecting any membership metadata.
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 IF NOT public.membership_admin(actor,org) OR NOT public.membership_session(actor,session_hash) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT coalesce(jsonb_agg(v ORDER BY actor_id),'[]'::jsonb) INTO members FROM
 (SELECT m.actor_id,jsonb_build_object('actor_id',m.actor_id,'display_name',left(i.display_name,200),'roles',m.roles,'active',m.active,'expires_at',m.expires_at,'assignments_count',assignment_total.total,'assignments_complete',assignment_total.total<=100,'assignments',
  coalesce((SELECT jsonb_agg(jsonb_build_object('client_id',a.client_id,'engagement_id',a.engagement_id) ORDER BY a.client_id,a.engagement_id) FROM (SELECT a.client_id,a.engagement_id FROM public.engagement_assignments a WHERE a.organisation_id=org AND a.actor_id=m.actor_id AND a.active AND (a.expires_at IS NULL OR a.expires_at>extract(epoch FROM clock_timestamp())::bigint) ORDER BY a.client_id,a.engagement_id LIMIT 100) a),'[]'::jsonb)) v
 FROM public.organisation_memberships m JOIN public.identities i ON i.id=m.actor_id CROSS JOIN LATERAL (SELECT count(*) total FROM public.engagement_assignments a WHERE a.organisation_id=org AND a.actor_id=m.actor_id AND a.active AND (a.expires_at IS NULL OR a.expires_at>extract(epoch FROM clock_timestamp())::bigint)) assignment_total WHERE m.organisation_id=org AND m.actor_id>coalesce(members_after,'') ORDER BY m.actor_id LIMIT 51) page;
 SELECT coalesce(jsonb_agg(v ORDER BY id),'[]'::jsonb) INTO invitations FROM
 (SELECT id,jsonb_build_object('id',id,'recipient_email',recipient_email,'roles',roles,'assignments',assignments,'inviter_actor_id',inviter_actor_id,'expires_at',expires_at,'status',CASE WHEN status='pending' AND expires_at<=extract(epoch FROM clock_timestamp())::bigint THEN 'expired' ELSE status END) v FROM public.membership_invitations WHERE organisation_id=org AND id>coalesce(invitations_after,'') ORDER BY id LIMIT 51) page;
 SELECT coalesce(jsonb_agg(v ORDER BY cursor),'[]'::jsonb) INTO engagements FROM
 (SELECT e.client_id||'.'||e.id cursor,jsonb_build_object('client_id',e.client_id,'client_name',c.name,'engagement_id',e.id,'engagement_name',e.name) v FROM public.engagements e JOIN public.clients c ON c.organisation_id=e.organisation_id AND c.id=e.client_id WHERE e.organisation_id=org AND e.client_id||'.'||e.id>coalesce(engagements_after,'') ORDER BY e.client_id||'.'||e.id LIMIT 51) page;
 SELECT jsonb_build_object('organisation_id',o.id,'organisation_name',o.name,'version',coalesce(v.version,0)::text,
 'members',members-50,'members_next_cursor',CASE WHEN jsonb_array_length(members)>50 THEN members->49->>'actor_id' END,
 'invitations',invitations-50,'invitations_next_cursor',CASE WHEN jsonb_array_length(invitations)>50 THEN invitations->49->>'id' END,
 'engagements',engagements-50,'engagements_next_cursor',CASE WHEN jsonb_array_length(engagements)>50 THEN (engagements->49->>'client_id')||'.'||(engagements->49->>'engagement_id') END)
 INTO result FROM public.organisations o LEFT JOIN public.membership_versions v ON v.organisation_id=o.id WHERE o.id=org;
 RETURN result;
END
$body$;

-- Full inspection of legacy members is paged independently of the member list.
CREATE FUNCTION public.membership_assignments(actor text, session_hash text, org text, target text, after_cursor text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE assignments jsonb; total bigint; version text;
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 IF NOT public.membership_admin(actor,org) OR NOT public.membership_session(actor,session_hash) OR NOT EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=org AND m.actor_id=target) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT count(*) INTO total FROM public.engagement_assignments a WHERE a.organisation_id=org AND a.actor_id=target AND a.active AND (a.expires_at IS NULL OR a.expires_at>extract(epoch FROM clock_timestamp())::bigint);
 SELECT coalesce(v.version,0)::text INTO version FROM public.organisations o LEFT JOIN public.membership_versions v ON v.organisation_id=o.id WHERE o.id=org;
 SELECT coalesce(jsonb_agg(v ORDER BY client_id,engagement_id),'[]'::jsonb) INTO assignments FROM
 (SELECT a.client_id,a.engagement_id,jsonb_build_object('client_id',a.client_id,'client_name',c.name,'engagement_id',a.engagement_id,'engagement_name',e.name,'expires_at',a.expires_at) v
 FROM public.engagement_assignments a JOIN public.engagements e ON (e.organisation_id,e.client_id,e.id)=(a.organisation_id,a.client_id,a.engagement_id) JOIN public.clients c ON (c.organisation_id,c.id)=(a.organisation_id,a.client_id)
 WHERE a.organisation_id=org AND a.actor_id=target AND a.active AND (a.expires_at IS NULL OR a.expires_at>extract(epoch FROM clock_timestamp())::bigint) AND (a.client_id,a.engagement_id)>(coalesce(split_part(after_cursor,'.',1),''),coalesce(split_part(after_cursor,'.',2),'')) ORDER BY a.client_id,a.engagement_id LIMIT 51) page;
 RETURN jsonb_build_object('organisation_id',org,'actor_id',target,'version',version,'total',total,'assignments',assignments-50,'next_cursor',CASE WHEN jsonb_array_length(assignments)>50 THEN (assignments->49->>'client_id')||'.'||(assignments->49->>'engagement_id') END);
END
$body$;

-- Private helper: every caller already holds org-205, then all engagement rows
-- in sorted order. Consumed claims/factual receipts are deliberately retained.
-- Explicit renewal of a finite assignment fences even before expiry: the clock
-- can cross its deadline after classification and before the authority UPDATE.
CREATE FUNCTION public.membership_fence(org text, target text, old_roles text[], command jsonb, all_scopes boolean, editor text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
DECLARE affected record; delegation record; changed_task record; next_cursor bigint; doc jsonb;
BEGIN
 FOR affected IN SELECT e.client_id,e.id FROM public.engagements e WHERE e.organisation_id=org AND
 (all_scopes OR EXISTS(SELECT 1 FROM public.engagement_assignments a WHERE a.organisation_id=org AND a.client_id=e.client_id AND a.engagement_id=e.id AND a.actor_id=target AND
  CASE coalesce(command->>'assignment_mode','replace')
   WHEN 'preserve' THEN false
   WHEN 'remove' THEN a.active AND EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') x(v) WHERE v->>'client_id'=a.client_id AND v->>'engagement_id'=a.engagement_id)
   ELSE (NOT a.active AND EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') x(v) WHERE v->>'client_id'=a.client_id AND v->>'engagement_id'=a.engagement_id)) OR (a.expires_at IS NOT NULL AND (a.expires_at<=extract(epoch FROM clock_timestamp())::bigint OR EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') x(v) WHERE v->>'client_id'=a.client_id AND v->>'engagement_id'=a.engagement_id AND v->'renew'='true'::jsonb))) OR (a.active AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') x(v) WHERE v->>'client_id'=a.client_id AND v->>'engagement_id'=a.engagement_id))
  END)) ORDER BY e.client_id,e.id LOOP
  FOR changed_task IN UPDATE public.tasks t SET execution_epoch=execution_epoch+1,revision=revision+1,owner_id=NULL,owner_until=NULL,
   state=CASE WHEN state='stopped' THEN 'stopped' ELSE 'paused' END,
   cessation=CASE WHEN cessation='reconciliation_required' THEN cessation WHEN EXISTS(SELECT 1 FROM public.task_claims c WHERE c.task_id=t.id AND c.state='consumed' AND NOT EXISTS(SELECT 1 FROM public.task_observations r WHERE r.claim_id=c.id)) OR EXISTS(SELECT 1 FROM public.operation_claims c JOIN public.operations o ON o.id=c.operation_id WHERE o.task_id=t.id AND c.state='consumed' AND NOT EXISTS(SELECT 1 FROM public.operation_receipts r WHERE r.attempt_id=c.attempt_id AND r.outcome IN ('completed','absent'))) THEN 'pending' ELSE 'confirmed' END
   WHERE t.organisation_id=org AND t.client_id=affected.client_id AND t.engagement_id=affected.id AND t.accountable_actor=target RETURNING t.id,t.cycle_id LOOP
   INSERT INTO public.task_counters(organisation_id,client_id,engagement_id,cursor) VALUES(org,affected.client_id,affected.id,1) ON CONFLICT(organisation_id,client_id,engagement_id) DO UPDATE SET cursor=task_counters.cursor+1 RETURNING cursor INTO next_cursor;
   INSERT INTO public.task_events(organisation_id,client_id,engagement_id,cursor,task_id,cycle_id,kind) VALUES(org,affected.client_id,affected.id,next_cursor,changed_task.id,changed_task.cycle_id,'waiting');
   UPDATE public.task_wakeups SET pending=true,available_at=clock_timestamp() WHERE task_id=changed_task.id;
  END LOOP;
  UPDATE public.task_claims c SET state='abandoned' WHERE c.organisation_id=org AND c.client_id=affected.client_id AND c.engagement_id=affected.id AND c.state='admitted' AND (c.actor_id=target OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=c.task_id AND t.accountable_actor=target));
  UPDATE public.operation_claims c SET state='abandoned' WHERE c.organisation_id=org AND c.client_id=affected.client_id AND c.engagement_id=affected.id AND c.state='admitted' AND EXISTS(SELECT 1 FROM public.operations o JOIN public.tasks t ON t.id=o.task_id WHERE o.id=c.operation_id AND (o.actor_id=target OR t.accountable_actor=target));
  -- Follow stable Task ancestry and include descendants of the removed
  -- member's own delegated grants, regardless of a later Admin editor.
  FOR delegation IN WITH RECURSIVE heads AS (
   SELECT v.* FROM public.permission_heads h JOIN public.permission_versions v ON (v.organisation_id,v.policy_key,v.version)=(h.organisation_id,h.policy_key,h.current_version)
   WHERE v.organisation_id=org AND v.client_id=affected.client_id AND v.engagement_id=affected.id AND v.kind='delegation'
  ), affected_delegations(policy_key,subject_id) AS (
   SELECT v.policy_key,v.subject_id FROM heads v WHERE EXISTS(
    SELECT 1 FROM public.tasks t WHERE t.organisation_id=org AND t.client_id=affected.client_id AND t.engagement_id=affected.id AND t.accountable_actor=target AND v.document::jsonb->'parent'->>'kind'='task' AND v.document::jsonb->'parent'->>'subject_id'=t.id)
   UNION
   SELECT v.policy_key,v.subject_id FROM heads v JOIN affected_delegations a ON v.document::jsonb->'parent'->>'kind'='delegation' AND v.document::jsonb->'parent'->>'subject_id'=a.subject_id
  ) SELECT v.* FROM heads v JOIN affected_delegations a USING(policy_key,subject_id) WHERE NOT coalesce((v.document::jsonb->>'revoked')::boolean,false) LOOP
   doc=delegation.document::jsonb || jsonb_build_object('version',delegation.version+1,'revoked',true,'actor_id',editor,'created_at',extract(epoch FROM clock_timestamp())::bigint);
   INSERT INTO public.permission_versions(organisation_id,policy_key,client_id,engagement_id,kind,subject_id,version,document,actor_id) VALUES(org,delegation.policy_key,delegation.client_id,delegation.engagement_id,'delegation',delegation.subject_id,delegation.version+1,doc::text,editor);
   UPDATE public.permission_heads SET current_version=delegation.version+1 WHERE organisation_id=org AND policy_key=delegation.policy_key;
  END LOOP;
 END LOOP;
END
$body$;

CREATE FUNCTION public.membership_write(actor text, session_hash text, org text, kind text, command jsonb, event_id text, invitation_id text, issuer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE previous public.membership_events; receipt jsonb; next_version bigint; old public.organisation_memberships; new_roles text[]; target text; assignment jsonb; narrow boolean; assignment_mode text; previous_meaning jsonb;
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR kind NOT IN ('save_member','invite','revoke_invitation') OR octet_length(command::text)>32768 OR length(command->>'key') NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 -- Normalize only explicit defaults; historical event rows remain immutable.
 IF kind='save_member' THEN
  IF jsonb_typeof(command->'assignments') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') x(v) WHERE v ? 'renew' AND jsonb_typeof(v->'renew') IS DISTINCT FROM 'boolean') THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  command=jsonb_set(command,'{assignments}',(SELECT coalesce(jsonb_agg(CASE WHEN v->'renew'='false'::jsonb THEN v-'renew' ELSE v END ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(command->'assignments') WITH ORDINALITY x(v,n)));
  IF command->>'assignment_mode'='replace' THEN command=command-'assignment_mode'; END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(org,205));
 IF NOT public.membership_admin(actor,org) OR NOT public.membership_session(actor,session_hash) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 SELECT * INTO previous FROM public.membership_events e WHERE e.organisation_id=org AND e.actor_id=actor AND e.command_key=command->>'key';
 IF FOUND THEN
  previous_meaning=previous.meaning;
  IF kind='save_member' AND previous_meaning->>'kind'='save_member' THEN
   previous_meaning=jsonb_set(previous_meaning,'{command,assignments}',(SELECT coalesce(jsonb_agg(CASE WHEN v->'renew'='false'::jsonb THEN v-'renew' ELSE v END ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(previous_meaning->'command'->'assignments') WITH ORDINALITY x(v,n)));
   IF previous_meaning->'command'->>'assignment_mode'='replace' THEN previous_meaning=previous_meaning #- '{command,assignment_mode}'; END IF;
  END IF;
  IF previous_meaning<>jsonb_build_object('kind',kind,'command',command) THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  RETURN previous.receipt;
 END IF;
 INSERT INTO public.membership_versions VALUES(org,0) ON CONFLICT DO NOTHING;
 SELECT v.version INTO next_version FROM public.membership_versions v WHERE v.organisation_id=org FOR UPDATE;
 IF next_version::text IS DISTINCT FROM command->>'expected_version' THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
 -- Required lock order, shared with dispatch, controls and delegation mutation.
 PERFORM e.id FROM public.engagements e WHERE e.organisation_id=org ORDER BY e.client_id,e.id FOR UPDATE;
 IF NOT public.membership_admin(actor,org) OR NOT public.membership_session(actor,session_hash) THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
 IF kind IN ('save_member','invite') THEN
  PERFORM public.membership_validate(org,command);
  SELECT coalesce(array_agg(v ORDER BY v),ARRAY[]::text[]) INTO new_roles FROM jsonb_array_elements_text(command->'roles') r(v);
 END IF;
 IF kind='save_member' THEN
  target=command->>'actor_id';
  SELECT * INTO old FROM public.organisation_memberships WHERE organisation_id=org AND actor_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'denied' USING ERRCODE='Z0002'; END IF;
  assignment_mode=coalesce(command->>'assignment_mode','replace');
  IF assignment_mode NOT IN ('replace','preserve','remove') OR (assignment_mode='preserve' AND jsonb_array_length(command->'assignments')<>0) OR (assignment_mode='remove' AND (jsonb_array_length(command->'assignments')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') x(v) WHERE v->'renew'='true'::jsonb))) THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  IF assignment_mode='replace' AND (SELECT count(*) FROM public.engagement_assignments a WHERE a.organisation_id=org AND a.actor_id=target AND a.active AND (a.expires_at IS NULL OR a.expires_at>extract(epoch FROM clock_timestamp())::bigint))>100 THEN RAISE EXCEPTION 'capacity' USING ERRCODE='Z0006'; END IF;
  IF assignment_mode='replace' AND EXISTS(SELECT 1 FROM public.engagement_assignments a JOIN jsonb_array_elements(command->'assignments') x(v) ON v->>'client_id'=a.client_id AND v->>'engagement_id'=a.engagement_id WHERE a.organisation_id=org AND a.actor_id=target AND NOT a.active AND NOT coalesce((v->>'renew')::boolean,false)) THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  IF old.active AND 'admin'=ANY(old.roles) AND (old.expires_at IS NULL OR old.expires_at>extract(epoch FROM clock_timestamp())::bigint)
   AND (NOT (command->>'active')::boolean OR NOT ('admin'=ANY(new_roles)) OR command->>'expires_at' IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM public.organisation_memberships m JOIN public.identities i ON i.id=m.actor_id WHERE m.organisation_id=org AND m.actor_id<>target AND m.active AND i.active AND 'admin'=ANY(m.roles) AND (m.expires_at IS NULL OR m.expires_at>extract(epoch FROM clock_timestamp())::bigint))
  THEN RAISE EXCEPTION 'last admin' USING ERRCODE='Z0004'; END IF;
  -- Widening a finite membership also fences before its deadline can pass
  -- between this classification and the subsequent membership UPDATE.
  narrow=NOT old.active OR (old.expires_at IS NOT NULL AND old.expires_at<=extract(epoch FROM clock_timestamp())::bigint) OR NOT (command->>'active')::boolean OR NOT old.roles<@new_roles OR ((command->>'expires_at')::bigint IS NOT NULL AND (old.expires_at IS NULL OR (command->>'expires_at')::bigint<old.expires_at)) OR (old.expires_at IS NOT NULL AND (command->>'expires_at' IS NULL OR (command->>'expires_at')::bigint>old.expires_at));
  PERFORM public.membership_fence(org,target,old.roles,command,narrow,actor);
  UPDATE public.organisation_memberships SET roles=new_roles,active=(command->>'active')::boolean,expires_at=(command->>'expires_at')::bigint WHERE organisation_id=org AND actor_id=target;
  IF assignment_mode='remove' THEN
   UPDATE public.engagement_assignments a SET active=false WHERE a.organisation_id=org AND a.actor_id=target AND a.active AND EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') x(v) WHERE v->>'client_id'=a.client_id AND v->>'engagement_id'=a.engagement_id);
  ELSIF assignment_mode='replace' THEN
   -- Retained expiry survives even when it passes while a draft is open.
   -- Only explicit renewal of an expired/inactive selected scope clears it.
   UPDATE public.engagement_assignments a SET active=false WHERE a.organisation_id=org AND a.actor_id=target AND a.active AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(command->'assignments') x(v) WHERE v->>'client_id'=a.client_id AND v->>'engagement_id'=a.engagement_id);
   FOR assignment IN SELECT v FROM jsonb_array_elements(command->'assignments') a(v) LOOP
    INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES(org,assignment->>'client_id',assignment->>'engagement_id',target) ON CONFLICT(organisation_id,client_id,engagement_id,actor_id) DO UPDATE SET active=true,expires_at=CASE WHEN coalesce((assignment->>'renew')::boolean,false) AND (NOT engagement_assignments.active OR engagement_assignments.expires_at<=extract(epoch FROM clock_timestamp())::bigint) THEN NULL ELSE engagement_assignments.expires_at END;
   END LOOP;
  END IF;
 ELSIF kind='invite' THEN
  IF (command->>'expires_in_seconds')::bigint NOT BETWEEN 300 AND 604800 OR (command->>'secret_hash') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
  IF EXISTS(SELECT 1 FROM public.membership_invitations WHERE secret_hash=command->>'secret_hash') THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  INSERT INTO public.membership_invitations(id,organisation_id,recipient_issuer,recipient_email,secret_hash,roles,assignments,inviter_actor_id,expires_at,status) VALUES(invitation_id,org,issuer,command->>'recipient_email',command->>'secret_hash',new_roles,command->'assignments',actor,extract(epoch FROM clock_timestamp())::bigint+(command->>'expires_in_seconds')::bigint,'pending');
 ELSE
  invitation_id=command->>'invitation_id';
  UPDATE public.membership_invitations SET status='revoked' WHERE id=invitation_id AND organisation_id=org AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
 END IF;
 next_version=next_version+1;
 UPDATE public.membership_versions v SET version=next_version WHERE v.organisation_id=org;
 receipt=jsonb_build_object('event_id',event_id,'organisation_id',org,'actor_id',actor,'subject_actor_id',target,'invitation_id',CASE WHEN kind='save_member' THEN NULL ELSE invitation_id END,'version',next_version::text,'kind',kind);
 INSERT INTO public.membership_events(id,organisation_id,actor_id,command_key,meaning,receipt) VALUES(event_id,org,actor,command->>'key',jsonb_build_object('kind',kind,'command',command),receipt);
 RETURN receipt;
END
$body$;

CREATE FUNCTION public.membership_accept(actor text, session_hash text, invitation_hash text, command_key text, event_id text, expected_issuer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE invitation public.membership_invitations; proof public.sessions; previous public.membership_events; receipt jsonb; version bigint; assignment jsonb;
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR length(command_key) NOT BETWEEN 1 AND 128 OR invitation_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 SELECT * INTO invitation FROM public.membership_invitations WHERE secret_hash=invitation_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'invitation refused' USING ERRCODE='Z0005'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(invitation.organisation_id,205));
 SELECT * INTO invitation FROM public.membership_invitations WHERE secret_hash=invitation_hash FOR UPDATE;
 SELECT s.* INTO proof FROM public.sessions s JOIN public.identities i ON i.id=s.actor_id WHERE s.token_hash=session_hash AND s.actor_id=actor AND i.active AND s.expires_at>extract(epoch FROM clock_timestamp())::bigint AND s.verified_at BETWEEN extract(epoch FROM clock_timestamp())::bigint-300 AND extract(epoch FROM clock_timestamp())::bigint AND s.verified_issuer=invitation.recipient_issuer AND invitation.recipient_issuer=expected_issuer AND s.verified_email=invitation.recipient_email;
 IF NOT FOUND THEN RAISE EXCEPTION 'invitation refused' USING ERRCODE='Z0005'; END IF;
 SELECT * INTO previous FROM public.membership_events e WHERE e.organisation_id=invitation.organisation_id AND e.actor_id=actor AND e.command_key=membership_accept.command_key;
 IF FOUND THEN
  IF previous.meaning<>jsonb_build_object('kind','accept','secret_hash',invitation_hash) THEN RAISE EXCEPTION 'conflict' USING ERRCODE='Z0003'; END IF;
  RETURN previous.receipt;
 END IF;
 IF invitation.status<>'pending' OR invitation.expires_at<=extract(epoch FROM clock_timestamp())::bigint OR NOT public.membership_admin(invitation.inviter_actor_id,invitation.organisation_id) THEN RAISE EXCEPTION 'invitation refused' USING ERRCODE='Z0005'; END IF;
 IF EXISTS(SELECT 1 FROM public.organisation_memberships WHERE organisation_id=invitation.organisation_id AND actor_id=actor) THEN RAISE EXCEPTION 'invitation refused' USING ERRCODE='Z0005'; END IF;
 PERFORM e.id FROM public.engagements e WHERE e.organisation_id=invitation.organisation_id ORDER BY e.client_id,e.id FOR UPDATE;
 PERFORM id FROM public.identities WHERE id=actor AND active FOR SHARE;
 SELECT s.* INTO proof FROM public.sessions s JOIN public.identities i ON i.id=s.actor_id WHERE s.token_hash=session_hash AND s.actor_id=actor AND i.active AND s.expires_at>extract(epoch FROM clock_timestamp())::bigint AND s.verified_at BETWEEN extract(epoch FROM clock_timestamp())::bigint-300 AND extract(epoch FROM clock_timestamp())::bigint AND s.verified_issuer=invitation.recipient_issuer AND invitation.recipient_issuer=expected_issuer AND s.verified_email=invitation.recipient_email FOR SHARE OF s;
 IF NOT FOUND OR invitation.expires_at<=extract(epoch FROM clock_timestamp())::bigint OR NOT public.membership_admin(invitation.inviter_actor_id,invitation.organisation_id) THEN RAISE EXCEPTION 'invitation refused' USING ERRCODE='Z0005'; END IF;
 INSERT INTO public.organisation_memberships(organisation_id,actor_id,roles) VALUES(invitation.organisation_id,actor,invitation.roles);
 FOR assignment IN SELECT v FROM jsonb_array_elements(invitation.assignments) a(v) LOOP
  INSERT INTO public.engagement_assignments(organisation_id,client_id,engagement_id,actor_id) VALUES(invitation.organisation_id,assignment->>'client_id',assignment->>'engagement_id',actor);
 END LOOP;
 UPDATE public.membership_invitations SET status='accepted',accepted_actor_id=actor WHERE id=invitation.id;
 INSERT INTO public.membership_versions VALUES(invitation.organisation_id,1) ON CONFLICT(organisation_id) DO UPDATE SET version=membership_versions.version+1 RETURNING membership_versions.version INTO version;
 receipt=jsonb_build_object('event_id',event_id,'organisation_id',invitation.organisation_id,'actor_id',actor,'subject_actor_id',actor,'invitation_id',invitation.id,'version',version::text,'kind','accept');
 INSERT INTO public.membership_events(id,organisation_id,actor_id,command_key,meaning,receipt) VALUES(event_id,invitation.organisation_id,actor,command_key,jsonb_build_object('kind','accept','secret_hash',invitation_hash),receipt);
 RETURN receipt;
END
$body$;
CREATE FUNCTION public.membership_preview(actor text, session_hash text, invitation_hash text, expected_issuer text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE invitation public.membership_invitations; assignments jsonb; result jsonb;
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true) OR invitation_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid' USING ERRCODE='Z0001'; END IF;
 SELECT * INTO invitation FROM public.membership_invitations WHERE secret_hash=invitation_hash;
 IF NOT FOUND THEN RAISE EXCEPTION 'invitation refused' USING ERRCODE='Z0005'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(invitation.organisation_id,205));
 SELECT * INTO invitation FROM public.membership_invitations WHERE secret_hash=invitation_hash;
 IF invitation.status<>'pending' OR invitation.recipient_issuer<>expected_issuer OR invitation.expires_at<=extract(epoch FROM clock_timestamp())::bigint
 OR NOT public.membership_admin(invitation.inviter_actor_id,invitation.organisation_id)
 OR EXISTS(SELECT 1 FROM public.organisation_memberships WHERE organisation_id=invitation.organisation_id AND actor_id=actor)
 OR NOT EXISTS(SELECT 1 FROM public.sessions s JOIN public.identities i ON i.id=s.actor_id WHERE s.token_hash=session_hash AND s.actor_id=actor AND i.active AND s.expires_at>extract(epoch FROM clock_timestamp())::bigint AND s.verified_issuer=expected_issuer AND s.verified_email=invitation.recipient_email AND s.verified_at BETWEEN extract(epoch FROM clock_timestamp())::bigint-300 AND extract(epoch FROM clock_timestamp())::bigint)
 THEN RAISE EXCEPTION 'invitation refused' USING ERRCODE='Z0005'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('client_id',e.client_id,'client_name',c.name,'engagement_id',e.id,'engagement_name',e.name) ORDER BY e.client_id,e.id),'[]'::jsonb) INTO assignments FROM jsonb_array_elements(invitation.assignments) a(v) JOIN public.engagements e ON e.organisation_id=invitation.organisation_id AND e.client_id=v->>'client_id' AND e.id=v->>'engagement_id' JOIN public.clients c ON c.organisation_id=e.organisation_id AND c.id=e.client_id;
 SELECT jsonb_build_object('organisation_id',id,'organisation_name',name,'recipient_email',invitation.recipient_email,'roles',invitation.roles,'assignments',assignments,'expires_at',invitation.expires_at) INTO result FROM public.organisations WHERE id=invitation.organisation_id;
 RETURN result;
END
$body$;
REVOKE ALL ON public.membership_versions,public.membership_invitations,public.membership_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.membership_assignments(text,text,text,text,text),public.membership_preview(text,text,text,text),public.membership_admin(text,text),public.membership_session(text,text),public.membership_validate(text,jsonb),public.membership_read(text,text,text,text,text,text),public.membership_fence(text,text,text[],jsonb,boolean,text),public.membership_write(text,text,text,text,jsonb,text,text,text),public.membership_accept(text,text,text,text,text,text) FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=5) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=5;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
