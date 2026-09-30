-- Task commands and inert attempt facts. No external dispatch is implemented.
CREATE TABLE public.task_counters (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 cursor bigint NOT NULL DEFAULT 0 CHECK(cursor >= 0),
 PRIMARY KEY(organisation_id,client_id,engagement_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id)
);
CREATE TABLE public.tasks (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text NOT NULL, cycle_id text NOT NULL, accountable_actor text NOT NULL REFERENCES public.identities(id),
 objective text NOT NULL CHECK(char_length(objective) BETWEEN 1 AND 4000 AND octet_length(objective)<=4000),
 working_brief text NOT NULL CHECK(char_length(working_brief) BETWEEN 1 AND 4000 AND octet_length(working_brief)<=4000),
 state text NOT NULL CHECK(state IN ('ready','running','paused','stopped','waiting')),
 cessation text NOT NULL CHECK(cessation IN ('none','pending','confirmed','reconciliation_required')),
 intent_revision bigint NOT NULL DEFAULT 1 CHECK(intent_revision > 0),
 applied_intent bigint NOT NULL DEFAULT 0 CHECK(applied_intent >= 0),
 applied_command_cursor bigint NOT NULL DEFAULT 0 CHECK(applied_command_cursor >= 0),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
 execution_epoch bigint NOT NULL DEFAULT 1 CHECK(execution_epoch > 0),
 owner_id text, owner_until timestamptz, owner_epoch bigint NOT NULL DEFAULT 0 CHECK(owner_epoch >= 0),
 PRIMARY KEY(organisation_id,client_id,engagement_id,id), UNIQUE(id),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id)
);
CREATE INDEX tasks_open_scope ON public.tasks(organisation_id,client_id,engagement_id,id) WHERE state <> 'stopped';
CREATE TABLE public.task_cycles (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, id text NOT NULL,
 status text NOT NULL CHECK(status IN ('active','stopped')),
 PRIMARY KEY(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id)
);
ALTER TABLE public.tasks ADD CONSTRAINT tasks_current_cycle FOREIGN KEY(organisation_id,client_id,engagement_id,id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.task_commands (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text NOT NULL PRIMARY KEY, author_id text NOT NULL REFERENCES public.identities(id),
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 1 AND 128),
 kind text NOT NULL CHECK(kind IN ('create','guide','pause','resume','stop','continue')),
 target_task_id text, target_cycle_id text, content text CHECK(char_length(content) BETWEEN 1 AND 4000 AND octet_length(content)<=4000),
 task_id text NOT NULL, cycle_id text NOT NULL, received_cursor bigint NOT NULL CHECK(received_cursor > 0),
 intent_revision bigint NOT NULL CHECK(intent_revision > 0),
 CHECK((kind='create' AND target_task_id IS NULL AND target_cycle_id IS NULL AND content IS NOT NULL) OR (kind<>'create' AND target_task_id IS NOT NULL AND target_cycle_id IS NOT NULL AND ((kind='guide' AND content IS NOT NULL) OR (kind<>'guide' AND content IS NULL)))),
 UNIQUE(organisation_id,client_id,engagement_id,author_id,idempotency_key),
 UNIQUE(organisation_id,client_id,engagement_id,task_id,cycle_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,target_task_id,target_cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id)
);
CREATE INDEX task_commands_pending ON public.task_commands(task_id,received_cursor);
CREATE TABLE public.task_events (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 cursor bigint NOT NULL CHECK(cursor > 0), task_id text NOT NULL, cycle_id text NOT NULL,
 command_id text,
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id,command_id) REFERENCES public.task_commands(organisation_id,client_id,engagement_id,task_id,cycle_id,id),
 kind text NOT NULL CHECK(kind IN ('received','applied','claimed','consumed','observed','waiting')),
 PRIMARY KEY(organisation_id,client_id,engagement_id,cursor),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id)
);
CREATE UNIQUE INDEX task_events_command ON public.task_events(command_id,kind) WHERE command_id IS NOT NULL;
CREATE TABLE public.task_wakeups (
 id text PRIMARY KEY, actor_id text NOT NULL REFERENCES public.identities(id),
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL UNIQUE, pending boolean NOT NULL DEFAULT true,
 available_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX task_wakeups_due ON public.task_wakeups(available_at,id) WHERE pending;
-- Delivery can mutate only this content-free lease, never scoped scheduling.
CREATE TABLE public.task_deliveries (
 wakeup_id text PRIMARY KEY REFERENCES public.task_wakeups(id),
 delivery_owner text, delivery_until timestamptz
);
CREATE INDEX task_deliveries_due ON public.task_deliveries(delivery_until NULLS FIRST,wakeup_id);
CREATE TABLE public.task_claims (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 task_id text NOT NULL, cycle_id text NOT NULL, id text NOT NULL PRIMARY KEY,
 actor_id text NOT NULL REFERENCES public.identities(id), worker_id text NOT NULL,
 process_instance text NOT NULL UNIQUE,
 owner_epoch bigint NOT NULL, execution_epoch bigint NOT NULL, intent_revision bigint NOT NULL,
 state text NOT NULL CHECK(state IN ('admitted','consumed','abandoned','observed')),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,id,process_instance)
);
CREATE INDEX task_claims_task ON public.task_claims(task_id,state);
CREATE UNIQUE INDEX task_claims_active ON public.task_claims(task_id) WHERE state IN ('admitted','consumed');
-- Only a digest of the random receipt capability is persisted. No updates/deletes.
CREATE TABLE public.task_receipt_slots (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 claim_id text NOT NULL PRIMARY KEY, process_instance text NOT NULL,
 capability_hash text NOT NULL CHECK(char_length(capability_hash)=64),
 FOREIGN KEY(organisation_id,client_id,engagement_id,claim_id,process_instance) REFERENCES public.task_claims(organisation_id,client_id,engagement_id,id,process_instance),
 UNIQUE(organisation_id,client_id,engagement_id,claim_id,process_instance)
);
CREATE TABLE public.task_observations (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 claim_id text NOT NULL PRIMARY KEY, process_instance text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('completed','cancelled','exited','not_started')),
 FOREIGN KEY(organisation_id,client_id,engagement_id,claim_id,process_instance) REFERENCES public.task_receipt_slots(organisation_id,client_id,engagement_id,claim_id,process_instance)
);
ALTER TABLE public.task_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_access ON public.task_counters USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_counters.organisation_id,task_counters.client_id,task_counters.engagement_id))) WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_counters.organisation_id,task_counters.client_id,task_counters.engagement_id)));
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_access ON public.tasks USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(tasks.organisation_id,tasks.client_id,tasks.engagement_id))) WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(tasks.organisation_id,tasks.client_id,tasks.engagement_id)));
ALTER TABLE public.task_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_cycles FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_access ON public.task_cycles USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_cycles.organisation_id,task_cycles.client_id,task_cycles.engagement_id))) WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_cycles.organisation_id,task_cycles.client_id,task_cycles.engagement_id)));
ALTER TABLE public.task_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.task_commands FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_commands.organisation_id,task_commands.client_id,task_commands.engagement_id)));
CREATE POLICY scoped_insert ON public.task_commands FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_commands.organisation_id,task_commands.client_id,task_commands.engagement_id)));
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.task_events FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_events.organisation_id,task_events.client_id,task_events.engagement_id)));
CREATE POLICY scoped_insert ON public.task_events FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_events.organisation_id,task_events.client_id,task_events.engagement_id)));
ALTER TABLE public.task_wakeups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_wakeups FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_access ON public.task_wakeups USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_wakeups.organisation_id,task_wakeups.client_id,task_wakeups.engagement_id))) WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_wakeups.organisation_id,task_wakeups.client_id,task_wakeups.engagement_id)));
ALTER TABLE public.task_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_access ON public.task_claims USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_claims.organisation_id,task_claims.client_id,task_claims.engagement_id))) WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_claims.organisation_id,task_claims.client_id,task_claims.engagement_id)));
ALTER TABLE public.task_receipt_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_receipt_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_insert ON public.task_receipt_slots FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_receipt_slots.organisation_id,task_receipt_slots.client_id,task_receipt_slots.engagement_id)));
ALTER TABLE public.task_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.task_observations FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(task_observations.organisation_id,task_observations.client_id,task_observations.engagement_id)));
-- The routing table carries no objective, command content, receipt or result.
CREATE POLICY dispatcher_read ON public.task_wakeups FOR SELECT USING (pg_catalog.current_setting('zobba.dispatcher',true)='on');
ALTER TABLE public.task_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY dispatcher_read ON public.task_deliveries FOR SELECT USING (pg_catalog.current_setting('zobba.dispatcher',true)='on');
CREATE POLICY dispatcher_lease ON public.task_deliveries FOR UPDATE USING (pg_catalog.current_setting('zobba.dispatcher',true)='on') WITH CHECK (pg_catalog.current_setting('zobba.dispatcher',true)='on');
CREATE POLICY scoped_delivery_read ON public.task_deliveries FOR SELECT USING (
 COALESCE(pg_catalog.current_setting('zobba.dispatcher',true),'') <> 'on'
 AND EXISTS (SELECT 1 FROM public.task_wakeups w WHERE w.id=task_deliveries.wakeup_id)
);
CREATE POLICY scoped_delivery_insert ON public.task_deliveries FOR INSERT WITH CHECK (
 COALESCE(pg_catalog.current_setting('zobba.dispatcher',true),'') <> 'on'
 AND EXISTS (SELECT 1 FROM public.task_wakeups w WHERE w.id=task_deliveries.wakeup_id)
);
CREATE POLICY exact_receipt ON public.task_receipt_slots FOR SELECT USING (
 claim_id=pg_catalog.current_setting('zobba.receipt_claim',true)
 AND capability_hash=pg_catalog.current_setting('zobba.receipt_hash',true)
 AND organisation_id=pg_catalog.current_setting('zobba.receipt_org',true)
 AND client_id=pg_catalog.current_setting('zobba.receipt_client',true)
 AND engagement_id=pg_catalog.current_setting('zobba.receipt_engagement',true)
);
CREATE POLICY receipt_read ON public.task_observations FOR SELECT USING (
 EXISTS(SELECT 1 FROM public.task_receipt_slots s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.claim_id,s.process_instance)=(task_observations.organisation_id,task_observations.client_id,task_observations.engagement_id,task_observations.claim_id,task_observations.process_instance))
);
CREATE POLICY receipt_insert ON public.task_observations FOR INSERT WITH CHECK (
 EXISTS(SELECT 1 FROM public.task_receipt_slots s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.claim_id,s.process_instance)=(task_observations.organisation_id,task_observations.client_id,task_observations.engagement_id,task_observations.claim_id,task_observations.process_instance))
);
REVOKE ALL ON public.task_counters,public.tasks,public.task_cycles,public.task_commands,public.task_events,public.task_wakeups,public.task_claims,public.task_receipt_slots,public.task_observations,public.task_deliveries FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=3) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=3;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
