import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ROLES } from '@intellifin/domain';

import { ROLE_VOCABULARY } from './schema.js';

/**
 * The drift guard for the one thing this file deliberately duplicates.
 *
 * `schema.ts` cannot take a VALUE import from `@intellifin/domain`, because
 * `drizzle-kit generate` resolves that package to its built output and would then
 * only work after a `pnpm build`. So the role vocabulary is written out twice, and
 * this test is the reason that is safe.
 */
describe('the user_role check constraint', () => {
  it('lists exactly the domain roles, in the same order', () => {
    expect([...ROLE_VOCABULARY]).toEqual([...ROLES]);
  });

  it('is written into the generation-3 migration', () => {
    const migration = readFileSync(
      fileURLToPath(new URL('../../drizzle/0003_overconfident_mad_thinker.sql', import.meta.url)),
      'utf8',
    );
    const values = ROLES.map((role) => `'${role}'`).join(', ');
    expect(migration).toContain(`CHECK ("user_role"."role" IN (${values}))`);
  });
});
