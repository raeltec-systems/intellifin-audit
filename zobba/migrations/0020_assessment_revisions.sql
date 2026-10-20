-- Story 24.3a: revise evaluations without overwriting facts. Additive:
-- published schemas 1-19 are unchanged. Three layers never overwrite each
-- other: facts (24.1), evaluation revisions (what trusted code or the model
-- concluded from one pinned set of facts) and dispositions (what a person
-- decided about one exact revision). Revision 1 of a chain is the 24.1
-- evaluation; every later revision is a new immutable row naming its
-- predecessor, the closed causes trusted code derived and the fact IDs that
-- were added, removed or replaced. A successor basis may carry its
-- predecessor's effective facts by reference (original verification kept,
-- never copied). Story 24.3b (exceptions and the effective summary) adds its
-- own tables in migration 0021; nothing here depends on them.
-- `*_us` columns are database time in microseconds, the order every reader uses.

-- One carry of a successor basis: which basis it carries from and which
-- (subject, name) pairs it leaves out. At most one per basis.
CREATE TABLE public.assessment_basis_carries (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal = 0),
 id text NOT NULL CHECK(id ~ '^carry-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 basis_id text NOT NULL,
 from_basis_id text NOT NULL,
 carried integer NOT NULL CHECK(carried BETWEEN 0 AND 1024),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK(basis_id <> from_basis_id),
 CHECK(coalesce(document->>'record'='carry' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND jsonb_typeof(document->'ordinal')='number' AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND jsonb_typeof(document->'execution_epoch')='number' AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'basis_id'=basis_id AND document->>'from_basis_id'=from_basis_id
   AND jsonb_typeof(document->'carried')='number' AND (document->>'carried')::integer=carried
   AND jsonb_typeof(document->'except')='array' AND jsonb_array_length(document->'except') <= 64, false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 UNIQUE(organisation_id,client_id,engagement_id,basis_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,basis_id) REFERENCES public.assessment_bases(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,from_basis_id) REFERENCES public.assessment_bases(organisation_id,client_id,engagement_id,id)
);

-- A fact carried into a successor basis by reference: the fact row itself,
-- with its original verification, is never copied.
CREATE TABLE public.assessment_basis_carried_facts (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 basis_id text NOT NULL,
 fact_id text NOT NULL,
 from_basis_id text NOT NULL,
 PRIMARY KEY(organisation_id,client_id,engagement_id,basis_id,fact_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,basis_id) REFERENCES public.assessment_basis_carries(organisation_id,client_id,engagement_id,basis_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,fact_id) REFERENCES public.assessment_facts(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,from_basis_id) REFERENCES public.assessment_bases(organisation_id,client_id,engagement_id,id)
);

-- Revision n >= 2 of an evaluation chain. Revision 1 is the 24.1 evaluation
-- (`chain_id`). The outcome columns are the 24.1 ones; the causes are closed
-- and derived by trusted code; the changes are the fact IDs added, removed
-- and replaced by name. One successor per head: the chain and its number are
-- unique and each revision names exactly the revision before it.
CREATE TABLE public.assessment_evaluation_revisions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 1031),
 id text NOT NULL CHECK(id ~ '^rev-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 chain_id text NOT NULL CHECK(chain_id ~ '^eval-[0-9a-f]{40}$'),
 revision integer NOT NULL CHECK(revision BETWEEN 2 AND 1000000),
 predecessor_id text NOT NULL CHECK(predecessor_id ~ '^(eval|rev)-[0-9a-f]{40}$'),
 basis_id text NOT NULL,
 criterion_id text NOT NULL,
 subject text NOT NULL CHECK(octet_length(subject) BETWEEN 1 AND 128 AND btrim(subject) <> '' AND subject !~ '[\x01-\x1f\x7f-\x9f]'),
 applicability text NOT NULL CHECK(applicability IN ('applicable','not_applicable','unknown')),
 execution text NOT NULL CHECK(execution IN ('completed','failed')),
 verdict text CHECK(verdict IN ('met','not_met','undetermined')),
 reason text CHECK(reason IN ('missing_fact','fact_unavailable','fact_ambiguous','fact_unsupported','unit_mismatch','unknown_applicability','authority_unverified','analysis_failed','subject_unverified','unit_unverified')),
 origin text NOT NULL CHECK(origin IN ('deterministic','model_proposal')),
 causes text[] NOT NULL CHECK(cardinality(causes) BETWEEN 1 AND 5 AND array_position(causes, NULL) IS NULL
   AND causes <@ ARRAY['inputs_changed','criterion_revised','basis_revised','prior_execution_failed','reconsideration_requested']::text[]),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 output_digest text NOT NULL CHECK(output_digest ~ '^[0-9a-f]{64}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 -- The 24.1 outcome rules, unchanged.
 CHECK(verdict NOT IN ('met','not_met') OR (applicability='applicable' AND execution='completed' AND reason IS NULL)),
 CHECK(execution='completed' OR (verdict IS NULL AND reason='analysis_failed')),
 CHECK(applicability <> 'not_applicable' OR verdict IS NULL),
 CHECK(verdict IS DISTINCT FROM 'undetermined' OR reason IS NOT NULL OR origin='model_proposal'),
 CHECK((revision = 2) = (predecessor_id = chain_id)),
 CHECK(coalesce(document->>'record'='revision' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND jsonb_typeof(document->'ordinal')='number' AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND jsonb_typeof(document->'execution_epoch')='number' AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'chain_id'=chain_id AND jsonb_typeof(document->'revision')='number' AND (document->>'revision')::integer=revision
   AND document->>'predecessor_id'=predecessor_id
   AND document->>'basis_id'=basis_id AND document->>'criterion_id'=criterion_id AND document->>'subject'=subject
   AND document->>'applicability'=applicability AND document->>'execution'=execution
   AND document ? 'verdict' AND document->>'verdict' IS NOT DISTINCT FROM verdict
   AND document ? 'reason' AND document->>'reason' IS NOT DISTINCT FROM reason
   AND document->>'origin'=origin AND document->>'output_digest'=output_digest
   AND document->'causes' = to_jsonb(causes)
   AND jsonb_typeof(document->'inputs')='array' AND jsonb_array_length(document->'inputs') <= 32
   AND jsonb_typeof(document->'changes')='object' AND document->'changes' ?& ARRAY['added','removed','replaced']
   AND jsonb_typeof(document->'changes'->'added')='array' AND jsonb_array_length(document->'changes'->'added') <= 32
   AND jsonb_typeof(document->'changes'->'removed')='array' AND jsonb_array_length(document->'changes'->'removed') <= 32
   AND jsonb_typeof(document->'changes'->'replaced')='array' AND jsonb_array_length(document->'changes'->'replaced') <= 32
   AND document->>'revision_digest' ~ '^[0-9a-f]{64}$'
   AND (origin='model_proposal') = (jsonb_typeof(document->'judgment')='object'), false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 UNIQUE(organisation_id,client_id,engagement_id,chain_id,revision),
 UNIQUE(organisation_id,client_id,engagement_id,predecessor_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,chain_id) REFERENCES public.assessment_evaluations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,basis_id,criterion_id) REFERENCES public.assessment_basis_criteria(organisation_id,client_id,engagement_id,basis_id,criterion_id)
);
CREATE INDEX assessment_evaluation_revisions_task ON public.assessment_evaluation_revisions(organisation_id,client_id,engagement_id,task_id,created_us);

-- A person's disposition of one exact revision (the 24.1 evaluation or a
-- revision row). It never changes the revision: `replaced` is a separate
-- human verdict. The key is idempotent per actor.
CREATE TABLE public.assessment_dispositions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 id text NOT NULL CHECK(id ~ '^disp-[0-9a-f]{40}$'),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 chain_id text NOT NULL CHECK(chain_id ~ '^eval-[0-9a-f]{40}$'),
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000000),
 revision_id text NOT NULL CHECK(revision_id ~ '^(eval|rev)-[0-9a-f]{40}$'),
 kind text NOT NULL CHECK(kind IN ('accepted','replaced','needs_reconsideration')),
 concern text CHECK(concern IN ('facts','rule','authority','scope')),
 verdict text CHECK(verdict IN ('met','not_met','undetermined')),
 rationale text NOT NULL CHECK(octet_length(rationale) BETWEEN 1 AND 2000 AND btrim(rationale, E' \n\r\t') <> '' AND rationale !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((kind='needs_reconsideration') = (concern IS NOT NULL)),
 CHECK((kind='replaced') = (verdict IS NOT NULL)),
 CHECK((revision = 1) = (revision_id = chain_id)),
 CHECK(coalesce(document->>'record'='disposition' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'actor_id'=actor_id
   AND document->>'key'=key AND document->>'chain_id'=chain_id AND jsonb_typeof(document->'revision')='number' AND (document->>'revision')::integer=revision
   AND document->>'revision_id'=revision_id AND document->>'kind'=kind
   AND document ? 'concern' AND document->>'concern' IS NOT DISTINCT FROM concern
   AND document ? 'verdict' AND document->>'verdict' IS NOT DISTINCT FROM verdict
   AND document->>'rationale'=rationale
   AND jsonb_typeof(document->'references')='array' AND jsonb_array_length(document->'references') <= 8, false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,actor_id,key),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,chain_id) REFERENCES public.assessment_evaluations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_dispositions_revision ON public.assessment_dispositions(organisation_id,client_id,engagement_id,revision_id,created_us);

-- Story 24.3a: the 24.1 guard, unchanged except that a basis's 1,024-fact
-- bound counts its carried facts too, and an evaluation input may be a fact
-- carried into its basis by reference (and not recorded by the basis itself).
CREATE OR REPLACE FUNCTION public.assessment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE criterion public.assessment_criteria%ROWTYPE; input jsonb; outcome text;
BEGIN
 IF TG_TABLE_NAME IN ('assessment_criteria','assessment_bases','assessment_facts','assessment_evaluations') THEN
  IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
    AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id
    AND i.request->'context'->'verification'->>'expected_methodology_binding_id' = NEW.methodology_binding_id
    AND (i.request->'basis'->>'execution_epoch')::bigint = NEW.execution_epoch) THEN
   RAISE EXCEPTION 'an assessment record belongs to its answer invocation and its binding' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='assessment_criteria' THEN
  IF NEW.supersedes IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.supersedes) AND c.task_id=NEW.task_id) THEN
   RAISE EXCEPTION 'a criterion version succeeds one of its own Task' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='assessment_bases' THEN
  IF NEW.supersedes IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.assessment_bases b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.supersedes) AND b.task_id=NEW.task_id) THEN
   RAISE EXCEPTION 'a basis version succeeds one of its own Task' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='assessment_basis_criteria' THEN
  IF NOT EXISTS(SELECT 1 FROM public.assessment_bases b JOIN public.assessment_criteria c ON (c.organisation_id,c.client_id,c.engagement_id)=(b.organisation_id,b.client_id,b.engagement_id) AND c.task_id=b.task_id
    WHERE (b.organisation_id,b.client_id,b.engagement_id,b.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id) AND c.id=NEW.criterion_id
      AND b.task_id=NEW.task_id AND b.actor_id=NEW.actor_id AND b.document->'criteria'->>NEW.ordinal = NEW.criterion_id) THEN
   RAISE EXCEPTION 'a basis pins criteria of its own Task, in its order' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='assessment_facts' THEN
  IF NOT EXISTS(SELECT 1 FROM public.assessment_bases b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id) AND b.task_id=NEW.task_id) THEN
   RAISE EXCEPTION 'a fact belongs to a basis of its own Task' USING ERRCODE='23514';
  END IF;
  -- A basis version holds at most 1024 facts, so every exact read of its
  -- facts stays bounded. Writers of one basis are serialised here.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(NEW.organisation_id||'/'||NEW.client_id||'/'||NEW.engagement_id||'/'||NEW.basis_id, 2402));
  IF (SELECT count(*) FROM public.assessment_facts f WHERE (f.organisation_id,f.client_id,f.engagement_id,f.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id))
     + (SELECT count(*) FROM public.assessment_basis_carried_facts c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id)) >= 1024 THEN
   RAISE EXCEPTION 'a basis holds at most 1024 facts' USING ERRCODE='23514';
  END IF;
  -- A fact that names an analysis job names one of its own Task that has
  -- ended. Its outcome is the latest event that is not a collection (a
  -- `collected` event repeats the outcome before it): analysis_failed exactly
  -- when the job ended without completing. Nothing is recorded about a job
  -- that has not ended.
  IF NEW.job_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.analysis_jobs j WHERE j.id=NEW.job_id AND j.task_id=NEW.task_id) THEN
    RAISE EXCEPTION 'a fact names an analysis job of its Task' USING ERRCODE='23514';
   END IF;
   SELECT e.status INTO outcome FROM public.analysis_job_events e WHERE e.job_id=NEW.job_id AND e.status<>'collected' ORDER BY e.sequence DESC LIMIT 1;
   IF outcome IS NULL OR outcome NOT IN ('completed','failed','limit_exceeded','stopped') THEN
    RAISE EXCEPTION 'a fact waits for its analysis job to end' USING ERRCODE='23514';
   END IF;
   IF (NEW.support_reason IS NOT DISTINCT FROM 'analysis_failed') <> (outcome <> 'completed') THEN
    RAISE EXCEPTION 'a fact names its analysis job''s true outcome' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='assessment_fact_sources' THEN
  IF NOT EXISTS(SELECT 1 FROM public.assessment_facts f WHERE (f.organisation_id,f.client_id,f.engagement_id,f.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.fact_id)
    AND f.task_id=NEW.task_id AND f.actor_id=NEW.actor_id
    AND f.document->'sources'->NEW.ordinal->>'original_id' = NEW.original_id
    AND f.document->'sources'->NEW.ordinal->>'quote' = NEW.quote
    AND f.document->'sources'->NEW.ordinal->>'locator' IS NOT DISTINCT FROM NEW.locator
    AND f.document->'sources'->NEW.ordinal->>'verification' = NEW.verification
    AND f.document->'sources'->NEW.ordinal->>'reason' IS NOT DISTINCT FROM NEW.reason
    AND f.document->'sources'->NEW.ordinal->>'original_sha256' IS NOT DISTINCT FROM NEW.original_sha256) THEN
   RAISE EXCEPTION 'a fact source is the one its fact records' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='assessment_evaluations' THEN
  SELECT c.* INTO criterion FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.criterion_id) AND c.task_id=NEW.task_id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.assessment_bases b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id) AND b.task_id=NEW.task_id) THEN
   RAISE EXCEPTION 'an evaluation reads a basis and criterion of its own Task' USING ERRCODE='23514';
  END IF;
  -- A rule is decided only by trusted code; a judgment is only proposed.
  IF (NEW.origin='deterministic') <> (criterion.kind='rule') THEN
   RAISE EXCEPTION 'an evaluation origin follows its criterion kind' USING ERRCODE='23514';
  END IF;
  IF NEW.verdict IN ('met','not_met') AND NOT criterion.authority_verified THEN
   RAISE EXCEPTION 'an unverified authority cannot yield met or not_met' USING ERRCODE='23514';
  END IF;
  FOR input IN SELECT value FROM jsonb_array_elements(NEW.document->'inputs') LOOP
   -- Story 24.3a: an input is an effective fact of the basis: its own, or
   -- one carried into it by reference that it does not record itself.
   IF NOT EXISTS(SELECT 1 FROM public.assessment_facts f WHERE (f.organisation_id,f.client_id,f.engagement_id,f.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,input->>'id')
     AND (f.basis_id=NEW.basis_id OR (EXISTS(SELECT 1 FROM public.assessment_basis_carried_facts c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id,c.fact_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id,f.id))
       AND NOT EXISTS(SELECT 1 FROM public.assessment_facts o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.basis_id,o.subject,o.name)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id,f.subject,f.name))))
     AND f.subject=NEW.subject AND f.digest=input->>'digest'
     AND (NEW.verdict NOT IN ('met','not_met') OR NEW.verdict IS NULL
       OR (f.support='supported' AND f.subject_grounded AND f.measure_grounded IS NOT FALSE))) THEN
    RAISE EXCEPTION 'an evaluation input is a fact of its basis and subject, and a decided verdict reads only supported, grounded facts' USING ERRCODE='23514';
   END IF;
  END LOOP;
  IF NEW.verdict IN ('met','not_met') AND jsonb_array_length(NEW.document->'inputs') = 0 THEN
   RAISE EXCEPTION 'a decided verdict reads its facts' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $body$;
-- Records must agree with what trusted code actually recorded elsewhere. A
-- carry and a revision belong to their own answer invocation of this Task,
-- cycle and actor under that turn's exact binding and epoch. A revision
-- continues the current head of its chain (no fork), reads that head's basis
-- and criterion version or one that succeeds it, reads only effective facts
-- of its basis and subject, and states exactly the causes and changes trusted
-- code derives. A disposition is saved by a currently assigned auditor or
-- audit manager, on the current head only, never replacing a rule verdict.
CREATE FUNCTION public.revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE chain public.assessment_evaluations%ROWTYPE; criterion public.assessment_criteria%ROWTYPE;
 pred_basis text; pred_criterion text; pred_execution text; pred_inputs jsonb; origin_of text;
 input jsonb; walker text; hops integer; expected text[]; latest text; head integer; changes jsonb;
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
  SELECT d.kind INTO latest FROM public.assessment_dispositions d WHERE (d.organisation_id,d.client_id,d.engagement_id,d.revision_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.predecessor_id)
    ORDER BY d.created_us DESC, d.id COLLATE "C" DESC LIMIT 1;
  -- A reconsideration causes a revision only when the request trusted code
  -- sent for the answering turn showed it: a replayed earlier answer never
  -- answers a request the model did not see.
  IF latest IS NOT DISTINCT FROM 'needs_reconsideration' AND EXISTS(SELECT 1 FROM public.model_invocations i
     WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
       AND pg_catalog.strpos(i.request::text, 'reconsideration requested of '||NEW.predecessor_id||' ') > 0) THEN
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
  IF NOT public.knowledge_audit(NEW.actor_id, NEW.organisation_id, NEW.client_id, NEW.engagement_id) THEN
   RAISE EXCEPTION 'a disposition is saved by a currently assigned auditor or audit manager' USING ERRCODE='23514';
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
   origin_of := chain.origin;
  ELSE
   SELECT r.origin INTO origin_of FROM public.assessment_evaluation_revisions r WHERE (r.organisation_id,r.client_id,r.engagement_id,r.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.revision_id)
     AND r.chain_id=NEW.chain_id AND r.revision=NEW.revision;
   IF NOT FOUND THEN
    RAISE EXCEPTION 'a disposition names the current head of its chain' USING ERRCODE='23514';
   END IF;
  END IF;
  IF NEW.kind='replaced' AND origin_of IS DISTINCT FROM 'model_proposal' THEN
   RAISE EXCEPTION 'a deterministic verdict cannot be replaced' USING ERRCODE='23514';
  END IF;
  IF (SELECT count(*) FROM public.assessment_dispositions d WHERE (d.organisation_id,d.client_id,d.engagement_id,d.revision_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.revision_id)) >= 16 THEN
   RAISE EXCEPTION 'a revision holds at most 16 dispositions' USING ERRCODE='23514';
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
CREATE TRIGGER revision_guard BEFORE INSERT ON public.assessment_basis_carries FOR EACH ROW EXECUTE FUNCTION public.revision_guard();
CREATE TRIGGER revision_guard BEFORE INSERT ON public.assessment_evaluation_revisions FOR EACH ROW EXECUTE FUNCTION public.revision_guard();
CREATE TRIGGER revision_guard BEFORE INSERT ON public.assessment_dispositions FOR EACH ROW EXECUTE FUNCTION public.revision_guard();

-- Carried facts are checked once per statement over its new rows: each is an
-- effective fact of the basis its carry comes from, not excepted, not one the
-- successor records itself, one per subject and name, within the stated
-- count and the 1,024-fact bound (own and carried facts together).
CREATE FUNCTION public.revision_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE x record;
BEGIN
 FOR x IN SELECT a.organisation_id, a.client_id, a.engagement_id, a.basis_id FROM added a GROUP BY a.organisation_id, a.client_id, a.engagement_id, a.basis_id ORDER BY a.basis_id COLLATE "C" LOOP
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(x.organisation_id||'/'||x.client_id||'/'||x.engagement_id||'/'||x.basis_id, 2402));
 END LOOP;
 IF EXISTS(SELECT 1 FROM added a WHERE NOT EXISTS(SELECT 1 FROM public.assessment_basis_carries k WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(a.organisation_id,a.client_id,a.engagement_id,a.basis_id)
     AND k.from_basis_id=a.from_basis_id AND k.task_id=a.task_id AND k.actor_id=a.actor_id)) THEN
  RAISE EXCEPTION 'a carried fact belongs to its basis''s carry, from the basis that carry names' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM added a JOIN public.assessment_facts f ON (f.organisation_id,f.client_id,f.engagement_id,f.id)=(a.organisation_id,a.client_id,a.engagement_id,a.fact_id)
   WHERE NOT (f.task_id=a.task_id AND (f.basis_id=a.from_basis_id OR (EXISTS(SELECT 1 FROM public.assessment_basis_carried_facts c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id,c.fact_id)=(a.organisation_id,a.client_id,a.engagement_id,a.from_basis_id,f.id))
     AND NOT EXISTS(SELECT 1 FROM public.assessment_facts o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.basis_id,o.subject,o.name)=(a.organisation_id,a.client_id,a.engagement_id,a.from_basis_id,f.subject,f.name)))))) THEN
  RAISE EXCEPTION 'a carried fact is an effective fact of the basis it is carried from' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM added a JOIN public.assessment_facts f ON (f.organisation_id,f.client_id,f.engagement_id,f.id)=(a.organisation_id,a.client_id,a.engagement_id,a.fact_id)
   JOIN public.assessment_basis_carries k ON (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(a.organisation_id,a.client_id,a.engagement_id,a.basis_id)
   WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(k.document->'except') e WHERE e->>'subject'=f.subject AND e->>'name'=f.name)) THEN
  RAISE EXCEPTION 'an excepted fact is not carried' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM added a JOIN public.assessment_facts f ON (f.organisation_id,f.client_id,f.engagement_id,f.id)=(a.organisation_id,a.client_id,a.engagement_id,a.fact_id)
   WHERE EXISTS(SELECT 1 FROM public.assessment_facts o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.basis_id,o.subject,o.name)=(a.organisation_id,a.client_id,a.engagement_id,a.basis_id,f.subject,f.name))) THEN
  RAISE EXCEPTION 'a basis that records a fact itself does not carry it' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.assessment_basis_carried_facts c JOIN public.assessment_facts f ON (f.organisation_id,f.client_id,f.engagement_id,f.id)=(c.organisation_id,c.client_id,c.engagement_id,c.fact_id)
   WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id) IN (SELECT a.organisation_id,a.client_id,a.engagement_id,a.basis_id FROM added a)
   GROUP BY c.organisation_id, c.client_id, c.engagement_id, c.basis_id, f.subject, f.name HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'a basis carries one fact per subject and name' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.assessment_basis_carries k WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id) IN (SELECT a.organisation_id,a.client_id,a.engagement_id,a.basis_id FROM added a)
   AND (SELECT count(*) FROM public.assessment_basis_carried_facts c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id)=(k.organisation_id,k.client_id,k.engagement_id,k.basis_id)) > k.carried) THEN
  RAISE EXCEPTION 'a carry holds exactly its stated facts' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.assessment_basis_carries k WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id) IN (SELECT a.organisation_id,a.client_id,a.engagement_id,a.basis_id FROM added a)
   AND (SELECT count(*) FROM public.assessment_basis_carried_facts c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id)=(k.organisation_id,k.client_id,k.engagement_id,k.basis_id))
     + (SELECT count(*) FROM public.assessment_facts f WHERE (f.organisation_id,f.client_id,f.engagement_id,f.basis_id)=(k.organisation_id,k.client_id,k.engagement_id,k.basis_id)) > 1024) THEN
  RAISE EXCEPTION 'a basis holds at most 1024 facts' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $body$;
CREATE TRIGGER revision_batch AFTER INSERT ON public.assessment_basis_carried_facts REFERENCING NEW TABLE AS added FOR EACH STATEMENT EXECUTE FUNCTION public.revision_batch();

-- At commit, a carry holds every effective fact of the basis it carries
-- from, except the listed (subject, name) pairs and the ones its successor
-- records itself: exactly `carried` rows.
CREATE FUNCTION public.revision_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF (SELECT count(*) FROM public.assessment_basis_carried_facts c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id)) <> NEW.carried
   OR NEW.carried <> (SELECT count(*) FROM public.assessment_facts f
     WHERE (f.organisation_id,f.client_id,f.engagement_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id)
     AND (f.basis_id=NEW.from_basis_id OR (EXISTS(SELECT 1 FROM public.assessment_basis_carried_facts c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id,c.fact_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.from_basis_id,f.id))
       AND NOT EXISTS(SELECT 1 FROM public.assessment_facts o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.basis_id,o.subject,o.name)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.from_basis_id,f.subject,f.name))))
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'except') e WHERE e->>'subject'=f.subject AND e->>'name'=f.name)
     AND NOT EXISTS(SELECT 1 FROM public.assessment_facts o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.basis_id,o.subject,o.name)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id,f.subject,f.name))) THEN
  RAISE EXCEPTION 'a carry holds every effective fact of the basis it carries from, except the listed ones' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $body$;
CREATE CONSTRAINT TRIGGER revision_complete AFTER INSERT ON public.assessment_basis_carries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.revision_complete();

-- A chain has one revision 1: once any evaluation exists for a subject in a
-- basis and criterion lineage, a later basis or criterion version revises
-- that chain instead of starting another.
CREATE FUNCTION public.revision_first() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE basis_root text; criterion_root text; walker text; hops integer;
BEGIN
 basis_root := NEW.basis_id; hops := 0;
 LOOP
  SELECT b.supersedes INTO walker FROM public.assessment_bases b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,basis_root);
  EXIT WHEN walker IS NULL OR hops >= 64;
  basis_root := walker; hops := hops + 1;
 END LOOP;
 criterion_root := NEW.criterion_id; hops := 0;
 LOOP
  SELECT c.supersedes INTO walker FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,criterion_root);
  EXIT WHEN walker IS NULL OR hops >= 64;
  criterion_root := walker; hops := hops + 1;
 END LOOP;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('chain:'||NEW.organisation_id||'/'||NEW.client_id||'/'||NEW.engagement_id||'/'||basis_root||'/'||criterion_root||'/'||NEW.subject, 0));
 IF EXISTS(
   WITH RECURSIVE bases(id) AS (SELECT basis_root UNION SELECT b.id FROM public.assessment_bases b JOIN bases t ON b.supersedes=t.id WHERE (b.organisation_id,b.client_id,b.engagement_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id)),
     criteria(id) AS (SELECT criterion_root UNION SELECT c.id FROM public.assessment_criteria c JOIN criteria t ON c.supersedes=t.id WHERE (c.organisation_id,c.client_id,c.engagement_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id))
   SELECT 1 FROM public.assessment_evaluations e WHERE (e.organisation_id,e.client_id,e.engagement_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id)
     AND e.subject=NEW.subject AND e.basis_id IN (SELECT id FROM bases) AND e.criterion_id IN (SELECT id FROM criteria)) THEN
  RAISE EXCEPTION 'an evaluation of a subject already evaluated in this basis and criterion lineage is a revision of that chain' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER revision_first BEFORE INSERT ON public.assessment_evaluations FOR EACH ROW EXECUTE FUNCTION public.revision_first();

-- Every record is an immutable, retained fact, even for the owner: no UPDATE,
-- DELETE or TRUNCATE, except an explicit disposable fixture reset (a session
-- setting) in a database named *_test.
CREATE FUNCTION public.revision_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_OP='DELETE' AND pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'revision records are immutable' USING ERRCODE='23514';
END $body$;
CREATE FUNCTION public.revision_retained() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN NULL;
 END IF;
 RAISE EXCEPTION 'revision records are retained' USING ERRCODE='23514';
END $body$;
DO $immutable$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['assessment_basis_carries','assessment_basis_carried_facts','assessment_evaluation_revisions','assessment_dispositions'] LOOP
  EXECUTE format('CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.revision_immutable()',relation);
  EXECUTE format('CREATE TRIGGER revision_retained BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.revision_retained()',relation);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT USING (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)))',relation,relation,relation,relation);
  EXECUTE format('CREATE POLICY scoped_insert ON public.%I FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)) AND actor_id=pg_catalog.current_setting(''zobba.actor_id'',true))',relation,relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $immutable$;
REVOKE ALL ON FUNCTION public.revision_guard(),public.revision_batch(),public.revision_complete(),public.revision_first(),public.revision_immutable(),public.revision_retained() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assessment_guard() FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=20) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=20;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
