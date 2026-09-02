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

/** `foo` or `@scope/foo`, bare or under any node_modules/.pnpm layout. */
const vendorPattern = `(^|/)(${FORBIDDEN_VENDORS.map((v) =>
  v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
).join('|')})(/|$)`;

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
      name: 'no-vendor-sdk-in-business-code',
      comment:
        'AD-1: business code (domain + application) must not import Drizzle, pg-boss, Solari, ' +
        'the AI SDK, Resend, S3, Railway, Better Auth, Next.js, Pino or Sentry — types included. ' +
        'Put the vendor behind a port implemented in packages/infrastructure.',
      severity: 'error',
      from: { path: '^packages/(domain|application)/src' },
      to: { path: vendorPattern },
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
          // Next.js discovers app-router files by convention; nothing imports them.
          '^apps/web/app/',
          // Vitest discovers test files; nothing imports them.
          '\\.test\\.tsx?$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      // Scoped to this repository's own tree on purpose: a broad `\\.d\\.ts$` or
      // `dist/` exclusion also drops vendor packages whose entry point is a
      // declaration file or a dist folder, which would silently disable the
      // vendor rules above. Only our build output and our ambient declarations
      // (next-env.d.ts) are skipped.
      path: '^(apps|packages)/[^/]+/(dist|\\.next)/|^(apps|packages)/.+\\.d\\.ts$',
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
