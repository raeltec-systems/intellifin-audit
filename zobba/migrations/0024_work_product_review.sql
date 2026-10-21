-- Story 24.4 review round 1 (owner decisions of 2026-10-21). Additive:
-- published schemas 1-23 are unchanged; this replaces the four work-product
-- check functions and two table checks, and adds the agent's change
-- proposals and a person's decisions on them.
-- - The agent changes or removes a person's block only at that person's
--   explicit request in the conversation (their applied Guide command): it
--   records a proposal (the whole would-be version, before/after per block),
--   and the version is recorded only when the same person confirms it in
--   their own session, as "changed by the agent at <person>'s request" with
--   the request and confirmation IDs. Without such a confirmed proposal the
--   agent still never changes or drops a person's block.
-- - Versions of rule `statement_figures_v2` freeze what was true when they
--   were recorded (`snapshot`: names, exception counts, claims already
--   needing refresh) so their exports are the same bytes for the same
--   version, format and withheld set; a heading alone, or the limitations
--   block, completes no required section; new text holds no character that
--   changes how it displays without being seen.
-- - A new quote cites an original no replacement source corrects, a new
--   period a basis no successor supersedes, and a new coverage or
--   exceptions block a summary or basis that is current; an outcome a person
--   only edits the sentence of keeps its review state as recorded.
-- - Currency on read also says when a quoted original was corrected and when
--   a cited basis was superseded.
-- - New exports are renderer `zobba-export-v2` (frozen at their version).

-- ------------------------------------------------------------- tables

ALTER TABLE public.work_product_versions DROP CONSTRAINT work_product_versions_check4;
ALTER TABLE public.work_product_versions ADD CONSTRAINT work_product_versions_rule_check
 CHECK(coalesce(document->>'record'='work_product_version' AND document->>'id'=id AND document->>'product_id'=product_id AND document->>'task_id'=task_id
   AND jsonb_typeof(document->'version')='number' AND (document->>'version')::integer=version
   AND document ?& ARRAY['predecessor_id','key','cycle_id'] AND document->>'predecessor_id' IS NOT DISTINCT FROM predecessor_id
   AND document->>'author_kind'=author_kind AND document->>'author_id'=author_id
   AND document->>'key' IS NOT DISTINCT FROM key AND document->>'cycle_id' IS NOT DISTINCT FROM cycle_id
   AND document->>'title'=title AND document->>'kind'=kind
   AND document->>'methodology_binding_id'=methodology_binding_id
   AND jsonb_typeof(document->'execution_epoch')='number' AND (document->>'execution_epoch')::bigint=execution_epoch
   AND document->>'figure_rule' IN ('statement_figures_v1','statement_figures_v2')
   -- A version of the review-round rule freezes its snapshot; one before it has none.
   AND (document->>'figure_rule'='statement_figures_v2') = (jsonb_typeof(document->'snapshot') IS NOT DISTINCT FROM 'object')
   AND (NOT document ? 'change_request' OR (jsonb_typeof(document->'change_request')='object' AND author_kind='agent' AND document->>'figure_rule'='statement_figures_v2'))
   AND jsonb_typeof(document->'blocks')='array' AND jsonb_array_length(document->'blocks')=blocks
   AND jsonb_typeof(document->'missing_required')='array'
   AND to_jsonb(missing_required) = document->'missing_required'
   AND jsonb_typeof(document->'template')='object', false));

ALTER TABLE public.work_product_exports DROP CONSTRAINT work_product_exports_renderer_check;
ALTER TABLE public.work_product_exports ADD CONSTRAINT work_product_exports_renderer_check CHECK(renderer IN ('zobba-export-v1','zobba-export-v2'));

-- A proposal the agent records, in one answer invocation, to change or
-- remove a person's blocks at that person's applied Guide request: the
-- would-be version's whole document (its change request is added when the
-- person confirms) and the person's blocks it changes or removes.
CREATE TABLE public.work_product_proposals (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 id text NOT NULL CHECK(id ~ '^wpp-[0-9a-f]{40}$'),
 product_id text NOT NULL,
 base_version_id text NOT NULL CHECK(base_version_id ~ '^wpv-[0-9a-f]{40}$'),
 version_id text NOT NULL CHECK(version_id ~ '^wpv-[0-9a-f]{40}$'),
 requested_by text NOT NULL REFERENCES public.identities(id),
 request_id text NOT NULL CHECK(request_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 changes jsonb NOT NULL CHECK(jsonb_typeof(changes)='array' AND jsonb_array_length(changes) BETWEEN 1 AND 64 AND octet_length(changes::text) <= 8192),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text) <= 131072),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK(coalesce(document->>'record'='work_product_version' AND document->>'id'=version_id AND document->>'product_id'=product_id
   AND document->>'task_id'=task_id AND document->>'predecessor_id'=base_version_id AND document->>'author_kind'='agent'
   AND document->>'author_id'=invocation_id AND document->>'figure_rule'='statement_figures_v2' AND NOT document ? 'change_request', false)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,invocation_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,product_id) REFERENCES public.work_products(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,base_version_id) REFERENCES public.work_product_versions(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX work_product_proposals_base ON public.work_product_proposals(organisation_id,client_id,engagement_id,base_version_id,id COLLATE "C");

-- A person's decision on a proposal: confirmed (the version is recorded in
-- the same transaction) or declined. One per proposal.
CREATE TABLE public.work_product_proposal_decisions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 id text NOT NULL CHECK(id ~ '^wpd-[0-9a-f]{40}$'),
 proposal_id text NOT NULL,
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 decision text NOT NULL CHECK(decision IN ('confirmed','declined')),
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 PRIMARY KEY(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,proposal_id),
 UNIQUE(organisation_id,client_id,engagement_id,actor_id,key),
 FOREIGN KEY(organisation_id,client_id,engagement_id,proposal_id) REFERENCES public.work_product_proposals(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id)
);

-- ------------------------------------------------------------ currency

-- As 0022, and `superseded` also says, for a quote, whether a replacement
-- source corrects its original (21.4) and, for a period, whether a
-- successor basis supersedes its basis.
CREATE OR REPLACE FUNCTION public.work_product_current(org text, client text, engagement text, task text, versions text[])
RETURNS TABLE(version_id text, block_id text, ordinal integer, head_id text, verdict text, origin text, review text, superseded boolean, status text, registered text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
 WITH a AS MATERIALIZED (SELECT x.version_id, x.block_id, x.ordinal, x.kind, x.record_id FROM public.work_product_assertions x
     WHERE (x.organisation_id,x.client_id,x.engagement_id,x.task_id)=(org,client,engagement,task) AND x.version_id IN (SELECT pg_catalog.unnest(versions))),
  heads AS MATERIALIZED (SELECT * FROM public.work_product_heads(org,client,engagement,task, ARRAY(SELECT DISTINCT a.record_id FROM a WHERE a.kind='outcome'))),
  sums AS MATERIALIZED (SELECT * FROM public.work_product_summaries(org,client,engagement,task, ARRAY(SELECT DISTINCT a.record_id FROM a WHERE a.kind IN ('count','conclusion')))),
  facts AS MATERIALIZED (SELECT * FROM public.work_product_facts(org,client,engagement,task, ARRAY(SELECT DISTINCT a.record_id FROM a WHERE a.kind='fact'))),
  statuses AS MATERIALIZED (SELECT * FROM public.assessment_exception_statuses(org,client,engagement,task, ARRAY(SELECT DISTINCT a.record_id FROM a WHERE a.kind='exception'))),
  corrected AS MATERIALIZED (SELECT DISTINCT c.original_id FROM public.knowledge_source_corrections c
     WHERE (c.organisation_id,c.client_id,c.engagement_id)=(org,client,engagement) AND c.original_id IN (SELECT a.record_id FROM a WHERE a.kind='quote')),
  successors AS MATERIALIZED (SELECT DISTINCT b.supersedes FROM public.assessment_bases b
     WHERE (b.organisation_id,b.client_id,b.engagement_id)=(org,client,engagement) AND b.supersedes IN (SELECT a.record_id FROM a WHERE a.kind='period'))
 SELECT a.version_id, a.block_id, a.ordinal, h.head_id, h.verdict, h.origin, h.review,
   CASE a.kind WHEN 'quote' THEN EXISTS(SELECT 1 FROM corrected c WHERE c.original_id=a.record_id)
     WHEN 'period' THEN EXISTS(SELECT 1 FROM successors s WHERE s.supersedes=a.record_id)
     ELSE coalesce(s.superseded, f.superseded) END,
   x.status, o.digest
 FROM a
 LEFT JOIN heads h ON a.kind='outcome' AND h.id=a.record_id
 LEFT JOIN sums s ON a.kind IN ('count','conclusion') AND s.id=a.record_id
 LEFT JOIN facts f ON a.kind='fact' AND f.id=a.record_id
 LEFT JOIN statuses x ON a.kind='exception' AND x.id=a.record_id
 LEFT JOIN public.evidence_originals o ON a.kind='quote' AND (o.organisation_id,o.client_id,o.engagement_id,o.id)=(org,client,engagement,a.record_id)
$body$;

-- ------------------------------------------------------------- guards

-- As 0022, and:
-- - a version that names a change request is the agent's version of a
--   confirmed proposal: its document is the proposal's with the request
--   added (and its snapshot taken again when it is confirmed), it is
--   written by the person who asked and confirmed, a currently
--   assigned Auditor or Audit manager in their own session, and the
--   invocation is the proposal's of this Task, cycle, binding and epoch;
-- - a version of rule v2 has a title with no hidden display character;
-- - an export is rendered by `zobba-export-v2`;
-- - a proposal belongs to its answer invocation (under claim custody), its
--   base is the product's latest version, its request is an applied Guide
--   command of this Task by the person whose blocks it changes, and each
--   block it changes or removes is that person's block of the base, changed
--   in place (same ID, section, kind and label) or absent in its document;
-- - a decision is the requesting person's, in their own session, as a
--   currently assigned Auditor or Audit manager.
CREATE OR REPLACE FUNCTION public.work_product_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE template jsonb; product public.work_products%ROWTYPE; head public.work_product_versions%ROWTYPE;
 proposal public.work_product_proposals%ROWTYPE; decision public.work_product_proposal_decisions%ROWTYPE; request jsonb;
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
  request := NEW.document->'change_request';
  IF NEW.author_kind='agent' AND request IS NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
     AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id
     AND i.request->'context'->'verification'->>'expected_methodology_binding_id' = NEW.methodology_binding_id
     AND (i.request->'basis'->>'execution_epoch')::bigint = NEW.execution_epoch) THEN
    RAISE EXCEPTION 'an agent''s work-product version belongs to its answer invocation and its binding' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.author_kind='agent' THEN
   SELECT p.* INTO proposal FROM public.work_product_proposals p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,request->>'proposal_id');
   SELECT d.* INTO decision FROM public.work_product_proposal_decisions d WHERE (d.organisation_id,d.client_id,d.engagement_id,d.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,request->>'confirmation_id');
   IF proposal.id IS NULL OR decision.id IS NULL OR decision.proposal_id <> proposal.id OR decision.decision <> 'confirmed'
      OR decision.actor_id <> NEW.actor_id OR proposal.requested_by <> NEW.actor_id OR request->>'requested_by' IS DISTINCT FROM proposal.requested_by
      OR request->>'request_id' IS DISTINCT FROM proposal.request_id OR proposal.version_id <> NEW.id OR proposal.invocation_id <> NEW.invocation_id
      OR proposal.base_version_id IS DISTINCT FROM NEW.predecessor_id OR proposal.task_id <> NEW.task_id OR proposal.cycle_id <> NEW.cycle_id
      OR (SELECT count(*) FROM jsonb_object_keys(request)) <> 4
      -- The proposal's document, its snapshot taken again at confirmation.
      OR (NEW.document - 'change_request' - 'snapshot') IS DISTINCT FROM (proposal.document - 'snapshot') THEN
    RAISE EXCEPTION 'the agent changes a person''s work-product block only in a proposal that person confirmed' USING ERRCODE='23514';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
     AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id
     AND i.request->'context'->'verification'->>'expected_methodology_binding_id' = NEW.methodology_binding_id
     AND (i.request->'basis'->>'execution_epoch')::bigint = NEW.execution_epoch)
      OR NOT coalesce(public.knowledge_audit(NEW.actor_id, NEW.organisation_id, NEW.client_id, NEW.engagement_id), false)
      OR NOT coalesce(public.evidence_session_locked(NEW.actor_id, nullif(pg_catalog.current_setting('zobba.session_hash',true),'')), false) THEN
    RAISE EXCEPTION 'a confirmed proposal is recorded by the person who asked, a currently assigned auditor or audit manager in their own session' USING ERRCODE='23514';
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
  IF NEW.document->>'figure_rule'='statement_figures_v2'
     AND NEW.title ~ U&'[\00AD\034F\061C\115F\1160\17B4\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF9-\FFFB\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]' THEN
   RAISE EXCEPTION 'a work-product title holds no hidden display character' USING ERRCODE='23514';
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
  IF NEW.version = 1 AND (NEW.author_kind <> 'agent' OR NEW.invocation_id IS DISTINCT FROM product.invocation_id OR request IS NOT NULL) THEN
   RAISE EXCEPTION 'a work product''s first version is the agent''s, in the invocation that created it' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='work_product_exports' THEN
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
  IF NEW.renderer <> 'zobba-export-v2' THEN
   RAISE EXCEPTION 'a new export is rendered frozen at its version (zobba-export-v2)' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='work_product_proposals' THEN
  IF NOT EXISTS(SELECT 1 FROM public.model_invocations i WHERE (i.organisation_id,i.client_id,i.engagement_id,i.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.invocation_id)
    AND i.task_id=NEW.task_id AND i.cycle_id=NEW.cycle_id AND i.actor_id=NEW.actor_id) THEN
   RAISE EXCEPTION 'a work-product proposal belongs to its answer invocation' USING ERRCODE='23514';
  END IF;
  SELECT p.* INTO product FROM public.work_products p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.product_id);
  SELECT v.* INTO head FROM public.work_product_versions v WHERE (v.organisation_id,v.client_id,v.engagement_id,v.product_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.product_id)
   ORDER BY v.version DESC LIMIT 1;
  IF product.id IS NULL OR product.task_id <> NEW.task_id OR head.id IS DISTINCT FROM NEW.base_version_id THEN
   RAISE EXCEPTION 'a work-product proposal edits its product''s latest version: %', coalesce(head.id, 'none') USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.task_commands c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.request_id)
      AND c.kind='guide' AND c.target_task_id=NEW.task_id AND c.author_id=NEW.requested_by
      AND EXISTS(SELECT 1 FROM public.task_events e WHERE e.command_id=c.id AND e.kind='applied')) THEN
   RAISE EXCEPTION 'a work-product proposal answers an applied Guide request of the person whose blocks it changes' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.changes) c(value)
     WHERE jsonb_typeof(c.value)<>'object' OR c.value->>'change' IS NULL OR c.value->>'change' NOT IN ('changed','removed')
       OR (SELECT count(*) FROM jsonb_object_keys(c.value)) <> 2
       OR NOT EXISTS(SELECT 1 FROM public.work_product_blocks s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.version_id,s.block_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.base_version_id,c.value->>'block_id')
         AND s.author_kind='human' AND s.author_id=NEW.requested_by
         AND CASE c.value->>'change'
           WHEN 'removed' THEN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'blocks') b(value) WHERE b.value->>'block_id'=s.block_id)
           ELSE EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.document->'blocks') b(value) WHERE b.value->>'block_id'=s.block_id
             AND b.value->>'authored_in_version'=NEW.version_id AND b.value->>'section_id'=s.section_id AND b.value->>'kind'=s.kind
             AND b.value->>'label' IS NOT DISTINCT FROM s.label) END))
     OR (SELECT count(DISTINCT c.value->>'block_id') FROM jsonb_array_elements(NEW.changes) c(value)) <> jsonb_array_length(NEW.changes) THEN
   RAISE EXCEPTION 'a work-product proposal changes or removes only the requesting person''s blocks of its base' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT p.* INTO proposal FROM public.work_product_proposals p WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.proposal_id);
  IF proposal.id IS NULL OR proposal.task_id <> NEW.task_id OR proposal.requested_by <> NEW.actor_id
     OR NOT coalesce(public.knowledge_audit(NEW.actor_id, NEW.organisation_id, NEW.client_id, NEW.engagement_id), false)
     OR NOT coalesce(public.evidence_session_locked(NEW.actor_id, nullif(pg_catalog.current_setting('zobba.session_hash',true),'')), false) THEN
   RAISE EXCEPTION 'a proposal is decided by the person who asked, a currently assigned auditor or audit manager in their own session' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER work_product_guard BEFORE INSERT ON public.work_product_proposals FOR EACH ROW EXECUTE FUNCTION public.work_product_guard();
CREATE TRIGGER work_product_guard BEFORE INSERT ON public.work_product_proposal_decisions FOR EACH ROW EXECUTE FUNCTION public.work_product_guard();

-- As 0022, and for blocks written in a version of rule v2: no hidden display
-- character, and a new coverage or exceptions block names a summary or
-- basis that is current; for assertions written in a version: a quote's
-- original no replacement source corrects, a period's basis no successor
-- supersedes, and an outcome of a claim a person only edits keeps its
-- recorded review state (its verdict and origin still agree now); and every
-- block and assertion is the one its version's document lists, so nothing
-- is added to or altered in a recorded version, a kept claim included.
CREATE OR REPLACE FUNCTION public.work_product_batch() RETURNS trigger
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
     OR (a.authored_in_version = a.version_id AND v.document->>'figure_rule'='statement_figures_v2'
       AND a.body ~ U&'[\00AD\034F\061C\115F\1160\17B4\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF9-\FFFB\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]')
   LIMIT 1;
  IF FOUND THEN
   RAISE EXCEPTION 'a work-product block is of its version, its Task, its template and its author: %/%', bad.version_id, bad.block_id USING ERRCODE='23514';
  END IF;
  -- Every block is the one its version's document lists, when it is
  -- written: a block added to a recorded version later is refused.
  SELECT a.version_id, a.block_id INTO bad FROM added a
   JOIN public.work_product_versions v ON (v.organisation_id,v.client_id,v.engagement_id,v.id)=(a.organisation_id,a.client_id,a.engagement_id,a.version_id)
   WHERE NOT coalesce(v.document->'blocks'->a.ordinal->>'block_id' = a.block_id
     AND v.document->'blocks'->a.ordinal->>'section_id' = a.section_id
     AND v.document->'blocks'->a.ordinal->>'kind' = a.kind
     AND v.document->'blocks'->a.ordinal->>'label' IS NOT DISTINCT FROM a.label
     AND coalesce(v.document->'blocks'->a.ordinal->>'text', v.document->'blocks'->a.ordinal->>'statement') IS NOT DISTINCT FROM a.body
     AND v.document->'blocks'->a.ordinal->>'record_id' IS NOT DISTINCT FROM a.record_id
     AND v.document->'blocks'->a.ordinal->>'author_kind' = a.author_kind
     AND v.document->'blocks'->a.ordinal->>'author_id' = a.author_id
     AND v.document->'blocks'->a.ordinal->>'authored_in_version' = a.authored_in_version, false)
   LIMIT 1;
  IF FOUND THEN
   RAISE EXCEPTION 'a work-product block is the one its version''s document lists: %/%', bad.version_id, bad.block_id USING ERRCODE='23514';
  END IF;
  FOR org, client, engagement, task IN SELECT DISTINCT a.organisation_id, a.client_id, a.engagement_id, a.task_id FROM added a LOOP
   WITH placed AS MATERIALIZED (SELECT a.* FROM added a JOIN public.work_product_versions v ON (v.organisation_id,v.client_id,v.engagement_id,v.id)=(a.organisation_id,a.client_id,a.engagement_id,a.version_id)
      WHERE (a.organisation_id,a.client_id,a.engagement_id,a.task_id)=(org,client,engagement,task) AND a.authored_in_version = a.version_id
        AND a.kind IN ('coverage','exceptions') AND v.document->>'figure_rule'='statement_figures_v2'),
    sums AS MATERIALIZED (SELECT * FROM public.work_product_summaries(org,client,engagement,task, ARRAY(SELECT p.record_id FROM placed p WHERE p.kind='coverage')))
   SELECT p.version_id, p.block_id INTO bad FROM placed p
    LEFT JOIN sums s ON p.kind='coverage' AND s.id=p.record_id
    WHERE (p.kind='coverage' AND s.superseded IS DISTINCT FROM false)
      OR (p.kind='exceptions' AND EXISTS(SELECT 1 FROM public.assessment_bases n WHERE (n.organisation_id,n.client_id,n.engagement_id,n.supersedes)=(org,client,engagement,p.record_id)))
    LIMIT 1;
   IF FOUND THEN
    RAISE EXCEPTION 'a new work-product platform block names a current summary or basis of its Task: %/%', bad.version_id, bad.block_id USING ERRCODE='23514';
   END IF;
  END LOOP;
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
  -- The assertions written in their version, with what is true now; an
  -- assertion of a claim a person edits (a block of the predecessor) keeps
  -- its recorded review state.
  WITH fresh AS MATERIALIZED (SELECT a.*, (v.author_kind = 'human' AND EXISTS(SELECT 1 FROM public.work_product_blocks pb
        WHERE (pb.organisation_id,pb.client_id,pb.engagement_id,pb.version_id,pb.block_id)=(a.organisation_id,a.client_id,a.engagement_id,v.predecessor_id,a.block_id))) AS edited
     FROM added a JOIN public.work_product_blocks b
      ON (b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)=(a.organisation_id,a.client_id,a.engagement_id,a.version_id,a.block_id)
     JOIN public.work_product_versions v ON (v.organisation_id,v.client_id,v.engagement_id,v.id)=(a.organisation_id,a.client_id,a.engagement_id,a.version_id)
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
     WHEN 'outcome' THEN h.head_id = f.record_id AND h.digest = f.record_digest AND h.verdict = f.value AND h.origin = f.origin AND (h.review = f.review OR f.edited)
       AND h.subject IS NOT DISTINCT FROM f.subject AND f.record_kind = CASE WHEN f.record_id LIKE 'eval-%' THEN 'evaluation' ELSE 'revision' END
     WHEN 'count' THEN s.digest = f.record_digest AND NOT s.superseded AND s.kind = f.record_kind
       AND public.work_product_count(s.summary, f.measure, f.criterion_id)::text = f.value AND f.subject IS NULL
     WHEN 'conclusion' THEN s.digest = f.record_digest AND NOT s.superseded AND s.kind = f.record_kind AND s.conclusion = f.value AND f.subject IS NULL
     WHEN 'exception' THEN r.id IS NOT NULL AND e.status = f.value AND f.subject = r.subject
       AND public.work_product_exception_digest(r.id, r.task_id, r.criterion_root, r.subject) = f.record_digest
     WHEN 'fact' THEN x.digest = f.record_digest AND x.supported AND NOT x.superseded AND x.value = f.value
       AND x.unit IS NOT DISTINCT FROM f.unit AND x.subject = f.subject
     WHEN 'quote' THEN o.digest = f.record_digest AND f.subject IS NULL
       AND NOT EXISTS(SELECT 1 FROM public.knowledge_source_corrections c WHERE (c.organisation_id,c.client_id,c.engagement_id,c.original_id)=(org,client,engagement,f.record_id))
     WHEN 'period' THEN k.digest = f.record_digest AND (k.period_from::text || '/' || k.period_to::text) = f.value AND f.subject IS NULL
       AND NOT EXISTS(SELECT 1 FROM public.assessment_bases n WHERE (n.organisation_id,n.client_id,n.engagement_id,n.supersedes)=(org,client,engagement,k.id))
     END, false)
   LIMIT 1;
  IF FOUND THEN
   RAISE EXCEPTION 'a work-product assertion does not agree with its record now: %/%/%', bad.version_id, bad.block_id, bad.ordinal USING ERRCODE='23514';
  END IF;
 END LOOP;
 -- Every assertion is the one its version's document lists, when it is
 -- written: an altered assertion of a kept claim (which the record check
 -- above leaves to its predecessor) or one added to a recorded version
 -- later is refused.
 SELECT a.version_id, a.block_id, a.ordinal INTO bad FROM added a
  JOIN public.work_product_blocks b ON (b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)=(a.organisation_id,a.client_id,a.engagement_id,a.version_id,a.block_id)
  JOIN public.work_product_versions v ON (v.organisation_id,v.client_id,v.engagement_id,v.id)=(a.organisation_id,a.client_id,a.engagement_id,a.version_id)
  WHERE NOT coalesce(v.document->'blocks'->b.ordinal->'assertions'->a.ordinal = jsonb_build_object('kind',a.kind,'record_kind',a.record_kind,'record_id',a.record_id,'record_digest',a.record_digest,
    'measure',a.measure,'criterion_id',a.criterion_id,'value',a.value,'origin',a.origin,'review',a.review,'locator',a.locator,'unit',a.unit,'subject',a.subject), false)
  LIMIT 1;
 IF FOUND THEN
  RAISE EXCEPTION 'a work-product assertion is the one its version''s document lists: %/%/%', bad.version_id, bad.block_id, bad.ordinal USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $body$;

-- As 0022, and:
-- - an agent's version of a confirmed proposal may change in place (same
--   ID, section, kind, label) or drop exactly the person's blocks that
--   proposal lists, and keeps every other person's block;
-- - under rule v2 a required section is completed only by a narrative, a
--   claim or a placed coverage or exceptions block.
CREATE OR REPLACE FUNCTION public.work_product_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public SET enable_nestloop=off AS $body$
DECLARE product public.work_products%ROWTYPE; changes jsonb; requester text;
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
  -- The person's blocks a confirmed proposal changes or removes (none
  -- otherwise; the guard checked the proposal and its confirmation).
  IF NEW.document ? 'change_request' THEN
   SELECT p.changes, p.requested_by INTO changes, requester FROM public.work_product_proposals p
    WHERE (p.organisation_id,p.client_id,p.engagement_id,p.id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.document->'change_request'->>'proposal_id');
  END IF;
  changes := coalesce(changes, '[]'::jsonb);
  -- The agent writes new blocks under new IDs and keeps every person's
  -- block, but for the ones a confirmed proposal of that person lists.
  IF EXISTS(SELECT 1 FROM public.work_product_blocks b
     WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.id) AND b.authored_in_version = NEW.id
       AND EXISTS(SELECT 1 FROM public.work_product_blocks s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.version_id,s.block_id)=(b.organisation_id,b.client_id,b.engagement_id,NEW.predecessor_id,b.block_id)
         AND NOT coalesce(s.author_kind = 'human' AND s.author_id = requester AND (s.section_id,s.kind,s.label) IS NOT DISTINCT FROM (b.section_id,b.kind,b.label)
           AND changes @> jsonb_build_array(jsonb_build_object('block_id', s.block_id, 'change', 'changed')), false)))
    OR EXISTS(SELECT 1 FROM public.work_product_blocks s
     WHERE (s.organisation_id,s.client_id,s.engagement_id,s.version_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.predecessor_id) AND s.author_kind = 'human'
       AND NOT EXISTS(SELECT 1 FROM public.work_product_blocks b WHERE (b.organisation_id,b.client_id,b.engagement_id,b.version_id,b.block_id)=(s.organisation_id,s.client_id,s.engagement_id,NEW.id,s.block_id)
         AND b.authored_in_version = s.authored_in_version)
       AND NOT coalesce(s.author_id = requester AND (changes @> jsonb_build_array(jsonb_build_object('block_id', s.block_id, 'change', 'removed'))
         OR changes @> jsonb_build_array(jsonb_build_object('block_id', s.block_id, 'change', 'changed'))), false)) THEN
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
          AND b.section_id = s.value->>'id'
          AND CASE WHEN NEW.document->>'figure_rule'='statement_figures_v2' THEN b.kind IN ('narrative','claim','coverage','exceptions') ELSE b.kind <> 'limitations' END)
      ORDER BY s.n) THEN
  RAISE EXCEPTION 'a work-product version states exactly its missing required sections' USING ERRCODE='23514';
 END IF;
 IF NEW.version > 1 AND (SELECT count(*) FROM public.work_product_versions v WHERE (v.organisation_id,v.client_id,v.engagement_id,v.product_id)=(NEW.organisation_id,NEW.client_id,NEW.engagement_id,NEW.product_id)) > 256 THEN
  RAISE EXCEPTION 'a work product holds at most 256 versions' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $body$;

DO $immutable$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['work_product_proposals','work_product_proposal_decisions'] LOOP
  EXECUTE format('CREATE TRIGGER work_product_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.work_product_immutable()',relation);
  EXECUTE format('CREATE TRIGGER work_product_retained BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.work_product_retained()',relation);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT USING (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)))',relation,relation,relation,relation);
  EXECUTE format('CREATE POLICY scoped_insert ON public.%I FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)) AND actor_id=pg_catalog.current_setting(''zobba.actor_id'',true))',relation,relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $immutable$;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=24) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=24;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
