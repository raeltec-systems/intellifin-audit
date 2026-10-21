-- Story 24.3b: Task-scoped exceptions and the effective summary. Additive:
-- published schemas 1-20 are unchanged. Every deterministic or judged
-- not_met result (a 24.1 evaluation, a 24.3a revision, a 24.2 rule
-- opportunity, or a person's `replaced not_met` disposition) adds one
-- immutable occurrence to the exception of its criterion lineage and
-- subject, written by trusted code in the same statement that records the
-- result. A judgment's population opportunity names a recorded judgment,
-- whose own record is the occurrence, so it adds none. An exception's status
-- is never stored: `assessment_exception_statuses` derives it, set-based,
-- from the occurrences, the current observations of its lineage and subject,
-- and the exception dispositions an Audit manager or the Task's accountable
-- person saved; trusted Rust code derives the same status for every listed
-- exception and refuses a disagreement. Occurrences and dispositions of one
-- Task are serialised on one Task lock and ordered by their `seq`, never by
-- clock time. An effective summary is the 24.2 partition over the current
-- revisions and dispositions (`assessment_effective_outcomes`), with the
-- exceptions of its own subjects by derived status; the database recounts
-- every number and refuses a summary that disagrees. No waiver, no
-- confidence column, no percentage. `*_us` columns are database time in
-- microseconds.

-- ------------------------------------------------------------ helpers
-- Read-only, SECURITY INVOKER helpers: each reads only what the caller's
-- own scope (forced RLS) shows, so the runtime may call them.

-- The root of a criterion version's lineage, walked to its end (a version
-- proposed since 24.3a has at most 64 earlier versions; an older, deeper
-- lineage still reaches its true root). NULL for an unknown ID.
CREATE FUNCTION public.assessment_criterion_root(org text, client text, engagement text, criterion text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 WITH RECURSIVE walk(id, up, hops) AS (
   SELECT c.id, c.supersedes, 0 FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(org,client,engagement,criterion)
   UNION ALL
   SELECT c.id, c.supersedes, w.hops+1 FROM walk w JOIN public.assessment_criteria c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(org,client,engagement,w.up) WHERE w.hops < 100000)
 SELECT w.id FROM walk w WHERE w.up IS NULL
$body$;

-- The lineage root of every criterion version of one Task, in one pass.
CREATE FUNCTION public.assessment_task_criterion_roots(org text, client text, engagement text, task text)
RETURNS TABLE(criterion_id text, root text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 WITH RECURSIVE walk(criterion_id, id, up, hops) AS (
   SELECT c.id, c.id, c.supersedes, 0 FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.task_id)=(org,client,engagement,task)
   UNION ALL
   SELECT w.criterion_id, c.id, c.supersedes, w.hops+1 FROM walk w JOIN public.assessment_criteria c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(org,client,engagement,w.up) WHERE w.hops < 100000)
 SELECT w.criterion_id, w.id FROM walk w WHERE w.up IS NULL
$body$;

-- Every population version of one Task with its lineage root, its creation
-- time and whether it is a latest version (no version supersedes it).
CREATE FUNCTION public.assessment_task_population_roots(org text, client text, engagement text, task text)
RETURNS TABLE(population_id text, root text, tip boolean, created_us bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 WITH RECURSIVE p AS (SELECT p.id, p.supersedes, p.created_us FROM public.assessment_populations p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.task_id)=(org,client,engagement,task)),
  walk(population_id, id, up, hops) AS (
   SELECT p.id, p.id, p.supersedes, 0 FROM p
   UNION ALL
   SELECT w.population_id, q.id, q.supersedes, w.hops+1 FROM walk w JOIN public.assessment_populations q ON (q.organisation_id,q.client_id,q.engagement_id,q.id)=(org,client,engagement,w.up) WHERE w.hops < 100000)
 SELECT w.population_id, w.id, NOT EXISTS(SELECT 1 FROM p s WHERE s.supersedes=w.population_id), (SELECT p.created_us FROM p WHERE p.id=w.population_id)
 FROM walk w WHERE w.up IS NULL
$body$;

-- The exception ID of a criterion lineage and a subject in one Task. Every
-- part but the subject is a scope ID (no `|`), and the subject is last.
CREATE FUNCTION public.assessment_exception_key(org text, client text, engagement text, task text, root text, subject text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 SELECT 'exc-' || pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('exc|'||org||'|'||client||'|'||engagement||'|'||task||'|'||root||'|criterion_not_met|'||subject,'UTF8')),'hex'),40)
$body$;

-- The evidence an outcome read: its input digests, sorted and distinct.
CREATE FUNCTION public.assessment_evidence(inputs jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 SELECT coalesce((SELECT pg_catalog.array_agg(DISTINCT (x.value->>'digest') COLLATE "C" ORDER BY (x.value->>'digest') COLLATE "C")
   FROM pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(inputs)='array' THEN inputs ELSE '[]'::jsonb END) x), ARRAY[]::text[])
$body$;

-- Indexes the set-based status derivation reads by (additive; the
-- published tables themselves are unchanged).
CREATE INDEX assessment_evaluations_subject ON public.assessment_evaluations(organisation_id,client_id,engagement_id,task_id,subject COLLATE "C");
CREATE INDEX assessment_populations_supersedes ON public.assessment_populations(organisation_id,client_id,engagement_id,supersedes);
CREATE INDEX assessment_criteria_supersedes ON public.assessment_criteria(organisation_id,client_id,engagement_id,supersedes);

-- A new population version is the only successor of the version it
-- supersedes and has at most 64 earlier versions (the 24.3a rule for
-- criteria and bases), so a lineage has one latest version. Versions
-- recorded before Story 24.3b are never refused by this.
CREATE FUNCTION public.population_succession() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE walker text; hops integer := 0;
BEGIN
 IF NEW.supersedes IS NOT NULL THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('successor:'||NEW.organisation_id||'/'||NEW.client_id||'/'||NEW.engagement_id||'/'||NEW.supersedes, 2402));
  IF EXISTS(SELECT 1 FROM public.assessment_populations p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.supersedes)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.supersedes)) THEN
   RAISE EXCEPTION 'a population version has at most one successor' USING ERRCODE='23514';
  END IF;
  walker := NEW.supersedes;
  LOOP
   SELECT p.supersedes INTO walker FROM public.assessment_populations p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,walker);
   EXIT WHEN walker IS NULL;
   hops := hops + 1;
   IF hops >= 64 THEN
    RAISE EXCEPTION 'a population lineage holds at most 64 earlier versions' USING ERRCODE='23514';
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER population_succession BEFORE INSERT ON public.assessment_populations FOR EACH ROW EXECUTE FUNCTION public.population_succession();
-- ------------------------------------------------------------- tables

-- One exception: the Task, the criterion lineage root and the subject.
CREATE TABLE public.assessment_exceptions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 id text NOT NULL CHECK(id ~ '^exc-[0-9a-f]{40}$'),
 kind text NOT NULL CHECK(kind = 'criterion_not_met'),
 criterion_root text NOT NULL,
 subject text NOT NULL CHECK(octet_length(subject) BETWEEN 1 AND 128 AND btrim(subject) <> '' AND subject !~ '[\x01-\x1f\x7f-\x9f]'),
 first_source_kind text NOT NULL CHECK(first_source_kind IN ('evaluation','revision','opportunity','disposition')),
 first_source_id text NOT NULL CHECK(octet_length(first_source_id) BETWEEN 1 AND 300),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,task_id,criterion_root,subject,kind),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,criterion_root) REFERENCES public.assessment_criteria(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_exceptions_task ON public.assessment_exceptions(organisation_id,client_id,engagement_id,task_id,criterion_root,subject COLLATE "C");

-- One not_met result of an exception, as trusted code recorded it: its
-- source record, the criterion and basis versions it was decided under,
-- its effective origin, the evidence it read, its database time and its
-- order among the exception's records.
CREATE TABLE public.assessment_exception_occurrences (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 exception_id text NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('evaluation','revision','opportunity','disposition')),
 source_id text NOT NULL CHECK(octet_length(source_id) BETWEEN 1 AND 300),
 population_id text,
 member_ordinal integer,
 criterion_id text NOT NULL,
 basis_id text NOT NULL,
 origin text NOT NULL CHECK(origin IN ('deterministic','model_proposal','human')),
 evidence text[] NOT NULL CHECK(cardinality(evidence) <= 32 AND array_position(evidence, NULL) IS NULL),
 source_us bigint NOT NULL,
 -- Its place among its exception's occurrences and dispositions, assigned
 -- under the Task's exception lock: commit order, never clock time.
 seq integer NOT NULL CHECK(seq >= 1),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((source_kind = 'opportunity') = (population_id IS NOT NULL) AND (population_id IS NULL) = (member_ordinal IS NULL)),
 CHECK((source_kind = 'disposition') = (origin = 'human')),
 PRIMARY KEY(organisation_id,client_id,engagement_id,exception_id,source_kind,source_id),
 UNIQUE(organisation_id,client_id,engagement_id,exception_id,seq),
 FOREIGN KEY(organisation_id,client_id,engagement_id,exception_id) REFERENCES public.assessment_exceptions(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_exception_occurrences_task ON public.assessment_exception_occurrences(organisation_id,client_id,engagement_id,task_id,exception_id);

-- A person's disposition of one exception: closed (with evidence) or
-- reopened. It never changes an occurrence, a revision or a verdict, and a
-- failing count never drops because of it.
CREATE TABLE public.assessment_exception_dispositions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 id text NOT NULL CHECK(id ~ '^xdisp-[0-9a-f]{40}$'),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 exception_id text NOT NULL CHECK(exception_id ~ '^exc-[0-9a-f]{40}$'),
 kind text NOT NULL CHECK(kind IN ('closed','reopened')),
 rationale text NOT NULL CHECK(octet_length(rationale) BETWEEN 1 AND 2000 AND btrim(rationale, E' \n\r\t') <> '' AND rationale !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]'),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 65536),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 -- Assigned by the guard under the Task's exception lock (any supplied
 -- value is replaced): its order among the exception's records.
 seq integer NOT NULL CHECK(seq >= 1),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK(coalesce(document->>'record'='exception_disposition' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'actor_id'=actor_id
   AND document->>'key'=key AND document->>'exception_id'=exception_id AND document->>'kind'=kind AND document->>'rationale'=rationale
   AND jsonb_typeof(document->'references')='array' AND jsonb_array_length(document->'references') <= 8
   -- A closure cites at least one verified reference.
   AND (kind <> 'closed' OR jsonb_array_length(document->'references') >= 1), false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,actor_id,key),
 UNIQUE(organisation_id,client_id,engagement_id,exception_id,seq),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,exception_id) REFERENCES public.assessment_exceptions(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_exception_dispositions_task ON public.assessment_exception_dispositions(organisation_id,client_id,engagement_id,task_id,exception_id);

-- An effective summary version: the 24.2 partition over the current
-- revisions and dispositions, with the counts by derived status of the
-- exceptions of its own subjects (the population's in-scope subjects, or the
-- sample's selected ones) under its basis's criterion lineages. Its
-- conclusion is the 24.2 conclusion of that partition, except that it never
-- says no exception was found while one of those exceptions is open. It
-- supersedes the newest effective summary of the same population and sample.
CREATE TABLE public.assessment_effective_summaries (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 1),
 id text NOT NULL CHECK(id ~ '^esummary-[0-9a-f]{40}$'),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 basis_id text NOT NULL,
 population_id text NOT NULL,
 sample_id text,
 supersedes text CHECK(supersedes ~ '^esummary-[0-9a-f]{40}$'),
 aggregation text NOT NULL CHECK(aggregation = 'effective_partition_v1'),
 conclusion text NOT NULL CHECK(conclusion IN ('no_eligible_items','exceptions_found','exceptions_found_inconclusive','no_exception_found','inconclusive','no_items_found_absence_not_proven')),
 completeness text NOT NULL CHECK(completeness IN ('complete','incomplete')),
 completeness_reason text CHECK(completeness_reason IN ('not_exhaustive','row_bound','count_mismatch')),
 reconciliation text NOT NULL CHECK(reconciliation IN ('matched','mismatch','not_declared')),
 in_scope integer NOT NULL CHECK(in_scope >= 0),
 selected integer CHECK(selected >= 0),
 failing_subjects integer NOT NULL, meets_every_applicable integer NOT NULL,
 unresolved_subjects integer NOT NULL, not_applicable_to_any integer NOT NULL,
 failing_opportunities integer NOT NULL,
 human_replaced integer NOT NULL, pending_reconsideration integer NOT NULL,
 undisposed integer NOT NULL, superseded integer NOT NULL,
 exceptions_total integer NOT NULL, exceptions_open integer NOT NULL, exceptions_resolved integer NOT NULL,
 exceptions_replaced integer NOT NULL, exceptions_closed integer NOT NULL, exception_subjects integer NOT NULL,
 statistical_inference boolean NOT NULL CHECK(NOT statistical_inference),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 262144),
 summary_digest text NOT NULL CHECK(summary_digest ~ '^[0-9a-f]{64}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK(least(failing_subjects,meets_every_applicable,unresolved_subjects,not_applicable_to_any,failing_opportunities,human_replaced,pending_reconsideration,undisposed,superseded,exceptions_total,exceptions_open,exceptions_resolved,exceptions_replaced,exceptions_closed,exception_subjects) >= 0),
 CHECK((sample_id IS NULL) = (selected IS NULL)),
 CHECK((completeness='complete') = (completeness_reason IS NULL)),
 CHECK(failing_subjects + meets_every_applicable + unresolved_subjects + not_applicable_to_any = coalesce(selected, in_scope)),
 CHECK(exceptions_open + exceptions_resolved + exceptions_replaced + exceptions_closed = exceptions_total AND exception_subjects <= exceptions_total
   AND exception_subjects <= coalesce(selected, in_scope)),
 CHECK(supersedes IS DISTINCT FROM id),
 -- coalesce(..., false): a missing key makes a comparison NULL, and a CHECK
 -- that is NULL would pass.
 CHECK(coalesce(document->>'record'='effective_summary' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'cycle_id'=cycle_id
   AND document->>'invocation_id'=invocation_id AND jsonb_typeof(document->'ordinal')='number' AND (document->>'ordinal')::integer=ordinal
   AND document->>'methodology_binding_id'=methodology_binding_id AND jsonb_typeof(document->'execution_epoch')='number' AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'basis_id'=basis_id AND document->>'population_id'=population_id
   AND document ?& ARRAY['sample_id','supersedes'] AND document->>'sample_id' IS NOT DISTINCT FROM sample_id AND document->>'supersedes' IS NOT DISTINCT FROM supersedes
   AND document->>'summary_digest'=summary_digest
   AND document->'effective'->>'aggregation'=aggregation
   AND (document->'effective'->>'statistical_inference')::boolean=statistical_inference
   AND document->'effective'->>'conclusion'=conclusion
   AND document->'effective'->'summary'->>'conclusion' IN ('no_eligible_items','exceptions_found','exceptions_found_inconclusive','no_exception_found','inconclusive','no_items_found_absence_not_proven')
   AND (document->'effective'->>'conclusion' = document->'effective'->'summary'->>'conclusion'
     OR (document->'effective'->>'conclusion' = 'inconclusive' AND document->'effective'->'summary'->>'conclusion' = 'no_exception_found' AND exceptions_open > 0))
   AND document->'effective'->'summary'->>'completeness'=completeness
   AND document->'effective'->'summary' ? 'completeness_reason' AND document->'effective'->'summary'->>'completeness_reason' IS NOT DISTINCT FROM completeness_reason
   AND document->'effective'->'summary'->>'reconciliation'=reconciliation
   AND jsonb_typeof(document->'effective'->'summary'->'in_scope')='number' AND (document->'effective'->'summary'->>'in_scope')::integer=in_scope
   AND document->'effective'->'summary' ? 'selected' AND (document->'effective'->'summary'->>'selected')::integer IS NOT DISTINCT FROM selected
   AND jsonb_typeof(document->'effective'->'summary'->'failing')='number' AND (document->'effective'->'summary'->>'failing')::integer=failing_subjects
   AND jsonb_typeof(document->'effective'->'summary'->'meets_every_applicable')='number' AND (document->'effective'->'summary'->>'meets_every_applicable')::integer=meets_every_applicable
   AND jsonb_typeof(document->'effective'->'summary'->'unresolved')='number' AND (document->'effective'->'summary'->>'unresolved')::integer=unresolved_subjects
   AND jsonb_typeof(document->'effective'->'summary'->'not_applicable_to_any')='number' AND (document->'effective'->'summary'->>'not_applicable_to_any')::integer=not_applicable_to_any
   AND jsonb_typeof(document->'effective'->'summary'->'failing_opportunities')='number' AND (document->'effective'->'summary'->>'failing_opportunities')::integer=failing_opportunities
   AND jsonb_typeof(document->'effective'->'exceptions'->'total')='number' AND (document->'effective'->'exceptions'->>'total')::integer=exceptions_total
   AND jsonb_typeof(document->'effective'->'exceptions'->'open')='number' AND (document->'effective'->'exceptions'->>'open')::integer=exceptions_open
   AND jsonb_typeof(document->'effective'->'exceptions'->'resolved_by_evidence')='number' AND (document->'effective'->'exceptions'->>'resolved_by_evidence')::integer=exceptions_resolved
   AND jsonb_typeof(document->'effective'->'exceptions'->'replaced_by_human_judgment')='number' AND (document->'effective'->'exceptions'->>'replaced_by_human_judgment')::integer=exceptions_replaced
   AND jsonb_typeof(document->'effective'->'exceptions'->'closed_by_disposition')='number' AND (document->'effective'->'exceptions'->>'closed_by_disposition')::integer=exceptions_closed
   AND jsonb_typeof(document->'effective'->'exceptions'->'subjects')='number' AND (document->'effective'->'exceptions'->>'subjects')::integer=exception_subjects
   AND jsonb_typeof(document->'effective'->'criteria')='array' AND jsonb_array_length(document->'effective'->'criteria') BETWEEN 1 AND 16
   AND jsonb_typeof(document->'effective'->'summary'->'criteria')='array'
   AND jsonb_array_length(document->'effective'->'criteria') = jsonb_array_length(document->'effective'->'summary'->'criteria')
   AND jsonb_typeof(document->'effective'->'listed')='array' AND jsonb_array_length(document->'effective'->'listed') <= 50
   AND jsonb_typeof(document->'effective'->'limitations')='array' AND jsonb_array_length(document->'effective'->'limitations') <= 7
   AND NOT jsonb_path_exists(document->'effective'->'limitations', '$[*] ? (!(@.code == "population_incomplete" || @.code == "unresolved_subjects" || @.code == "pending_reconsideration" || @.code == "unreviewed_model_proposals" || @.code == "superseded_inputs_not_reevaluated" || @.code == "open_exceptions" || @.code == "sample_only"))')
   AND NOT jsonb_path_exists(document->'effective'->'listed', '$[*] ? (!(@.status == "open" || @.status == "resolved_by_evidence" || @.status == "replaced_by_human_judgment" || @.status == "closed_by_disposition"))')
   AND NOT jsonb_path_exists(document->'effective'->'listed', '$[*] ? (!(@.latest_observed == "not_met" || @.latest_observed == "not_observed" || @.latest_observed == "proposed_met" || @.latest_observed == "person_undetermined"))'), false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 UNIQUE(organisation_id,client_id,engagement_id,supersedes),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,basis_id) REFERENCES public.assessment_bases(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,population_id) REFERENCES public.assessment_populations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,sample_id) REFERENCES public.assessment_samples(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,supersedes) REFERENCES public.assessment_effective_summaries(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_effective_summaries_task ON public.assessment_effective_summaries(organisation_id,client_id,engagement_id,task_id,created_us);
CREATE INDEX assessment_effective_summaries_population ON public.assessment_effective_summaries(organisation_id,client_id,engagement_id,population_id,created_us);

-- --------------------------------------------------- derived functions

-- The current observations of exceptions of one Task (every exception when
-- `ids` is NULL), set-based:
-- - `chain`: every evaluation chain head of the exception's criterion
--   lineage and subject, under its newest disposition. Its time is the
--   head's own record time; only a person's `replaced` verdict, which really
--   is new, takes the disposition's time (and origin human). `review` is the
--   head's review state (`accepted` only when its newest disposition is an
--   acceptance).
-- - `opportunity`: every decided rule opportunity (no judgment named, a
--   verdict recorded) of a latest population version, at its own time. A
--   judgment's opportunity is its chain head, listed once as the chain; an
--   opportunity that decided nothing is not an observation.
-- - `absent`: the latest version of a population lineage that held one of
--   the exception's occurrences, when it no longer holds the subject in
--   scope, at that version's time.
-- `inputs` is the outcome's input list (its evidence is
-- `assessment_evidence(inputs)`).
CREATE FUNCTION public.assessment_exception_observations(org text, client text, engagement text, task text, ids text[])
RETURNS TABLE(exception_id text, kind text, id text, at_us bigint, verdict text, execution text, origin text, review text, causes text[], criterion_id text, inputs jsonb)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
 WITH x AS MATERIALIZED (SELECT x.id, x.subject, x.criterion_root FROM public.assessment_exceptions x
     WHERE (x.organisation_id,x.client_id,x.engagement_id,x.task_id)=(org,client,engagement,task)
       AND (ids IS NULL OR x.id IN (SELECT pg_catalog.unnest(ids)))),
  roots AS MATERIALIZED (SELECT r.criterion_id, r.root FROM public.assessment_task_criterion_roots(org,client,engagement,task) r),
  pops AS MATERIALIZED (SELECT p.population_id, p.root, p.tip, p.created_us FROM public.assessment_task_population_roots(org,client,engagement,task) p),
  firsts AS (
   SELECT x.id AS exception_id, e.id AS chain_id, e.created_us, e.verdict, e.execution, e.origin, e.criterion_id, e.document
   FROM x JOIN public.assessment_evaluations e ON (e.organisation_id,e.client_id,e.engagement_id,e.task_id)=(org,client,engagement,task) AND e.subject=x.subject
   JOIN roots k ON k.criterion_id=e.criterion_id AND k.root=x.criterion_root),
  heads AS (
   SELECT f.exception_id, coalesce(r.id,f.chain_id) AS head_id, coalesce(r.created_us,f.created_us) AS head_us,
     CASE WHEN r.id IS NULL THEN f.verdict ELSE r.verdict END AS verdict,
     coalesce(r.execution,f.execution) AS execution, coalesce(r.origin,f.origin) AS origin,
     coalesce(r.causes,ARRAY[]::text[]) AS causes, coalesce(r.criterion_id,f.criterion_id) AS criterion_id,
     coalesce(r.document,f.document)->'inputs' AS inputs
   FROM firsts f LEFT JOIN LATERAL (SELECT v.id,v.created_us,v.verdict,v.execution,v.origin,v.causes,v.criterion_id,v.document FROM public.assessment_evaluation_revisions v
     WHERE (v.organisation_id,v.client_id,v.engagement_id,v.chain_id)=(org,client,engagement,f.chain_id) ORDER BY v.revision DESC LIMIT 1) r ON true),
  chains AS (
   SELECT h.exception_id, 'chain'::text AS kind, h.head_id AS id,
     CASE WHEN d.kind='replaced' AND h.origin='model_proposal' THEN d.created_us ELSE h.head_us END AS at_us,
     CASE WHEN d.kind='replaced' AND h.origin='model_proposal' THEN d.verdict ELSE h.verdict END AS verdict,
     h.execution,
     CASE WHEN d.kind='replaced' AND h.origin='model_proposal' THEN 'human' ELSE h.origin END AS origin,
     CASE WHEN d.kind IS NULL THEN 'unreviewed' WHEN d.kind='replaced' AND h.origin='model_proposal' THEN 'replaced'
       WHEN d.kind='accepted' THEN 'accepted' WHEN d.kind='needs_reconsideration' THEN 'pending_reconsideration' ELSE 'unreviewed' END AS review,
     h.causes, h.criterion_id, h.inputs
   FROM heads h LEFT JOIN LATERAL (SELECT y.kind,y.verdict,y.created_us FROM public.assessment_dispositions y
     WHERE (y.organisation_id,y.client_id,y.engagement_id,y.revision_id)=(org,client,engagement,h.head_id)
     ORDER BY y.created_us DESC, y.id COLLATE "C" DESC LIMIT 1) d ON true),
  rules AS (
   SELECT x.id AS exception_id, 'opportunity'::text AS kind, o.population_id||'#'||o.criterion_id||'#'||o.member_ordinal AS id, o.created_us AS at_us,
     o.verdict, o.execution, o.origin, 'unreviewed'::text AS review, ARRAY[]::text[] AS causes, o.criterion_id, o.inputs
   FROM pops t JOIN public.assessment_opportunities o ON (o.organisation_id,o.client_id,o.engagement_id,o.population_id)=(org,client,engagement,t.population_id)
   JOIN roots k ON k.criterion_id=o.criterion_id
   JOIN x ON x.subject=o.subject AND x.criterion_root=k.root
   WHERE t.tip AND o.evaluation_id IS NULL AND o.verdict IS NOT NULL),
  absent AS (
   SELECT DISTINCT x.id AS exception_id, 'absent'::text AS kind, t.population_id AS id, t.created_us AS at_us, NULL::text AS verdict, NULL::text AS execution,
     NULL::text AS origin, 'unreviewed'::text AS review, ARRAY[]::text[] AS causes, NULL::text AS criterion_id, '[]'::jsonb AS inputs
   FROM x JOIN public.assessment_exception_occurrences y ON (y.organisation_id,y.client_id,y.engagement_id,y.exception_id)=(org,client,engagement,x.id) AND y.population_id IS NOT NULL
   JOIN pops q ON q.population_id=y.population_id
   JOIN pops t ON t.root=q.root AND t.tip
   WHERE NOT EXISTS(SELECT 1 FROM public.assessment_population_members m
     WHERE (m.organisation_id,m.client_id,m.engagement_id,m.population_id)=(org,client,engagement,t.population_id) AND m.subject=x.subject AND m.disposition='in_scope'))
 SELECT * FROM chains UNION ALL SELECT * FROM rules UNION ALL SELECT * FROM absent
$body$;

-- The status rule itself, over one exception's facts (pure; the same rule
-- as `zobba_domain::exception::exception_status`, compared case by case):
-- `closed` (its newest disposition is a closure that still stands),
-- `failing` (a current observation is not_met), its latest observation
-- (`kind` NULL when there is none) and its newest occurrence.
CREATE FUNCTION public.assessment_exception_decide(closed boolean, failing boolean, kind text, at_us bigint, verdict text, execution text, origin text,
  review text, causes text[], criterion_id text, evidence text[], occurrence_at bigint, occurrence_criterion text, occurrence_evidence text[])
RETURNS TABLE(status text, latest_observed text)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 WITH m AS (SELECT (verdict='met' AND execution='completed' AND origin IN ('deterministic','model_proposal')
      AND at_us > occurrence_at AND evidence IS DISTINCT FROM occurrence_evidence
      AND ((kind='chain' AND causes && ARRAY['inputs_changed','basis_revised']::text[])
        OR (kind='opportunity' AND criterion_id IS NOT DISTINCT FROM occurrence_criterion))) IS TRUE AS meets)
 SELECT
   CASE WHEN closed THEN 'closed_by_disposition'
     WHEN failing OR kind IS NULL THEN 'open'
     WHEN origin='human' AND verdict='met' THEN 'replaced_by_human_judgment'
     WHEN m.meets AND (origin='deterministic' OR review='accepted') THEN 'resolved_by_evidence'
     ELSE 'open' END,
   CASE WHEN failing THEN 'not_met'
     WHEN kind IS NULL THEN 'not_observed'
     WHEN origin='human' AND verdict='undetermined' THEN 'person_undetermined'
     WHEN m.meets AND origin='model_proposal' AND review IS DISTINCT FROM 'accepted' THEN 'proposed_met'
     ELSE 'not_observed' END
 FROM m
$body$;

-- The derived status of exceptions of one Task (every exception when `ids`
-- is NULL), set-based (`zobba_domain::exception::exception_status` derives
-- the same and is compared on every listed exception):
-- 1. closed_by_disposition while the newest exception disposition (by seq)
--    is a closure and no later occurrence is unseen (one whose criterion
--    version and evidence differ from every occurrence before the closure);
-- 2. open while any current observation is not_met (latest observed
--    not_met);
-- 3. replaced_by_human_judgment when the latest observation (by time, then
--    ID) is a person's `met`;
-- 4. resolved_by_evidence when it is a completed met, deterministic or an
--    accepted model proposal, newer than the newest occurrence, reading other
--    evidence, from a revision caused by changed inputs or a revised basis,
--    or a later read of the same criterion version;
-- 5. open otherwise. Latest observed is `proposed_met` when an unreviewed
--    model proposal would resolve it once accepted, `person_undetermined`
--    when the latest observation is a person's undetermined, `not_observed`
--    for anything else (undetermined, failed, not applicable, absent, none).
CREATE FUNCTION public.assessment_exception_statuses(org text, client text, engagement text, task text, ids text[])
RETURNS TABLE(id text, subject text, criterion_root text, status text, latest_observed text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
 WITH x AS MATERIALIZED (SELECT x.id, x.subject, x.criterion_root FROM public.assessment_exceptions x
     WHERE (x.organisation_id,x.client_id,x.engagement_id,x.task_id)=(org,client,engagement,task)
       AND (ids IS NULL OR x.id IN (SELECT pg_catalog.unnest(ids)))),
  ob AS MATERIALIZED (SELECT * FROM public.assessment_exception_observations(org,client,engagement,task,ids)),
  failing AS (SELECT DISTINCT o.exception_id FROM ob o WHERE o.verdict='not_met'),
  latest AS (SELECT DISTINCT ON (o.exception_id) o.exception_id, o.kind, o.at_us, o.verdict, o.execution, o.origin, o.review, o.causes, o.criterion_id, o.inputs
    FROM ob o ORDER BY o.exception_id, o.at_us DESC, o.id COLLATE "C" DESC),
  occ AS (SELECT DISTINCT ON (y.exception_id) y.exception_id, y.source_us, y.criterion_id, y.evidence
    FROM public.assessment_exception_occurrences y JOIN x ON (y.organisation_id,y.client_id,y.engagement_id,y.task_id,y.exception_id)=(org,client,engagement,task,x.id)
    ORDER BY y.exception_id, y.seq DESC),
  dec AS (SELECT DISTINCT ON (d.exception_id) d.exception_id, d.kind, d.seq
    FROM public.assessment_exception_dispositions d JOIN x ON (d.organisation_id,d.client_id,d.engagement_id,d.task_id,d.exception_id)=(org,client,engagement,task,x.id)
    ORDER BY d.exception_id, d.seq DESC),
  standing AS (SELECT c.exception_id FROM dec c WHERE c.kind='closed'
    AND NOT EXISTS(SELECT 1 FROM public.assessment_exception_occurrences y
      WHERE (y.organisation_id,y.client_id,y.engagement_id,y.exception_id)=(org,client,engagement,c.exception_id) AND y.seq > c.seq
        AND NOT EXISTS(SELECT 1 FROM public.assessment_exception_occurrences z
          WHERE (z.organisation_id,z.client_id,z.engagement_id,z.exception_id)=(org,client,engagement,c.exception_id) AND z.seq < c.seq
            AND z.criterion_id=y.criterion_id AND z.evidence=y.evidence))),
  judged AS (
   SELECT x.id, x.subject, x.criterion_root, s.exception_id IS NOT NULL AS closed, f.exception_id IS NOT NULL AS failing,
     l.kind, l.at_us, l.verdict, l.execution, l.origin, l.review, l.causes, l.criterion_id, public.assessment_evidence(l.inputs) AS evidence,
     c.source_us, c.criterion_id AS occurrence_criterion, c.evidence AS occurrence_evidence
   FROM x LEFT JOIN standing s ON s.exception_id=x.id LEFT JOIN failing f ON f.exception_id=x.id
   LEFT JOIN latest l ON l.exception_id=x.id LEFT JOIN occ c ON c.exception_id=x.id)
 SELECT j.id, j.subject, j.criterion_root, d.status, d.latest_observed
 FROM judged j CROSS JOIN LATERAL public.assessment_exception_decide(j.closed, j.failing, j.kind, j.at_us, j.verdict, j.execution, j.origin, j.review,
   j.causes, j.criterion_id, j.evidence, j.source_us, j.occurrence_criterion, j.occurrence_evidence) d
$body$;

-- The derived status of one exception and what its latest observation
-- shows (the set-based rule above, for one exception).
CREATE FUNCTION public.assessment_exception_status(org text, client text, engagement text, exception text)
RETURNS TABLE(status text, latest_observed text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 SELECT s.status, s.latest_observed FROM public.assessment_exceptions x
 CROSS JOIN LATERAL public.assessment_exception_statuses(org,client,engagement,x.task_id,ARRAY[x.id]) s
 WHERE (x.organisation_id,x.client_id,x.engagement_id,x.id)=(org,client,engagement,exception)
$body$;

-- The effective outcome of every opportunity of one population: a judgment
-- opportunity resolves to its chain head under the head's newest
-- disposition (a person's `replaced` gives the person's verdict with origin
-- human and no reason); a rule opportunity is itself. `review` is the head's
-- review state; `superseded` says the head reads a basis version a later
-- version supersedes.
CREATE FUNCTION public.assessment_effective_outcomes(org text, client text, engagement text, population text)
RETURNS TABLE(criterion_id text, member_ordinal integer, subject text, applicability text, execution text, verdict text, reason text, origin text, review text, head_id text, superseded boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
 SELECT o.criterion_id, o.member_ordinal, o.subject,
   coalesce(h.applicability,o.applicability),
   coalesce(h.execution,o.execution),
   CASE WHEN h.id IS NULL THEN o.verdict WHEN d.kind='replaced' AND h.origin='model_proposal' THEN d.verdict ELSE h.verdict END,
   CASE WHEN h.id IS NULL THEN o.reason WHEN d.kind='replaced' AND h.origin='model_proposal' THEN NULL ELSE h.reason END,
   CASE WHEN h.id IS NULL THEN o.origin WHEN d.kind='replaced' AND h.origin='model_proposal' THEN 'human' ELSE h.origin END,
   CASE WHEN h.id IS NULL OR d.kind IS NULL THEN 'unreviewed'
     WHEN d.kind='replaced' AND h.origin='model_proposal' THEN 'replaced'
     WHEN d.kind='accepted' THEN 'accepted'
     WHEN d.kind='needs_reconsideration' THEN 'pending_reconsideration'
     ELSE 'unreviewed' END,
   h.id,
   h.id IS NOT NULL AND EXISTS(SELECT 1 FROM public.assessment_bases b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.supersedes)=(org,client,engagement,h.basis_id))
 FROM public.assessment_opportunities o
 LEFT JOIN LATERAL (
   SELECT coalesce(r.id,e.id) AS id, coalesce(r.basis_id,e.basis_id) AS basis_id,
     coalesce(r.applicability,e.applicability) AS applicability, coalesce(r.execution,e.execution) AS execution,
     CASE WHEN r.id IS NULL THEN e.verdict ELSE r.verdict END AS verdict,
     CASE WHEN r.id IS NULL THEN e.reason ELSE r.reason END AS reason,
     coalesce(r.origin,e.origin) AS origin
   FROM public.assessment_evaluations e
   LEFT JOIN LATERAL (SELECT v.id,v.basis_id,v.applicability,v.execution,v.verdict,v.reason,v.origin FROM public.assessment_evaluation_revisions v
     WHERE (v.organisation_id,v.client_id,v.engagement_id,v.chain_id)=(org,client,engagement,e.id) ORDER BY v.revision DESC LIMIT 1) r ON true
   WHERE (e.organisation_id,e.client_id,e.engagement_id,e.id)=(org,client,engagement,o.evaluation_id)) h ON o.evaluation_id IS NOT NULL
 LEFT JOIN LATERAL (SELECT y.kind,y.verdict FROM public.assessment_dispositions y
   WHERE (y.organisation_id,y.client_id,y.engagement_id,y.revision_id)=(org,client,engagement,h.id)
   ORDER BY y.created_us DESC, y.id COLLATE "C" DESC LIMIT 1) d ON h.id IS NOT NULL
 WHERE (o.organisation_id,o.client_id,o.engagement_id,o.population_id)=(org,client,engagement,population)
$body$;

-- ------------------------------------------------------------ backfill
-- Every not_met result recorded before Story 24.3b becomes an occurrence of
-- its exception, exactly as the writer trigger below records new ones, in
-- (time, source ID) order. The migration owner reads the published records
-- with their forced RLS lifted for this transaction only (restored below);
-- nothing published changes.
ALTER TABLE public.assessment_criteria NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_evaluations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_evaluation_revisions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_opportunities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_populations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_dispositions NO FORCE ROW LEVEL SECURITY;
-- BEGIN BACKFILL
CREATE FUNCTION public.zobba_not_met_results()
RETURNS TABLE(organisation_id text, client_id text, engagement_id text, task_id text, actor_id text, source_kind text, source_id text,
  population_id text, member_ordinal integer, criterion_id text, basis_id text, origin text, evidence text[], subject text, source_us bigint, root text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 SELECT b.*, public.assessment_criterion_root(b.organisation_id,b.client_id,b.engagement_id,b.criterion_id) FROM (
  SELECT e.organisation_id, e.client_id, e.engagement_id, e.task_id, e.actor_id, 'evaluation'::text, e.id,
    NULL::text, NULL::integer, e.criterion_id, e.basis_id, e.origin, public.assessment_evidence(e.document->'inputs'), e.subject, e.created_us
  FROM public.assessment_evaluations e WHERE e.verdict='not_met'
  UNION ALL
  SELECT r.organisation_id, r.client_id, r.engagement_id, r.task_id, r.actor_id, 'revision', r.id, NULL, NULL, r.criterion_id, r.basis_id, r.origin,
    public.assessment_evidence(r.document->'inputs'), r.subject, r.created_us
  FROM public.assessment_evaluation_revisions r WHERE r.verdict='not_met'
  UNION ALL
  -- A rule opportunity only: a judgment's opportunity names a recorded
  -- judgment, which is its own occurrence.
  SELECT o.organisation_id, o.client_id, o.engagement_id, o.task_id, o.actor_id, 'opportunity', o.population_id||'#'||o.criterion_id||'#'||o.member_ordinal,
    o.population_id, o.member_ordinal, o.criterion_id, p.basis_id, o.origin, public.assessment_evidence(o.inputs), o.subject, o.created_us
  FROM public.assessment_opportunities o JOIN public.assessment_populations p ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(o.organisation_id,o.client_id,o.engagement_id,o.population_id)
  WHERE o.verdict='not_met' AND o.evaluation_id IS NULL
  UNION ALL
  SELECT d.organisation_id, d.client_id, d.engagement_id, d.task_id, d.actor_id, 'disposition', d.id, NULL, NULL, h.criterion_id, h.basis_id, 'human',
    public.assessment_evidence(h.document->'inputs'), c.subject, d.created_us
  FROM public.assessment_dispositions d
  JOIN public.assessment_evaluations c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(d.organisation_id,d.client_id,d.engagement_id,d.chain_id)
  JOIN LATERAL (SELECT e.criterion_id, e.basis_id, e.document FROM public.assessment_evaluations e WHERE (e.organisation_id,e.client_id,e.engagement_id,e.id)=(d.organisation_id,d.client_id,d.engagement_id,d.revision_id)
    UNION ALL SELECT v.criterion_id, v.basis_id, v.document FROM public.assessment_evaluation_revisions v WHERE (v.organisation_id,v.client_id,v.engagement_id,v.id)=(d.organisation_id,d.client_id,d.engagement_id,d.revision_id)) h ON true
  WHERE d.kind='replaced' AND d.verdict='not_met') b
$body$;
INSERT INTO public.assessment_exceptions(organisation_id,client_id,engagement_id,task_id,actor_id,id,kind,criterion_root,subject,first_source_kind,first_source_id,created_us)
 SELECT DISTINCT ON (b.organisation_id,b.client_id,b.engagement_id,b.task_id,b.root,b.subject COLLATE "C")
   b.organisation_id,b.client_id,b.engagement_id,b.task_id,b.actor_id,
   public.assessment_exception_key(b.organisation_id,b.client_id,b.engagement_id,b.task_id,b.root,b.subject),
   'criterion_not_met',b.root,b.subject,b.source_kind,b.source_id,b.source_us
 FROM public.zobba_not_met_results() b
 ORDER BY b.organisation_id,b.client_id,b.engagement_id,b.task_id,b.root,b.subject COLLATE "C",b.source_us,b.source_id COLLATE "C";
INSERT INTO public.assessment_exception_occurrences(organisation_id,client_id,engagement_id,task_id,actor_id,exception_id,source_kind,source_id,population_id,member_ordinal,criterion_id,basis_id,origin,evidence,source_us,seq,created_us)
 SELECT b.organisation_id,b.client_id,b.engagement_id,b.task_id,b.actor_id,b.exception_id,
   b.source_kind,b.source_id,b.population_id,b.member_ordinal,b.criterion_id,b.basis_id,b.origin,b.evidence,b.source_us,
   row_number() OVER (PARTITION BY b.organisation_id,b.client_id,b.engagement_id,b.exception_id ORDER BY b.source_us, b.source_id COLLATE "C")::integer,
   b.source_us
 FROM (SELECT r.*, public.assessment_exception_key(r.organisation_id,r.client_id,r.engagement_id,r.task_id,r.root,r.subject) AS exception_id FROM public.zobba_not_met_results() r) b;
DROP FUNCTION public.zobba_not_met_results();
-- END BACKFILL
ALTER TABLE public.assessment_criteria FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_evaluation_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_opportunities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_populations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_dispositions FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------- writer

-- Every not_met result adds its occurrence (and, the first time, its
-- exception) in the very statement that records it. Set-based over the
-- statement's new rows: an opportunity batch of a thousand rows is one
-- insert of exceptions and one of occurrences. The Task's exception lock
-- (taken by closures too) orders it after every closure that committed
-- first and before every closure that commits later; `seq` records that
-- order. A Task holds at most 20,000 exceptions: a result that would add
-- the 20,001st is refused whole, so it is never recorded without its
-- exception.
CREATE FUNCTION public.exception_record() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
DECLARE staged jsonb; added_exceptions bigint;
BEGIN
 IF TG_TABLE_NAME='assessment_evaluations' THEN
  SELECT jsonb_agg(jsonb_build_object('organisation_id',a.organisation_id,'client_id',a.client_id,'engagement_id',a.engagement_id,'task_id',a.task_id,'actor_id',a.actor_id,
    'source_kind','evaluation','source_id',a.id,'population_id',NULL,'member_ordinal',NULL,'criterion_id',a.criterion_id,'basis_id',a.basis_id,'origin',a.origin,
    'evidence',to_jsonb(public.assessment_evidence(a.document->'inputs')),'subject',a.subject,'source_us',a.created_us))
   INTO staged FROM added a WHERE a.verdict='not_met';
 ELSIF TG_TABLE_NAME='assessment_evaluation_revisions' THEN
  SELECT jsonb_agg(jsonb_build_object('organisation_id',a.organisation_id,'client_id',a.client_id,'engagement_id',a.engagement_id,'task_id',a.task_id,'actor_id',a.actor_id,
    'source_kind','revision','source_id',a.id,'population_id',NULL,'member_ordinal',NULL,'criterion_id',a.criterion_id,'basis_id',a.basis_id,'origin',a.origin,
    'evidence',to_jsonb(public.assessment_evidence(a.document->'inputs')),'subject',a.subject,'source_us',a.created_us))
   INTO staged FROM added a WHERE a.verdict='not_met';
 ELSIF TG_TABLE_NAME='assessment_opportunities' THEN
  -- Rule opportunities only: a judgment's opportunity names a recorded
  -- judgment, which is its own occurrence.
  SELECT jsonb_agg(jsonb_build_object('organisation_id',a.organisation_id,'client_id',a.client_id,'engagement_id',a.engagement_id,'task_id',a.task_id,'actor_id',a.actor_id,
    'source_kind','opportunity','source_id',a.population_id||'#'||a.criterion_id||'#'||a.member_ordinal,'population_id',a.population_id,'member_ordinal',a.member_ordinal,
    'criterion_id',a.criterion_id,'basis_id',p.basis_id,'origin',a.origin,
    'evidence',to_jsonb(public.assessment_evidence(a.inputs)),'subject',a.subject,'source_us',a.created_us))
   INTO staged FROM added a JOIN public.assessment_populations p ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(a.organisation_id,a.client_id,a.engagement_id,a.population_id)
   WHERE a.verdict='not_met' AND a.evaluation_id IS NULL;
 ELSE
  SELECT jsonb_agg(jsonb_build_object('organisation_id',a.organisation_id,'client_id',a.client_id,'engagement_id',a.engagement_id,'task_id',a.task_id,'actor_id',a.actor_id,
    'source_kind','disposition','source_id',a.id,'population_id',NULL,'member_ordinal',NULL,'criterion_id',h.criterion_id,'basis_id',h.basis_id,'origin','human',
    'evidence',to_jsonb(public.assessment_evidence(h.document->'inputs')),'subject',c.subject,'source_us',a.created_us))
   INTO staged FROM added a
   JOIN public.assessment_evaluations c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(a.organisation_id,a.client_id,a.engagement_id,a.chain_id)
   JOIN LATERAL (SELECT e.criterion_id, e.basis_id, e.document FROM public.assessment_evaluations e WHERE (e.organisation_id,e.client_id,e.engagement_id,e.id)=(a.organisation_id,a.client_id,a.engagement_id,a.revision_id)
     UNION ALL SELECT v.criterion_id, v.basis_id, v.document FROM public.assessment_evaluation_revisions v WHERE (v.organisation_id,v.client_id,v.engagement_id,v.id)=(a.organisation_id,a.client_id,a.engagement_id,a.revision_id)) h ON true
   WHERE a.kind='replaced' AND a.verdict='not_met';
 END IF;
 IF staged IS NULL THEN
  RETURN NULL;
 END IF;
 -- The Task's exception lock, in a fixed order.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('exceptions:'||t.organisation_id||'/'||t.client_id||'/'||t.engagement_id||'/'||t.task_id, 2403))
  FROM (SELECT DISTINCT r.organisation_id, r.client_id, r.engagement_id, r.task_id FROM jsonb_to_recordset(staged) AS r(organisation_id text, client_id text, engagement_id text, task_id text)) t
  ORDER BY t.organisation_id COLLATE "C", t.client_id COLLATE "C", t.engagement_id COLLATE "C", t.task_id COLLATE "C";
 -- Each row with its criterion lineage root and exception ID.
 WITH r AS (SELECT * FROM jsonb_to_recordset(staged) AS r(organisation_id text, client_id text, engagement_id text, task_id text, actor_id text, source_kind text, source_id text,
     population_id text, member_ordinal integer, criterion_id text, basis_id text, origin text, evidence text[], subject text, source_us bigint)),
  t AS (SELECT DISTINCT r.organisation_id, r.client_id, r.engagement_id, r.task_id FROM r),
  k AS (SELECT t.organisation_id, t.client_id, t.engagement_id, t.task_id, c.criterion_id, c.root FROM t
    CROSS JOIN LATERAL public.assessment_task_criterion_roots(t.organisation_id,t.client_id,t.engagement_id,t.task_id) c)
 SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object('root',k.root,'exception_id',
     CASE WHEN k.root IS NULL THEN NULL ELSE public.assessment_exception_key(r.organisation_id,r.client_id,r.engagement_id,r.task_id,k.root,r.subject) END))
  INTO staged
  FROM r LEFT JOIN k ON (k.organisation_id,k.client_id,k.engagement_id,k.task_id,k.criterion_id)=(r.organisation_id,r.client_id,r.engagement_id,r.task_id,r.criterion_id);
 IF jsonb_path_exists(staged, '$[*] ? (@.root == null)') THEN
  RAISE EXCEPTION 'a not_met result names a criterion of its own Task' USING ERRCODE='23514';
 END IF;
 WITH s AS (SELECT * FROM jsonb_to_recordset(staged) AS r(organisation_id text, client_id text, engagement_id text, task_id text, actor_id text, source_kind text, source_id text,
     population_id text, member_ordinal integer, criterion_id text, basis_id text, origin text, evidence text[], subject text, source_us bigint, root text, exception_id text))
 INSERT INTO public.assessment_exceptions(organisation_id,client_id,engagement_id,task_id,actor_id,id,kind,criterion_root,subject,first_source_kind,first_source_id)
  SELECT DISTINCT ON (s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.root,s.subject COLLATE "C")
    s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.actor_id,s.exception_id,
    'criterion_not_met',s.root,s.subject,s.source_kind,s.source_id
  FROM s
  ORDER BY s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.root,s.subject COLLATE "C",s.source_us,s.source_id COLLATE "C"
  ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added_exceptions = ROW_COUNT;
 IF added_exceptions > 0 AND EXISTS(SELECT 1 FROM (SELECT DISTINCT r.organisation_id, r.client_id, r.engagement_id, r.task_id FROM jsonb_to_recordset(staged) AS r(organisation_id text, client_id text, engagement_id text, task_id text)) t
    WHERE (SELECT count(*) FROM public.assessment_exceptions x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.task_id)=(t.organisation_id,t.client_id,t.engagement_id,t.task_id)) > 20000) THEN
  RAISE EXCEPTION 'a Task holds at most 20000 exceptions' USING ERRCODE='23514';
 END IF;
 WITH s AS (SELECT * FROM jsonb_to_recordset(staged) AS r(organisation_id text, client_id text, engagement_id text, task_id text, actor_id text, source_kind text, source_id text,
     population_id text, member_ordinal integer, criterion_id text, basis_id text, origin text, evidence text[], subject text, source_us bigint, root text, exception_id text))
 INSERT INTO public.assessment_exception_occurrences(organisation_id,client_id,engagement_id,task_id,actor_id,exception_id,source_kind,source_id,population_id,member_ordinal,criterion_id,basis_id,origin,evidence,source_us,seq)
  SELECT s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.actor_id,s.exception_id,
    s.source_kind,s.source_id,s.population_id,s.member_ordinal,s.criterion_id,s.basis_id,s.origin,s.evidence,s.source_us,
    (coalesce(placed.last,0) + row_number() OVER (PARTITION BY s.organisation_id,s.client_id,s.engagement_id,s.exception_id ORDER BY s.source_us, s.source_id COLLATE "C"))::integer
  FROM s
  -- The greatest place each exception already holds, read once per
  -- statement (set-based, whatever the planner knows of new rows).
  LEFT JOIN (SELECT q.exception_id, max(q.seq) AS last FROM (
      SELECT y.exception_id, y.seq FROM public.assessment_exception_occurrences y
       WHERE (y.organisation_id,y.client_id,y.engagement_id,y.task_id) IN (SELECT DISTINCT t.organisation_id,t.client_id,t.engagement_id,t.task_id FROM jsonb_to_recordset(staged) AS t(organisation_id text, client_id text, engagement_id text, task_id text))
      UNION ALL
      SELECT d.exception_id, d.seq FROM public.assessment_exception_dispositions d
       WHERE (d.organisation_id,d.client_id,d.engagement_id,d.task_id) IN (SELECT DISTINCT t.organisation_id,t.client_id,t.engagement_id,t.task_id FROM jsonb_to_recordset(staged) AS t(organisation_id text, client_id text, engagement_id text, task_id text))) q
    GROUP BY 1) placed ON placed.exception_id=s.exception_id;
 RETURN NULL;
END $body$;
DO $writer$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['assessment_evaluations','assessment_evaluation_revisions','assessment_opportunities','assessment_dispositions'] LOOP
  EXECUTE format('CREATE TRIGGER exception_record AFTER INSERT ON public.%I REFERENCING NEW TABLE AS added FOR EACH STATEMENT EXECUTE FUNCTION public.exception_record()',relation);
 END LOOP;
END $writer$;

-- ------------------------------------------------------------- guards

-- Exceptions and occurrences are checked once per statement over its new
-- rows: each is exactly what trusted code derives from a not_met source
-- record of its own Task (the writer above is the only path that writes
-- them; a direct insert that differs in any column is refused), and an
-- occurrence is ordered after every earlier record of its exception.
CREATE FUNCTION public.exception_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
BEGIN
 IF TG_TABLE_NAME='assessment_exceptions' THEN
  IF EXISTS(WITH t AS (SELECT DISTINCT a.organisation_id, a.client_id, a.engagement_id, a.task_id FROM added a),
    k AS MATERIALIZED (SELECT t.organisation_id, t.client_id, t.engagement_id, t.task_id, c.criterion_id, c.root FROM t
      CROSS JOIN LATERAL public.assessment_task_criterion_roots(t.organisation_id,t.client_id,t.engagement_id,t.task_id) c)
   SELECT 1 FROM added a
     LEFT JOIN k ON (k.organisation_id,k.client_id,k.engagement_id,k.task_id,k.criterion_id)=(a.organisation_id,a.client_id,a.engagement_id,a.task_id,a.criterion_root)
     WHERE a.id IS DISTINCT FROM public.assessment_exception_key(a.organisation_id,a.client_id,a.engagement_id,a.task_id,a.criterion_root,a.subject)
       OR k.root IS DISTINCT FROM a.criterion_root) THEN
   RAISE EXCEPTION 'an exception is named by its Task, criterion lineage root and subject' USING ERRCODE='23514';
  END IF;
  -- A row the trusted writer derived inside its own statement trigger
  -- (trigger depth above one: only owner-defined triggers nest, and only the
  -- writer inserts here) was derived from its source by that code; every
  -- other insert is checked against its source here.
  IF pg_catalog.pg_trigger_depth() = 1 THEN
  IF EXISTS(WITH t AS (SELECT DISTINCT a.organisation_id, a.client_id, a.engagement_id, a.task_id FROM added a),
    k AS MATERIALIZED (SELECT t.organisation_id, t.client_id, t.engagement_id, t.task_id, c.criterion_id, c.root FROM t
      CROSS JOIN LATERAL public.assessment_task_criterion_roots(t.organisation_id,t.client_id,t.engagement_id,t.task_id) c),
    -- Each new exception's first source, found set-based (one join per
    -- source kind, never a lookup per row).
    src AS (
     SELECT a.id, e.task_id, e.subject, e.criterion_id FROM added a JOIN public.assessment_evaluations e
       ON (e.organisation_id,e.client_id,e.engagement_id,e.id)=(a.organisation_id,a.client_id,a.engagement_id,a.first_source_id)
      WHERE a.first_source_kind='evaluation' AND e.verdict='not_met'
     UNION ALL
     SELECT a.id, r.task_id, r.subject, r.criterion_id FROM added a JOIN public.assessment_evaluation_revisions r
       ON (r.organisation_id,r.client_id,r.engagement_id,r.id)=(a.organisation_id,a.client_id,a.engagement_id,a.first_source_id)
      WHERE a.first_source_kind='revision' AND r.verdict='not_met'
     UNION ALL
     SELECT a.id, o.task_id, o.subject, o.criterion_id FROM added a JOIN public.assessment_opportunities o
       -- Joined by its key (the source ID is population#criterion#member).
       ON (o.organisation_id,o.client_id,o.engagement_id,o.population_id,o.criterion_id,o.member_ordinal::text)
         =(a.organisation_id,a.client_id,a.engagement_id,pg_catalog.split_part(a.first_source_id,'#',1),pg_catalog.split_part(a.first_source_id,'#',2),pg_catalog.split_part(a.first_source_id,'#',3))
       AND o.population_id||'#'||o.criterion_id||'#'||o.member_ordinal=a.first_source_id
      WHERE a.first_source_kind='opportunity' AND o.verdict='not_met' AND o.evaluation_id IS NULL
     UNION ALL
     SELECT a.id, d.task_id, c.subject, c.criterion_id FROM added a JOIN public.assessment_dispositions d
       ON (d.organisation_id,d.client_id,d.engagement_id,d.id)=(a.organisation_id,a.client_id,a.engagement_id,a.first_source_id)
      JOIN public.assessment_evaluations c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(d.organisation_id,d.client_id,d.engagement_id,d.chain_id)
      WHERE a.first_source_kind='disposition' AND d.kind='replaced' AND d.verdict='not_met')
   SELECT 1 FROM added a
     LEFT JOIN src ON src.id=a.id AND src.task_id=a.task_id AND src.subject=a.subject
     LEFT JOIN k ON (k.organisation_id,k.client_id,k.engagement_id,k.task_id,k.criterion_id,k.root)=(a.organisation_id,a.client_id,a.engagement_id,a.task_id,src.criterion_id,a.criterion_root)
     WHERE k.root IS NULL) THEN
   RAISE EXCEPTION 'an exception begins with a not_met result of its lineage and subject' USING ERRCODE='23514';
  END IF;
  END IF;
 ELSE
  -- Every occurrence writer holds its Task's exception lock (shared with
  -- the disposition guard), so the order check below reads settled places.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('exceptions:'||t.organisation_id||'/'||t.client_id||'/'||t.engagement_id||'/'||t.task_id, 2403))
   FROM (SELECT DISTINCT a.organisation_id, a.client_id, a.engagement_id, a.task_id FROM added a ORDER BY 1,2,3,4) t;
  -- (As above: the trusted writer's own rows were derived by it.)
  IF pg_catalog.pg_trigger_depth() = 1 THEN
  -- The expected occurrence of each new row, derived from its source
  -- (set-based: one join per source kind, never a lookup per row).
  IF EXISTS(WITH t AS (SELECT DISTINCT a.organisation_id, a.client_id, a.engagement_id, a.task_id FROM added a),
    k AS MATERIALIZED (SELECT t.organisation_id, t.client_id, t.engagement_id, t.task_id, c.criterion_id, c.root FROM t
      CROSS JOIN LATERAL public.assessment_task_criterion_roots(t.organisation_id,t.client_id,t.engagement_id,t.task_id) c),
    s AS (
     SELECT a.exception_id AS e_id, a.source_kind AS e_kind, a.source_id AS e_source,
       e.task_id, e.actor_id, e.subject, NULL::text AS population_id, NULL::integer AS member_ordinal, e.criterion_id, e.basis_id, e.origin,
       public.assessment_evidence(e.document->'inputs') AS evidence, e.created_us AS source_us
     FROM added a JOIN public.assessment_evaluations e ON (e.organisation_id,e.client_id,e.engagement_id,e.id)=(a.organisation_id,a.client_id,a.engagement_id,a.source_id)
     WHERE a.source_kind='evaluation' AND e.verdict='not_met'
     UNION ALL
     SELECT a.exception_id, a.source_kind, a.source_id, r.task_id, r.actor_id, r.subject, NULL, NULL, r.criterion_id, r.basis_id, r.origin, public.assessment_evidence(r.document->'inputs'), r.created_us
     FROM added a JOIN public.assessment_evaluation_revisions r ON (r.organisation_id,r.client_id,r.engagement_id,r.id)=(a.organisation_id,a.client_id,a.engagement_id,a.source_id)
     WHERE a.source_kind='revision' AND r.verdict='not_met'
     UNION ALL
     SELECT a.exception_id, a.source_kind, a.source_id, o.task_id, o.actor_id, o.subject, o.population_id, o.member_ordinal, o.criterion_id, p.basis_id, o.origin, public.assessment_evidence(o.inputs), o.created_us
     FROM added a JOIN public.assessment_opportunities o ON (o.organisation_id,o.client_id,o.engagement_id,o.population_id,o.criterion_id,o.member_ordinal)=(a.organisation_id,a.client_id,a.engagement_id,a.population_id,a.criterion_id,a.member_ordinal)
     JOIN public.assessment_populations p ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(o.organisation_id,o.client_id,o.engagement_id,o.population_id)
     WHERE a.source_kind='opportunity' AND o.population_id||'#'||o.criterion_id||'#'||o.member_ordinal=a.source_id AND o.verdict='not_met' AND o.evaluation_id IS NULL
     UNION ALL
     SELECT a.exception_id, a.source_kind, a.source_id, d.task_id, d.actor_id, c.subject, NULL, NULL, h.criterion_id, h.basis_id, 'human', public.assessment_evidence(h.document->'inputs'), d.created_us
     FROM added a JOIN public.assessment_dispositions d ON (d.organisation_id,d.client_id,d.engagement_id,d.id)=(a.organisation_id,a.client_id,a.engagement_id,a.source_id)
     JOIN public.assessment_evaluations c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(d.organisation_id,d.client_id,d.engagement_id,d.chain_id)
     JOIN (SELECT e.organisation_id, e.client_id, e.engagement_id, e.id, e.criterion_id, e.basis_id, e.document FROM public.assessment_evaluations e
       UNION ALL SELECT v.organisation_id, v.client_id, v.engagement_id, v.id, v.criterion_id, v.basis_id, v.document FROM public.assessment_evaluation_revisions v) h
       ON (h.organisation_id,h.client_id,h.engagement_id,h.id)=(d.organisation_id,d.client_id,d.engagement_id,d.revision_id)
     WHERE a.source_kind='disposition' AND d.kind='replaced' AND d.verdict='not_met')
   SELECT 1 FROM added a
     LEFT JOIN s ON (s.e_id,s.e_kind,s.e_source)=(a.exception_id,a.source_kind,a.source_id)
     LEFT JOIN k ON (k.organisation_id,k.client_id,k.engagement_id,k.task_id,k.criterion_id)=(a.organisation_id,a.client_id,a.engagement_id,a.task_id,s.criterion_id)
     -- Its own exception of this Task, lineage root and subject.
     LEFT JOIN public.assessment_exceptions x ON (x.organisation_id,x.client_id,x.engagement_id,x.id)=(a.organisation_id,a.client_id,a.engagement_id,a.exception_id)
       AND x.task_id=a.task_id AND x.subject=s.subject AND x.criterion_root=k.root
     WHERE s.task_id IS NULL OR x.id IS NULL
       OR (a.task_id,a.actor_id) IS DISTINCT FROM (s.task_id,s.actor_id)
       OR (a.population_id,a.member_ordinal,a.criterion_id,a.basis_id,a.origin,a.source_us) IS DISTINCT FROM (s.population_id,s.member_ordinal,s.criterion_id,s.basis_id,s.origin,s.source_us)
       OR a.evidence IS DISTINCT FROM s.evidence) THEN
   RAISE EXCEPTION 'an occurrence is exactly the not_met result it names, in its exception' USING ERRCODE='23514';
  END IF;
  END IF;
  -- Ordered after every earlier record of its exception: no disposition
  -- and no other occurrence holds a later or equal place.
  -- Set-based: per exception, the statement's first place against the
  -- greatest place already stored (its own new rows excluded by a hashed
  -- key set, never by a scan of the statement's rows per stored row).
  IF EXISTS(WITH mine AS MATERIALIZED (SELECT a.organisation_id, a.client_id, a.engagement_id, a.exception_id, min(a.seq) AS first FROM added a GROUP BY 1,2,3,4),
      keys AS MATERIALIZED (SELECT a.exception_id||'|'||a.source_kind||'|'||a.source_id AS key FROM added a),
      stored AS (SELECT y.exception_id, max(y.seq) AS last FROM public.assessment_exception_occurrences y
        WHERE (y.organisation_id,y.client_id,y.engagement_id) IN (SELECT DISTINCT m.organisation_id,m.client_id,m.engagement_id FROM mine m)
          AND y.exception_id IN (SELECT m.exception_id FROM mine m)
          AND (y.exception_id||'|'||y.source_kind||'|'||y.source_id) NOT IN (SELECT k.key FROM keys k)
        GROUP BY 1
        UNION ALL
        SELECT d.exception_id, max(d.seq) FROM public.assessment_exception_dispositions d
        WHERE (d.organisation_id,d.client_id,d.engagement_id) IN (SELECT DISTINCT m.organisation_id,m.client_id,m.engagement_id FROM mine m)
          AND d.exception_id IN (SELECT m.exception_id FROM mine m)
        GROUP BY 1)
     SELECT 1 FROM mine m JOIN stored s ON s.exception_id=m.exception_id WHERE s.last >= m.first) THEN
   RAISE EXCEPTION 'an occurrence is ordered after every earlier record of its exception' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $body$;
DO $batch$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['assessment_exceptions','assessment_exception_occurrences'] LOOP
  EXECUTE format('CREATE TRIGGER exception_batch AFTER INSERT ON public.%I REFERENCING NEW TABLE AS added FOR EACH STATEMENT EXECUTE FUNCTION public.exception_batch()',relation);
 END LOOP;
END $batch$;

-- An exception disposition is saved by a person in their own live session
-- (a worker connection holds none), with a current Auditor or Audit manager
-- role and assignment on the engagement, who is an Audit manager or the
-- Task's accountable person. A closure names verified evidence and only an
-- exception that is not closed; a reopening only one that is. It takes the
-- Task's exception lock (shared with every occurrence writer), reads the
-- status after it and takes the next place in the exception's order.
CREATE FUNCTION public.exception_guard() RETURNS trigger
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
 IF (SELECT count(*) FROM public.assessment_exception_dispositions d WHERE (d.organisation_id,d.client_id,d.engagement_id,d.exception_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.exception_id)) >= 16 THEN
  RAISE EXCEPTION 'an exception holds at most 16 dispositions' USING ERRCODE='23514';
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
CREATE TRIGGER exception_guard BEFORE INSERT ON public.assessment_exception_dispositions FOR EACH ROW EXECUTE FUNCTION public.exception_guard();

-- An effective summary agrees with what trusted code recorded: it belongs
-- to its answer invocation of this Task under that turn's binding, reads a
-- population of its basis (and a sample of it), supersedes the newest
-- effective summary of that population and sample, and every count, the
-- coverage limitations, the conclusion and the effective limitations are the
-- exact SQL recount over the stored members, `assessment_effective_outcomes`
-- (read once) and `assessment_exception_statuses` (the exceptions of its own
-- subjects under its basis's criterion lineages).
CREATE FUNCTION public.effective_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
DECLARE population public.assessment_populations%ROWTYPE; recount record; counted record;
 inner_summary jsonb := NEW.document->'effective'->'summary'; outer_summary jsonb := NEW.document->'effective';
 entry jsonb; extra jsonb; criterion_entry record; expected text; effective_expected text; unresolved integer; subjects integer; criteria integer;
 failing bigint; unresolved_count bigint; meets bigint; not_applicable bigint; failing_opportunities numeric;
 unreviewed bigint := 0; pending bigint := 0; undisposed bigint := 0; superseded bigint := 0; human bigint := 0;
 newest text; stated jsonb; derived jsonb; scope_unknown bigint; unkeyed bigint;
 per_criterion jsonb; by_reason jsonb; domain text[]; ids text[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
   AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id
   AND i.request->'context'->'verification'->>'expected_methodology_binding_id' = NEW.methodology_binding_id
   AND (i.request->'basis'->>'execution_epoch')::bigint = NEW.execution_epoch) THEN
  RAISE EXCEPTION 'an effective summary belongs to its answer invocation and its binding' USING ERRCODE='23514';
 END IF;
 SELECT p.* INTO population FROM public.assessment_populations p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id);
 IF population.id IS NULL OR population.task_id <> NEW.task_id OR population.basis_id <> NEW.basis_id THEN
  RAISE EXCEPTION 'an effective summary reads a population of its own Task and basis' USING ERRCODE='23514';
 END IF;
 IF NEW.sample_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.assessment_samples s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id) AND s.population_id=NEW.population_id AND s.task_id=NEW.task_id) THEN
  RAISE EXCEPTION 'an effective summary reads a sample of its population' USING ERRCODE='23514';
 END IF;
 IF NEW.completeness <> population.completeness OR NEW.completeness_reason IS DISTINCT FROM population.completeness_reason OR NEW.reconciliation <> population.reconciliation THEN
  RAISE EXCEPTION 'an effective summary states its population''s completeness and reconciliation' USING ERRCODE='23514';
 END IF;
 -- Serialised with the population's opportunities (their batch guard takes
 -- the coverage lock) and with other effective summaries of it.
 PERFORM pg_advisory_xact_lock(hashtextextended('coverage:'||NEW.population_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('effective:'||NEW.population_id,0));
 SELECT s.id INTO newest FROM public.assessment_effective_summaries s
  WHERE (s.organisation_id,s.client_id,s.engagement_id,s.population_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id) AND s.sample_id IS NOT DISTINCT FROM NEW.sample_id
  ORDER BY s.created_us DESC, s.id COLLATE "C" DESC LIMIT 1;
 IF NEW.supersedes IS DISTINCT FROM newest THEN
  RAISE EXCEPTION 'an effective summary supersedes the newest effective summary of its population and sample' USING ERRCODE='23514';
 END IF;
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
 IF jsonb_typeof(inner_summary->'received_rows') IS DISTINCT FROM 'number' OR (inner_summary->>'received_rows')::numeric IS DISTINCT FROM recount.received_rows
    OR jsonb_typeof(inner_summary->'unkeyed') IS DISTINCT FROM 'number' OR (inner_summary->>'unkeyed')::numeric IS DISTINCT FROM recount.unkeyed
    OR jsonb_typeof(inner_summary->'duplicate_rows') IS DISTINCT FROM 'number' OR (inner_summary->>'duplicate_rows')::numeric IS DISTINCT FROM recount.duplicate_rows
    OR jsonb_typeof(inner_summary->'distinct_subjects') IS DISTINCT FROM 'number' OR (inner_summary->>'distinct_subjects')::numeric IS DISTINCT FROM recount.distinct_subjects
    OR jsonb_typeof(inner_summary->'excluded_out_of_period') IS DISTINCT FROM 'number' OR (inner_summary->>'excluded_out_of_period')::numeric IS DISTINCT FROM recount.excluded_out_of_period
    OR jsonb_typeof(inner_summary->'scope_unknown_period_unparsed') IS DISTINCT FROM 'number' OR (inner_summary->>'scope_unknown_period_unparsed')::numeric IS DISTINCT FROM recount.period_unparsed
    OR jsonb_typeof(inner_summary->'scope_unknown_period_missing') IS DISTINCT FROM 'number' OR (inner_summary->>'scope_unknown_period_missing')::numeric IS DISTINCT FROM recount.period_missing
    OR jsonb_typeof(inner_summary->'scope_unknown_conflicting_duplicate') IS DISTINCT FROM 'number' OR (inner_summary->>'scope_unknown_conflicting_duplicate')::numeric IS DISTINCT FROM recount.conflicting
    OR NEW.in_scope IS DISTINCT FROM recount.in_scope::integer THEN
  RAISE EXCEPTION 'an effective summary count is not the stored count: population' USING ERRCODE='23514';
 END IF;
 scope_unknown := recount.period_unparsed + recount.period_missing + recount.conflicting;
 unkeyed := recount.unkeyed;
 IF NEW.sample_id IS NOT NULL AND NEW.selected IS DISTINCT FROM (SELECT count(*) FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id))::integer THEN
  RAISE EXCEPTION 'an effective summary count is not the stored count: selected' USING ERRCODE='23514';
 END IF;
 -- The summary's own subjects: the population's in-scope subjects, or the
 -- sample's selected ones among them.
 domain := ARRAY(SELECT m.subject FROM public.assessment_population_members m
  WHERE (m.organisation_id,m.client_id,m.engagement_id,m.population_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id)
    AND m.disposition='in_scope' AND m.subject IS NOT NULL
    AND (NEW.sample_id IS NULL OR m.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id))));
 subjects := cardinality(domain);
 SELECT count(*) INTO criteria FROM public.assessment_basis_criteria k WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id);
 IF jsonb_typeof(inner_summary->'criteria') IS DISTINCT FROM 'array' OR jsonb_array_length(inner_summary->'criteria') IS DISTINCT FROM criteria THEN
  RAISE EXCEPTION 'an effective summary counts every criterion of its basis' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.assessment_basis_criteria k
    WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id)
      AND (SELECT count(*) FROM public.assessment_opportunities o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.population_id,o.criterion_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id,k.criterion_id))
          IS DISTINCT FROM population.in_scope::bigint) THEN
  RAISE EXCEPTION 'an effective summary reads every opportunity of every criterion of its basis' USING ERRCODE='23514';
 END IF;
 -- The effective outcomes of the summary's subjects, read once: per
 -- criterion, undetermined reasons per criterion, and the subject partition.
 WITH o AS MATERIALIZED (SELECT * FROM public.assessment_effective_outcomes(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id) o
     WHERE NEW.sample_id IS NULL OR o.subject IN (SELECT pg_catalog.unnest(domain))),
  c AS (SELECT o.criterion_id,
    count(*) FILTER (WHERE o.applicability='applicable') AS applicable,
    count(*) FILTER (WHERE o.applicability='not_applicable') AS not_applicable,
    count(*) FILTER (WHERE o.applicability='applicable' AND o.verdict='met') AS met,
    count(*) FILTER (WHERE o.applicability='applicable' AND o.verdict='not_met') AS not_met,
    count(*) FILTER (WHERE o.applicability='applicable' AND o.execution='completed' AND o.verdict='undetermined') AS undetermined,
    count(*) FILTER (WHERE o.applicability='applicable' AND o.execution='failed') AS execution_failed,
    count(*) FILTER (WHERE o.applicability='applicable' AND o.execution='completed' AND o.verdict IS NULL) AS not_evaluated,
    count(*) FILTER (WHERE o.applicability='applicable' AND o.verdict='met' AND o.origin='model_proposal') AS met_unreviewed,
    count(*) FILTER (WHERE o.review='replaced') AS human_replaced,
    count(*) FILTER (WHERE o.review='pending_reconsideration') AS pending,
    count(*) FILTER (WHERE o.origin='model_proposal' AND o.review='unreviewed') AS undisposed,
    count(*) FILTER (WHERE o.superseded) AS superseded
   FROM o GROUP BY o.criterion_id),
  r AS (SELECT q.criterion_id, jsonb_object_agg(q.reason, q.n) AS reasons FROM (SELECT o.criterion_id, coalesce(o.reason,'stated_in_words') AS reason, count(*) AS n FROM o
    WHERE o.applicability='applicable' AND o.execution='completed' AND o.verdict='undetermined' GROUP BY 1,2) q GROUP BY q.criterion_id),
  s AS (SELECT o.member_ordinal,
     bool_or(o.verdict IS NOT DISTINCT FROM 'not_met') AS f,
     bool_or(o.execution='failed' OR o.applicability='unknown' OR (o.applicability='applicable' AND o.verdict IS DISTINCT FROM 'met' AND o.verdict IS DISTINCT FROM 'not_met'))
       OR count(*) < criteria AS u,
     bool_or(o.verdict IS NOT DISTINCT FROM 'met') AS m,
     count(*) FILTER (WHERE o.verdict='not_met') AS n_not_met
   FROM o GROUP BY o.member_ordinal)
 SELECT (SELECT coalesce(jsonb_object_agg(c.criterion_id, to_jsonb(c)), '{}'::jsonb) FROM c),
   (SELECT coalesce(jsonb_object_agg(r.criterion_id, r.reasons), '{}'::jsonb) FROM r),
   (SELECT count(*) FILTER (WHERE f) FROM s), (SELECT count(*) FILTER (WHERE NOT f AND u) + (subjects - count(*)) FROM s),
   (SELECT count(*) FILTER (WHERE NOT f AND NOT u AND m) FROM s), (SELECT count(*) FILTER (WHERE NOT f AND NOT u AND NOT m) FROM s),
   (SELECT coalesce(sum(n_not_met),0) FROM s)
  INTO per_criterion, by_reason, failing, unresolved_count, meets, not_applicable, failing_opportunities;
 -- Per criterion, in basis order.
 derived := '[]'::jsonb;
 FOR criterion_entry IN SELECT k.ordinal, k.criterion_id, c.kind, inner_summary->'criteria'->k.ordinal AS entry, outer_summary->'criteria'->k.ordinal AS extra,
     coalesce(per_criterion->k.criterion_id, '{}'::jsonb) AS n, coalesce(by_reason->k.criterion_id, '{}'::jsonb) AS reasons
    FROM public.assessment_basis_criteria k JOIN public.assessment_criteria c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(k.organisation_id,k.client_id,k.engagement_id,k.criterion_id)
    WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id) ORDER BY k.ordinal LOOP
  entry := criterion_entry.entry; extra := criterion_entry.extra;
  IF entry->>'criterion_id' IS DISTINCT FROM criterion_entry.criterion_id OR extra->>'criterion_id' IS DISTINCT FROM criterion_entry.criterion_id
     OR jsonb_typeof(entry->'applicable') IS DISTINCT FROM 'number' OR (entry->>'applicable')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'applicable')::numeric,0)
     OR jsonb_typeof(entry->'not_applicable') IS DISTINCT FROM 'number' OR (entry->>'not_applicable')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'not_applicable')::numeric,0)
     OR jsonb_typeof(entry->'applicability_unknown') IS DISTINCT FROM 'number' OR (entry->>'applicability_unknown')::numeric IS DISTINCT FROM subjects - coalesce((criterion_entry.n->>'applicable')::numeric,0) - coalesce((criterion_entry.n->>'not_applicable')::numeric,0)
     OR jsonb_typeof(entry->'met') IS DISTINCT FROM 'number' OR (entry->>'met')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'met')::numeric,0)
     OR jsonb_typeof(entry->'not_met') IS DISTINCT FROM 'number' OR (entry->>'not_met')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'not_met')::numeric,0)
     OR jsonb_typeof(entry->'undetermined') IS DISTINCT FROM 'number' OR (entry->>'undetermined')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'undetermined')::numeric,0)
     OR jsonb_typeof(entry->'execution_failed') IS DISTINCT FROM 'number' OR (entry->>'execution_failed')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'execution_failed')::numeric,0)
     OR jsonb_typeof(entry->'not_evaluated') IS DISTINCT FROM 'number' OR (entry->>'not_evaluated')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'not_evaluated')::numeric,0)
     OR jsonb_typeof(entry->'met_unreviewed') IS DISTINCT FROM 'number' OR (entry->>'met_unreviewed')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'met_unreviewed')::numeric,0)
     OR entry->'undetermined_by_reason' IS DISTINCT FROM criterion_entry.reasons
     OR jsonb_typeof(extra->'human_replaced') IS DISTINCT FROM 'number' OR (extra->>'human_replaced')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'human_replaced')::numeric,0)
     OR jsonb_typeof(extra->'pending_reconsideration') IS DISTINCT FROM 'number' OR (extra->>'pending_reconsideration')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'pending')::numeric,0)
     OR jsonb_typeof(extra->'undisposed') IS DISTINCT FROM 'number' OR (extra->>'undisposed')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'undisposed')::numeric,0)
     OR jsonb_typeof(extra->'superseded') IS DISTINCT FROM 'number' OR (extra->>'superseded')::numeric IS DISTINCT FROM coalesce((criterion_entry.n->>'superseded')::numeric,0) THEN
   RAISE EXCEPTION 'an effective summary count is not the stored count: criterion %', criterion_entry.criterion_id USING ERRCODE='23514';
  END IF;
  -- The 24.2 coverage limitations of this criterion, in their order (every
  -- subject has an opportunity of it, checked above, so none is missing).
  IF criterion_entry.kind='judgment' AND coalesce((criterion_entry.n->>'not_evaluated')::bigint,0) > 0 THEN
   derived := derived || jsonb_build_array(jsonb_build_object('code','judgment_not_recorded','criterion_id',criterion_entry.criterion_id,'count',(criterion_entry.n->>'not_evaluated')::bigint));
  END IF;
  IF coalesce((criterion_entry.n->>'met_unreviewed')::bigint,0) > 0 THEN
   derived := derived || jsonb_build_array(jsonb_build_object('code','unreviewed_model_judgments','criterion_id',criterion_entry.criterion_id,'count',(criterion_entry.n->>'met_unreviewed')::bigint));
  END IF;
  unreviewed := unreviewed + coalesce((criterion_entry.n->>'met_unreviewed')::bigint,0);
  human := human + coalesce((criterion_entry.n->>'human_replaced')::bigint,0);
  pending := pending + coalesce((criterion_entry.n->>'pending')::bigint,0);
  undisposed := undisposed + coalesce((criterion_entry.n->>'undisposed')::bigint,0);
  superseded := superseded + coalesce((criterion_entry.n->>'superseded')::bigint,0);
 END LOOP;
 IF (NEW.human_replaced, NEW.pending_reconsideration, NEW.undisposed, NEW.superseded) IS DISTINCT FROM (human::integer, pending::integer, undisposed::integer, superseded::integer) THEN
  RAISE EXCEPTION 'an effective summary count is not the stored count: reviews' USING ERRCODE='23514';
 END IF;
 IF failing IS DISTINCT FROM NEW.failing_subjects::bigint THEN RAISE EXCEPTION 'an effective summary count is not the stored count: failing_subjects' USING ERRCODE='23514'; END IF;
 IF unresolved_count IS DISTINCT FROM NEW.unresolved_subjects::bigint THEN RAISE EXCEPTION 'an effective summary count is not the stored count: unresolved_subjects' USING ERRCODE='23514'; END IF;
 IF meets IS DISTINCT FROM NEW.meets_every_applicable::bigint THEN RAISE EXCEPTION 'an effective summary count is not the stored count: meets_every_applicable' USING ERRCODE='23514'; END IF;
 IF not_applicable IS DISTINCT FROM NEW.not_applicable_to_any::bigint THEN RAISE EXCEPTION 'an effective summary count is not the stored count: not_applicable_to_any' USING ERRCODE='23514'; END IF;
 IF failing_opportunities IS DISTINCT FROM NEW.failing_opportunities::numeric THEN RAISE EXCEPTION 'an effective summary count is not the stored count: failing_opportunities' USING ERRCODE='23514'; END IF;
 -- The rest of the 24.2 coverage limitations, in their order.
 IF NEW.sample_id IS NOT NULL THEN derived := derived || jsonb_build_array(jsonb_build_object('code','sample_selected_only','criterion_id',NULL,'count',NEW.selected)); END IF;
 IF scope_unknown > 0 AND NEW.sample_id IS NULL THEN derived := derived || jsonb_build_array(jsonb_build_object('code','scope_unknown','criterion_id',NULL,'count',scope_unknown)); END IF;
 IF unkeyed > 0 AND NEW.sample_id IS NULL THEN derived := derived || jsonb_build_array(jsonb_build_object('code','unkeyed_rows','criterion_id',NULL,'count',unkeyed)); END IF;
 IF coalesce(jsonb_typeof(population.document->'period_column'),'null') = 'null' THEN
  derived := derived || jsonb_build_array(jsonb_build_object('code','period_not_checked','criterion_id',NULL,'count',NULL));
 END IF;
 IF coalesce((population.document->>'naive_date_times')::bigint,0) > 0 THEN
  derived := derived || jsonb_build_array(jsonb_build_object('code','naive_date_times','criterion_id',NULL,'count',(population.document->>'naive_date_times')::bigint));
 END IF;
 IF jsonb_typeof(inner_summary->'limitations') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'an effective summary states exactly the coverage limitations its counts give' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',e->'code','criterion_id',e->'criterion_id','count',e->'count') ORDER BY n), '[]'::jsonb)
  INTO stated FROM jsonb_array_elements(inner_summary->'limitations') WITH ORDINALITY t(e,n);
 IF stated IS DISTINCT FROM derived THEN
  RAISE EXCEPTION 'an effective summary states exactly the coverage limitations its counts give' USING ERRCODE='23514';
 END IF;

 -- The closed 24.2 conclusion its counts allow: a met that is an
 -- unreviewed model proposal never proves that no exception exists.
 unresolved := NEW.unresolved_subjects + CASE WHEN NEW.sample_id IS NULL THEN scope_unknown + unkeyed ELSE 0 END;
 expected := CASE
  WHEN NEW.completeness <> 'complete' AND (inner_summary->>'received_rows')::numeric = 0 THEN 'no_items_found_absence_not_proven'
  WHEN NEW.failing_subjects > 0 THEN CASE WHEN unresolved > 0 OR NEW.completeness <> 'complete' THEN 'exceptions_found_inconclusive' ELSE 'exceptions_found' END
  WHEN NEW.completeness = 'complete' AND unresolved = 0 AND NEW.meets_every_applicable = 0 THEN 'no_eligible_items'
  WHEN NEW.completeness = 'complete' AND NEW.sample_id IS NULL AND unresolved = 0 AND unreviewed = 0 THEN 'no_exception_found'
  ELSE 'inconclusive' END;
 IF inner_summary->>'conclusion' IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'an effective summary concludes only what its counts allow: %', expected USING ERRCODE='23514';
 END IF;
 -- The exceptions of its own subjects under its basis's criterion lineages,
 -- by derived status.
 ids := ARRAY(SELECT x.id FROM public.assessment_exceptions x
   WHERE (x.organisation_id,x.client_id,x.engagement_id,x.task_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id)
     AND x.subject IN (SELECT pg_catalog.unnest(domain))
     AND x.criterion_root IN (SELECT r.root FROM public.assessment_basis_criteria k
       JOIN public.assessment_task_criterion_roots(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id) r ON r.criterion_id=k.criterion_id
       WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id)));
 WITH x AS MATERIALIZED (SELECT * FROM public.assessment_exception_statuses(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id,ids))
 SELECT count(*) AS total,
   count(*) FILTER (WHERE x.status='open') AS open,
   count(*) FILTER (WHERE x.status='resolved_by_evidence') AS resolved,
   count(*) FILTER (WHERE x.status='replaced_by_human_judgment') AS replaced,
   count(*) FILTER (WHERE x.status='closed_by_disposition') AS closed,
   count(DISTINCT x.subject) AS subjects,
   (SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'subject',l.subject,'criterion_root',l.criterion_root,'status',l.status,'latest_observed',l.latest_observed)
       ORDER BY l.subject COLLATE "C", l.criterion_root COLLATE "C", l.id COLLATE "C"), '[]'::jsonb)
     FROM (SELECT * FROM x ORDER BY x.subject COLLATE "C", x.criterion_root COLLATE "C", x.id COLLATE "C" LIMIT 50) l) AS listed
  INTO counted FROM x;
 IF (NEW.exceptions_total, NEW.exceptions_open, NEW.exceptions_resolved, NEW.exceptions_replaced, NEW.exceptions_closed, NEW.exception_subjects)
    IS DISTINCT FROM (counted.total::integer, counted.open::integer, counted.resolved::integer, counted.replaced::integer, counted.closed::integer, counted.subjects::integer)
    OR jsonb_typeof(outer_summary->'exceptions'->'total') IS DISTINCT FROM 'number' OR jsonb_typeof(outer_summary->'exceptions'->'open') IS DISTINCT FROM 'number'
    OR jsonb_typeof(outer_summary->'exceptions'->'resolved_by_evidence') IS DISTINCT FROM 'number' OR jsonb_typeof(outer_summary->'exceptions'->'replaced_by_human_judgment') IS DISTINCT FROM 'number'
    OR jsonb_typeof(outer_summary->'exceptions'->'closed_by_disposition') IS DISTINCT FROM 'number' OR jsonb_typeof(outer_summary->'exceptions'->'subjects') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'an effective summary count is not the stored count: exceptions' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e->'id','subject',e->'subject','criterion_root',e->'criterion_root','status',e->'status','latest_observed',e->'latest_observed') ORDER BY n), '[]'::jsonb)
  INTO stated FROM jsonb_array_elements(outer_summary->'listed') WITH ORDINALITY t(e,n);
 IF stated IS DISTINCT FROM counted.listed THEN
  RAISE EXCEPTION 'an effective summary lists the first 50 exceptions with their derived status' USING ERRCODE='23514';
 END IF;
 -- The effective conclusion: the 24.2 conclusion, but never that no
 -- exception was found while one of its subjects' exceptions is open.
 effective_expected := CASE WHEN expected = 'no_exception_found' AND counted.open > 0 THEN 'inconclusive' ELSE expected END;
 IF NEW.conclusion IS DISTINCT FROM effective_expected THEN
  RAISE EXCEPTION 'an effective summary concludes only what its counts allow: %', effective_expected USING ERRCODE='23514';
 END IF;
 -- The closed limitations its counts give, in their order.
 derived := '[]'::jsonb;
 IF NEW.completeness <> 'complete' THEN derived := derived || jsonb_build_array(jsonb_build_object('code','population_incomplete','count',NULL)); END IF;
 IF NEW.unresolved_subjects > 0 THEN derived := derived || jsonb_build_array(jsonb_build_object('code','unresolved_subjects','count',NEW.unresolved_subjects)); END IF;
 IF pending > 0 THEN derived := derived || jsonb_build_array(jsonb_build_object('code','pending_reconsideration','count',pending)); END IF;
 IF undisposed > 0 THEN derived := derived || jsonb_build_array(jsonb_build_object('code','unreviewed_model_proposals','count',undisposed)); END IF;
 IF superseded > 0 THEN derived := derived || jsonb_build_array(jsonb_build_object('code','superseded_inputs_not_reevaluated','count',superseded)); END IF;
 IF counted.open > 0 THEN derived := derived || jsonb_build_array(jsonb_build_object('code','open_exceptions','count',counted.open)); END IF;
 IF NEW.sample_id IS NOT NULL THEN derived := derived || jsonb_build_array(jsonb_build_object('code','sample_only','count',NEW.selected)); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',e->'code','count',e->'count') ORDER BY n), '[]'::jsonb)
  INTO stated FROM jsonb_array_elements(outer_summary->'limitations') WITH ORDINALITY t(e,n);
 IF stated IS DISTINCT FROM derived THEN
  RAISE EXCEPTION 'an effective summary states exactly the limitations its counts give' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER effective_guard BEFORE INSERT ON public.assessment_effective_summaries FOR EACH ROW EXECUTE FUNCTION public.effective_guard();

-- Every record is an immutable, retained fact, even for the owner: no
-- UPDATE, DELETE or TRUNCATE, except an explicit disposable fixture reset
-- (a session setting) in a database named *_test.
CREATE FUNCTION public.exception_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_OP='DELETE' AND pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'exception records are immutable' USING ERRCODE='23514';
END $body$;
CREATE FUNCTION public.exception_retained() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN NULL;
 END IF;
 RAISE EXCEPTION 'exception records are retained' USING ERRCODE='23514';
END $body$;
DO $immutable$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['assessment_exceptions','assessment_exception_occurrences','assessment_exception_dispositions','assessment_effective_summaries'] LOOP
  EXECUTE format('CREATE TRIGGER exception_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.exception_immutable()',relation);
  EXECUTE format('CREATE TRIGGER exception_retained BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.exception_retained()',relation);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT USING (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)))',relation,relation,relation,relation);
  EXECUTE format('CREATE POLICY scoped_insert ON public.%I FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)) AND actor_id=pg_catalog.current_setting(''zobba.actor_id'',true))',relation,relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $immutable$;
-- Statement-level guards read every new row against whole sets. A
-- transition table and freshly written rows carry no statistics, and plans
-- cached by a session outlive them, so a guard planned with nested loops
-- re-reads whole sets per new row (measured at 5,000 opportunities: 24 s with
-- nested loops, 1 s without). These guards plan hash joins only. The
-- published 24.2 batch guard (unchanged code) takes the same setting.
ALTER FUNCTION public.coverage_batch() SET enable_nestloop=off;
REVOKE ALL ON FUNCTION public.exception_record(),public.exception_batch(),public.exception_guard(),public.effective_guard(),public.exception_immutable(),public.exception_retained(),public.population_succession() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assessment_criterion_root(text,text,text,text),public.assessment_task_criterion_roots(text,text,text,text),public.assessment_task_population_roots(text,text,text,text),
 public.assessment_exception_key(text,text,text,text,text,text),public.assessment_evidence(jsonb),public.assessment_exception_observations(text,text,text,text,text[]),
 public.assessment_exception_decide(boolean,boolean,text,bigint,text,text,text,text,text[],text,text[],bigint,text,text[]),
 public.assessment_exception_statuses(text,text,text,text,text[]),public.assessment_exception_status(text,text,text,text),public.assessment_effective_outcomes(text,text,text,text) FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=21) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=21;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
