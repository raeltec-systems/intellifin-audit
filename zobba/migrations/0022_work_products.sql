-- Story 24.4: firm-shaped work products with supported claims. Additive:
-- published schemas 1-21 are unchanged. The agent drafts a work product on a
-- template of the Task's current method binding; trusted code checks every
-- claim against the records it names before a version is recorded, and this
-- schema checks the same again: every pinned record is one of the version's
-- own Task, every assertion written in a version agrees with its record now
-- (an outcome with the current chain head's effective outcome, a count and a
-- conclusion with the stored summary, an exception status with the derived
-- status, a fact value with the stored canonical value of a supported,
-- grounded fact, a quote with a registered original's digest, a period with
-- its basis), a kept block is byte-equal to its source block, a version's
-- base is the product's latest version under a per-product lock (one
-- successor per version), and the agent never drops or changes a person's
-- block. A person's version is written only in that person's own live
-- session by a currently assigned Auditor or Audit manager (a worker
-- connection holds no session). Versions, blocks, assertions and exports are
-- immutable; whether a claim is current is derived on read, never stored.
-- There is no confidence column and no percentage. `*_us` columns are
-- database time in microseconds.

-- ------------------------------------------------------------ helpers

-- The template of one binding of a Task, as the binding resolved it: its
-- source version, name, whether it is neutral (the built-in starter or a
-- neutral source) and its sections (ID, title, required). `current` says
-- whether the binding is the Task's current one. NULL when the binding or
-- template is not there. The methodology tables are owner-only: this reads
-- them for the caller's own scope only.
CREATE FUNCTION public.work_product_template(org text, client text, engagement text, task text, binding text, template text, version text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
 SELECT jsonb_build_object(
   'current', h.binding_id IS NOT DISTINCT FROM b.id,
   'source_version_id', t.value->>'source_version_id',
   'name', t.value->'template'->>'name',
   'neutral', (t.value->>'source_version_id') = 'builtin_neutral_v1'
     OR coalesce(b.document->'resolution'->'neutral_source_version_ids' ? (t.value->>'source_version_id'), false),
   'sections', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.value->>'id', 'title', x.value->>'title', 'required', (x.value->>'required')::boolean) ORDER BY x.n), '[]'::jsonb)
     FROM jsonb_array_elements(t.value->'template'->'sections') WITH ORDINALITY x(value, n)))
 FROM public.task_methodology_bindings b
 LEFT JOIN public.task_methodology_heads h ON (h.organisation_id,h.task_id)=(b.organisation_id,b.task_id)
 CROSS JOIN LATERAL jsonb_array_elements(b.document->'resolution'->'templates') t(value)
 WHERE org = pg_catalog.current_setting('zobba.organisation_id', true)
   AND client = pg_catalog.current_setting('zobba.client_id', true)
   AND engagement = pg_catalog.current_setting('zobba.engagement_id', true)
   AND (b.organisation_id,b.client_id,b.engagement_id,b.task_id,b.id)=(org,client,engagement,task,binding)
   AND t.value->'template'->>'id' = template AND t.value->'template'->>'version' = version
 LIMIT 1
$body$;

-- The Task's current methodology binding (its head), or NULL.
CREATE FUNCTION public.work_product_binding(org text, client text, engagement text, task text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
 SELECT h.binding_id FROM public.task_methodology_heads h JOIN public.task_methodology_bindings b ON (b.organisation_id,b.task_id,b.id)=(h.organisation_id,h.task_id,h.binding_id)
 WHERE org = pg_catalog.current_setting('zobba.organisation_id', true)
   AND client = pg_catalog.current_setting('zobba.client_id', true)
   AND engagement = pg_catalog.current_setting('zobba.engagement_id', true)
   AND (b.organisation_id,b.client_id,b.engagement_id,b.task_id)=(org,client,engagement,task)
$body$;

-- Evaluation records of one Task (24.1 evaluations and 24.3a revisions) by
-- ID, with their chain's current head and the head's effective outcome under
-- its newest disposition: a person's `replaced` gives the person's verdict
-- with origin human; `accepted` and `needs_reconsideration` keep the verdict
-- with their review state; no disposition is `unreviewed`.
CREATE FUNCTION public.work_product_heads(org text, client text, engagement text, task text, ids text[])
RETURNS TABLE(id text, digest text, subject text, basis_id text, criterion_id text, head_id text, verdict text, origin text, review text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
 WITH asked AS (
   SELECT e.id, e.id AS chain_id, e.digest, e.subject, e.basis_id, e.criterion_id FROM public.assessment_evaluations e
    WHERE (e.organisation_id,e.client_id,e.engagement_id,e.task_id)=(org,client,engagement,task) AND e.id IN (SELECT pg_catalog.unnest(ids))
   UNION ALL
   SELECT r.id, r.chain_id, r.digest, r.subject, r.basis_id, r.criterion_id FROM public.assessment_evaluation_revisions r
    WHERE (r.organisation_id,r.client_id,r.engagement_id,r.task_id)=(org,client,engagement,task) AND r.id IN (SELECT pg_catalog.unnest(ids))),
  heads AS (
   SELECT DISTINCT ON (a.chain_id) a.chain_id, coalesce(r.id, e.id) AS head_id,
     CASE WHEN r.id IS NULL THEN e.verdict ELSE r.verdict END AS verdict, coalesce(r.origin, e.origin) AS origin
   FROM asked a JOIN public.assessment_evaluations e ON (e.organisation_id,e.client_id,e.engagement_id,e.id)=(org,client,engagement,a.chain_id)
   LEFT JOIN LATERAL (SELECT v.id, v.verdict, v.origin FROM public.assessment_evaluation_revisions v
     WHERE (v.organisation_id,v.client_id,v.engagement_id,v.chain_id)=(org,client,engagement,a.chain_id) ORDER BY v.revision DESC LIMIT 1) r ON true
   ORDER BY a.chain_id)
 SELECT a.id, a.digest, a.subject, a.basis_id, a.criterion_id, h.head_id,
   coalesce(CASE WHEN d.kind='replaced' AND h.origin='model_proposal' THEN d.verdict ELSE h.verdict END, 'none'),
   CASE WHEN d.kind='replaced' AND h.origin='model_proposal' THEN 'human' ELSE h.origin END,
   CASE WHEN d.kind IS NULL THEN 'unreviewed' WHEN d.kind='replaced' AND h.origin='model_proposal' THEN 'replaced'
     WHEN d.kind='accepted' THEN 'accepted' WHEN d.kind='needs_reconsideration' THEN 'pending_reconsideration' ELSE 'unreviewed' END
 FROM asked a JOIN heads h ON h.chain_id=a.chain_id
 LEFT JOIN LATERAL (SELECT y.kind, y.verdict FROM public.assessment_dispositions y
   WHERE (y.organisation_id,y.client_id,y.engagement_id,y.revision_id)=(org,client,engagement,h.head_id)
   ORDER BY y.created_us DESC, y.id COLLATE "C" DESC LIMIT 1) d ON true
$body$;

-- Summaries of one Task (24.2 coverage summaries and 24.3b effective
-- summaries) by ID: the digest, the 24.2 summary document, the stored
-- conclusion (an effective summary's effective conclusion) and whether a
-- newer summary of either kind of the same population lineage and sample
-- supersedes it (later in database time, then ID).
CREATE FUNCTION public.work_product_summaries(org text, client text, engagement text, task text, ids text[])
RETURNS TABLE(id text, kind text, digest text, summary jsonb, conclusion text, superseded boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
 WITH roots AS MATERIALIZED (SELECT p.population_id, p.root FROM public.assessment_task_population_roots(org,client,engagement,task) p),
  every AS MATERIALIZED (
   SELECT s.id, 'summary'::text AS kind, s.digest, s.document->'summary' AS summary, s.conclusion, s.population_id, s.sample_id, s.created_us
    FROM public.assessment_summaries s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.task_id)=(org,client,engagement,task)
   UNION ALL
   SELECT s.id, 'effective_summary', s.digest, s.document->'effective'->'summary', s.conclusion, s.population_id, s.sample_id, s.created_us
    FROM public.assessment_effective_summaries s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.task_id)=(org,client,engagement,task))
 SELECT a.id, a.kind, a.digest, a.summary, a.conclusion,
   EXISTS(SELECT 1 FROM every b JOIN roots rb ON rb.population_id=b.population_id JOIN roots ra ON ra.population_id=a.population_id
     WHERE rb.root=ra.root AND b.sample_id IS NOT DISTINCT FROM a.sample_id AND b.id <> a.id
       AND (b.created_us > a.created_us OR (b.created_us = a.created_us AND b.id COLLATE "C" > a.id COLLATE "C")))
 FROM every a WHERE a.id IN (SELECT pg_catalog.unnest(ids))
$body$;

-- One exact count of a 24.2 summary document (NULL when it has none: a
-- criterion measure without its criterion, a summary measure with one, a
-- population summary's `selected`).
CREATE FUNCTION public.work_product_count(summary jsonb, measure text, criterion text) RETURNS bigint
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 SELECT CASE
   WHEN measure IN ('applicable','not_applicable','met','not_met','undetermined','execution_failed','not_evaluated') THEN
     CASE WHEN criterion IS NULL THEN NULL ELSE
       (SELECT (c.value->>measure)::bigint FROM jsonb_array_elements(summary->'criteria') c(value) WHERE c.value->>'criterion_id' = criterion LIMIT 1) END
   WHEN criterion IS NOT NULL THEN NULL
   WHEN measure='received_rows' THEN (summary->>'received_rows')::bigint
   WHEN measure='distinct_subjects' THEN (summary->>'distinct_subjects')::bigint
   WHEN measure='in_scope' THEN (summary->>'in_scope')::bigint
   WHEN measure='selected' THEN (summary->>'selected')::bigint
   WHEN measure='excluded' THEN (summary->>'excluded_out_of_period')::bigint
   WHEN measure='scope_unknown' THEN (summary->>'scope_unknown_period_unparsed')::bigint + (summary->>'scope_unknown_period_missing')::bigint + (summary->>'scope_unknown_conflicting_duplicate')::bigint
   WHEN measure='failing_subjects' THEN (summary->>'failing')::bigint
   WHEN measure='failing_opportunities' THEN (summary->>'failing_opportunities')::bigint
   WHEN measure='meets_every_applicable' THEN (summary->>'meets_every_applicable')::bigint
   WHEN measure='unresolved' THEN (summary->>'unresolved')::bigint
   ELSE NULL END
$body$;

-- Facts of one Task by ID: digest, canonical value text, measure label,
-- subject, whether it is supported and grounded (its subject, and a
-- decimal's measure, found at or beside a verified source), and whether a
-- successor basis replaced it (along the successor chain from its basis,
-- the first version whose effective fact for its subject and name is
-- another fact: it records its own, or does not carry this one).
CREATE FUNCTION public.work_product_facts(org text, client text, engagement text, task text, ids text[])
RETURNS TABLE(id text, digest text, value text, unit text, subject text, supported boolean, superseded boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
 WITH RECURSIVE f AS MATERIALIZED (SELECT x.id, x.digest, x.basis_id, x.subject, x.name, x.support, x.subject_grounded, x.measure_grounded,
     x.document->'value'->>'value' AS value, coalesce(x.document->'value'->'measure'->>'currency', x.document->'value'->'measure'->>'unit') AS unit
    FROM public.assessment_facts x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.task_id)=(org,client,engagement,task) AND x.id IN (SELECT pg_catalog.unnest(ids))),
  walk(fact_id, basis_id, replaced, hops) AS (
   SELECT f.id, f.basis_id, false, 0 FROM f
   UNION ALL
   SELECT w.fact_id, s.id,
     EXISTS(SELECT 1 FROM public.assessment_facts o JOIN f g ON g.id=w.fact_id WHERE (o.organisation_id,o.client_id,o.engagement_id,o.basis_id)=(org,client,engagement,s.id) AND o.subject=g.subject AND o.name=g.name)
     OR NOT EXISTS(SELECT 1 FROM public.assessment_basis_carried_facts c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.basis_id,c.fact_id)=(org,client,engagement,s.id,w.fact_id)),
     w.hops + 1
   FROM walk w JOIN public.assessment_bases s ON (s.organisation_id,s.client_id,s.engagement_id,s.supersedes)=(org,client,engagement,w.basis_id)
   WHERE NOT w.replaced AND w.hops < 100000)
 SELECT f.id, f.digest, f.value, f.unit, f.subject,
   f.support='supported' AND f.subject_grounded AND f.measure_grounded IS NOT FALSE AND f.value IS NOT NULL,
   EXISTS(SELECT 1 FROM walk w WHERE w.fact_id=f.id AND w.replaced)
 FROM f
$body$;

-- The identity digest of an exception (its record never changes; its
-- status is derived): SHA-256 of `exception|id|task|criterion root|subject`.
CREATE FUNCTION public.work_product_exception_digest(id text, task text, root text, subject text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
 SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('exception|'||id||'|'||task||'|'||root||'|'||subject,'UTF8')),'hex')
$body$;

-- ------------------------------------------------------------- tables

-- A work product: created by the agent in one answer invocation, on a
-- template of the Task's current binding, whose section list is frozen here.
CREATE TABLE public.work_products (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 id text NOT NULL CHECK(id ~ '^wp-[0-9a-f]{40}$'),
 binding_id text NOT NULL CHECK(binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 template_id text NOT NULL CHECK(template_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 template_version text NOT NULL CHECK(template_version ~ '^[A-Za-z0-9_-]{1,128}$'),
 template_source text NOT NULL CHECK(template_source ~ '^[A-Za-z0-9_-]{1,128}$'),
 template_neutral boolean NOT NULL,
 template_name text NOT NULL CHECK (char_length(template_name) BETWEEN 1 AND 200 AND template_name !~ U&'[\0001-\001F\007F-\009F]'),
 sections jsonb NOT NULL CHECK(jsonb_typeof(sections)='array' AND jsonb_array_length(sections) BETWEEN 1 AND 64 AND octet_length(sections::text) <= 65536),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX work_products_task ON public.work_products(organisation_id,client_id,engagement_id,task_id,id COLLATE "C");
CREATE INDEX work_products_engagement ON public.work_products(organisation_id,client_id,engagement_id,id COLLATE "C");

-- One immutable version: an agent's (one per answer invocation) or a
-- person's (one per request key), its base the product's latest version.
CREATE TABLE public.work_product_versions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 product_id text NOT NULL,
 id text NOT NULL CHECK(id ~ '^wpv-[0-9a-f]{40}$'),
 version integer NOT NULL CHECK(version BETWEEN 1 AND 256),
 predecessor_id text CHECK(predecessor_id ~ '^wpv-[0-9a-f]{40}$'),
 author_kind text NOT NULL CHECK(author_kind IN ('agent','human')),
 author_id text NOT NULL CHECK(author_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 invocation_id text,
 cycle_id text,
 key text CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200 AND title = btrim(title, U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') AND title !~ U&'[\0001-\001F\007F-\009F]'),
 kind text NOT NULL CHECK(kind IN ('working_paper','analysis','finding_summary','report_draft')),
 methodology_binding_id text NOT NULL CHECK(methodology_binding_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 blocks integer NOT NULL CHECK(blocks BETWEEN 1 AND 64),
 claims integer NOT NULL CHECK(claims BETWEEN 0 AND 48),
 missing_required text[] NOT NULL CHECK(cardinality(missing_required) <= 64 AND array_position(missing_required, NULL) IS NULL),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 131072),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((version = 1) = (predecessor_id IS NULL)),
 CHECK(predecessor_id IS DISTINCT FROM id),
 CHECK((author_kind = 'agent') = (invocation_id IS NOT NULL AND cycle_id IS NOT NULL AND key IS NULL AND author_id = invocation_id)),
 CHECK((author_kind = 'human') = (invocation_id IS NULL AND cycle_id IS NULL AND key IS NOT NULL AND author_id = actor_id)),
 -- coalesce(..., false): a missing key makes a comparison NULL, and a CHECK
 -- that is NULL would pass.
 CHECK(coalesce(document->>'record'='work_product_version' AND document->>'id'=id AND document->>'product_id'=product_id AND document->>'task_id'=task_id
   AND jsonb_typeof(document->'version')='number' AND (document->>'version')::integer=version
   AND document ?& ARRAY['predecessor_id','key','cycle_id'] AND document->>'predecessor_id' IS NOT DISTINCT FROM predecessor_id
   AND document->>'author_kind'=author_kind AND document->>'author_id'=author_id
   AND document->>'key' IS NOT DISTINCT FROM key AND document->>'cycle_id' IS NOT DISTINCT FROM cycle_id
   AND document->>'title'=title AND document->>'kind'=kind
   AND document->>'methodology_binding_id'=methodology_binding_id
   AND jsonb_typeof(document->'execution_epoch')='number' AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'figure_rule'='statement_figures_v1'
   AND jsonb_typeof(document->'blocks')='array' AND jsonb_array_length(document->'blocks')=blocks
   AND jsonb_typeof(document->'missing_required')='array'
   AND to_jsonb(missing_required) = document->'missing_required'
   AND jsonb_typeof(document->'template')='object', false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,product_id,version),
 UNIQUE(organisation_id,client_id,engagement_id,predecessor_id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id),
 UNIQUE(organisation_id,client_id,engagement_id,actor_id,key),
 FOREIGN KEY(organisation_id,client_id,engagement_id,product_id) REFERENCES public.work_products(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,predecessor_id) REFERENCES public.work_product_versions(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX work_product_versions_product ON public.work_product_versions(organisation_id,client_id,engagement_id,product_id,version);

-- One block of a version, in its order. Its ID survives versions; a kept
-- block is byte-equal to its source block.
CREATE TABLE public.work_product_blocks (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 version_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 63),
 block_id text NOT NULL CHECK(block_id ~ '^blk-[0-9a-f]{40}$'),
 section_id text NOT NULL CHECK(section_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 kind text NOT NULL CHECK(kind IN ('heading','narrative','claim','coverage','exceptions','limitations')),
 label text CHECK(label IN ('judgment','narrative')),
 -- A heading's text, a narrative's text or a claim's statement.
 body text CHECK(octet_length(body) BETWEEN 1 AND 4000 AND btrim(body, E' \n\r\t') <> '' AND body !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]'),
 record_id text,
 author_kind text NOT NULL CHECK(author_kind IN ('agent','human')),
 author_id text NOT NULL CHECK(author_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 authored_in_version text NOT NULL CHECK(authored_in_version ~ '^wpv-[0-9a-f]{40}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((kind = 'narrative') = (label IS NOT NULL)),
 CHECK((kind IN ('heading','narrative','claim')) = (body IS NOT NULL)),
 CHECK(kind <> 'heading' OR octet_length(body) <= 500),
 CHECK(kind <> 'claim' OR octet_length(body) <= 1000),
 CHECK((kind IN ('coverage','exceptions')) = (record_id IS NOT NULL)),
 CHECK(kind <> 'coverage' OR record_id ~ '^e?summary-[0-9a-f]{40}$'),
 CHECK(kind <> 'exceptions' OR record_id ~ '^basis-[0-9a-f]{40}$'),
 PRIMARY KEY(organisation_id,client_id,engagement_id,version_id,ordinal),
 UNIQUE(organisation_id,client_id,engagement_id,version_id,block_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,version_id) REFERENCES public.work_product_versions(organisation_id,client_id,engagement_id,id)
);

-- One checked assertion of a claim: the record it pins (ID and digest) and
-- the canonical value trusted code checked.
CREATE TABLE public.work_product_assertions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 version_id text NOT NULL,
 block_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
 kind text NOT NULL CHECK(kind IN ('outcome','count','conclusion','exception','fact','quote','period')),
 record_kind text NOT NULL CHECK(record_kind IN ('evaluation','revision','summary','effective_summary','exception','fact','original','basis')),
 record_id text NOT NULL CHECK(record_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 record_digest text NOT NULL CHECK(record_digest ~ '^[0-9a-f]{64}$'),
 measure text CHECK(measure IN ('received_rows','distinct_subjects','in_scope','selected','excluded','scope_unknown','applicable','not_applicable','met','not_met','undetermined','execution_failed','not_evaluated','failing_subjects','failing_opportunities','meets_every_applicable','unresolved')),
 criterion_id text CHECK(criterion_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 value text NOT NULL CHECK(octet_length(value) BETWEEN 1 AND 1024 AND value !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]'),
 origin text CHECK(origin IN ('deterministic','model_proposal','human')),
 review text CHECK(review IN ('unreviewed','accepted','replaced','pending_reconsideration')),
 locator text CHECK(octet_length(locator) BETWEEN 1 AND 300 AND locator !~ '[[:cntrl:]]'),
 unit text CHECK(octet_length(unit) BETWEEN 1 AND 64),
 subject text CHECK(octet_length(subject) BETWEEN 1 AND 128 AND btrim(subject) <> '' AND subject !~ '[\x01-\x1f\x7f-\x9f]'),
 CHECK((kind = 'count') = (measure IS NOT NULL)),
 CHECK(kind = 'count' OR criterion_id IS NULL),
 CHECK(measure IS NULL OR (measure IN ('applicable','not_applicable','met','not_met','undetermined','execution_failed','not_evaluated')) = (criterion_id IS NOT NULL)),
 CHECK(measure IS NULL OR value ~ '^(0|[1-9][0-9]{0,18})$'),
 CHECK((kind = 'outcome') = (origin IS NOT NULL) AND (origin IS NULL) = (review IS NULL)),
 CHECK(kind <> 'outcome' OR value IN ('met','not_met','undetermined','none')),
 CHECK((kind = 'quote') = (locator IS NOT NULL)),
 CHECK(kind = 'fact' OR unit IS NULL),
 CHECK(CASE kind WHEN 'outcome' THEN record_kind IN ('evaluation','revision') WHEN 'count' THEN record_kind IN ('summary','effective_summary')
   WHEN 'conclusion' THEN record_kind IN ('summary','effective_summary') WHEN 'exception' THEN record_kind='exception'
   WHEN 'fact' THEN record_kind='fact' WHEN 'quote' THEN record_kind='original' ELSE record_kind='basis' END),
 CHECK(CASE record_kind WHEN 'evaluation' THEN record_id ~ '^eval-[0-9a-f]{40}$' WHEN 'revision' THEN record_id ~ '^rev-[0-9a-f]{40}$'
   WHEN 'summary' THEN record_id ~ '^summary-[0-9a-f]{40}$' WHEN 'effective_summary' THEN record_id ~ '^esummary-[0-9a-f]{40}$'
   WHEN 'exception' THEN record_id ~ '^exc-[0-9a-f]{40}$' WHEN 'fact' THEN record_id ~ '^fact-[0-9a-f]{40}$'
   WHEN 'basis' THEN record_id ~ '^basis-[0-9a-f]{40}$' ELSE true END),
 PRIMARY KEY(organisation_id,client_id,engagement_id,version_id,block_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,version_id,block_id) REFERENCES public.work_product_blocks(organisation_id,client_id,engagement_id,version_id,block_id)
);
CREATE INDEX work_product_assertions_task ON public.work_product_assertions(organisation_id,client_id,engagement_id,task_id,version_id);

-- One export: bytes rendered by trusted code from one exact version for one
-- viewer's withheld set, stored in the evidence object store under its ID.
CREATE TABLE public.work_product_exports (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 id text NOT NULL CHECK(id ~ '^wpx-[0-9a-f]{40}$'),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 version_id text NOT NULL,
 format text NOT NULL CHECK(format IN ('docx','xlsx')),
 renderer text NOT NULL CHECK(renderer = 'zobba-export-v1'),
 withheld_digest text NOT NULL CHECK(withheld_digest ~ '^[0-9a-f]{64}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 size bigint NOT NULL CHECK(size BETWEEN 1 AND 16777216),
 namespace text NOT NULL CHECK(namespace ~ '^[0-9a-f]{64}$'),
 object_version text NOT NULL CHECK(octet_length(object_version) BETWEEN 1 AND 1024),
 refresh_count integer NOT NULL CHECK(refresh_count BETWEEN 0 AND 48),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,actor_id,key),
 FOREIGN KEY(organisation_id,client_id,engagement_id,version_id) REFERENCES public.work_product_versions(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX work_product_exports_version ON public.work_product_exports(organisation_id,client_id,engagement_id,version_id);

-- What is true now of every assertion of the given versions, set-based, for
-- currency on read: an outcome's chain head and effective outcome, whether a
-- summary or a fact is superseded, an exception's derived status, an
-- original's currently registered digest.
CREATE FUNCTION public.work_product_current(org text, client text, engagement text, task text, versions text[])
RETURNS TABLE(version_id text, block_id text, ordinal integer, head_id text, verdict text, origin text, review text, superseded boolean, status text, registered text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
 WITH a AS MATERIALIZED (SELECT x.version_id, x.block_id, x.ordinal, x.kind, x.record_id FROM public.work_product_assertions x
     WHERE (x.organisation_id,x.client_id,x.engagement_id,x.task_id)=(org,client,engagement,task) AND x.version_id IN (SELECT pg_catalog.unnest(versions))),
  heads AS MATERIALIZED (SELECT * FROM public.work_product_heads(org,client,engagement,task, ARRAY(SELECT DISTINCT a.record_id FROM a WHERE a.kind='outcome'))),
  sums AS MATERIALIZED (SELECT * FROM public.work_product_summaries(org,client,engagement,task, ARRAY(SELECT DISTINCT a.record_id FROM a WHERE a.kind IN ('count','conclusion')))),
  facts AS MATERIALIZED (SELECT * FROM public.work_product_facts(org,client,engagement,task, ARRAY(SELECT DISTINCT a.record_id FROM a WHERE a.kind='fact'))),
  statuses AS MATERIALIZED (SELECT * FROM public.assessment_exception_statuses(org,client,engagement,task, ARRAY(SELECT DISTINCT a.record_id FROM a WHERE a.kind='exception')))
 SELECT a.version_id, a.block_id, a.ordinal, h.head_id, h.verdict, h.origin, h.review,
   coalesce(s.superseded, f.superseded), x.status, o.digest
 FROM a
 LEFT JOIN heads h ON a.kind='outcome' AND h.id=a.record_id
 LEFT JOIN sums s ON a.kind IN ('count','conclusion') AND s.id=a.record_id
 LEFT JOIN facts f ON a.kind='fact' AND f.id=a.record_id
 LEFT JOIN statuses x ON a.kind='exception' AND x.id=a.record_id
 LEFT JOIN public.evidence_originals o ON a.kind='quote' AND (o.organisation_id,o.client_id,o.engagement_id,o.id)=(org,client,engagement,a.record_id)
$body$;

-- ------------------------------------------------------------- guards

-- A product, a version and an export, row by row:
-- - a product belongs to its answer invocation of this Task under that
--   turn's binding, which is the Task's current binding, names a template of
--   it with exactly its source, name, neutral standing and sections, and a
--   Task holds at most 16;
-- - a version is the agent's (its answer invocation of this Task, cycle and
--   actor under that turn's binding and epoch) or a person's (a currently
--   assigned Auditor or Audit manager in their own live session, under the
--   Task's current binding); its product is of its Task; under the product's
--   lock, its base is the product's latest version and its number one more,
--   and its template is the product's;
-- - an export is a person's in their own live session, of a version of its
--   Task.
CREATE FUNCTION public.work_product_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE template jsonb; product public.work_products%ROWTYPE; head public.work_product_versions%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='work_products' THEN
  IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
    AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id
    AND i.request->'context'->'verification'->>'expected_methodology_binding_id' = NEW.binding_id) THEN
   RAISE EXCEPTION 'a work product belongs to its answer invocation and its binding' USING ERRCODE='23514';
  END IF;
  template := public.work_product_template(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id,NEW.binding_id,NEW.template_id,NEW.template_version);
  IF template IS NULL OR NOT (template->>'current')::boolean OR template->>'source_version_id' IS DISTINCT FROM NEW.template_source
     OR template->>'name' IS DISTINCT FROM NEW.template_name OR (template->>'neutral')::boolean IS DISTINCT FROM NEW.template_neutral
     OR template->'sections' IS DISTINCT FROM NEW.sections THEN
   RAISE EXCEPTION 'a work product follows a template of the Task''s current binding' USING ERRCODE='23514';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('work_products:'||NEW.organisation_id||'/'||NEW.client_id||'/'||NEW.engagement_id||'/'||NEW.task_id, 2404));
  IF (SELECT count(*) FROM public.work_products p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.task_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id)) >= 16 THEN
   RAISE EXCEPTION 'a Task holds at most 16 work products' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='work_product_versions' THEN
  IF NEW.author_kind='agent' THEN
   IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
     AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id
     AND i.request->'context'->'verification'->>'expected_methodology_binding_id' = NEW.methodology_binding_id
     AND (i.request->'basis'->>'execution_epoch')::bigint = NEW.execution_epoch) THEN
    RAISE EXCEPTION 'an agent''s work-product version belongs to its answer invocation and its binding' USING ERRCODE='23514';
   END IF;
  ELSE
   IF NOT coalesce(public.knowledge_audit(NEW.actor_id, NEW.organisation_id, NEW.client_id, NEW.engagement_id), false)
      OR NOT coalesce(public.evidence_session_locked(NEW.actor_id, nullif(pg_catalog.current_setting('zobba.session_hash',true),'')), false) THEN
    RAISE EXCEPTION 'a person''s work-product version is saved by a currently assigned auditor or audit manager in their own session' USING ERRCODE='23514';
   END IF;
   IF public.work_product_binding(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id) IS DISTINCT FROM NEW.methodology_binding_id
      OR (SELECT t.execution_epoch FROM public.tasks t WHERE (t.organisation_id,t.client_id,t.engagement_id,t.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.task_id)) IS DISTINCT FROM NEW.execution_epoch THEN
    RAISE EXCEPTION 'a person''s work-product version names the Task''s current binding and epoch' USING ERRCODE='23514';
   END IF;
  END IF;
  SELECT p.* INTO product FROM public.work_products p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.product_id);
  IF product.id IS NULL OR product.task_id <> NEW.task_id THEN
   RAISE EXCEPTION 'a work-product version belongs to a work product of its own Task' USING ERRCODE='23514';
  END IF;
  IF NEW.document->'template'->>'binding_id' IS DISTINCT FROM product.binding_id OR NEW.document->'template'->>'id' IS DISTINCT FROM product.template_id
     OR NEW.document->'template'->>'version' IS DISTINCT FROM product.template_version OR NEW.document->'template'->>'source_version_id' IS DISTINCT FROM product.template_source
     OR NEW.document->'template'->>'name' IS DISTINCT FROM product.template_name OR (NEW.document->'template'->>'neutral')::boolean IS DISTINCT FROM product.template_neutral
     OR NEW.document->'template'->'sections' IS DISTINCT FROM product.sections THEN
   RAISE EXCEPTION 'a work-product version follows its product''s template' USING ERRCODE='23514';
  END IF;
  -- One successor per version: writers of one product are serialised here,
  -- and the base must be the latest version.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('work_product:'||NEW.organisation_id||'/'||NEW.client_id||'/'||NEW.engagement_id||'/'||NEW.product_id, 2404));
  SELECT v.* INTO head FROM public.work_product_versions v WHERE (v.organisation_id,v.client_id,v.engagement_id,v.product_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.product_id)
   ORDER BY v.version DESC LIMIT 1;
  IF NEW.predecessor_id IS DISTINCT FROM head.id OR NEW.version IS DISTINCT FROM coalesce(head.version, 0) + 1 THEN
   RAISE EXCEPTION 'a work-product version edits its product''s latest version: %', coalesce(head.id, 'none') USING ERRCODE='23514';
  END IF;
  IF NEW.version = 1 AND (NEW.author_kind <> 'agent' OR NEW.invocation_id IS DISTINCT FROM product.invocation_id) THEN
   RAISE EXCEPTION 'a work product''s first version is the agent''s, in the invocation that created it' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NOT coalesce(public.knowledge_audit(NEW.actor_id, NEW.organisation_id, NEW.client_id, NEW.engagement_id), false)
     OR NOT coalesce(public.evidence_session_locked(NEW.actor_id, nullif(pg_catalog.current_setting('zobba.session_hash',true),'')), false) THEN
   RAISE EXCEPTION 'an export is requested by a currently assigned auditor or audit manager in their own session' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.work_product_versions v WHERE (v.organisation_id,v.client_id,v.engagement_id,v.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.version_id) AND v.task_id=NEW.task_id) THEN
   RAISE EXCEPTION 'an export renders a version of its own Task' USING ERRCODE='23514';
  END IF;
  IF NEW.refresh_count > (SELECT v.claims FROM public.work_product_versions v WHERE (v.organisation_id,v.client_id,v.engagement_id,v.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.version_id)) THEN
   RAISE EXCEPTION 'an export counts at most its version''s claims as needing refresh' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER work_product_guard BEFORE INSERT ON public.work_products FOR EACH ROW EXECUTE FUNCTION public.work_product_guard();
CREATE TRIGGER work_product_guard BEFORE INSERT ON public.work_product_versions FOR EACH ROW EXECUTE FUNCTION public.work_product_guard();
CREATE TRIGGER work_product_guard BEFORE INSERT ON public.work_product_exports FOR EACH ROW EXECUTE FUNCTION public.work_product_guard();

-- Blocks and assertions, a statement at a time (set-based):
-- - a block is of a version of its own Task and actor, in a section of its
--   template; one written in this version has the version's author, one kept
--   names its source version's predecessor as authored before;
-- - an assertion is of a claim block of its version; one written in this
--   version (a new claim, or a claim a person's version edits) agrees with
--   its record now: of the version's own Task, the record's digest, and the
--   value recomputed here; a superseded record (not the current chain head,
--   a summary or fact a newer one replaced) is refused.
CREATE FUNCTION public.work_product_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
DECLARE bad record; task text; org text; client text; engagement text;
BEGIN
 IF TG_TABLE_NAME='work_product_blocks' THEN
  SELECT a.version_id, a.block_id INTO bad FROM added a
   LEFT JOIN public.work_product_versions v ON (v.organisation_id,v.client_id,v.engagement_id,v.id)=(a.organisation_id,a.client_id,a.engagement_id,a.version_id)
   LEFT JOIN public.work_products p ON (p.organisation_id,p.client_id,p.engagement_id,p.id)=(v.organisation_id,v.client_id,v.engagement_id,v.product_id)
   WHERE v.id IS NULL OR v.task_id <> a.task_id OR v.actor_id <> a.actor_id
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.sections) s(value) WHERE s.value->>'id' = a.section_id)
     OR (a.authored_in_version = a.version_id AND (a.author_kind, a.author_id) IS DISTINCT FROM (v.author_kind, v.author_id))
   LIMIT 1;
  IF FOUND THEN
   RAISE EXCEPTION 'a work-product block is of its version, its Task, its template and its author: %/%', bad.version_id, bad.block_id USING ERRCODE='23514';
  END IF;
  RETURN NULL;
 END IF;
 -- Assertions: of a claim block of its version.
 SELECT a.version_id, a.block_id, a.ordinal INTO bad FROM added a
  LEFT JOIN public.work_product_blocks b ON (b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)=(a.organisation_id,a.client_id,a.engagement_id,a.version_id,a.block_id)
  WHERE b.kind IS DISTINCT FROM 'claim' OR b.task_id <> a.task_id OR b.actor_id <> a.actor_id
  LIMIT 1;
 IF FOUND THEN
  RAISE EXCEPTION 'a work-product assertion is of a claim of its version: %/%/%', bad.version_id, bad.block_id, bad.ordinal USING ERRCODE='23514';
 END IF;
 FOR org, client, engagement, task IN SELECT DISTINCT a.organisation_id, a.client_id, a.engagement_id, a.task_id FROM added a LOOP
  -- The assertions written in their version, with what is true now.
  WITH fresh AS MATERIALIZED (SELECT a.* FROM added a JOIN public.work_product_blocks b
      ON (b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)=(a.organisation_id,a.client_id,a.engagement_id,a.version_id,a.block_id)
     WHERE (a.organisation_id,a.client_id,a.engagement_id,a.task_id)=(org,client,engagement,task) AND b.authored_in_version = b.version_id),
   heads AS MATERIALIZED (SELECT * FROM public.work_product_heads(org,client,engagement,task, ARRAY(SELECT f.record_id FROM fresh f WHERE f.kind='outcome'))),
   sums AS MATERIALIZED (SELECT * FROM public.work_product_summaries(org,client,engagement,task, ARRAY(SELECT f.record_id FROM fresh f WHERE f.kind IN ('count','conclusion')))),
   facts AS MATERIALIZED (SELECT * FROM public.work_product_facts(org,client,engagement,task, ARRAY(SELECT f.record_id FROM fresh f WHERE f.kind='fact'))),
   statuses AS MATERIALIZED (SELECT * FROM public.assessment_exception_statuses(org,client,engagement,task, ARRAY(SELECT f.record_id FROM fresh f WHERE f.kind='exception')))
  SELECT f.version_id, f.block_id, f.ordinal INTO bad FROM fresh f
   LEFT JOIN heads h ON f.kind='outcome' AND h.id=f.record_id
   LEFT JOIN sums s ON f.kind IN ('count','conclusion') AND s.id=f.record_id
   LEFT JOIN facts x ON f.kind='fact' AND x.id=f.record_id
   LEFT JOIN statuses e ON f.kind='exception' AND e.id=f.record_id
   LEFT JOIN public.assessment_exceptions r ON f.kind='exception' AND (r.organisation_id,r.client_id,r.engagement_id,r.id)=(org,client,engagement,f.record_id) AND r.task_id=task
   LEFT JOIN public.evidence_originals o ON f.kind='quote' AND (o.organisation_id,o.client_id,o.engagement_id,o.id)=(org,client,engagement,f.record_id)
   LEFT JOIN public.assessment_bases k ON f.kind='period' AND (k.organisation_id,k.client_id,k.engagement_id,k.id)=(org,client,engagement,f.record_id) AND k.task_id=task
   WHERE NOT coalesce(CASE f.kind
     WHEN 'outcome' THEN h.head_id = f.record_id AND h.digest = f.record_digest AND h.verdict = f.value AND h.origin = f.origin AND h.review = f.review
       AND h.subject IS NOT DISTINCT FROM f.subject AND f.record_kind = CASE WHEN f.record_id LIKE 'eval-%' THEN 'evaluation' ELSE 'revision' END
     WHEN 'count' THEN s.digest = f.record_digest AND NOT s.superseded AND s.kind = f.record_kind
       AND public.work_product_count(s.summary, f.measure, f.criterion_id)::text = f.value AND f.subject IS NULL
     WHEN 'conclusion' THEN s.digest = f.record_digest AND NOT s.superseded AND s.kind = f.record_kind AND s.conclusion = f.value AND f.subject IS NULL
     WHEN 'exception' THEN r.id IS NOT NULL AND e.status = f.value AND f.subject = r.subject
       AND public.work_product_exception_digest(r.id, r.task_id, r.criterion_root, r.subject) = f.record_digest
     WHEN 'fact' THEN x.digest = f.record_digest AND x.supported AND NOT x.superseded AND x.value = f.value
       AND x.unit IS NOT DISTINCT FROM f.unit AND x.subject = f.subject
     WHEN 'quote' THEN o.digest = f.record_digest AND f.subject IS NULL
     WHEN 'period' THEN k.digest = f.record_digest AND (k.period_from::text || '/' || k.period_to::text) = f.value AND f.subject IS NULL
     END, false)
   LIMIT 1;
  IF FOUND THEN
   RAISE EXCEPTION 'a work-product assertion does not agree with its record now: %/%/%', bad.version_id, bad.block_id, bad.ordinal USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NULL;
END $body$;
CREATE TRIGGER work_product_batch AFTER INSERT ON public.work_product_blocks REFERENCING NEW TABLE AS added FOR EACH STATEMENT EXECUTE FUNCTION public.work_product_batch();
CREATE TRIGGER work_product_batch AFTER INSERT ON public.work_product_assertions REFERENCING NEW TABLE AS added FOR EACH STATEMENT EXECUTE FUNCTION public.work_product_batch();

-- At commit, a version holds exactly its document's blocks and assertions:
-- - every block row equals its document entry, in order, at most 48 claims
--   and exactly one limitations block, each claim with 1-8 assertions and
--   every other block with none, coverage and exceptions blocks naming
--   records of its Task;
-- - a kept block (written before this version) equals the predecessor's
--   block of its ID, assertions included, byte for byte;
-- - an agent's version keeps every person's block of its predecessor; a
--   person's version adds no block, and a block a person edits keeps its
--   kind, section, label and record, and its claim keeps exactly its
--   assertions;
-- - its missing required sections are the template's required sections
--   with no block but the limitations block.
CREATE FUNCTION public.work_product_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
DECLARE product public.work_products%ROWTYPE;
BEGIN
 SELECT p.* INTO product FROM public.work_products p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.product_id);
 IF (SELECT count(*) FROM public.work_product_blocks b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)) <> NEW.blocks
    OR EXISTS(SELECT 1 FROM public.work_product_blocks b
      WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)
        AND NOT coalesce(NEW.document->'blocks'->b.ordinal->>'block_id' = b.block_id
          AND NEW.document->'blocks'->b.ordinal->>'section_id' = b.section_id
          AND NEW.document->'blocks'->b.ordinal->>'kind' = b.kind
          AND NEW.document->'blocks'->b.ordinal ?& ARRAY['label','text','statement','record_id']
          AND NEW.document->'blocks'->b.ordinal->>'label' IS NOT DISTINCT FROM b.label
          AND coalesce(NEW.document->'blocks'->b.ordinal->>'text', NEW.document->'blocks'->b.ordinal->>'statement') IS NOT DISTINCT FROM b.body
          AND (NEW.document->'blocks'->b.ordinal->>'statement' IS NOT NULL) = (b.kind = 'claim')
          AND NEW.document->'blocks'->b.ordinal->>'record_id' IS NOT DISTINCT FROM b.record_id
          AND NEW.document->'blocks'->b.ordinal->>'author_kind' = b.author_kind
          AND NEW.document->'blocks'->b.ordinal->>'author_id' = b.author_id
          AND NEW.document->'blocks'->b.ordinal->>'authored_in_version' = b.authored_in_version
          AND jsonb_array_length(NEW.document->'blocks'->b.ordinal->'assertions') =
            (SELECT count(*) FROM public.work_product_assertions x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.version_id,x.block_id)=(b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id))
          AND NOT EXISTS(SELECT 1 FROM public.work_product_assertions x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.version_id,x.block_id)=(b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)
            AND NOT coalesce(NEW.document->'blocks'->b.ordinal->'assertions'->x.ordinal = jsonb_build_object('kind',x.kind,'record_kind',x.record_kind,'record_id',x.record_id,'record_digest',x.record_digest,
              'measure',x.measure,'criterion_id',x.criterion_id,'value',x.value,'origin',x.origin,'review',x.review,'locator',x.locator,'unit',x.unit,'subject',x.subject), false)), false)) THEN
  RAISE EXCEPTION 'a work-product version holds exactly its document''s blocks and assertions' USING ERRCODE='23514';
 END IF;
 IF (SELECT count(*) FILTER (WHERE b.kind='claim') FROM public.work_product_blocks b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)) <> NEW.claims
    OR (SELECT count(*) FILTER (WHERE b.kind='limitations') FROM public.work_product_blocks b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)) <> 1
    OR EXISTS(SELECT 1 FROM public.work_product_blocks b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)
      AND ((b.kind = 'claim') <> ((SELECT count(*) FROM public.work_product_assertions x WHERE (x.organisation_id,x.client_id,x.engagement_id,x.version_id,x.block_id)=(b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)) BETWEEN 1 AND 8)
        OR (b.kind = 'coverage' AND NOT EXISTS(SELECT 1 FROM public.assessment_summaries s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.id,s.task_id)=(b.organisation_id,b.client_id,b.engagement_id,b.record_id,b.task_id))
          AND NOT EXISTS(SELECT 1 FROM public.assessment_effective_summaries s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.id,s.task_id)=(b.organisation_id,b.client_id,b.engagement_id,b.record_id,b.task_id)))
        OR (b.kind = 'exceptions' AND NOT EXISTS(SELECT 1 FROM public.assessment_bases s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.id,s.task_id)=(b.organisation_id,b.client_id,b.engagement_id,b.record_id,b.task_id))))) THEN
  RAISE EXCEPTION 'a work-product version holds at most 48 claims of one to eight assertions, one limitations block, and records of its own Task' USING ERRCODE='23514';
 END IF;
 -- A kept block equals the predecessor's block of its ID, assertions too.
 IF EXISTS(SELECT 1 FROM public.work_product_blocks b
   WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id) AND b.authored_in_version <> NEW.id
     AND NOT EXISTS(SELECT 1 FROM public.work_product_blocks s
       WHERE (s.organisation_id,s.client_id,s.engagement_id,s.version_id,s.block_id)=(b.organisation_id,b.client_id,b.engagement_id,NEW.predecessor_id,b.block_id)
         AND (s.section_id,s.kind,s.label,s.body,s.record_id,s.author_kind,s.author_id,s.authored_in_version) IS NOT DISTINCT FROM (b.section_id,b.kind,b.label,b.body,b.record_id,b.author_kind,b.author_id,b.authored_in_version)
         AND (SELECT coalesce(jsonb_agg(to_jsonb(x) - ARRAY['organisation_id','client_id','engagement_id','task_id','actor_id','version_id'] ORDER BY x.ordinal), '[]'::jsonb) FROM public.work_product_assertions x
               WHERE (x.organisation_id,x.client_id,x.engagement_id,x.version_id,x.block_id)=(s.organisation_id,s.client_id,s.engagement_id,s.version_id,s.block_id))
           = (SELECT coalesce(jsonb_agg(to_jsonb(x) - ARRAY['organisation_id','client_id','engagement_id','task_id','actor_id','version_id'] ORDER BY x.ordinal), '[]'::jsonb) FROM public.work_product_assertions x
               WHERE (x.organisation_id,x.client_id,x.engagement_id,x.version_id,x.block_id)=(b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)))) THEN
  RAISE EXCEPTION 'a kept work-product block is byte-equal to its source block' USING ERRCODE='23514';
 END IF;
 IF NEW.author_kind = 'agent' THEN
  -- The agent writes new blocks under new IDs and keeps every person's block.
  IF EXISTS(SELECT 1 FROM public.work_product_blocks b
     WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id) AND b.authored_in_version = NEW.id
       AND EXISTS(SELECT 1 FROM public.work_product_blocks s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.version_id,s.block_id)=(b.organisation_id,b.client_id,b.engagement_id,NEW.predecessor_id,b.block_id)))
    OR EXISTS(SELECT 1 FROM public.work_product_blocks s
     WHERE (s.organisation_id,s.client_id,s.engagement_id,s.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.predecessor_id) AND s.author_kind = 'human'
       AND NOT EXISTS(SELECT 1 FROM public.work_product_blocks b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)=(s.organisation_id,s.client_id,s.engagement_id,NEW.id,s.block_id)
         AND b.authored_in_version = s.authored_in_version)) THEN
   RAISE EXCEPTION 'the agent never changes or drops a person''s work-product block' USING ERRCODE='23514';
  END IF;
 ELSE
  -- A person removes, reorders and edits text; every block is one of the
  -- predecessor's, and an edited block keeps its kind, section, label,
  -- record and assertions.
  IF EXISTS(SELECT 1 FROM public.work_product_blocks b
     WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)
       AND NOT EXISTS(SELECT 1 FROM public.work_product_blocks s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.version_id,s.block_id)=(b.organisation_id,b.client_id,b.engagement_id,NEW.predecessor_id,b.block_id)
         AND (s.section_id,s.kind,s.label,s.record_id) IS NOT DISTINCT FROM (b.section_id,b.kind,b.label,b.record_id)
         AND (SELECT coalesce(jsonb_agg(to_jsonb(x) - ARRAY['organisation_id','client_id','engagement_id','task_id','actor_id','version_id'] ORDER BY x.ordinal), '[]'::jsonb) FROM public.work_product_assertions x
               WHERE (x.organisation_id,x.client_id,x.engagement_id,x.version_id,x.block_id)=(s.organisation_id,s.client_id,s.engagement_id,s.version_id,s.block_id))
           = (SELECT coalesce(jsonb_agg(to_jsonb(x) - ARRAY['organisation_id','client_id','engagement_id','task_id','actor_id','version_id'] ORDER BY x.ordinal), '[]'::jsonb) FROM public.work_product_assertions x
               WHERE (x.organisation_id,x.client_id,x.engagement_id,x.version_id,x.block_id)=(b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)))) THEN
   RAISE EXCEPTION 'a person''s work-product version removes, reorders and edits the text of its predecessor''s blocks only' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.missing_required IS DISTINCT FROM ARRAY(SELECT s.value->>'id' FROM jsonb_array_elements(product.sections) WITH ORDINALITY s(value, n)
      WHERE (s.value->>'required')::boolean
        AND NOT EXISTS(SELECT 1 FROM public.work_product_blocks b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id)
          AND b.section_id = s.value->>'id' AND b.kind <> 'limitations')
      ORDER BY s.n) THEN
  RAISE EXCEPTION 'a work-product version states exactly its missing required sections' USING ERRCODE='23514';
 END IF;
 IF NEW.version > 1 AND (SELECT count(*) FROM public.work_product_versions v WHERE (v.organisation_id,v.client_id,v.engagement_id,v.product_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.product_id)) > 256 THEN
  RAISE EXCEPTION 'a work product holds at most 256 versions' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $body$;
CREATE CONSTRAINT TRIGGER work_product_complete AFTER INSERT ON public.work_product_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.work_product_complete();

-- Every record is an immutable, retained fact, even for the owner: no
-- UPDATE, DELETE or TRUNCATE, except an explicit disposable fixture reset (a
-- session setting) in a database named *_test.
CREATE FUNCTION public.work_product_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF TG_OP='DELETE' AND pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'work-product records are immutable' USING ERRCODE='23514';
END $body$;
CREATE FUNCTION public.work_product_retained() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF pg_catalog.current_setting('zobba.disposable_fixture_reset',true)='on' AND pg_catalog.current_database() LIKE '%\_test' THEN
  RETURN NULL;
 END IF;
 RAISE EXCEPTION 'work-product records are retained' USING ERRCODE='23514';
END $body$;
DO $immutable$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['work_products','work_product_versions','work_product_blocks','work_product_assertions','work_product_exports'] LOOP
  EXECUTE format('CREATE TRIGGER work_product_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.work_product_immutable()',relation);
  EXECUTE format('CREATE TRIGGER work_product_retained BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.work_product_retained()',relation);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT USING (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)))',relation,relation,relation,relation);
  EXECUTE format('CREATE POLICY scoped_insert ON public.%I FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)) AND actor_id=pg_catalog.current_setting(''zobba.actor_id'',true))',relation,relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $immutable$;
REVOKE ALL ON FUNCTION public.work_product_guard(),public.work_product_batch(),public.work_product_complete(),public.work_product_immutable(),public.work_product_retained() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.work_product_template(text,text,text,text,text,text,text),public.work_product_binding(text,text,text,text),
 public.work_product_heads(text,text,text,text,text[]),public.work_product_summaries(text,text,text,text,text[]),public.work_product_count(jsonb,text,text),
 public.work_product_facts(text,text,text,text,text[]),public.work_product_exception_digest(text,text,text,text),public.work_product_current(text,text,text,text,text[]) FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=22) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=22;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
