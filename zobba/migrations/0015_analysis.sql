-- Story 22.4 measured analysis jobs. Additive: published schemas 1-14 are unchanged.
-- A job is the durable meaning of one admitted operation (20.5 custody). Its
-- status is an append-only fact sequence; descendants and rejections are written
-- only after confirmed termination, by trusted collection, never by the job.
CREATE TABLE public.analysis_jobs (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 operation_id text NOT NULL UNIQUE,
 environment_id text NOT NULL CHECK(environment_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 image_digest text NOT NULL CHECK(image_digest ~ '^sha256:[0-9a-f]{64}$'),
 program text NOT NULL CHECK(octet_length(program) BETWEEN 1 AND 262144),
 program_sha256 text NOT NULL CHECK(program_sha256 ~ '^[0-9a-f]{64}$'),
 inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='array' AND jsonb_array_length(inputs)<=16 AND octet_length(inputs::text)<=8192),
 limits jsonb NOT NULL CHECK(jsonb_typeof(limits)='object' AND octet_length(limits::text)<=1024),
 created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 UNIQUE(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,operation_id) REFERENCES public.operations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX analysis_jobs_task ON public.analysis_jobs(organisation_id,client_id,engagement_id,task_id,id COLLATE "C");
CREATE TABLE public.analysis_job_events (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 job_id text NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 0 AND 255),
 status text NOT NULL CHECK(status IN ('admitted','possibly_started','running','completed','failed','limit_exceeded','stopped','collected','unknown','absent')),
 attempt_id text CHECK(attempt_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 reason text CHECK(reason ~ '^[a-z_]{1,64}$'),
 exit_code integer,
 receipt jsonb CHECK(jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=65536),
 created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 CHECK((status='admitted')=(attempt_id IS NULL)),
 CHECK((status='collected')=(receipt IS NOT NULL)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,job_id,sequence),
 UNIQUE(job_id,sequence),
 FOREIGN KEY(organisation_id,client_id,engagement_id,job_id) REFERENCES public.analysis_jobs(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,attempt_id) REFERENCES public.operation_attempts(organisation_id,client_id,engagement_id,id)
);
CREATE TABLE public.analysis_descendants (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 job_id text NOT NULL,
 attempt_id text NOT NULL,
 path text NOT NULL CHECK(octet_length(path) BETWEEN 1 AND 255 AND path !~ '[[:cntrl:]]' AND path !~ '^/' AND path !~ '(^|/)\.{0,2}(/|$)' AND strpos(path, '\') = 0),
 parents jsonb NOT NULL CHECK(jsonb_typeof(parents)='array' AND jsonb_array_length(parents)<=16),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 size bigint NOT NULL CHECK(size BETWEEN 0 AND 10485760),
 media_type text NOT NULL CHECK(media_type IN ('application/json','image/png','text/csv','text/markdown','text/plain')),
 namespace text NOT NULL CHECK(namespace ~ '^[0-9a-f]{64}$'),
 version text NOT NULL CHECK(octet_length(version) BETWEEN 1 AND 512 AND version <> 'null' AND version !~ '[[:cntrl:]]'),
 registered_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 UNIQUE(organisation_id,client_id,engagement_id,id),
 UNIQUE(job_id,path),
 FOREIGN KEY(organisation_id,client_id,engagement_id,job_id) REFERENCES public.analysis_jobs(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,attempt_id) REFERENCES public.operation_attempts(organisation_id,client_id,engagement_id,id)
);
-- Case-insensitive uniqueness is part of the output contract, not only of collection.
CREATE UNIQUE INDEX analysis_descendants_folded ON public.analysis_descendants(job_id,lower(path));
CREATE TABLE public.analysis_rejections (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 job_id text NOT NULL,
 attempt_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 4095),
 path_sha256 text NOT NULL CHECK(path_sha256 ~ '^[0-9a-f]{64}$'),
 reason text NOT NULL CHECK(reason IN ('encoding','nul','control_character','reserved_character','absolute','parent_reference','not_normalized','too_long','too_deep','duplicate','case_collision','symlink','hardlink','fifo','socket','device','not_regular','file_too_large','size_mismatch','too_many_files','total_too_large','media_type','collection_truncated')),
 PRIMARY KEY(organisation_id,client_id,engagement_id,job_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,job_id) REFERENCES public.analysis_jobs(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,attempt_id) REFERENCES public.operation_attempts(organisation_id,client_id,engagement_id,id)
);
-- Status facts follow the domain machine. The first fact is admission; a new
-- attempt starts only from admission or source-confirmed absence and never reuses
-- an earlier attempt, which fences a delayed starter; every other fact names the
-- current attempt. Collection proves its own counts.
CREATE FUNCTION public.analysis_event_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE previous public.analysis_job_events%ROWTYPE; operation text; allowed boolean;
BEGIN
 IF NEW.sequence <> (SELECT count(*) FROM public.analysis_job_events e WHERE e.job_id=NEW.job_id) THEN
  RAISE EXCEPTION 'analysis facts are appended in sequence' USING ERRCODE='23514';
 END IF;
 IF NEW.sequence = 0 THEN
  IF NEW.status <> 'admitted' THEN
   RAISE EXCEPTION 'an analysis job starts admitted' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO previous FROM public.analysis_job_events e WHERE e.job_id=NEW.job_id AND e.sequence=NEW.sequence-1;
 allowed := CASE previous.status
  WHEN 'admitted' THEN NEW.status IN ('possibly_started','absent')
  WHEN 'absent' THEN NEW.status IN ('possibly_started','absent')
  WHEN 'possibly_started' THEN NEW.status IN ('running','completed','failed','limit_exceeded','stopped','absent','unknown')
  WHEN 'running' THEN NEW.status IN ('completed','failed','limit_exceeded','stopped','unknown')
  WHEN 'completed' THEN NEW.status IN ('collected','unknown')
  WHEN 'failed' THEN NEW.status IN ('collected','unknown')
  WHEN 'limit_exceeded' THEN NEW.status IN ('collected','unknown')
  WHEN 'unknown' THEN NEW.status IN ('absent','completed','failed','limit_exceeded','stopped')
  ELSE false END;
 IF NOT coalesce(allowed,false) THEN
  RAISE EXCEPTION 'analysis status transition refused' USING ERRCODE='23514';
 END IF;
 SELECT j.operation_id INTO operation FROM public.analysis_jobs j WHERE j.id=NEW.job_id;
 IF NOT EXISTS(SELECT 1 FROM public.operation_attempts a WHERE a.id=NEW.attempt_id AND a.operation_id=operation) THEN
  RAISE EXCEPTION 'analysis facts name an attempt of the job operation' USING ERRCODE='23514';
 END IF;
 IF NEW.status='possibly_started' OR (NEW.status='absent' AND previous.status IN ('admitted','absent')) THEN
  IF EXISTS(SELECT 1 FROM public.analysis_job_events e WHERE e.job_id=NEW.job_id AND e.attempt_id=NEW.attempt_id) THEN
   RAISE EXCEPTION 'an analysis attempt starts at most once' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.attempt_id IS DISTINCT FROM previous.attempt_id THEN
  RAISE EXCEPTION 'analysis facts name the current attempt' USING ERRCODE='23514';
 END IF;
 IF NEW.status='collected' AND (
   jsonb_typeof(NEW.receipt->'descendants') IS DISTINCT FROM 'array'
   OR jsonb_typeof(NEW.receipt->'rejected') IS DISTINCT FROM 'array'
   OR jsonb_array_length(NEW.receipt->'descendants') <> (SELECT count(*) FROM public.analysis_descendants d WHERE d.job_id=NEW.job_id)
   OR jsonb_array_length(NEW.receipt->'rejected') <> (SELECT count(*) FROM public.analysis_rejections r WHERE r.job_id=NEW.job_id)) THEN
  RAISE EXCEPTION 'an analysis collection receipt matches its records' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER analysis_event_guard BEFORE INSERT ON public.analysis_job_events
 FOR EACH ROW EXECUTE FUNCTION public.analysis_event_guard();
-- Outputs exist only after confirmed termination of the current attempt, before
-- its collection fact, and name exactly the job's parent originals.
CREATE FUNCTION public.analysis_output_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE latest public.analysis_job_events%ROWTYPE; parents jsonb;
BEGIN
 SELECT * INTO latest FROM public.analysis_job_events e WHERE e.job_id=NEW.job_id ORDER BY e.sequence DESC LIMIT 1;
 IF NOT FOUND OR latest.status NOT IN ('completed','failed','limit_exceeded') OR latest.attempt_id IS DISTINCT FROM NEW.attempt_id THEN
  RAISE EXCEPTION 'analysis outputs follow confirmed termination' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='analysis_descendants' THEN
  SELECT coalesce(jsonb_agg(i.value->'original_id' ORDER BY i.ordinality),'[]'::jsonb) INTO parents
   FROM public.analysis_jobs j, jsonb_array_elements(j.inputs) WITH ORDINALITY i WHERE j.id=NEW.job_id;
  IF NEW.parents IS DISTINCT FROM parents THEN
   RAISE EXCEPTION 'a descendant names exactly its parent originals' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER analysis_output_guard BEFORE INSERT ON public.analysis_descendants
 FOR EACH ROW EXECUTE FUNCTION public.analysis_output_guard();
CREATE TRIGGER analysis_output_guard BEFORE INSERT ON public.analysis_rejections
 FOR EACH ROW EXECUTE FUNCTION public.analysis_output_guard();
-- Every analysis record is an immutable fact, even for the owner. Runtime holds
-- no UPDATE or DELETE grant; owner whole-aggregate fixture resets remain possible.
CREATE FUNCTION public.analysis_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
BEGIN
 RAISE EXCEPTION 'analysis records are immutable' USING ERRCODE='23514';
END $body$;
CREATE TRIGGER analysis_immutable BEFORE UPDATE ON public.analysis_jobs
 FOR EACH ROW EXECUTE FUNCTION public.analysis_immutable();
CREATE TRIGGER analysis_immutable BEFORE UPDATE ON public.analysis_job_events
 FOR EACH ROW EXECUTE FUNCTION public.analysis_immutable();
CREATE TRIGGER analysis_immutable BEFORE UPDATE ON public.analysis_descendants
 FOR EACH ROW EXECUTE FUNCTION public.analysis_immutable();
CREATE TRIGGER analysis_immutable BEFORE UPDATE ON public.analysis_rejections
 FOR EACH ROW EXECUTE FUNCTION public.analysis_immutable();
REVOKE ALL ON FUNCTION public.analysis_event_guard(),public.analysis_output_guard(),public.analysis_immutable() FROM PUBLIC;
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.analysis_jobs FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(analysis_jobs.organisation_id,analysis_jobs.client_id,analysis_jobs.engagement_id)));
CREATE POLICY scoped_insert ON public.analysis_jobs FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(analysis_jobs.organisation_id,analysis_jobs.client_id,analysis_jobs.engagement_id)) AND actor_id=pg_catalog.current_setting('zobba.actor_id',true));
ALTER TABLE public.analysis_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_job_events FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.analysis_job_events FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(analysis_job_events.organisation_id,analysis_job_events.client_id,analysis_job_events.engagement_id)));
CREATE POLICY scoped_insert ON public.analysis_job_events FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(analysis_job_events.organisation_id,analysis_job_events.client_id,analysis_job_events.engagement_id)));
ALTER TABLE public.analysis_descendants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_descendants FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.analysis_descendants FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(analysis_descendants.organisation_id,analysis_descendants.client_id,analysis_descendants.engagement_id)));
CREATE POLICY scoped_insert ON public.analysis_descendants FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(analysis_descendants.organisation_id,analysis_descendants.client_id,analysis_descendants.engagement_id)));
ALTER TABLE public.analysis_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_rejections FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.analysis_rejections FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(analysis_rejections.organisation_id,analysis_rejections.client_id,analysis_rejections.engagement_id)));
CREATE POLICY scoped_insert ON public.analysis_rejections FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(analysis_rejections.organisation_id,analysis_rejections.client_id,analysis_rejections.engagement_id)));
REVOKE ALL ON public.analysis_jobs,public.analysis_job_events,public.analysis_descendants,public.analysis_rejections FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=15) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=15;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
