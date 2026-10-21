-- Story 24.3b: Task-scoped exceptions and the effective summary. Additive:
-- published schemas 1-20 are unchanged. Every not_met result (a 24.1
-- evaluation, a 24.3a revision, a 24.2 opportunity, or a person's
-- `replaced not_met` disposition) adds one immutable occurrence to the
-- exception of its criterion lineage and subject, written by trusted code in
-- the same statement that records the result. An exception's status is never
-- stored: `assessment_exception_status` derives it from the occurrences, the
-- current observations of its lineage and subject, and the exception
-- dispositions an Audit manager or the Task's accountable person saved. An
-- effective summary is the 24.2 partition over the current revisions and
-- dispositions (`assessment_effective_outcomes`), with exception counts by
-- derived status; the database recounts every number and refuses a summary
-- that disagrees. No waiver, no confidence column, no percentage.
-- `*_us` columns are database time in microseconds.

-- ------------------------------------------------------------ helpers
-- Read-only, SECURITY INVOKER helpers: each reads only what the caller's
-- own scope (forced RLS) shows, so the runtime may call them.

-- The root of a criterion version's lineage (at most 64 earlier versions,
-- refused beyond that when a version is proposed). NULL for an unknown ID.
CREATE FUNCTION public.assessment_criterion_root(org text, client text, engagement text, criterion text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE walker text := criterion; up text; hops integer := 0;
BEGIN
 LOOP
  SELECT c.supersedes INTO up FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(org,client,engagement,walker);
  IF NOT FOUND THEN
   RETURN NULL;
  END IF;
  EXIT WHEN up IS NULL OR hops >= 64;
  walker := up;
  hops := hops + 1;
 END LOOP;
 RETURN walker;
END $body$;

-- A population version and its earlier versions (at most 64 steps up).
CREATE FUNCTION public.assessment_population_lineage(org text, client text, engagement text, population text) RETURNS SETOF text
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE walker text := population; hops integer := 0;
BEGIN
 WHILE walker IS NOT NULL AND hops <= 64 LOOP
  RETURN NEXT walker;
  SELECT p.supersedes INTO walker FROM public.assessment_populations p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(org,client,engagement,walker);
  IF NOT FOUND THEN
   walker := NULL;
  END IF;
  hops := hops + 1;
 END LOOP;
END $body$;

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
-- its effective origin, the evidence it read and its database time.
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
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((source_kind = 'opportunity') = (population_id IS NOT NULL) AND (population_id IS NULL) = (member_ordinal IS NULL)),
 CHECK((source_kind = 'disposition') = (origin = 'human')),
 PRIMARY KEY(organisation_id,client_id,engagement_id,exception_id,source_kind,source_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,exception_id) REFERENCES public.assessment_exceptions(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_exception_occurrences_time ON public.assessment_exception_occurrences(organisation_id,client_id,engagement_id,exception_id,source_us);

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
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK(coalesce(document->>'record'='exception_disposition' AND document->>'id'=id AND document->>'task_id'=task_id AND document->>'actor_id'=actor_id
   AND document->>'key'=key AND document->>'exception_id'=exception_id AND document->>'kind'=kind AND document->>'rationale'=rationale
   AND jsonb_typeof(document->'references')='array' AND jsonb_array_length(document->'references') <= 8
   -- A closure cites at least one verified reference.
   AND (kind <> 'closed' OR jsonb_array_length(document->'references') >= 1), false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,actor_id,key),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,exception_id) REFERENCES public.assessment_exceptions(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX assessment_exception_dispositions_exception ON public.assessment_exception_dispositions(organisation_id,client_id,engagement_id,exception_id,created_us);

-- An effective summary version: the 24.2 partition over the current
-- revisions and dispositions, with exception counts by derived status. It
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
 CHECK(exceptions_open + exceptions_resolved + exceptions_replaced + exceptions_closed = exceptions_total AND exception_subjects <= exceptions_total),
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
   AND document->'effective'->'summary'->>'conclusion'=conclusion
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
   AND jsonb_typeof(document->'effective'->'limitations')='array' AND jsonb_array_length(document->'effective'->'limitations') <= 6
   AND NOT jsonb_path_exists(document->'effective'->'limitations', '$[*] ? (!(@.code == "population_incomplete" || @.code == "unresolved_subjects" || @.code == "pending_reconsideration" || @.code == "unreviewed_model_proposals" || @.code == "superseded_inputs_not_reevaluated" || @.code == "sample_only"))')
   AND NOT jsonb_path_exists(document->'effective'->'listed', '$[*] ? (!(@.status == "open" || @.status == "resolved_by_evidence" || @.status == "replaced_by_human_judgment" || @.status == "closed_by_disposition"))'), false)),
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

-- The current observations of one exception's criterion lineage and
-- subject: every evaluation chain head under its newest disposition (a
-- person's `replaced` gives the person's verdict, origin human), and for the
-- latest version of every population lineage that held an opportunity of
-- the lineage and subject, its rule opportunity, or `absent` when it no
-- longer holds the subject in scope. A judgment opportunity is its chain
-- head (listed once, as the chain). Evidence lists are sorted and distinct.
CREATE FUNCTION public.assessment_exception_observations(org text, client text, engagement text, exception text)
RETURNS TABLE(kind text, id text, at_us bigint, verdict text, execution text, origin text, causes text[], criterion_id text, evidence text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 WITH x AS (SELECT x.task_id, x.criterion_root, x.subject FROM public.assessment_exceptions x
     WHERE (x.organisation_id,x.client_id,x.engagement_id,x.id)=(org,client,engagement,exception)),
  heads AS (
   SELECT coalesce(r.id,e.id) AS head_id, coalesce(r.created_us,e.created_us) AS head_us,
     CASE WHEN r.id IS NULL THEN e.verdict ELSE r.verdict END AS verdict,
     coalesce(r.execution,e.execution) AS execution, coalesce(r.origin,e.origin) AS origin,
     coalesce(r.causes,ARRAY[]::text[]) AS causes, coalesce(r.criterion_id,e.criterion_id) AS criterion_id,
     public.assessment_evidence(coalesce(r.document,e.document)->'inputs') AS evidence
   FROM public.assessment_evaluations e JOIN x ON e.task_id=x.task_id AND e.subject=x.subject
   LEFT JOIN LATERAL (SELECT v.id,v.created_us,v.verdict,v.execution,v.origin,v.causes,v.criterion_id,v.document FROM public.assessment_evaluation_revisions v
     WHERE (v.organisation_id,v.client_id,v.engagement_id,v.chain_id)=(org,client,engagement,e.id) ORDER BY v.revision DESC LIMIT 1) r ON true
   WHERE (e.organisation_id,e.client_id,e.engagement_id)=(org,client,engagement)
     AND public.assessment_criterion_root(org,client,engagement,e.criterion_id)=x.criterion_root),
  chains AS (
   SELECT 'chain'::text AS kind, h.head_id AS id, greatest(h.head_us, coalesce(d.created_us,h.head_us)) AS at_us,
     CASE WHEN d.kind='replaced' AND h.origin='model_proposal' THEN d.verdict ELSE h.verdict END AS verdict,
     h.execution, CASE WHEN d.kind='replaced' AND h.origin='model_proposal' THEN 'human' ELSE h.origin END AS origin,
     h.causes, h.criterion_id, h.evidence
   FROM heads h LEFT JOIN LATERAL (SELECT y.kind,y.verdict,y.created_us FROM public.assessment_dispositions y
     WHERE (y.organisation_id,y.client_id,y.engagement_id,y.revision_id)=(org,client,engagement,h.head_id)
     ORDER BY y.created_us DESC, y.id COLLATE "C" DESC LIMIT 1) d ON true),
  tips AS (
   SELECT p.id, p.created_us FROM public.assessment_populations p JOIN x ON p.task_id=x.task_id
   WHERE (p.organisation_id,p.client_id,p.engagement_id)=(org,client,engagement)
     AND NOT EXISTS(SELECT 1 FROM public.assessment_populations q WHERE (q.organisation_id,q.client_id,q.engagement_id,q.supersedes)=(org,client,engagement,p.id))
     AND EXISTS(SELECT 1 FROM public.assessment_population_lineage(org,client,engagement,p.id) l(id)
       JOIN public.assessment_opportunities o ON (o.organisation_id,o.client_id,o.engagement_id,o.population_id)=(org,client,engagement,l.id)
       WHERE o.subject=x.subject AND public.assessment_criterion_root(org,client,engagement,o.criterion_id)=x.criterion_root)),
  rules AS (
   SELECT 'opportunity'::text AS kind, o.population_id||'#'||o.criterion_id||'#'||o.member_ordinal AS id, o.created_us AS at_us,
     o.verdict, o.execution, o.origin, ARRAY[]::text[] AS causes, o.criterion_id, public.assessment_evidence(o.inputs) AS evidence
   FROM tips t JOIN public.assessment_opportunities o ON (o.organisation_id,o.client_id,o.engagement_id,o.population_id)=(org,client,engagement,t.id)
   JOIN x ON o.subject=x.subject
   WHERE o.evaluation_id IS NULL AND public.assessment_criterion_root(org,client,engagement,o.criterion_id)=x.criterion_root),
  absent AS (
   SELECT 'absent'::text AS kind, t.id, t.created_us AS at_us, NULL::text AS verdict, NULL::text AS execution, NULL::text AS origin,
     ARRAY[]::text[] AS causes, NULL::text AS criterion_id, ARRAY[]::text[] AS evidence
   FROM tips t CROSS JOIN x
   WHERE NOT EXISTS(SELECT 1 FROM public.assessment_population_members m
     WHERE (m.organisation_id,m.client_id,m.engagement_id,m.population_id)=(org,client,engagement,t.id) AND m.subject=x.subject AND m.disposition='in_scope'))
 SELECT * FROM chains UNION ALL SELECT * FROM rules UNION ALL SELECT * FROM absent
$body$;

-- The derived status of one exception and whether its latest observation
-- shows it failing (`zobba_domain::exception::exception_status`):
-- closed_by_disposition while no occurrence is newer than the closure;
-- replaced_by_human_judgment when the latest observation is a person's
-- verdict that is not not_met; resolved_by_evidence when it is a completed
-- met, not a person's, newer than the failing occurrence, reading other
-- evidence, from a revision caused by changed inputs or a revised basis or a
-- later read of the same criterion; open otherwise.
CREATE FUNCTION public.assessment_exception_status(org text, client text, engagement text, exception text)
RETURNS TABLE(status text, latest_observed text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE l_kind text; l_at bigint; l_verdict text; l_execution text; l_origin text; l_causes text[]; l_criterion text; l_evidence text[];
 o_at bigint; o_criterion text; o_evidence text[]; d_kind text; d_at bigint;
BEGIN
 SELECT o.kind, o.at_us, o.verdict, o.execution, o.origin, o.causes, o.criterion_id, o.evidence
   INTO l_kind, l_at, l_verdict, l_execution, l_origin, l_causes, l_criterion, l_evidence
   FROM public.assessment_exception_observations(org,client,engagement,exception) o ORDER BY o.at_us DESC, o.id COLLATE "C" DESC LIMIT 1;
 SELECT x.source_us, x.criterion_id, x.evidence INTO o_at, o_criterion, o_evidence
   FROM public.assessment_exception_occurrences x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.exception_id)=(org,client,engagement,exception)
   ORDER BY x.source_us DESC, x.source_id COLLATE "C" DESC LIMIT 1;
 SELECT d.kind, d.created_us INTO d_kind, d_at
   FROM public.assessment_exception_dispositions d WHERE (d.organisation_id,d.client_id,d.engagement_id,d.exception_id)=(org,client,engagement,exception)
   ORDER BY d.created_us DESC, d.id COLLATE "C" DESC LIMIT 1;
 latest_observed := CASE WHEN l_verdict IS NOT DISTINCT FROM 'not_met' THEN 'not_met' ELSE 'not_observed' END;
 IF d_kind IS NOT DISTINCT FROM 'closed' AND o_at <= d_at THEN
  status := 'closed_by_disposition';
 ELSIF l_kind IS NULL THEN
  status := 'open';
 ELSIF l_origin IS NOT DISTINCT FROM 'human' AND l_verdict IS DISTINCT FROM 'not_met' THEN
  status := 'replaced_by_human_judgment';
 ELSIF l_verdict IS NOT DISTINCT FROM 'met' AND l_execution IS NOT DISTINCT FROM 'completed' AND l_origin IS DISTINCT FROM 'human'
   AND l_at > o_at AND l_evidence IS DISTINCT FROM o_evidence
   AND ((l_kind='chain' AND l_causes && ARRAY['inputs_changed','basis_revised']::text[])
     OR (l_kind='opportunity' AND l_criterion IS NOT DISTINCT FROM o_criterion)) THEN
  status := 'resolved_by_evidence';
 ELSE
  status := 'open';
 END IF;
 RETURN NEXT;
END $body$;

-- The effective outcome of every opportunity of one population: a judgment
-- opportunity resolves to its chain head under the head's newest
-- disposition (a person's `replaced` gives the person's verdict with origin
-- human and no reason); a rule opportunity is itself. `review` is the head's
-- review state; `superseded` says the head reads a basis version a later
-- version supersedes.
CREATE FUNCTION public.assessment_effective_outcomes(org text, client text, engagement text, population text)
RETURNS TABLE(criterion_id text, member_ordinal integer, subject text, applicability text, execution text, verdict text, reason text, origin text, review text, head_id text, superseded boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
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
-- its exception, exactly as the writer trigger below records new ones. The
-- migration owner reads the published records with their forced RLS lifted
-- for this transaction only (restored below); nothing published changes.
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
  SELECT o.organisation_id, o.client_id, o.engagement_id, o.task_id, o.actor_id, 'opportunity', o.population_id||'#'||o.criterion_id||'#'||o.member_ordinal,
    o.population_id, o.member_ordinal, o.criterion_id, p.basis_id, o.origin, public.assessment_evidence(o.inputs), o.subject, o.created_us
  FROM public.assessment_opportunities o JOIN public.assessment_populations p ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(o.organisation_id,o.client_id,o.engagement_id,o.population_id)
  WHERE o.verdict='not_met'
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
INSERT INTO public.assessment_exception_occurrences(organisation_id,client_id,engagement_id,task_id,actor_id,exception_id,source_kind,source_id,population_id,member_ordinal,criterion_id,basis_id,origin,evidence,source_us,created_us)
 SELECT b.organisation_id,b.client_id,b.engagement_id,b.task_id,b.actor_id,
   public.assessment_exception_key(b.organisation_id,b.client_id,b.engagement_id,b.task_id,b.root,b.subject),
   b.source_kind,b.source_id,b.population_id,b.member_ordinal,b.criterion_id,b.basis_id,b.origin,b.evidence,b.source_us,b.source_us
 FROM public.zobba_not_met_results() b;
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
-- insert of exceptions and one of occurrences.
CREATE FUNCTION public.exception_record() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE staged jsonb;
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
  SELECT jsonb_agg(jsonb_build_object('organisation_id',a.organisation_id,'client_id',a.client_id,'engagement_id',a.engagement_id,'task_id',a.task_id,'actor_id',a.actor_id,
    'source_kind','opportunity','source_id',a.population_id||'#'||a.criterion_id||'#'||a.member_ordinal,'population_id',a.population_id,'member_ordinal',a.member_ordinal,
    'criterion_id',a.criterion_id,'basis_id',p.basis_id,'origin',a.origin,
    'evidence',to_jsonb(public.assessment_evidence(a.inputs)),'subject',a.subject,'source_us',a.created_us))
   INTO staged FROM added a JOIN public.assessment_populations p ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(a.organisation_id,a.client_id,a.engagement_id,a.population_id)
   WHERE a.verdict='not_met';
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
 WITH s AS (SELECT r.*, public.assessment_criterion_root(r.organisation_id,r.client_id,r.engagement_id,r.criterion_id) AS root
   FROM jsonb_to_recordset(staged) AS r(organisation_id text, client_id text, engagement_id text, task_id text, actor_id text, source_kind text, source_id text,
     population_id text, member_ordinal integer, criterion_id text, basis_id text, origin text, evidence text[], subject text, source_us bigint))
 INSERT INTO public.assessment_exceptions(organisation_id,client_id,engagement_id,task_id,actor_id,id,kind,criterion_root,subject,first_source_kind,first_source_id)
  SELECT DISTINCT ON (s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.root,s.subject COLLATE "C")
    s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.actor_id,
    public.assessment_exception_key(s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.root,s.subject),
    'criterion_not_met',s.root,s.subject,s.source_kind,s.source_id
  FROM s
  ORDER BY s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.root,s.subject COLLATE "C",s.source_us,s.source_id COLLATE "C"
  ON CONFLICT DO NOTHING;
 WITH s AS (SELECT r.*, public.assessment_criterion_root(r.organisation_id,r.client_id,r.engagement_id,r.criterion_id) AS root
   FROM jsonb_to_recordset(staged) AS r(organisation_id text, client_id text, engagement_id text, task_id text, actor_id text, source_kind text, source_id text,
     population_id text, member_ordinal integer, criterion_id text, basis_id text, origin text, evidence text[], subject text, source_us bigint))
 INSERT INTO public.assessment_exception_occurrences(organisation_id,client_id,engagement_id,task_id,actor_id,exception_id,source_kind,source_id,population_id,member_ordinal,criterion_id,basis_id,origin,evidence,source_us)
  SELECT s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.actor_id,
    public.assessment_exception_key(s.organisation_id,s.client_id,s.engagement_id,s.task_id,s.root,s.subject),
    s.source_kind,s.source_id,s.population_id,s.member_ordinal,s.criterion_id,s.basis_id,s.origin,s.evidence,s.source_us
  FROM s;
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
-- them; a direct insert that differs in any column is refused).
CREATE FUNCTION public.exception_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_TABLE_NAME='assessment_exceptions' THEN
  IF EXISTS(SELECT 1 FROM added a
     WHERE a.id IS DISTINCT FROM public.assessment_exception_key(a.organisation_id,a.client_id,a.engagement_id,a.task_id,a.criterion_root,a.subject)
       OR public.assessment_criterion_root(a.organisation_id,a.client_id,a.engagement_id,a.criterion_root) IS DISTINCT FROM a.criterion_root
       OR NOT EXISTS(SELECT 1 FROM public.assessment_criteria c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(a.organisation_id,a.client_id,a.engagement_id,a.criterion_root) AND c.task_id=a.task_id)) THEN
   RAISE EXCEPTION 'an exception is named by its Task, criterion lineage root and subject' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM added a WHERE NOT (
       (a.first_source_kind='evaluation' AND EXISTS(SELECT 1 FROM public.assessment_evaluations e WHERE (e.organisation_id,e.client_id,e.engagement_id,e.id)=(a.organisation_id,a.client_id,a.engagement_id,a.first_source_id)
          AND e.task_id=a.task_id AND e.subject=a.subject AND e.verdict='not_met' AND public.assessment_criterion_root(a.organisation_id,a.client_id,a.engagement_id,e.criterion_id)=a.criterion_root))
    OR (a.first_source_kind='revision' AND EXISTS(SELECT 1 FROM public.assessment_evaluation_revisions r WHERE (r.organisation_id,r.client_id,r.engagement_id,r.id)=(a.organisation_id,a.client_id,a.engagement_id,a.first_source_id)
          AND r.task_id=a.task_id AND r.subject=a.subject AND r.verdict='not_met' AND public.assessment_criterion_root(a.organisation_id,a.client_id,a.engagement_id,r.criterion_id)=a.criterion_root))
    OR (a.first_source_kind='opportunity' AND EXISTS(SELECT 1 FROM public.assessment_opportunities o WHERE (o.organisation_id,o.client_id,o.engagement_id)=(a.organisation_id,a.client_id,a.engagement_id)
          AND o.population_id||'#'||o.criterion_id||'#'||o.member_ordinal=a.first_source_id
          AND o.task_id=a.task_id AND o.subject=a.subject AND o.verdict='not_met' AND public.assessment_criterion_root(a.organisation_id,a.client_id,a.engagement_id,o.criterion_id)=a.criterion_root))
    OR (a.first_source_kind='disposition' AND EXISTS(SELECT 1 FROM public.assessment_dispositions d JOIN public.assessment_evaluations c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(d.organisation_id,d.client_id,d.engagement_id,d.chain_id)
          WHERE (d.organisation_id,d.client_id,d.engagement_id,d.id)=(a.organisation_id,a.client_id,a.engagement_id,a.first_source_id)
          AND d.task_id=a.task_id AND c.subject=a.subject AND d.kind='replaced' AND d.verdict='not_met' AND public.assessment_criterion_root(a.organisation_id,a.client_id,a.engagement_id,c.criterion_id)=a.criterion_root)))) THEN
   RAISE EXCEPTION 'an exception begins with a not_met result of its lineage and subject' USING ERRCODE='23514';
  END IF;
 ELSE
  -- The expected occurrence of each new row, derived from its source.
  IF EXISTS(SELECT 1 FROM added a
     LEFT JOIN public.assessment_exceptions x ON (x.organisation_id,x.client_id,x.engagement_id,x.id)=(a.organisation_id,a.client_id,a.engagement_id,a.exception_id)
     LEFT JOIN LATERAL (
       SELECT e.task_id, e.actor_id, e.subject, NULL::text AS population_id, NULL::integer AS member_ordinal, e.criterion_id, e.basis_id, e.origin,
         public.assessment_evidence(e.document->'inputs') AS evidence, e.created_us AS source_us
       FROM public.assessment_evaluations e WHERE a.source_kind='evaluation' AND (e.organisation_id,e.client_id,e.engagement_id,e.id)=(a.organisation_id,a.client_id,a.engagement_id,a.source_id) AND e.verdict='not_met'
       UNION ALL
       SELECT r.task_id, r.actor_id, r.subject, NULL, NULL, r.criterion_id, r.basis_id, r.origin, public.assessment_evidence(r.document->'inputs'), r.created_us
       FROM public.assessment_evaluation_revisions r WHERE a.source_kind='revision' AND (r.organisation_id,r.client_id,r.engagement_id,r.id)=(a.organisation_id,a.client_id,a.engagement_id,a.source_id) AND r.verdict='not_met'
       UNION ALL
       SELECT o.task_id, o.actor_id, o.subject, o.population_id, o.member_ordinal, o.criterion_id, p.basis_id, o.origin, public.assessment_evidence(o.inputs), o.created_us
       FROM public.assessment_opportunities o JOIN public.assessment_populations p ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(o.organisation_id,o.client_id,o.engagement_id,o.population_id)
       WHERE a.source_kind='opportunity' AND (o.organisation_id,o.client_id,o.engagement_id,o.population_id,o.criterion_id,o.member_ordinal)=(a.organisation_id,a.client_id,a.engagement_id,a.population_id,a.criterion_id,a.member_ordinal)
         AND o.population_id||'#'||o.criterion_id||'#'||o.member_ordinal=a.source_id AND o.verdict='not_met'
       UNION ALL
       SELECT d.task_id, d.actor_id, c.subject, NULL, NULL, h.criterion_id, h.basis_id, 'human', public.assessment_evidence(h.document->'inputs'), d.created_us
       FROM public.assessment_dispositions d
       JOIN public.assessment_evaluations c ON (c.organisation_id,c.client_id,c.engagement_id,c.id)=(d.organisation_id,d.client_id,d.engagement_id,d.chain_id)
       JOIN LATERAL (SELECT e.criterion_id, e.basis_id, e.document FROM public.assessment_evaluations e WHERE (e.organisation_id,e.client_id,e.engagement_id,e.id)=(d.organisation_id,d.client_id,d.engagement_id,d.revision_id)
         UNION ALL SELECT v.criterion_id, v.basis_id, v.document FROM public.assessment_evaluation_revisions v WHERE (v.organisation_id,v.client_id,v.engagement_id,v.id)=(d.organisation_id,d.client_id,d.engagement_id,d.revision_id)) h ON true
       WHERE a.source_kind='disposition' AND (d.organisation_id,d.client_id,d.engagement_id,d.id)=(a.organisation_id,a.client_id,a.engagement_id,a.source_id) AND d.kind='replaced' AND d.verdict='not_met'
     ) s ON true
     WHERE s.task_id IS NULL OR x.id IS NULL
       OR (a.task_id,a.actor_id) IS DISTINCT FROM (s.task_id,s.actor_id) OR x.task_id IS DISTINCT FROM a.task_id
       OR x.subject IS DISTINCT FROM s.subject
       OR x.criterion_root IS DISTINCT FROM public.assessment_criterion_root(a.organisation_id,a.client_id,a.engagement_id,s.criterion_id)
       OR (a.population_id,a.member_ordinal,a.criterion_id,a.basis_id,a.origin,a.source_us) IS DISTINCT FROM (s.population_id,s.member_ordinal,s.criterion_id,s.basis_id,s.origin,s.source_us)
       OR a.evidence IS DISTINCT FROM s.evidence) THEN
   RAISE EXCEPTION 'an occurrence is exactly the not_met result it names, in its exception' USING ERRCODE='23514';
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
-- exception that is not closed; a reopening only one that is.
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
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('exception:'||NEW.organisation_id||'/'||NEW.client_id||'/'||NEW.engagement_id||'/'||NEW.exception_id, 0));
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
 RETURN NEW;
END $body$;
CREATE TRIGGER exception_guard BEFORE INSERT ON public.assessment_exception_dispositions FOR EACH ROW EXECUTE FUNCTION public.exception_guard();

-- An effective summary agrees with what trusted code recorded: it belongs
-- to its answer invocation of this Task under that turn's binding, reads a
-- population of its basis (and a sample of it), supersedes the newest
-- effective summary of that population and sample, and every count is the
-- exact SQL recount over the stored members, `assessment_effective_outcomes`
-- and `assessment_exception_status`. The conclusion and the limitations are
-- the ones those counts allow.
CREATE FUNCTION public.effective_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE population public.assessment_populations%ROWTYPE; recount record; partitioned record; counted record;
 inner_summary jsonb := NEW.document->'effective'->'summary'; outer_summary jsonb := NEW.document->'effective';
 entry jsonb; extra jsonb; position_in_basis integer; expected text; unresolved integer; subjects integer; criteria integer;
 unreviewed bigint := 0; pending bigint := 0; undisposed bigint := 0; superseded bigint := 0; human bigint := 0;
 newest text; stated jsonb; derived jsonb; scope_unknown bigint; unkeyed bigint;
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
 SELECT count(*) INTO subjects FROM public.assessment_population_members m
  WHERE (m.organisation_id,m.client_id,m.engagement_id,m.population_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id)
    AND m.disposition='in_scope'
    AND (NEW.sample_id IS NULL OR m.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id)));
 SELECT count(*) INTO criteria FROM public.assessment_basis_criteria k WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id);
 IF jsonb_array_length(inner_summary->'criteria') IS DISTINCT FROM criteria THEN
  RAISE EXCEPTION 'an effective summary counts every criterion of its basis' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.assessment_basis_criteria k
    WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id)
      AND (SELECT count(*) FROM public.assessment_opportunities o WHERE (o.organisation_id,o.client_id,o.engagement_id,o.population_id,o.criterion_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id,k.criterion_id))
          IS DISTINCT FROM population.in_scope::bigint) THEN
  RAISE EXCEPTION 'an effective summary reads every opportunity of every criterion of its basis' USING ERRCODE='23514';
 END IF;
 -- Per criterion, in basis order, recounted over the effective outcomes.
 FOR position_in_basis, entry, extra IN SELECT k.ordinal, inner_summary->'criteria'->k.ordinal, outer_summary->'criteria'->k.ordinal FROM public.assessment_basis_criteria k
    WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id) ORDER BY k.ordinal LOOP
  SELECT k.criterion_id AS criterion_id,
    count(o.*) FILTER (WHERE o.applicability='applicable') AS applicable,
    count(o.*) FILTER (WHERE o.applicability='not_applicable') AS not_applicable,
    count(o.*) FILTER (WHERE o.applicability='applicable' AND o.verdict='met') AS met,
    count(o.*) FILTER (WHERE o.applicability='applicable' AND o.verdict='not_met') AS not_met,
    count(o.*) FILTER (WHERE o.applicability='applicable' AND o.execution='completed' AND o.verdict='undetermined') AS undetermined,
    count(o.*) FILTER (WHERE o.applicability='applicable' AND o.execution='failed') AS execution_failed,
    count(o.*) FILTER (WHERE o.applicability='applicable' AND o.execution='completed' AND o.verdict IS NULL) AS not_evaluated,
    count(o.*) FILTER (WHERE o.applicability='applicable' AND o.verdict='met' AND o.origin='model_proposal') AS met_unreviewed,
    count(o.*) FILTER (WHERE o.review='replaced') AS human_replaced,
    count(o.*) FILTER (WHERE o.review='pending_reconsideration') AS pending,
    count(o.*) FILTER (WHERE o.origin='model_proposal' AND o.review='unreviewed') AS undisposed,
    count(o.*) FILTER (WHERE o.superseded) AS superseded,
    coalesce((SELECT jsonb_object_agg(r.reason, r.n) FROM (SELECT coalesce(o2.reason,'stated_in_words') AS reason, count(*) AS n
       FROM public.assessment_effective_outcomes(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id) o2
       WHERE o2.criterion_id=k.criterion_id
         AND (NEW.sample_id IS NULL OR o2.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id)))
         AND o2.applicability='applicable' AND o2.execution='completed' AND o2.verdict='undetermined' GROUP BY 1) r), '{}'::jsonb) AS by_reason
   INTO recount
   FROM public.assessment_basis_criteria k
   LEFT JOIN public.assessment_effective_outcomes(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id) o ON o.criterion_id=k.criterion_id
     AND (NEW.sample_id IS NULL OR o.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id)))
   WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id,k.ordinal)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id,position_in_basis)
   GROUP BY k.criterion_id;
  IF entry->>'criterion_id' IS DISTINCT FROM recount.criterion_id OR extra->>'criterion_id' IS DISTINCT FROM recount.criterion_id
     OR jsonb_typeof(entry->'applicable') IS DISTINCT FROM 'number' OR (entry->>'applicable')::numeric IS DISTINCT FROM recount.applicable
     OR jsonb_typeof(entry->'not_applicable') IS DISTINCT FROM 'number' OR (entry->>'not_applicable')::numeric IS DISTINCT FROM recount.not_applicable
     OR jsonb_typeof(entry->'applicability_unknown') IS DISTINCT FROM 'number' OR (entry->>'applicability_unknown')::numeric IS DISTINCT FROM subjects - recount.applicable - recount.not_applicable
     OR jsonb_typeof(entry->'met') IS DISTINCT FROM 'number' OR (entry->>'met')::numeric IS DISTINCT FROM recount.met
     OR jsonb_typeof(entry->'not_met') IS DISTINCT FROM 'number' OR (entry->>'not_met')::numeric IS DISTINCT FROM recount.not_met
     OR jsonb_typeof(entry->'undetermined') IS DISTINCT FROM 'number' OR (entry->>'undetermined')::numeric IS DISTINCT FROM recount.undetermined
     OR jsonb_typeof(entry->'execution_failed') IS DISTINCT FROM 'number' OR (entry->>'execution_failed')::numeric IS DISTINCT FROM recount.execution_failed
     OR jsonb_typeof(entry->'not_evaluated') IS DISTINCT FROM 'number' OR (entry->>'not_evaluated')::numeric IS DISTINCT FROM recount.not_evaluated
     OR jsonb_typeof(entry->'met_unreviewed') IS DISTINCT FROM 'number' OR (entry->>'met_unreviewed')::numeric IS DISTINCT FROM recount.met_unreviewed
     OR entry->'undetermined_by_reason' IS DISTINCT FROM recount.by_reason
     OR jsonb_typeof(extra->'human_replaced') IS DISTINCT FROM 'number' OR (extra->>'human_replaced')::numeric IS DISTINCT FROM recount.human_replaced
     OR jsonb_typeof(extra->'pending_reconsideration') IS DISTINCT FROM 'number' OR (extra->>'pending_reconsideration')::numeric IS DISTINCT FROM recount.pending
     OR jsonb_typeof(extra->'undisposed') IS DISTINCT FROM 'number' OR (extra->>'undisposed')::numeric IS DISTINCT FROM recount.undisposed
     OR jsonb_typeof(extra->'superseded') IS DISTINCT FROM 'number' OR (extra->>'superseded')::numeric IS DISTINCT FROM recount.superseded THEN
   RAISE EXCEPTION 'an effective summary count is not the stored count: criterion %', recount.criterion_id USING ERRCODE='23514';
  END IF;
  unreviewed := unreviewed + recount.met_unreviewed;
  human := human + recount.human_replaced;
  pending := pending + recount.pending;
  undisposed := undisposed + recount.undisposed;
  superseded := superseded + recount.superseded;
 END LOOP;
 IF (NEW.human_replaced, NEW.pending_reconsideration, NEW.undisposed, NEW.superseded) IS DISTINCT FROM (human::integer, pending::integer, undisposed::integer, superseded::integer) THEN
  RAISE EXCEPTION 'an effective summary count is not the stored count: reviews' USING ERRCODE='23514';
 END IF;
 -- The subject partition over the effective outcomes (as 24.2).
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
   FROM public.assessment_effective_outcomes(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.population_id) o
   WHERE (NEW.sample_id IS NULL OR o.subject IN (SELECT x.subject FROM public.assessment_sample_members x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.sample_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.sample_id)))
   GROUP BY o.member_ordinal) s;
 IF partitioned.failing IS DISTINCT FROM NEW.failing_subjects::bigint THEN RAISE EXCEPTION 'an effective summary count is not the stored count: failing_subjects' USING ERRCODE='23514'; END IF;
 IF partitioned.unresolved IS DISTINCT FROM NEW.unresolved_subjects::bigint THEN RAISE EXCEPTION 'an effective summary count is not the stored count: unresolved_subjects' USING ERRCODE='23514'; END IF;
 IF partitioned.meets IS DISTINCT FROM NEW.meets_every_applicable::bigint THEN RAISE EXCEPTION 'an effective summary count is not the stored count: meets_every_applicable' USING ERRCODE='23514'; END IF;
 IF partitioned.not_applicable IS DISTINCT FROM NEW.not_applicable_to_any::bigint THEN RAISE EXCEPTION 'an effective summary count is not the stored count: not_applicable_to_any' USING ERRCODE='23514'; END IF;
 IF partitioned.failing_opportunities IS DISTINCT FROM NEW.failing_opportunities::numeric THEN RAISE EXCEPTION 'an effective summary count is not the stored count: failing_opportunities' USING ERRCODE='23514'; END IF;

 -- The closed conclusion its counts allow (the 24.2 rule): a met that is an
 -- unreviewed model proposal never proves that no exception exists.
 unresolved := NEW.unresolved_subjects + CASE WHEN NEW.sample_id IS NULL THEN scope_unknown + unkeyed ELSE 0 END;
 expected := CASE
  WHEN NEW.completeness <> 'complete' AND (inner_summary->>'received_rows')::numeric = 0 THEN 'no_items_found_absence_not_proven'
  WHEN NEW.failing_subjects > 0 THEN CASE WHEN unresolved > 0 OR NEW.completeness <> 'complete' THEN 'exceptions_found_inconclusive' ELSE 'exceptions_found' END
  WHEN NEW.completeness = 'complete' AND unresolved = 0 AND NEW.meets_every_applicable = 0 THEN 'no_eligible_items'
  WHEN NEW.completeness = 'complete' AND NEW.sample_id IS NULL AND unresolved = 0 AND unreviewed = 0 THEN 'no_exception_found'
  ELSE 'inconclusive' END;
 IF NEW.conclusion IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'an effective summary concludes only what its counts allow: %', expected USING ERRCODE='23514';
 END IF;
 IF jsonb_typeof(inner_summary->'limitations') IS DISTINCT FROM 'array'
    OR jsonb_path_exists(inner_summary->'limitations', '$[*] ? (!(@.code == "not_evaluated" || @.code == "judgment_not_recorded" || @.code == "unreviewed_model_judgments" || @.code == "sample_selected_only" || @.code == "scope_unknown" || @.code == "unkeyed_rows" || @.code == "period_not_checked" || @.code == "naive_date_times"))') THEN
  RAISE EXCEPTION 'an effective summary''s coverage limitations are closed codes' USING ERRCODE='23514';
 END IF;
 -- The exceptions of the basis's criterion lineages, by derived status.
 WITH roots AS (SELECT DISTINCT public.assessment_criterion_root(k.organisation_id,k.client_id,k.engagement_id,k.criterion_id) AS root
     FROM public.assessment_basis_criteria k WHERE (k.organisation_id,k.client_id,k.engagement_id,k.basis_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.basis_id)),
   x AS (SELECT x.id, x.subject, x.criterion_root, s.status, s.latest_observed FROM public.assessment_exceptions x
     CROSS JOIN LATERAL public.assessment_exception_status(x.organisation_id,x.client_id,x.engagement_id,x.id) s
     WHERE (x.organisation_id,x.client_id,x.engagement_id,x.task_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id)
       AND x.criterion_root IN (SELECT root FROM roots))
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
    IS DISTINCT FROM (counted.total::integer, counted.open::integer, counted.resolved::integer, counted.replaced::integer, counted.closed::integer, counted.subjects::integer) THEN
  RAISE EXCEPTION 'an effective summary count is not the stored count: exceptions' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e->'id','subject',e->'subject','criterion_root',e->'criterion_root','status',e->'status','latest_observed',e->'latest_observed') ORDER BY n), '[]'::jsonb)
  INTO stated FROM jsonb_array_elements(outer_summary->'listed') WITH ORDINALITY t(e,n);
 IF stated IS DISTINCT FROM counted.listed THEN
  RAISE EXCEPTION 'an effective summary lists the first 50 exceptions with their derived status' USING ERRCODE='23514';
 END IF;
 -- The closed limitations its counts give, in their order.
 derived := '[]'::jsonb;
 IF NEW.completeness <> 'complete' THEN derived := derived || jsonb_build_array(jsonb_build_object('code','population_incomplete','count',NULL)); END IF;
 IF NEW.unresolved_subjects > 0 THEN derived := derived || jsonb_build_array(jsonb_build_object('code','unresolved_subjects','count',NEW.unresolved_subjects)); END IF;
 IF pending > 0 THEN derived := derived || jsonb_build_array(jsonb_build_object('code','pending_reconsideration','count',pending)); END IF;
 IF undisposed > 0 THEN derived := derived || jsonb_build_array(jsonb_build_object('code','unreviewed_model_proposals','count',undisposed)); END IF;
 IF superseded > 0 THEN derived := derived || jsonb_build_array(jsonb_build_object('code','superseded_inputs_not_reevaluated','count',superseded)); END IF;
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
REVOKE ALL ON FUNCTION public.exception_record(),public.exception_batch(),public.exception_guard(),public.effective_guard(),public.exception_immutable(),public.exception_retained() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assessment_criterion_root(text,text,text,text),public.assessment_population_lineage(text,text,text,text),public.assessment_exception_key(text,text,text,text,text,text),
 public.assessment_evidence(jsonb),public.assessment_exception_observations(text,text,text,text),public.assessment_exception_status(text,text,text,text),public.assessment_effective_outcomes(text,text,text,text) FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=21) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=21;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
