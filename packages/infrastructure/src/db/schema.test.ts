import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REGISTRATION_STATUSES } from '@intellifin/application';
import { PERMITTED_READ_ACTIONS, ROLES, TARGET_SYSTEM_KINDS } from '@intellifin/domain';

import {
  PERMITTED_READ_ACTION_VOCABULARY,
  REGISTRATION_STATUS_VOCABULARY,
  ROLE_VOCABULARY,
  TARGET_SYSTEM_KIND_VOCABULARY,
} from './schema.js';

/**
 * The drift guard for the vocabularies `schema.ts` deliberately duplicates.
 *
 * `schema.ts` cannot take a VALUE import from `@intellifin/domain`, because
 * `drizzle-kit generate` resolves that package to its built output and would then only
 * work after a `pnpm build`. So each vocabulary is written out twice, and this test is
 * the reason that is safe. A test file has no such constraint: it is never transpiled by
 * drizzle-kit, so it can import both sides and compare them.
 */

const migration = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../drizzle/${name}`, import.meta.url)), 'utf8');

describe('the user_role check constraint', () => {
  it('lists exactly the domain roles, in the same order', () => {
    expect([...ROLE_VOCABULARY]).toEqual([...ROLES]);
  });

  it('is written into the generation-3 migration', () => {
    const values = ROLES.map((role) => `'${role}'`).join(', ');
    expect(migration('0003_mature_the_renegades.sql')).toContain(
      `CHECK ("user_role"."role" IN (${values}))`,
    );
  });
});

describe('the target_system_registration check constraints', () => {
  it('lists exactly the domain kinds, in the same order', () => {
    expect([...TARGET_SYSTEM_KIND_VOCABULARY]).toEqual([...TARGET_SYSTEM_KINDS]);
  });

  it('lists exactly the domain read actions, in the same order', () => {
    expect([...PERMITTED_READ_ACTION_VOCABULARY]).toEqual([...PERMITTED_READ_ACTIONS]);
  });

  it('lists exactly the application statuses, in the same order', () => {
    expect([...REGISTRATION_STATUS_VOCABULARY]).toEqual([...REGISTRATION_STATUSES]);
  });

  /**
   * The constraint has to be in the MIGRATION, not only in `schema.ts`.
   *
   * `schema.ts` describes the intended shape; the migration is what a database actually
   * gets. A read-only rule that lives only in the model is a rule the deployed database
   * does not have, and this table is where FR-8 stops being a convention.
   */
  it('writes the read-only action constraint into the generation-5 migration', () => {
    const values = PERMITTED_READ_ACTIONS.map((action) => `'${action}'`).join(', ');
    expect(migration('0005_clumsy_freak.sql')).toContain(
      `CHECK ("target_system_registration"."permitted_actions" <@ ARRAY[${values}]::text[])`,
    );
  });

  it('writes the digest-format constraint into the generation-5 migration', () => {
    expect(migration('0005_clumsy_freak.sql')).toContain(
      `CHECK ("target_system_registration"."digest" ~ '^[0-9a-f]{64}$')`,
    );
  });

  /**
   * The one constraint whose obvious spelling is WRONG.
   *
   * `array_length(x, 1)` of an empty array is NULL, and a CHECK evaluating to NULL
   * passes — so written that way the constraint accepted exactly the row it existed to
   * refuse: a registration permitting nothing. `cardinality` returns 0. The other two
   * constraints were pinned here and this one was not, which is backwards: this is the
   * one where an edit that looks like a tidy-up silently removes the rule.
   */
  it('writes the actions-present constraint with cardinality, never array_length', () => {
    const sql = migration('0005_clumsy_freak.sql');
    expect(sql).toContain(
      `CHECK (cardinality("target_system_registration"."permitted_actions") >= 1)`,
    );
    // Statements only. The file's header comment names `array_length` to explain why it
    // is not used, and a naive search would match that and pass forever.
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).not.toContain('array_length');
  });
});
