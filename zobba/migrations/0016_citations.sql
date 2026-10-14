-- Story 22.5 native reading and verified citations. Additive: published schemas
-- 1-15 are unchanged. Every record is an immutable fact written by trusted code:
-- trusted page renders (facts of the 22.4 render job's validated descendants),
-- native page reads (each bound to its one disclosure-bound model invocation),
-- each page request's outcome, model-requested program runs, and the
-- verification of each cited source. `*_us` columns are database time in
-- microseconds, the order every reader uses.
CREATE TABLE public.document_renders (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 original_id text NOT NULL,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[0-9a-f]{64}$'),
 -- Pages batch*32+1 ..= batch*32+32 for page numbers up to 10000. At most 200
 -- distinct pages of a document are read natively per Task (a count, below).
 batch integer NOT NULL CHECK(batch BETWEEN 0 AND 312),
 job_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('rendered','unsupported','unreadable')),
 reason text CHECK(reason ~ '^[a-z_]{1,64}$'),
 page_count integer NOT NULL CHECK(page_count BETWEEN 0 AND 100000),
 created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 CHECK(status='rendered' OR page_count=0),
 PRIMARY KEY(organisation_id,client_id,engagement_id,original_id,original_sha256,batch),
 FOREIGN KEY(organisation_id,client_id,engagement_id,original_id) REFERENCES public.evidence_originals(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,job_id) REFERENCES public.analysis_jobs(organisation_id,client_id,engagement_id,id)
);
CREATE TABLE public.document_pages (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 original_id text NOT NULL, original_sha256 text NOT NULL, batch integer NOT NULL,
 page integer NOT NULL CHECK(page BETWEEN 1 AND 10016),
 image_id text,
 image_sha256 text CHECK(image_sha256 ~ '^[0-9a-f]{64}$'),
 image_size bigint CHECK(image_size BETWEEN 1 AND 2097152),
 image_media_type text CHECK(image_media_type IN ('image/png','image/jpeg')),
 text_layer text CHECK(octet_length(text_layer) <= 65536),
 -- A page without an image says why: no bounded rendering fit, or it failed.
 reason text CHECK(reason IN ('page_too_large','render_failed')),
 CHECK((image_id IS NULL) = (reason IS NOT NULL)),
 CHECK((image_id IS NULL) = (image_sha256 IS NULL) AND (image_id IS NULL) = (image_size IS NULL) AND (image_id IS NULL) = (image_media_type IS NULL)),
 CHECK((page-1)/32 = batch),
 PRIMARY KEY(organisation_id,client_id,engagement_id,original_id,original_sha256,page),
 FOREIGN KEY(organisation_id,client_id,engagement_id,original_id,original_sha256,batch) REFERENCES public.document_renders(organisation_id,client_id,engagement_id,original_id,original_sha256,batch),
 FOREIGN KEY(organisation_id,client_id,engagement_id,image_id) REFERENCES public.analysis_descendants(organisation_id,client_id,engagement_id,id)
);
CREATE TABLE public.task_page_reads (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 original_id text NOT NULL,
 original_sha256 text NOT NULL CHECK(original_sha256 ~ '^[0-9a-f]{64}$'),
 page integer NOT NULL CHECK(page BETWEEN 1 AND 10000),
 -- At most three counted attempts; transient provider failures are recorded
 -- but not counted, up to six tries in all.
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 6),
 image_sha256 text CHECK(image_sha256 ~ '^[0-9a-f]{64}$'),
 invocation_id text,
 status text NOT NULL CHECK(status IN ('read','failed')),
 transcript jsonb CHECK(jsonb_typeof(transcript)='object' AND octet_length(transcript::text) <= 65536),
 reason text CHECK(reason ~ '^[a-z_]{1,64}$'),
 created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 -- A read names its exact image and disclosure invocation and keeps text; a
 -- failed read keeps no text and a closed reason.
 CHECK((status='read') = (transcript IS NOT NULL)),
 CHECK(status <> 'read' OR (reason IS NULL AND image_sha256 IS NOT NULL AND invocation_id IS NOT NULL)),
 CHECK(status <> 'failed' OR reason IS NOT NULL),
 PRIMARY KEY(organisation_id,client_id,engagement_id,task_id,original_id,original_sha256,page,attempt),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,original_id) REFERENCES public.evidence_originals(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
-- One successful native read of a page per Task: re-reading never discloses again.
CREATE UNIQUE INDEX task_page_reads_one_read ON public.task_page_reads(organisation_id,client_id,engagement_id,task_id,original_id,original_sha256,page) WHERE status='read';
-- One page-read invocation covers exactly one read attempt.
CREATE UNIQUE INDEX task_page_reads_invocation ON public.task_page_reads(invocation_id) WHERE invocation_id IS NOT NULL;
-- What each read_pages request of one answer produced: a new read, a reuse of
-- the Task's earlier successful read, a failed attempt, or a refusal with a
-- closed reason. It links the read it depends on, so later context can show
-- the transcription a request relies on and report refusals back.
CREATE TABLE public.task_page_requests (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 3),
 -- As the model named it: a refused request may name no registered original.
 original_id text NOT NULL CHECK(original_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 page integer NOT NULL CHECK(page BETWEEN 1 AND 10000),
 outcome text NOT NULL CHECK(outcome IN ('read','reused','failed','refused')),
 reason text CHECK(reason ~ '^[a-z_]{1,64}$'),
 read_sha256 text CHECK(read_sha256 ~ '^[0-9a-f]{64}$'),
 read_attempt integer,
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((read_sha256 IS NULL) = (read_attempt IS NULL)),
 CHECK((outcome='refused') = (read_sha256 IS NULL)),
 CHECK((outcome IN ('failed','refused')) = (reason IS NOT NULL)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,original_id,read_sha256,page,read_attempt) REFERENCES public.task_page_reads(organisation_id,client_id,engagement_id,task_id,original_id,original_sha256,page,attempt)
);
CREATE INDEX task_page_requests_cycle ON public.task_page_requests(organisation_id,client_id,engagement_id,task_id,cycle_id,created_us);
CREATE TABLE public.task_program_runs (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 invocation_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal = 0),
 job_id text,
 status text NOT NULL CHECK(status IN ('completed','failed')),
 output text CHECK(octet_length(output) <= 32768),
 reason text CHECK(reason ~ '^[a-z_]{1,64}$'),
 created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 created_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK((status='completed') = (output IS NOT NULL AND job_id IS NOT NULL)),
 CHECK(status <> 'failed' OR (reason IS NOT NULL AND output IS NULL)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,invocation_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,job_id) REFERENCES public.analysis_jobs(organisation_id,client_id,engagement_id,id)
);
-- The verification of one answer: written once, after all its sources. A
-- `failed` verification could not be completed for a reason that is not
-- transient; the answer is still shown, with its sources unchecked.
CREATE TABLE public.answer_verifications (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 invocation_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 status text NOT NULL CHECK(status IN ('verified','failed')),
 citations integer NOT NULL CHECK(citations BETWEEN 0 AND 64),
 sources integer NOT NULL CHECK(sources BETWEEN 0 AND 128),
 verified_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 verified_us bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
 CHECK(status='verified' OR (citations=0 AND sources=0)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,invocation_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
CREATE TABLE public.answer_citations (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 invocation_id text NOT NULL,
 segment integer NOT NULL CHECK(segment BETWEEN 0 AND 63),
 span_start integer NOT NULL CHECK(span_start >= 0),
 span_end integer NOT NULL CHECK(span_end <= 16384),
 CHECK(span_start < span_end),
 PRIMARY KEY(organisation_id,client_id,engagement_id,invocation_id,segment),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
CREATE TABLE public.citation_sources (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 invocation_id text NOT NULL,
 segment integer NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 7),
 original_id text NOT NULL CHECK(original_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 locator text CHECK(octet_length(locator) BETWEEN 1 AND 300 AND locator !~ '[[:cntrl:]]'),
 quote text NOT NULL CHECK(octet_length(quote) <= 1000),
 original_sha256 text CHECK(original_sha256 ~ '^[0-9a-f]{64}$'),
 verification text NOT NULL CHECK(verification IN ('verified','unverified')),
 reason text CHECK(reason IN ('not_found_at_location','location_missing','source_unreadable','page_only')),
 -- Exactly one closed reason for an unverified source and none otherwise; a
 -- verified source names the exact original digest it was read in; a source
 -- without a locator can only be location_missing.
 CHECK((verification='unverified') = (reason IS NOT NULL)),
 CHECK(verification <> 'verified' OR original_sha256 IS NOT NULL),
 CHECK(locator IS NOT NULL OR reason='location_missing'),
 PRIMARY KEY(organisation_id,client_id,engagement_id,invocation_id,segment,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id,segment) REFERENCES public.answer_citations(organisation_id,client_id,engagement_id,invocation_id,segment)
);
CREATE INDEX citation_sources_original ON public.citation_sources(organisation_id,client_id,engagement_id,original_id COLLATE "C");
-- Facts must agree with what trusted code actually recorded elsewhere.
CREATE FUNCTION public.reading_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE render public.document_renders%ROWTYPE; earlier integer; program bytea; pread public.task_page_reads%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='analysis_jobs' THEN
  -- Only the exact trusted document program (pinned by the SHA-256 and length
  -- of its server-owned text, called once over one JSON string literal) runs
  -- in the document environment, the one whose outputs may be page images.
  IF NEW.environment_id='document-python-3-13' THEN
   program := convert_to(NEW.program,'UTF8');
   IF octet_length(program) <= 19327
      OR encode(sha256(substring(program FROM 1 FOR 19327)),'hex') <> '8abd34b8ef01866706cb18717a95ace272cedf55ce675cb0d7796553983ca849'
      OR convert_from(substring(program FROM 19327+1),'UTF8')
         !~ '^\nimport json as _zobba_json\nmain\(_zobba_json\.loads\("([A-Za-z0-9 _:.,{}\[\]-]|\\u[0-9a-f]{4}|\\U[0-9a-f]{8})*"\)\)\n$' THEN
    RAISE EXCEPTION 'only the trusted document program runs in the document environment' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='document_renders' THEN
  -- A render is the fact of a collected job over exactly this original.
  IF NOT EXISTS(SELECT 1 FROM public.analysis_jobs j JOIN public.analysis_job_events e ON e.job_id=j.id AND e.status='collected'
     WHERE j.id=NEW.job_id AND j.environment_id='document-python-3-13'
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
CREATE TRIGGER reading_guard BEFORE INSERT ON public.document_renders FOR EACH ROW EXECUTE FUNCTION public.reading_guard();
CREATE TRIGGER reading_guard BEFORE INSERT ON public.document_pages FOR EACH ROW EXECUTE FUNCTION public.reading_guard();
CREATE TRIGGER reading_guard BEFORE INSERT ON public.task_page_reads FOR EACH ROW EXECUTE FUNCTION public.reading_guard();
CREATE TRIGGER reading_guard BEFORE INSERT ON public.task_page_requests FOR EACH ROW EXECUTE FUNCTION public.reading_guard();
CREATE TRIGGER reading_guard BEFORE INSERT ON public.task_program_runs FOR EACH ROW EXECUTE FUNCTION public.reading_guard();
CREATE TRIGGER reading_guard BEFORE INSERT ON public.analysis_jobs FOR EACH ROW EXECUTE FUNCTION public.reading_guard();
CREATE TRIGGER reading_guard BEFORE INSERT ON public.answer_verifications FOR EACH ROW EXECUTE FUNCTION public.reading_guard();
CREATE TRIGGER reading_guard BEFORE INSERT ON public.answer_citations FOR EACH ROW EXECUTE FUNCTION public.reading_guard();
CREATE TRIGGER reading_guard BEFORE INSERT ON public.citation_sources FOR EACH ROW EXECUTE FUNCTION public.reading_guard();
-- Every reading and citation record is an immutable fact, even for the owner.
CREATE FUNCTION public.reading_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 RAISE EXCEPTION 'reading and citation records are immutable' USING ERRCODE='23514';
END $body$;
CREATE TRIGGER reading_immutable BEFORE UPDATE ON public.document_renders FOR EACH ROW EXECUTE FUNCTION public.reading_immutable();
CREATE TRIGGER reading_immutable BEFORE UPDATE ON public.document_pages FOR EACH ROW EXECUTE FUNCTION public.reading_immutable();
CREATE TRIGGER reading_immutable BEFORE UPDATE ON public.task_page_reads FOR EACH ROW EXECUTE FUNCTION public.reading_immutable();
CREATE TRIGGER reading_immutable BEFORE UPDATE ON public.task_page_requests FOR EACH ROW EXECUTE FUNCTION public.reading_immutable();
CREATE TRIGGER reading_immutable BEFORE UPDATE ON public.task_program_runs FOR EACH ROW EXECUTE FUNCTION public.reading_immutable();
CREATE TRIGGER reading_immutable BEFORE UPDATE ON public.answer_verifications FOR EACH ROW EXECUTE FUNCTION public.reading_immutable();
CREATE TRIGGER reading_immutable BEFORE UPDATE ON public.answer_citations FOR EACH ROW EXECUTE FUNCTION public.reading_immutable();
CREATE TRIGGER reading_immutable BEFORE UPDATE ON public.citation_sources FOR EACH ROW EXECUTE FUNCTION public.reading_immutable();
REVOKE ALL ON FUNCTION public.reading_guard(),public.reading_immutable() FROM PUBLIC;
ALTER TABLE public.document_renders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_renders FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.document_renders FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(document_renders.organisation_id,document_renders.client_id,document_renders.engagement_id)));
CREATE POLICY scoped_insert ON public.document_renders FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(document_renders.organisation_id,document_renders.client_id,document_renders.engagement_id)));
ALTER TABLE public.document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_pages FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.document_pages FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(document_pages.organisation_id,document_pages.client_id,document_pages.engagement_id)));
CREATE POLICY scoped_insert ON public.document_pages FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(document_pages.organisation_id,document_pages.client_id,document_pages.engagement_id)));
ALTER TABLE public.task_page_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_page_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.task_page_reads FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_page_reads.organisation_id,task_page_reads.client_id,task_page_reads.engagement_id)));
CREATE POLICY scoped_insert ON public.task_page_reads FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_page_reads.organisation_id,task_page_reads.client_id,task_page_reads.engagement_id)) AND actor_id=pg_catalog.current_setting('zobba.actor_id',true));
ALTER TABLE public.task_page_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_page_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.task_page_requests FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_page_requests.organisation_id,task_page_requests.client_id,task_page_requests.engagement_id)));
CREATE POLICY scoped_insert ON public.task_page_requests FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_page_requests.organisation_id,task_page_requests.client_id,task_page_requests.engagement_id)) AND actor_id=pg_catalog.current_setting('zobba.actor_id',true));
ALTER TABLE public.task_program_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_program_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.task_program_runs FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_program_runs.organisation_id,task_program_runs.client_id,task_program_runs.engagement_id)));
CREATE POLICY scoped_insert ON public.task_program_runs FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_program_runs.organisation_id,task_program_runs.client_id,task_program_runs.engagement_id)) AND actor_id=pg_catalog.current_setting('zobba.actor_id',true));
ALTER TABLE public.answer_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.answer_verifications FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(answer_verifications.organisation_id,answer_verifications.client_id,answer_verifications.engagement_id)));
CREATE POLICY scoped_insert ON public.answer_verifications FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(answer_verifications.organisation_id,answer_verifications.client_id,answer_verifications.engagement_id)) AND actor_id=pg_catalog.current_setting('zobba.actor_id',true));
ALTER TABLE public.answer_citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_citations FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.answer_citations FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(answer_citations.organisation_id,answer_citations.client_id,answer_citations.engagement_id)));
CREATE POLICY scoped_insert ON public.answer_citations FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(answer_citations.organisation_id,answer_citations.client_id,answer_citations.engagement_id)));
ALTER TABLE public.citation_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citation_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.citation_sources FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(citation_sources.organisation_id,citation_sources.client_id,citation_sources.engagement_id)));
CREATE POLICY scoped_insert ON public.citation_sources FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(citation_sources.organisation_id,citation_sources.client_id,citation_sources.engagement_id)));
REVOKE ALL ON public.document_renders,public.document_pages,public.task_page_reads,public.task_page_requests,public.task_program_runs,public.answer_verifications,public.answer_citations,public.citation_sources FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=16) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=16;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
