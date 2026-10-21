-- Disposition cap removed (owner decision 2026-10-21, Story 24.3
-- follow-up). Additive: published schemas 1-22 are unchanged. An exception
-- or a revision is never permanently undecidable: the guards no longer count
-- a record's dispositions (the 16-disposition refusal of 0020 and 0021 is
-- gone) and every other rule stays exactly as it was (authority in the
-- person's own session, current head only, verified references, the
-- exception's order and lock). The full immutable history is kept; readers
-- page it with a keyset cursor. Status and guards read only the latest
-- disposition, through these indexes, never the whole history.

-- A revision's dispositions in their order (time, then ID in C order): the
-- keyset page and the newest-disposition lookup both seek this index.
CREATE INDEX assessment_dispositions_order ON public.assessment_dispositions(organisation_id,client_id,engagement_id,revision_id,created_us,id COLLATE "C");

-- Story 24.3a's revision guard, without the per-revision count.
CREATE OR REPLACE FUNCTION public.revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE chain public.assessment_evaluations%ROWTYPE; criterion public.assessment_criteria%ROWTYPE;
 pred_basis text; pred_criterion text; pred_execution text; pred_inputs jsonb; origin_of text;
 input jsonb; walker text; hops integer; expected text[]; latest text; latest_id text; head integer; changes jsonb;
 head_applicability text; head_execution text; head_criterion text;
BEGIN
 IF TG_TABLE_NAME IN ('assessment_basis_carries','assessment_evaluation_revisions') THEN
  IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
    AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id
    AND i.request->'context'->'verification'->>'expected_methodology_binding_id' = NEW.methodology_binding_id
    AND (i.request->'basis'->>'execution_epoch')::bigint = NEW.execution_epoch) THEN
   RAISE EXCEPTION 'an assessment record belongs to its answer invocation and its binding' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='assessment_basis_carries' THEN
  IF NOT EXISTS(SELECT 1 FROM public.assessment_bases b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id)
    AND b.task_id=NEW.task_id AND b.supersedes IS NOT DISTINCT FROM NEW.from_basis_id) THEN
   RAISE EXCEPTION 'a carry belongs to a successor basis of its own Task and carries from the basis it supersedes' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='assessment_evaluation_revisions' THEN
  -- One writer per chain at a time; dispositions take the same lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('revision:'||NEW.organisation_id||'/'||NEW.client_id||'/'||NEW.engagement_id||'/'||NEW.chain_id, 0));
  SELECT e.* INTO chain FROM public.assessment_evaluations e WHERE (e.organisation_id,e.client_id,e.engagement_id,e.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.chain_id)
    AND e.task_id=NEW.task_id AND e.subject=NEW.subject;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'a revision continues an evaluation chain of its own Task and subject' USING ERRCODE='23514';
  END IF;
  IF NEW.revision = 2 THEN
   pred_basis := chain.basis_id; pred_criterion := chain.criterion_id; pred_execution := chain.execution; pred_inputs := chain.document->'inputs';
  ELSE
   SELECT r.basis_id, r.criterion_id, r.execution, r.document->'inputs' INTO pred_basis, pred_criterion, pred_execution, pred_inputs
     FROM public.assessment_evaluation_revisions r WHERE (r.organisation_id,r.client_id,r.engagement_id,r.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.predecessor_id)
     AND r.chain_id=NEW.chain_id AND r.revision=NEW.revision-1;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'a revision names the revision before it in its chain' USING ERRCODE='23514';
   END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.assessment_evaluation_revisions r WHERE (r.organisation_id,r.client_id,r.engagement_id,r.chain_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.chain_id) AND r.revision >= NEW.revision) THEN
   RAISE EXCEPTION 'a revision succeeds the current head of its chain' USING ERRCODE='23514';
  END IF;
  -- The head's basis version, or one that succeeds it (never an older one).
  walker := NEW.basis_id; hops := 0;
  WHILE walker IS DISTINCT FROM pred_basis AND walker IS NOT NULL AND hops < 64 LOOP
   SELECT b.supersedes INTO walker FROM public.assessment_bases b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,walker) AND b.task_id=NEW.task_id;
   IF NOT FOUND THEN walker := NULL; END IF;
   hops := hops + 1;
  END LOOP;
  IF walker IS DISTINCT FROM pred_basis THEN
   RAISE EXCEPTION 'a revision reads its head''s basis version or one that succeeds it' USING ERRCODE='23514';
  END IF;
  walker := NEW.criterion_id; hops := 0;
  WHILE walker IS DISTINCT FROM pred_criterion AND walker IS NOT NULL AND hops < 64 LOOP
   SELECT c.supersedes INTO walker FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,walker) AND c.task_id=NEW.task_id;
   IF NOT FOUND THEN walker := NULL; END IF;
   hops := hops + 1;
  END LOOP;
  IF walker IS DISTINCT FROM pred_criterion THEN
   RAISE EXCEPTION 'a revision reads its head''s criterion version or one that succeeds it' USING ERRCODE='23514';
  END IF;
  SELECT c.* INTO criterion FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.criterion_id) AND c.task_id=NEW.task_id;
  IF (NEW.origin='deterministic') IS DISTINCT FROM (criterion.kind='rule') THEN
   RAISE EXCEPTION 'an evaluation origin follows its criterion kind' USING ERRCODE='23514';
  END IF;
  IF NEW.verdict IN ('met','not_met') AND NOT criterion.authority_verified THEN
   RAISE EXCEPTION 'an unverified authority cannot yield met or not_met' USING ERRCODE='23514';
  END IF;
  FOR input IN SELECT value FROM jsonb_array_elements(NEW.document->'inputs') LOOP
   IF NOT EXISTS(SELECT 1 FROM public.assessment_facts f WHERE (f.organisation_id,f.client_id,f.engagement_id,f.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,input->>'id')
     AND (f.basis_id=NEW.basis_id OR (EXISTS(SELECT 1 FROM public.assessment_basis_carried_facts c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id,c.fact_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id,f.id))
       AND NOT EXISTS(SELECT 1 FROM public.assessment_facts o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.basis_id,o.subject,o.name)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id,f.subject,f.name))))
     AND f.subject=NEW.subject AND f.digest=input->>'digest'
     AND (NEW.verdict IS NULL OR NEW.verdict NOT IN ('met','not_met')
       OR (f.support='supported' AND f.subject_grounded AND f.measure_grounded IS NOT FALSE))) THEN
    RAISE EXCEPTION 'a revision input is an effective fact of its basis and subject, and a decided verdict reads only supported, grounded facts' USING ERRCODE='23514';
   END IF;
  END LOOP;
  IF NEW.verdict IN ('met','not_met') AND jsonb_array_length(NEW.document->'inputs') = 0 THEN
   RAISE EXCEPTION 'a decided verdict reads its facts' USING ERRCODE='23514';
  END IF;
  -- The causes are exactly the ones derived from the predecessor.
  expected := ARRAY[]::text[];
  IF (SELECT coalesce(array_agg(x->>'id' ORDER BY x->>'id' COLLATE "C"), ARRAY[]::text[]) FROM jsonb_array_elements(pred_inputs) x)
     IS DISTINCT FROM (SELECT coalesce(array_agg(x->>'id' ORDER BY x->>'id' COLLATE "C"), ARRAY[]::text[]) FROM jsonb_array_elements(NEW.document->'inputs') x) THEN
   expected := array_append(expected, 'inputs_changed');
  END IF;
  IF NEW.criterion_id IS DISTINCT FROM pred_criterion THEN expected := array_append(expected, 'criterion_revised'); END IF;
  IF NEW.basis_id IS DISTINCT FROM pred_basis THEN expected := array_append(expected, 'basis_revised'); END IF;
  IF pred_execution='failed' AND NEW.execution='completed' THEN expected := array_append(expected, 'prior_execution_failed'); END IF;
  SELECT d.kind, d.id INTO latest, latest_id FROM public.assessment_dispositions d WHERE (d.organisation_id,d.client_id,d.engagement_id,d.revision_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.predecessor_id)
    ORDER BY d.created_us DESC, d.id COLLATE "C" DESC LIMIT 1;
  -- A reconsideration causes a revision only when the request trusted code
  -- sent for the answering turn showed that exact disposition: a line of the
  -- request's own `assessment-reconsiderations` message (trusted structure;
  -- the person's words are escaped there, so no text can start a line). A
  -- replayed earlier answer never answers a request the model did not see.
  IF latest IS NOT DISTINCT FROM 'needs_reconsideration' AND EXISTS(SELECT 1 FROM public.model_invocations i
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(i.request->'messages')='array' THEN i.request->'messages' ELSE '[]'::jsonb END) m(value)
     WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
       AND m.value->>'role'='user' AND m.value->>'source_id'='assessment-reconsiderations'
       AND pg_catalog.strpos(m.value->>'text', E'\n- reconsideration '||latest_id||' of '||NEW.predecessor_id||' (') > 0) THEN
   expected := array_append(expected, 'reconsideration_requested');
  END IF;
  IF NEW.causes IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'a revision states exactly the causes trusted code derives from its predecessor' USING ERRCODE='23514';
  END IF;
  -- The changes are exactly the facts added, removed and replaced by name.
  WITH p AS (SELECT f.name, f.id FROM jsonb_array_elements(pred_inputs) x JOIN public.assessment_facts f ON (f.organisation_id,f.client_id,f.engagement_id,f.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,x->>'id')),
       n AS (SELECT f.name, f.id FROM jsonb_array_elements(NEW.document->'inputs') x JOIN public.assessment_facts f ON (f.organisation_id,f.client_id,f.engagement_id,f.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,x->>'id'))
  SELECT jsonb_build_object(
    'added', coalesce((SELECT jsonb_agg(n.id ORDER BY n.name COLLATE "C") FROM n WHERE NOT EXISTS(SELECT 1 FROM p WHERE p.name=n.name)), '[]'::jsonb),
    'removed', coalesce((SELECT jsonb_agg(p.id ORDER BY p.name COLLATE "C") FROM p WHERE NOT EXISTS(SELECT 1 FROM n WHERE n.name=p.name)), '[]'::jsonb),
    'replaced', coalesce((SELECT jsonb_agg(jsonb_build_object('from',p.id,'to',n.id) ORDER BY n.name COLLATE "C") FROM n JOIN p ON p.name=n.name WHERE p.id<>n.id), '[]'::jsonb))
  INTO changes;
  IF NEW.document->'changes' IS DISTINCT FROM changes THEN
   RAISE EXCEPTION 'a revision names exactly the facts added, removed and replaced since its predecessor' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='assessment_dispositions' THEN
  -- A person with a current auditor or audit manager role and a current
  -- assignment on this engagement (Admin alone is not one).
  -- A person in their own live session: the API sets the session hash for
  -- the write transaction only, so a worker connection (which holds no
  -- person's session) cannot save one. An unset scope or session is a
  -- refusal, never a pass.
  IF NOT coalesce(public.knowledge_audit(NEW.actor_id, NEW.organisation_id, NEW.client_id, NEW.engagement_id), false)
     OR NOT coalesce(public.evidence_session_locked(NEW.actor_id, nullif(pg_catalog.current_setting('zobba.session_hash',true),'')), false) THEN
   RAISE EXCEPTION 'a disposition is saved by a currently assigned auditor or audit manager in their own session' USING ERRCODE='23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('revision:'||NEW.organisation_id||'/'||NEW.client_id||'/'||NEW.engagement_id||'/'||NEW.chain_id, 0));
  SELECT e.* INTO chain FROM public.assessment_evaluations e WHERE (e.organisation_id,e.client_id,e.engagement_id,e.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.chain_id) AND e.task_id=NEW.task_id;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'a disposition names an evaluation chain of its own Task' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(max(r.revision), 1) INTO head FROM public.assessment_evaluation_revisions r WHERE (r.organisation_id,r.client_id,r.engagement_id,r.chain_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.chain_id);
  IF NEW.revision IS DISTINCT FROM head THEN
   RAISE EXCEPTION 'a disposition names the current head of its chain' USING ERRCODE='23514';
  END IF;
  IF NEW.revision = 1 THEN
   origin_of := chain.origin; head_applicability := chain.applicability; head_execution := chain.execution; head_criterion := chain.criterion_id;
  ELSE
   SELECT r.origin, r.applicability, r.execution, r.criterion_id INTO origin_of, head_applicability, head_execution, head_criterion
     FROM public.assessment_evaluation_revisions r WHERE (r.organisation_id,r.client_id,r.engagement_id,r.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.revision_id)
     AND r.chain_id=NEW.chain_id AND r.revision=NEW.revision;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'a disposition names the current head of its chain' USING ERRCODE='23514';
   END IF;
  END IF;
  IF NEW.kind='replaced' AND origin_of IS DISTINCT FROM 'model_proposal' THEN
   RAISE EXCEPTION 'a deterministic verdict cannot be replaced' USING ERRCODE='23514';
  END IF;
  -- The 24.1 outcome rules hold for a person's verdict too: met or not_met
  -- only on an applicable, completed judgment under a verified authority.
  IF NEW.kind='replaced' AND NEW.verdict IN ('met','not_met') AND (head_applicability IS DISTINCT FROM 'applicable' OR head_execution IS DISTINCT FROM 'completed'
     OR NOT coalesce((SELECT c.authority_verified FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,head_criterion)), false)) THEN
   RAISE EXCEPTION 'a person''s met or not_met replaces only an applicable, completed judgment under a verified authority' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'references') r WHERE coalesce(NOT (
       jsonb_typeof(r)='object' AND r->>'verification'='verified' AND r->>'original_sha256' ~ '^[0-9a-f]{64}$'
       AND jsonb_typeof(r->'locator')='string' AND jsonb_typeof(r->'quote')='string' AND octet_length(r->>'quote') BETWEEN 1 AND 1000
       AND EXISTS(SELECT 1 FROM public.evidence_originals o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,r->>'original_id') AND o.digest=r->>'original_sha256')), true)) THEN
   RAISE EXCEPTION 'a disposition reference is a verified quote of a registered original' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $body$;

-- Story 24.3b's exception disposition guard, without the per-exception
-- count. Its place in the exception's order comes from the unique
-- (exception, seq) index: the maxima are index seeks, not a history scan.
CREATE OR REPLACE FUNCTION public.exception_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE current_status text;
BEGIN
 IF NOT coalesce(public.knowledge_audit(NEW.actor_id, NEW.organisation_id, NEW.client_id, NEW.engagement_id), false)
    OR NOT coalesce(public.evidence_session_locked(NEW.actor_id, nullif(pg_catalog.current_setting('zobba.session_hash',true),'')), false) THEN
  RAISE EXCEPTION 'an exception disposition is saved by a currently assigned auditor or audit manager in their own session' USING ERRCODE='23514';
 END IF;
 IF NOT (EXISTS(SELECT 1 FROM public.tasks t WHERE (t.organisation_id,t.client_id,t.engagement_id,t.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id) AND t.accountable_actor=NEW.actor_id)
    OR EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE (m.organisation_id,m.actor_id)=(NEW.organisation_id,NEW.actor_id) AND m.active
       AND 'audit_manager'=ANY(m.roles) AND (m.expires_at IS NULL OR m.expires_at > floor(extract(epoch FROM clock_timestamp()))::bigint))) THEN
  RAISE EXCEPTION 'an exception disposition is saved by an audit manager or the Task''s accountable person' USING ERRCODE='23514';
 END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('exceptions:'||NEW.organisation_id||'/'||NEW.client_id||'/'||NEW.engagement_id||'/'||NEW.task_id, 2403));
 IF NOT EXISTS(SELECT 1 FROM public.assessment_exceptions x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.exception_id) AND x.task_id=NEW.task_id) THEN
  RAISE EXCEPTION 'an exception disposition names an exception of its own Task' USING ERRCODE='23514';
 END IF;
 SELECT s.status INTO current_status FROM public.assessment_exception_status(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.exception_id) s;
 IF NEW.kind='closed' AND current_status IS NOT DISTINCT FROM 'closed_by_disposition' THEN
  RAISE EXCEPTION 'an exception that is closed is not closed again' USING ERRCODE='23514';
 END IF;
 IF NEW.kind='reopened' AND current_status IS DISTINCT FROM 'closed_by_disposition' THEN
  RAISE EXCEPTION 'only a closed exception is reopened' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'references') r WHERE coalesce(NOT (
      jsonb_typeof(r)='object' AND r->>'verification'='verified' AND r->>'original_sha256' ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof(r->'locator')='string' AND jsonb_typeof(r->'quote')='string' AND octet_length(r->>'quote') BETWEEN 1 AND 1000
      AND EXISTS(SELECT 1 FROM public.evidence_originals o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,r->>'original_id') AND o.digest=r->>'original_sha256')), true)) THEN
  RAISE EXCEPTION 'an exception disposition reference is a verified quote of a registered original' USING ERRCODE='23514';
 END IF;
 NEW.seq := 1 + greatest(
   coalesce((SELECT max(y.seq) FROM public.assessment_exception_occurrences y WHERE (y.organisation_id,y.client_id,y.engagement_id,y.exception_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.exception_id)),0),
   coalesce((SELECT max(d.seq) FROM public.assessment_exception_dispositions d WHERE (d.organisation_id,d.client_id,d.engagement_id,d.exception_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.exception_id)),0));
 RETURN NEW;
END $body$;

ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=23) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=23;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
