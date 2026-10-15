-- Only bootstrap metadata. Explicit CLI migrations own this schema.
CREATE TABLE public.zobba_bootstrap (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    product text NOT NULL CHECK (product = 'zobba'),
    schema_version bigint NOT NULL CHECK (schema_version = 1)
);
INSERT INTO public.zobba_bootstrap (product, schema_version) VALUES ('zobba', 1);
REVOKE ALL ON public.zobba_bootstrap FROM PUBLIC;
