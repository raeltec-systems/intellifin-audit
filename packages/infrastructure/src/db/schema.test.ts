import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BINDING_STATUSES, REGISTRATION_STATUSES } from '@intellifin/application';
import {
  DECLARED_COUNT_MECHANISMS,
  PERMITTED_READ_ACTIONS,
  POPULATION_SOURCE_KINDS,
  PROCEDURE_TEMPLATE_IDS,
  PROCEDURE_VERSION_STATES,
  ROLES,
  TARGET_SYSTEM_KINDS,
} from '@intellifin/domain';

import {
  BINDING_STATUS_VOCABULARY,
  DECLARED_COUNT_MECHANISM_VOCABULARY,
  PERMITTED_READ_ACTION_VOCABULARY,
  POPULATION_SOURCE_KIND_VOCABULARY,
  PROCEDURE_TEMPLATE_VOCABULARY,
  PROCEDURE_VERSION_STATE_VOCABULARY,
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

describe('the population_source_binding check constraints', () => {
  it('lists exactly the domain binding kinds, in the same order', () => {
    expect([...POPULATION_SOURCE_KIND_VOCABULARY]).toEqual([...POPULATION_SOURCE_KINDS]);
  });

  it('lists exactly the domain declared-count mechanisms, in the same order', () => {
    expect([...DECLARED_COUNT_MECHANISM_VOCABULARY]).toEqual([...DECLARED_COUNT_MECHANISMS]);
  });

  it('lists exactly the application binding statuses, in the same order', () => {
    expect([...BINDING_STATUS_VOCABULARY]).toEqual([...BINDING_STATUSES]);
  });

  /**
   * FR-41's masking rule has to be in the MIGRATION, not only in `schema.ts`.
   *
   * `schema.ts` describes the intended shape; the migration is what a database actually
   * gets. A mask over a field the schema does not declare hides nothing while reading, in
   * a list view, exactly like protection — so this is the one place the rule cannot be
   * routed around.
   */
  it('writes the sensitive-fields subset constraint into the generation-6 migration', () => {
    const sql = migration('0006_slim_sersi.sql');
    expect(sql).toContain(
      `"population_source_binding"."sensitive_fields" <@ "population_source_binding"."declared_schema"`,
    );
    // `<@` is NULL, and therefore PASSES, when the left array holds a NULL element.
    expect(sql).toContain(
      `array_position("population_source_binding"."sensitive_fields", NULL) IS NULL`,
    );
  });

  it('writes the digest-format constraint into the generation-6 migration', () => {
    expect(migration('0006_slim_sersi.sql')).toContain(
      `CHECK ("population_source_binding"."digest" ~ '^[0-9a-f]{64}$')`,
    );
  });

  /**
   * The one constraint whose obvious spelling is WRONG, for the second time.
   *
   * `array_length(x, 1)` of an empty array is NULL, and a CHECK evaluating to NULL
   * passes — so written that way this constraint would accept exactly the row it exists
   * to refuse: a binding that declares no fields at all, which no inclusion rule and no
   * masking designation could then mean anything against.
   */
  it('writes the schema-present constraint with cardinality, never array_length', () => {
    const sql = migration('0006_slim_sersi.sql');
    // Cardinality counts ELEMENTS, so the rule needs two more clauses to mean "declares
    // at least one NAME": `ARRAY[NULL]` and `ARRAY['']` both have cardinality 1.
    expect(sql).toContain(`cardinality("population_source_binding"."declared_schema") >= 1`);
    expect(sql).toContain(
      `array_position("population_source_binding"."declared_schema", NULL) IS NULL`,
    );
    expect(sql).toContain(`'' <> ALL ("population_source_binding"."declared_schema")`);
    // Statements only. The file's header comment names `array_length` to explain why it
    // is not used, and a naive search would match that and pass forever.
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).not.toContain('array_length');
  });

  it('writes the location rule in BOTH directions into the generation-6 migration', () => {
    // A versioned file with no location points at nothing; a manual upload WITH one
    // holds a value the digest deliberately drops.
    const sql = migration('0006_slim_sersi.sql');
    expect(sql).toContain(`"population_source_binding"."kind" = 'manual-upload' AND "population_source_binding"."location" = ''`);
    expect(sql).toContain(`"population_source_binding"."kind" <> 'manual-upload' AND btrim("population_source_binding"."location") <> ''`);
  });

  it('seeds generation 6 by hand, because drizzle-kit does not write that line', () => {
    expect(migration('0006_slim_sersi.sql')).toContain(
      `INSERT INTO "schema_meta" ("version") VALUES (6) ON CONFLICT ("version") DO NOTHING;`,
    );
  });
});

describe('the procedure and procedure_version check constraints', () => {
  it('lists exactly the domain version states, in the same order', () => {
    expect([...PROCEDURE_VERSION_STATE_VOCABULARY]).toEqual([...PROCEDURE_VERSION_STATES]);
  });

  it('lists exactly the domain Template ids, in the same order', () => {
    expect([...PROCEDURE_TEMPLATE_VOCABULARY]).toEqual([...PROCEDURE_TEMPLATE_IDS]);
  });

  /**
   * The whole §E state vocabulary has to be in the MIGRATION, not only in `schema.ts`.
   * A machine that grows one arrow per story ends up with no machine at all; a
   * half-spelled vocabulary invites a future state spelled to fit whatever the first
   * caller typed. The words are legal from the first commit even though this story
   * writes only DRAFT.
   */
  it('writes the whole state vocabulary into the generation-7 migration', () => {
    const values = PROCEDURE_VERSION_STATES.map((state) => `'${state}'`).join(', ');
    expect(migration('0007_shallow_lockheed.sql')).toContain(
      `CHECK ("procedure_version"."state" IN (${values}))`,
    );
  });

  it('writes the Template vocabulary into the generation-7 migration on both tables', () => {
    const values = PROCEDURE_TEMPLATE_IDS.map((id) => `'${id}'`).join(', ');
    const sql = migration('0007_shallow_lockheed.sql');
    expect(sql).toContain(`CHECK ("procedure"."template_id" IN (${values}))`);
    expect(sql).toContain(`CHECK ("procedure_version"."template_id" IN (${values}))`);
  });

  /**
   * `btrim`, not `<> ''`: a Control name of three spaces is blank, and a rule written
   * without the trim accepts exactly the row it was written to refuse.
   */
  it('writes the Control-name presence rule with a trim, on both tables', () => {
    const sql = migration('0007_shallow_lockheed.sql');
    expect(sql).toContain(`btrim("procedure"."control_name") <> ''`);
    expect(sql).toContain(`btrim("procedure_version"."control_name") <> ''`);
  });

  it('writes version_number >= 1 and the UNIQUE (procedure_id, version_number) index', () => {
    const sql = migration('0007_shallow_lockheed.sql');
    expect(sql).toContain(`CHECK ("procedure_version"."version_number" >= 1)`);
    expect(sql).toContain(
      `CREATE UNIQUE INDEX "procedure_version_procedure_number_uidx" ON "procedure_version" USING btree ("procedure_id","version_number")`,
    );
  });

  it('seeds generation 7 by hand, because drizzle-kit does not write that line', () => {
    expect(migration('0007_shallow_lockheed.sql')).toContain(
      `INSERT INTO "schema_meta" ("version") VALUES (7) ON CONFLICT ("version") DO NOTHING;`,
    );
  });
});
