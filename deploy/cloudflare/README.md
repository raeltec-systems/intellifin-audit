# Parallel Cloudflare deployment

The first deployable slice is a Cloudflare Worker that provides Cloudflare ingress,
TLS, logs and traces while the existing Railway web, worker and PostgreSQL services
remain authoritative. It is deliberately a fixed-origin bridge; callers cannot choose
an upstream.

Deploy from the repository root:

```sh
pnpm --allow-build=esbuild --allow-build=workerd dlx wrangler@4.135.0 \
  deploy --config deploy/cloudflare/edge/wrangler.jsonc
```

This bridge is the reversible first stage. Moving the existing Node and Playwright
images onto Cloudflare Containers requires the Workers Paid plan. Cloudflare returned
an explicit account refusal for Containers on 2026-09-21, so container configuration
is not retained in the repository until that capability is enabled.
