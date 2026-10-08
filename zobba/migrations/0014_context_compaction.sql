-- Story 22.3 context compaction. Additive: published schemas 1-13 are unchanged.
-- A compaction record lists only facts the platform already owns (step facts and
-- the knowledge revisions earlier turns used); it is never a model summary and
-- never evidence. Raw steps, invocations and results are not altered.
ALTER TABLE public.task_steps ADD COLUMN reason text CHECK(reason IN ('context_budget'));
ALTER TABLE public.task_steps ADD COLUMN estimated_input_tokens bigint CHECK(estimated_input_tokens >= 0);
ALTER TABLE public.task_steps ADD COLUMN actual_input_tokens bigint CHECK(actual_input_tokens >= 0);
ALTER TABLE public.task_steps ADD CONSTRAINT task_steps_context_accounting CHECK(
 (reason IS NULL OR (kind='model_turn' AND status='failed'))
 AND (kind='model_turn' OR (estimated_input_tokens IS NULL AND actual_input_tokens IS NULL)));
CREATE TABLE public.task_context_compactions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 0 AND 255),
 first_ordinal integer NOT NULL CHECK(first_ordinal BETWEEN 0 AND 4095),
 last_ordinal integer NOT NULL CHECK(last_ordinal BETWEEN 0 AND 4095),
 digest jsonb NOT NULL CHECK(jsonb_typeof(digest)='object' AND octet_length(digest::text)<=262144),
 digest_sha256 text NOT NULL CHECK(digest_sha256 ~ '^[0-9a-f]{64}$'),
 sources jsonb NOT NULL CHECK(jsonb_typeof(sources)='array' AND jsonb_array_length(sources)<=512 AND octet_length(sources::text)<=131072),
 omissions jsonb NOT NULL CHECK(jsonb_typeof(omissions)='object' AND octet_length(omissions::text)<=4096),
 estimated_tokens bigint NOT NULL CHECK(estimated_tokens >= 0),
 created_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 CHECK(first_ordinal <= last_ordinal),
 PRIMARY KEY(organisation_id,client_id,engagement_id,task_id,cycle_id,sequence),
 UNIQUE(task_id,cycle_id,sequence),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id,first_ordinal) REFERENCES public.task_steps(organisation_id,client_id,engagement_id,task_id,cycle_id,ordinal),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id,last_ordinal) REFERENCES public.task_steps(organisation_id,client_id,engagement_id,task_id,cycle_id,ordinal)
);
-- Records cover contiguous, non-overlapping ranges in sequence order. Runs with
-- the inserting role's own row visibility and is trigger-only.
CREATE FUNCTION public.work_compaction_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $body$
DECLARE previous public.task_context_compactions%ROWTYPE;
BEGIN
 IF NEW.sequence <> (SELECT count(*) FROM public.task_context_compactions c WHERE c.task_id=NEW.task_id AND c.cycle_id=NEW.cycle_id) THEN
  RAISE EXCEPTION 'compaction records are appended in sequence' USING ERRCODE='23514';
 END IF;
 IF NEW.sequence = 0 THEN
  IF NEW.first_ordinal <> 0 THEN
   RAISE EXCEPTION 'the first compaction record starts at the first step' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO previous FROM public.task_context_compactions c WHERE c.task_id=NEW.task_id AND c.cycle_id=NEW.cycle_id AND c.sequence=NEW.sequence-1;
  IF NOT FOUND OR NEW.first_ordinal <> previous.last_ordinal+1 THEN
   RAISE EXCEPTION 'compaction records cover contiguous ranges' USING ERRCODE='23514';
  END IF;
 END IF;
 IF (NEW.digest->>'task_id' IS DISTINCT FROM NEW.task_id OR NEW.digest->>'cycle_id' IS DISTINCT FROM NEW.cycle_id
   OR (NEW.digest->>'sequence')::bigint IS DISTINCT FROM NEW.sequence
   OR (NEW.digest->>'first_ordinal')::bigint IS DISTINCT FROM NEW.first_ordinal
   OR (NEW.digest->>'last_ordinal')::bigint IS DISTINCT FROM NEW.last_ordinal) THEN
  RAISE EXCEPTION 'the digest names its own record' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $body$;
CREATE TRIGGER work_compaction_guard BEFORE INSERT ON public.task_context_compactions
 FOR EACH ROW EXECUTE FUNCTION public.work_compaction_guard();
REVOKE ALL ON FUNCTION public.work_compaction_guard() FROM PUBLIC;
ALTER TABLE public.task_context_compactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_context_compactions FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.task_context_compactions FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_context_compactions.organisation_id,task_context_compactions.client_id,task_context_compactions.engagement_id)));
CREATE POLICY scoped_insert ON public.task_context_compactions FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_context_compactions.organisation_id,task_context_compactions.client_id,task_context_compactions.engagement_id)));
REVOKE ALL ON public.task_context_compactions FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=14) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=14;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
