-- Narrow configuration authority includes current Admin-only identities, whose
-- ordinary audit membership rows are intentionally invisible to the runtime.
CREATE FUNCTION public.model_configuration_admin(actor text,org text,session_hash text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF actor IS DISTINCT FROM current_setting('zobba.actor_id',true)
 OR org IS DISTINCT FROM current_setting('zobba.organisation_id',true) THEN RETURN false; END IF;
 RETURN public.evidence_session_locked(actor,session_hash) AND public.membership_admin(actor,org);
END $$;
REVOKE ALL ON FUNCTION public.model_configuration_admin(text,text,text) FROM PUBLIC;
-- Native model configuration is immutable Admin history, never a credential store.
-- Qualification is checked against trusted adapter registration in Rust.
CREATE TABLE public.model_profiles (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 revision bigint NOT NULL CHECK(revision>0),
 actor_id text NOT NULL REFERENCES public.identities(id),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=65536),
 recorded_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 PRIMARY KEY(organisation_id,id,revision)
);
CREATE TABLE public.model_catalogues (
 organisation_id text NOT NULL REFERENCES public.organisations(id),
 id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 revision bigint NOT NULL CHECK(revision>0),
 actor_id text NOT NULL REFERENCES public.identities(id),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=524288),
 recorded_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 PRIMARY KEY(organisation_id,id,revision)
);
CREATE TABLE public.model_invocations (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,128}$'),
 task_id text NOT NULL, cycle_id text NOT NULL, actor_id text NOT NULL REFERENCES public.identities(id),
 key text NOT NULL CHECK(key ~ '^[A-Za-z0-9_-]{1,128}$'),
 profile_id text NOT NULL, profile_revision bigint NOT NULL,
 catalogue_id text NOT NULL, catalogue_revision bigint NOT NULL,
 request jsonb NOT NULL CHECK(jsonb_typeof(request)='object' AND octet_length(request::text)<=1048576),
 receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),
 dispatched_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 UNIQUE(organisation_id,actor_id,key), UNIQUE(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,task_id) REFERENCES public.tasks(organisation_id,client_id,engagement_id,id),
 FOREIGN KEY(organisation_id,profile_id,profile_revision) REFERENCES public.model_profiles(organisation_id,id,revision),
 FOREIGN KEY(organisation_id,catalogue_id,catalogue_revision) REFERENCES public.model_catalogues(organisation_id,id,revision)
);
CREATE INDEX model_invocations_task ON public.model_invocations(organisation_id,client_id,engagement_id,task_id,id COLLATE "C");
CREATE TABLE public.model_results (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 invocation_id text PRIMARY KEY,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=2097152),
 recorded_at bigint NOT NULL DEFAULT floor(extract(epoch FROM clock_timestamp()))::bigint,
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
CREATE TABLE public.model_tool_bindings (
 organisation_id text NOT NULL, client_id text NOT NULL, engagement_id text NOT NULL,
 operation_id text PRIMARY KEY REFERENCES public.operations(id), invocation_id text NOT NULL,
 call_id text NOT NULL CHECK(call_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 UNIQUE(invocation_id,call_id),
 FOREIGN KEY(organisation_id,client_id,engagement_id,invocation_id) REFERENCES public.model_invocations(organisation_id,client_id,engagement_id,id)
);
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['model_profiles','model_catalogues'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY model_configuration_read ON public.%I FOR SELECT USING (organisation_id=current_setting(''zobba.organisation_id'',true) AND EXISTS(SELECT 1 FROM public.organisation_memberships m WHERE m.organisation_id=%I.organisation_id AND m.actor_id=current_setting(''zobba.actor_id'',true) AND m.active AND (m.expires_at IS NULL OR m.expires_at>floor(extract(epoch FROM clock_timestamp()))::bigint)) OR (organisation_id=current_setting(''zobba.organisation_id'',true) AND public.model_configuration_admin(current_setting(''zobba.actor_id'',true),organisation_id,current_setting(''zobba.model_session_hash'',true))))',relation,relation);
  EXECUTE format('CREATE POLICY model_configuration_insert ON public.%I FOR INSERT WITH CHECK (organisation_id=current_setting(''zobba.organisation_id'',true) AND actor_id=current_setting(''zobba.actor_id'',true) AND public.model_configuration_admin(actor_id,organisation_id,current_setting(''zobba.model_session_hash'',true)))',relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['model_invocations','model_results','model_tool_bindings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY model_audit_read ON public.%I FOR SELECT USING (organisation_id=current_setting(''zobba.organisation_id'',true) AND client_id=current_setting(''zobba.client_id'',true) AND engagement_id=current_setting(''zobba.engagement_id'',true) AND public.knowledge_audit(current_setting(''zobba.actor_id'',true),organisation_id,client_id,engagement_id))',relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation);
 END LOOP;
END $policies$;
CREATE POLICY model_invocation_insert ON public.model_invocations FOR INSERT WITH CHECK (
 actor_id=current_setting('zobba.actor_id',true) AND organisation_id=current_setting('zobba.organisation_id',true)
 AND client_id=current_setting('zobba.client_id',true) AND engagement_id=current_setting('zobba.engagement_id',true)
 AND public.knowledge_audit(actor_id,organisation_id,client_id,engagement_id));
-- An exact opaque receipt can record late facts without granting a new audience.
CREATE POLICY model_receipt_read ON public.model_invocations FOR SELECT USING (
 id=current_setting('zobba.model_invocation',true) AND receipt_hash=current_setting('zobba.model_receipt_hash',true));
CREATE POLICY model_result_receipt_read ON public.model_results FOR SELECT USING (
 EXISTS(SELECT 1 FROM public.model_invocations i WHERE i.id=invocation_id AND i.id=current_setting('zobba.model_invocation',true) AND i.receipt_hash=current_setting('zobba.model_receipt_hash',true)));
CREATE POLICY model_result_insert ON public.model_results FOR INSERT WITH CHECK (
 EXISTS(SELECT 1 FROM public.model_invocations i WHERE i.id=invocation_id AND (i.organisation_id,i.client_id,i.engagement_id)=(model_results.organisation_id,model_results.client_id,model_results.engagement_id)
 AND i.id=current_setting('zobba.model_invocation',true) AND i.receipt_hash=current_setting('zobba.model_receipt_hash',true)));
CREATE POLICY model_tool_insert ON public.model_tool_bindings FOR INSERT WITH CHECK (
 organisation_id=current_setting('zobba.organisation_id',true) AND client_id=current_setting('zobba.client_id',true) AND engagement_id=current_setting('zobba.engagement_id',true)
 AND public.knowledge_audit(current_setting('zobba.actor_id',true),organisation_id,client_id,engagement_id)
 AND EXISTS(SELECT 1 FROM public.operations o WHERE o.id=operation_id AND (o.organisation_id,o.client_id,o.engagement_id)=(model_tool_bindings.organisation_id,model_tool_bindings.client_id,model_tool_bindings.engagement_id)));
ALTER TABLE public.zobba_bootstrap DROP CONSTRAINT zobba_bootstrap_schema_version_check;
ALTER TABLE public.zobba_bootstrap ADD CHECK(schema_version=11) NOT VALID;
UPDATE public.zobba_bootstrap SET schema_version=11;
ALTER TABLE public.zobba_bootstrap VALIDATE CONSTRAINT zobba_bootstrap_schema_version_check;
