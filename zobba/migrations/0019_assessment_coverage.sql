-- Story 24.2: exact population, sample and coverage denominators. Additive:
-- published schemas 1-18 are unchanged. Every record is an immutable fact
-- written by trusted code under the exact claim producer's custody: a
-- population manifest whose rows trusted code read itself, one member row per
-- received row with its closed disposition, sample manifests checked against
-- the in-scope subjects, one opportunity per (population, criterion, member)
-- evaluated by trusted code, and coverage summaries. A summary's counts are
-- recounted here with exact aggregates over the stored members and
-- opportunities; a summary that disagrees, or a conclusion its counts do not
-- allow, is refused. There is no percentage, no inference and no confidence
-- column. `*_us` columns are database time in microseconds.

CREATE TABLE public.assessment_populations (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal = 0),
 id text NOT NULL CHECK(id ~ '^pop-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 basis_id text NOT NULL,
 supersedes text CHECK(supersedes ~ '^pop-[0-9a-f]{40}$'),
 original_id text NOT NULL CHECK(original_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[0-9a-f]{64}$'),
 subject_unit text NOT NULL CHECK(subject_unit ~ '^[a-z][a-z0-9_]{0,63}$'),
 exhaustive boolean NOT NULL,
 truncated boolean NOT NULL,
 header_row integer NOT NULL CHECK(header_row BETWEEN 1 AND 1000),
 last_row integer NOT NULL CHECK(last_row >= 0),
 rows_read integer NOT NULL CHECK(rows_read BETWEEN 0 AND 20000),
 declared_count bigint CHECK(declared_count >= 0),
 job_id text,
 received_rows integer NOT NULL, unkeyed integer NOT NULL, duplicate_rows integer NOT NULL,
 distinct_subjects integer NOT NULL, excluded_out_of_period integer NOT NULL,
 scope_unknown_period_unparsed integer NOT NULL, scope_unknown_period_missing integer NOT NULL,
 scope_unknown_conflicting_duplicate integer NOT NULL, in_scope integer NOT NULL,
 completeness text NOT NULL CHECK(completeness IN ('complete','incomplete')),
 completeness_reason text CHECK(completeness_reason IN ('not_exhaustive','row_bound','count_mismatch')),
 reconciliation text NOT NULL CHECK(reconciliation IN ('matched','mismatch','not_declared')),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK(least(received_rows,unkeyed,duplicate_rows,distinct_subjects,excluded_out_of_period,scope_unknown_period_unparsed,scope_unknown_period_missing,scope_unknown_conflicting_duplicate,in_scope) >= 0),
 -- One member per row read; subjects are in scope, excluded or scope unknown.
 CHECK(received_rows = rows_read),
 CHECK(distinct_subjects = in_scope + excluded_out_of_period + scope_unknown_period_unparsed + scope_unknown_period_missing + scope_unknown_conflicting_duplicate),
 CHECK(unkeyed + duplicate_rows + in_scope + excluded_out_of_period + scope_unknown_period_unparsed + scope_unknown_period_missing + 2*scope_unknown_conflicting_duplicate <= received_rows),
 -- Completeness is derived, never asserted: complete only when the source is
 -- stated exhaustive, the read was not truncated, every row to the sheet's
 -- last row was read, and a declared count equals the distinct subjects.
 CHECK((completeness='complete') = (completeness_reason IS NULL)),
 CHECK(completeness_reason IS NOT DISTINCT FROM CASE
   WHEN NOT exhaustive THEN 'not_exhaustive'
   WHEN truncated OR last_row < header_row OR rows_read <> last_row - header_row THEN 'row_bound'
   WHEN declared_count IS NOT NULL AND declared_count <> distinct_subjects THEN 'count_mismatch' END),
 CHECK(reconciliation = CASE WHEN declared_count IS NULL THEN 'not_declared' WHEN declared_count = distinct_subjects THEN 'matched' ELSE 'mismatch' END),
 -- Every document CHECK is wrapped in coalesce(..., false): a missing key
 -- makes a comparison NULL, and a CHECK that is NULL would pass.
 CHECK(coalesce(document->>'record'='population' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'basis_id'=basis_id AND document->>'supersedes' IS NOT DISTINCT FROM supersedes
   AND document->>'original_id'=original_id AND document->>'original_sha256'=original_sha256
   AND document->>'subject_unit'=subject_unit AND jsonb_typeof(document->'exhaustive')='boolean' AND (document->>'exhaustive')::boolean=exhaustive
   AND jsonb_typeof(document->'truncated')='boolean' AND (document->>'truncated')::boolean=truncated
   AND (document->>'header_row')::integer=header_row AND (document->>'last_row')::integer=last_row AND (document->>'rows_read')::integer=rows_read
   AND (document->>'declared_count')::bigint IS NOT DISTINCT FROM declared_count AND document->>'job_id' IS NOT DISTINCT FROM job_id
   AND (document->'counts'->>'received_rows')::integer=received_rows AND (document->'counts'->>'unkeyed')::integer=unkeyed
   AND (document->'counts'->>'duplicate_rows')::integer=duplicate_rows AND (document->'counts'->>'distinct_subjects')::integer=distinct_subjects
   AND (document->'counts'->>'excluded_out_of_period')::integer=excluded_out_of_period
   AND (document->'counts'->>'scope_unknown_period_unparsed')::integer=scope_unknown_period_unparsed
   AND (document->'counts'->>'scope_unknown_period_missing')::integer=scope_unknown_period_missing
   AND (document->'counts'->>'scope_unknown_conflicting_duplicate')::integer=scope_unknown_conflicting_duplicate
   AND (document->'counts'->>'in_scope')::integer=in_scope
   AND document->>'completeness'=completeness AND document->>'completeness_reason' IS NOT DISTINCT FROM completeness_reason
   AND document->>'reconciliation'=reconciliation
   AND jsonb_typeof(document->'grain')='array' AND jsonb_array_length(document->'grain') BETWEEN 1 AND 3
   AND jsonb_typeof(document->'value_columns')='array' AND jsonb_array_length(document->'value_columns') <= 8
   AND document ?& ARRAY['supersedes','declared_count','job_id','completeness_reason','sheet','control','columns','naive_date_times']
   AND jsonb_typeof(document->'columns')='array' AND jsonb_array_length(document->'columns') BETWEEN 1 AND 12
   AND (document->'columns') @> (document->'grain')
   AND jsonb_typeof(document->'naive_date_times')='number' AND (document->>'naive_date_times')::bigint >= 0, false)),
 -- A workbook population (one that names a sheet) was read by a trusted
 -- enumeration job; CSV and plain text are read in process, with no job.
 CHECK((job_id IS NULL) = (document->'sheet' = 'null'::jsonb)),
 -- A declared count is a control the 22.5 verifier verified at its location.
 CHECK((declared_count IS NULL) = (document->'control' = 'null'::jsonb)),
 CHECK(declared_count IS NULL OR (document->'control'->>'verification'='verified' AND document->'control'->>'original_sha256' ~ '^[0-9a-f]{64}$')),
 CHECK(supersedes IS DISTINCT FROM id),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,basis_id) REFERENCES public.assessment_bases(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,supersedes) REFERENCES public.assessment_populations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,job_id) REFERENCES public.analysis_jobs(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_populations_task ON public.assessment_populations(organisation_id,client_id,engagement_id,task_id,created_us);

-- One row per received row, in receipt order, with its closed disposition.
CREATE TABLE public.assessment_population_members (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 population_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 19999),
 row_number integer NOT NULL CHECK(row_number >= 1),
 subject text CHECK(octet_length(subject) BETWEEN 1 AND 128 AND btrim(subject) <> '' AND subject !~ '[\x01-\x1f\x7f-\x9f]'),
 disposition text NOT NULL CHECK(disposition IN ('in_scope','excluded','scope_unknown','duplicate_row','unkeyed')),
 reason text CHECK(reason IN ('out_of_period','period_unparsed','period_missing','conflicting_duplicate')),
 duplicate_of integer,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 16384),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 -- The closed pairs: excluded only out of period; scope unknown by a period
 -- or a conflicting duplicate; a duplicate row names an earlier row.
 CHECK((disposition='unkeyed') = (subject IS NULL)),
 CHECK(CASE disposition
   WHEN 'excluded' THEN reason='out_of_period'
   WHEN 'scope_unknown' THEN reason IN ('period_unparsed','period_missing','conflicting_duplicate')
   ELSE reason IS NULL END),
 CHECK((disposition='duplicate_row') = (duplicate_of IS NOT NULL) AND (duplicate_of IS NULL OR duplicate_of BETWEEN 0 AND ordinal-1)),
 CHECK(coalesce(document->>'record'='member' AND document->>'population_id'=population_id AND (document->>'ordinal')::integer=ordinal
   AND (document->>'row')::integer=row_number AND document->>'subject' IS NOT DISTINCT FROM subject
   AND document->>'disposition'=disposition AND document->>'reason' IS NOT DISTINCT FROM reason
   AND (document->>'duplicate_of')::integer IS NOT DISTINCT FROM duplicate_of
   AND jsonb_typeof(document->'cells')='array' AND jsonb_array_length(document->'cells') <= 12
   AND jsonb_typeof(document->'values')='array' AND jsonb_array_length(document->'values') <= 8
   AND document ?& ARRAY['subject','reason','duplicate_of'], false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,population_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,population_id) REFERENCES public.assessment_populations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_population_members_disposition ON public.assessment_population_members(organisation_id,client_id,engagement_id,population_id,disposition,ordinal);
CREATE INDEX assessment_population_members_subject ON public.assessment_population_members(organisation_id,client_id,engagement_id,population_id,subject COLLATE "C");

CREATE TABLE public.assessment_samples (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal = 0),
 id text NOT NULL CHECK(id ~ '^sample-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 population_id text NOT NULL,
 method text NOT NULL CHECK(method IN ('all_in_scope','judgmental','seeded_random')),
 seed text CHECK(seed ~ '^(0|[1-9][0-9]{0,19})$' AND seed::numeric <= 18446744073709551615),
 algorithm text CHECK(algorithm = 'splitmix64-fisher-yates-v1'),
 size integer NOT NULL CHECK(size BETWEEN 0 AND 20000),
 -- Story 24.2 never infers anything about unselected items.
 statistical_inference boolean NOT NULL CHECK(NOT statistical_inference),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((method='seeded_random') = (seed IS NOT NULL) AND (seed IS NULL) = (algorithm IS NULL)),
 CHECK(coalesce(document->>'record'='sample' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'population_id'=population_id AND document->>'method'=method AND document->>'seed' IS NOT DISTINCT FROM seed
   AND document->>'algorithm' IS NOT DISTINCT FROM algorithm AND (document->>'size')::integer=size
   AND (document->>'statistical_inference')::boolean=statistical_inference
   AND (document->>'selected_count')::integer=size AND document->>'selected_sha256' ~ '^[0-9a-f]{64}$'
   AND document ?& ARRAY['seed','algorithm'], false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,population_id) REFERENCES public.assessment_populations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_samples_task ON public.assessment_samples(organisation_id,client_id,engagement_id,task_id,created_us);

-- A sample's selected subjects, each an in-scope member of its population.
CREATE TABLE public.assessment_sample_members (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 sample_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 19999),
 subject text NOT NULL,
 member_ordinal integer NOT NULL,
 PRIMARY KEY(organisation_id,client_id,engagement_id,sample_id,ordinal),
 UNIQUE(organisation_id,client_id,engagement_id,sample_id,subject),
 FOREIGN KEY(organisation_id,client_id,engagement_id,sample_id) REFERENCES public.assessment_samples(organisation_id,client_id,engagement_id,id)
);

-- One opportunity per (population, criterion, in-scope member), decided by
-- trusted code with the 24.1 evaluator (or a judgment criterion's 24.1
-- judgment at the population's subject unit).
CREATE TABLE public.assessment_opportunities (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 population_id text NOT NULL,
 criterion_id text NOT NULL,
 member_ordinal integer NOT NULL,
 subject text NOT NULL,
 applicability text NOT NULL CHECK(applicability IN ('applicable','not_applicable','unknown')),
 execution text NOT NULL CHECK(execution IN ('completed','failed')),
 verdict text CHECK(verdict IN ('met','not_met','undetermined')),
 reason text CHECK(reason IN ('missing_fact','fact_unavailable','fact_ambiguous','fact_unsupported','unit_mismatch','unknown_applicability','authority_unverified','analysis_failed','subject_unverified','unit_unverified')),
 origin text NOT NULL CHECK(origin IN ('deterministic','model_proposal')),
 output_digest text NOT NULL CHECK(output_digest ~ '^[0-9a-f]{64}$'),
 evaluation_id text CHECK(evaluation_id ~ '^eval-[0-9a-f]{40}$'),
 inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='array' AND jsonb_array_length(inputs) <= 32),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 -- The 24.1 rules: applicability, execution, verdict and origin are separate.
 CHECK(verdict NOT IN ('met','not_met') OR (applicability='applicable' AND execution='completed' AND reason IS NULL)),
 CHECK(execution='completed' OR (verdict IS NULL AND reason='analysis_failed')),
 CHECK(applicability <> 'not_applicable' OR verdict IS NULL),
 CHECK(verdict IS DISTINCT FROM 'undetermined' OR reason IS NOT NULL OR origin='model_proposal'),
 CHECK((origin='model_proposal') = (evaluation_id IS NOT NULL)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,population_id,criterion_id,member_ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,population_id,member_ordinal) REFERENCES public.assessment_population_members(organisation_id,client_id,engagement_id,population_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,criterion_id) REFERENCES public.assessment_criteria(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,evaluation_id) REFERENCES public.assessment_evaluations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_opportunities_subject ON public.assessment_opportunities(organisation_id,client_id,engagement_id,population_id,subject COLLATE "C");

CREATE TABLE public.assessment_summaries (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 1),
 id text NOT NULL CHECK(id ~ '^summary-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 basis_id text NOT NULL,
 population_id text NOT NULL,
 sample_id text,
 aggregation text NOT NULL CHECK(aggregation = 'subject_partition_v1'),
 conclusion text NOT NULL CHECK(conclusion IN ('no_eligible_items','exceptions_found','exceptions_found_inconclusive','no_exception_found','inconclusive','no_items_found_absence_not_proven')),
 completeness text NOT NULL CHECK(completeness IN ('complete','incomplete')),
 completeness_reason text CHECK(completeness_reason IN ('not_exhaustive','row_bound','count_mismatch')),
 reconciliation text NOT NULL CHECK(reconciliation IN ('matched','mismatch','not_declared')),
 received_rows integer NOT NULL, unkeyed integer NOT NULL, duplicate_rows integer NOT NULL,
 distinct_subjects integer NOT NULL, excluded_out_of_period integer NOT NULL,
 scope_unknown_period_unparsed integer NOT NULL, scope_unknown_period_missing integer NOT NULL,
 scope_unknown_conflicting_duplicate integer NOT NULL, in_scope integer NOT NULL,
 selected integer,
 failing_subjects integer NOT NULL, meets_every_applicable integer NOT NULL,
 unresolved_subjects integer NOT NULL, not_applicable_to_any integer NOT NULL,
 failing_opportunities integer NOT NULL,
 statistical_inference boolean NOT NULL CHECK(NOT statistical_inference),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 summary_digest text NOT NULL CHECK(summary_digest ~ '^[0-9a-f]{64}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((sample_id IS NULL) = (selected IS NULL)),
 CHECK((completeness='complete') = (completeness_reason IS NULL)),
 CHECK(failing_subjects + meets_every_applicable + unresolved_subjects + not_applicable_to_any = coalesce(selected, in_scope)),
 CHECK(coalesce(document->>'record'='summary' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'basis_id'=basis_id AND document->>'population_id'=population_id AND document->>'sample_id' IS NOT DISTINCT FROM sample_id
   AND document->>'summary_digest'=summary_digest
   AND document->'summary'->>'aggregation'=aggregation AND document->'summary'->>'conclusion'=conclusion
   AND document->'summary'->>'completeness'=completeness AND document->'summary'->>'completeness_reason' IS NOT DISTINCT FROM completeness_reason
   AND document->'summary'->>'reconciliation'=reconciliation
   AND (document->'summary'->>'received_rows')::integer=received_rows AND (document->'summary'->>'unkeyed')::integer=unkeyed
   AND (document->'summary'->>'duplicate_rows')::integer=duplicate_rows AND (document->'summary'->>'distinct_subjects')::integer=distinct_subjects
   AND (document->'summary'->>'excluded_out_of_period')::integer=excluded_out_of_period
   AND (document->'summary'->>'scope_unknown_period_unparsed')::integer=scope_unknown_period_unparsed
   AND (document->'summary'->>'scope_unknown_period_missing')::integer=scope_unknown_period_missing
   AND (document->'summary'->>'scope_unknown_conflicting_duplicate')::integer=scope_unknown_conflicting_duplicate
   AND (document->'summary'->>'in_scope')::integer=in_scope AND (document->'summary'->>'selected')::integer IS NOT DISTINCT FROM selected
   AND (document->'summary'->>'failing')::integer=failing_subjects AND (document->'summary'->>'meets_every_applicable')::integer=meets_every_applicable
   AND (document->'summary'->>'unresolved')::integer=unresolved_subjects AND (document->'summary'->>'not_applicable_to_any')::integer=not_applicable_to_any
   AND (document->'summary'->>'failing_opportunities')::integer=failing_opportunities
   AND (document->'summary'->>'statistical_inference')::boolean=statistical_inference
   AND jsonb_typeof(document->'summary'->'criteria')='array' AND jsonb_array_length(document->'summary'->'criteria') BETWEEN 1 AND 16
   AND document ?& ARRAY['sample_id'] AND document->'summary' ?& ARRAY['completeness_reason','selected']
   -- Limitations are closed codes (said in words beside their counts).
   AND jsonb_typeof(document->'summary'->'limitations')='array'
   AND NOT jsonb_path_exists(document->'summary'->'limitations', '$[*] ? (!(@.code == "not_evaluated" || @.code == "judgment_not_recorded" || @.code == "unreviewed_model_judgments" || @.code == "sample_selected_only" || @.code == "scope_unknown" || @.code == "unkeyed_rows" || @.code == "period_not_checked" || @.code == "naive_date_times"))'), false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 UNIQUE NULLS NOT DISTINCT (organisation_id,client_id,engagement_id,population_id,sample_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,basis_id) REFERENCES public.assessment_bases(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,population_id) REFERENCES public.assessment_populations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,sample_id) REFERENCES public.assessment_samples(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_summaries_task ON public.assessment_summaries(organisation_id,client_id,engagement_id,task_id,created_us);

-- Records agree with what trusted code recorded elsewhere: each belongs to its
-- own answer invocation of this Task, cycle and actor under that turn's exact
-- binding and epoch, and every reference stays within the same Task.
CREATE FUNCTION public.coverage_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE population public.assessment_populations%ROWTYPE;
 recount record; partitioned record; entry jsonb; position_in_basis integer; expected text; unresolved integer; subjects integer; criteria integer;
 unreviewed bigint := 0; program text; literal text; request jsonb; code integer;
BEGIN
 IF TG_TABLE_NAME IN ('assessment_populations','assessment_samples','assessment_summaries') THEN
  IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
    AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id
    AND i.request->'context'->'verification'->>'expected_methodology_binding_id' = NEW.methodology_binding_id
    AND (i.request->'basis'->>'execution_epoch')::bigint = NEW.execution_epoch) THEN
   RAISE EXCEPTION 'a coverage record belongs to its answer invocation and its binding' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_TABLE_NAME='assessment_populations' THEN
  IF NOT EXISTS(SELECT 1 FROM public.assessment_bases b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id) AND b.task_id=NEW.task_id) THEN
   RAISE EXCEPTION 'a population belongs to a basis of its own Task' USING ERRCODE='23514';
  END IF;
  IF NEW.supersedes IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.assessment_populations p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.supersedes) AND p.task_id=NEW.task_id) THEN
   RAISE EXCEPTION 'a population version succeeds one of its own Task' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.evidence_originals o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.original_id) AND o.digest=NEW.original_sha256) THEN
   RAISE EXCEPTION 'a population reads a registered original by its digest' USING ERRCODE='23514';
  END IF;
  -- A workbook was read by a collected trusted enumeration job of this Task
  -- over exactly this original, whose program completed (no failure).
  IF NEW.job_id IS NOT NULL THEN
   SELECT j.program INTO program FROM public.analysis_jobs j
    WHERE j.id=NEW.job_id AND j.task_id=NEW.task_id AND j.environment_id='document-python-3-13'
      AND j.inputs=jsonb_build_array(jsonb_build_object('original_id',NEW.original_id,'digest',NEW.original_sha256))
      AND EXISTS(SELECT 1 FROM public.analysis_job_events e WHERE e.job_id=j.id AND e.status='collected')
      AND NOT EXISTS(SELECT 1 FROM public.analysis_job_events e WHERE e.job_id=j.id AND e.status IN ('failed','limit_exceeded'));
   IF program IS NULL THEN
    RAISE EXCEPTION 'a population names a collected enumeration job over its exact original' USING ERRCODE='23514';
   END IF;
   -- The job's request is the program's one string literal (written by the
   -- trusted encoder: \uXXXX and \UXXXXXXXX escapes). Decoded, it names this
   -- population's mode, original, sheet, header row and columns exactly.
   literal := substring(program FROM '\nmain\(_zobba_json\.loads\("((?:[A-Za-z0-9 _:.,{}\[\]-]|\\u[0-9a-f]{4}|\\U[0-9a-f]{8})*)"\)\)\n$');
   BEGIN
    WHILE literal ~ '\\U[0-9a-f]{8}' LOOP
     code := ('x' || substring(literal FROM '\\U([0-9a-f]{8})'))::bit(32)::integer;
     literal := regexp_replace(literal, '\\U[0-9a-f]{8}', chr(code));
    END LOOP;
    request := ((('"' || literal || '"')::jsonb) #>> '{}')::jsonb;
   EXCEPTION WHEN others THEN
    request := NULL;
   END;
   IF request IS NULL OR request->>'mode' IS DISTINCT FROM 'enumerate' OR request->>'original' IS DISTINCT FROM NEW.original_id
      OR request->'sheet' IS DISTINCT FROM NEW.document->'sheet' OR request->'header_row' IS DISTINCT FROM to_jsonb(NEW.header_row)
      OR request->'columns' IS DISTINCT FROM NEW.document->'columns' THEN
    RAISE EXCEPTION 'a population names the enumeration job that read its sheet, header row and columns' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='assessment_samples' THEN
  IF NOT EXISTS(SELECT 1 FROM public.assessment_populations p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id) AND p.task_id=NEW.task_id) THEN
   RAISE EXCEPTION 'a sample selects from a population of its own Task' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='assessment_summaries' THEN
  SELECT p.* INTO population FROM public.assessment_populations p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id);
  IF population.id IS NULL OR population.task_id <> NEW.task_id OR population.basis_id <> NEW.basis_id THEN
   RAISE EXCEPTION 'a summary reads a population of its own Task and basis' USING ERRCODE='23514';
  END IF;
  IF NEW.sample_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.assessment_samples s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id) AND s.population_id=NEW.population_id AND s.task_id=NEW.task_id) THEN
   RAISE EXCEPTION 'a summary reads a sample of its population' USING ERRCODE='23514';
  END IF;
  -- Completeness and reconciliation are the population's own.
  IF NEW.completeness <> population.completeness OR NEW.completeness_reason IS DISTINCT FROM population.completeness_reason OR NEW.reconciliation <> population.reconciliation THEN
   RAISE EXCEPTION 'a summary states its population''s completeness and reconciliation' USING ERRCODE='23514';
  END IF;
  -- One population's opportunities and summaries are serialised (the
  -- opportunity batch guard takes the same lock): a summary reads every
  -- opportunity, and no opportunity is added once a summary exists.
  PERFORM pg_advisory_xact_lock(hashtextextended('coverage:'||NEW.population_id,0));
  -- Every population count, recounted from the stored members.
  SELECT count(*) AS received_rows,
    count(*) FILTER (WHERE m.disposition='unkeyed') AS unkeyed,
    count(*) FILTER (WHERE m.disposition='duplicate_row') AS duplicate_rows,
    count(DISTINCT m.subject) AS distinct_subjects,
    count(*) FILTER (WHERE m.disposition='excluded') AS excluded_out_of_period,
    count(*) FILTER (WHERE m.reason='period_unparsed') AS period_unparsed,
    count(*) FILTER (WHERE m.reason='period_missing') AS period_missing,
    count(DISTINCT m.subject) FILTER (WHERE m.reason='conflicting_duplicate') AS conflicting,
    count(*) FILTER (WHERE m.disposition='in_scope') AS in_scope
   INTO recount FROM public.assessment_population_members m
   WHERE (m.organisation_id,m.client_id,m.engagement_id,m.population_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id);
  IF recount.received_rows IS DISTINCT FROM NEW.received_rows THEN RAISE EXCEPTION 'a summary count is not the stored count: received_rows' USING ERRCODE='23514'; END IF;
  IF recount.unkeyed IS DISTINCT FROM NEW.unkeyed THEN RAISE EXCEPTION 'a summary count is not the stored count: unkeyed' USING ERRCODE='23514'; END IF;
  IF recount.duplicate_rows IS DISTINCT FROM NEW.duplicate_rows THEN RAISE EXCEPTION 'a summary count is not the stored count: duplicate_rows' USING ERRCODE='23514'; END IF;
  IF recount.distinct_subjects IS DISTINCT FROM NEW.distinct_subjects THEN RAISE EXCEPTION 'a summary count is not the stored count: distinct_subjects' USING ERRCODE='23514'; END IF;
  IF recount.excluded_out_of_period IS DISTINCT FROM NEW.excluded_out_of_period THEN RAISE EXCEPTION 'a summary count is not the stored count: excluded_out_of_period' USING ERRCODE='23514'; END IF;
  IF recount.period_unparsed IS DISTINCT FROM NEW.scope_unknown_period_unparsed THEN RAISE EXCEPTION 'a summary count is not the stored count: scope_unknown_period_unparsed' USING ERRCODE='23514'; END IF;
  IF recount.period_missing IS DISTINCT FROM NEW.scope_unknown_period_missing THEN RAISE EXCEPTION 'a summary count is not the stored count: scope_unknown_period_missing' USING ERRCODE='23514'; END IF;
  IF recount.conflicting IS DISTINCT FROM NEW.scope_unknown_conflicting_duplicate THEN RAISE EXCEPTION 'a summary count is not the stored count: scope_unknown_conflicting_duplicate' USING ERRCODE='23514'; END IF;
  IF recount.in_scope IS DISTINCT FROM NEW.in_scope THEN RAISE EXCEPTION 'a summary count is not the stored count: in_scope' USING ERRCODE='23514'; END IF;
  IF NEW.sample_id IS NOT NULL AND NEW.selected IS DISTINCT FROM (SELECT count(*) FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id)) THEN
   RAISE EXCEPTION 'a summary count is not the stored count: selected' USING ERRCODE='23514';
  END IF;
  -- A sample's selected subjects are read once per statement (a hashed,
  -- uncorrelated subquery), never once per member or opportunity.
  -- The subjects: the in-scope members, or the sample's selected members.
  -- (An opportunity exists only for an in-scope member, by its guard.)
  SELECT count(*) INTO subjects FROM public.assessment_population_members m
   WHERE (m.organisation_id,m.client_id,m.engagement_id,m.population_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id)
     AND m.disposition='in_scope'
     AND (NEW.sample_id IS NULL OR m.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id)));
  SELECT count(*) INTO criteria FROM public.assessment_basis_criteria k WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id);
  IF jsonb_array_length(NEW.document->'summary'->'criteria') IS DISTINCT FROM criteria THEN
   RAISE EXCEPTION 'a summary counts every criterion of its basis' USING ERRCODE='23514';
  END IF;
  -- A summary reads every opportunity: each criterion of its basis has
  -- exactly one per in-scope member before any summary is recorded.
  IF EXISTS(SELECT 1 FROM public.assessment_basis_criteria k
     WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id)
       AND (SELECT count(*) FROM public.assessment_opportunities o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.population_id,o.criterion_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id,k.criterion_id))
           IS DISTINCT FROM population.in_scope::bigint) THEN
   RAISE EXCEPTION 'a summary reads every opportunity of every criterion of its basis' USING ERRCODE='23514';
  END IF;
  -- Per criterion, in basis order, recounted from the stored opportunities.
  FOR position_in_basis, entry IN SELECT k.ordinal, NEW.document->'summary'->'criteria'->k.ordinal FROM public.assessment_basis_criteria k
     WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id) ORDER BY k.ordinal LOOP
   SELECT k.criterion_id AS criterion_id,
     count(*) FILTER (WHERE o.applicability='applicable') AS applicable,
     count(*) FILTER (WHERE o.applicability='not_applicable') AS not_applicable,
     count(*) FILTER (WHERE o.applicability='applicable' AND o.verdict='met') AS met,
     count(*) FILTER (WHERE o.applicability='applicable' AND o.verdict='not_met') AS not_met,
     count(*) FILTER (WHERE o.applicability='applicable' AND o.execution='completed' AND o.verdict='undetermined') AS undetermined,
     count(*) FILTER (WHERE o.applicability='applicable' AND o.execution='failed') AS execution_failed,
     count(*) FILTER (WHERE o.applicability='applicable' AND o.execution='completed' AND o.verdict IS NULL) AS not_evaluated,
     count(*) FILTER (WHERE o.applicability='applicable' AND o.verdict='met' AND o.origin='model_proposal') AS met_unreviewed,
     coalesce((SELECT jsonb_object_agg(r.reason, r.n) FROM (SELECT coalesce(o2.reason,'stated_in_words') AS reason, count(*) AS n
        FROM public.assessment_opportunities o2
        WHERE (o2.organisation_id,o2.client_id,o2.engagement_id,o2.population_id,o2.criterion_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id,k.criterion_id)
          AND (NEW.sample_id IS NULL OR o2.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id)))
          AND o2.applicability='applicable' AND o2.execution='completed' AND o2.verdict='undetermined' GROUP BY 1) r), '{}'::jsonb) AS by_reason
    INTO recount
    FROM public.assessment_basis_criteria k
    LEFT JOIN public.assessment_opportunities o ON (o.organisation_id,o.client_id,o.engagement_id,o.population_id,o.criterion_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id,k.criterion_id)
      AND (NEW.sample_id IS NULL OR o.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id)))
    WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id,k.ordinal)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id,position_in_basis)
    GROUP BY k.criterion_id;
   -- IS DISTINCT FROM: a missing or non-numeric count is refused, never
   -- compared to NULL (which would let it pass).
   IF entry->>'criterion_id' IS DISTINCT FROM recount.criterion_id
      OR jsonb_typeof(entry->'applicable') IS DISTINCT FROM 'number' OR (entry->>'applicable')::bigint IS DISTINCT FROM recount.applicable
      OR jsonb_typeof(entry->'not_applicable') IS DISTINCT FROM 'number' OR (entry->>'not_applicable')::bigint IS DISTINCT FROM recount.not_applicable
      OR jsonb_typeof(entry->'applicability_unknown') IS DISTINCT FROM 'number' OR (entry->>'applicability_unknown')::bigint IS DISTINCT FROM subjects - recount.applicable - recount.not_applicable
      OR jsonb_typeof(entry->'met') IS DISTINCT FROM 'number' OR (entry->>'met')::bigint IS DISTINCT FROM recount.met
      OR jsonb_typeof(entry->'not_met') IS DISTINCT FROM 'number' OR (entry->>'not_met')::bigint IS DISTINCT FROM recount.not_met
      OR jsonb_typeof(entry->'undetermined') IS DISTINCT FROM 'number' OR (entry->>'undetermined')::bigint IS DISTINCT FROM recount.undetermined
      OR jsonb_typeof(entry->'execution_failed') IS DISTINCT FROM 'number' OR (entry->>'execution_failed')::bigint IS DISTINCT FROM recount.execution_failed
      OR jsonb_typeof(entry->'not_evaluated') IS DISTINCT FROM 'number' OR (entry->>'not_evaluated')::bigint IS DISTINCT FROM recount.not_evaluated
      OR jsonb_typeof(entry->'met_unreviewed') IS DISTINCT FROM 'number' OR (entry->>'met_unreviewed')::bigint IS DISTINCT FROM recount.met_unreviewed
      OR entry->'undetermined_by_reason' IS DISTINCT FROM recount.by_reason THEN
    RAISE EXCEPTION 'a summary count is not the stored count: criterion %', recount.criterion_id USING ERRCODE='23514';
   END IF;
   unreviewed := unreviewed + recount.met_unreviewed;
  END LOOP;
  -- The subject partitioned, one grain: failing (any not met), else unresolved
  -- (any unknown, undetermined, failed, not evaluated, or a criterion with no
  -- opportunity), else meets every applicable, else not applicable to any.
  -- Opportunities are grouped by their member (an opportunity exists only
  -- for an in-scope member, by its guard, and one member is one subject); a
  -- subject with no opportunity at all is unresolved. Grouping the stored
  -- opportunities alone keeps this one scan, whatever the planner knows.
  SELECT count(*) FILTER (WHERE f) AS failing,
    count(*) FILTER (WHERE NOT f AND u) + (subjects - count(*)) AS unresolved,
    count(*) FILTER (WHERE NOT f AND NOT u AND m) AS meets,
    count(*) FILTER (WHERE NOT f AND NOT u AND NOT m) AS not_applicable,
    coalesce(sum(n_not_met),0) AS failing_opportunities
   INTO partitioned FROM (
    SELECT o.member_ordinal,
      bool_or(o.verdict IS NOT DISTINCT FROM 'not_met') AS f,
      bool_or(o.execution='failed' OR o.applicability='unknown' OR (o.applicability='applicable' AND o.verdict IS DISTINCT FROM 'met' AND o.verdict IS DISTINCT FROM 'not_met'))
        OR count(*) < criteria AS u,
      bool_or(o.verdict IS NOT DISTINCT FROM 'met') AS m,
      count(*) FILTER (WHERE o.verdict='not_met') AS n_not_met
    FROM public.assessment_opportunities o
    WHERE (o.organisation_id,o.client_id,o.engagement_id,o.population_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id)
      AND (NEW.sample_id IS NULL OR o.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id)))
    GROUP BY o.member_ordinal) s;
  IF partitioned.failing IS DISTINCT FROM NEW.failing_subjects THEN RAISE EXCEPTION 'a summary count is not the stored count: failing_subjects' USING ERRCODE='23514'; END IF;
  IF partitioned.unresolved IS DISTINCT FROM NEW.unresolved_subjects THEN RAISE EXCEPTION 'a summary count is not the stored count: unresolved_subjects' USING ERRCODE='23514'; END IF;
  IF partitioned.meets IS DISTINCT FROM NEW.meets_every_applicable THEN RAISE EXCEPTION 'a summary count is not the stored count: meets_every_applicable' USING ERRCODE='23514'; END IF;
  IF partitioned.not_applicable IS DISTINCT FROM NEW.not_applicable_to_any THEN RAISE EXCEPTION 'a summary count is not the stored count: not_applicable_to_any' USING ERRCODE='23514'; END IF;
  IF partitioned.failing_opportunities IS DISTINCT FROM NEW.failing_opportunities THEN RAISE EXCEPTION 'a summary count is not the stored count: failing_opportunities' USING ERRCODE='23514'; END IF;
  -- The closed conclusion its counts allow. A sample never concludes that
  -- the population has no exception; scope-unknown subjects and rows with no
  -- usable key are unresolved; a met that is an unreviewed model proposal
  -- never proves that no exception exists.
  unresolved := NEW.unresolved_subjects + CASE WHEN NEW.sample_id IS NULL THEN NEW.scope_unknown_period_unparsed + NEW.scope_unknown_period_missing + NEW.scope_unknown_conflicting_duplicate + NEW.unkeyed ELSE 0 END;
  expected := CASE
   WHEN NEW.completeness <> 'complete' AND NEW.received_rows = 0 THEN 'no_items_found_absence_not_proven'
   WHEN NEW.failing_subjects > 0 THEN CASE WHEN unresolved > 0 OR NEW.completeness <> 'complete' THEN 'exceptions_found_inconclusive' ELSE 'exceptions_found' END
   WHEN NEW.completeness = 'complete' AND unresolved = 0 AND NEW.meets_every_applicable = 0 THEN 'no_eligible_items'
   WHEN NEW.completeness = 'complete' AND NEW.sample_id IS NULL AND unresolved = 0 AND unreviewed = 0 THEN 'no_exception_found'
   ELSE 'inconclusive' END;
  IF NEW.conclusion IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'a summary concludes only what its counts allow: %', expected USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $body$;
DO $guard$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['assessment_populations','assessment_samples','assessment_summaries'] LOOP
  EXECUTE format('CREATE TRIGGER coverage_guard BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.coverage_guard()',relation);
 END LOOP;
END $guard$;
-- Members, selected items and opportunities arrive in batches of up to a
-- thousand rows: their guard is one set-based check per statement over the
-- statement's new rows, so its cost does not grow by a query per row.
CREATE FUNCTION public.coverage_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_TABLE_NAME='assessment_population_members' THEN
  IF EXISTS(SELECT 1 FROM added a LEFT JOIN public.assessment_populations p
       ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(a.organisation_id,a.client_id,a.engagement_id,a.population_id)
     WHERE p.id IS NULL OR p.task_id <> a.task_id OR p.actor_id <> a.actor_id OR a.ordinal >= p.received_rows) THEN
   RAISE EXCEPTION 'a member is a received row of a population of its own Task' USING ERRCODE='23514';
  END IF;
  IF EXISTS(WITH m AS MATERIALIZED (SELECT x.population_id, x.ordinal, x.subject, x.disposition, x.reason FROM public.assessment_population_members x
       WHERE (x.organisation_id,x.client_id,x.engagement_id) IN (SELECT DISTINCT organisation_id,client_id,engagement_id FROM added)
         AND x.population_id IN (SELECT DISTINCT population_id FROM added))
     SELECT 1 FROM added a LEFT JOIN m ON (m.population_id,m.ordinal)=(a.population_id,a.duplicate_of)
     WHERE a.duplicate_of IS NOT NULL AND (m.ordinal IS NULL OR m.subject IS DISTINCT FROM a.subject
       OR m.disposition NOT IN ('in_scope','excluded','scope_unknown') OR m.reason IS NOT DISTINCT FROM 'conflicting_duplicate')) THEN
   RAISE EXCEPTION 'a duplicate row collapses into the first row of its subject' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='assessment_sample_members' THEN
  IF EXISTS(WITH s AS MATERIALIZED (SELECT y.id, y.task_id, y.actor_id, y.size, y.population_id FROM public.assessment_samples y
       WHERE (y.organisation_id,y.client_id,y.engagement_id) IN (SELECT DISTINCT organisation_id,client_id,engagement_id FROM added)
         AND y.id IN (SELECT DISTINCT sample_id FROM added)),
     m AS MATERIALIZED (SELECT x.population_id, x.ordinal, x.subject, x.disposition FROM public.assessment_population_members x
       WHERE (x.organisation_id,x.client_id,x.engagement_id) IN (SELECT DISTINCT organisation_id,client_id,engagement_id FROM added)
         AND x.population_id IN (SELECT population_id FROM s))
     SELECT 1 FROM added a
     LEFT JOIN s ON s.id=a.sample_id
     LEFT JOIN m ON (m.population_id,m.ordinal)=(s.population_id,a.member_ordinal)
     WHERE s.id IS NULL OR s.task_id <> a.task_id OR s.actor_id <> a.actor_id OR a.ordinal >= s.size
       OR m.ordinal IS NULL OR m.subject IS DISTINCT FROM a.subject OR m.disposition <> 'in_scope') THEN
   RAISE EXCEPTION 'a selected item is an in-scope member of the sampled population' USING ERRCODE='23514';
  END IF;
 ELSE
  -- Serialised with the summaries of the same population (the summary
  -- guard takes the same lock): once a population is summarised its
  -- opportunities are complete, and a stored summary always recounts true.
  PERFORM pg_advisory_xact_lock(hashtextextended('coverage:'||x.population_id,0))
   FROM (SELECT population_id FROM added GROUP BY population_id ORDER BY population_id COLLATE "C") x;
  IF EXISTS(SELECT 1 FROM public.assessment_summaries s
     WHERE (s.organisation_id,s.client_id,s.engagement_id) IN (SELECT DISTINCT organisation_id,client_id,engagement_id FROM added)
       AND s.population_id IN (SELECT DISTINCT population_id FROM added)) THEN
   RAISE EXCEPTION 'a summarised population takes no further opportunities' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM added a
     LEFT JOIN public.assessment_populations p ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(a.organisation_id,a.client_id,a.engagement_id,a.population_id)
     LEFT JOIN public.assessment_criteria c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(a.organisation_id,a.client_id,a.engagement_id,a.criterion_id)
     LEFT JOIN public.model_invocations i ON (i.organisation_id,i.client_id,i.engagement_id,i.id)=(a.organisation_id,a.client_id,a.engagement_id,a.invocation_id)
     LEFT JOIN public.assessment_basis_criteria k ON (k.organisation_id,k.client_id,k.engagement_id,k.basis_id,k.criterion_id)=(a.organisation_id,a.client_id,a.engagement_id,p.basis_id,a.criterion_id)
     WHERE p.id IS NULL OR c.id IS NULL OR p.task_id <> a.task_id OR c.task_id <> a.task_id
       OR i.id IS NULL OR i.task_id <> a.task_id OR i.actor_id <> a.actor_id OR k.criterion_id IS NULL) THEN
   RAISE EXCEPTION 'an opportunity reads a criterion of its population''s basis in its own Task' USING ERRCODE='23514';
  END IF;
  -- Each RLS-protected table is read once per statement (a materialised
  -- scan), never once per new row, whatever the planner knows of it.
  IF EXISTS(WITH m AS MATERIALIZED (SELECT x.population_id, x.ordinal, x.subject, x.disposition, x.digest FROM public.assessment_population_members x
       WHERE (x.organisation_id,x.client_id,x.engagement_id) IN (SELECT DISTINCT organisation_id,client_id,engagement_id FROM added)
         AND x.population_id IN (SELECT DISTINCT population_id FROM added))
     SELECT 1 FROM added a LEFT JOIN m ON (m.population_id,m.ordinal)=(a.population_id,a.member_ordinal)
     WHERE m.disposition IS DISTINCT FROM 'in_scope' OR m.subject IS DISTINCT FROM a.subject) THEN
   RAISE EXCEPTION 'an opportunity is one in-scope member of its population' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM added a JOIN public.assessment_criteria c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(a.organisation_id,a.client_id,a.engagement_id,a.criterion_id)
     WHERE a.verdict IN ('met','not_met') AND NOT c.authority_verified) THEN
   RAISE EXCEPTION 'an unverified authority cannot yield met or not_met' USING ERRCODE='23514';
  END IF;
  -- A rule is decided only by trusted code over the member's own cells; a
  -- judgment criterion's verdict is only its recorded 24.1 judgment.
  IF EXISTS(SELECT 1 FROM added a JOIN public.assessment_criteria c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(a.organisation_id,a.client_id,a.engagement_id,a.criterion_id)
     WHERE a.origin='deterministic' AND c.kind='judgment' AND a.verdict IN ('met','not_met')) THEN
   RAISE EXCEPTION 'a judgment criterion is decided only by its recorded judgment' USING ERRCODE='23514';
  END IF;
  IF EXISTS(WITH m AS MATERIALIZED (SELECT x.population_id, x.ordinal, x.subject, x.disposition, x.digest FROM public.assessment_population_members x
       WHERE (x.organisation_id,x.client_id,x.engagement_id) IN (SELECT DISTINCT organisation_id,client_id,engagement_id FROM added)
         AND x.population_id IN (SELECT DISTINCT population_id FROM added))
     SELECT 1 FROM added a
     JOIN m ON (m.population_id,m.ordinal)=(a.population_id,a.member_ordinal)
     CROSS JOIN LATERAL jsonb_array_elements(a.inputs) AS entry(value)
     WHERE a.origin='deterministic'
       AND NOT (entry.value->>'id' LIKE a.population_id||'#'||a.member_ordinal||'/%' AND entry.value->>'digest' = m.digest)) THEN
   RAISE EXCEPTION 'a rule opportunity reads only its member''s own cells' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM added a
     LEFT JOIN public.assessment_populations p ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(a.organisation_id,a.client_id,a.engagement_id,a.population_id)
     LEFT JOIN public.assessment_criteria c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(a.organisation_id,a.client_id,a.engagement_id,a.criterion_id)
     LEFT JOIN public.assessment_evaluations e ON (e.organisation_id,e.client_id,e.engagement_id,e.id)=(a.organisation_id,a.client_id,a.engagement_id,a.evaluation_id)
     WHERE a.origin <> 'deterministic' AND (c.kind IS DISTINCT FROM 'judgment' OR e.id IS NULL OR e.basis_id <> p.basis_id OR e.criterion_id <> a.criterion_id
      OR e.subject <> a.subject OR e.origin <> 'model_proposal' OR e.output_digest <> a.output_digest
      OR e.applicability <> a.applicability OR e.execution <> a.execution
      OR e.verdict IS DISTINCT FROM a.verdict OR e.reason IS DISTINCT FROM a.reason
      OR e.document->'inputs' <> a.inputs)) THEN
   RAISE EXCEPTION 'a judgment opportunity is its criterion''s recorded judgment for this subject' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM added a WHERE a.verdict IN ('met','not_met') AND jsonb_array_length(a.inputs) = 0) THEN
   RAISE EXCEPTION 'a decided verdict reads its facts' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $body$;
DO $batch$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['assessment_population_members','assessment_sample_members','assessment_opportunities'] LOOP
  EXECUTE format('CREATE TRIGGER coverage_batch AFTER INSERT ON public.%I REFERENCING NEW TABLE AS added FOR EACH STATEMENT EXECUTE FUNCTION public.coverage_batch()',relation);
 END LOOP;
END $batch$;
-- At commit, a population holds exactly its counted members and a sample
-- exactly its selected items.
CREATE FUNCTION public.coverage_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE recount record;
BEGIN
 IF TG_TABLE_NAME='assessment_populations' THEN
  SELECT count(*) AS received_rows,
    count(*) FILTER (WHERE m.disposition='unkeyed') AS unkeyed,
    count(*) FILTER (WHERE m.disposition='duplicate_row') AS duplicate_rows,
    count(DISTINCT m.subject) AS distinct_subjects,
    count(*) FILTER (WHERE m.disposition='excluded') AS excluded_out_of_period,
    count(*) FILTER (WHERE m.reason='period_unparsed') AS period_unparsed,
    count(*) FILTER (WHERE m.reason='period_missing') AS period_missing,
    count(DISTINCT m.subject) FILTER (WHERE m.reason='conflicting_duplicate') AS conflicting,
    count(*) FILTER (WHERE m.disposition='in_scope') AS in_scope
   INTO recount FROM public.assessment_population_members m
   WHERE (m.organisation_id,m.client_id,m.engagement_id,m.population_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id);
  IF (recount.received_rows,recount.unkeyed,recount.duplicate_rows,recount.distinct_subjects,recount.excluded_out_of_period,recount.period_unparsed,recount.period_missing,recount.conflicting,recount.in_scope)
     <> (NEW.received_rows::bigint,NEW.unkeyed::bigint,NEW.duplicate_rows::bigint,NEW.distinct_subjects::bigint,NEW.excluded_out_of_period::bigint,NEW.scope_unknown_period_unparsed::bigint,NEW.scope_unknown_period_missing::bigint,NEW.scope_unknown_conflicting_duplicate::bigint,NEW.in_scope::bigint) THEN
   RAISE EXCEPTION 'a population holds exactly its counted members' USING ERRCODE='23514';
  END IF;
 ELSE
  IF (SELECT count(*) FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)) <> NEW.size THEN
   RAISE EXCEPTION 'a sample holds exactly its selected items' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $body$;
CREATE CONSTRAINT TRIGGER coverage_complete AFTER INSERT ON public.assessment_populations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.coverage_complete();
CREATE CONSTRAINT TRIGGER coverage_complete AFTER INSERT ON public.assessment_samples DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.coverage_complete();
-- Every coverage record is an immutable, retained fact, even for the owner:
-- no UPDATE, DELETE or TRUNCATE. The one exception is an explicit disposable
-- fixture reset (a session setting) in a database named *_test.
CREATE FUNCTION public.coverage_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_OP='DELETE' AND pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'coverage records are immutable' USING ERRCODE='23514';
END $body$;
CREATE FUNCTION public.coverage_retained() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN NULL;
 END IF;
 RAISE EXCEPTION 'coverage records are retained' USING ERRCODE='23514';
END $body$;
DO $immutable$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['assessment_populations','assessment_population_members','assessment_samples','assessment_sample_members','assessment_opportunities','assessment_summaries'] LOOP
  EXECUTE format('CREATE TRIGGER coverage_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.coverage_immutable()',relation);
  EXECUTE format('CREATE TRIGGER coverage_retained BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.coverage_retained()',relation);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT USING (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)))',relation,relation,relation,relation);
  EXECUTE format('CREATE POLICY scoped_insert ON public.%I FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)) AND actor_id=pg_catalog.current_setting(''zobba.actor_id'',true))',relation,relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $immutable$;
REVOKE ALL ON FUNCTION public.coverage_guard(),public.coverage_batch(),public.coverage_complete(),public.coverage_immutable(),public.coverage_retained() FROM PUBLIC;

-- Story 24.2 extends the trusted document program with its enumerate mode:
-- the document environment admits it (and the Story 22.5 program it extends).
CREATE OR REPLACE FUNCTION public.reading_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE render public.document_renders%ROWTYPE; earlier integer; program bytea; pread public.task_page_reads%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='analysis_jobs' THEN
  -- Only the exact trusted document program (pinned by the SHA-256 and length
  -- of its server-owned text, called once over one JSON string literal) runs
  -- in the document environment, the one whose outputs may be page images.
  IF NEW.environment_id='document-python-3-13' THEN
   program := convert_to(NEW.program,'UTF8');
   -- Story 24.2: the trusted program (with its enumerate mode), or the Story
   -- 22.5 program it extends (a job admitted by an earlier release).
   IF NOT ((octet_length(program) > 25140
        AND encode(sha256(substring(program FROM 1 FOR 25140)),'hex') = '235ceba4f29bcf6ad48d7f8c860937333356bf0eb0b0ecc6a43a8261e9ba008f'
        AND convert_from(substring(program FROM 25140+1),'UTF8') ~ '^\nimport json as _zobba_json\nmain\(_zobba_json\.loads\("([A-Za-z0-9 _:.,{}\[\]-]|\\u[0-9a-f]{4}|\\U[0-9a-f]{8})*"\)\)\n$')
      OR (octet_length(program) > 19327
        AND encode(sha256(substring(program FROM 1 FOR 19327)),'hex') = '8abd34b8ef01866706cb18717a95ace272cedf55ce675cb0d7796553983ca849'
        AND convert_from(substring(program FROM 19327+1),'UTF8') ~ '^\nimport json as _zobba_json\nmain\(_zobba_json\.loads\("([A-Za-z0-9 _:.,{}\[\]-]|\\u[0-9a-f]{4}|\\U[0-9a-f]{8})*"\)\)\n$')) THEN
    RAISE EXCEPTION 'only the trusted document program runs in the document environment' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='document_renders' THEN
  -- A render is the fact of a collected job over exactly this original.
  -- The job ran exactly the trusted document program (its pinned SHA-256
  -- prefix, as admitted to the document environment).
  IF NOT EXISTS(SELECT 1 FROM public.analysis_jobs j JOIN public.analysis_job_events e ON e.job_id=j.id AND e.status='collected'
     WHERE j.id=NEW.job_id AND j.environment_id='document-python-3-13'
       AND ((octet_length(convert_to(j.program,'UTF8')) > 25140
         AND encode(sha256(substring(convert_to(j.program,'UTF8') FROM 1 FOR 25140)),'hex')='235ceba4f29bcf6ad48d7f8c860937333356bf0eb0b0ecc6a43a8261e9ba008f')
        OR (octet_length(convert_to(j.program,'UTF8')) > 19327
         AND encode(sha256(substring(convert_to(j.program,'UTF8') FROM 1 FOR 19327)),'hex')='8abd34b8ef01866706cb18717a95ace272cedf55ce675cb0d7796553983ca849'))
       AND j.program_sha256=encode(sha256(convert_to(j.program,'UTF8')),'hex')
       AND j.inputs=jsonb_build_array(jsonb_build_object('original_id',NEW.original_id,'digest',NEW.original_sha256))) THEN
   RAISE EXCEPTION 'a render names a collected job over its exact original' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.evidence_originals o WHERE o.id=NEW.original_id AND o.digest=NEW.original_sha256) THEN
   RAISE EXCEPTION 'a render names a registered original by its digest' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='document_pages' THEN
  SELECT * INTO render FROM public.document_renders r WHERE (r.organisation_id,r.client_id,r.engagement_id,r.original_id,r.original_sha256,r.batch)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.original_id,NEW.original_sha256,NEW.batch);
  IF render.status <> 'rendered' OR NEW.page > render.page_count THEN
   RAISE EXCEPTION 'a rendered page exists in its rendered document' USING ERRCODE='23514';
  END IF;
  IF NEW.image_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.analysis_descendants d WHERE d.id=NEW.image_id AND d.job_id=render.job_id
     AND d.digest=NEW.image_sha256 AND d.size=NEW.image_size AND d.media_type=NEW.image_media_type) THEN
   RAISE EXCEPTION 'a page image is a validated descendant of its render job' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='task_page_reads' THEN
  SELECT count(*) INTO earlier FROM public.task_page_reads r WHERE (r.organisation_id,r.client_id,r.engagement_id,r.task_id,r.original_id,r.original_sha256,r.page)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id,NEW.original_id,NEW.original_sha256,NEW.page);
  IF NEW.attempt <> earlier+1 THEN
   RAISE EXCEPTION 'page read attempts are appended in sequence' USING ERRCODE='23514';
  END IF;
  -- At most 200 distinct pages of one document are disclosed per Task. The
  -- lock serialises concurrent reads of different pages of that document.
  IF NEW.invocation_id IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('pages:'||NEW.task_id||':'||NEW.original_id,0));
   IF NOT EXISTS(SELECT 1 FROM public.task_page_reads r WHERE r.task_id=NEW.task_id AND r.original_id=NEW.original_id AND r.page=NEW.page AND r.invocation_id IS NOT NULL)
      AND (SELECT count(DISTINCT r.page) FROM public.task_page_reads r WHERE r.task_id=NEW.task_id AND r.original_id=NEW.original_id AND r.invocation_id IS NOT NULL) >= 200 THEN
    RAISE EXCEPTION 'at most 200 pages of a document are read per Task' USING ERRCODE='23514';
   END IF;
  END IF;
  IF NEW.image_sha256 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.document_pages p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.original_id,p.original_sha256,p.page)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.original_id,NEW.original_sha256,NEW.page) AND p.image_sha256=NEW.image_sha256) THEN
   RAISE EXCEPTION 'a page read sends the rendered page image' USING ERRCODE='23514';
  END IF;
  -- The read's invocation is of this Task and its one disclosure covers exactly
  -- this page image digest as its own attachment.
  IF NEW.invocation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.model_invocations i
     WHERE i.id=NEW.invocation_id AND i.task_id=NEW.task_id AND i.actor_id=NEW.actor_id
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(i.request->'disclosure'->'attachments') a WHERE a->>'id'='page-image' AND a->>'digest'=NEW.image_sha256)) THEN
   RAISE EXCEPTION 'a page read is bound to its disclosure invocation' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='task_page_requests' THEN
  IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE i.id=NEW.invocation_id AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id) THEN
   RAISE EXCEPTION 'a page request belongs to its answer invocation' USING ERRCODE='23514';
  END IF;
  IF NEW.read_sha256 IS NOT NULL THEN
   SELECT * INTO pread FROM public.task_page_reads r WHERE (r.organisation_id,r.client_id,r.engagement_id,r.task_id,r.original_id,r.original_sha256,r.page,r.attempt)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id,NEW.original_id,NEW.read_sha256,NEW.page,NEW.read_attempt);
   IF (NEW.outcome IN ('read','reused') AND pread.status <> 'read')
      OR (NEW.outcome='failed' AND (pread.status <> 'failed' OR pread.reason IS DISTINCT FROM NEW.reason)) THEN
    RAISE EXCEPTION 'a page request names the read it produced' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='task_program_runs' THEN
  IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE i.id=NEW.invocation_id AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id) THEN
   RAISE EXCEPTION 'a program run belongs to its answer invocation' USING ERRCODE='23514';
  END IF;
  -- A run names a general job of this Task that ended: collected when the
  -- run completed, failed or over a limit when it failed.
  IF NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.analysis_jobs j JOIN public.analysis_job_events e ON e.job_id=j.id
       AND e.status = ANY(CASE NEW.status WHEN 'completed' THEN ARRAY['collected'] ELSE ARRAY['collected','failed','limit_exceeded'] END)
     WHERE j.id=NEW.job_id AND j.task_id=NEW.task_id AND j.environment_id<>'document-python-3-13') THEN
   RAISE EXCEPTION 'a program run names a collected job of its Task' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='answer_verifications' THEN
  IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE i.id=NEW.invocation_id AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id)
   OR NEW.citations <> (SELECT count(*) FROM public.answer_citations c WHERE c.invocation_id=NEW.invocation_id)
   OR NEW.sources <> (SELECT count(*) FROM public.citation_sources s WHERE s.invocation_id=NEW.invocation_id) THEN
   RAISE EXCEPTION 'an answer verification matches its recorded citations' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME IN ('answer_citations','citation_sources') THEN
  IF EXISTS(SELECT 1 FROM public.answer_verifications v WHERE v.invocation_id=NEW.invocation_id) THEN
   RAISE EXCEPTION 'a recorded answer verification is complete' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $body$;

REVOKE ALL ON FUNCTION public.reading_guard() FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=19) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=19;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
