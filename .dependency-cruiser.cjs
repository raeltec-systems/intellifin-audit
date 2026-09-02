/**
 * AD-1 — strict inward dependency direction, enforced in CI rather than by convention.
 *
 *   domain        imports nothing outward
 *   application   imports only domain
 *   infrastructure implements ports domain/application own
 *   apps/web, apps/worker are the only composition roots
 *
 * Business code (domain + application) must never import Drizzle, pg-boss, Solari,
 * the Vercel AI SDK, Resend, S3, Better Auth, Next.js, Pino or Sentry — types included.
 *
 * Run with `pnpm boundaries`.
 */

/** Vendors that must never appear in business code. Matches bare and resolved paths. */
const FORBIDDEN_VENDORS = [
  'drizzle-orm',
  'drizzle-kit',
  'pg-boss',
  'postgres',
  'pg',
  '@solarisdk/browser',
  '@solarisdk/sandbox',
  'ai',
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
  'resend',
  '@aws-sdk/client-s3',
  '@railway/cli',
  'better-auth',
  'next',
  'react',
  'react-dom',
  'pino',
  '@sentry/nextjs',
  '@sentry/node',
];

const escapedVendors = FORBIDDEN_VENDORS.map((v) =>
  v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
).join('|');

/**
 * Two patterns, deliberately not one. A vendor counts as imported only when it is
 *
 *   1. a bare specifier at the very start of the path (`react`, `next/headers`), or
 *   2. a path segment directly under a `node_modules/` directory -- which also covers
 *      pnpm's `node_modules/.pnpm/<id>/node_modules/<name>/...` layout, since that
 *      still contains `/node_modules/<name>/`.
 *
 * Neither matches anywhere else in a path, so an internal folder that happens to
 * share a vendor's name -- `packages/domain/src/ai/index.ts`, `.../src/pg/...`,
 * `.../src/next/...` -- is treated as our own code, which is what it is.
 *
 * Kept as two simple alternatives rather than one combined regex: dependency-cruiser
 * runs every rule pattern through a catastrophic-backtracking check and rejects the
 * whole rule set (silently disabling the check) if a pattern nests quantifiers.
 */
const vendorPatterns = [
  `^(?:${escapedVendors})(?:/|$)`,
  `(?:^|/)node_modules/(?:${escapedVendors})(?:/|$)`,
];

module.exports = {
  forbidden: [
    {
      name: 'domain-imports-nothing-outward',
      comment:
        'AD-1: packages/domain is the innermost layer. It may not import application, ' +
        'infrastructure, or either composition root.',
      severity: 'error',
      from: { path: '^packages/domain/src' },
      to: { path: '^(packages/(application|infrastructure)|apps)/' },
    },
    {
      name: 'application-imports-only-domain',
      comment:
        'AD-1: packages/application may import packages/domain and nothing else inward-facing. ' +
        'It may not reach infrastructure or a composition root.',
      severity: 'error',
      from: { path: '^packages/application/src' },
      to: { path: '^(packages/infrastructure|apps)/' },
    },
    {
      name: 'infrastructure-imports-no-composition-root',
      comment: 'AD-1: apps/web and apps/worker are composition roots; nothing imports them.',
      severity: 'error',
      from: { path: '^packages/infrastructure/src' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-migrator-in-apps',
      comment:
        'AD-15: the release migrator is a pipeline entry point, not application code. It carries ' +
        'top-level process access and reads the migrations folder off disk, so importing it from a ' +
        'composition root drags it into that application bundle. It is reachable only through the ' +
        "package's ./migrate subpath, never through the barrel.",
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^packages/infrastructure/(src|dist)/db/migrate', reachable: true },
    },
    {
      name: 'no-target-system-probe-in-apps',
      comment:
        'AD-10: the worker observes a Target System and writes what it saw; the web only reads ' +
        'those rows. Nothing under apps/ may reach the probe module — not the web, which must ' +
        'never make an outbound call to a registered system, and not the worker either, which ' +
        'runs the probe as its own entry point through the package\'s ./probe subpath rather ' +
        'than pulling it into the heartbeat bundle. `reachable: true`, so a transitive import ' +
        'through a barrel is caught as well as a direct one.',
      severity: 'error',
      from: { path: '^apps/' },
      to: { path: '^packages/infrastructure/(src|dist)/registrations/probe', reachable: true },
    },
    {
      name: 'no-vendor-sdk-in-business-code',
      comment:
        'AD-1: business code (domain + application) must not import Drizzle, pg-boss, Solari, ' +
        'the AI SDK, Resend, S3, Railway, Better Auth, Next.js, Pino or Sentry — types included. ' +
        'Put the vendor behind a port implemented in packages/infrastructure.',
      severity: 'error',
      from: { path: '^packages/(domain|application)/src' },
      to: { path: vendorPatterns },
    },
    {
      name: 'no-env-access-outside-composition-roots',
      comment:
        'AD-11: runtime configuration is read only in a composition root or in ' +
        'packages/infrastructure/src/config.ts, through the validated schema.',
      severity: 'error',
      from: { path: '^packages/(domain|application)/src' },
      to: { path: '^node:process$|(^|/)node_modules/@types/node/process\\.d\\.ts$' },
    },
    {
      name: 'no-circular',
      comment: 'A dependency cycle across modules hides the layering it is meant to express.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'An import that does not resolve is a broken boundary or a missing dependency.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-orphans',
      comment: 'Unreferenced modules rot. Delete them or wire them in.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|cts|mts|json)$',
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.json$',
          '(^|/)(next|drizzle|vitest|playwright)\\.config\\.(js|cjs|mjs|ts|cts|mts)$',
          // Next.js discovers app-router files and instrumentation by convention;
          // nothing in the repository imports them.
          '^apps/web/app/',
          '^apps/web/instrumentation\\.ts$',
          // Next.js discovers middleware by convention too.
          '^apps/web/middleware\\.ts$',
          // Process entry points. Nothing imports a composition root -- that is the
          // point of AD-1 -- so they are orphans by design.
          '^apps/worker/src/main\\.ts$',
          // Vitest discovers test files; nothing imports them.
          '\\.test\\.tsx?$',
        ],
      },
      to: {},
    },
  ],
  options: {
    // Built output is NOT followed, but it IS in the graph and therefore rule-checked.
    // It was in `exclude`, and an excluded path is not rule-checked at all: the
    // `(src|dist)` half of `no-migrator-in-apps` and `no-target-system-probe-in-apps`
    // could never match, so an import spelled at `packages/infrastructure/dist/...`
    // passed both rules. Same trap as excluding `node_modules`, one directory over.
    doNotFollow: { path: ['node_modules', '^(apps|packages)/[^/]+/(dist|\\.next)/'] },
    exclude: {
      // Scoped to this repository's own tree on purpose: a broad `\\.d\\.ts$` or
      // `dist/` exclusion also drops vendor packages whose entry point is a
      // declaration file or a dist folder, which would silently disable the
      // vendor rules above. Only our build output and our ambient declarations
      // (next-env.d.ts) are skipped.
      path: '^(apps|packages)/.+\\.d\\.ts$',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
