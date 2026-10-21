-- Story 24.1: typed criteria and facts bound to an assessment basis. Additive:
-- published schemas 1-17 are unchanged. Every record is an immutable fact
-- written by trusted code under the exact claim producer's custody, after it
-- checked the agent's proposal: criterion versions with their checked
-- authority, assessment-basis versions with their criteria, typed fact
-- observations with their verified sources, and evaluations whose
-- applicability, execution, verdict and origin are separate columns. Each
-- row keeps its canonical document and its SHA-256; the key columns repeat
-- what the document says so the database can refuse a record that disagrees.
-- There is no confidence column and no free-text verdict.
-- `*_us` columns are database time in microseconds, the order every reader uses.

CREATE TABLE public.assessment_criteria (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
 id text NOT NULL CHECK(id ~ '^crit-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 kind text NOT NULL CHECK(kind IN ('rule','judgment')),
 authority_kind text NOT NULL CHECK(authority_kind IN ('method','original')),
 authority_verified boolean NOT NULL,
 authority_reason text CHECK(authority_reason IN ('not_found_at_location','location_missing','source_unreadable','page_only','method_changed','criterion_not_found')),
 supersedes text CHECK(supersedes ~ '^crit-[0-9a-f]{40}$'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 -- An unverified authority names exactly one closed reason; a method reason
 -- belongs to a method authority and a location reason to an original.
 CHECK(authority_verified = (authority_reason IS NULL)),
 CHECK(authority_reason IS NULL OR (authority_kind='method') = (authority_reason IN ('method_changed','criterion_not_found'))),
 CHECK(document->>'record'='criterion' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'method'=kind AND document->>'authority_kind'=authority_kind
   AND (document->>'authority_verified')::boolean=authority_verified
   AND document->>'authority_reason' IS NOT DISTINCT FROM authority_reason
   AND document->>'supersedes' IS NOT DISTINCT FROM supersedes
   AND document->>'missing'='undetermined'),
 -- A method authority names the binding and text it was read from; an
 -- original authority names the exact original digest when verified.
 CHECK(NOT authority_verified OR (authority_kind='method' AND document->>'authority_text_sha256' ~ '^[0-9a-f]{64}$')
   OR (authority_kind='original' AND document->>'authority_original_sha256' ~ '^[0-9a-f]{64}$')),
 CHECK((kind='rule') = (jsonb_typeof(document->'rule')='object') AND (kind='judgment') = (jsonb_typeof(document->'rubric')='string')),
 CHECK(supersedes IS DISTINCT FROM id),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,supersedes) REFERENCES public.assessment_criteria(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_criteria_task ON public.assessment_criteria(organisation_id,client_id,engagement_id,task_id,created_us);

CREATE TABLE public.assessment_bases (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal = 0),
 id text NOT NULL CHECK(id ~ '^basis-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 period_from date NOT NULL,
 period_to date NOT NULL,
 supersedes text CHECK(supersedes ~ '^basis-[0-9a-f]{40}$'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK(period_from <= period_to),
 CHECK(document->>'record'='basis' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'period_from'=to_char(period_from,'YYYY-MM-DD') AND document->>'period_to'=to_char(period_to,'YYYY-MM-DD')
   AND document->>'supersedes' IS NOT DISTINCT FROM supersedes
   AND jsonb_typeof(document->'criteria')='array' AND jsonb_array_length(document->'criteria') BETWEEN 1 AND 16),
 CHECK(supersedes IS DISTINCT FROM id),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,supersedes) REFERENCES public.assessment_bases(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_bases_task ON public.assessment_bases(organisation_id,client_id,engagement_id,task_id,created_us);

-- The criterion versions a basis version pins, in its order.
CREATE TABLE public.assessment_basis_criteria (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 basis_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 15),
 criterion_id text NOT NULL,
 PRIMARY KEY(organisation_id,client_id,engagement_id,basis_id,ordinal),
 UNIQUE(organisation_id,client_id,engagement_id,basis_id,criterion_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,basis_id) REFERENCES public.assessment_bases(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,criterion_id) REFERENCES public.assessment_criteria(organisation_id,client_id,engagement_id,id)
);

CREATE TABLE public.assessment_facts (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 63),
 id text NOT NULL CHECK(id ~ '^fact-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 basis_id text NOT NULL,
 -- The subject exactly as stated: leading zeros and case are kept. Control
 -- characters are the exact Unicode Cc range Rust refuses (never a locale class).
 subject text NOT NULL CHECK(octet_length(subject) BETWEEN 1 AND 128 AND btrim(subject) <> '' AND subject !~ '[\x01-\x1f\x7f-\x9f]'),
 subject_unit text NOT NULL CHECK(subject_unit ~ '^[a-z][a-z0-9_]{0,63}$'),
 name text NOT NULL CHECK(name ~ '^[a-z][a-z0-9_]{0,63}$'),
 value_kind text NOT NULL CHECK(value_kind IN ('identifier','text','boolean','enum','decimal','date','instant','unavailable','ambiguous')),
 support text NOT NULL CHECK(support IN ('supported','unsupported','no_value')),
 support_reason text CHECK(support_reason IN ('type_mismatch','source_unverified','analysis_failed','partial_value')),
 rule text CHECK(rule IN ('identifier_exact','text_exact','enum_exact','boolean_yes_no','boolean_true_false','decimal_plain','decimal_grouped_comma','date_iso','date_dmy','instant_rfc3339')),
 job_id text,
 -- Whether trusted code found the subject, and a decimal's currency or unit,
 -- at or beside a verified source of the value; otherwise they are claims.
 subject_grounded boolean NOT NULL,
 measure_grounded boolean,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((support='unsupported') = (support_reason IS NOT NULL)),
 CHECK((value_kind='decimal') = (measure_grounded IS NOT NULL)),
 -- A stated value names its parse rule and is supported or not; an
 -- unavailable or ambiguous fact states no value (unless its analysis failed).
 CHECK((value_kind IN ('unavailable','ambiguous')) = (rule IS NULL)),
 CHECK(value_kind NOT IN ('unavailable','ambiguous') OR support='no_value' OR support_reason IN ('analysis_failed','source_unverified')),
 CHECK(value_kind IN ('unavailable','ambiguous') OR support <> 'no_value'),
 CHECK(support_reason IS DISTINCT FROM 'analysis_failed' OR job_id IS NOT NULL),
 CHECK(document->>'record'='fact' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'basis_id'=basis_id AND document->>'subject'=subject AND document->>'subject_unit'=subject_unit
   AND document->>'name'=name AND document->'value'->>'kind'=value_kind AND document->>'support'=support
   AND document->>'support_reason' IS NOT DISTINCT FROM support_reason AND document->>'rule' IS NOT DISTINCT FROM rule
   AND document->>'job_id' IS NOT DISTINCT FROM job_id
   AND jsonb_typeof(document->'subject_grounded')='boolean' AND (document->>'subject_grounded')::boolean=subject_grounded
   AND document->>'measure_grounded' IS NOT DISTINCT FROM measure_grounded::text
   AND jsonb_typeof(document->'sources')='array' AND jsonb_array_length(document->'sources') <= 4),
 -- No float: a decimal is a digit string mantissa and an integer scale.
 CHECK(value_kind <> 'decimal' OR (document->'value'->>'mantissa' ~ '^-?[0-9]{1,19}$' AND (document->'value'->>'scale')::integer BETWEEN 0 AND 18
   AND (document->'value'->'measure'->>'currency' ~ '^[A-Z]{3}$' OR document->'value'->'measure'->>'unit' ~ '^[a-z][a-z0-9_]{0,63}$'))),
 CHECK(value_kind <> 'instant' OR (jsonb_typeof(document->'value'->'utc_micros')='number' AND (document->'value'->>'offset_minutes')::integer BETWEEN -840 AND 840)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 -- Facts are pinned to a basis version: one per subject and name.
 UNIQUE(organisation_id,client_id,engagement_id,basis_id,subject,name),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,basis_id) REFERENCES public.assessment_bases(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,job_id) REFERENCES public.analysis_jobs(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_facts_task ON public.assessment_facts(organisation_id,client_id,engagement_id,task_id,created_us);

-- A fact's sources, as the 22.5 verifier recorded them (citation_sources).
CREATE TABLE public.assessment_fact_sources (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 fact_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 3),
 original_id text NOT NULL CHECK(original_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 locator text CHECK(octet_length(locator) BETWEEN 1 AND 300 AND locator !~ '[[:cntrl:]]'),
 quote text NOT NULL CHECK(octet_length(quote) <= 1000),
 original_sha256 text CHECK(original_sha256 ~ '^[0-9a-f]{64}$'),
 verification text NOT NULL CHECK(verification IN ('verified','unverified')),
 reason text CHECK(reason IN ('not_found_at_location','location_missing','source_unreadable','page_only')),
 CHECK((verification='unverified') = (reason IS NOT NULL)),
 CHECK(verification <> 'verified' OR original_sha256 IS NOT NULL),
 CHECK(locator IS NOT NULL OR reason='location_missing'),
 PRIMARY KEY(organisation_id,client_id,engagement_id,fact_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,fact_id) REFERENCES public.assessment_facts(organisation_id,client_id,engagement_id,id)
);

CREATE TABLE public.assessment_evaluations (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 1031),
 id text NOT NULL CHECK(id ~ '^eval-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 basis_id text NOT NULL,
 criterion_id text NOT NULL,
 subject text NOT NULL CHECK(octet_length(subject) BETWEEN 1 AND 128 AND btrim(subject) <> '' AND subject !~ '[\x01-\x1f\x7f-\x9f]'),
 applicability text NOT NULL CHECK(applicability IN ('applicable','not_applicable','unknown')),
 execution text NOT NULL CHECK(execution IN ('completed','failed')),
 verdict text CHECK(verdict IN ('met','not_met','undetermined')),
 reason text CHECK(reason IN ('missing_fact','fact_unavailable','fact_ambiguous','fact_unsupported','unit_mismatch','unknown_applicability','authority_unverified','analysis_failed','subject_unverified','unit_unverified')),
 origin text NOT NULL CHECK(origin IN ('deterministic','model_proposal')),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 output_digest text NOT NULL CHECK(output_digest ~ '^[0-9a-f]{64}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 -- Applicability, execution, verdict and origin are separate. Only an
 -- applicable, completed evaluation can be met or not_met, and then with no
 -- reason; a failed execution has no verdict and says analysis_failed; a
 -- not-applicable criterion has no verdict (it is not a pass).
 CHECK(verdict NOT IN ('met','not_met') OR (applicability='applicable' AND execution='completed' AND reason IS NULL)),
 CHECK(execution='completed' OR (verdict IS NULL AND reason='analysis_failed')),
 CHECK(applicability <> 'not_applicable' OR verdict IS NULL),
 CHECK(verdict IS DISTINCT FROM 'undetermined' OR reason IS NOT NULL OR origin='model_proposal'),
 CHECK(document->>'record'='evaluation' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'basis_id'=basis_id AND document->>'criterion_id'=criterion_id AND document->>'subject'=subject
   AND document->>'applicability'=applicability AND document->>'execution'=execution
   AND document->>'verdict' IS NOT DISTINCT FROM verdict AND document->>'reason' IS NOT DISTINCT FROM reason
   AND document->>'origin'=origin AND document->>'output_digest'=output_digest
   AND jsonb_typeof(document->'inputs')='array' AND jsonb_array_length(document->'inputs') <= 32
   AND (origin='model_proposal') = (jsonb_typeof(document->'judgment')='object')),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 -- One evaluation per basis, criterion and subject (revisions are 24.3).
 UNIQUE(organisation_id,client_id,engagement_id,basis_id,criterion_id,subject),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,basis_id,criterion_id) REFERENCES public.assessment_basis_criteria(organisation_id,client_id,engagement_id,basis_id,criterion_id)
);
CREATE INDEX assessment_evaluations_task ON public.assessment_evaluations(organisation_id,client_id,engagement_id,task_id,created_us);

-- Records must agree with what trusted code actually recorded elsewhere: each
-- belongs to its own answer invocation of this Task, cycle and actor under
-- that turn's exact binding and epoch; every reference stays within the same
-- Task; and a decided verdict rests only on supported facts of its basis and a
-- verified authority.
CREATE FUNCTION public.assessment_guard() RETURNS trigger
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
  IF (SELECT count(*) FROM public.assessment_facts f WHERE (f.organisation_id,f.client_id,f.engagement_id,f.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id)) >= 1024 THEN
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
   IF NOT EXISTS(SELECT 1 FROM public.assessment_facts f WHERE (f.organisation_id,f.client_id,f.engagement_id,f.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,input->>'id')
     AND f.basis_id=NEW.basis_id AND f.subject=NEW.subject AND f.digest=input->>'digest'
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
CREATE TRIGGER assessment_guard BEFORE INSERT ON public.assessment_criteria FOR EACH ROW EXECUTE FUNCTION public.assessment_guard();
CREATE TRIGGER assessment_guard BEFORE INSERT ON public.assessment_bases FOR EACH ROW EXECUTE FUNCTION public.assessment_guard();
CREATE TRIGGER assessment_guard BEFORE INSERT ON public.assessment_basis_criteria FOR EACH ROW EXECUTE FUNCTION public.assessment_guard();
CREATE TRIGGER assessment_guard BEFORE INSERT ON public.assessment_facts FOR EACH ROW EXECUTE FUNCTION public.assessment_guard();
CREATE TRIGGER assessment_guard BEFORE INSERT ON public.assessment_fact_sources FOR EACH ROW EXECUTE FUNCTION public.assessment_guard();
CREATE TRIGGER assessment_guard BEFORE INSERT ON public.assessment_evaluations FOR EACH ROW EXECUTE FUNCTION public.assessment_guard();
-- At commit, a basis pins exactly its listed criteria and a fact holds exactly
-- its recorded sources; a supported fact's sources are all verified.
CREATE FUNCTION public.assessment_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_TABLE_NAME='assessment_bases' THEN
  IF (SELECT count(*) FROM public.assessment_basis_criteria k WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)) <> jsonb_array_length(NEW.document->'criteria') THEN
   RAISE EXCEPTION 'a basis pins exactly its listed criteria' USING ERRCODE='23514';
  END IF;
 ELSE
  IF (SELECT count(*) FROM public.assessment_fact_sources s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.fact_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)) <> jsonb_array_length(NEW.document->'sources')
    OR (NEW.support='supported' AND (jsonb_array_length(NEW.document->'sources') = 0 OR EXISTS(SELECT 1 FROM public.assessment_fact_sources s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.fact_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id) AND s.verification<>'verified'))) THEN
   RAISE EXCEPTION 'a fact holds exactly its sources, all verified when supported' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $body$;
CREATE CONSTRAINT TRIGGER assessment_complete AFTER INSERT ON public.assessment_bases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assessment_complete();
CREATE CONSTRAINT TRIGGER assessment_complete AFTER INSERT ON public.assessment_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assessment_complete();
-- Every assessment record is an immutable, retained fact, even for the owner:
-- no UPDATE, DELETE or TRUNCATE. The one exception is an explicit disposable
-- fixture reset (a session setting) in a database named *_test.
CREATE FUNCTION public.assessment_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_OP='DELETE' AND pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'assessment records are immutable' USING ERRCODE='23514';
END $body$;
CREATE FUNCTION public.assessment_retained() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN NULL;
 END IF;
 RAISE EXCEPTION 'assessment records are retained' USING ERRCODE='23514';
END $body$;
DO $immutable$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['assessment_criteria','assessment_bases','assessment_basis_criteria','assessment_facts','assessment_fact_sources','assessment_evaluations'] LOOP
  EXECUTE format('CREATE TRIGGER assessment_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.assessment_immutable()',relation);
  EXECUTE format('CREATE TRIGGER assessment_retained BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.assessment_retained()',relation);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT USING (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)))',relation,relation,relation,relation);
  EXECUTE format('CREATE POLICY scoped_insert ON public.%I FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)) AND actor_id=pg_catalog.current_setting(''zobba.actor_id'',true))',relation,relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $immutable$;
REVOKE ALL ON FUNCTION public.assessment_guard(),public.assessment_complete(),public.assessment_immutable(),public.assessment_retained() FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=18) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=18;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
