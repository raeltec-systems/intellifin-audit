import { defineRailway, project, service, volume } from 'railway/iac';

/**
 * AD-11: web and worker are separate containers built from this one repository;
 * PostgreSQL 18 is the system of record. Config as Code (railway.json) is
 * deprecated on Railway, so this file is the declared shape of the PoC
 * environment. Apply with `railway config plan` then `railway config apply`.
 * Secrets stay on Railway; nothing here carries a value.
 */
export default defineRailway(() => {
  const data = volume('postgres-data', { sizeMB: 5120 });

  const postgres = service('postgres', {
    source: { image: 'ghcr.io/railwayapp-templates/postgres-ssl:18' },
    volumeMounts: { '/var/lib/postgresql/data': data },
  });

  const web = service('web', {
    source: { repo: 'raeltec-systems/intellifin-audit', branch: 'main' },
    dockerfile: 'apps/web/Dockerfile',
    start: 'node apps/web/server.js',
    healthcheck: '/api/health',
    watchPatterns: ['apps/web/**', 'packages/**', 'package.json', 'pnpm-lock.yaml'],
    env: {
      DATABASE_URL: postgres.env.DATABASE_URL,
      SERVICE_NAME: 'web',
      SCHEMA_RANGE_MIN: '1',
      SCHEMA_RANGE_MAX: '1',
      NODE_ENV: 'production',
      PORT: '3000',
    },
  });

  const worker = service('worker', {
    source: { repo: 'raeltec-systems/intellifin-audit', branch: 'main' },
    dockerfile: 'apps/worker/Dockerfile',
    start: 'node dist/main.js',
    watchPatterns: ['apps/worker/**', 'packages/**', 'package.json', 'pnpm-lock.yaml'],
    env: {
      DATABASE_URL: postgres.env.DATABASE_URL,
      SERVICE_NAME: 'worker',
      SCHEMA_RANGE_MIN: '1',
      SCHEMA_RANGE_MAX: '1',
      NODE_ENV: 'production',
    },
  });

  return project('intellifin-audit', { resources: [postgres, data, web, worker] });
});
