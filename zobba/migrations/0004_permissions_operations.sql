-- Versioned standing authority and exact external operations. Historical records
-- are append-only for runtime roles; one-use claims and current heads are separate.
CREATE TABLE public.permission_versions (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 policy_key text NOT NULL CHECK(octet_length(policy_key) BETWEEN 1 AND 1024),
 client_id text, engagement_id text,
 kind text NOT NULL CHECK(kind IN ('organisation','engagement','member','account','task','delegation')),
 subject_id text NOT NULL CHECK(octet_length(subject_id) BETWEEN 1 AND 128),
 version bigint NOT NULL CHECK(version > 0),
 document text NOT NULL CHECK(octet_length(document) BETWEEN 1 AND 131072),
 accepted_snapshot text CHECK(octet_length(accepted_snapshot) BETWEEN 1 AND 1048576),
 actor_id text NOT NULL REFERENCES public.identities(id),
 command_key text CHECK(octet_length(command_key) BETWEEN 1 AND 128),
 UNIQUE(organisation_id,actor_id,command_key),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 PRIMARY KEY(organisation_id,policy_key,version),
 CHECK((kind IN ('organisation','member','account') AND client_id IS NULL AND engagement_id IS NULL) OR (kind IN ('engagement','task','delegation') AND client_id IS NOT NULL AND engagement_id IS NOT NULL)),
 CHECK(accepted_snapshot IS NULL OR kind='task'),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id)
);
CREATE TABLE public.permission_heads (
 organisation_id text NOT NULL, policy_key text NOT NULL,
 current_version bigint NOT NULL,
 client_id text, engagement_id text,
 PRIMARY KEY(organisation_id,policy_key),
 CHECK((client_id IS NULL)=(engagement_id IS NULL)),
 FOREIGN KEY(organisation_id,policy_key,current_version) REFERENCES public.permission_versions(organisation_id,policy_key,version),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id)
);
-- Trusted qualification registrations bind actual attachment bytes and
-- classification. Runtime may inspect current scoped metadata but cannot register
-- its own proposal as trusted material. Only the schema/fixture owner writes.
CREATE TABLE public.trusted_attachment_metadata (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 source_key text NOT NULL CHECK(octet_length(source_key) BETWEEN 1 AND 1024),
 attachment_id text NOT NULL CHECK(octet_length(attachment_id) BETWEEN 1 AND 128),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 classification text NOT NULL CHECK(octet_length(classification) BETWEEN 1 AND 128),
 PRIMARY KEY(organisation_id,client_id,engagement_id,source_key,attachment_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id) REFERENCES public.engagements(organisation_id,client_id,id)
);
CREATE TABLE public.operations (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text PRIMARY KEY CHECK(octet_length(id) BETWEEN 1 AND 128),
 task_id text NOT NULL, cycle_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(octet_length(key) BETWEEN 1 AND 128),
 request text NOT NULL CHECK(octet_length(request) BETWEEN 1 AND 32768),
 source_binding text NOT NULL CHECK(octet_length(source_binding) BETWEEN 1 AND 2048),
 request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 authority_snapshot text NOT NULL CHECK(octet_length(authority_snapshot) BETWEEN 1 AND 1048576),
 basis text NOT NULL CHECK(octet_length(basis) BETWEEN 1 AND 8192),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,actor_id,key),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id,cycle_id) REFERENCES public.task_cycles(organisation_id,client_id,engagement_id,task_id,id)
);
CREATE INDEX operations_task ON public.operations(organisation_id,client_id,engagement_id,task_id,id);
CREATE TABLE public.operation_decisions (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text PRIMARY KEY CHECK(octet_length(id) BETWEEN 1 AND 128),
 operation_id text NOT NULL,
 actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(octet_length(key) BETWEEN 1 AND 128),
 request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
 decision text NOT NULL CHECK(octet_length(decision) BETWEEN 1 AND 32768),
 expires_at bigint NOT NULL CHECK(expires_at > 0), allow boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(organisation_id,client_id,engagement_id,actor_id,key),
 FOREIGN KEY(organisation_id,client_id,engagement_id,operation_id) REFERENCES public.operations(organisation_id,client_id,engagement_id,id)
);
CREATE INDEX operation_decisions_operation ON public.operation_decisions(operation_id,created_at,id);
CREATE TABLE public.operation_attempts (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text PRIMARY KEY CHECK(octet_length(id) BETWEEN 1 AND 128),
 operation_id text NOT NULL,
 attempt_number bigint NOT NULL CHECK(attempt_number BETWEEN 1 AND 64),
 source_binding text NOT NULL CHECK(octet_length(source_binding) BETWEEN 1 AND 2048),
 basis text NOT NULL CHECK(octet_length(basis) BETWEEN 1 AND 8192),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(operation_id,attempt_number),
 UNIQUE(organisation_id,client_id,engagement_id,id),
 UNIQUE(organisation_id,client_id,engagement_id,operation_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,operation_id) REFERENCES public.operations(organisation_id,client_id,engagement_id,id)
);
CREATE TABLE public.operation_claims (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text PRIMARY KEY CHECK(octet_length(id) BETWEEN 1 AND 128),
 operation_id text NOT NULL, attempt_id text NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN ('admitted','consumed','abandoned')),
 consumed_at timestamptz,
 CHECK((state='consumed')=(consumed_at IS NOT NULL)),
 FOREIGN KEY(organisation_id,client_id,engagement_id,operation_id,attempt_id) REFERENCES public.operation_attempts(organisation_id,client_id,engagement_id,operation_id,id)
);
CREATE INDEX operation_claims_operation ON public.operation_claims(operation_id,state);
CREATE UNIQUE INDEX operation_claims_admitted ON public.operation_claims(operation_id) WHERE state='admitted';
-- A digest grants access only to this exact attempt's factual receipts. It never
-- authorises reading a request, acquiring another claim or restarting a Task.
-- Content-free producer identities permit bounded recovery mint counts without
-- revealing another producer's capability digest to an ordinary scoped reader.
CREATE TABLE public.operation_receipt_producers (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 attempt_id text NOT NULL,
 producer_id text NOT NULL CHECK(octet_length(producer_id) BETWEEN 1 AND 128),
 PRIMARY KEY(attempt_id,producer_id),
 UNIQUE(organisation_id,client_id,engagement_id,attempt_id,producer_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,attempt_id) REFERENCES public.operation_attempts(organisation_id,client_id,engagement_id,id)
);
CREATE TABLE public.operation_receipt_slots (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 attempt_id text NOT NULL,
 producer_id text NOT NULL CHECK(octet_length(producer_id) BETWEEN 1 AND 128),
 PRIMARY KEY(attempt_id,producer_id),
 capability_hash text NOT NULL CHECK(capability_hash ~ '^[0-9a-f]{64}$'),
 custody text NOT NULL DEFAULT 'dispatch' CHECK(custody IN ('dispatch','reconciliation')),
 UNIQUE(organisation_id,client_id,engagement_id,attempt_id,producer_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,attempt_id) REFERENCES public.operation_attempts(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,attempt_id,producer_id) REFERENCES public.operation_receipt_producers(organisation_id,client_id,engagement_id,attempt_id,producer_id)
);
CREATE TABLE public.operation_receipts (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text PRIMARY KEY CHECK(octet_length(id) BETWEEN 1 AND 128),
 attempt_id text NOT NULL, producer_id text NOT NULL,
 key text NOT NULL CHECK(octet_length(key) BETWEEN 1 AND 128),
 outcome text NOT NULL CHECK(outcome IN ('unknown','pending','completed','absent')),
 source text NOT NULL CHECK(source IN ('dispatch','reconciliation')),
 CHECK(outcome <> 'absent' OR source='reconciliation'),
 created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
 UNIQUE(attempt_id,key),
 FOREIGN KEY(organisation_id,client_id,engagement_id,attempt_id,producer_id) REFERENCES public.operation_receipt_slots(organisation_id,client_id,engagement_id,attempt_id,producer_id)
);
CREATE INDEX operation_receipts_attempt ON public.operation_receipts(attempt_id,created_at,id);
ALTER TABLE public.permission_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.permission_versions FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=permission_versions.organisation_id AND m.actor_id=pg_catalog.current_setting('zobba.actor_id',true)) AND (client_id IS NULL OR (client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(permission_versions.organisation_id,permission_versions.client_id,permission_versions.engagement_id)))));
CREATE POLICY scoped_insert ON public.permission_versions FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=permission_versions.organisation_id AND m.actor_id=pg_catalog.current_setting('zobba.actor_id',true)) AND (client_id IS NULL OR (client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(permission_versions.organisation_id,permission_versions.client_id,permission_versions.engagement_id)))));
ALTER TABLE public.permission_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.permission_heads FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=permission_heads.organisation_id AND m.actor_id=pg_catalog.current_setting('zobba.actor_id',true)) AND (client_id IS NULL OR (client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(permission_heads.organisation_id,permission_heads.client_id,permission_heads.engagement_id)))));
CREATE POLICY scoped_insert ON public.permission_heads FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=permission_heads.organisation_id AND m.actor_id=pg_catalog.current_setting('zobba.actor_id',true)) AND (client_id IS NULL OR (client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(permission_heads.organisation_id,permission_heads.client_id,permission_heads.engagement_id)))) AND EXISTS(SELECT 1 FROM public.permission_versions v WHERE (v.organisation_id,v.policy_key,v.version)=(permission_heads.organisation_id,permission_heads.policy_key,permission_heads.current_version) AND v.client_id IS NOT DISTINCT FROM permission_heads.client_id AND v.engagement_id IS NOT DISTINCT FROM permission_heads.engagement_id));
CREATE POLICY scoped_update ON public.permission_heads FOR UPDATE USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=permission_heads.organisation_id AND m.actor_id=pg_catalog.current_setting('zobba.actor_id',true)) AND (client_id IS NULL OR (client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(permission_heads.organisation_id,permission_heads.client_id,permission_heads.engagement_id))))) WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=permission_heads.organisation_id AND m.actor_id=pg_catalog.current_setting('zobba.actor_id',true)) AND (client_id IS NULL OR (client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(permission_heads.organisation_id,permission_heads.client_id,permission_heads.engagement_id)))) AND EXISTS(SELECT 1 FROM public.permission_versions v WHERE (v.organisation_id,v.policy_key,v.version)=(permission_heads.organisation_id,permission_heads.policy_key,permission_heads.current_version) AND v.client_id IS NOT DISTINCT FROM permission_heads.client_id AND v.engagement_id IS NOT DISTINCT FROM permission_heads.engagement_id));
ALTER TABLE public.trusted_attachment_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trusted_attachment_metadata FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.trusted_attachment_metadata FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(trusted_attachment_metadata.organisation_id,trusted_attachment_metadata.client_id,trusted_attachment_metadata.engagement_id)));
CREATE POLICY owner_registration ON public.trusted_attachment_metadata FOR INSERT WITH CHECK (
 EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='trusted_attachment_metadata' AND pg_catalog.pg_get_userbyid(c.relowner)=current_user)
);
ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operations FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.operations FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operations.organisation_id,operations.client_id,operations.engagement_id)));
CREATE POLICY scoped_insert ON public.operations FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operations.organisation_id,operations.client_id,operations.engagement_id)));
ALTER TABLE public.operation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.operation_decisions FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_decisions.organisation_id,operation_decisions.client_id,operation_decisions.engagement_id)));
CREATE POLICY scoped_insert ON public.operation_decisions FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_decisions.organisation_id,operation_decisions.client_id,operation_decisions.engagement_id)));
ALTER TABLE public.operation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.operation_attempts FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_attempts.organisation_id,operation_attempts.client_id,operation_attempts.engagement_id)));
CREATE POLICY scoped_insert ON public.operation_attempts FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_attempts.organisation_id,operation_attempts.client_id,operation_attempts.engagement_id)));
ALTER TABLE public.operation_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.operation_claims FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_claims.organisation_id,operation_claims.client_id,operation_claims.engagement_id)));
CREATE POLICY scoped_insert ON public.operation_claims FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_claims.organisation_id,operation_claims.client_id,operation_claims.engagement_id)) AND state='admitted');
CREATE POLICY scoped_consume ON public.operation_claims FOR UPDATE USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_claims.organisation_id,operation_claims.client_id,operation_claims.engagement_id)) AND state='admitted') WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_claims.organisation_id,operation_claims.client_id,operation_claims.engagement_id)) AND state IN ('consumed','abandoned'));
ALTER TABLE public.operation_receipt_producers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_receipt_producers FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.operation_receipt_producers FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_receipt_producers.organisation_id,operation_receipt_producers.client_id,operation_receipt_producers.engagement_id)));
CREATE POLICY scoped_insert ON public.operation_receipt_producers FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_receipt_producers.organisation_id,operation_receipt_producers.client_id,operation_receipt_producers.engagement_id)));
ALTER TABLE public.operation_receipt_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_receipt_slots FORCE ROW LEVEL SECURITY;

CREATE POLICY scoped_insert ON public.operation_receipt_slots FOR INSERT WITH CHECK (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_receipt_slots.organisation_id,operation_receipt_slots.client_id,operation_receipt_slots.engagement_id)));
ALTER TABLE public.operation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_read ON public.operation_receipts FOR SELECT USING (organisation_id=pg_catalog.current_setting('zobba.organisation_id',true) AND client_id=pg_catalog.current_setting('zobba.client_id',true) AND engagement_id=pg_catalog.current_setting('zobba.engagement_id',true) AND EXISTS(SELECT 1 FROM public.engagements e WHERE (e.organisation_id,e.client_id,e.id)=(operation_receipts.organisation_id,operation_receipts.client_id,operation_receipts.engagement_id)));
CREATE POLICY exact_receipt ON public.operation_receipt_slots FOR SELECT USING (
 attempt_id=pg_catalog.current_setting('zobba.receipt_claim',true)
 AND capability_hash=pg_catalog.current_setting('zobba.receipt_hash',true)
 AND organisation_id=pg_catalog.current_setting('zobba.receipt_org',true)
 AND client_id=pg_catalog.current_setting('zobba.receipt_client',true)
 AND engagement_id=pg_catalog.current_setting('zobba.receipt_engagement',true)
);
-- A capability can inspect all facts for its one attempt, so a late/recovering
-- producer must detect contradictory terminal facts recorded by another producer.
-- Appending a fact additionally requires that capability's exact producer binding.
CREATE POLICY receipt_read ON public.operation_receipts FOR SELECT USING (
 EXISTS(SELECT 1 FROM public.operation_receipt_slots s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.attempt_id)=(operation_receipts.organisation_id,operation_receipts.client_id,operation_receipts.engagement_id,operation_receipts.attempt_id) AND s.attempt_id=pg_catalog.current_setting('zobba.receipt_claim',true) AND s.capability_hash=pg_catalog.current_setting('zobba.receipt_hash',true) AND s.organisation_id=pg_catalog.current_setting('zobba.receipt_org',true) AND s.client_id=pg_catalog.current_setting('zobba.receipt_client',true) AND s.engagement_id=pg_catalog.current_setting('zobba.receipt_engagement',true))
);
CREATE POLICY receipt_insert ON public.operation_receipts FOR INSERT WITH CHECK (
 EXISTS(SELECT 1 FROM public.operation_receipt_slots s WHERE (s.organisation_id,s.client_id,s.engagement_id,s.attempt_id,s.producer_id)=(operation_receipts.organisation_id,operation_receipts.client_id,operation_receipts.engagement_id,operation_receipts.attempt_id,operation_receipts.producer_id) AND s.attempt_id=pg_catalog.current_setting('zobba.receipt_claim',true) AND s.capability_hash=pg_catalog.current_setting('zobba.receipt_hash',true) AND s.organisation_id=pg_catalog.current_setting('zobba.receipt_org',true) AND s.client_id=pg_catalog.current_setting('zobba.receipt_client',true) AND s.engagement_id=pg_catalog.current_setting('zobba.receipt_engagement',true) AND s.custody=operation_receipts.source)
);
REVOKE ALL ON public.trusted_attachment_metadata,public.operation_receipt_producers,public.permission_versions,public.permission_heads,public.operations,public.operation_decisions,public.operation_attempts,public.operation_claims,public.operation_receipt_slots,public.operation_receipts FROM PUBLIC;
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=4) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=4;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
