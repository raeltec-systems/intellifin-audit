-- Story 22.2 durable work-cycle facts. Additive: published schemas 1-11 are unchanged.
-- Steps, guidance applications and routing questions are append-only facts. A
-- restarted worker rebuilds its position from these rows and the referenced
-- invocation, operation and receipt records, never from conversation text.
CREATE TABLE public.task_steps (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 4095),
 kind text NOT NULL CHECK(kind IN ('model_turn','tool_step')),
 intent_revision bigint NOT NULL CHECK(intent_revision > 0),
 execution_epoch bigint NOT NULL CHECK(execution_epoch > 0),
 invocation_id text CHECK(invocation_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 call_id text CHECK(call_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 operation_id text REFERENCES public.operations(id),
 attempt_id text CHECK(attempt_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 fact text CHECK(fact IN ('completed','authoritatively_absent')),
 status text NOT NULL CHECK(status IN ('proposed','responded','superseded','failed','completed','refused','reconciliation_required')),
 next_action text CHECK(char_length(next_action) BETWEEN 1 AND 200 AND next_action ~ '^(model_turn|await_guidance|reconcile|tool:[A-Za-z0-9_.:-]{1,128})$'),
 current_work text NOT NULL CHECK(char_length(current_work) BETWEEN 1 AND 200 AND current_work !~ '[[:cntrl:]]'),
 recorded_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 CHECK((kind='model_turn' AND call_id IS NULL AND operation_id IS NULL AND attempt_id IS NULL AND status IN ('proposed','responded','superseded','failed') AND (invocation_id IS NOT NULL OR status='failed'))
  OR (kind='tool_step' AND invocation_id IS NOT NULL AND call_id IS NOT NULL AND status IN ('completed','refused','superseded','reconciliation_required') AND (status NOT IN ('completed','reconciliation_required') OR (operation_id IS NOT NULL AND attempt_id IS NOT NULL)))),
 CHECK((status='completed') = (fact IS NOT NULL)),
 PRIMARY KEY(organisation_id,client_id,engagement_id,task_id,cycle_id,ordinal),
 UNIQUE(invocation_id,call_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX task_steps_task ON public.task_steps(task_id,cycle_id,ordinal);
-- The step boundary at which an accepted Create/Guide brief was applied. The
-- Received receipt remains the separate immutable admission fact.
CREATE TABLE public.task_guidance_applications (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 command_id text NOT NULL PRIMARY KEY, task_id text NOT NULL, cycle_id text NOT NULL,
 boundary_ordinal integer NOT NULL CHECK(boundary_ordinal BETWEEN 0 AND 4096),
 applied_cursor bigint NOT NULL CHECK(applied_cursor > 0),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id,command_id) REFERENCES public.task_commands(organisation_id,client_id,engagement_id,task_id,cycle_id,id)
);
CREATE INDEX task_guidance_applications_task ON public.task_guidance_applications(task_id,applied_cursor);
-- Untargeted direction that matched more than one Task. Candidates are the
-- server-computed non-stopped Tasks; nothing is applied until an answer.
CREATE TABLE public.task_routing_questions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text NOT NULL PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 author_id text NOT NULL REFERENCES public.identities(id),
 idempotency_key text NOT NULL CHECK(idempotency_key ~ '^[A-Za-z0-9_-]{1,128}$'),
 content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 4000 AND octet_length(content)<=4000),
 candidates jsonb NOT NULL CHECK(jsonb_typeof(candidates)='array' AND jsonb_array_length(candidates) BETWEEN 2 AND 32 AND octet_length(candidates::text)<=262144),
 asked_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 UNIQUE(organisation_id,client_id,engagement_id,author_id,idempotency_key),
 UNIQUE(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id)
);
CREATE TABLE public.task_routing_answers (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 question_id text NOT NULL PRIMARY KEY, author_id text NOT NULL REFERENCES public.identities(id),
 selected jsonb NOT NULL CHECK(jsonb_typeof(selected)='array' AND jsonb_array_length(selected) BETWEEN 1 AND 32 AND octet_length(selected::text)<=16384),
 FOREIGN KEY(organisation_id,client_id,engagement_id,question_id) REFERENCES public.task_routing_questions(organisation_id,client_id,engagement_id,id)
);
-- Marks a consumed Task claim whose work is the worker's own durable model
-- loop rather than an external child process. A replacement owner may take
-- such a claim over: its only effects are durable invocation and operation
-- facts, which recover without replay. Unmarked claims keep inert semantics.
CREATE TABLE public.task_work_claims (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 claim_id text NOT NULL PRIMARY KEY, process_instance text NOT NULL,
 FOREIGN KEY(organisation_id,client_id,engagement_id,claim_id,process_instance) REFERENCES public.task_claims(organisation_id,client_id,engagement_id,id,process_instance)
);
ALTER TABLE public.task_events DROP CONSTRAINT task_events_kind_check;
ALTER TABLE public.task_events ADD CONSTRAINT task_events_kind_check CHECK(kind IN ('received','applied','claimed','consumed','observed','waiting','step'));
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['task_steps','task_guidance_applications','task_routing_questions','task_routing_answers','task_work_claims'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY scoped_read ON public.%I FOR SELECT USING (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)))',relation,relation,relation,relation);
  EXECUTE format('CREATE POLICY scoped_insert ON public.%I FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting(''zobba.organisation_id'',true) AND client_id=pg_catalog.current_setting(''zobba.client_id'',true) AND engagement_id=pg_catalog.current_setting(''zobba.engagement_id'',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(%I.organisation_id,%I.client_id,%I.engagement_id)))',relation,relation,relation,relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $policies$;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=12) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=12;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
