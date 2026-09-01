---
title: "Architecture Reviewer Gate — Technology Reality"
artifact: "../ARCHITECTURE-SPINE.md"
reviewed: 2026-09-01
review_type: configured-technology-reality
verdict: conditional-pass
counts:
  critical: 0
  high: 2
  medium: 3
  low: 1
---

# Technology Reality Review

## Verdict

**Conditional pass.** Every exact version in the stack table existed and was the current stable/latest registry release on 2026-09-01, and the selected Node.js 24 runtime satisfies the declared engine ranges. The modular-monolith, PostgreSQL, Drizzle/postgres.js, pg-boss, Better Auth, AI SDK, Pino, Sentry, Vitest, and Playwright combination is technically coherent.

The gate remains conditional because the configured Railway evidence-storage and observability story does not yet fulfill the spine's own recovery and no-sensitive-telemetry claims. These are deployment/configuration gaps, not reasons to replace the overall stack.

## Findings

### TR-01 — High — PostgreSQL backup does not recover the EvidenceStore

AD-11 enables daily PostgreSQL backup, but binary Evidence remains in a Railway Bucket. Railway Buckets do not support object versioning, object lock, lifecycle rules, or S3-style server-side-encryption controls; a deleted bucket is recoverable for only two days. Railway's published bucket material does not provide a bucket snapshot/backup facility. A database restore can therefore recover Evidence metadata and digests while the referenced Evidence objects remain lost.

This breaks the claimed whole-product 24-hour RPO/eight-hour RTO and PoC-lifetime retention for Run/Evidence/Result/Audit data. Hashes and signed manifests detect loss or substitution but cannot restore the object.

**Required disposition:** add a backup/restore path for sealed Evidence Packages and signed manifests, separate from PostgreSQL backup. For example, replicate immutable objects to an independent versioned store or create periodic portable Workpaper/Evidence archives in a separately protected location. The restore drill must restore both PostgreSQL and object evidence and verify every digest/manifest. Label the Railway Bucket as **credential-private over a public endpoint**: Railway states that buckets live on the public network, so worker-to-bucket traffic is not Railway private networking.

Sources: [Railway Storage Buckets](https://docs.railway.com/storage-buckets), [Railway bucket billing/network behavior](https://docs.railway.com/storage-buckets/billing), [Railway PostgreSQL backup and restore](https://docs.railway.com/guides/postgres-backups-restores), [Railway DPA encryption controls](https://railway.com/legal/dpa).

### TR-02 — High — Pino and Sentry do not enforce the spine's no-evidence telemetry rule by themselves

Pino supports configured-path redaction, but its security guidance says applications must not pass externally supplied objects directly and must apply serialization/redaction under application-controlled keys. Sentry can automatically collect breadcrumbs for UI interaction, console, XHR/fetch, and navigation. Its Vercel AI integration can record AI inputs and outputs when AI telemetry or default PII collection is enabled. AD-10's statement that secrets, session URLs, credentials, and Evidence “must not enter logs or Sentry” is therefore a policy, not a capability supplied by choosing Pino and Sentry.

**Required disposition:** name the concrete packages (`@sentry/nextjs` for `apps/web`, `@sentry/node` for `apps/worker`) and bind a shared telemetry sanitizer. Set `sendDefaultPii: false`; disable AI input/output recording; scrub `beforeSend`, spans, and breadcrumbs; prohibit raw Evidence/tool payloads in logger or Sentry context; and add negative tests with seeded credentials, signed URLs, malicious source content, and Evidence fields. Pino redaction paths must be static application configuration, never derived from user/source input.

Sources: [Pino redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md), [Pino security assumptions](https://github.com/pinojs/pino/security), [Sentry JavaScript SDK 10.73.0 registry metadata](https://registry.npmjs.org/%40sentry%2Fnextjs/latest), [Sentry Vercel AI integration data controls](https://docs.sentry.io/platforms/javascript/guides/koa/configuration/integrations/vercelai/), [Sentry breadcrumb capture](https://docs.sentry.io/platforms/javascript/guides/svelte/enriching-events/breadcrumbs/).

### TR-03 — Medium — “Railway PostgreSQL 18” needs an explicit image and operations contract

PostgreSQL 18.6 is the current supported 18.x release, and pg-boss 12.29.0 supports PostgreSQL 13 or later. Railway's official SSL image repository provides a major `:18` tag, but its `:latest` tag still points to PostgreSQL 16. Railway also describes its database templates as **unmanaged**: the project owns backups, security, tuning, monitoring, and maintenance. Railway PITR documentation further says minor-version pinning is not supported when PITR is enabled.

AD-11 correctly binds only the PostgreSQL 18 major, but the deployment diagram and “managed PoC platform” label can be read as if Railway automatically provisions and operates exact PostgreSQL 18.6.

**Required disposition:** declare `ghcr.io/railwayapp-templates/postgres-ssl:18` (or an equivalently verified Railway 18 template), verify `server_version` at bootstrap, treat 18.6 as the reviewed seed rather than a guaranteed hosted minor, and document Railway database ownership plus the backup/restore operator. If PITR is enabled, follow Railway's major-tag rule instead of pinning `:18.6`.

Sources: [PostgreSQL 18.6 release](https://www.postgresql.org/docs/current/release-18-6.html), [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/), [Railway PostgreSQL](https://docs.railway.com/databases/postgresql), [Railway database responsibility model](https://docs.railway.com/databases), [Railway SSL Postgres image](https://github.com/railwayapp-templates/postgres-ssl), [Railway PITR limitations](https://docs.railway.com/volumes/point-in-time-recovery), [pg-boss requirements](https://pgboss.io/).

### TR-04 — Medium — AI SDK provider transport is unresolved

`ai@7.0.87` is current and supports Node.js 22+, Zod 3/4, tool calling, provider registries, and provider-neutral application types. However, the `ai` package's string model form uses Vercel AI Gateway by default. Direct OpenAI and Anthropic use require the separate `@ai-sdk/openai` and `@ai-sdk/anthropic` packages. The spine diagram points directly to OpenAI and Anthropic but the stack lists neither dedicated provider package nor Vercel AI Gateway as the selected transport.

The candidate model IDs (`gpt-5.6-sol`, `gpt-5.6-terra`, and `claude-sonnet-5`) are current official provider model IDs, so the issue is routing and credentials, not model existence.

**Required disposition:** before the IAM-001 benchmark, choose one explicit adapter contract: direct provider packages, Vercel AI Gateway, or both behind separate `ModelGateway` adapters. Record the provider route as part of Run provenance because gateway versus direct execution changes credentials, data path, telemetry, failure modes, and billing. If direct, add current compatible `@ai-sdk/openai` and `@ai-sdk/anthropic` dependencies to the lockfile.

Sources: [AI SDK provider selection](https://ai-sdk.dev/docs/getting-started/choosing-a-provider), [AI SDK provider management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management), [OpenAI provider package](https://ai-sdk.dev/providers/ai-sdk-providers/openai), [Anthropic provider package](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic), [OpenAI model catalog](https://platform.openai.com/docs/models), [Anthropic model lifecycle](https://docs.anthropic.com/en/docs/about-claude/model-deprecations).

### TR-05 — Medium — Solari fits the PoC browser proof but not the broader deployment implications

`@solarisdk/browser@0.1.2` and `@solarisdk/sandbox@0.1.2` are real current packages and support Node.js 24. The browser product exposes a Playwright/CDP-compatible Chrome session and optional recording, so it fits the controlled ProdConsole acquisition experiment.

The current official service has one available region (`us-west`), and replay retention is plan-limited from one to ninety days. The SDK is also an early `0.1.2` surface. Solari replay therefore cannot be the authoritative execution record or satisfy future enterprise residency; the spine's own persisted sanitized trace must remain authoritative. The sandbox SDK is not used by the architecture and exposes command/code/file capabilities that are intentionally denied to the PoC runner.

**Required disposition:** name and install only `@solarisdk/browser` for the PoC unless a separately approved sandbox use case exists; pin the package; adapt its API strictly behind `BrowserExecution`; persist required trace/provenance before provider replay expiry; and keep region/residency as a production re-evaluation gate.

Sources: [Solari sessions](https://docs.getsolari.com/sessions), [Solari regions](https://docs.getsolari.com/regions), [Solari replay retention](https://docs.getsolari.com/pricing), [Solari SDK overview](https://docs.getsolari.com/), [Solari browser registry metadata](https://registry.npmjs.org/%40solarisdk%2Fbrowser/latest), [Solari sandbox registry metadata](https://registry.npmjs.org/%40solarisdk%2Fsandbox/latest).

### TR-06 — Low — pg-boss is compatible but has maintainer-concentration risk

pg-boss 12.29.0 is compatible with Node.js 24 and PostgreSQL 18, supports Drizzle transactions using both node-postgres and postgres.js, and provides the exact atomic enqueue mechanism AD-3 requires. The project states that it is maintained by one person. This is acceptable for the exploratory PoC, and the spine already has appropriate queue-revisit triggers, but it is a commercial-readiness dependency risk to record.

**Required disposition:** keep the current choice for the PoC; pin it; exercise real PostgreSQL rollback, retry, migration, and worker-recovery tests; and retain the application-owned `RunDispatcher` boundary.

Sources: [pg-boss 12.29.0 requirements and maintenance statement](https://pgboss.io/), [pg-boss Drizzle transaction adapter](https://pgboss.io/api/adapters).

## Version and fit verification matrix

| Technology | Spine seed | Current-source result | Fit verdict |
| --- | ---: | --- | --- |
| Node.js | 24.20.0 LTS | Official 24.20.0 archive; 24 is LTS | Verified; satisfies all listed Node engine floors. |
| TypeScript | 7.0.2 | npm latest `7.0.2` | Verified; Next.js requires TypeScript 5.1+, with no conflicting maximum. |
| Next.js | 16.3.4 | npm latest `16.3.4`; 16.x Active LTS; Node >=20.9 | Verified with Node 24 and React 19.2. |
| React | 19.2.8 | npm latest `19.2.8`; React docs identify 19.2 as current line | Verified; satisfies Next.js and Better Auth peers. |
| PostgreSQL | 18.6 | Official current 18.x minor | Verified; supported through 2030. Railway deployment must explicitly select major 18. |
| pnpm | 11.25.0 | npm latest `11.25.0`; Node >=22.13 | Verified with Node 24.20.0. |
| Drizzle ORM / Kit | 0.45.2 / 0.31.10 | Both npm stable `latest` tags | Verified; Better Auth 1.7.2 peers explicitly accept these versions. |
| postgres.js | 3.4.9 | npm latest `3.4.9`; Node >=12 | Verified with Drizzle and pg-boss's Drizzle transaction adapter. |
| pg-boss | 12.29.0 | Official docs at 12.29.0; Node >=22.12, PostgreSQL >=13 | Verified; exact atomic enqueue fit confirmed. |
| Better Auth | 1.7.2 | Official current `1.7.2`; Next.js 16 and Drizzle documented | Verified; suitable for identity/session while application roles remain authoritative. |
| Vercel AI SDK | 7.0.87 | npm latest `7.0.87`; Node >=22; Zod 3/4 | Verified core; provider-routing decision still required. |
| Solari browser / sandbox | 0.1.2 / 0.1.2 | Both npm latest `0.1.2` | Browser verified for PoC; sandbox is unnecessary; provider maturity/residency limitations apply. |
| AWS SDK S3 client | 3.1123.0 | npm latest `3.1123.0`; Node >=20 | Verified; Railway documents this client. Configure Railway endpoint, credentials, `REGION`, and URL style rather than AWS defaults. |
| Zod | 4.5.4 | npm latest `4.5.4`; official Zod 4.5 release | Verified; accepted by AI SDK 7. |
| Pino | 10.3.1 | npm latest `10.3.1` | Verified; redaction requires explicit safe logging discipline. |
| Sentry JavaScript SDK | 10.73.0 | `@sentry/nextjs` and `@sentry/node` npm latest `10.73.0`; Next 16 peer accepted | Verified; exact packages and sanitization policy must be named. |
| Vitest | 4.1.11 | npm latest `4.1.11`; Node 20/22/24+ and Vite 6/7/8 | Verified with Node 24. |
| Playwright | 1.62.1 | npm latest `1.62.1`; latest Node 22/24/26 supported | Verified for browser E2E; CI browser/image version must match package version. |
| Railway | managed compute platform | Containers, persistent services, private service networking, Postgres templates, buckets, backups, and PITR documented | Fit for synthetic PoC, subject to TR-01 and TR-03; database templates remain operator-managed and buckets use public endpoints. |

Primary version sources: [Node.js 24.20.0](https://nodejs.org/en/download/archive/v24.20.0), [Next.js support policy](https://nextjs.org/support-policy), [Next.js installation requirements](https://nextjs.org/docs/app/getting-started/installation), [React versions](https://react.dev/versions), [PostgreSQL releases](https://www.postgresql.org/support/versioning/), [Drizzle ORM npm](https://www.npmjs.com/package/drizzle-orm), [Drizzle Kit npm](https://www.npmjs.com/package/drizzle-kit), [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next), [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [Vitest requirements](https://vitest.dev/guide/), [Playwright requirements](https://playwright.dev/docs/intro). Exact latest package metadata was checked against each package's `latest` document in the official npm registry on 2026-09-01.

## Gate condition

The architecture can pass the technology gate after TR-01 and TR-02 are resolved in adopted configuration/invariants. TR-03 through TR-05 should be closed before bootstrap decisions are handed to implementation; TR-06 may remain as a recorded PoC risk.
